import { describe, expect, it, vi } from "vitest";

import {
  AgentStorageClient,
  createAgentParentTransport,
} from "./transport";

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
