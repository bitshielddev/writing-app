import { describe, expect, it, vi } from "vitest";

import {
  AgentStorageClient,
  createAgentParentTransport,
} from "./agent-transport";
import { createStorageTransport } from "./storage-transport";

describe("storage transport", () => {
  it("correlates successful and failed request envelopes", async () => {
    const handler = vi.fn(async (method: string) => {
      if (method === "fail") throw new Error("handler failed");
      return { method };
    });
    const post = vi.fn();
    const receive = createStorageTransport(handler, post);

    await receive({ kind: "rpc", id: "one", method: "hydrate" });
    await receive({ kind: "rpc", id: "two", method: "fail" });

    expect(post.mock.calls.map((call) => call[0])).toEqual([
      { kind: "rpc.result", id: "one", result: { method: "hydrate" } },
      { kind: "rpc.result", id: "two", error: "handler failed" },
    ]);
  });

  it("ignores malformed and unrelated messages", async () => {
    const handler = vi.fn();
    const receive = createStorageTransport(handler, vi.fn());
    await receive(undefined);
    await receive({ kind: "event" });
    await receive({ kind: "rpc", id: 1, method: "hydrate" });
    await receive({ kind: "rpc", id: "one" });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("agent transport", () => {
  it("correlates storage successes and failures", async () => {
    const post = vi.fn();
    const ids = ["one", "two"];
    const storage = new AgentStorageClient(() => ids.shift() ?? "extra", post);
    const first = storage.call("agent.suggestions.list");
    const second = storage.call("agent.suggestion.create", { item: true });

    storage.handleResult({ kind: "storage.result", id: "two", error: "denied" });
    storage.handleResult({ kind: "storage.result", id: "unknown", result: 0 });
    storage.handleResult({ kind: "storage.result", id: "one", result: [1] });

    await expect(first).resolves.toEqual([1]);
    await expect(second).rejects.toThrow("denied");
    expect(post.mock.calls.map((call) => call[0])).toEqual([
      {
        kind: "storage.request",
        id: "one",
        method: "agent.suggestions.list",
        params: undefined,
      },
      {
        kind: "storage.request",
        id: "two",
        method: "agent.suggestion.create",
        params: { item: true },
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
    });

    receive({
      kind: "rpc",
      id: "start",
      method: "agent.start",
      params: { projectRevision: 2, documentRevision: 1 },
    });
    receive({
      kind: "project.changed",
      projectRevision: 3,
      documentRevision: 2,
    });
    receive({ kind: "shutdown" });
    receive({ kind: "rpc", id: "bad", method: "agent.start", params: {} });
    receive({ kind: "rpc", id: "bad", method: "unknown" });
    receive({ kind: "unrelated" });

    expect(handleControl).toHaveBeenCalledOnce();
    expect(handleProjectChanged).toHaveBeenCalledOnce();
    expect(handleShutdown).toHaveBeenCalledOnce();
  });
});
