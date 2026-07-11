import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { AgentActivity } from "../../../contracts/desktop-bridge.js";

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

/**
 * What: performs the message parts step for this file's workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by observeMessage when that path needs this behavior.
 */
function messageParts(message: unknown) {
  const record = message as {
    role?: string;
    timestamp?: number;
    content?: string | Array<{ type?: string; text?: string }>;
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
    error: record.errorMessage,
  };
}

/**
 * What: performs the observe lifecycle step for this file's workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by activitiesFromSessionEvent when that path needs this behavior.
 */
function observeLifecycle(event: LifecycleEvent, now: number): ActivityInput[] {
  return [
    {
      id: `lifecycle:${event.type}:${now}`,
      kind: "lifecycle",
      timestamp: now,
      title:
        event.type === "agent_start" ? "Agent cycle started" : "Agent cycle ended",
    },
  ];
}

/**
 * What: performs the observe message step for this file's workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by activitiesFromSessionEvent when that path needs this behavior.
 */
function observeMessage(event: MessageEvent): ActivityInput[] {
  if (event.type !== "message_end") return [];
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
    });
  }
  if (parts.error) {
    activities.push({
      id: `error:${key}`,
      kind: "error",
      timestamp: parts.timestamp,
      title: "Provider error",
      text: parts.error,
      status: "error",
    });
  }
  return activities;
}

/**
 * What: performs the observe tool activity step for this file's workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by activitiesFromSessionEvent when that path needs this behavior.
 */
function observeToolActivity(event: ToolEvent, now: number): ActivityInput[] {
  if (event.type !== "tool_execution_end") return [];
  const failed = Boolean((event as { isError?: boolean }).isError);
  return [
    {
      id: `tool:${event.toolCallId}`,
      kind: "tool",
      timestamp: now,
      title: `${event.toolName} ${failed ? "failed" : "completed"}`,
      ...(failed ? { status: "error" as const } : {}),
    },
  ];
}

/**
 * What: performs the activities from session event step for this file's workflow.
 *
 * Why: agent workflows need coordinated runtime, storage, and activity reporting behavior.
 * Called when: used by session, subscribeActivity and activity when that path needs this behavior.
 */
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
