import {
  PROTOCOL_VERSION,
  StorageOperations,
  type AgentChildMessage,
  type OperationCaller,
  type StorageChildMessage,
  type StorageForwardResult,
  toContractError,
} from "../src/shared/contracts.js";
import type {
  AgentActivity,
  AgentActivityInput,
  AgentRuntime,
  DesktopEvent,
} from "../src/shared/desktop.js";

type PostEndpoint = { post(message: unknown): void };

export function createStorageMessageHandler({
  storage,
  getAgent,
  broadcast,
}: {
  storage: OperationCaller<typeof StorageOperations>;
  getAgent: () => PostEndpoint | undefined;
  broadcast: (event: DesktopEvent) => void;
}) {
  return async (message: StorageChildMessage) => {
    if (message.kind !== "domain.event") return;
    broadcast(message.event);
    if (message.event.type === "document.saved") {
      getAgent()?.post({
        kind: "project.changed",
        protocolVersion: PROTOCOL_VERSION,
        projectRevision: message.event.projectRevision,
        documentRevision: message.event.document.revision,
      });
    } else if (message.event.type === "source.imported") {
      const seed = await storage.call("agent.seed");
      getAgent()?.post({
        kind: "project.changed",
        protocolVersion: PROTOCOL_VERSION,
        projectRevision: seed.projectRevision,
        documentRevision: seed.documentRevision,
      });
    }
  };
}

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
  broadcast: (event: DesktopEvent) => void;
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
