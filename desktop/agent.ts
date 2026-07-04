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
} from "@earendil-works/pi-coding-agent";

import {
  createScribeExtension,
  SCRIBE_REVISION_EVENT,
  SCRIBE_TOOL_NAMES,
  type ScribeExtensionHost,
  type ScribeRevision,
} from "./scribe-extension.js";
import { ScribeLoopState } from "./scribe-loop.js";
import { activitiesFromSessionEvent } from "./agent-events.js";
import type { AgentActivity, AgentRuntime } from "../src/shared/desktop.js";
import type { AgentParentMessage } from "../src/shared/contracts.js";
import {
  AgentStorageClient,
  createAgentParentTransport,
} from "./agent-transport.js";

const workspaceRoot = process.argv[2];
const agentDir = process.argv[3];
const sessionDirectory = process.argv[4];
if (!workspaceRoot || !agentDir || !sessionDirectory) {
  throw new Error("Agent process requires workspace, Pi config, and session paths");
}

const eventBus = createEventBus();
let session: AgentSession | undefined;
let configured = false;
let draining = false;

const storageClient = new AgentStorageClient(randomUUID, (message) =>
  process.parentPort?.postMessage(message),
);

function storageCall<T>(method: string, params?: unknown): Promise<T> {
  return storageClient.call<T>(method, params);
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

function observeSessionEvent(
  event: Parameters<typeof activitiesFromSessionEvent>[0],
) {
  activitiesFromSessionEvent(event).forEach(postActivity);
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

function canDrain(activeSession: AgentSession | undefined): activeSession is AgentSession {
  return Boolean(
    configured &&
      activeSession &&
      host.loop.isEnabled() &&
      !draining &&
      !activeSession.isStreaming,
  );
}

function reportLoopPause() {
  const state = host.loop.snapshot();
  const capped = state.status === "capped";
  postActivity({
    id: `loop:${state.status}:${state.latestRevision}`,
    kind: "loop",
    timestamp: Date.now(),
    title: capped ? "Autonomous loop capped" : "Waiting for changes",
    text: capped
      ? "Five consecutive cycles completed without a yield or newer revision."
      : `Yielded project revision ${state.yieldedRevision}.`,
    payload: state,
    status: state.status,
  });
}

function scheduleWorkingCycle() {
  if (host.loop.isEnabled() && host.loop.snapshot().status === "working") {
    setTimeout(() => void drain(), 0);
  }
}

async function drain() {
  const activeSession = session;
  if (!canDrain(activeSession)) return;
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
    await activeSession.prompt(
      `Review the durable Scribe project revision ${cycle.projectRevision} (draft revision ${cycle.documentRevision}). Read draft.md and relevant Markdown files in sources/. Manage only concrete, high-value suggestions. If no useful work remains for this revision, call wait_for_changes.`,
    );
    if (!host.loop.isEnabled()) return;
    const continueRunning = host.loop.finishCycle();
    host.persist();
    postRuntime(runtime());
    if (!continueRunning) reportLoopPause();
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
      payload: error instanceof Error ? { message: error.message } : error,
      status: "error",
    });
  } finally {
    draining = false;
  }
  scheduleWorkingCycle();
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

function handleControl(message: Extract<AgentParentMessage, { kind: "rpc" }>) {
  controlQueue = controlQueue.then(async () => {
    try {
      const result = message.method === "agent.start"
        ? await startAgent(message.params as ScribeRevision)
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

const handleParentMessage = createAgentParentTransport({
  storage: storageClient,
  handleControl,
  handleProjectChanged: (data) => {
    eventBus.emit(SCRIBE_REVISION_EVENT, {
      projectRevision: data.projectRevision,
      documentRevision: data.documentRevision,
    } satisfies ScribeRevision);
  },
  handleShutdown: () => session?.dispose(),
});

process.parentPort?.on("message", ({ data }: { data: unknown }) => {
  handleParentMessage(data);
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
