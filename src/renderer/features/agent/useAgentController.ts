import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentActivity,
  AgentRuntime,
  DesktopBridge,
  DesktopEvent,
} from "../../../contracts/desktop-bridge";

export const AGENT_ACTIVITY_LIMIT = 500;

/**
 * What: performs the initial runtime step for this file's workflow.
 *
 * Why: callers need this behavior in one named place instead of duplicating it.
 * Called when: used by useAgentController when that path needs this behavior.
 */
function initialRuntime(): AgentRuntime {
  return { status: "offline", cycleCount: 0 };
}

/**
 * What: performs the upsert step for this file's workflow.
 *
 * Why: callers need this behavior in one named place instead of duplicating it.
 * Called when: used by useAgentController when that path needs this behavior.
 */
function upsert(items: AgentActivity[], activity: AgentActivity) {
  const index = items.findIndex((item) => item.id === activity.id);
  if (index < 0) return [...items, activity].slice(-AGENT_ACTIVITY_LIMIT);
  const next = [...items];
  next[index] = activity;
  return next;
}
/**
 * What: returns whether the supplied value matches current scope.
 *
 * Why: callers need this behavior in one named place instead of duplicating it.
 * Called when: used by useAgentController when that path needs this behavior.
 */
function isCurrentScope(
  mounted: boolean,
  current: { projectId: string; documentId: string } | undefined,
  operation: { projectId: string; documentId: string },
  generation: number,
  currentGeneration: number,
) {
  return mounted && generation === currentGeneration && current?.projectId === operation.projectId &&
    current.documentId === operation.documentId;
}

/**
 * What: coordinates agent controller state, side effects, and callbacks for the renderer workflow.
 *
 * Why: callers need this behavior in one named place instead of duplicating it.
 * Called when: used by useWorkspaceController and workspaceServices when that path needs this behavior.
 */
export function useAgentController(
  desktop: DesktopBridge,
  scope?: { projectId: string; documentId: string },
) {
  const [runtime, setRuntime] = useState<AgentRuntime>(initialRuntime);
  const [activity, setActivity] = useState<AgentActivity[]>([]);
  const [pending, setPending] = useState<"start" | "stop">();
  const [error, setError] = useState<string>();
  const mountedRef = useRef(true);
  const pendingRef = useRef(false);
  const generationRef = useRef(0);
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
    generationRef.current += 1;
    pendingRef.current = false;
  }, [scope]);

  const initialize = useCallback(
    (nextRuntime: AgentRuntime, nextActivity: AgentActivity[]) => {
      setRuntime(nextRuntime);
      setActivity(nextActivity.slice(-AGENT_ACTIVITY_LIMIT));
      setError(undefined);
      setPending(undefined);
    },
    [],
  );

  const control = useCallback(
    async (command: "start" | "stop") => {
      if (pendingRef.current || !scope) return;
      pendingRef.current = true;
      const operationScope = scope;
      const generation = generationRef.current;
      setPending(command);
      setError(undefined);
      try {
        const next = await (command === "start"
          ? desktop.startAgent(scope)
          : desktop.stopAgent(scope));
        if (isCurrentScope(mountedRef.current, scopeRef.current, operationScope, generation, generationRef.current)) setRuntime(next);
      } catch (cause) {
        if (isCurrentScope(mountedRef.current, scopeRef.current, operationScope, generation, generationRef.current)) {
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
        if (generation === generationRef.current) pendingRef.current = false;
        if (isCurrentScope(mountedRef.current, scopeRef.current, operationScope, generation, generationRef.current)) setPending(undefined);
      }
    },
    [desktop, scope],
  );

  const start = useCallback(() => void control("start"), [control]);
  const stop = useCallback(() => void control("stop"), [control]);
  const stopAndWait = useCallback(() => control("stop"), [control]);
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
    stopAndWait,
    initialize,
    onDesktopEvent,
  };
}
