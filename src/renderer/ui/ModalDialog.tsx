import { X, type LucideIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { useModalFocus } from "./useModalFocus";

export function ModalDialog({
  open,
  onClose,
  titleId,
  descriptionId,
  title,
  description,
  icon: Icon,
  closeLabel,
  children,
  maxWidth = "max-w-3xl",
}: {
  open: boolean;
  onClose: () => void;
  titleId: string;
  descriptionId: string;
  title: string;
  description: string;
  icon: LucideIcon;
  closeLabel: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useModalFocus({ containerRef: dialogRef, initialFocusRef: closeButtonRef, open, onClose });
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4 sm:p-8">
      <div aria-hidden="true" className="absolute inset-0 bg-overlay backdrop-blur-[2px]" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={`relative flex max-h-[min(48rem,calc(100dvh-2rem))] w-full ${maxWidth} flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl`}>
        <header className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4 sm:px-7 sm:py-5">
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-xl font-extrabold tracking-[-0.025em] text-foreground">{title}</h2>
            <p id={descriptionId} className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
          </div>
          <button ref={closeButtonRef} type="button" aria-label={closeLabel}
            className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary"
            onClick={onClose}><X className="size-5" aria-hidden="true" /></button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">{children}</div>
      </div>
    </div>
  );
}
