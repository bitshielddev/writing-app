import type { RefObject } from "react";

import type {
  WorkspacePin,
  WorkspacePinRect,
} from "../inboxReducer";
import { WorkspacePinCard } from "./WorkspacePinCard";
import type { WorkspacePinBounds } from "./geometry";
import { useWorkspacePinBounds } from "./useWorkspacePinBounds";
import { useWorkspacePinInteraction } from "./useWorkspacePinInteraction";

type InteractiveWorkspacePinProps = {
  pin: WorkspacePin;
  bounds: WorkspacePinBounds;
  onGeometryChange: (id: string, rect: WorkspacePinRect) => void;
  onRaise: (id: string) => void;
  onReturnToPins: (id: string) => void;
};

/**
 * What: renders the interactive workspace pin component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by WorkspacePins when that path needs this behavior.
 */
function InteractiveWorkspacePin({
  pin,
  bounds,
  onGeometryChange,
  onRaise,
  onReturnToPins,
}: InteractiveWorkspacePinProps) {
  const interaction = useWorkspacePinInteraction({
    id: pin.item.id,
    rect: { x: pin.x, y: pin.y, width: pin.width, height: pin.height },
    bounds,
    onGeometryChange,
    onRaise,
  });
  return (
    <WorkspacePinCard
      pin={pin}
      rect={interaction.draftRect}
      moveHandleProps={interaction.moveHandleProps}
      resizeHandleProps={interaction.resizeHandleProps}
      onRaise={() => onRaise(pin.item.id)}
      onReturnToPins={() => onReturnToPins(pin.item.id)}
    />
  );
}

export type WorkspacePinsProps = {
  canvasRef: RefObject<HTMLDivElement | null>;
  pins: WorkspacePin[];
  onGeometryChange: (id: string, rect: WorkspacePinRect) => void;
  onRaise: (id: string) => void;
  onReturnToPins: (id: string) => void;
};

/**
 * What: renders the workspace pins component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by DocumentEditor, Harness and MultiplePinsHarness when that path needs this behavior.
 */
export function WorkspacePins({
  canvasRef,
  pins,
  onGeometryChange,
  onRaise,
  onReturnToPins,
}: WorkspacePinsProps) {
  const bounds = useWorkspacePinBounds(canvasRef, pins, onGeometryChange);
  if (!bounds.width || !bounds.height) return null;

  return (
    <div
      aria-label="Workspace pins"
      className="pointer-events-none absolute inset-0 z-20 hidden xl:block"
    >
      {pins
        .filter((pin) => !pin.pendingInitialPlacement)
        .map((pin) => (
          <InteractiveWorkspacePin
            key={pin.item.id}
            pin={pin}
            bounds={bounds}
            onGeometryChange={onGeometryChange}
            onRaise={onRaise}
            onReturnToPins={onReturnToPins}
          />
        ))}
    </div>
  );
}
