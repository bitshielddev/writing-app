import type { WorkspacePinRect } from "../../../../domain/suggestions/state";

export type WorkspacePinBounds = { width: number; height: number };

export const WORKSPACE_PIN_GEOMETRY_POLICY = {
  edgePadding: 16,
  minimumWidth: 280,
  minimumHeight: 180,
  cascadeStep: 24,
  cascadeCount: 5,
} as const;

/**
 * What: performs the clamp step for this file's workflow.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by clampWorkspacePinRect when that path needs this behavior.
 */
function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/**
 * What: performs the clamp workspace pin rect step for this file's workflow.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by createInitialWorkspacePinRect, useWorkspacePinBounds, useWorkspacePinInteraction and geometry when that path needs this behavior.
 */
export function clampWorkspacePinRect(
  rect: WorkspacePinRect,
  bounds: WorkspacePinBounds,
): WorkspacePinRect {
  const { edgePadding, minimumHeight, minimumWidth } =
    WORKSPACE_PIN_GEOMETRY_POLICY;
  const maxWidth = Math.max(minimumWidth, bounds.width - edgePadding * 2);
  const maxHeight = Math.max(minimumHeight, bounds.height - edgePadding * 2);
  const width = clamp(rect.width, minimumWidth, maxWidth);
  const height = clamp(rect.height, minimumHeight, maxHeight);
  return {
    x: clamp(rect.x, edgePadding, bounds.width - width - edgePadding),
    y: clamp(rect.y, edgePadding, bounds.height - height - edgePadding),
    width,
    height,
  };
}

/**
 * What: performs the workspace pin rects equal step for this file's workflow.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by useWorkspacePinBounds and geometry when that path needs this behavior.
 */
export function workspacePinRectsEqual(
  left: WorkspacePinRect,
  right: WorkspacePinRect,
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

type InitialWorkspacePinRectOptions = {
  preferredSize: Pick<WorkspacePinRect, "width" | "height">;
  bounds: WorkspacePinBounds;
  visibleTop: number;
  stackIndex: number;
};

/**
 * What: creates initial workspace pin rect with the dependencies and defaults this workflow expects.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by DocumentEditor and geometry when that path needs this behavior.
 */
export function createInitialWorkspacePinRect({
  preferredSize,
  bounds,
  visibleTop,
  stackIndex,
}: InitialWorkspacePinRectOptions): WorkspacePinRect {
  const {
    cascadeCount,
    cascadeStep,
    edgePadding,
    minimumHeight,
    minimumWidth,
  } = WORKSPACE_PIN_GEOMETRY_POLICY;
  const width = Math.min(
    preferredSize.width,
    Math.max(minimumWidth, bounds.width - edgePadding * 2),
  );
  const height = Math.min(
    preferredSize.height,
    Math.max(minimumHeight, bounds.height - edgePadding * 2),
  );
  const cascade = (stackIndex % cascadeCount) * cascadeStep;
  return clampWorkspacePinRect(
    {
      x: Math.max(edgePadding, bounds.width - width - 24 - cascade),
      y: Math.min(
        Math.max(edgePadding, visibleTop + 24 + cascade),
        Math.max(edgePadding, bounds.height - height - edgePadding),
      ),
      width,
      height,
    },
    bounds,
  );
}
