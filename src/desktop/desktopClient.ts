import type { DesktopBridge, DesktopEvent } from "../shared/desktop";
import type { SuggestionEvent, SuggestionFeed } from "../suggestions/types";

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
      return bridge.subscribe((event: DesktopEvent) => {
        let suggestionEvent: SuggestionEvent | undefined;
        if (event.type === "suggestion.event") {
          suggestionEvent = event.event;
        } else if (event.type === "agent.runtime") {
          if (event.runtime.status === "error" && event.runtime.error) {
            suggestionEvent = {
              type: "agent.error",
              message: event.runtime.error,
              recoverable: true,
            };
          } else {
            suggestionEvent = {
              type: "agent.status",
              status: event.runtime.status,
            };
          }
        }
        if (suggestionEvent) listener(suggestionEvent);
      });
    },
  };
}
