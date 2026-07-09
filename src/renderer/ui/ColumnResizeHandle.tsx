import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type ColumnResizeHandleProps = {
  controls: string;
  label: string;
  maxWidth: number | (() => number);
  minWidth: number;
  panelRef: RefObject<HTMLElement | null>;
  resizeDirection: "left" | "right";
  onReset: () => void;
  onResize: (width: number) => void;
};

const KEYBOARD_STEP = 16;

function resolveWidth(value: number | (() => number)) {
  return typeof value === "function" ? value() : value;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function ColumnResizeHandle({
  controls,
  label,
  maxWidth,
  minWidth,
  panelRef,
  resizeDirection,
  onReset,
  onResize,
}: ColumnResizeHandleProps) {
  const dragStart = useRef<{
    pointerId: number;
    width: number;
    x: number;
  } | null>(null);
  const [active, setActive] = useState(false);
  const [measuredWidth, setMeasuredWidth] = useState(minWidth);

  const measurePanel = useCallback(() => {
    const width = panelRef.current?.getBoundingClientRect().width;
    if (width) {
      setMeasuredWidth(Math.round(width));
    }
    return width ?? minWidth;
  }, [minWidth, panelRef]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(measurePanel);
    return () => window.cancelAnimationFrame(frame);
  });

  useEffect(() => {
    if (!panelRef.current || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setMeasuredWidth(Math.round(entry.contentRect.width));
      }
    });
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [panelRef]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    document.body.classList.add("column-resize-active");
    return () => document.body.classList.remove("column-resize-active");
  }, [active]);

  const resizeTo = (width: number) => {
    const nextWidth = Math.round(
      clamp(width, minWidth, resolveWidth(maxWidth)),
    );
    setMeasuredWidth(nextWidth);
    onResize(nextWidth);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current?.pointerId !== event.pointerId) {
      return;
    }
    dragStart.current = null;
    setActive(false);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const width = measurePanel();
    dragStart.current = { pointerId: event.pointerId, width, x: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
    setActive(true);
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current?.pointerId !== event.pointerId) {
      return;
    }

    const movement = event.clientX - dragStart.current.x;
    const direction = resizeDirection === "right" ? 1 : -1;
    resizeTo(dragStart.current.width + movement * direction);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const maximum = resolveWidth(maxWidth);
    let nextWidth: number | undefined;

    if (event.key === "Home") {
      nextWidth = minWidth;
    } else if (event.key === "End") {
      nextWidth = maximum;
    } else if (event.key === "ArrowLeft") {
      nextWidth =
        measuredWidth + (resizeDirection === "left" ? KEYBOARD_STEP : -KEYBOARD_STEP);
    } else if (event.key === "ArrowRight") {
      nextWidth =
        measuredWidth + (resizeDirection === "right" ? KEYBOARD_STEP : -KEYBOARD_STEP);
    }

    if (nextWidth !== undefined) {
      event.preventDefault();
      resizeTo(nextWidth);
    }
  };

  return (
    <div
      role="separator"
      aria-controls={controls}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={Math.round(resolveWidth(maxWidth))}
      aria-valuemin={minWidth}
      aria-valuenow={measuredWidth}
      className={`group absolute inset-y-0 z-30 hidden w-3 touch-none cursor-col-resize items-stretch justify-center outline-none xl:flex ${
        resizeDirection === "right"
          ? "right-0 translate-x-1/2"
          : "left-0 -translate-x-1/2"
      }`}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={finishDrag}
      onPointerCancel={finishDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
    >
      <span
        aria-hidden="true"
        className={`w-px bg-[#d7d4e8] transition-[width,background-color,box-shadow] group-hover:w-1 group-hover:bg-brand-400 group-focus-visible:w-1 group-focus-visible:bg-brand-500 group-focus-visible:shadow-[0_0_0_3px_rgb(87_72_229/18%)] ${
          active ? "w-1 bg-brand-500" : ""
        }`}
      />
    </div>
  );
}
