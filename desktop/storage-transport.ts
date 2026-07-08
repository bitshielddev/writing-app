import {
  StorageRpcRequestSchema,
  RpcCancelSchema,
  type StorageRpcRequest,
  type StorageRpcResult,
} from "../src/contracts/process-messages.js";
import { PROTOCOL_VERSION } from "../src/contracts/base.js";
import { StorageOperations } from "../src/contracts/operations/storage.js";
import {
  parseOrContractError,
  toContractError,
} from "../src/contracts/validation.js";

export function createStorageTransport(
  handleRequest: (operation: string, params?: unknown) => unknown | Promise<unknown>,
  postMessage: (message: StorageRpcResult) => void,
  logger: Pick<Console, "error"> = console,
) {
  const cancelled = new Set<string>();
  return async (value: unknown) => {
    try {
      const cancel = parseOrContractError(RpcCancelSchema, value, "storage.cancel");
      cancelled.add(cancel.id);
      return;
    } catch { /* a normal request follows */ }
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
      if (cancelled.delete(request.id)) return;
      postMessage({
        kind: "rpc.success",
        protocolVersion: PROTOCOL_VERSION,
        id: request.id,
        operation: request.operation,
        result,
      } as StorageRpcResult);
    } catch (error) {
      if (cancelled.delete(request.id)) return;
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
