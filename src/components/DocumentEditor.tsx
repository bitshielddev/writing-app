import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useCallback, useEffect, useRef } from "react";

import type { WritingEditor } from "../editor/schema";
import type {
  WorkspacePin,
  WorkspacePinRect,
} from "../suggestions/inbox";
import { getInitialWorkspacePinSize } from "../suggestions/workspacePinLayout";
import { preloadKeybindingHelp } from "../keybindings/loadKeybindingHelp";
import { markPerformance, PERFORMANCE_MARKS } from "../performance/marks";
import { WorkspacePins } from "./WorkspacePins";
import { createInitialWorkspacePinRect } from "./workspacePins/geometry";

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
      className="min-h-0 flex-1 overflow-y-auto bg-white px-0 py-10 lg:py-14"
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
            theme="light"
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
