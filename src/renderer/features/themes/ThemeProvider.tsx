import { useCallback, useMemo, useState, type ReactNode } from "react";

import type { DesktopBridge, ThemeCatalog } from "../../../contracts/desktop-bridge";
import { applyTheme } from "./themeRuntime";

import { ThemeContext } from "./useTheme";

export function ThemeProvider({ desktop, initialCatalog, children }: {
  desktop: DesktopBridge;
  initialCatalog: ThemeCatalog;
  children: ReactNode;
}) {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string>();
  const selectTheme = useCallback(async (themeId: string) => {
    if (themeId === catalog.activeThemeId || selecting) return;
    setSelecting(true);
    setError(undefined);
    try {
      const next = await desktop.selectTheme({ themeId });
      const theme = next.themes.find((candidate) => candidate.id === next.activeThemeId);
      if (!theme) throw new Error(`Selected theme is absent from catalog: ${next.activeThemeId}`);
      applyTheme(theme);
      setCatalog(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSelecting(false);
    }
  }, [catalog.activeThemeId, desktop, selecting]);
  const activeTheme = catalog.themes.find((theme) => theme.id === catalog.activeThemeId);
  if (!activeTheme) throw new Error(`Active theme is absent from catalog: ${catalog.activeThemeId}`);
  const value = useMemo(() => ({ catalog, activeTheme, selecting, error, selectTheme }),
    [activeTheme, catalog, error, selectTheme, selecting]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
