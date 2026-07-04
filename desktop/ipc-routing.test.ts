import { describe, expect, it, vi } from "vitest";

import {
  DESKTOP_INVOKE_CHANNELS,
  DEVELOPMENT_SUGGESTION_CHANNEL,
} from "../src/shared/contracts";
import { createWorkspaceSnapshot } from "../src/test/desktopBridgeHarness";
import {
  registerMainIpc,
  type IpcMainAdapter,
  type MainInvokeEvent,
  type RpcCaller,
} from "./ipc-routing";

function createHarness(development = true) {
  const handlers = new Map<
    string,
    (event: MainInvokeEvent, ...args: unknown[]) => unknown
  >();
  const storage = {
    call: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(),
  };
  const agent = {
    call: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(
      async (method) => `agent:${method}`,
    ),
  };
  const dialog = {
    show: vi.fn(async () => ({ canceled: false, filePaths: ["/source.md"] })),
  };
  const snapshot = createWorkspaceSnapshot({
    agent: { status: "waiting", cycleCount: 7 },
  });
  storage.call.mockImplementation(async (method: string) => {
    if (method === "hydrate") return snapshot;
    if (method === "agent.seed") {
      return {
        projectRevision: 12,
        documentRevision: 4,
      };
    }
    return `storage:${method}`;
  });
  let runtime = { status: "working" as const, cycleCount: 2 };
  registerMainIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    } as IpcMainAdapter,
    validateSender: (sender) => sender.id === 1,
    ownerForSender: () => ({ id: "window" }),
    dialog,
    storage: storage as unknown as RpcCaller,
    agent: agent as unknown as RpcCaller,
    development,
    getRuntime: () => runtime,
    setRuntime: (next) => {
      runtime = next as typeof runtime;
    },
    activitySnapshot: () => [
      {
        id: "activity",
        kind: "message",
        timestamp: 1,
        updatedAt: 1,
        title: "Activity",
      },
    ],
  });
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Missing handler: ${channel}`);
    return handler({ sender: { id: 1 } }, ...args);
  };
  return { handlers, storage, agent, dialog, invoke, snapshot };
}

describe("main IPC routing", () => {
  it("rejects unknown renderers before invoking a route", async () => {
    const harness = createHarness();
    const handler = harness.handlers.get(DESKTOP_INVOKE_CHANNELS.hydrate);
    expect(() => handler?.({ sender: { id: 999 } })).toThrow("Unknown renderer");
    expect(harness.storage.call).not.toHaveBeenCalled();
  });

  it("registers every production route and forwards exact methods and arguments", async () => {
    const harness = createHarness();
    expect([...harness.handlers.keys()]).toEqual([
      ...Object.values(DESKTOP_INVOKE_CHANNELS),
      DEVELOPMENT_SUGGESTION_CHANNEL,
    ]);

    const hydrated = await harness.invoke(DESKTOP_INVOKE_CHANNELS.hydrate);
    expect(hydrated).toMatchObject({
      project: harness.snapshot.project,
      agent: { status: "working", cycleCount: 2 },
      activity: [{ id: "activity" }],
    });

    await harness.invoke(DESKTOP_INVOKE_CHANNELS.startAgent);
    await harness.invoke(DESKTOP_INVOKE_CHANNELS.stopAgent);
    const saveInput = { documentId: "document", blocks: [] };
    await harness.invoke(DESKTOP_INVOKE_CHANNELS.saveDocument, saveInput);
    const state = { entries: [], pinnedEntries: [] };
    await harness.invoke(DESKTOP_INVOKE_CHANNELS.saveSuggestionState, state);
    await harness.invoke(DESKTOP_INVOKE_CHANNELS.importSource);

    expect(harness.agent.call.mock.calls).toEqual([
      ["agent.start", { projectRevision: 12, documentRevision: 4 }],
      ["agent.stop"],
    ]);
    expect(harness.storage.call).toHaveBeenCalledWith("document.save", saveInput);
    expect(harness.storage.call).toHaveBeenCalledWith("suggestions.save", state);
    expect(harness.storage.call).toHaveBeenCalledWith("source.import", {
      path: "/source.md",
    });
  });

  it("returns undefined when source selection is cancelled", async () => {
    const harness = createHarness();
    harness.dialog.show.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(
      harness.invoke(DESKTOP_INVOKE_CHANNELS.importSource),
    ).resolves.toBeUndefined();
    expect(harness.storage.call).not.toHaveBeenCalledWith(
      "source.import",
      expect.anything(),
    );
  });

  it("validates development suggestions and omits the route in production", async () => {
    const harness = createHarness();
    expect(() =>
      harness.invoke(DEVELOPMENT_SUGGESTION_CHANNEL, { invalid: true }),
    ).toThrow("Invalid development suggestion");
    const item = {
      id: "suggestion",
      dedupeKey: "suggestion",
      kind: "snippet",
      title: "Title",
      summary: "Summary",
      body: "Body",
      insertText: "Text",
      sourceLabels: [],
      createdAt: 1,
    };
    await harness.invoke(DEVELOPMENT_SUGGESTION_CHANNEL, item);
    expect(harness.storage.call).toHaveBeenCalledWith(
      "development.suggestion.create",
      { item },
    );

    const production = createHarness(false);
    expect(production.handlers.has(DEVELOPMENT_SUGGESTION_CHANNEL)).toBe(false);
  });
});
