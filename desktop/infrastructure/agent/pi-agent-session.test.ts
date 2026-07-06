import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

import type { AgentSessionPort } from "../../application/agent-session-port";
import { PiAgentSessionAdapter } from "./pi-agent-session";

describe("Pi agent session adapter", () => {
  it("satisfies the application port without exposing the Pi session", async () => {
    const session = {
      sessionId: "session-1",
      isStreaming: true,
      prompt: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
      dispose: vi.fn(),
      subscribe: vi.fn(),
    } as unknown as AgentSession;
    const adapter: AgentSessionPort = new PiAgentSessionAdapter(session);

    expect(adapter.id).toBe("session-1");
    expect(adapter.isBusy).toBe(true);
    await adapter.prompt("review");
    await adapter.abort();
    adapter.dispose();
    adapter.subscribeActivity(vi.fn());

    expect(session.prompt).toHaveBeenCalledWith("review");
    expect(session.abort).toHaveBeenCalledOnce();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(session.subscribe).toHaveBeenCalledOnce();
  });
});
