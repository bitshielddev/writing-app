import { describe, expect, it, vi } from "vitest";

import { createDocumentSnapshot, createSourceSnapshot } from "../src/test/desktopBridgeHarness";
import {
  createAgentMessageHandler,
  createStorageMessageHandler,
} from "./process-messages";

function endpoint() {
  return {
    call: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(),
    post: vi.fn(),
  };
}

describe("main process message adapters", () => {
  it("forwards storage events and notifies the agent with document revisions", async () => {
    const storage = endpoint();
    const agent = endpoint();
    const broadcast = vi.fn();
    const receive = createStorageMessageHandler({
      storage: storage as never,
      getAgent: () => agent as never,
      broadcast,
    });
    const document = createDocumentSnapshot({ revision: 8 });
    const event = { eventId: "event-1", streamId: "document:default-document",
      sequence: 1, occurredAt: 1,
      payload: { type: "document.saved" as const, document, projectRevision: 13 } };

    await receive({ kind: "domain.event", protocolVersion: 1, event });

    expect(broadcast).toHaveBeenCalledWith(event);
    expect(agent.post).toHaveBeenCalledWith({
      kind: "project.changed",
      protocolVersion: 1,
      streamId: "document:default-document",
      sequence: 1,
      projectRevision: 13,
      documentRevision: 8,
    });
  });

  it("refreshes the observation seed after a source event", async () => {
    const storage = endpoint();
    const agent = endpoint();
    storage.call.mockResolvedValue({ projectRevision: 14, documentRevision: 9 });
    const receive = createStorageMessageHandler({
      storage: storage as never,
      getAgent: () => agent as never,
      broadcast: vi.fn(),
    });

    await receive({
      kind: "domain.event",
      protocolVersion: 1,
      event: {
        eventId: "event-2", streamId: "document:default-document",
        sequence: 2, occurredAt: 2,
        payload: { type: "source.imported",
          source: createSourceSnapshot(), projectRevision: 14 },
      },
    });

    expect(storage.call).toHaveBeenCalledWith("agent.seed");
    expect(agent.post).toHaveBeenCalledWith({
      kind: "project.changed",
      protocolVersion: 1,
      streamId: "document:default-document",
      sequence: 2,
      projectRevision: 14,
      documentRevision: 9,
    });
  });

  it("correlates agent storage requests for success and failure", async () => {
    const storage = endpoint();
    const agent = endpoint();
    storage.call
      .mockResolvedValueOnce({ accepted: true })
      .mockRejectedValueOnce(new Error("storage failed"));
    const receive = createAgentMessageHandler({
      storage: storage as never,
      getAgent: () => agent as never,
      setRuntime: vi.fn(),
      addActivity: vi.fn(),
      broadcast: vi.fn(),
    });

    await receive({
      kind: "storage.request",
      protocolVersion: 1,
      id: "one",
      operation: "agent.suggestion.retract",
      params: { id: "suggestion", expectedDocumentRevision: 1 },
    });
    await receive({
      kind: "storage.request",
      protocolVersion: 1,
      id: "two",
      operation: "agent.suggestions.list",
      params: undefined,
    });

    expect(agent.post.mock.calls.map((call) => call[0])).toEqual([
      { kind: "storage.success", protocolVersion: 1, id: "one", operation: "agent.suggestion.retract", result: { accepted: true } },
      { kind: "storage.failure", protocolVersion: 1, id: "two", operation: "agent.suggestions.list", error: { code: "INTERNAL_ERROR", message: "The operation could not be completed", retryable: false } },
    ]);
  });

  it("forwards runtime and normalized activity exactly once", async () => {
    const storage = endpoint();
    const agent = endpoint();
    const setRuntime = vi.fn();
    const activity = {
      id: "activity",
      kind: "message" as const,
      timestamp: 1,
      updatedAt: 2,
      title: "Message",
    };
    const addActivity = vi.fn(() => activity);
    const broadcast = vi.fn();
    const receive = createAgentMessageHandler({
      storage: storage as never,
      getAgent: () => agent as never,
      setRuntime,
      addActivity,
      broadcast,
    });

    await receive({
      kind: "agent.runtime",
      protocolVersion: 1,
      runtime: { status: "working", cycleCount: 2 },
    });
    await receive({
      kind: "agent.activity",
      protocolVersion: 1,
      activity: {
        id: "activity",
        kind: "message",
        timestamp: 1,
        title: "Message",
      },
    });

    expect(setRuntime).toHaveBeenCalledOnce();
    expect(addActivity).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith({
      type: "agent.activity",
      activity,
    });
  });
});
