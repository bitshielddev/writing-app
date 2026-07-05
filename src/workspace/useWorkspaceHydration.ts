import { useEffect, useState } from "react";

import type { WritingEditor, WritingPartialBlock } from "../editor/schema";
import { DurableEventCoordinator } from "../desktop/durableEventCoordinator";
import { markPerformance, PERFORMANCE_MARKS } from "../performance/marks";
import type { DesktopBridge, DesktopEvent, WorkspaceSnapshot } from "../shared/desktop";

export type WorkspacePhase = "loading" | "ready" | "failed";

type Options = {
  desktop: DesktopBridge;
  editor: WritingEditor;
  initialize(snapshot: WorkspaceSnapshot): void;
  onEvent?(event: DesktopEvent): void;
};
const ignoreDesktopEvent = () => undefined;

export function useWorkspaceHydration({ desktop, editor, initialize, onEvent = ignoreDesktopEvent }: Options) {
  const [phase, setPhase] = useState<WorkspacePhase>("loading");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    let frame: number | undefined;
    const coordinator = new DurableEventCoordinator({
      desktop,
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
          setPhase("ready");
          markPerformance(PERFORMANCE_MARKS.hydrationComplete);
        });
      },
      (cause: unknown) => {
        if (cancelled) return;
        console.error("Workspace hydration failed", cause);
        setError(
          cause instanceof Error ? cause.message : "The workspace could not be loaded",
        );
        setPhase("failed");
      },
    );

    return () => {
      cancelled = true;
      coordinator.stop();
      unsubscribe();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [desktop, editor, initialize, onEvent]);

  return { phase, error };
}
