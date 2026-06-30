import { contextBridge, ipcRenderer } from "electron";

import type {
  DesktopBridge,
  DesktopEvent,
  PersistedSuggestionState,
  ProviderSettings,
  SourceSnapshot,
} from "../src/shared/desktop.js";

const bridge: DesktopBridge = {
  hydrate: () => ipcRenderer.invoke("scribe:hydrate"),
  saveDocument: (input) => ipcRenderer.invoke("scribe:document.save", input),
  saveSuggestionState: (state: PersistedSuggestionState) =>
    ipcRenderer.invoke("scribe:suggestions.save", state),
  importSource: (): Promise<SourceSnapshot | undefined> =>
    ipcRenderer.invoke("scribe:source.import"),
  setProvider: (input: ProviderSettings & { apiKey: string }) =>
    ipcRenderer.invoke("scribe:provider.set", input),
  setAgentPaused: (paused: boolean) =>
    ipcRenderer.invoke("scribe:agent.pause", paused),
  considerNow: () => ipcRenderer.invoke("scribe:agent.consider-now"),
  subscribe(listener: (event: DesktopEvent) => void) {
    const handler = (_event: Electron.IpcRendererEvent, payload: DesktopEvent) =>
      listener(payload);
    ipcRenderer.on("scribe:event", handler);
    return () => ipcRenderer.removeListener("scribe:event", handler);
  },
};

contextBridge.exposeInMainWorld("scribe", bridge);
