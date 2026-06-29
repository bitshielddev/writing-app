import type { SuggestionEvent, SuggestionItem } from "../../suggestions/types";
import { isSuggestionItem } from "./mockSuggestionValidation";

export const MOCK_SUGGESTION_PATH = "/mock-suggestions";

const CHANNEL_NAME = "scribe-mock-suggestion-injection";

type AddedSuggestionEvent = Extract<
  SuggestionEvent,
  { type: "suggestion.added" }
>;

export type MockSuggestionPublisher = {
  publish(item: SuggestionItem): void;
  close(): void;
};

function isAddedSuggestionEvent(value: unknown): value is AddedSuggestionEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { type?: unknown; item?: unknown };
  return (
    candidate.type === "suggestion.added" && isSuggestionItem(candidate.item)
  );
}

export function createMockSuggestionPublisher(): MockSuggestionPublisher | null {
  if (typeof BroadcastChannel === "undefined") {
    return null;
  }

  const channel = new BroadcastChannel(CHANNEL_NAME);
  return {
    publish(item) {
      channel.postMessage({ type: "suggestion.added", item } satisfies AddedSuggestionEvent);
    },
    close() {
      channel.close();
    },
  };
}

export function subscribeToMockSuggestions(
  listener: (event: AddedSuggestionEvent) => void,
): () => void {
  if (typeof BroadcastChannel === "undefined") {
    return () => undefined;
  }

  const channel = new BroadcastChannel(CHANNEL_NAME);
  const handleMessage = (message: MessageEvent<unknown>) => {
    if (isAddedSuggestionEvent(message.data)) {
      listener(message.data);
    }
  };

  channel.addEventListener("message", handleMessage);
  return () => {
    channel.removeEventListener("message", handleMessage);
    channel.close();
  };
}
