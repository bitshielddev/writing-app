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

  it("separates message text, reasoning, and provider errors", () => {
    const activities = activitiesFromSessionEvent({
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
    } as unknown as AgentSessionEvent);

    expect(activities.map((activity) => activity.kind)).toEqual([
      "message",
      "reasoning",
      "error",
    ]);
    expect(activities.map((activity) => activity.text)).toEqual([
      "Answer",
      "Reasoning",
      "Provider failed",
    ]);
  });

  it("keeps one stable activity identity through tool updates", () => {
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

    expect(running[0]).toMatchObject({
      id: "tool:call-1",
      title: "read running",
    });
    expect(completed[0]).toMatchObject({
      id: "tool:call-1",
      title: "read completed",
    });
  });
});
