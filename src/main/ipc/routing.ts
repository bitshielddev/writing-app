import {
  DESKTOP_INVOKE_CHANNELS,
  RendererOperations,
} from "../../contracts/operations/renderer.js";
import { AgentOperations } from "../../contracts/operations/agent.js";
import { StorageOperations } from "../../contracts/operations/storage.js";
import type {
  OperationCaller,
  OperationName,
  OperationParams,
  OperationResult,
} from "../../contracts/base.js";
import {
  parseOrContractError,
  toContractError,
} from "../../contracts/validation.js";
import type {
  AgentActivity,
  AgentRuntime,
  ProcessHealthSnapshot,
} from "../../contracts/desktop-bridge.js";

export type MainInvokeEvent = { sender: { id: number; send?(channel: string, payload: unknown): void } };
export type IpcMainAdapter = {
  handle(channel: string, handler: (event: MainInvokeEvent, ...args: unknown[]) => unknown): void;
};
export type RpcCaller = OperationCaller<typeof StorageOperations> & OperationCaller<typeof AgentOperations>;
export type DialogSelection = { canceled: boolean; filePaths: string[] };
export type OpenDialogAdapter = {
  show(owner: unknown | undefined, options: unknown): Promise<DialogSelection>;
};
export type RendererEventConsumers = {
  subscribe(sender: MainInvokeEvent["sender"]): string;
  consumerId(senderId: number): string | undefined;
  beginHydration(senderId: number, restart?: boolean): void;
  completeHydration(senderId: number, streamId: string, sequence: number): boolean;
};

