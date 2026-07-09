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
          className="fixed inset-0 z-[80] grid place-items-center bg-[#13141c]/55 p-4 text-sm font-semibold text-white"
        >
          Loading keyboard shortcuts…
        </div>
      }
    >
      <LazyKeybindingHelpDialog open onClose={onClose} />
    </Suspense>
  );
}
