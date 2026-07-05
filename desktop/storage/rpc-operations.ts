import {
  StorageOperations as StorageOperationContracts,
  type StorageRpcMethod,
  parseOrContractError,
} from "../../src/shared/contracts.js";
import type { StorageOperations } from "./operations.js";

type Operation = (params?: unknown) => unknown | Promise<unknown>;

export function createStorageRequestHandler(operations: StorageOperations) {
  const operationMap = {
    hydrate: () => operations.hydrate(),
    "workspace.repair": () => operations.repairWorkspace(),
    "document.save": (params) => operations.saveDocument(params),
    "suggestions.command": (params) => operations.executeSuggestionCommand(params),
    "source.import": (params) => operations.importSource(params),
    "agent.seed": () => operations.getObservationSeed(),
    "agent.suggestions.list": () => operations.listSuggestions(),
    "agent.suggestion.create": (params) => operations.createSuggestion(params),
    "agent.suggestion.update": (params) => operations.updateSuggestion(params),
    "agent.suggestion.retract": (params) => operations.retractSuggestion(params),
    "development.suggestion.create": (params) => operations.createDevelopmentSuggestion(params),
  } satisfies Record<StorageRpcMethod, Operation>;

  return async (method: string, params?: unknown) => {
    if (!Object.prototype.hasOwnProperty.call(operationMap, method)) {
      throw new Error("Unknown storage operation");
    }
    const name = method as StorageRpcMethod;
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
