import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  AuthStorage,
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

import {
  createScribeExtension,
  SCRIBE_REVISION_EVENT,
  SCRIBE_TOOL_NAMES,
  type ScribeExtensionHost,
  type ScribeRevision,
} from "./scribe-extension.js";
import { ScribeLoopState } from "./scribe-loop.js";
import type { AgentActivity, AgentRuntime } from "../src/shared/desktop.js";

type ParentMessage =
  | ({ kind: "project.changed" } & ScribeRevision)
  | { kind: "rpc"; id: string; method: "agent.start"; params: ScribeRevision }
  | { kind: "rpc"; id: string; method: "agent.stop" }
  | { kind: "storage.result"; id: string; result?: unknown; error?: string }
  | { kind: "shutdown" };

const workspaceRoot = process.argv[2];
const agentDir = process.argv[3];
const sessionDirectory = process.argv[4];
if (!workspaceRoot || !agentDir || !sessionDirectory) {
  throw new Error("Agent process requires workspace, Pi config, and session paths");
}

const pendingStorage = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
const eventBus = createEventBus();
let session: AgentSession | undefined;
let configured = false;
let draining = false;

function storageCall<T>(method: string, params?: unknown): Promise<T> {
  const id = randomUUID();
  return new Promise<T>((resolve, reject) => {
    pendingStorage.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    process.parentPort?.postMessage({ kind: "storage.request", id, method, params });
  });
}

function postRuntime(value: AgentRuntime) {
  process.parentPort?.postMessage({ kind: "agent.runtime", runtime: value });
}

function postActivity(value: Omit<AgentActivity, "updatedAt">) {
  process.parentPort?.postMessage({ kind: "agent.activity", activity: value });
}

const host: ScribeExtensionHost = {
  loop: new ScribeLoopState(),
  storageCall,
  runtime() {
    if (!configured) return;
    postRuntime(runtime());
  },
  activity: postActivity,
  wake() {
    setTimeout(() => void drain(), 0);
  },
  persist() {},
};

function serializable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return { unavailable: true };
  }
}

function messageParts(message: unknown) {
  const record = message as {
    role?: string;
    timestamp?: number;
    content?: string | Array<{ type?: string; text?: string; thinking?: string }>;
    errorMessage?: string;
  };
  const content = typeof record.content === "string" ? [] : (record.content ?? []);
  return {
    role: record.role ?? "message",
    timestamp: record.timestamp ?? Date.now(),
    text: typeof record.content === "string"
      ? record.content
      : content.filter((part) => part.type === "text").map((part) => part.text ?? "").join(""),
    reasoning: content
      .filter((part) => part.type === "thinking")
      .map((part) => part.thinking ?? "")
      .join(""),
    error: record.errorMessage,
  };
}

function observeSessionEvent(event: AgentSessionEvent) {
  const now = Date.now();
  if (event.type === "agent_start" || event.type === "agent_end") {
    postActivity({
      id: `lifecycle:${event.type}:${now}`,
      kind: "lifecycle",
      timestamp: now,
      title: event.type === "agent_start" ? "Agent cycle started" : "Agent cycle ended",
      payload: serializable(event),
    });
    return;
  }
  if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
    const parts = messageParts(event.message);
    const key = `${parts.role}:${parts.timestamp}`;
    if (parts.text) {
      postActivity({
        id: `message:${key}`,
        kind: "message",
        timestamp: parts.timestamp,
        title: `${parts.role} message`,
        text: parts.text,
        payload: serializable(event),
      });
    }
    if (parts.reasoning) {
      postActivity({
        id: `reasoning:${key}`,
        kind: "reasoning",
        timestamp: parts.timestamp,
        title: "Model reasoning",
        text: parts.reasoning,
        payload: serializable(event),
      });
    }
    if (parts.error) {
      postActivity({
        id: `error:${key}`,
        kind: "error",
        timestamp: parts.timestamp,
        title: "Provider error",
        text: parts.error,
        payload: serializable(event),
        status: "error",
      });
    }
    return;
  }
  if (
    event.type === "tool_execution_start" ||
    event.type === "tool_execution_update" ||
    event.type === "tool_execution_end"
  ) {
    postActivity({
      id: `tool:${event.toolCallId}`,
      kind: "tool",
      timestamp: now,
      title: `${event.toolName} ${event.type === "tool_execution_end" ? "completed" : "running"}`,
      payload: serializable(event),
    });
  }
}

