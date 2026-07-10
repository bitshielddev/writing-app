import {
  PROTOCOL_VERSION,
  type OperationCaller,
} from "../../contracts/base.js";
import { StorageOperations } from "../../contracts/operations/storage.js";
import type {
  AgentChildMessage,
  StorageChildMessage,
  StorageForwardResult,
} from "../../contracts/process-messages.js";
import {
  toContractError,
} from "../../contracts/validation.js";
import type {
  AgentActivity,
  AgentActivityInput,
  AgentRuntime,
  DurableEventEnvelope,
  EphemeralDesktopEvent,
} from "../../contracts/desktop-bridge.js";

type PostEndpoint = { post(message: unknown): void };

/**
 * What: creates storage message handler with the dependencies and defaults this workflow expects.
 *
 * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
 * Called when: used by index, start and message-handlers when that path needs this behavior.
 */
export function createStorageMessageHandler({
  storage,
  getAgent,
  broadcast,
}: {
  storage: OperationCaller<typeof StorageOperations>;
  getAgent: () => PostEndpoint | undefined;
  broadcast: (event: DurableEventEnvelope) => void;
}) {
  return async (message: StorageChildMessage) => {
    if (message.kind !== "domain.event") return;
    broadcast(message.event);
    const event = message.event.payload;
    if (event.type === "document.saved") {
      getAgent()?.post({
        kind: "project.changed",
        protocolVersion: PROTOCOL_VERSION,
        streamId: message.event.streamId,
        sequence: message.event.sequence,
        projectRevision: event.projectRevision,
        documentRevision: event.document.revision,
      });
    } else if (event.type === "source.imported") {
      const seed = await storage.call("agent.seed", {
        projectId: event.source.projectId,
        documentId: event.source.documentId,
      });
      getAgent()?.post({
        kind: "project.changed",
        protocolVersion: PROTOCOL_VERSION,
        streamId: message.event.streamId,
        sequence: message.event.sequence,
        projectRevision: seed.projectRevision,
        documentRevision: seed.documentRevision,
      });
    }
  };
}

/**
 * What: creates agent message handler with the dependencies and defaults this workflow expects.
 *
 * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
 * Called when: used by index, start and message-handlers when that path needs this behavior.
 */
export function createAgentMessageHandler({
  storage,
  getAgent,
  setRuntime,
  addActivity,
  broadcast,
}: {
  storage: OperationCaller<typeof StorageOperations>;
  getAgent: () => PostEndpoint | undefined;
  setRuntime: (runtime: Partial<AgentRuntime>) => void;
  addActivity: (activity: AgentActivityInput) => AgentActivity;
  broadcast: (event: EphemeralDesktopEvent) => void;
}) {
  return async (message: AgentChildMessage) => {
    if (message.kind === "storage.request") {
      let response: StorageForwardResult;
      try {
        const result = await storage.call(message.operation, message.params as never);
        response = {
          kind: "storage.success",
          protocolVersion: PROTOCOL_VERSION,
          id: message.id,
          operation: message.operation,
          result,
        } as StorageForwardResult;
      } catch (error) {
        response = {
          kind: "storage.failure",
          protocolVersion: PROTOCOL_VERSION,
          id: message.id,
          operation: message.operation,
          error: toContractError(error),
        } as StorageForwardResult;
      }
      getAgent()?.post(response);
    } else if (message.kind === "agent.runtime") {
      setRuntime(message.runtime);
    } else if (message.kind === "agent.activity") {
      broadcast({ type: "agent.activity", activity: addActivity(message.activity) });
    }
  };
}
