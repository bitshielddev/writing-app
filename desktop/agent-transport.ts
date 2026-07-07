import {
  AgentParentMessageSchema,
  PROTOCOL_VERSION,
  RemoteContractError,
  StorageOperations,
  type AgentParentMessage,
  type AgentRpcRequest,
  type OperationArgs,
  type OperationName,
  type OperationResult,
  type StorageForwardRequest,
  type StorageForwardResult,
  parseOrContractError,
} from "../src/shared/contracts.js";

export class AgentStorageClient {
  private readonly pending = new Map<string, {
    operation: OperationName<typeof StorageOperations>;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  constructor(
    private readonly createId: () => string,
    private readonly postMessage: (message: StorageForwardRequest) => void,
  ) {}

  call<Name extends OperationName<typeof StorageOperations>>(
    operation: Name,
    ...args: OperationArgs<typeof StorageOperations, Name>
  ): Promise<OperationResult<typeof StorageOperations, Name>> {
    const params = parseOrContractError(
      StorageOperations[operation].params,
      args[0],
      `agent-to-storage.${operation}.params`,
    );
    const id = this.createId();
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        operation,
        resolve: (value) => resolve(value as OperationResult<typeof StorageOperations, Name>),
        reject,
      });
      this.postMessage({
        kind: "storage.request",
        protocolVersion: PROTOCOL_VERSION,
        id,
        operation,
        params,
      } as StorageForwardRequest);
    });
  }

  handleResult(message: StorageForwardResult) {
    const request = this.pending.get(message.id);
    if (!request || request.operation !== message.operation) return;
    this.pending.delete(message.id);
    if (message.kind === "storage.failure") {
      request.reject(new RemoteContractError(message.error));
      return;
    }
    try {
      request.resolve(parseOrContractError(
        StorageOperations[request.operation].result,
        message.result,
        `agent-to-storage.${request.operation}.result`,
      ));
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error("Invalid storage result"));
    }
  }
}

export function createAgentParentTransport({
  storage,
  handleControl,
  handleProjectChanged,
  handleShutdown,
  handleCancel = () => undefined,
  logger = console,
}: {
  storage: AgentStorageClient;
  handleControl: (message: AgentRpcRequest) => void;
  handleProjectChanged: (
    message: Extract<AgentParentMessage, { kind: "project.changed" }>,
  ) => void;
  handleShutdown: () => void;
  handleCancel?: (id: string) => void;
  logger?: Pick<Console, "error">;
}) {
  return (value: unknown) => {
    let message: AgentParentMessage;
    try {
      message = parseOrContractError(AgentParentMessageSchema, value, "agent.parent-message") as AgentParentMessage;
    } catch (error) {
      logger.error("Rejected invalid agent parent message", error);
      return;
    }
    switch (message.kind) {
      case "rpc":
        handleControl(message);
        break;
      case "storage.success":
      case "storage.failure":
        storage.handleResult(message);
        break;
      case "project.changed":
        handleProjectChanged(message);
        break;
      case "shutdown":
        handleShutdown();
        break;
      case "rpc.cancel":
        handleCancel(message.id);
        break;
    }
  };
}
