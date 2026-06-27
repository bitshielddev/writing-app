import { GripVertical, MoveDiagonal2, Undo2 } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  WorkspacePin,
  WorkspacePinRect,
} from "../suggestions/inbox";
import { KindBadge, SuggestionVisual } from "./SuggestionPresentation";

const EDGE_PADDING = 16;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 180;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function clampRect(
  rect: WorkspacePinRect,
  bounds: { width: number; height: number },
): WorkspacePinRect {
  const maxWidth = Math.max(MIN_WIDTH, bounds.width - EDGE_PADDING * 2);
  const maxHeight = Math.max(MIN_HEIGHT, bounds.height - EDGE_PADDING * 2);
  const width = clamp(rect.width, MIN_WIDTH, maxWidth);
  const height = clamp(rect.height, MIN_HEIGHT, maxHeight);
  return {
    x: clamp(rect.x, EDGE_PADDING, bounds.width - width - EDGE_PADDING),
    y: clamp(rect.y, EDGE_PADDING, bounds.height - height - EDGE_PADDING),
    width,
    height,
  };
}

type WorkspacePinCardProps = {
  pin: WorkspacePin;
  bounds: { width: number; height: number };
  onGeometryChange: (id: string, rect: WorkspacePinRect) => void;
  onRaise: (id: string) => void;
  onReturnToPins: (id: string) => void;
};

type PointerOperation = {
  mode: "drag" | "resize";
  pointerId: number;
  clientX: number;
  clientY: number;
  rect: WorkspacePinRect;
};

