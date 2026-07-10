import { type RefObject, useEffect } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

type ModalFocusOptions = {
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
};

/**
 * What: coordinates modal focus state, side effects, and callbacks for the renderer workflow.
 *
 * Why: shared UI primitives need consistent focus, sizing, and interaction behavior.
 * Called when: used by KeybindingHelpDialog and ResponsiveDrawer when that path needs this behavior.
 */
export function useModalFocus({
  containerRef,
  initialFocusRef,
  open,
  onClose,
}: ModalFocusOptions) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusFrame = window.requestAnimationFrame(() =>
      initialFocusRef.current?.focus(),
    );
    /**
     * What: handles key down and routes the effect to the owning workflow.
     *
     * Why: shared UI primitives need consistent focus, sizing, and interaction behavior.
     * Called when: used by useModalFocus when that path needs this behavior.
     */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements =
        containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusableElements?.length) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, [containerRef, initialFocusRef, onClose, open]);
}
