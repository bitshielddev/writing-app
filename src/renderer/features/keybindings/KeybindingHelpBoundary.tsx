import { lazy, Suspense } from "react";

import { loadKeybindingHelp } from "./loadKeybindingHelp";

type KeybindingHelpBoundaryProps = {
  open: boolean;
  onClose: () => void;
};

const LazyKeybindingHelpDialog = lazy(() =>
  loadKeybindingHelp().then((module) => ({
    default: module.KeybindingHelpDialog,
  })),
);

/**
 * What: renders the keybinding help boundary component and wires its props into the surrounding UI.
 *
 * Why: keyboard workflows need shared sequence and command behavior across the UI.
 * Called when: used by App when that path needs this behavior.
 */
export function KeybindingHelpBoundary({
  open,
  onClose,
}: KeybindingHelpBoundaryProps) {
  if (!open) return null;

  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-label="Loading keyboard shortcuts"
          className="fixed inset-0 z-[80] grid place-items-center bg-overlay/55 p-4 text-sm font-semibold text-primary-foreground"
        >
          Loading keyboard shortcuts…
        </div>
      }
    >
      <LazyKeybindingHelpDialog open onClose={onClose} />
    </Suspense>
  );
}
