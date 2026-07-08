import { describe, expect, it, vi } from "vitest";

import {
  AgentStorageClient,
  createAgentParentTransport,
} from "./agent-transport";
import { createStorageTransport } from "./storage-transport";

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

describe("agent transport", () => {
  it("correlates storage successes and failures", async () => {
    const post = vi.fn();
    const ids = ["one", "two"];
    const storage = new AgentStorageClient(() => ids.shift() ?? "extra", post);
    const scope = { projectId: "project", documentId: "document" };
    const first = storage.call("agent.suggestions.list", scope);
    const second = storage.call("agent.suggestion.retract", { ...scope, id: "suggestion", expectedDocumentRevision: 1 });

    storage.handleResult({ kind: "storage.failure", protocolVersion: 1, id: "two", operation: "agent.suggestion.retract", error: { code: "DENIED", message: "denied", retryable: false } });
    storage.handleResult({ kind: "storage.success", protocolVersion: 1, id: "unknown", operation: "agent.suggestions.list", result: { live: [], pinned: [], workspace: [] } });
    storage.handleResult({ kind: "storage.success", protocolVersion: 1, id: "one", operation: "agent.suggestions.list", result: { live: [], pinned: [], workspace: [] } });

    await expect(first).resolves.toEqual({ live: [], pinned: [], workspace: [] });
    await expect(second).rejects.toThrow("denied");
    expect(post.mock.calls.map((call) => call[0])).toEqual([
      {
        kind: "storage.request", protocolVersion: 1,
        id: "one",
        operation: "agent.suggestions.list",
        params: scope,
      },
      {
        kind: "storage.request", protocolVersion: 1,
        id: "two",
        operation: "agent.suggestion.retract",
        params: { ...scope, id: "suggestion", expectedDocumentRevision: 1 },
      },
    ]);
  });

  it("routes valid parent messages and ignores malformed controls", () => {
    const storage = new AgentStorageClient(() => "id", vi.fn());
    const handleControl = vi.fn();
    const handleProjectChanged = vi.fn();
    const handleShutdown = vi.fn();
    const receive = createAgentParentTransport({
      storage,
      handleControl,
      handleProjectChanged,
      handleShutdown,
      logger: { error: vi.fn() },
    });

    receive({
      kind: "rpc",
      protocolVersion: 1,
      id: "start",
      operation: "agent.start",
      params: { projectId: "project", documentId: "document", projectRevision: 2, documentRevision: 1 },
    });
    receive({
      kind: "project.changed",
      protocolVersion: 1,
      streamId: "document:document",
      sequence: 1,
      projectRevision: 3,
      documentRevision: 2,
    });
    receive({ kind: "shutdown", protocolVersion: 1 });
    receive({ kind: "rpc", id: "bad", method: "agent.start", params: {} });
    receive({ kind: "rpc", id: "bad", method: "unknown" });
    receive({ kind: "unrelated" });

    expect(handleControl).toHaveBeenCalledOnce();
    expect(handleProjectChanged).toHaveBeenCalledOnce();
    expect(handleShutdown).toHaveBeenCalledOnce();
  });
});
