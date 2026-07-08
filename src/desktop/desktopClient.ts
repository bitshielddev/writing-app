import type { DesktopBridge } from "../shared/desktop";

export function getDesktopBridge(): DesktopBridge {
  const bridge = window.scribe;
  if (!bridge) {
    throw new Error("ScribeAI requires the Electron desktop runtime.");
  }
  return bridge;
}
