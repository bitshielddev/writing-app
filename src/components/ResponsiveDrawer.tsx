import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

type ResponsiveDrawerProps = {
  children: ReactNode;
  id: string;
  open: boolean;
  side: "left" | "right";
  title: string;
  onClose: () => void;
};

export function ResponsiveDrawer({
  children,
  id,
  open,
  side,
  title,
  onClose,
}: ResponsiveDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );

      if (!focusableElements?.length) {
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

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 xl:hidden">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[#13141c]/45"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className={`absolute inset-y-0 flex h-dvh w-[min(22.5rem,calc(100vw-3rem))] flex-col overflow-hidden bg-[#f4f2fd] shadow-2xl ${
          side === "left" ? "left-0" : "right-0"
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#d7d4e8] px-4">
          <h2 id={`${id}-title`} className="text-sm font-bold text-[#393844]">
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={`Close ${title.toLowerCase()}`}
            className="grid size-9 place-items-center rounded-md text-[#5d5b6d] hover:bg-[#e8e7f1] hover:text-brand-700"
            onClick={onClose}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
