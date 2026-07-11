// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import { activitiesFromSessionEvent } from "./activity";

describe("agent session activity conversion", () => {
  it("converts lifecycle events", () => {
    const activities = activitiesFromSessionEvent(
      { type: "agent_start" } as unknown as AgentSessionEvent,
      100,
    );

    expect(activities).toEqual([
      expect.objectContaining({
        id: "lifecycle:agent_start:100",
        kind: "lifecycle",
        title: "Agent cycle started",
      }),
    ]);
  });

  it("ignores streaming message updates", () => {
    expect(activitiesFromSessionEvent({
      type: "message_update",
      message: {
        role: "assistant",
        timestamp: 200,
        content: [
          { type: "text", text: "Answer" },
          { type: "thinking", thinking: "Reasoning" },
        ],
        errorMessage: "Provider failed",
      },
    } as unknown as AgentSessionEvent)).toEqual([]);
  });

  it("keeps final message text and provider errors without reasoning or payload", () => {
    const activities = activitiesFromSessionEvent({
      type: "message_end",
      message: {
        role: "assistant",
        timestamp: 200,
        content: [
          { type: "text", text: "Answer" },
          { type: "thinking", thinking: "Reasoning" },
        ],
        errorMessage: "Provider failed",
      },
    } as unknown as AgentSessionEvent);
    expect(activities.map((activity) => activity.kind)).toEqual([
      "message",
      "error",
    ]);
    expect(activities.map((activity) => activity.text)).toEqual([
      "Answer",
      "Provider failed",
    ]);
    expect(activities).toEqual([
      expect.not.objectContaining({ payload: expect.anything() }),
      expect.not.objectContaining({ payload: expect.anything() }),
    ]);
  });

  it("emits only final tool activity", () => {
    const running = activitiesFromSessionEvent({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read",
    } as unknown as AgentSessionEvent, 300);
    const completed = activitiesFromSessionEvent({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
    } as unknown as AgentSessionEvent, 400);

    expect(running).toEqual([]);
    expect(completed[0]).toMatchObject({
      id: "tool:call-1",
      title: "read completed",
    });
    expect(completed[0]).not.toHaveProperty("payload");
  });

  it("marks final tool errors without retaining raw results", () => {
    const failed = activitiesFromSessionEvent({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      isError: true,
      result: { body: "large raw output" },
    } as unknown as AgentSessionEvent, 400);

    expect(failed).toEqual([
      expect.objectContaining({
        id: "tool:call-1",
        kind: "tool",
        title: "read failed",
        status: "error",
      }),
    ]);
    expect(failed[0]).not.toHaveProperty("payload");
    expect(failed[0]).not.toHaveProperty("text");
  });
});
