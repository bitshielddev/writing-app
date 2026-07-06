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
} from "@earendil-works/pi-coding-agent";

import {
  createScribeExtension,
  SCRIBE_REVISION_EVENT,
  SCRIBE_TOOL_NAMES,
  type ScribeExtensionHost,
  type ScribeRevision,
} from "./scribe-extension.js";
import { ScribeLoopState } from "./domain/agent-loop.js";
import { classifyEventSequence } from "./domain/event-sequence.js";
import type { AgentSessionPort } from "./application/agent-session-port.js";
import { PiAgentSessionAdapter } from "./infrastructure/agent/pi-agent-session.js";
import { safeActivityPayload } from "./activity.js";
import type { AgentActivity, AgentRuntime } from "../src/shared/desktop.js";
import {
  PROTOCOL_VERSION,
  BUILD_IDENTIFIER,
  AGENT_PROTOCOL_NAME,
  AGENT_RPC_METHODS,
  AgentActivityMessageSchema,
  AgentRuntimeMessageSchema,
  StorageOperations,
  type AgentRpcRequest,
  type OperationName,
  type OperationArgs,
  type OperationResult,
  toContractError,
  parseOrContractError,
} from "../src/shared/contracts.js";
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
let session: AgentSessionPort | undefined;
let configured = false;
let draining = false;
let activeScope: { projectId: string; documentId: string } | undefined;

const storageClient = new AgentStorageClient(randomUUID, (message) =>
  process.parentPort?.postMessage(message),
);

function storageCall<Name extends OperationName<typeof StorageOperations>>(
  operation: Name,
  ...args: OperationArgs<typeof StorageOperations, Name>
): Promise<OperationResult<typeof StorageOperations, Name>> {
  const first = args[0];
  const scoped = activeScope && (first === undefined || (typeof first === "object" && first !== null))
    ? { ...activeScope, ...(first ?? {}) }
    : first;
  return storageClient.call(operation, ...(scoped === undefined ? [] : [scoped]) as never);
}

function postRuntime(value: AgentRuntime) {
  process.parentPort?.postMessage(parseOrContractError(AgentRuntimeMessageSchema, {
    kind: "agent.runtime",
    protocolVersion: PROTOCOL_VERSION,
    runtime: value,
  }, "agent.outgoing.runtime"));
}

function postActivity(value: Omit<AgentActivity, "updatedAt">) {
  const activity = value.payload === undefined
    ? value
    : { ...value, payload: safeActivityPayload(value.payload) };
  process.parentPort?.postMessage(parseOrContractError(AgentActivityMessageSchema, {
    kind: "agent.activity",
    protocolVersion: PROTOCOL_VERSION,
    activity,
  }, "agent.outgoing.activity"));
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

function runtime() {
  const state = host.loop.snapshot();
  return {
    status: state.status,
    sessionId: session?.id,
    activeRevision: state.activeRevision,
    cycleCount: state.cycleCount,
    error: state.error,
  } satisfies AgentRuntime;
}

function canDrain(
  activeSession: AgentSessionPort | undefined,
): activeSession is AgentSessionPort {
  return Boolean(
    configured &&
      activeSession &&
      host.loop.isEnabled() &&
      !draining &&
      !activeSession.isBusy,
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

async function startAgent(revision: ScribeRevision & { projectId: string; documentId: string }) {
  activeScope = { projectId: revision.projectId, documentId: revision.documentId };
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
    if (session.isBusy) await session.abort();
  }
  return runtime();
}

let controlQueue = Promise.resolve();

function handleControl(message: AgentRpcRequest) {
  controlQueue = controlQueue.then(async () => {
    try {
      const result = message.operation === "agent.start"
        ? await startAgent(message.params)
        : await stopAgent();
      process.parentPort?.postMessage({
        kind: "rpc.success",
        protocolVersion: PROTOCOL_VERSION,
        id: message.id,
        operation: message.operation,
        result,
      });
    } catch (error) {
      process.parentPort?.postMessage({
        kind: "rpc.failure",
        protocolVersion: PROTOCOL_VERSION,
        id: message.id,
        operation: message.operation,
        error: toContractError(error),
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
  session = new PiAgentSessionAdapter(created.session);
  session.subscribeActivity(postActivity);

  const diagnostics = [
    ...settingsManager.drainErrors().map((item) => item.error.message),
    ...authStorage.drainErrors().map((error) => error.message),
    modelRegistry.getError(),
    ...created.extensionsResult.errors.map((item) => item.error),
  ].filter((item): item is string => Boolean(item));
  const activeTools = created.session.getActiveToolNames().sort();
  const expectedTools = ["find", "grep", "ls", "read", ...SCRIBE_TOOL_NAMES].sort();
  if (JSON.stringify(activeTools) !== JSON.stringify(expectedTools)) {
    diagnostics.push(`Unsafe or incomplete Pi tool set: ${activeTools.join(", ")}`);
  }
  if (!created.session.model) diagnostics.push("No Pi model is configured in settings.json or models.json");
  else if (!modelRegistry.hasConfiguredAuth(created.session.model)) {
    diagnostics.push(`No credentials are configured for ${created.session.model.provider}`);
  }

  if (diagnostics.length) {
    configured = false;
    postRuntime({
      status: "offline",
      sessionId: session.id,
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

let observedStreamId: string | undefined;
let observedSequence = 0;

function emitRevision(projectRevision: number, documentRevision: number) {
  eventBus.emit(SCRIBE_REVISION_EVENT, {
    projectRevision,
    documentRevision,
  } satisfies ScribeRevision);
}

const handleParentMessage = createAgentParentTransport({
  storage: storageClient,
  handleControl,
  handleProjectChanged: async (data) => {
    const nextSequence = data.sequence;
    const nextStreamId = data.streamId;
    if (nextStreamId && nextSequence !== undefined) {
      const sequenceDecision = observedStreamId === nextStreamId
        ? classifyEventSequence(observedSequence, nextSequence)
        : "next";
      if (sequenceDecision === "duplicate") return;
      const gap = sequenceDecision === "gap";
      if (gap) {
        if (!activeScope) return;
        const seed = await storageClient.call("agent.seed", activeScope);
        observedStreamId = seed.streamId;
        observedSequence = seed.coveredThroughSequence;
        emitRevision(seed.projectRevision, seed.documentRevision);
        return;
      }
      observedStreamId = nextStreamId;
      observedSequence = nextSequence;
    }
    emitRevision(data.projectRevision, data.documentRevision);
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
  .finally(() => process.parentPort?.postMessage({
    kind: "ready",
    protocolName: AGENT_PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    buildIdentifier: BUILD_IDENTIFIER,
    operations: AGENT_RPC_METHODS,
  }));
