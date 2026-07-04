import type { DesktopBridge } from "../shared/desktop";
import type {
  SuggestionEvent,
  SuggestionFeed,
} from "../suggestions/types";

export function getDesktopBridge(): DesktopBridge {
  const bridge = window.scribe;
  if (!bridge) {
    throw new Error("ScribeAI requires the Electron desktop runtime.");
  }
  return bridge;
}

export function createSuggestionFeedRelay(): {
  feed: SuggestionFeed;
  emit: (event: SuggestionEvent) => void;
} {
  const listeners = new Set<(event: SuggestionEvent) => void>();
  return {
    feed: {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    emit(event) {
      listeners.forEach((listener) => listener(event));
    },
  };
}
