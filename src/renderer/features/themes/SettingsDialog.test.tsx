import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createThemeCatalog, DesktopBridgeHarness } from "../../../test/desktopBridgeHarness";
import { ThemeProvider } from "./ThemeProvider";
import { SettingsDialog } from "./SettingsDialog";

describe("SettingsDialog", () => {
  it("uses the shared modal behavior and applies a selected theme immediately", async () => {
    const user = userEvent.setup();
    const desktop = new DesktopBridgeHarness();
    const light = createThemeCatalog().themes[0];
    const nord = { ...light, id: "nord", display_name: "Nord", appearance: "dark" as const,
      colors: { ...light.colors, background: "#2e3440", foreground: "#eceff4" } };
    const catalog = { activeThemeId: light.id, themes: [light, nord] };
    desktop.bridge.selectTheme = vi.fn(async () => ({ ...catalog, activeThemeId: "nord" }));

    render(<ThemeProvider desktop={desktop.bridge} initialCatalog={catalog}>
      <SettingsDialog open onClose={vi.fn()} />
    </ThemeProvider>);

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /Nord/ }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("nord"));
    expect(document.documentElement.dataset.appearance).toBe("dark");
    expect(desktop.bridge.selectTheme).toHaveBeenCalledWith({ themeId: "nord" });
  });
});
