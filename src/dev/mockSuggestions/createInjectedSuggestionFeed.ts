import type {
  SuggestionEvent,
  SuggestionFeed,
} from "../../suggestions/types";
import { subscribeToMockSuggestions } from "./mockSuggestionChannel";

export function createInjectedSuggestionFeed(): SuggestionFeed {
  const listeners = new Set<(event: SuggestionEvent) => void>();
  let stopChannel: (() => void) | undefined;

  const start = () => {
    stopChannel = subscribeToMockSuggestions((event) => {
      listeners.forEach((listener) => listener(event));
    });
  };

  const stop = () => {
    stopChannel?.();
    stopChannel = undefined;
  };

  return {
    subscribe(listener) {
      const shouldStart = listeners.size === 0;
      listeners.add(listener);
      if (shouldStart) {
        start();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop();
        }
      };
    },
  };
}
