import { describe, expect, it, vi } from "vitest";

import { createStorageTransport } from "./transport";

describe("storage transport", () => {
  it("correlates successful and failed request envelopes", async () => {
    const handler = vi.fn(async (method: string) => {
      if (method === "source.import") throw new Error("handler failed");
      return { projectId: "project", documentId: "document", title: "Draft",
        documentRevision: 1, schemaVersion: 1, blocks: [], plainTextBlocks: [] };
    });
    const post = vi.fn();
    const receive = createStorageTransport(handler, post, { error: vi.fn() });

    const scope = { projectId: "project", documentId: "document" };
    await receive({ kind: "rpc", protocolVersion: 1, id: "one", operation: "agent.document.read", params: scope });
    await receive({ kind: "rpc", protocolVersion: 1, id: "two", operation: "source.import", params: { ...scope, path: "/source.md" } });

    expect(post.mock.calls.map((call) => call[0])).toEqual([
      { kind: "rpc.success", protocolVersion: 1, id: "one", operation: "agent.document.read", result: { projectId: "project", documentId: "document", title: "Draft",
        documentRevision: 1, schemaVersion: 1, blocks: [], plainTextBlocks: [] } },
      { kind: "rpc.failure", protocolVersion: 1, id: "two", operation: "source.import", error: { code: "INTERNAL_ERROR", message: "The operation could not be completed", retryable: false } },
    ]);
  });

  it("ignores malformed and unrelated messages", async () => {
    const handler = vi.fn();
    const receive = createStorageTransport(handler, vi.fn(), { error: vi.fn() });
    await receive(undefined);
    await receive({ kind: "event" });
    await receive({ kind: "rpc", protocolVersion: 1, id: 1, operation: "hydrate", params: undefined });
    await receive({ kind: "rpc", protocolVersion: 1, id: "one" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not log stale suggestion revisions as storage failures", async () => {
    const handler = vi.fn(async () => {
      throw new Error("STALE_SUGGESTION_REVISION");
    });
    const post = vi.fn();
    const logger = { error: vi.fn() };
    const receive = createStorageTransport(handler, post, logger);

    await receive({
      kind: "rpc",
      protocolVersion: 1,
      id: "stale",
      operation: "agent.suggestion.retract",
      params: {
        projectId: "project",
        documentId: "document",
        id: "suggestion",
        expectedDocumentRevision: 1,
      },
    });

    expect(logger.error).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith({
      kind: "rpc.failure",
      protocolVersion: 1,
      id: "stale",
      operation: "agent.suggestion.retract",
      error: {
        code: "STALE_SUGGESTION_REVISION",
        message: "The suggestion targets an older document revision",
        retryable: true,
      },
    });
  });
});
