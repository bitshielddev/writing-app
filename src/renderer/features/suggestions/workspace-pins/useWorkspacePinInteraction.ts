import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { WorkspacePinRect } from "../../../../domain/suggestions/state";
import {
  clampWorkspacePinRect,
  type WorkspacePinBounds,
} from "./geometry";

type InteractionMode = "drag" | "resize";

type PointerOperation = {
  mode: InteractionMode;
  pointerId: number;
  clientX: number;
  clientY: number;
  rect: WorkspacePinRect;
};

type WorkspacePinInteractionOptions = {
  id: string;
  rect: WorkspacePinRect;
  bounds: WorkspacePinBounds;
  onGeometryChange: (id: string, rect: WorkspacePinRect) => void;
  onRaise: (id: string) => void;
};

export function useWorkspacePinInteraction({
  id,
  rect,
  bounds,
  onGeometryChange,
  onRaise,
}: WorkspacePinInteractionOptions) {
  const [draftRect, setDraftRect] = useState(rect);
  const draftRectRef = useRef(rect);
  const operationRef = useRef<PointerOperation | undefined>(undefined);

  useEffect(() => {
    if (!operationRef.current) {
      const nextRect = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
      draftRectRef.current = nextRect;
      setDraftRect(nextRect);
    }
  }, [rect.height, rect.width, rect.x, rect.y]);

  const updateDraft = useCallback(
    (nextRect: WorkspacePinRect) => {
      const clampedRect = clampWorkspacePinRect(nextRect, bounds);
      draftRectRef.current = clampedRect;
      setDraftRect(clampedRect);
      return clampedRect;
    },
    [bounds],
  );

  const start = useCallback(
    (event: PointerEvent<HTMLButtonElement>, mode: InteractionMode) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      operationRef.current = {
        mode,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        rect: draftRectRef.current,
      };
      onRaise(id);
    },
    [id, onRaise],
  );

  const move = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const operation = operationRef.current;
      if (!operation || operation.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - operation.clientX;
      const deltaY = event.clientY - operation.clientY;
      updateDraft(
        operation.mode === "drag"
          ? {
              ...operation.rect,
              x: operation.rect.x + deltaX,
              y: operation.rect.y + deltaY,
            }
          : {
              ...operation.rect,
              width: operation.rect.width + deltaX,
              height: operation.rect.height + deltaY,
            },
      );
    },
    [updateDraft],
  );

  const finish = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const operation = operationRef.current;
      if (!operation || operation.pointerId !== event.pointerId) return;
      operationRef.current = undefined;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onGeometryChange(id, draftRectRef.current);
    },
    [id, onGeometryChange],
  );

  const keyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, mode: InteractionMode) => {
      if (!event.key.startsWith("Arrow")) return;
      event.preventDefault();
      const step = event.shiftKey ? 1 : 10;
      const deltaX =
        event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const deltaY =
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      const current = draftRectRef.current;
      const next = updateDraft(
        mode === "drag"
          ? { ...current, x: current.x + deltaX, y: current.y + deltaY }
          : {
              ...current,
              width: current.width + deltaX,
              height: current.height + deltaY,
            },
      );
      onRaise(id);
      onGeometryChange(id, next);
    },
    [id, onGeometryChange, onRaise, updateDraft],
  );

  const handlersFor = (mode: InteractionMode) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => start(event, mode),
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: finish,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => keyDown(event, mode),
  });

  return {
    draftRect,
    moveHandleProps: handlersFor("drag"),
    resizeHandleProps: handlersFor("resize"),
  };
}
