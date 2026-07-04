import type { AgentParentMessage } from "../src/shared/contracts.js";

type StorageRequest = {
  kind: "storage.request";
  id: string;
  method: string;
  params?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRevision(value: unknown) {
  return (
    isRecord(value) &&
    Number.isInteger(value.projectRevision) &&
    Number.isInteger(value.documentRevision)
  );
}

function asParentMessage(value: unknown): AgentParentMessage | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  if (value.kind === "shutdown") return { kind: "shutdown" };
  if (value.kind === "storage.result" && typeof value.id === "string") {
    if (value.error !== undefined && typeof value.error !== "string") return undefined;
    return value as AgentParentMessage;
  }
  if (value.kind === "project.changed" && isRevision(value)) {
    return value as AgentParentMessage;
  }
  if (
    value.kind === "rpc" &&
    typeof value.id === "string" &&
    (value.method === "agent.stop" ||
      (value.method === "agent.start" && isRevision(value.params)))
  ) {
    return value as AgentParentMessage;
  }
  return undefined;
}

export class AgentStorageClient {
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(
    private readonly createId: () => string,
    private readonly postMessage: (message: StorageRequest) => void,
  ) {}

  call<T>(method: string, params?: unknown): Promise<T> {
    const id = this.createId();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.postMessage({ kind: "storage.request", id, method, params });
    });
  }

  handleResult(message: Extract<AgentParentMessage, { kind: "storage.result" }>) {
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
  }
}

export function createAgentParentTransport({
  storage,
  handleControl,
  handleProjectChanged,
  handleShutdown,
}: {
  storage: AgentStorageClient;
  handleControl: (message: Extract<AgentParentMessage, { kind: "rpc" }>) => void;
  handleProjectChanged: (
    message: Extract<AgentParentMessage, { kind: "project.changed" }>,
  ) => void;
  handleShutdown: () => void;
}) {
  return (value: unknown) => {
    const message = asParentMessage(value);
    if (!message) return;
    switch (message.kind) {
      case "rpc":
        handleControl(message);
        break;
      case "storage.result":
        storage.handleResult(message);
        break;
      case "project.changed":
        handleProjectChanged(message);
        break;
      case "shutdown":
        handleShutdown();
        break;
    }
  };
}
