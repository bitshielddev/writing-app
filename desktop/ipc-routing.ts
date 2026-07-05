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

export type MainInvokeEvent = { sender: { id: number } };
export type IpcMainAdapter = {
  handle(channel: string, handler: (event: MainInvokeEvent, ...args: unknown[]) => unknown): void;
};
export type RpcCaller = OperationCaller<typeof StorageOperations> & OperationCaller<typeof AgentOperations>;
export type DialogSelection = { canceled: boolean; filePaths: string[] };
export type OpenDialogAdapter = {
  show(owner: unknown | undefined, options: unknown): Promise<DialogSelection>;
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

  register("hydrate", DESKTOP_INVOKE_CHANNELS.hydrate, async () => {
    const snapshot = parseOrContractError(
      StorageOperations.hydrate.result,
      await storage.call("hydrate"),
      "main.storage.hydrate.result",
    );
    const runtime = { ...snapshot.agent, ...getRuntime() };
    setRuntime(runtime);
    return { ...snapshot, agent: runtime, activity: activitySnapshot() };
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
