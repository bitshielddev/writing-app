import {
  DESKTOP_EVENT_CHANNEL,
  DESKTOP_INVOKE_CHANNELS,
  DEVELOPMENT_SUGGESTION_CHANNEL,
  DesktopEventSchema,
  RendererOperations,
  type OperationName,
  type OperationParams,
  type OperationResult,
  parseOrContractError,
} from "../src/shared/contracts.js";
import type {
  DesktopBridge,
  DesktopDevelopmentBridge,
} from "../src/shared/desktop.js";

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
  return {
    hydrate: () => invoke(ipcRenderer, "hydrate", DESKTOP_INVOKE_CHANNELS.hydrate),
    startAgent: () => invoke(ipcRenderer, "agent.start", DESKTOP_INVOKE_CHANNELS.startAgent),
    stopAgent: () => invoke(ipcRenderer, "agent.stop", DESKTOP_INVOKE_CHANNELS.stopAgent),
    saveDocument: (input) => invoke(ipcRenderer, "document.save", DESKTOP_INVOKE_CHANNELS.saveDocument, input),
    saveSuggestionState: (state) => invoke(ipcRenderer, "suggestions.save", DESKTOP_INVOKE_CHANNELS.saveSuggestionState, state),
    importSource: () => invoke(ipcRenderer, "source.import", DESKTOP_INVOKE_CHANNELS.importSource),
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

export function createDesktopDevelopmentBridge(
  ipcRenderer: PreloadIpcRenderer,
): DesktopDevelopmentBridge {
  return {
    createSuggestion: (item) => invoke(
      ipcRenderer,
      "development.suggestion.create",
      DEVELOPMENT_SUGGESTION_CHANNEL,
      item,
    ),
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
  contextBridge.exposeInMainWorld("scribe", createDesktopBridge(ipcRenderer));
  if (development) {
    contextBridge.exposeInMainWorld(
      "scribeDevelopment",
      createDesktopDevelopmentBridge(ipcRenderer),
    );
  }
}
