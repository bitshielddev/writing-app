import type { DesktopBridge, DesktopEvent } from "../shared/desktop";
import type { SuggestionEvent, SuggestionFeed } from "../suggestions/types";

export function getDesktopBridge(): DesktopBridge | undefined {
  return window.scribe;
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
          if (event.runtime.lastError) {
            suggestionEvent = {
              type: "agent.error",
              message: event.runtime.lastError,
              recoverable: true,
            };
          } else {
            suggestionEvent = {
              type: "agent.status",
              status: event.runtime.running
                ? "working"
                : event.runtime.configured
                  ? "idle"
                  : "offline",
            };
          }
        }
        if (suggestionEvent) listener(suggestionEvent);
      });
    },
  };
}
