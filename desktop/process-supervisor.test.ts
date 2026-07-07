import { describe, expect, it, vi } from "vitest";
import { ProcessSupervisor, RESTART_DELAYS_MS } from "./process-supervisor";

function child(ready: Promise<void> = Promise.resolve()) {
  return { ready, kill: vi.fn() };
}

describe("ProcessSupervisor", () => {
  it("uses bounded backoff and enters a stable failed state", async () => {
    let now = 0;
    const delays: number[] = [];
    const health: string[] = [];
    const supervisor = new ProcessSupervisor({
      spawn: () => child(Promise.reject(new Error("crash"))),
      now: () => now,
      delay: async (ms) => { delays.push(ms); now += ms; },
      onHealth: (next) => health.push(next.state),
    });
    await expect(supervisor.start()).rejects.toThrow("crash");
    expect(delays).toEqual([...RESTART_DELAYS_MS]);
    expect(health.at(-1)).toBe("failed");
  });

  it("does not retry non-retryable failures", async () => {
    const supervisor = new ProcessSupervisor({
      spawn: () => child(Promise.reject(new Error("protocol"))),
      delay: async () => undefined,
      classifyRetryable: () => false,
    });
    await expect(supervisor.start()).rejects.toThrow("protocol");
    expect(supervisor.health.state).toBe("failed");
  });

  it("manual retry starts one fresh bounded cycle", async () => {
    let succeeds = false;
    const supervisor = new ProcessSupervisor({
      spawn: () => child(succeeds ? Promise.resolve() : Promise.reject(new Error("down"))),
      delay: async () => undefined,
    });
    await expect(supervisor.start()).rejects.toThrow();
    succeeds = true;
    await supervisor.retry();
    expect(supervisor.health.state).toBe("healthy");
  });
});