function runtime() {
  const state = host.loop.snapshot();
  return {
    status: state.status,
    sessionId: session?.sessionId,
    activeRevision: state.activeRevision,
    cycleCount: state.cycleCount,
    error: state.error,
  } satisfies AgentRuntime;
}

async function drain() {
  if (
    !configured ||
    !session ||
    !host.loop.isEnabled() ||
    draining ||
    session.isStreaming
  ) {
    return;
  }
  const cycle = host.loop.beginCycle();
  if (!cycle) {
    host.persist();
    postRuntime(runtime());
    return;
  }
  draining = true;
  host.persist();
  postRuntime(runtime());
  postActivity({
    id: `loop:cycle:${cycle.projectRevision}:${cycle.cycleCount}`,
    kind: "loop",
    timestamp: Date.now(),
    title: `Autonomous cycle ${cycle.cycleCount}`,
    text: `Reviewing project revision ${cycle.projectRevision}`,
    payload: cycle,
    status: "working",
  });
  try {
    await session.prompt(
      `Review the durable Scribe project revision ${cycle.projectRevision} (draft revision ${cycle.documentRevision}). Read draft.md and relevant Markdown files in sources/. Manage only concrete, high-value suggestions. If no useful work remains for this revision, call wait_for_changes.`,
    );
    if (!host.loop.isEnabled()) return;
    const continueRunning = host.loop.finishCycle();
    host.persist();
    postRuntime(runtime());
    if (!continueRunning) {
      const state = host.loop.snapshot();
      postActivity({
        id: `loop:${state.status}:${state.latestRevision}`,
        kind: "loop",
        timestamp: Date.now(),
        title: state.status === "capped" ? "Autonomous loop capped" : "Waiting for changes",
        text: state.status === "capped"
          ? "Five consecutive cycles completed without a yield or newer revision."
          : `Yielded project revision ${state.yieldedRevision}.`,
        payload: state,
        status: state.status,
      });
    }
  } catch (error) {
    if (!host.loop.isEnabled()) return;
    const message = error instanceof Error ? error.message : String(error);
    host.loop.fail(message);
    host.persist();
    postRuntime(runtime());
    postActivity({
      id: `error:cycle:${Date.now()}`,
      kind: "error",
      timestamp: Date.now(),
      title: "Agent cycle failed",
      text: message,
      payload: serializable(error),
      status: "error",
    });
  } finally {
    draining = false;
  }
  if (host.loop.isEnabled() && host.loop.snapshot().status === "working") {
    setTimeout(() => void drain(), 0);
  }
}

async function startAgent(revision: ScribeRevision) {
  if (!configured || !session) {
    throw new Error("The agent is unavailable because Pi is not configured");
  }
  host.loop.revision(revision.projectRevision, revision.documentRevision);
  if (host.loop.start()) {
    const timestamp = Date.now();
    host.persist();
    postRuntime(runtime());
    postActivity({
      id: `control:started:${timestamp}`,
      kind: "lifecycle",
      timestamp,
      title: "Agent started by writer",
      status: host.loop.snapshot().status,
    });
    host.wake();
  }
  return runtime();
}

async function stopAgent() {
  if (!configured || !session) {
    throw new Error("The agent is unavailable because Pi is not configured");
  }
  if (host.loop.stop()) {
    const timestamp = Date.now();
    host.persist();
    postRuntime(runtime());
    postActivity({
      id: `control:stopped:${timestamp}`,
      kind: "lifecycle",
      timestamp,
      title: "Agent stopped by writer",
      status: "stopped",
    });
    if (session.isStreaming) await session.abort();
  }
  return runtime();
}

let controlQueue = Promise.resolve();

