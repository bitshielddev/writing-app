import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { ChildRpc, ChildStartupError, OperationTimeoutError, type UtilityProcessAdapter } from "./child-rpc";
import {
  AGENT_PROTOCOL_NAME,
  BUILD_IDENTIFIER,
  PROTOCOL_VERSION,
} from "../../contracts/base";
import {
  AgentChildMessageSchema,
  type AgentChildMessage,
} from "../../contracts/process-messages";
import { AgentOperations } from "../../contracts/operations/agent";

/**
 * What: performs the ready step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by child-rpc when that path needs this behavior.
 */
const ready = (overrides: Record<string, unknown> = {}) => ({
  kind: "ready",
  protocolName: AGENT_PROTOCOL_NAME,
  protocolVersion: PROTOCOL_VERSION,
  buildIdentifier: BUILD_IDENTIFIER,
  operations: Object.keys(AgentOperations),
  ...overrides,
});
const scope = { projectId: "project-1", documentId: "document-1" };

class FakeUtilityProcess extends EventEmitter {
  readonly posted: unknown[] = [];
  readonly stderr = new EventEmitter();
  readonly kill = vi.fn(() => true);

  /**
   * What: performs the post message step for this file's workflow.
   *
   * Why: the test needs a focused helper so assertions stay about the behavior under test.
   * Called when: called through FakeUtilityProcess instances when consumers invoke this method.
   */
  postMessage(message: unknown) {
    this.posted.push(message);
  }
}

/**
 * What: creates rpc with the dependencies and defaults this workflow expects.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by child-rpc when that path needs this behavior.
 */
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

    const first = rpc.call("agent.start", { ...scope, projectRevision: 1, documentRevision: 1 });
    const second = rpc.call("agent.stop", scope);
    await Promise.resolve();
    expect(child.posted).toEqual([
      {
        kind: "rpc", protocolVersion: PROTOCOL_VERSION,
        id: "first",
        operation: "agent.start",
        params: { ...scope, projectRevision: 1, documentRevision: 1 },
      },
      {
        kind: "rpc", protocolVersion: PROTOCOL_VERSION,
        id: "second",
        operation: "agent.stop",
        params: scope,
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
    const failed = rpc.call("agent.start", { ...scope, projectRevision: 1, documentRevision: 1 });
    const successful = rpc.call("agent.stop", scope);
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
    const first = rpc.call("agent.stop", scope);
    const second = rpc.call("agent.stop", scope);
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
    await expect(rpc.call("agent.stop", scope)).rejects.toThrow();
    expect(child.posted).toEqual([]);
  });

  it("rejects a malformed ready handshake", async () => {
    const { child, rpc } = createRpc();
    child.emit("message", { kind: "ready", protocolVersion: 1 });
    await expect(rpc.ready).rejects.toEqual(expect.objectContaining({
      code: "MALFORMED_READY_HANDSHAKE",
    }));
  });

  it("times out, cancels, cleans pending state, and ignores a late result", async () => {
    vi.useFakeTimers();
    const { child, rpc } = createRpc();
    child.emit("message", ready());
    const result = rpc.callWithOptions("health.ping", { deadlineMs: 25 });
    const rejection = expect(result).rejects.toBeInstanceOf(OperationTimeoutError);
    await Promise.resolve();
    expect(rpc.pendingCount).toBe(1);
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(rpc.pendingCount).toBe(0);
    expect(child.posted.at(-1)).toMatchObject({ kind: "rpc.cancel", id: "first", operation: "health.ping" });
    child.emit("message", { kind: "rpc.success", protocolVersion: 1, id: "first", operation: "health.ping", result: { respondedAt: 1 } });
    expect(rpc.pendingCount).toBe(0);
    rpc.dispose();
    vi.useRealTimers();
  });

  it("supports AbortSignal cancellation without leaking a pending entry", async () => {
    const { child, rpc } = createRpc();
    child.emit("message", ready());
    const controller = new AbortController();
    const result = rpc.callWithOptions("health.ping", { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: "OPERATION_CANCELLED" });
    expect(rpc.pendingCount).toBe(0);
    rpc.dispose();
  });
});
