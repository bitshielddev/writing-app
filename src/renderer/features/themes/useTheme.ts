import { createContext, useContext } from "react";

import type { ThemeCatalog, ThemeDefinition } from "../../../contracts/desktop-bridge";

export type ThemeContextValue = {
  catalog: ThemeCatalog;
  activeTheme: ThemeDefinition;
  selecting: boolean;
  error?: string;
  selectTheme: (themeId: string) => Promise<void>;
};

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
