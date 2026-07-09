import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import {
  createScribeExtension,
  SCRIBE_REVISION_EVENT,
  SCRIBE_TOOL_NAMES,
  type ScribeExtensionHost,
  type ScribeRevision,
} from "./extension.js";
import { ScribeLoopState } from "./domain/loop.js";
import { classifyEventSequence } from "../../domain/events/sequence.js";
import type { AgentSessionPort } from "./application/session-port.js";
import { createPiAgentRuntime, createPiEventBus } from "./pi/runtime.js";
import { safeActivityPayload } from "../../domain/activity/payload.js";
import type { AgentActivity, AgentRuntime } from "../../contracts/desktop-bridge.js";
import {
  PROTOCOL_VERSION,
  BUILD_IDENTIFIER,
  AGENT_PROTOCOL_NAME,
  type OperationName,
  type OperationArgs,
  type OperationResult,
} from "../../contracts/base.js";
import { AGENT_RPC_METHODS } from "../../contracts/operations/agent.js";
import { StorageOperations } from "../../contracts/operations/storage.js";
import {
  AgentActivityMessageSchema,
  AgentRuntimeMessageSchema,
  type AgentRpcRequest,
} from "../../contracts/process-messages.js";
import {
  toContractError,
  parseOrContractError,
} from "../../contracts/validation.js";
import {
  AgentStorageClient,
  createAgentParentTransport,
} from "./transport.js";

const workspaceRoot = process.argv[2];
const agentDir = process.argv[3];
const sessionDirectory = process.argv[4];
if (!workspaceRoot || !agentDir || !sessionDirectory) {
  throw new Error("Agent process requires workspace, Pi config, and session paths");
}

const eventBus = createPiEventBus();
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
const cancelledControls = new Set<string>();

function handleControl(message: AgentRpcRequest) {
  controlQueue = controlQueue.then(async () => {
    try {
      const result = message.operation === "health.ping"
        ? { respondedAt: Date.now() }
        : message.operation === "agent.start"
          ? await startAgent(message.params)
          : await stopAgent();
      if (cancelledControls.delete(message.id)) return;
      process.parentPort?.postMessage({
        kind: "rpc.success",
        protocolVersion: PROTOCOL_VERSION,
        id: message.id,
        operation: message.operation,
        result,
      });
    } catch (error) {
      if (cancelledControls.delete(message.id)) return;
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
  const created = await createPiAgentRuntime({
    workspaceRoot,
    agentDir,
    sessionDirectory,
    eventBus,
    extensionFactory: createScribeExtension(host),
    scribeToolNames: SCRIBE_TOOL_NAMES,
  });
  session = created.session;
  session.subscribeActivity(postActivity);

  const diagnostics = [...created.diagnostics];

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
  handleShutdown: () => {
    session?.dispose();
    process.exit(0);
  },
  handleCancel: (id) => { cancelledControls.add(id); },
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
