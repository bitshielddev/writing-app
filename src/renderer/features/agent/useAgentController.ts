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
/**
 * What: applies several activity updates in one bounded state transition.
 *
 * Why: agent milestones can still arrive in bursts and should not force one React render per event.
 * Called when: used by useAgentController when flushing queued desktop activity.
 */
function upsertMany(items: AgentActivity[], activities: AgentActivity[]) {
  const byId = new Map(items.map((item, index) => [item.id, index]));
  const next = [...items];
  for (const activity of activities) {
    const index = byId.get(activity.id);
    if (index === undefined) {
      byId.set(activity.id, next.length);
      next.push(activity);
    } else {
      next[index] = activity;
    }
  }
  return next.slice(-AGENT_ACTIVITY_LIMIT);
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
  const activityQueueRef = useRef<AgentActivity[]>([]);
  const activityFrameRef = useRef<number | undefined>(undefined);
  const activityFallbackRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelActivityFlush = useCallback(() => {
    if (
      activityFrameRef.current !== undefined &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(activityFrameRef.current);
    }
    if (activityFallbackRef.current !== undefined) {
      clearTimeout(activityFallbackRef.current);
    }
    activityFrameRef.current = undefined;
    activityFallbackRef.current = undefined;
  }, []);

  const flushActivity = useCallback(() => {
    cancelActivityFlush();
    const queued = activityQueueRef.current;
    if (!queued.length) return;
    activityQueueRef.current = [];
    setActivity((current) => upsertMany(current, queued));
  }, [cancelActivityFlush]);

  const scheduleActivityFlush = useCallback(() => {
    if (
      activityFrameRef.current !== undefined ||
      activityFallbackRef.current !== undefined
    ) return;
    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      activityFrameRef.current = window.requestAnimationFrame(flushActivity);
      activityFallbackRef.current = setTimeout(flushActivity, 100);
      return;
    }
    activityFallbackRef.current = setTimeout(flushActivity, 0);
  }, [flushActivity]);

  useEffect(() => {
    scopeRef.current = scope;
    generationRef.current += 1;
    pendingRef.current = false;
  }, [scope]);

  const initialize = useCallback(
    (nextRuntime: AgentRuntime, nextActivity: AgentActivity[]) => {
      activityQueueRef.current = [];
      cancelActivityFlush();
      setRuntime(nextRuntime);
      setActivity(nextActivity.slice(-AGENT_ACTIVITY_LIMIT));
      setError(undefined);
      setPending(undefined);
    },
    [cancelActivityFlush],
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

  const startAndWait = useCallback(() => control("start"), [control]);
  const start = useCallback(() => void startAndWait(), [startAndWait]);
  const stop = useCallback(() => void control("stop"), [control]);
  const stopAndWait = useCallback(() => control("stop"), [control]);
  const onDesktopEvent = useCallback((event: DesktopEvent) => {
    if (event.type === "agent.runtime") setRuntime(event.runtime);
    if (event.type === "agent.activity") {
      activityQueueRef.current.push(event.activity);
      scheduleActivityFlush();
    }
  }, [scheduleActivityFlush]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activityQueueRef.current = [];
      cancelActivityFlush();
    };
  }, [cancelActivityFlush]);

  return {
    runtime,
    activity,
    pending,
    error,
    start,
    startAndWait,
    stop,
    stopAndWait,
    initialize,
    onDesktopEvent,
  };
}