export function registerMainIpc({
  ipcMain,
  validateSender,
  ownerForSender,
  dialog,
  storage,
  agent,
  getRuntime,
  setRuntime,
  activitySnapshot,
  eventConsumers,
  onScopeSelected,
  getHealth,
  retryProcess,
  logger = console,
}: {
  ipcMain: IpcMainAdapter;
  validateSender: (sender: MainInvokeEvent["sender"]) => boolean;
  ownerForSender: (sender: MainInvokeEvent["sender"]) => unknown | undefined;
  dialog: OpenDialogAdapter;
  storage: OperationCaller<typeof StorageOperations>;
  agent: OperationCaller<typeof AgentOperations>;
  getRuntime: () => AgentRuntime;
  setRuntime: (runtime: AgentRuntime) => void;
  activitySnapshot: () => AgentActivity[];
  eventConsumers?: RendererEventConsumers;
  onScopeSelected?: (scope: { projectId: string; documentId: string }) => void | Promise<void>;
  getHealth?: () => ProcessHealthSnapshot;
  retryProcess?: (process: "storage" | "agent") => Promise<void>;
  logger?: Pick<Console, "error">;
}) {
  const register = <Name extends OperationName<typeof RendererOperations>>(
    operation: Name,
    channel: string,
    handler: (
      event: MainInvokeEvent,
      params: OperationParams<typeof RendererOperations, Name>,
    ) => OperationResult<typeof RendererOperations, Name> | Promise<OperationResult<typeof RendererOperations, Name>>,
  ) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!validateSender(event.sender)) throw new Error("Unknown renderer");
      try {
        const storageMutations = new Set([
          "project.create", "project.rename", "project.delete", "project.select",
          "document.create", "document.rename", "document.delete", "document.select",
          "document.save", "suggestions.command", "source.import",
        ]);
        if (storageMutations.has(operation) && getHealth && getHealth().storage.state !== "healthy") {
          throw Object.assign(new Error("Storage is unavailable; local changes have been retained"), {
            contract: { code: "STORAGE_UNAVAILABLE", message: "Storage is unavailable; local changes have been retained", retryable: true },
          });
        }
        if ((operation === "agent.start" || operation === "agent.stop") && getHealth && getHealth().agent.state !== "healthy") {
          throw Object.assign(new Error("The writing agent is unavailable"), {
            contract: { code: "AGENT_UNAVAILABLE", message: "The writing agent is unavailable", retryable: true },
          });
        }
        const params = parseOrContractError(
          RendererOperations[operation].params,
          args[0],
          `main-ipc.${operation}.params`,
        ) as OperationParams<typeof RendererOperations, Name>;
        return parseOrContractError(
          RendererOperations[operation].result,
          await handler(event, params),
          `main-ipc.${operation}.result`,
        );
      } catch (error) {
        logger.error(`Renderer operation failed: ${operation}`, error);
        const contract = toContractError(error);
        const external = new Error(contract.message) as Error & { contract?: typeof contract };
        external.name = contract.code;
        external.contract = contract;
        throw external;
      }
    });
  };

  register("events.subscribe", DESKTOP_INVOKE_CHANNELS.subscribeEvents, (event) => ({
    consumerId: eventConsumers?.subscribe(event.sender) ?? `renderer:${event.sender.id}`,
  }));

  register("workspace.catalog", DESKTOP_INVOKE_CHANNELS.workspaceCatalog, () => storage.call("workspace.catalog"));
  register("project.create", DESKTOP_INVOKE_CHANNELS.createProject, async (_event, input) => {
    const result = await storage.call("project.create", input);
    await onScopeSelected?.(result.selection);
    return result;
  });
  register("project.rename", DESKTOP_INVOKE_CHANNELS.renameProject, (_event, input) => storage.call("project.rename", input));
  register("project.delete", DESKTOP_INVOKE_CHANNELS.deleteProject, (_event, input) => storage.call("project.delete", input));
  register("project.select", DESKTOP_INVOKE_CHANNELS.selectProject, async (_event, input) => {
    const result = await storage.call("project.select", input);
    await onScopeSelected?.(result.selection);
    return result;
  });
  register("document.create", DESKTOP_INVOKE_CHANNELS.createDocument, async (_event, input) => {
    const result = await storage.call("document.create", input);
    await onScopeSelected?.(result.selection);
    return result;
  });
  register("document.rename", DESKTOP_INVOKE_CHANNELS.renameDocument, (_event, input) => storage.call("document.rename", input));
  register("document.delete", DESKTOP_INVOKE_CHANNELS.deleteDocument, (_event, input) => storage.call("document.delete", input));
  register("document.select", DESKTOP_INVOKE_CHANNELS.selectDocument, async (_event, input) => {
    const result = await storage.call("document.select", input);
    await onScopeSelected?.(result.selection);
    return result;
  });

  register("hydrate", DESKTOP_INVOKE_CHANNELS.hydrate, async (event, input) => {
    eventConsumers?.beginHydration(event.sender.id);
    let snapshot: OperationResult<typeof StorageOperations, "hydrate"> | undefined;
    while (!snapshot) {
      snapshot = parseOrContractError(
        StorageOperations.hydrate.result,
        await storage.call("hydrate", input),
        "main.storage.hydrate.result",
      );
      const hydrationComplete = !eventConsumers || eventConsumers.completeHydration(
        event.sender.id, snapshot.streamId, snapshot.coveredThroughSequence,
      );
      if (!hydrationComplete) {
        eventConsumers.beginHydration(event.sender.id, true);
        snapshot = undefined;
      }
    }
    const runtime = { ...snapshot.agent, ...getRuntime() };
    setRuntime(runtime);
    return { ...snapshot, agent: runtime, activity: activitySnapshot(), health: getHealth?.() };
  });

  register("events.replay", DESKTOP_INVOKE_CHANNELS.replayEvents, (_event, input) =>
    storage.call("events.replay", input));
  register("events.acknowledge", DESKTOP_INVOKE_CHANNELS.acknowledgeEvents, (event, input) => {
    const consumerId = eventConsumers
      ? eventConsumers.consumerId(event.sender.id)
      : `renderer:${event.sender.id}`;
    if (!consumerId) throw new Error("Renderer must subscribe before acknowledging events");
    return storage.call("events.acknowledge", { consumerId, ...input });
  });

  register("agent.start", DESKTOP_INVOKE_CHANNELS.startAgent, async (_event, input) => {
    const seed = parseOrContractError(
      StorageOperations["agent.seed"].result,
      await storage.call("agent.seed", input),
      "main.storage.agent.seed.result",
    );
    return agent.call("agent.start", parseOrContractError(
      AgentOperations["agent.start"].params,
      { ...input, projectRevision: seed.projectRevision, documentRevision: seed.documentRevision },
      "main.agent.start.params",
    ));
  });

  register("agent.stop", DESKTOP_INVOKE_CHANNELS.stopAgent, (_event, input) =>
    agent.call("agent.stop", input));
  register("document.save", DESKTOP_INVOKE_CHANNELS.saveDocument, (_event, input) =>
    storage.call("document.save", input));
  register("suggestions.command", DESKTOP_INVOKE_CHANNELS.executeSuggestionCommand, (_event, input) =>
    storage.call("suggestions.command", input));
  register("source.import", DESKTOP_INVOKE_CHANNELS.importSource, async (event, input) => {
    const selection = await dialog.show(ownerForSender(event.sender), {
      properties: ["openFile"],
      filters: [{ name: "Writing sources", extensions: ["md", "markdown"] }],
    });
    const path = selection.filePaths[0];
    if (selection.canceled || !path) return undefined;
    return storage.call("source.import", { ...input, path });
  });

  register("process.retry", DESKTOP_INVOKE_CHANNELS.retryProcess, async (_event, input) => {
    await retryProcess?.(input.process);
    if (!getHealth) throw new Error("Process health is unavailable");
    return getHealth();
  });

}
