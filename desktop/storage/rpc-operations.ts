import {
  StorageOperations as StorageOperationContracts,
  type OperationParams,
  type StorageRpcMethod,
  parseOrContractError,
} from "../../src/shared/contracts.js";
import type { StorageOperations } from "../application/storage-operations.js";

type Operation = (params?: unknown) => unknown | Promise<unknown>;
type Params<Name extends StorageRpcMethod> = OperationParams<
  typeof StorageOperationContracts,
  Name
>;

function paramsFor<Name extends StorageRpcMethod>(value: unknown): Params<Name> {
  return value as Params<Name>;
}

export function createStorageRequestHandler(operations: StorageOperations) {
  const operationMap = {
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
    "workspace.repair": (params) => operations.repairWorkspace(paramsFor<"workspace.repair">(params)),
    "document.save": (params) => operations.saveDocument(paramsFor<"document.save">(params)),
    "suggestions.command": (params) => operations.executeSuggestionCommand(paramsFor<"suggestions.command">(params)),
    "source.import": (params) => operations.importSource(paramsFor<"source.import">(params)),
    "agent.seed": (params) => operations.getObservationSeed(paramsFor<"agent.seed">(params)),
    "agent.suggestions.list": (params) => operations.listSuggestions(paramsFor<"agent.suggestions.list">(params)),
    "agent.suggestion.create": (params) => operations.createSuggestion(paramsFor<"agent.suggestion.create">(params)),
    "agent.suggestion.update": (params) => operations.updateSuggestion(paramsFor<"agent.suggestion.update">(params)),
    "agent.suggestion.retract": (params) => operations.retractSuggestion(paramsFor<"agent.suggestion.retract">(params)),
    "development.suggestion.create": (params) => operations.createDevelopmentSuggestion(paramsFor<"development.suggestion.create">(params)),
  } satisfies Record<StorageRpcMethod, Operation>;

  return async (method: string, params?: unknown) => {
    if (!Object.prototype.hasOwnProperty.call(operationMap, method)) {
      throw new Error("Unknown storage operation");
    }
    const name = method as StorageRpcMethod;
    const scopedOperations = new Set([
      "hydrate", "events.replay", "events.acknowledge", "workspace.repair",
      "document.save", "suggestions.command", "source.import", "agent.seed",
      "agent.suggestions.list", "agent.suggestion.create", "agent.suggestion.update",
      "agent.suggestion.retract", "development.suggestion.create",
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
