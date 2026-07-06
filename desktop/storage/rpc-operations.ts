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
    hydrate: () => operations.hydrate(),
    "events.replay": (params) => operations.replayEvents(paramsFor<"events.replay">(params)),
    "events.acknowledge": (params) => operations.acknowledgeEvents(paramsFor<"events.acknowledge">(params)),
    "workspace.repair": () => operations.repairWorkspace(),
    "document.save": (params) => operations.saveDocument(paramsFor<"document.save">(params)),
    "suggestions.command": (params) => operations.executeSuggestionCommand(paramsFor<"suggestions.command">(params)),
    "source.import": (params) => operations.importSource(paramsFor<"source.import">(params)),
    "agent.seed": () => operations.getObservationSeed(),
    "agent.suggestions.list": () => operations.listSuggestions(),
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
