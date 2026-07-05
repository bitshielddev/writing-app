import {
  AgentOperations,
  DESKTOP_INVOKE_CHANNELS,
  DEVELOPMENT_SUGGESTION_CHANNEL,
  RendererOperations,
  StorageOperations,
  type OperationCaller,
  type OperationName,
  type OperationParams,
  type OperationResult,
  parseOrContractError,
  toContractError,
} from "../src/shared/contracts.js";
import type {
  AgentActivity,
  AgentRuntime,
} from "../src/shared/desktop.js";

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
  development,
  getRuntime,
  setRuntime,
  activitySnapshot,
  eventConsumers,
  logger = console,
}: {
  ipcMain: IpcMainAdapter;
  validateSender: (sender: MainInvokeEvent["sender"]) => boolean;
  ownerForSender: (sender: MainInvokeEvent["sender"]) => unknown | undefined;
  dialog: OpenDialogAdapter;
  storage: OperationCaller<typeof StorageOperations>;
  agent: OperationCaller<typeof AgentOperations>;
  development: boolean;
  getRuntime: () => AgentRuntime;
  setRuntime: (runtime: AgentRuntime) => void;
  activitySnapshot: () => AgentActivity[];
  eventConsumers?: RendererEventConsumers;
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

  register("hydrate", DESKTOP_INVOKE_CHANNELS.hydrate, async (event) => {
    eventConsumers?.beginHydration(event.sender.id);
    let snapshot: OperationResult<typeof StorageOperations, "hydrate"> | undefined;
    while (!snapshot) {
      snapshot = parseOrContractError(
        StorageOperations.hydrate.result,
        await storage.call("hydrate"),
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
    return { ...snapshot, agent: runtime, activity: activitySnapshot() };
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

  register("agent.start", DESKTOP_INVOKE_CHANNELS.startAgent, async () => {
    const seed = parseOrContractError(
      StorageOperations["agent.seed"].result,
      await storage.call("agent.seed"),
      "main.storage.agent.seed.result",
    );
    return agent.call("agent.start", parseOrContractError(
      AgentOperations["agent.start"].params,
      { projectRevision: seed.projectRevision, documentRevision: seed.documentRevision },
      "main.agent.start.params",
    ));
  });

  register("agent.stop", DESKTOP_INVOKE_CHANNELS.stopAgent, () =>
    agent.call("agent.stop"));
  register("document.save", DESKTOP_INVOKE_CHANNELS.saveDocument, (_event, input) =>
    storage.call("document.save", input));
  register("suggestions.command", DESKTOP_INVOKE_CHANNELS.executeSuggestionCommand, (_event, input) =>
    storage.call("suggestions.command", input));
  register("source.import", DESKTOP_INVOKE_CHANNELS.importSource, async (event) => {
    const selection = await dialog.show(ownerForSender(event.sender), {
      properties: ["openFile"],
      filters: [{ name: "Writing sources", extensions: ["md", "markdown"] }],
    });
    const path = selection.filePaths[0];
    if (selection.canceled || !path) return undefined;
    return storage.call("source.import", { path });
  });

  if (development) {
    register(
      "development.suggestion.create",
      DEVELOPMENT_SUGGESTION_CHANNEL,
      (_event, item) => storage.call("development.suggestion.create", { item }),
    );
  }
}
