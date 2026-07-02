import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { AgentActivity } from "../src/shared/desktop.js";

type ActivityInput = Omit<AgentActivity, "updatedAt">;
type LifecycleEvent = Extract<
  AgentSessionEvent,
  { type: "agent_start" | "agent_end" }
>;
type MessageEvent = Extract<
  AgentSessionEvent,
  { type: "message_start" | "message_update" | "message_end" }
>;
type ToolEvent = Extract<
  AgentSessionEvent,
  {
    type:
      | "tool_execution_start"
      | "tool_execution_update"
      | "tool_execution_end";
  }
>;

function serializable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return { unavailable: true };
  }
}

function messageParts(message: unknown) {
  const record = message as {
    role?: string;
    timestamp?: number;
    content?: string | Array<{ type?: string; text?: string; thinking?: string }>;
    errorMessage?: string;
  };
  const content = typeof record.content === "string" ? [] : (record.content ?? []);
  return {
    role: record.role ?? "message",
    timestamp: record.timestamp ?? Date.now(),
    text:
      typeof record.content === "string"
        ? record.content
        : content
            .filter((part) => part.type === "text")
            .map((part) => part.text ?? "")
            .join(""),
    reasoning: content
      .filter((part) => part.type === "thinking")
      .map((part) => part.thinking ?? "")
      .join(""),
    error: record.errorMessage,
  };
}

function observeLifecycle(event: LifecycleEvent, now: number): ActivityInput[] {
  return [
    {
      id: `lifecycle:${event.type}:${now}`,
      kind: "lifecycle",
      timestamp: now,
      title:
        event.type === "agent_start" ? "Agent cycle started" : "Agent cycle ended",
      payload: serializable(event),
    },
  ];
}

function observeMessage(event: MessageEvent): ActivityInput[] {
  const parts = messageParts(event.message);
  const key = `${parts.role}:${parts.timestamp}`;
  const activities: ActivityInput[] = [];
  if (parts.text) {
    activities.push({
      id: `message:${key}`,
      kind: "message",
      timestamp: parts.timestamp,
      title: `${parts.role} message`,
      text: parts.text,
      payload: serializable(event),
    });
  }
  if (parts.reasoning) {
    activities.push({
      id: `reasoning:${key}`,
      kind: "reasoning",
      timestamp: parts.timestamp,
      title: "Model reasoning",
      text: parts.reasoning,
      payload: serializable(event),
    });
  }
  if (parts.error) {
    activities.push({
      id: `error:${key}`,
      kind: "error",
      timestamp: parts.timestamp,
      title: "Provider error",
      text: parts.error,
      payload: serializable(event),
      status: "error",
    });
  }
  return activities;
}

function observeToolActivity(event: ToolEvent, now: number): ActivityInput[] {
  return [
    {
      id: `tool:${event.toolCallId}`,
      kind: "tool",
      timestamp: now,
      title: `${event.toolName} ${
        event.type === "tool_execution_end" ? "completed" : "running"
      }`,
      payload: serializable(event),
    },
  ];
}

export function activitiesFromSessionEvent(
  event: AgentSessionEvent,
  now = Date.now(),
): ActivityInput[] {
  switch (event.type) {
    case "agent_start":
    case "agent_end":
      return observeLifecycle(event, now);
    case "message_start":
    case "message_update":
    case "message_end":
      return observeMessage(event);
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
      return observeToolActivity(event, now);
    default:
      return [];
  }
}
