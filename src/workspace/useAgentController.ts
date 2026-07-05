import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentActivity,
  AgentRuntime,
  DesktopBridge,
  DesktopEvent,
} from "../shared/desktop";

export const AGENT_ACTIVITY_LIMIT = 500;

function initialRuntime(): AgentRuntime {
  return { status: "offline", cycleCount: 0 };
}

function upsert(items: AgentActivity[], activity: AgentActivity) {
  const index = items.findIndex((item) => item.id === activity.id);
  if (index < 0) return [...items, activity].slice(-AGENT_ACTIVITY_LIMIT);
  const next = [...items];
  next[index] = activity;
  return next;
}

export function useAgentController(desktop: DesktopBridge) {
  const [runtime, setRuntime] = useState<AgentRuntime>(initialRuntime);
  const [activity, setActivity] = useState<AgentActivity[]>([]);
  const [pending, setPending] = useState<"start" | "stop">();
  const [error, setError] = useState<string>();
  const mountedRef = useRef(true);
  const pendingRef = useRef(false);

  const initialize = useCallback(
    (nextRuntime: AgentRuntime, nextActivity: AgentActivity[]) => {
      setRuntime(nextRuntime);
      setActivity(nextActivity.slice(-AGENT_ACTIVITY_LIMIT));
      setError(undefined);
    },
    [],
  );

  const control = useCallback(
    async (command: "start" | "stop") => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(command);
      setError(undefined);
      try {
        const next = await (command === "start"
          ? desktop.startAgent()
          : desktop.stopAgent());
        if (mountedRef.current) setRuntime(next);
      } catch (cause) {
        if (mountedRef.current) {
          setError(
            cause instanceof Error
              ? cause.message
              : command === "start"
                ? "The agent could not be started"
                : "The agent could not be stopped",
          );
        }
        console.error(`Agent ${command} failed`, cause);
      } finally {
        pendingRef.current = false;
        if (mountedRef.current) setPending(undefined);
      }
    },
    [desktop],
  );

  const start = useCallback(() => void control("start"), [control]);
  const stop = useCallback(() => void control("stop"), [control]);
  const onDesktopEvent = useCallback((event: DesktopEvent) => {
    if (event.type === "agent.runtime") setRuntime(event.runtime);
    if (event.type === "agent.activity") {
      setActivity((current) => upsert(current, event.activity));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    runtime,
    activity,
    pending,
    error,
    start,
    stop,
    initialize,
    onDesktopEvent,
  };
}
