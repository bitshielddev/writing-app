import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useCallback, useEffect, useRef } from "react";

import type { WritingEditor } from "./schema";
import type {
  WorkspacePin,
  WorkspacePinRect,
} from "../suggestions/inbox";
import { getInitialWorkspacePinSize } from "../suggestions/workspacePinLayout";
import { preloadKeybindingHelp } from "../keybindings/loadKeybindingHelp";
import { markPerformance, PERFORMANCE_MARKS } from "../../platform/performance/marks";
import { WorkspacePins } from "../suggestions/workspace-pins/WorkspacePins";
import { createInitialWorkspacePinRect } from "../suggestions/workspace-pins/geometry";
import { useTheme } from "../themes/useTheme";

type DocumentEditorProps = {
  editor: WritingEditor;
  workspacePins: WorkspacePin[];
  editable: boolean;
  onSelectionChange: () => void;
  onChange: () => void;
  onWorkspacePinGeometryChange: (id: string, rect: WorkspacePinRect) => void;
  onRaiseWorkspacePin: (id: string) => void;
  onReturnToPins: (id: string) => void;
};

/**
 * What: renders the document editor component and wires its props into the surrounding UI.
 *
 * Why: editor code needs a stable adapter around BlockNote and preview-specific behavior.
 * Called when: used by EditorWorkspace when that path needs this behavior.
 */
export function DocumentEditor({
  editor,
  workspacePins,
  editable,
  onSelectionChange,
  onChange,
  onWorkspacePinGeometryChange,
  onRaiseWorkspacePin,
  onReturnToPins,
}: DocumentEditorProps) {
  const scrollRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { activeTheme } = useTheme();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      markPerformance(PERFORMANCE_MARKS.editorReady);
      preloadKeybindingHelp();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const getInitialWorkspacePinRect = useCallback(
    (pin: WorkspacePin, stackIndex: number) => {
      const scroll = scrollRef.current;
      const canvas = canvasRef.current;
      if (!scroll || !canvas) {
        return undefined;
      }
      const baseSize = getInitialWorkspacePinSize(pin.item);
      const scrollRect = scroll.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const visibleTop = Math.max(0, scrollRect.top - canvasRect.top);
      return createInitialWorkspacePinRect({
        preferredSize: baseSize,
        bounds: { width: canvas.clientWidth, height: canvas.clientHeight },
        visibleTop,
        stackIndex,
      });
    },
    [],
  );

  useEffect(() => {
    const pendingPins = workspacePins.filter(
      (pin) => pin.pendingInitialPlacement,
    );
    if (!pendingPins.length) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      pendingPins.forEach((pin) => {
        const stackIndex = workspacePins.findIndex(
          (candidate) => candidate.item.id === pin.item.id,
        );
        const rect = getInitialWorkspacePinRect(pin, stackIndex);
        if (rect) {
          onWorkspacePinGeometryChange(pin.item.id, rect);
        }
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    getInitialWorkspacePinRect,
    onWorkspacePinGeometryChange,
    workspacePins,
  ]);

  const requiredCanvasHeight = workspacePins.reduce(
    (height, pin) => Math.max(height, pin.y + pin.height + 24),
    0,
  );

  return (
    <section
      ref={scrollRef}
      aria-label="Document editor"
      className="min-h-0 flex-1 overflow-y-auto bg-background px-0 py-10 lg:py-14"
    >
      <div
        ref={canvasRef}
        className="relative mx-auto min-h-full w-full"
        style={
          requiredCanvasHeight ? { minHeight: requiredCanvasHeight } : undefined
        }
      >
        <div className="mx-auto min-h-full w-full max-w-[55rem]">
          <BlockNoteView
            editor={editor}
            editable={editable}
            theme={activeTheme.appearance}
            aria-label="Editable draft content"
            data-editor-surface
            onChange={onChange}
            onSelectionChange={onSelectionChange}
          />
        </div>
        <WorkspacePins
          canvasRef={canvasRef}
          pins={workspacePins}
          onGeometryChange={onWorkspacePinGeometryChange}
          onRaise={onRaiseWorkspacePin}
          onReturnToPins={onReturnToPins}
        />
      </div>
    </section>
  );
}
