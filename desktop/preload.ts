import { contextBridge, ipcRenderer } from "electron";

import type {
  DesktopBridge,
  DesktopDevelopmentBridge,
  DesktopEvent,
  PersistedSuggestionState,
  SourceSnapshot,
} from "../src/shared/desktop.js";
import type { SuggestionItem } from "../src/suggestions/types.js";

const bridge: DesktopBridge = {
  hydrate: () => ipcRenderer.invoke("scribe:hydrate"),
  startAgent: () => ipcRenderer.invoke("scribe:agent.start"),
  stopAgent: () => ipcRenderer.invoke("scribe:agent.stop"),
  saveDocument: (input) => ipcRenderer.invoke("scribe:document.save", input),
  saveSuggestionState: (state: PersistedSuggestionState) =>
    ipcRenderer.invoke("scribe:suggestions.save", state),
  importSource: (): Promise<SourceSnapshot | undefined> =>
    ipcRenderer.invoke("scribe:source.import"),
  subscribe(listener: (event: DesktopEvent) => void) {
    const handler = (_event: Electron.IpcRendererEvent, payload: DesktopEvent) =>
      listener(payload);
    ipcRenderer.on("scribe:event", handler);
    return () => ipcRenderer.removeListener("scribe:event", handler);
  },
};

contextBridge.exposeInMainWorld("scribe", bridge);

if (process.argv.includes("--scribe-development")) {
  const developmentBridge: DesktopDevelopmentBridge = {
    createSuggestion: (item: SuggestionItem) =>
      ipcRenderer.invoke("scribe:development.suggestion.create", item),
  };
  contextBridge.exposeInMainWorld("scribeDevelopment", developmentBridge);
}
