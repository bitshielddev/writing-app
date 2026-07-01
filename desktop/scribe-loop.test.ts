// @vitest-environment node

import { describe, expect, it } from "vitest";

import { ScribeLoopState } from "./scribe-loop";

describe("Scribe autonomous loop", () => {
  it("starts on the durable startup revision and coalesces busy changes", () => {
    const loop = new ScribeLoopState();
    expect(loop.revision(1, 1)).toBe(true);
    expect(loop.beginCycle()).toMatchObject({ projectRevision: 1, documentRevision: 1 });
    loop.revision(2, 2);
    loop.revision(3, 2);
    expect(loop.finishCycle()).toBe(true);
    expect(loop.beginCycle()).toMatchObject({ projectRevision: 3, documentRevision: 2 });
  });

  it("waits after a successful yield", () => {
    const loop = new ScribeLoopState();
    loop.revision(1, 1);
    loop.beginCycle();
    expect(loop.requestYield()).toBe(true);
    expect(loop.finishCycle()).toBe(false);
    expect(loop.snapshot()).toMatchObject({ status: "waiting", yieldedRevision: 1 });
  });

  it("does not yield when a change races the yield cycle", () => {
    const loop = new ScribeLoopState();
    loop.revision(1, 1);
    loop.beginCycle();
    expect(loop.requestYield()).toBe(true);
    loop.revision(2, 2);
    expect(loop.finishCycle()).toBe(true);
    expect(loop.snapshot().status).toBe("working");
  });

  it("caps after five consecutive cycles without a yield or revision", () => {
    const loop = new ScribeLoopState();
    loop.revision(1, 1);
    for (let cycle = 0; cycle < 4; cycle += 1) {
      expect(loop.beginCycle()).toBeTruthy();
      expect(loop.finishCycle()).toBe(true);
    }
    expect(loop.beginCycle()).toBeTruthy();
    expect(loop.finishCycle()).toBe(false);
    expect(loop.snapshot()).toMatchObject({ status: "capped", cycleCount: 5 });
  });

  it("sleeps on error and wakes/reset cycles only for a newer revision", () => {
    const loop = new ScribeLoopState();
    loop.revision(4, 2);
    loop.beginCycle();
    loop.fail("provider unavailable");
    expect(loop.snapshot()).toMatchObject({ status: "error", error: "provider unavailable" });
    expect(loop.revision(4, 2)).toBe(false);
    expect(loop.revision(5, 3)).toBe(true);
    expect(loop.snapshot()).toMatchObject({ status: "working", cycleCount: 0, error: undefined });
  });

  it("restores yielded and loop state without redundant work", () => {
    const first = new ScribeLoopState();
    first.revision(7, 4);
    first.beginCycle();
    first.requestYield();
    first.finishCycle();
    const restored = new ScribeLoopState(first.persisted());

    expect(restored.revision(7, 4)).toBe(false);
    expect(restored.beginCycle()).toBeUndefined();
    expect(restored.snapshot().status).toBe("waiting");
  });
});
