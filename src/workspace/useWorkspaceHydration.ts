import { useEffect, useState } from "react";

import type { WritingEditor, WritingPartialBlock } from "../editor/schema";
import { markPerformance, PERFORMANCE_MARKS } from "../performance/marks";
import type { DesktopBridge, WorkspaceSnapshot } from "../shared/desktop";

export type WorkspacePhase = "loading" | "ready" | "failed";

type Options = {
  desktop: DesktopBridge;
  editor: WritingEditor;
  initialize(snapshot: WorkspaceSnapshot): void;
};

export function useWorkspaceHydration({ desktop, editor, initialize }: Options) {
  const [phase, setPhase] = useState<WorkspacePhase>("loading");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    let frame: number | undefined;
    void desktop.hydrate().then(
      (snapshot) => {
        if (cancelled) return;
        try {
          if (snapshot.document.blocks.length) {
            editor.replaceBlocks(
              editor.document,
              snapshot.document.blocks as WritingPartialBlock[],
            );
          }
          initialize(snapshot);
          frame = window.requestAnimationFrame(() => {
            if (cancelled) return;
            setPhase("ready");
            markPerformance(PERFORMANCE_MARKS.hydrationComplete);
          });
        } catch (cause) {
          if (cancelled) return;
          setError(
            cause instanceof Error ? cause.message : "The workspace could not be loaded",
          );
          setPhase("failed");
        }
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
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [desktop, editor, initialize]);

  return { phase, error };
}
