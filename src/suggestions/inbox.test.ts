import { describe, expect, it } from "vitest";

import { createEmptySuggestionState } from "../domain/suggestions/state";
import {
  presentInboxEntry,
  selectSortedInboxEntries,
  selectSortedPinnedEntries,
  selectUnreadCount,
} from "./inboxReducer";
import type { TextSuggestion } from "../domain/suggestions/schema";

const item = (id: string, createdAt: number): TextSuggestion => ({
  id, dedupeKey: id, kind: "snippet", title: id, summary: "Summary",
  body: "Body", insertText: "Text", sourceLabels: [], createdAt,
});

describe("suggestion presentation selectors", () => {
  it("sorts durable entries and adds transient flags only to the view", () => {
    const state = createEmptySuggestionState();
    state.entries = [
      { item: item("viewed", 3), viewed: true },
      { item: item("older", 1), viewed: false },
      { item: item("newer", 2), viewed: false },
    ];
    const entries = selectSortedInboxEntries(state, {
      id: "newer", stale: true, withdrawn: false,
    });

    expect(entries.map((entry) => entry.item.id)).toEqual(["newer", "older", "viewed"]);
    expect(entries[0]).toMatchObject({ stale: true, withdrawn: false });
    expect(state.entries[1]).not.toHaveProperty("stale");
    expect(selectUnreadCount(state)).toBe(2);
  });

  it("sorts pins without persisting presentation state", () => {
    const state = createEmptySuggestionState();
    state.pinnedEntries = [
      { item: item("first", 1), viewed: true, pinnedAt: 1 },
      { item: item("second", 2), viewed: false, pinnedAt: 2 },
    ];
    expect(selectSortedPinnedEntries(state).map((entry) => entry.item.id))
      .toEqual(["second", "first"]);
    expect(presentInboxEntry(state.pinnedEntries[0]!))
      .toMatchObject({ stale: false, withdrawn: false });
  });
});