function WorkspacePinCard({
  pin,
  bounds,
  onGeometryChange,
  onRaise,
  onReturnToPins,
}: WorkspacePinCardProps) {
  const [draftRect, setDraftRect] = useState(() => ({
    x: pin.x,
    y: pin.y,
    width: pin.width,
    height: pin.height,
  }));
  const draftRectRef = useRef(draftRect);
  const operationRef = useRef<PointerOperation | undefined>(undefined);

  useEffect(() => {
    if (!operationRef.current) {
      const nextRect = {
        x: pin.x,
        y: pin.y,
        width: pin.width,
        height: pin.height,
      };
      draftRectRef.current = nextRect;
      setDraftRect(nextRect);
    }
  }, [pin.height, pin.width, pin.x, pin.y]);

  const updateDraft = (rect: WorkspacePinRect) => {
    const nextRect = clampRect(rect, bounds);
    draftRectRef.current = nextRect;
    setDraftRect(nextRect);
  };

  const startPointerOperation = (
    event: PointerEvent<HTMLButtonElement>,
    mode: PointerOperation["mode"],
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    operationRef.current = {
      mode,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      rect: draftRectRef.current,
    };
    onRaise(pin.item.id);
  };

  const continuePointerOperation = (event: PointerEvent<HTMLButtonElement>) => {
    const operation = operationRef.current;
    if (!operation || operation.pointerId !== event.pointerId) {
      return;
    }
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
  };

  const finishPointerOperation = (event: PointerEvent<HTMLButtonElement>) => {
    const operation = operationRef.current;
    if (!operation || operation.pointerId !== event.pointerId) {
      return;
    }
    operationRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onGeometryChange(pin.item.id, draftRectRef.current);
  };

  const handleKeyboardGeometry = (
    event: KeyboardEvent<HTMLButtonElement>,
    mode: PointerOperation["mode"],
  ) => {
    if (!event.key.startsWith("Arrow")) {
      return;
    }
    event.preventDefault();
    const step = event.shiftKey ? 1 : 10;
    const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    const current = draftRectRef.current;
    const next = clampRect(
      mode === "drag"
        ? { ...current, x: current.x + deltaX, y: current.y + deltaY }
        : {
            ...current,
            width: current.width + deltaX,
            height: current.height + deltaY,
          },
      bounds,
    );
    updateDraft(next);
    onRaise(pin.item.id);
    onGeometryChange(pin.item.id, next);
  };

  return (
    <article
      role="region"
      aria-label={`Workspace pin: ${pin.item.title}`}
      data-workspace-pin={pin.item.id}
      className="pointer-events-auto absolute flex overflow-hidden rounded-xl border border-brand-300 bg-[#fffdf4] shadow-[0_18px_42px_rgb(35_31_66/22%)]"
      style={{
        left: draftRect.x,
        top: draftRect.y,
        width: draftRect.width,
        height: draftRect.height,
        zIndex: pin.zIndex,
      }}
      onPointerDown={() => onRaise(pin.item.id)}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 shrink-0 items-stretch border-b border-[#e4dcae] bg-[#fff7c9]">
          <button
            type="button"
            aria-label={`Move ${pin.item.title}`}
            className="flex min-w-0 flex-1 touch-none items-center gap-2 px-3 text-left text-sm font-bold text-[#393426] active:cursor-grabbing"
            onPointerDown={(event) => startPointerOperation(event, "drag")}
            onPointerMove={continuePointerOperation}
            onPointerUp={finishPointerOperation}
            onPointerCancel={finishPointerOperation}
            onKeyDown={(event) => handleKeyboardGeometry(event, "drag")}
          >
            <GripVertical className="size-4 shrink-0 text-[#93875b]" aria-hidden="true" />
            <span className="truncate">{pin.item.title}</span>
          </button>
          <button
            type="button"
            aria-label={`Return ${pin.item.title} to pins`}
            className="grid w-11 shrink-0 place-items-center text-[#625b42] hover:bg-[#f4e99e] hover:text-brand-700"
            onClick={() => onReturnToPins(pin.item.id)}
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
          {pin.item.kind === "outline" ||
          pin.item.kind === "layout" ||
          pin.item.kind === "mindMap" ? (
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
        onPointerDown={(event) => startPointerOperation(event, "resize")}
        onPointerMove={continuePointerOperation}
        onPointerUp={finishPointerOperation}
        onPointerCancel={finishPointerOperation}
        onKeyDown={(event) => handleKeyboardGeometry(event, "resize")}
      >
        <MoveDiagonal2 className="size-4" aria-hidden="true" />
      </button>
    </article>
  );
}

type WorkspacePinsProps = {
  canvasRef: RefObject<HTMLDivElement | null>;
  pins: WorkspacePin[];
  onGeometryChange: (id: string, rect: WorkspacePinRect) => void;
  onRaise: (id: string) => void;
  onReturnToPins: (id: string) => void;
};

export function WorkspacePins({
  canvasRef,
  pins,
  onGeometryChange,
  onRaise,
  onReturnToPins,
}: WorkspacePinsProps) {
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const pinsRef = useRef(pins);
  const previousBoundsRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const updateBounds = () =>
      setBounds({ width: canvas.clientWidth, height: canvas.clientHeight });
    updateBounds();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
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
    pinsRef.current
      .filter((pin) => !pin.pendingInitialPlacement)
      .forEach((pin) => {
        const storedRect = {
          x: pin.x,
          y: pin.y,
          width: pin.width,
          height: pin.height,
        };
        const nextRect = clampRect(storedRect, bounds);
        if (
          nextRect.x !== storedRect.x ||
          nextRect.y !== storedRect.y ||
          nextRect.width !== storedRect.width ||
          nextRect.height !== storedRect.height
        ) {
          onGeometryChange(pin.item.id, nextRect);
        }
      });
  }, [bounds, onGeometryChange]);

  if (!bounds.width || !bounds.height) {
    return null;
  }

  return (
    <div
      aria-label="Workspace pins"
      className="pointer-events-none absolute inset-0 z-20 hidden xl:block"
    >
      {pins
        .filter((pin) => !pin.pendingInitialPlacement)
        .map((pin) => (
          <WorkspacePinCard
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
