import {
  DESKTOP_EVENT_CHANNEL,
  DESKTOP_INVOKE_CHANNELS,
  DEVELOPMENT_SUGGESTION_CHANNEL,
} from "../src/shared/contracts.js";
import type {
  DesktopBridge,
  DesktopDevelopmentBridge,
  DesktopEvent,
} from "../src/shared/desktop.js";

export type PreloadIpcRenderer = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(
    channel: string,
    listener: (event: unknown, payload: DesktopEvent) => void,
  ): unknown;
  removeListener(
    channel: string,
    listener: (event: unknown, payload: DesktopEvent) => void,
  ): unknown;
};

export type PreloadContextBridge = {
  exposeInMainWorld(name: string, value: unknown): void;
};

export function createDesktopBridge(
  ipcRenderer: PreloadIpcRenderer,
): DesktopBridge {
  return {
    hydrate: () => ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.hydrate) as ReturnType<DesktopBridge["hydrate"]>,
    startAgent: () => ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.startAgent) as ReturnType<DesktopBridge["startAgent"]>,
    stopAgent: () => ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.stopAgent) as ReturnType<DesktopBridge["stopAgent"]>,
    saveDocument: (input) =>
      ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.saveDocument, input) as ReturnType<DesktopBridge["saveDocument"]>,
    saveSuggestionState: (state) =>
      ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.saveSuggestionState, state) as ReturnType<DesktopBridge["saveSuggestionState"]>,
    importSource: () =>
      ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.importSource) as ReturnType<DesktopBridge["importSource"]>,
    subscribe(listener) {
      const handler = (_event: unknown, payload: DesktopEvent) => listener(payload);
      ipcRenderer.on(DESKTOP_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(DESKTOP_EVENT_CHANNEL, handler);
    },
  };
}

export function createDesktopDevelopmentBridge(
  ipcRenderer: PreloadIpcRenderer,
): DesktopDevelopmentBridge {
  return {
    createSuggestion: (item) =>
      ipcRenderer.invoke(DEVELOPMENT_SUGGESTION_CHANNEL, item) as ReturnType<DesktopDevelopmentBridge["createSuggestion"]>,
  };
}

export function exposePreloadBridges({
  contextBridge,
  ipcRenderer,
  development,
}: {
  contextBridge: PreloadContextBridge;
  ipcRenderer: PreloadIpcRenderer;
  development: boolean;
}) {
  const bridge = createDesktopBridge(ipcRenderer);
  contextBridge.exposeInMainWorld("scribe", bridge);
  if (development) {
    contextBridge.exposeInMainWorld(
      "scribeDevelopment",
      createDesktopDevelopmentBridge(ipcRenderer),
    );
  }
}
