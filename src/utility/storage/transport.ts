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

function executeProjectOperation(
  operations: StorageOperations,
  name: StorageRpcMethod,
  params?: unknown,
) {
  switch (name) {
    case "project.create": return operations.createProject(paramsFor<"project.create">(params));
    case "project.rename": return operations.renameProject(paramsFor<"project.rename">(params));
    case "project.delete": return operations.deleteProject(paramsFor<"project.delete">(params));
    case "project.select": return operations.selectProject(paramsFor<"project.select">(params));
    default: throw new Error("Unknown project operation");
  }
}

function executeDocumentOperation(
  operations: StorageOperations,
  name: StorageRpcMethod,
  params?: unknown,
) {
  switch (name) {
    case "document.create": return operations.createDocument(paramsFor<"document.create">(params));
    case "document.rename": return operations.renameDocument(paramsFor<"document.rename">(params));
    case "document.delete": return operations.deleteDocument(paramsFor<"document.delete">(params));
    case "document.select": return operations.selectDocument(paramsFor<"document.select">(params));
    case "document.save": return operations.saveDocument(paramsFor<"document.save">(params));
    default: throw new Error("Unknown document operation");
  }
}

function executeEventOperation(
  operations: StorageOperations,
  name: StorageRpcMethod,
  params?: unknown,
) {
  switch (name) {
    case "events.replay": return operations.replayEvents(paramsFor<"events.replay">(params));
    case "events.acknowledge": return operations.acknowledgeEvents(paramsFor<"events.acknowledge">(params));
    default: throw new Error("Unknown event operation");
  }
}

function executeAgentSuggestionOperation(
  operations: StorageOperations,
  name: StorageRpcMethod,
  params?: unknown,
) {
  switch (name) {
    case "agent.suggestion.create": return operations.createSuggestion(paramsFor<"agent.suggestion.create">(params));
    case "agent.suggestion.update": return operations.updateSuggestion(paramsFor<"agent.suggestion.update">(params));
    case "agent.suggestion.retract": return operations.retractSuggestion(paramsFor<"agent.suggestion.retract">(params));
    default: throw new Error("Unknown agent suggestion operation");
  }
}

/**
 * What: creates storage request handler with the dependencies and defaults this workflow expects.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by service and createStorageService when that path needs this behavior.
 */
export function createStorageRequestHandler(operations: StorageOperations) {
  function executeOperation(name: StorageRpcMethod, params?: unknown) {
    if (name.startsWith("project.")) {
      return executeProjectOperation(operations, name, params);
    }
    if (name.startsWith("document.")) {
      return executeDocumentOperation(operations, name, params);
    }
    if (name.startsWith("events.")) {
      return executeEventOperation(operations, name, params);
    }
    if (name.startsWith("agent.suggestion.")) {
      return executeAgentSuggestionOperation(operations, name, params);
    }
    switch (name) {
    case "health.ping": {
      operations.catalog();
      return { respondedAt: Date.now(), databaseReadable: true };
    }
    case "workspace.catalog": return operations.catalog();
    case "hydrate": return operations.hydrate(paramsFor<"hydrate">(params));
    case "suggestions.command": return operations.executeSuggestionCommand(paramsFor<"suggestions.command">(params));
    case "source.import": return operations.importSource(paramsFor<"source.import">(params));
    case "agent.seed": return operations.getObservationSeed(paramsFor<"agent.seed">(params));
    case "agent.document.read": return operations.readAgentDocument(paramsFor<"agent.document.read">(params));
    case "agent.suggestions.list": return operations.listSuggestions(paramsFor<"agent.suggestions.list">(params));
    default: throw new Error("Unknown storage operation");
    }
  }

  return async (method: string, params?: unknown) => {
    if (!Object.prototype.hasOwnProperty.call(StorageOperationContracts, method)) {
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
    const result = await executeOperation(name, input);
    return parseOrContractError(
      StorageOperationContracts[name].result,
      result,
      `storage.${name}.result`,
    );
  };
}
