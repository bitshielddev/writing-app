import type { ThemeDefinition } from "../../../contracts/desktop-bridge";

const TOKEN_MAP = {
  background: "--background",
  foreground: "--foreground",
  panel: "--panel",
  panel_foreground: "--panel-foreground",
  surface: "--surface",
  surface_foreground: "--surface-foreground",
  surface_raised: "--surface-raised",
  muted: "--muted",
  muted_foreground: "--muted-foreground",
  border: "--border",
  primary: "--primary",
  primary_hover: "--primary-hover",
  primary_foreground: "--primary-foreground",
  accent: "--accent",
  accent_foreground: "--accent-foreground",
  focus: "--focus",
  overlay: "--overlay",
  success: "--success",
  success_foreground: "--success-foreground",
  warning: "--warning",
  warning_foreground: "--warning-foreground",
  danger: "--danger",
  danger_foreground: "--danger-foreground",
  pin: "--pin",
  pin_header: "--pin-header",
  pin_foreground: "--pin-foreground",
  pin_border: "--pin-border",
} as const;

export function applyTheme(theme: ThemeDefinition) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.colors)) {
    root.style.setProperty(TOKEN_MAP[name as keyof typeof TOKEN_MAP], value);
  }
  root.dataset.theme = theme.id;
  root.dataset.appearance = theme.appearance;
  root.classList.toggle("dark", theme.appearance === "dark");
  root.style.colorScheme = theme.appearance;
  document.body.style.backgroundColor = theme.colors.background;
  window.dispatchEvent(new CustomEvent("scribe-theme-change", { detail: theme.id }));
}
