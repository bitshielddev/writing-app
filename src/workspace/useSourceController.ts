import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopBridge, DesktopEvent, SourceSnapshot } from "../shared/desktop";

function reconcile(sources: SourceSnapshot[], source: SourceSnapshot) {
  return [source, ...sources.filter((candidate) => candidate.id !== source.id)];
}

export function useSourceController(desktop: DesktopBridge) {
  const [sources, setSources] = useState<SourceSnapshot[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const mountedRef = useRef(true);
  const pendingRef = useRef(false);

  const initialize = useCallback((next: SourceSnapshot[]) => {
    setSources(next);
    setError(undefined);
  }, []);

  const importSource = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(undefined);
    try {
      const source = await desktop.importSource();
      if (source && mountedRef.current) {
        setSources((current) => reconcile(current, source));
      }
    } catch (cause) {
      if (mountedRef.current) {
        setError(
          cause instanceof Error ? cause.message : "The source could not be imported",
        );
      }
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  }, [desktop]);

  const onDesktopEvent = useCallback((event: DesktopEvent) => {
    if (event.type === "source.imported") {
      setSources((current) => reconcile(current, event.source));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { sources, pending, error, importSource, initialize, onDesktopEvent };
}
