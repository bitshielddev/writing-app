import type { RpcRequest, RpcResult } from "../src/shared/contracts.js";

function isRpcRequest(value: unknown): value is RpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RpcRequest>;
  return (
    candidate.kind === "rpc" &&
    typeof candidate.id === "string" &&
    typeof candidate.method === "string"
  );
}

export function createStorageTransport(
  handleRequest: (method: string, params?: unknown) => unknown | Promise<unknown>,
  postMessage: (message: RpcResult) => void,
) {
  return async (value: unknown) => {
    if (!isRpcRequest(value)) return;
    try {
      postMessage({
        kind: "rpc.result",
        id: value.id,
        result: await handleRequest(value.method, value.params),
      });
    } catch (error) {
      postMessage({
        kind: "rpc.result",
        id: value.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
