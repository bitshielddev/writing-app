import type { DesktopBridge } from "../shared/desktop";
import type { SuggestionFeed } from "../suggestions/types";

export function getDesktopBridge(): DesktopBridge {
  const bridge = window.scribe;
  if (!bridge) {
    throw new Error("ScribeAI requires the Electron desktop runtime.");
  }
  return bridge;
}

export function createDesktopSuggestionFeed(
  bridge: DesktopBridge,
): SuggestionFeed {
  return {
    subscribe(listener) {
      return bridge.subscribe((event) => {
        if (event.type === "suggestion.event") listener(event.event);
      });
    },
  };
}