function handleControl(message: Extract<ParentMessage, { kind: "rpc" }>) {
  controlQueue = controlQueue.then(async () => {
    try {
      const result = message.method === "agent.start"
        ? await startAgent(message.params)
        : await stopAgent();
      process.parentPort?.postMessage({ kind: "rpc.result", id: message.id, result });
    } catch (error) {
      process.parentPort?.postMessage({
        kind: "rpc.result",
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

async function initialize() {
  await Promise.all([
    mkdir(agentDir, { recursive: true }),
    mkdir(sessionDirectory, { recursive: true }),
  ]);
  const settingsManager = SettingsManager.create(workspaceRoot, agentDir, {
    projectTrusted: true,
  });
  const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
  const resourceLoader = new DefaultResourceLoader({
    cwd: workspaceRoot,
    agentDir,
    settingsManager,
    eventBus,
    extensionFactories: [createScribeExtension(host)],
    noExtensions: true,
    appendSystemPrompt: [
      "You are Scribe's autonomous writing partner. Treat draft.md and every file in sources/ as read-only. Never edit project files. Publish proposed changes only through Scribe suggestion tools. Cite the exact source filename for sourced claims. Call wait_for_changes when useful work for the current durable revision is exhausted.",
    ],
  });
  await resourceLoader.reload({ resolveProjectTrust: async () => true });
  const sessionManager = SessionManager.continueRecent(workspaceRoot, sessionDirectory);
  const created = await createAgentSession({
    cwd: workspaceRoot,
    agentDir,
    authStorage,
    modelRegistry,
    settingsManager,
    resourceLoader,
    sessionManager,
    tools: ["read", "grep", "find", "ls", ...SCRIBE_TOOL_NAMES],
    excludeTools: ["bash", "write", "edit"],
  });
  session = created.session;
  session.subscribe(observeSessionEvent);

  const diagnostics = [
    ...settingsManager.drainErrors().map((item) => item.error.message),
    ...authStorage.drainErrors().map((error) => error.message),
    modelRegistry.getError(),
    ...created.extensionsResult.errors.map((item) => item.error),
  ].filter((item): item is string => Boolean(item));
  const activeTools = session.getActiveToolNames().sort();
  const expectedTools = ["find", "grep", "ls", "read", ...SCRIBE_TOOL_NAMES].sort();
  if (JSON.stringify(activeTools) !== JSON.stringify(expectedTools)) {
    diagnostics.push(`Unsafe or incomplete Pi tool set: ${activeTools.join(", ")}`);
  }
  if (!session.model) diagnostics.push("No Pi model is configured in settings.json or models.json");
  else if (!modelRegistry.hasConfiguredAuth(session.model)) {
    diagnostics.push(`No credentials are configured for ${session.model.provider}`);
  }

  if (diagnostics.length) {
    configured = false;
    postRuntime({
      status: "offline",
      sessionId: session.sessionId,
      cycleCount: host.loop.snapshot().cycleCount,
      error: diagnostics.join("; "),
    });
    postActivity({
      id: "configuration:offline",
      kind: "error",
      timestamp: Date.now(),
      title: "Pi configuration unavailable",
      text: diagnostics.join("; "),
      status: "offline",
    });
  } else {
    configured = true;
    postRuntime(runtime());
  }
}

process.parentPort?.on("message", ({ data }: { data: ParentMessage }) => {
  if (data.kind === "rpc") {
    handleControl(data);
    return;
  }
  if (data.kind === "storage.result") {
    const request = pendingStorage.get(data.id);
    if (!request) return;
    pendingStorage.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
    return;
  }
  if (data.kind === "project.changed") {
    eventBus.emit(SCRIBE_REVISION_EVENT, {
      projectRevision: data.projectRevision,
      documentRevision: data.documentRevision,
    } satisfies ScribeRevision);
    return;
  }
  session?.dispose();
});

initialize()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    postRuntime({ status: "offline", cycleCount: 0, error: message });
    postActivity({
      id: "configuration:failure",
      kind: "error",
      timestamp: Date.now(),
      title: "Pi failed to start",
      text: message,
      status: "offline",
    });
  })
  .finally(() => process.parentPort?.postMessage({ kind: "ready" }));
