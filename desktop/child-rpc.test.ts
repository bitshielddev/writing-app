import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { ChildRpc, ChildStartupError, type UtilityProcessAdapter } from "./child-rpc";

class FakeUtilityProcess extends EventEmitter {
  readonly posted: unknown[] = [];
  readonly stderr = new EventEmitter();
  readonly kill = vi.fn(() => true);

  postMessage(message: unknown) {
    this.posted.push(message);
  }
}

function createRpc(onMessage = vi.fn()) {
  const child = new FakeUtilityProcess();
  const ids = ["first", "second", "third"];
  const rpc = new ChildRpc(
    child as unknown as UtilityProcessAdapter,
    () => ids.shift() ?? "extra",
    onMessage,
    vi.fn(),
  );
  return { child, rpc, onMessage };
}

describe("ChildRpc", () => {
  it("becomes ready once and correlates out-of-order successful results", async () => {
    const { child, rpc } = createRpc();
    child.emit("message", { kind: "ready" });
    child.emit("message", { kind: "ready" });
    await rpc.ready;

    const first = rpc.call<string>("first.method", { value: 1 });
    const second = rpc.call<string>("second.method");
    await Promise.resolve();
    expect(child.posted).toEqual([
      {
        kind: "rpc",
        id: "first",
        method: "first.method",
        params: { value: 1 },
      },
      {
        kind: "rpc",
        id: "second",
        method: "second.method",
        params: undefined,
      },
    ]);

    child.emit("message", { kind: "rpc.result", id: "second", result: "two" });
    child.emit("message", { kind: "rpc.result", id: "first", result: "one" });
    await expect(second).resolves.toBe("two");
    await expect(first).resolves.toBe("one");
  });

  it("rejects only the correlated remote error and ignores unknown responses", async () => {
    const { child, rpc, onMessage } = createRpc();
    child.emit("message", { kind: "ready" });
    const failed = rpc.call("failed");
    const successful = rpc.call("successful");
    await Promise.resolve();

    child.emit("message", { kind: "rpc.result", id: "unknown", result: true });
    child.emit("message", { kind: "unrelated" });
    child.emit("message", { kind: "rpc.result", id: "first", error: "remote failure" });
    child.emit("message", { kind: "rpc.result", id: "second", result: 42 });

    await expect(failed).rejects.toThrow("remote failure");
    await expect(successful).resolves.toBe(42);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("rejects readiness when the process exits during startup", async () => {
    const { child, rpc } = createRpc();
    child.emit("exit", 8);
    await expect(rpc.ready).rejects.toThrow(
      "Utility process exited before startup with code 8",
    );
  });

  it("preserves structured utility-process startup failures", async () => {
    const { child, rpc } = createRpc();
    child.emit("message", {
      kind: "startup.error",
      error: {
        code: "DATABASE_TOO_NEW",
        message: "Version 9 is newer than this application",
        databasePath: "/workspace/scribe.sqlite3",
      },
    });
    await expect(rpc.ready).rejects.toEqual(expect.objectContaining<Partial<ChildStartupError>>({
      code: "DATABASE_TOO_NEW",
      databasePath: "/workspace/scribe.sqlite3",
    }));
  });

  it("ignores malformed structured startup failures", () => {
    const { child, rpc } = createRpc();
    child.emit("message", { kind: "startup.error" });
    child.emit("message", {
      kind: "startup.error",
      error: { code: 5, message: "invalid" },
    });
    child.emit("message", {
      kind: "startup.error",
      error: { code: "DATABASE_CORRUPT", message: "invalid", databasePath: 5 },
    });
    child.emit("message", { kind: "ready" });
    return expect(rpc.ready).resolves.toBeUndefined();
  });

  it("rejects all pending work after exit and cleanup is idempotent", async () => {
    const { child, rpc } = createRpc();
    child.emit("message", { kind: "ready" });
    await rpc.ready;
    const first = rpc.call("one");
    const second = rpc.call("two");
    await Promise.resolve();

    child.emit("exit", 9);
    await expect(first).rejects.toThrow("Utility process exited with code 9");
    await expect(second).rejects.toThrow("Utility process exited with code 9");
    expect(child.listenerCount("message")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.stderr.listenerCount("data")).toBe(0);
    expect(() => {
      rpc.dispose();
      rpc.dispose();
      rpc.kill();
    }).not.toThrow();
  });
});
