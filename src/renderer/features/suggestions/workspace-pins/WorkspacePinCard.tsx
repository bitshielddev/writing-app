import { GripVertical, MoveDiagonal2, Undo2 } from "lucide-react";
import type { ComponentProps } from "react";

import type { WorkspacePin } from "../inboxReducer";
import type { WorkspacePinRect } from "../../../../domain/suggestions/state";
import { isVisualSuggestion } from "../../../../domain/suggestions/schema";
import { KindBadge, SuggestionVisual } from "../dock/SuggestionPresentation";

type HandleProps = Pick<
  ComponentProps<"button">,
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onKeyDown"
>;

type WorkspacePinCardProps = {
  pin: WorkspacePin;
  rect: WorkspacePinRect;
  moveHandleProps: HandleProps;
  resizeHandleProps: HandleProps;
  onRaise: () => void;
  onReturnToPins: () => void;
};

/**
 * What: renders the workspace pin card component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by WorkspacePins and InteractiveWorkspacePin when that path needs this behavior.
 */
export function WorkspacePinCard({
  pin,
  rect,
  moveHandleProps,
  resizeHandleProps,
  onRaise,
  onReturnToPins,
}: WorkspacePinCardProps) {
  return (
    <article
      role="region"
      aria-label={`Workspace pin: ${pin.item.title}`}
      data-workspace-pin={pin.item.id}
      className="pointer-events-auto absolute flex overflow-hidden rounded-xl border border-brand-300 bg-[#fffdf4] shadow-[0_18px_42px_rgb(35_31_66/22%)]"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        zIndex: pin.zIndex,
      }}
      onPointerDown={onRaise}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 shrink-0 items-stretch border-b border-[#e4dcae] bg-[#fff7c9]">
          <button
            type="button"
            aria-label={`Move ${pin.item.title}`}
            className="flex min-w-0 flex-1 touch-none items-center gap-2 px-3 text-left text-sm font-bold text-[#393426] active:cursor-grabbing"
            {...moveHandleProps}
          >
            <GripVertical className="size-4 shrink-0 text-[#93875b]" aria-hidden="true" />
            <span className="truncate">{pin.item.title}</span>
          </button>
          <button
            type="button"
            aria-label={`Return ${pin.item.title} to pins`}
            className="grid w-11 shrink-0 place-items-center text-[#625b42] hover:bg-[#f4e99e] hover:text-brand-700"
            onClick={onReturnToPins}
          >
            <Undo2 className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <KindBadge kind={pin.item.kind} />
          <p className="mt-3 text-sm font-semibold leading-5 text-[#4d493b]">
            {pin.item.summary}
          </p>
          <p className="mt-3 text-sm leading-6 text-[#5d5849]">{pin.item.body}</p>
          {isVisualSuggestion(pin.item) ? (
            <div className="mt-4">
              <SuggestionVisual item={pin.item} />
            </div>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        aria-label={`Resize ${pin.item.title}`}
        className="absolute right-0 bottom-0 grid size-8 touch-none place-items-center rounded-tl-lg bg-[#fff7c9] text-[#7d724d] hover:text-brand-700"
        {...resizeHandleProps}
      >
        <MoveDiagonal2 className="size-4" aria-hidden="true" />
      </button>
    </article>
  );
}
