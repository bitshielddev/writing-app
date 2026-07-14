import { lazy, Suspense } from "react";

const LazySettingsDialog = lazy(() => import("./SettingsDialog").then((module) => ({ default: module.SettingsDialog })));

export function SettingsBoundary({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Suspense fallback={<div role="status" aria-label="Loading settings"
      className="fixed inset-0 z-[80] grid place-items-center bg-overlay p-4 text-sm font-semibold text-primary-foreground">Loading settings…</div>}>
      <LazySettingsDialog open onClose={onClose} />
    </Suspense>
  );
}
