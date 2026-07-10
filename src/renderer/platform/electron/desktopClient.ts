import type { DesktopBridge } from "../../../contracts/desktop-bridge";

/**
 * What: reads desktop bridge for callers that need the derived value.
 *
 * Why: renderer platform adapters need to isolate Electron and browser runtime details.
 * Called when: used by main when that path needs this behavior.
 */
export function getDesktopBridge(): DesktopBridge {
  const bridge = window.scribe;
  if (!bridge) {
    throw new Error("ScribeAI requires the Electron desktop runtime.");
  }
  return bridge;
}
