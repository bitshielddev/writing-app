import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createEmptySuggestionState } from "./state";
import type { SuggestionEvent, SuggestionFeed, TextSuggestion } from "./types";
import { useSuggestionInbox } from "./useSuggestionInbox";

class FeedHarness implements SuggestionFeed {
  private readonly listeners = new Set<(event: SuggestionEvent) => void>();

  subscribe(listener: (event: SuggestionEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: SuggestionEvent) {
    this.listeners.forEach((listener) => listener(event));
  }

  get listenerCount() {
    return this.listeners.size;
  }
}

const item: TextSuggestion = {
  id: "item-1",
  dedupeKey: "item-1",
  kind: "snippet",
  title: "Suggestion",
  summary: "Summary",
  body: "Body",
  insertText: "Insert",
  sourceLabels: [],
  createdAt: 1,
};

describe("useSuggestionInbox", () => {
  it("subscribes once, cleans up, and waits for hydration before persisting", () => {
    const feed = new FeedHarness();
    const onStateChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useSuggestionInbox(feed, { onStateChange }),
    );

    expect(feed.listenerCount).toBe(1);
    expect(onStateChange).not.toHaveBeenCalled();

    act(() => result.current.hydrate(createEmptySuggestionState()));
    expect(onStateChange).toHaveBeenCalledTimes(1);

    act(() => feed.emit({ type: "suggestion.added", item }));
    expect(onStateChange).toHaveBeenCalledTimes(2);
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ entries: [expect.objectContaining({ item })] }),
    );

    unmount();
    expect(feed.listenerCount).toBe(0);
  });

  it("does not persist transitions that only change ephemeral selection state", () => {
    const feed = new FeedHarness();
    const onStateChange = vi.fn();
    const { result } = renderHook(() => useSuggestionInbox(feed, { onStateChange }));
    act(() => result.current.hydrate(createEmptySuggestionState()));
    act(() => feed.emit({ type: "suggestion.added", item }));
    act(() => result.current.select(item.id));
    expect(onStateChange).toHaveBeenCalledTimes(3);

    act(() => result.current.back());
    expect(onStateChange).toHaveBeenCalledTimes(3);
  });
});
