import { subscribeToMockSuggestions } from "../dev/mockSuggestions/mockSuggestionChannel";
import type {
  AgentContextSource,
  SuggestionEvent,
  SuggestionFeed,
} from "./types";

export function createMockSuggestionFeed(
  context: AgentContextSource,
): SuggestionFeed {
  void context;
  const listeners = new Set<(event: SuggestionEvent) => void>();
  let stopInjectedSuggestions: (() => void) | undefined;

  const emit = (event: SuggestionEvent) => {
    listeners.forEach((listener) => listener(event));
  };

  const start = () => {
    stopInjectedSuggestions = subscribeToMockSuggestions(emit);
  };

  const stop = () => {
    stopInjectedSuggestions?.();
    stopInjectedSuggestions = undefined;
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
    async sendSteering(prompt) {
      void prompt;
      // Manual mock mode deliberately produces no steering response.
    },
    async retry() {
      // There is no remote operation to retry in manual mock mode.
    },
  };
}
