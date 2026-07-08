import { useEffect, useState } from "react";

import type { WritingEditor, WritingPartialBlock } from "../editor/schema";
import { DurableEventCoordinator } from "../desktop/durableEventCoordinator";
import { markPerformance, PERFORMANCE_MARKS } from "../performance/marks";
import type { DesktopBridge, DesktopEvent, WorkspaceSnapshot } from "../contracts/desktop-bridge";

export type WorkspacePhase = "loading" | "ready" | "failed";

type Options = {
  desktop: DesktopBridge;
  editor: WritingEditor;
  scope?: { projectId: string; documentId: string };
  initialize(snapshot: WorkspaceSnapshot): void;
  onEvent?(event: DesktopEvent): void;
};
const ignoreDesktopEvent = () => undefined;

export function useWorkspaceHydration({ desktop, editor, scope, initialize, onEvent = ignoreDesktopEvent }: Options) {
  const [status, setStatus] = useState<{ key: string; phase: WorkspacePhase; error?: string }>({
    key: "", phase: "loading",
  });
  const scopeKey = scope ? `${scope.projectId}:${scope.documentId}` : "";

  useEffect(() => {
    if (!scope) return;
    const activeScopeKey = `${scope.projectId}:${scope.documentId}`;
    let cancelled = false;
    let frame: number | undefined;
    const coordinator = new DurableEventCoordinator({
      desktop,
      scope,
      applyEvent: onEvent,
      installSnapshot: (snapshot) => {
        if (cancelled) return;
        if (snapshot.document.blocks.length) {
          editor.replaceBlocks(
            editor.document,
            snapshot.document.blocks as WritingPartialBlock[],
          );
        }
        initialize(snapshot);
      },
      onError: (cause) => {
        if (!cancelled) console.error("Desktop event coordination failed", cause);
      },
    });
    const unsubscribe = desktop.subscribe(coordinator.receive);
    void coordinator.hydrate().then(
      () => {
        if (cancelled) return;
        frame = window.requestAnimationFrame(() => {
          if (cancelled) return;
          setStatus({ key: activeScopeKey, phase: "ready" });
          markPerformance(PERFORMANCE_MARKS.hydrationComplete);
        });
      },
      (cause: unknown) => {
        if (cancelled) return;
        console.error("Workspace hydration failed", cause);
        setStatus({ key: activeScopeKey, phase: "failed", error:
          cause instanceof Error ? cause.message : "The workspace could not be loaded" });
      },
    );

    return () => {
      cancelled = true;
      coordinator.stop();
      unsubscribe();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [desktop, editor, initialize, onEvent, scope]);

  return status.key === scopeKey
    ? { phase: status.phase, error: status.error }
    : { phase: "loading" as const, error: undefined };
}
