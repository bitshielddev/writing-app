import {
  DESKTOP_EVENT_CHANNEL,
  DESKTOP_INVOKE_CHANNELS,
  RendererOperations,
} from "../contracts/operations/renderer.js";
import { DesktopEventSchema } from "../contracts/events.js";
import type {
  OperationName,
  OperationParams,
  OperationResult,
} from "../contracts/base.js";
import {
  parseOrContractError,
} from "../contracts/validation.js";
import type { DesktopBridge } from "../contracts/desktop-bridge.js";

export type PreloadIpcRenderer = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
};

export type PreloadContextBridge = {
  exposeInMainWorld(name: string, value: unknown): void;
};

async function invoke<Name extends OperationName<typeof RendererOperations>>(
  ipcRenderer: PreloadIpcRenderer,
  operation: Name,
  channel: string,
  params?: OperationParams<typeof RendererOperations, Name>,
): Promise<OperationResult<typeof RendererOperations, Name>> {
  const definition = RendererOperations[operation];
  const input = parseOrContractError(definition.params, params, `preload.${operation}.params`);
  const result = await (input === undefined
    ? ipcRenderer.invoke(channel)
    : ipcRenderer.invoke(channel, input));
  return parseOrContractError(
    definition.result,
    result,
    `preload.${operation}.result`,
  ) as OperationResult<typeof RendererOperations, Name>;
}

export function createDesktopBridge(ipcRenderer: PreloadIpcRenderer): DesktopBridge {
  let subscription: Promise<{ consumerId: string }> | undefined;
  const subscribeEvents = () => subscription ??= invoke(
    ipcRenderer, "events.subscribe", DESKTOP_INVOKE_CHANNELS.subscribeEvents,
  );
  return {
    subscribeEvents,
    getWorkspaceCatalog: () => invoke(ipcRenderer, "workspace.catalog", DESKTOP_INVOKE_CHANNELS.workspaceCatalog),
    createProject: (input) => invoke(ipcRenderer, "project.create", DESKTOP_INVOKE_CHANNELS.createProject, input),
    renameProject: (input) => invoke(ipcRenderer, "project.rename", DESKTOP_INVOKE_CHANNELS.renameProject, input),
    deleteProject: (input) => invoke(ipcRenderer, "project.delete", DESKTOP_INVOKE_CHANNELS.deleteProject, input),
    selectProject: (input) => invoke(ipcRenderer, "project.select", DESKTOP_INVOKE_CHANNELS.selectProject, input),
    createDocument: (input) => invoke(ipcRenderer, "document.create", DESKTOP_INVOKE_CHANNELS.createDocument, input),
    renameDocument: (input) => invoke(ipcRenderer, "document.rename", DESKTOP_INVOKE_CHANNELS.renameDocument, input),
    deleteDocument: (input) => invoke(ipcRenderer, "document.delete", DESKTOP_INVOKE_CHANNELS.deleteDocument, input),
    selectDocument: (input) => invoke(ipcRenderer, "document.select", DESKTOP_INVOKE_CHANNELS.selectDocument, input),
    hydrate: async (input) => {
      await subscribeEvents();
      return invoke(ipcRenderer, "hydrate", DESKTOP_INVOKE_CHANNELS.hydrate, input);
    },
    replayEvents: (input) => invoke(ipcRenderer, "events.replay", DESKTOP_INVOKE_CHANNELS.replayEvents, input),
    acknowledgeEvents: (input) => invoke(ipcRenderer, "events.acknowledge", DESKTOP_INVOKE_CHANNELS.acknowledgeEvents, input),
    startAgent: (input) => invoke(ipcRenderer, "agent.start", DESKTOP_INVOKE_CHANNELS.startAgent, input),
    stopAgent: (input) => invoke(ipcRenderer, "agent.stop", DESKTOP_INVOKE_CHANNELS.stopAgent, input),
    saveDocument: (input) => invoke(ipcRenderer, "document.save", DESKTOP_INVOKE_CHANNELS.saveDocument, input),
    executeSuggestionCommand: (input) => invoke(ipcRenderer, "suggestions.command", DESKTOP_INVOKE_CHANNELS.executeSuggestionCommand, input),
    importSource: (input) => invoke(ipcRenderer, "source.import", DESKTOP_INVOKE_CHANNELS.importSource, input),
    retryProcess: (input) => invoke(ipcRenderer, "process.retry", DESKTOP_INVOKE_CHANNELS.retryProcess, input),
    subscribe(listener) {
      const handler = (_event: unknown, payload: unknown) => {
        try {
          listener(parseOrContractError(DesktopEventSchema, payload, "preload.desktop-event"));
        } catch (error) {
          console.error("Discarded invalid desktop event", error);
        }
      };
      ipcRenderer.on(DESKTOP_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(DESKTOP_EVENT_CHANNEL, handler);
    },
  };
}

export function exposePreloadBridges({
  contextBridge,
  ipcRenderer,
  testing = false,
}: {
  contextBridge: PreloadContextBridge;
  ipcRenderer: PreloadIpcRenderer;
  testing?: boolean;
}) {
  contextBridge.exposeInMainWorld("scribe", createDesktopBridge(ipcRenderer));
  if (testing) {
    contextBridge.exposeInMainWorld("scribeTest", {
      readiness: () => ipcRenderer.invoke("scribe:test:control", "readiness"),
      terminateStorage: () => ipcRenderer.invoke("scribe:test:control", "terminate-storage"),
      terminateAgent: () => ipcRenderer.invoke("scribe:test:control", "terminate-agent"),
    });
  }
}
