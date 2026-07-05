import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { ChildRpc, ChildStartupError, type UtilityProcessAdapter } from "./child-rpc";
import {
  AGENT_PROTOCOL_NAME,
  AgentChildMessageSchema,
  AgentOperations,
  BUILD_IDENTIFIER,
  PROTOCOL_VERSION,
  type AgentChildMessage,
} from "../src/shared/contracts";

const ready = (overrides: Record<string, unknown> = {}) => ({
  kind: "ready",
  protocolName: AGENT_PROTOCOL_NAME,
  protocolVersion: PROTOCOL_VERSION,
  buildIdentifier: BUILD_IDENTIFIER,
  operations: Object.keys(AgentOperations),
  ...overrides,
});

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
  const rpc = new ChildRpc<typeof AgentOperations, AgentChildMessage>(
    child as unknown as UtilityProcessAdapter,
    () => ids.shift() ?? "extra",
    onMessage,
    vi.fn(),
    AgentOperations,
    AgentChildMessageSchema,
    "test-agent",
  );
  return { child, rpc, onMessage };
}

describe("ChildRpc", () => {
  it("becomes ready once and correlates out-of-order successful results", async () => {
    const { child, rpc } = createRpc();
    child.emit("message", ready());
    child.emit("message", ready());
    await rpc.ready;

    const first = rpc.call("agent.start", { projectRevision: 1, documentRevision: 1 });
    const second = rpc.call("agent.stop");
    await Promise.resolve();
    expect(child.posted).toEqual([
      {
        kind: "rpc", protocolVersion: PROTOCOL_VERSION,
        id: "first",
        operation: "agent.start",
        params: { projectRevision: 1, documentRevision: 1 },
      },
      {
        kind: "rpc", protocolVersion: PROTOCOL_VERSION,
        id: "second",
        operation: "agent.stop",
        params: undefined,
      },
    ]);

    child.emit("message", { kind: "rpc.success", protocolVersion: 1, id: "second", operation: "agent.stop", result: { status: "stopped", cycleCount: 1 } });
    child.emit("message", { kind: "rpc.success", protocolVersion: 1, id: "first", operation: "agent.start", result: { status: "working", cycleCount: 1 } });
    await expect(second).resolves.toMatchObject({ status: "stopped" });
    await expect(first).resolves.toMatchObject({ status: "working" });
  });

  it("rejects only the correlated remote error and ignores unknown responses", async () => {
    const { child, rpc, onMessage } = createRpc();
    child.emit("message", ready());
    const failed = rpc.call("agent.start", { projectRevision: 1, documentRevision: 1 });
    const successful = rpc.call("agent.stop");
    await Promise.resolve();

    child.emit("message", { kind: "rpc.success", protocolVersion: 1, id: "unknown", operation: "agent.stop", result: { status: "stopped", cycleCount: 1 } });
    child.emit("message", { kind: "unrelated" });
    child.emit("message", { kind: "rpc.failure", protocolVersion: 1, id: "first", operation: "agent.start", error: { code: "AGENT_UNAVAILABLE", message: "remote failure", retryable: false } });
    child.emit("message", { kind: "rpc.success", protocolVersion: 1, id: "second", operation: "agent.stop", result: { status: "stopped", cycleCount: 1 } });

    await expect(failed).rejects.toThrow("remote failure");
    await expect(successful).resolves.toMatchObject({ status: "stopped" });
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
      protocolVersion: 1,
      error: {
        code: "DATABASE_TOO_NEW",
        message: "Version 9 is newer than this application",
        retryable: false,
        details: { databasePath: "/workspace/scribe.sqlite3" },
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
    child.emit("message", ready());
    return expect(rpc.ready).resolves.toBeUndefined();
  });

  it("rejects all pending work after exit and cleanup is idempotent", async () => {
    const { child, rpc } = createRpc();
    child.emit("message", ready());
    await rpc.ready;
    const first = rpc.call("agent.stop");
    const second = rpc.call("agent.stop");
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

  it.each([
    ["version", { protocolVersion: 2 }],
    ["build", { buildIdentifier: "different-build" }],
    ["operation set", { operations: ["agent.stop"] }],
  ])("rejects a %s mismatch before sending requests", async (_label, mismatch) => {
    const { child, rpc } = createRpc();
    child.emit("message", ready(mismatch));
    await expect(rpc.ready).rejects.toEqual(expect.objectContaining({
      code: "PROTOCOL_VERSION_MISMATCH",
    }));
    await expect(rpc.call("agent.stop")).rejects.toThrow();
    expect(child.posted).toEqual([]);
  });

  it("rejects a malformed ready handshake", async () => {
    const { child, rpc } = createRpc();
    child.emit("message", { kind: "ready", protocolVersion: 1 });
    await expect(rpc.ready).rejects.toEqual(expect.objectContaining({
      code: "MALFORMED_READY_HANDSHAKE",
    }));
  });
});
