import { describe, expect, it, vi } from "vitest";

import {
  DESKTOP_EVENT_CHANNEL,
  DESKTOP_INVOKE_CHANNELS,
  DEVELOPMENT_SUGGESTION_CHANNEL,
} from "../src/shared/contracts";
import type { DesktopEvent } from "../src/shared/desktop";
import {
  createDocumentSnapshot,
  createSourceSnapshot,
  createWorkspaceSnapshot,
} from "../src/test/desktopBridgeHarness";
import {
  createDesktopBridge,
  createDesktopDevelopmentBridge,
  exposePreloadBridges,
  type PreloadIpcRenderer,
} from "./preload-bridge";

function ipcHarness() {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === DESKTOP_INVOKE_CHANNELS.subscribeEvents) return { consumerId: "consumer" };
    if (channel === DESKTOP_INVOKE_CHANNELS.hydrate) return createWorkspaceSnapshot();
    if (channel === DESKTOP_INVOKE_CHANNELS.startAgent) return { status: "working", cycleCount: 1 };
    if (channel === DESKTOP_INVOKE_CHANNELS.stopAgent) return { status: "stopped", cycleCount: 1 };
    if (channel === DESKTOP_INVOKE_CHANNELS.saveDocument) return createDocumentSnapshot();
    if (channel === DESKTOP_INVOKE_CHANNELS.executeSuggestionCommand) return {
      commandId: "command", status: "unchanged", suggestionRevision: 0,
      state: { entries: [], pinnedEntries: [], workspacePins: [], seenKeys: {}, nextZIndex: 1 },
    };
    if (channel === DESKTOP_INVOKE_CHANNELS.importSource) return createSourceSnapshot();
    if (channel === DEVELOPMENT_SUGGESTION_CHANNEL) return { accepted: true };
    return undefined;
  });
  const on = vi.fn();
  const removeListener = vi.fn();
  return {
    invoke,
    on,
    removeListener,
    ipc: { invoke, on, removeListener } as PreloadIpcRenderer,
  };
}

describe("preload bridge contract", () => {
  it("maps every renderer operation to its exact invoke channel and arguments", async () => {
    const harness = ipcHarness();
    const bridge = createDesktopBridge(harness.ipc);
    const saveInput = {
      documentId: "document",
      blocks: [],
      markdown: "Draft",
      expectedRevision: 2,
    };
    const suggestionCommand = { commandId: "command", documentId: "document",
      expectedSuggestionRevision: 0, command: { type: "dismiss" as const, suggestionId: "suggestion" } };

    await bridge.hydrate();
    await bridge.startAgent();
    await bridge.stopAgent();
    await bridge.saveDocument(saveInput);
    await bridge.executeSuggestionCommand(suggestionCommand);
    await bridge.importSource();

    expect(harness.invoke.mock.calls).toEqual([
      [DESKTOP_INVOKE_CHANNELS.subscribeEvents],
      [DESKTOP_INVOKE_CHANNELS.hydrate],
      [DESKTOP_INVOKE_CHANNELS.startAgent],
      [DESKTOP_INVOKE_CHANNELS.stopAgent],
      [DESKTOP_INVOKE_CHANNELS.saveDocument, saveInput],
      [DESKTOP_INVOKE_CHANNELS.executeSuggestionCommand, suggestionCommand],
      [DESKTOP_INVOKE_CHANNELS.importSource],
    ]);
  });

  it("forwards only event payloads and removes the identical listener", () => {
    const harness = ipcHarness();
    const bridge = createDesktopBridge(harness.ipc);
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);
    const handler = harness.on.mock.calls[0]?.[1] as (
      event: unknown,
      payload: DesktopEvent,
    ) => void;
    const payload: DesktopEvent = {
      type: "agent.runtime",
      runtime: { status: "waiting", cycleCount: 1 },
    };

    handler({ sender: "electron" }, payload);
    unsubscribe();

    expect(listener).toHaveBeenCalledWith(payload);
    expect(harness.on).toHaveBeenCalledWith(DESKTOP_EVENT_CHANNEL, handler);
    expect(harness.removeListener).toHaveBeenCalledWith(
      DESKTOP_EVENT_CHANNEL,
      handler,
    );
  });

  it("exposes development operations only when explicitly enabled", async () => {
    const harness = ipcHarness();
    const contextBridge = { exposeInMainWorld: vi.fn() };
    exposePreloadBridges({
      contextBridge,
      ipcRenderer: harness.ipc,
      development: false,
    });
    expect(contextBridge.exposeInMainWorld.mock.calls.map((call) => call[0])).toEqual([
      "scribe",
    ]);

    contextBridge.exposeInMainWorld.mockClear();
    exposePreloadBridges({
      contextBridge,
      ipcRenderer: harness.ipc,
      development: true,
    });
    expect(contextBridge.exposeInMainWorld.mock.calls.map((call) => call[0])).toEqual([
      "scribe",
      "scribeDevelopment",
    ]);

    const developmentBridge = createDesktopDevelopmentBridge(harness.ipc);
    const item = {
      id: "suggestion",
      dedupeKey: "suggestion",
      kind: "snippet" as const,
      title: "Title",
      summary: "Summary",
      body: "Body",
      insertText: "Text",
      sourceLabels: [],
      createdAt: 1,
    };
    await developmentBridge.createSuggestion(item);
    expect(harness.invoke).toHaveBeenLastCalledWith(
      DEVELOPMENT_SUGGESTION_CHANNEL,
      item,
    );
  });
});
