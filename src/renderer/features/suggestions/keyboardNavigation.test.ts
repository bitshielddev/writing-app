import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { InboxEntry, PinnedInboxEntry } from "./inbox";
import { useSuggestionKeyboardNavigation } from "./keyboardNavigation";
import type { TextSuggestion } from "../../../domain/suggestions/schema";

/**
 * What: performs the entry step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by keyboardNavigation when that path needs this behavior.
 */
function entry(id: string): InboxEntry {
  const item: TextSuggestion = {
    id,
    dedupeKey: id,
    kind: "snippet",
    title: id,
    summary: id,
    body: id,
    insertText: id,
    sourceLabels: [],
    createdAt: 1,
  };
  return { item, viewed: false, stale: false, withdrawn: false };
}

describe("suggestion keyboard navigation", () => {
  it("moves through Pins before the live inbox and stops at boundaries", () => {
    const onSelect = vi.fn();
    const pinned = { ...entry("pinned"), pinnedAt: 1 } as PinnedInboxEntry;
    const { result } = renderHook(() =>
      useSuggestionKeyboardNavigation({
        pinnedEntries: [pinned],
        entries: [entry("live")],
        onSelect,
      }),
    );

    act(() => expect(result.current.move(1)).toEqual({ status: "moved" }));
    expect(result.current.targetId).toBe("pinned");
    act(() => expect(result.current.move(1)).toEqual({ status: "moved" }));
    expect(result.current.targetId).toBe("live");
    expect(result.current.move(1)).toEqual({
      status: "boundary",
      edge: "last",
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects adjacent detail entries and identifies removal neighbors", () => {
    const onSelect = vi.fn();
    const first = entry("first");
    const second = entry("second");
    const { result } = renderHook(() =>
      useSuggestionKeyboardNavigation({
        pinnedEntries: [],
        entries: [first, second],
        selectedId: "first",
        onSelect,
      }),
    );

    act(() => result.current.move(1));
    expect(onSelect).toHaveBeenCalledWith("second");
    expect(result.current.neighborAfterRemoval("first")).toBe("second");
    expect(result.current.neighborAfterRemoval("second")).toBe("first");
  });
});
