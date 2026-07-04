import type { ChildMessage } from "../src/shared/contracts.js";
import type {
  AgentActivity,
  AgentRuntime,
  DesktopEvent,
  ObservationSeed,
} from "../src/shared/desktop.js";

type ProcessEndpoint = {
  call<T>(method: string, params?: unknown): Promise<T>;
  post(message: unknown): void;
};

export function createStorageMessageHandler({
  storage,
  getAgent,
  broadcast,
}: {
  storage: ProcessEndpoint;
  getAgent: () => ProcessEndpoint | undefined;
  broadcast: (event: DesktopEvent) => void;
}) {
  return async (message: ChildMessage) => {
    if (message.kind !== "domain.event") return;
    broadcast(message.event);
    if (message.event.type === "document.saved") {
      getAgent()?.post({
        kind: "project.changed",
        projectRevision: message.event.projectRevision,
        documentRevision: message.event.document.revision,
      });
    } else if (message.event.type === "source.imported") {
      const seed = await storage.call<ObservationSeed>("agent.seed");
      getAgent()?.post({
        kind: "project.changed",
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
  storage: ProcessEndpoint;
  getAgent: () => ProcessEndpoint | undefined;
  setRuntime: (runtime: Partial<AgentRuntime>) => void;
  addActivity: (activity: Omit<AgentActivity, "updatedAt">) => AgentActivity;
  broadcast: (event: DesktopEvent) => void;
}) {
  return async (message: ChildMessage) => {
    if (message.kind === "storage.request") {
      try {
        const result = await storage.call(message.method, message.params);
        getAgent()?.post({
          kind: "storage.result",
          id: message.id,
          result,
        });
      } catch (error) {
        getAgent()?.post({
          kind: "storage.result",
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (message.kind === "agent.runtime") {
      setRuntime(message.runtime);
    } else if (message.kind === "agent.activity") {
      broadcast({ type: "agent.activity", activity: addActivity(message.activity) });
    }
  };
}
