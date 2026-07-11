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

/**
 * What: performs the storage call step for this file's workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by index when that path needs this behavior.
 */
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

/**
 * What: performs the post runtime step for this file's workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by runtime, drain, startAgent and stopAgent when that path needs this behavior.
 */
function postRuntime(value: AgentRuntime) {
  process.parentPort?.postMessage(parseOrContractError(AgentRuntimeMessageSchema, {
    kind: "agent.runtime",
    protocolVersion: PROTOCOL_VERSION,
    runtime: value,
  }, "agent.outgoing.runtime"));
}

/**
 * What: performs the post activity step for this file's workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by index, reportLoopPause, drain and startAgent when that path needs this behavior.
 */
function postActivity(value: Omit<AgentActivity, "updatedAt">) {
  process.parentPort?.postMessage(parseOrContractError(AgentActivityMessageSchema, {
    kind: "agent.activity",
    protocolVersion: PROTOCOL_VERSION,
    activity: value,
  }, "agent.outgoing.activity"));
}

const host: ScribeExtensionHost = {
  loop: new ScribeLoopState(),
  storageCall,
  /**
   * What: performs the runtime step for this file's workflow.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by extension, createScribeExtension, host and project-session when that path needs this behavior.
   */
  runtime() {
    if (!configured) return;
    postRuntime(runtime());
  },
  activity: postActivity,
  /**
   * What: performs the wake step for this file's workflow.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by extension, executeSuggestionMutation, createScribeExtension and host when that path needs this behavior.
   */
  wake() {
    setTimeout(() => void drain(), 0);
  },
  /**
   * What: performs the persist step for this file's workflow.
   *
   * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
   * Called when: used by extension, createScribeExtension, host and drain when that path needs this behavior.
   */
  persist() {},
};

/**
 * What: performs the runtime step for this file's workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by drain, startAgent, stopAgent and initialize when that path needs this behavior.
 */
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

/**
 * What: returns whether the caller can perform drain.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by drain when that path needs this behavior.
 */
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

/**
 * What: performs the report loop pause step for this file's workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by drain when that path needs this behavior.
 */
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
    status: state.status,
  });
}

/**
 * What: performs the schedule working cycle step for this file's workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by drain when that path needs this behavior.
 */
function scheduleWorkingCycle() {
  if (host.loop.isEnabled() && host.loop.snapshot().status === "working") {
    setTimeout(() => void drain(), 0);
  }
}

/**
 * What: performs the drain step for this file's workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by wake and scheduleWorkingCycle when that path needs this behavior.
 */
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
    status: "working",
  });
  try {
    await activeSession.prompt(
      `Review the durable Scribe project revision ${cycle.projectRevision} (document revision ${cycle.documentRevision}). Call read_document for the current BlockNote document and read relevant Markdown files in sources/. Manage only concrete, high-value suggestions. If no useful work remains for this revision, call wait_for_changes.`,
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
      status: "error",
    });
  } finally {
    draining = false;
  }
  scheduleWorkingCycle();
}

/**
 * What: starts agent and wires the dependencies it needs.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by handleControl when that path needs this behavior.
 */
async function startAgent(revision: ScribeRevision & { projectId: string; documentId: string }) {
  activeScope = { projectId: revision.projectId, documentId: revision.documentId };
  if (!configured || !session) {
    throw new Error("The agent is unavailable because Pi is not configured");
  }
  host.loop.revision(revision.projectRevision, revision.documentRevision);
  if (host.loop.start()) {
    const timestamp = Date.now();
    host.documentReadRevision = undefined;
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

/**
 * What: stops agent and releases owned resources.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by handleControl when that path needs this behavior.
 */
async function stopAgent() {
  if (!configured || !session) {
    throw new Error("The agent is unavailable because Pi is not configured");
  }
  if (host.loop.stop()) {
    const timestamp = Date.now();
    host.documentReadRevision = undefined;
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

/**
 * What: handles control and routes the effect to the owning workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by index when that path needs this behavior.
 */
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

/**
 * What: performs the initialize step for this file's workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by index when that path needs this behavior.
 */
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

/**
 * What: emits revision to subscribers or the host runtime.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by index when that path needs this behavior.
 */
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
