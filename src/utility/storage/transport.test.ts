import { describe, expect, it, vi } from "vitest";

import { createStorageTransport } from "./transport";

describe("storage transport", () => {
  it("correlates successful and failed request envelopes", async () => {
    const handler = vi.fn(async (method: string) => {
      if (method === "source.import") throw new Error("handler failed");
      return { workspaceRoot: "/w", draftPath: "/w/draft.md", sourcesDirectory: "/w/sources", piDirectory: "/w/.pi", repaired: false };
    });
    const post = vi.fn();
    const receive = createStorageTransport(handler, post, { error: vi.fn() });

    const scope = { projectId: "project", documentId: "document" };
    await receive({ kind: "rpc", protocolVersion: 1, id: "one", operation: "workspace.repair", params: scope });
    await receive({ kind: "rpc", protocolVersion: 1, id: "two", operation: "source.import", params: { ...scope, path: "/source.md" } });

    expect(post.mock.calls.map((call) => call[0])).toEqual([
      { kind: "rpc.success", protocolVersion: 1, id: "one", operation: "workspace.repair", result: { workspaceRoot: "/w", draftPath: "/w/draft.md", sourcesDirectory: "/w/sources", piDirectory: "/w/.pi", repaired: false } },
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
});
