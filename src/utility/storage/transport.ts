import {
  StorageRpcRequestSchema,
  RpcCancelSchema,
  type StorageRpcRequest,
  type StorageRpcResult,
} from "../../contracts/process-messages.js";
import { PROTOCOL_VERSION, type OperationParams } from "../../contracts/base.js";
import {
  StorageOperations as StorageOperationContracts,
  type StorageRpcMethod,
} from "../../contracts/operations/storage.js";
import {
  parseOrContractError,
  toContractError,
} from "../../contracts/validation.js";
import type { StorageOperations } from "./application/operations.js";

/**
 * What: returns whether a failed storage operation should be logged as an error.
 *
 * Why: optimistic concurrency conflicts are part of normal cross-process
 * coordination; callers already receive structured failures and can recover.
 */
function shouldLogStorageFailure(error: unknown) {
  const contract = toContractError(error);
  return contract.code !== "STALE_SUGGESTION_REVISION";
}

/**
 * What: creates storage transport with the dependencies and defaults this workflow expects.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by index, startStorageProcess and transport when that path needs this behavior.
 */
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
        StorageOperationContracts[request.operation].result,
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
      if (shouldLogStorageFailure(error)) {
        logger.error(`Storage operation failed: ${request.operation}`, error);
      }
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

type Operation = (params?: unknown) => unknown | Promise<unknown>;
type Params<Name extends StorageRpcMethod> = OperationParams<
  typeof StorageOperationContracts,
  Name
>;

/**
 * What: performs the params for step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by createStorageRequestHandler when that path needs this behavior.
 */
function paramsFor<Name extends StorageRpcMethod>(value: unknown): Params<Name> {
  return value as Params<Name>;
}

/**
 * What: creates storage request handler with the dependencies and defaults this workflow expects.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by service and createStorageService when that path needs this behavior.
 */
export function createStorageRequestHandler(operations: StorageOperations) {
  const operationMap = {
    "health.ping": () => {
      operations.catalog();
      return { respondedAt: Date.now(), databaseReadable: true };
    },
    "workspace.catalog": () => operations.catalog(),
    "project.create": (params) => operations.createProject(paramsFor<"project.create">(params)),
    "project.rename": (params) => operations.renameProject(paramsFor<"project.rename">(params)),
    "project.delete": (params) => operations.deleteProject(paramsFor<"project.delete">(params)),
    "project.select": (params) => operations.selectProject(paramsFor<"project.select">(params)),
    "document.create": (params) => operations.createDocument(paramsFor<"document.create">(params)),
    "document.rename": (params) => operations.renameDocument(paramsFor<"document.rename">(params)),
    "document.delete": (params) => operations.deleteDocument(paramsFor<"document.delete">(params)),
    "document.select": (params) => operations.selectDocument(paramsFor<"document.select">(params)),
    hydrate: (params) => operations.hydrate(paramsFor<"hydrate">(params)),
    "events.replay": (params) => operations.replayEvents(paramsFor<"events.replay">(params)),
    "events.acknowledge": (params) => operations.acknowledgeEvents(paramsFor<"events.acknowledge">(params)),
    "document.save": (params) => operations.saveDocument(paramsFor<"document.save">(params)),
    "suggestions.command": (params) => operations.executeSuggestionCommand(paramsFor<"suggestions.command">(params)),
    "source.import": (params) => operations.importSource(paramsFor<"source.import">(params)),
    "agent.seed": (params) => operations.getObservationSeed(paramsFor<"agent.seed">(params)),
    "agent.document.read": (params) => operations.readAgentDocument(paramsFor<"agent.document.read">(params)),
    "agent.suggestions.list": (params) => operations.listSuggestions(paramsFor<"agent.suggestions.list">(params)),
    "agent.suggestion.create": (params) => operations.createSuggestion(paramsFor<"agent.suggestion.create">(params)),
    "agent.suggestion.update": (params) => operations.updateSuggestion(paramsFor<"agent.suggestion.update">(params)),
    "agent.suggestion.retract": (params) => operations.retractSuggestion(paramsFor<"agent.suggestion.retract">(params)),
  } satisfies Record<StorageRpcMethod, Operation>;

  return async (method: string, params?: unknown) => {
    if (!Object.prototype.hasOwnProperty.call(operationMap, method)) {
      throw new Error("Unknown storage operation");
    }
    const name = method as StorageRpcMethod;
    const scopedOperations = new Set([
      "hydrate", "events.replay", "events.acknowledge",
      "document.save", "suggestions.command", "source.import", "agent.seed",
      "agent.document.read", "agent.suggestions.list", "agent.suggestion.create", "agent.suggestion.update",
      "agent.suggestion.retract",
    ]);
    if (scopedOperations.has(name)) {
      params = { ...operations.catalog().selection,
        ...(typeof params === "object" && params !== null ? params : {}) };
    }
    const input = parseOrContractError(
      StorageOperationContracts[name].params,
      params,
      `storage.${name}.params`,
    );
    const result = await (operationMap[name] as Operation)(input);
    return parseOrContractError(
      StorageOperationContracts[name].result,
      result,
      `storage.${name}.result`,
    );
  };
}
