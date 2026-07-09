import type { WorkspacePinRect } from "../../../../domain/suggestions/state";

export type WorkspacePinBounds = { width: number; height: number };

export const WORKSPACE_PIN_GEOMETRY_POLICY = {
  edgePadding: 16,
  minimumWidth: 280,
  minimumHeight: 180,
  cascadeStep: 24,
  cascadeCount: 5,
} as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

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
