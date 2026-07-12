import { describe, expect, it, vi } from "vitest";

import {
  DESKTOP_EVENT_CHANNEL,
  DESKTOP_INVOKE_CHANNELS,
} from "../contracts/operations/renderer";
import type { DesktopEvent } from "../contracts/desktop-bridge";
import {
  createDocumentSaveReceipt,
  createSourceSnapshot,
  createWorkspaceSnapshot,
} from "../test/desktopBridgeHarness";
import {
  createDesktopBridge,
  exposePreloadBridges,
  type PreloadIpcRenderer,
} from "./bridge";

/**
 * What: performs the ipc harness step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by bridge when that path needs this behavior.
 */
function ipcHarness() {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === DESKTOP_INVOKE_CHANNELS.subscribeEvents) return { consumerId: "consumer" };
    if (channel === DESKTOP_INVOKE_CHANNELS.hydrate) return createWorkspaceSnapshot();
    if (channel === DESKTOP_INVOKE_CHANNELS.startAgent) return { status: "working", cycleCount: 1 };
    if (channel === DESKTOP_INVOKE_CHANNELS.stopAgent) return { status: "stopped", cycleCount: 1 };
    if (channel === DESKTOP_INVOKE_CHANNELS.saveDocument) return createDocumentSaveReceipt();
    if (channel === DESKTOP_INVOKE_CHANNELS.executeSuggestionCommand) return {
      commandId: "command", status: "unchanged", suggestionRevision: 0,
      state: { entries: [], pinnedEntries: [], workspacePins: [], seenKeys: {}, nextZIndex: 1 },
    };
    if (channel === DESKTOP_INVOKE_CHANNELS.importSource) return createSourceSnapshot();
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
    const scope = { projectId: "project-1", documentId: "document-1" };
    const saveInput = {
      ...scope,
      blocks: [],
      expectedRevision: 2,
    };
    const suggestionCommand = { commandId: "command", ...scope,
      expectedSuggestionRevision: 0, command: { type: "dismiss" as const, suggestionId: "suggestion" } };

    await bridge.hydrate(scope);
    await bridge.startAgent(scope);
    await bridge.stopAgent(scope);
    await bridge.saveDocument(saveInput);
    await bridge.executeSuggestionCommand(suggestionCommand);
    await bridge.importSource(scope);

    expect(harness.invoke.mock.calls).toEqual([
      [DESKTOP_INVOKE_CHANNELS.subscribeEvents],
      [DESKTOP_INVOKE_CHANNELS.hydrate, scope],
      [DESKTOP_INVOKE_CHANNELS.startAgent, scope],
      [DESKTOP_INVOKE_CHANNELS.stopAgent, scope],
      [DESKTOP_INVOKE_CHANNELS.saveDocument, saveInput],
      [DESKTOP_INVOKE_CHANNELS.executeSuggestionCommand, suggestionCommand],
      [DESKTOP_INVOKE_CHANNELS.importSource, scope],
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

  it("exposes only the desktop bridge by default", () => {
    const harness = ipcHarness();
    const contextBridge = { exposeInMainWorld: vi.fn() };
    exposePreloadBridges({
      contextBridge,
      ipcRenderer: harness.ipc,
    });
    expect(contextBridge.exposeInMainWorld.mock.calls.map((call) => call[0])).toEqual([
      "scribe",
    ]);
  });
});
