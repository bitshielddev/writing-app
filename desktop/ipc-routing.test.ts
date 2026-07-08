import { describe, expect, it, vi } from "vitest";

import { DESKTOP_INVOKE_CHANNELS } from "../src/shared/contracts";
import {
  createDocumentSnapshot,
  createSourceSnapshot,
  createWorkspaceSnapshot,
} from "../src/test/desktopBridgeHarness";
import {
  registerMainIpc,
  type IpcMainAdapter,
  type MainInvokeEvent,
  type RendererEventConsumers,
  type RpcCaller,
} from "./ipc-routing";

function createHarness(eventConsumers?: RendererEventConsumers) {
  const handlers = new Map<
    string,
    (event: MainInvokeEvent, ...args: unknown[]) => unknown
  >();
  const storage = {
    call: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(),
  };
  const agent = {
    call: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(
      async (method) => ({
        status: method === "agent.start" ? "working" : "stopped",
        cycleCount: 2,
      }),
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
        streamId: "document:default-document",
        coveredThroughSequence: 0,
        projectId: "project-1",
        projectName: "Writing project",
        projectRevision: 12,
        documentId: "document-1",
        documentTitle: "Draft",
        documentRevision: 4,
      };
    }
    if (method === "document.save") return createDocumentSnapshot();
    if (method === "suggestions.command") return { commandId: "command", status: "unchanged", suggestionRevision: 0,
      state: { entries: [], pinnedEntries: [], workspacePins: [], seenKeys: {}, nextZIndex: 1 } };
    if (method === "source.import") return createSourceSnapshot();
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
    eventConsumers,
    logger: { error: vi.fn() },
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
    await expect(handler?.({ sender: { id: 999 } })).rejects.toThrow("Unknown renderer");
    expect(harness.storage.call).not.toHaveBeenCalled();
  });

  it("registers every production route and forwards exact methods and arguments", async () => {
    const harness = createHarness();
    const scope = { projectId: "project-1", documentId: "document-1" };
    expect([...harness.handlers.keys()]).toEqual([
      ...Object.values(DESKTOP_INVOKE_CHANNELS),
    ]);

    const hydrated = await harness.invoke(DESKTOP_INVOKE_CHANNELS.hydrate, scope);
    expect(hydrated).toMatchObject({
      project: harness.snapshot.project,
      agent: { status: "working", cycleCount: 2 },
      activity: [{ id: "activity" }],
    });

    await harness.invoke(DESKTOP_INVOKE_CHANNELS.startAgent, scope);
    await harness.invoke(DESKTOP_INVOKE_CHANNELS.stopAgent, scope);
    const saveInput = { ...scope, blocks: [], markdown: "", expectedRevision: 0 };
    await harness.invoke(DESKTOP_INVOKE_CHANNELS.saveDocument, saveInput);
    const command = { commandId: "command", ...scope, expectedSuggestionRevision: 0,
      command: { type: "dismiss", suggestionId: "suggestion" } };
    await harness.invoke(DESKTOP_INVOKE_CHANNELS.executeSuggestionCommand, command);
    await harness.invoke(DESKTOP_INVOKE_CHANNELS.importSource, scope);

    expect(harness.agent.call.mock.calls).toEqual([
      ["agent.start", { ...scope, projectRevision: 12, documentRevision: 4 }],
      ["agent.stop", scope],
    ]);
    expect(harness.storage.call).toHaveBeenCalledWith("document.save", saveInput);
    expect(harness.storage.call).toHaveBeenCalledWith("suggestions.command", command);
    expect(harness.storage.call).toHaveBeenCalledWith("source.import", {
      ...scope, path: "/source.md",
    });
  });

  it("returns undefined when source selection is cancelled", async () => {
    const harness = createHarness();
    harness.dialog.show.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(
      harness.invoke(DESKTOP_INVOKE_CHANNELS.importSource, { projectId: "project-1", documentId: "document-1" }),
    ).resolves.toBeUndefined();
    expect(harness.storage.call).not.toHaveBeenCalledWith(
      "source.import",
      expect.anything(),
    );
  });

  it("requires the renderer-owned subscription identity before acknowledging", async () => {
    let consumerId: string | undefined;
    const eventConsumers: RendererEventConsumers = {
      subscribe: () => consumerId = "consumer-1",
      consumerId: () => consumerId,
      beginHydration: vi.fn(),
      completeHydration: vi.fn(() => true),
    };
    const harness = createHarness(eventConsumers);
    const acknowledgement = {
      projectId: "project-1",
      documentId: "document-1",
      streamId: "document:default-document",
      sequence: 0,
    };

    await expect(harness.invoke(
      DESKTOP_INVOKE_CHANNELS.acknowledgeEvents,
      acknowledgement,
    )).rejects.toThrow("The operation could not be completed");
    expect(harness.storage.call).not.toHaveBeenCalled();

    await expect(harness.invoke(DESKTOP_INVOKE_CHANNELS.subscribeEvents))
      .resolves.toEqual({ consumerId: "consumer-1" });
    harness.storage.call.mockResolvedValueOnce({
      streamId: acknowledgement.streamId,
      acknowledgedSequence: acknowledgement.sequence,
    });
    await harness.invoke(DESKTOP_INVOKE_CHANNELS.acknowledgeEvents, acknowledgement);

    expect(harness.storage.call).toHaveBeenLastCalledWith("events.acknowledge", {
      consumerId: "consumer-1",
      ...acknowledgement,
    });
  });
});
