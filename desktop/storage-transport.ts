import {
  PROTOCOL_VERSION,
  StorageOperations,
  StorageRpcRequestSchema,
  type StorageRpcRequest,
  type StorageRpcResult,
  parseOrContractError,
  toContractError,
} from "../src/shared/contracts.js";

export function createStorageTransport(
  handleRequest: (operation: string, params?: unknown) => unknown | Promise<unknown>,
  postMessage: (message: StorageRpcResult) => void,
  logger: Pick<Console, "error"> = console,
) {
  return async (value: unknown) => {
    let request;
    try {
      request = parseOrContractError(
        StorageRpcRequestSchema,
        value,
        "storage.request",
      ) as StorageRpcRequest;
    } catch (error) {
      logger.error("Rejected invalid storage request", error);
      return;
    }
    try {
      const result = parseOrContractError(
        StorageOperations[request.operation].result,
        await handleRequest(request.operation, request.params),
        `storage.${request.operation}.result`,
      );
      postMessage({
        kind: "rpc.success",
        protocolVersion: PROTOCOL_VERSION,
        id: request.id,
        operation: request.operation,
        result,
      } as StorageRpcResult);
    } catch (error) {
      logger.error(`Storage operation failed: ${request.operation}`, error);
      postMessage({
        kind: "rpc.failure",
        protocolVersion: PROTOCOL_VERSION,
        id: request.id,
        operation: request.operation,
        error: toContractError(error),
      });
    }
  };
}
