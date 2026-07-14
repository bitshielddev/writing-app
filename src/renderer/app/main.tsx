import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { RuntimeRequired } from "./RuntimeRequired";
import { getDesktopBridge } from "../platform/electron/desktopClient";
import { markPerformance, PERFORMANCE_MARKS } from "../platform/performance/marks";
import "../index.css";
import { ThemeProvider } from "../features/themes/ThemeProvider";
import { applyTheme } from "../features/themes/themeRuntime";

markPerformance(PERFORMANCE_MARKS.bootstrap);

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}
const rootContainer = rootElement;

async function mount() {
  let rootView;
  try {
    const desktop = getDesktopBridge();
    const catalog = await desktop.getThemeCatalog();
    const activeTheme = catalog.themes.find((theme) => theme.id === catalog.activeThemeId);
    if (!activeTheme) throw new Error(`Active theme is absent from catalog: ${catalog.activeThemeId}`);
    applyTheme(activeTheme);
    rootView = <ThemeProvider desktop={desktop} initialCatalog={catalog}><App desktop={desktop} /></ThemeProvider>;
  } catch (error) {
    rootView = <RuntimeRequired message={error instanceof Error ? error.message : String(error)} />;
  }
  createRoot(rootContainer).render(<StrictMode>{rootView}</StrictMode>);
}

void mount();
