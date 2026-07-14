import { Check, Settings2 } from "lucide-react";

import { ModalDialog } from "../../ui/ModalDialog";
import { useTheme } from "./useTheme";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { catalog, selecting, error, selectTheme } = useTheme();
  return (
    <ModalDialog open={open} onClose={onClose} titleId="settings-title"
      descriptionId="settings-description" title="Settings"
      description="Choose the colour palette used throughout your writing workspace."
      icon={Settings2} closeLabel="Close settings" maxWidth="max-w-4xl">
      <fieldset disabled={selecting}>
        <legend className="text-xs font-extrabold tracking-[0.1em] text-primary uppercase">Theme</legend>
        <p className="mt-1 text-sm text-muted-foreground">Your choice is saved immediately and restored when ScribeAI starts.</p>
        {error ? <p role="alert" className="mt-3 rounded-lg border border-danger bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.themes.map((theme) => {
            const selected = theme.id === catalog.activeThemeId;
            return (
              <label key={theme.id} className={`relative cursor-pointer rounded-xl border p-3 transition ${selected ? "border-primary ring-2 ring-focus/30" : "border-border hover:border-primary"}`}
                style={{ backgroundColor: theme.colors.surface, color: theme.colors.surface_foreground }}>
                <input type="radio" name="theme" value={theme.id} checked={selected}
                  className="sr-only" onChange={() => void selectTheme(theme.id)} />
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-bold">{theme.display_name}</span>
                  {selected ? <span className="grid size-6 place-items-center rounded-full" style={{ backgroundColor: theme.colors.primary, color: theme.colors.primary_foreground }}>
                    <Check className="size-4" aria-hidden="true" /></span> : null}
                </span>
                <span className="mt-3 flex gap-1.5" aria-hidden="true">
                  {[theme.colors.background, theme.colors.panel, theme.colors.primary, theme.colors.accent, theme.colors.foreground].map((color, index) =>
                    <span key={`${color}-${index}`} className="h-7 flex-1 rounded-md border" style={{ backgroundColor: color, borderColor: theme.colors.border }} />)}
                </span>
                <span className="mt-2 block text-[0.65rem] font-semibold uppercase tracking-wider" style={{ color: theme.colors.muted_foreground }}>{theme.appearance}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </ModalDialog>
  );
}
