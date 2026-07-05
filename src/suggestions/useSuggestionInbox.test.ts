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
  it("subscribes once, cleans up, and emits durable commands", () => {
    const feed = new FeedHarness();
    const onCommand = vi.fn();
    const { result, unmount } = renderHook(() =>
      useSuggestionInbox(feed, { onCommand }),
    );

    expect(feed.listenerCount).toBe(1);
    act(() => result.current.hydrate(createEmptySuggestionState()));
    act(() => feed.emit({ type: "suggestion.added", item }));
    act(() => result.current.pin(item.id));
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ type: "pin", suggestionId: item.id }));

    unmount();
    expect(feed.listenerCount).toBe(0);
  });

  it("persists viewed state but not back navigation", () => {
    const feed = new FeedHarness();
    const onCommand = vi.fn();
    const { result } = renderHook(() => useSuggestionInbox(feed, { onCommand }));
    act(() => result.current.hydrate(createEmptySuggestionState()));
    act(() => feed.emit({ type: "suggestion.added", item }));
    act(() => result.current.select(item.id));
    expect(onCommand).toHaveBeenCalledWith({ type: "markViewed", suggestionId: item.id });

    act(() => result.current.back());
    expect(onCommand).toHaveBeenCalledTimes(1);
  });
});
