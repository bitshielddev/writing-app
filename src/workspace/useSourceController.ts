import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopBridge, DesktopEvent, SourceSnapshot } from "../contracts/desktop-bridge";

function reconcile(sources: SourceSnapshot[], source: SourceSnapshot) {
  return [source, ...sources.filter((candidate) => candidate.id !== source.id)];
}
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

export function useSourceController(
  desktop: DesktopBridge,
  scope?: { projectId: string; documentId: string },
) {
  const [sources, setSources] = useState<SourceSnapshot[]>([]);
  const [pending, setPending] = useState(false);
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

  const initialize = useCallback((next: SourceSnapshot[]) => {
    setSources(next);
    setError(undefined);
    setPending(false);
  }, []);

  const importSource = useCallback(async () => {
    if (pendingRef.current || !scope) return;
    pendingRef.current = true;
    const operationScope = scope;
    const generation = generationRef.current;
    setPending(true);
    setError(undefined);
    try {
      const source = await desktop.importSource(scope);
      if (source && isCurrentScope(mountedRef.current, scopeRef.current, operationScope, generation, generationRef.current)) {
        setSources((current) => reconcile(current, source));
      }
    } catch (cause) {
      if (isCurrentScope(mountedRef.current, scopeRef.current, operationScope, generation, generationRef.current)) {
        setError(
          cause instanceof Error ? cause.message : "The source could not be imported",
        );
      }
    } finally {
      if (generation === generationRef.current) pendingRef.current = false;
      if (isCurrentScope(mountedRef.current, scopeRef.current, operationScope, generation, generationRef.current)) setPending(false);
    }
  }, [desktop, scope]);

  const onDesktopEvent = useCallback((event: DesktopEvent) => {
    if (event.type === "source.imported") {
      if (scope && event.source.documentId &&
        (event.source.projectId !== scope.projectId || event.source.documentId !== scope.documentId)) return;
      setSources((current) => reconcile(current, event.source));
    }
  }, [scope]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { sources, pending, error, importSource, initialize, onDesktopEvent };
}
