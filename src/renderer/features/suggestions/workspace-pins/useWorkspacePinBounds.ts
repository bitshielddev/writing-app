import { type RefObject, useEffect, useRef, useState } from "react";

import type { WorkspacePin, WorkspacePinRect } from "../inboxReducer";
import {
  clampWorkspacePinRect,
  workspacePinRectsEqual,
  type WorkspacePinBounds,
} from "./geometry";

/**
 * What: coordinates workspace pin bounds state, side effects, and callbacks for the renderer workflow.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by WorkspacePins when that path needs this behavior.
 */
export function useWorkspacePinBounds(
  canvasRef: RefObject<HTMLDivElement | null>,
  pins: WorkspacePin[],
  onGeometryChange: (id: string, rect: WorkspacePinRect) => void,
): WorkspacePinBounds {
  const [bounds, setBounds] = useState<WorkspacePinBounds>({ width: 0, height: 0 });
  const pinsRef = useRef(pins);
  const previousBoundsRef = useRef<WorkspacePinBounds>({ width: 0, height: 0 });

  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    /**
     * What: performs the update bounds step for this file's workflow.
     *
     * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
     * Called when: used by useWorkspacePinBounds when that path needs this behavior.
     */
    const updateBounds = () =>
      setBounds({ width: canvas.clientWidth, height: canvas.clientHeight });
    updateBounds();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateBounds);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef]);

  useEffect(() => {
    const previous = previousBoundsRef.current;
    if (
      !bounds.width ||
      !bounds.height ||
      (bounds.width === previous.width && bounds.height === previous.height)
    ) {
      return;
    }
    previousBoundsRef.current = bounds;
    const frame = window.requestAnimationFrame(() => {
      const repairs = pinsRef.current.flatMap((pin) => {
        if (pin.pendingInitialPlacement) return [];
        const storedRect = {
          x: pin.x,
          y: pin.y,
          width: pin.width,
          height: pin.height,
        };
        const nextRect = clampWorkspacePinRect(storedRect, bounds);
        return workspacePinRectsEqual(storedRect, nextRect)
          ? []
          : [{ id: pin.item.id, rect: nextRect }];
      });
      repairs.forEach((repair) => onGeometryChange(repair.id, repair.rect));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [bounds, onGeometryChange]);

  return bounds;
}
