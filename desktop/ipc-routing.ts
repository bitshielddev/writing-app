import {
  DESKTOP_INVOKE_CHANNELS,
  DEVELOPMENT_SUGGESTION_CHANNEL,
} from "../src/shared/contracts.js";
import type {
  AgentActivity,
  AgentRuntime,
  ObservationSeed,
  SourceSnapshot,
  WorkspaceSnapshot,
} from "../src/shared/desktop.js";
import { isSuggestionItem } from "../src/suggestions/validation.js";

export type MainInvokeEvent = { sender: { id: number } };

export type IpcMainAdapter = {
  handle(
    channel: string,
    handler: (event: MainInvokeEvent, ...args: unknown[]) => unknown,
  ): void;
};

export type RpcCaller = {
  call<T>(method: string, params?: unknown): Promise<T>;
};

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
}: {
  ipcMain: IpcMainAdapter;
  validateSender: (sender: MainInvokeEvent["sender"]) => boolean;
  ownerForSender: (sender: MainInvokeEvent["sender"]) => unknown | undefined;
  dialog: OpenDialogAdapter;
  storage: RpcCaller;
  agent: RpcCaller;
  development: boolean;
  getRuntime: () => AgentRuntime;
  setRuntime: (runtime: AgentRuntime) => void;
  activitySnapshot: () => AgentActivity[];
}) {
  const register = (
    channel: string,
    handler: (event: MainInvokeEvent, ...args: unknown[]) => unknown,
  ) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!validateSender(event.sender)) throw new Error("Unknown renderer");
      return handler(event, ...args);
    });
  };

  register(DESKTOP_INVOKE_CHANNELS.hydrate, async () => {
    const snapshot = await storage.call<WorkspaceSnapshot>("hydrate");
    const runtime = { ...snapshot.agent, ...getRuntime() };
    setRuntime(runtime);
    return { ...snapshot, agent: runtime, activity: activitySnapshot() };
  });

  register(DESKTOP_INVOKE_CHANNELS.startAgent, async () => {
    const seed = await storage.call<ObservationSeed>("agent.seed");
    return agent.call<AgentRuntime>("agent.start", {
      projectRevision: seed.projectRevision,
      documentRevision: seed.documentRevision,
    });
  });

  register(DESKTOP_INVOKE_CHANNELS.stopAgent, () =>
    agent.call<AgentRuntime>("agent.stop"),
  );

  register(DESKTOP_INVOKE_CHANNELS.saveDocument, (_event, input) =>
    storage.call("document.save", input),
  );

  register(DESKTOP_INVOKE_CHANNELS.saveSuggestionState, (_event, state) =>
    storage.call("suggestions.save", state),
  );

  register(DESKTOP_INVOKE_CHANNELS.importSource, async (event) => {
    const selection = await dialog.show(ownerForSender(event.sender), {
      properties: ["openFile"],
      filters: [{ name: "Writing sources", extensions: ["md", "markdown"] }],
    });
    const path = selection.filePaths[0];
    if (selection.canceled || !path) return undefined;
    return storage.call<SourceSnapshot>("source.import", { path });
  });

  if (development) {
    register(DEVELOPMENT_SUGGESTION_CHANNEL, (_event, item) => {
      if (!isSuggestionItem(item)) {
        throw new Error("Invalid development suggestion");
      }
      return storage.call("development.suggestion.create", { item });
    });
  }
}
