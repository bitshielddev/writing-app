import { describe, expect, it } from "vitest";

import {
  createEmptySuggestionState,
  SUGGESTION_ENTRY_LIMIT,
  trimSuggestionEntries,
  type PersistedInboxEntry,
} from "./state";
import {
  isDiagramSuggestion,
  isEditSuggestion,
  isEditSuggestionKind,
  isNoteSuggestion,
  isSuggestionKind,
  isVisualSuggestion,
  type EditSuggestion,
  type SuggestionItem,
} from "./schema";

/**
 * What: performs the entry step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by state when that path needs this behavior.
 */
function entry(index: number, viewed = false): PersistedInboxEntry {
  const item: EditSuggestion = {
    id: `item-${index}`,
    dedupeKey: `item-${index}`,
    kind: "edit",
    title: `Item ${index}`,
    summary: "Summary",
    body: "Body",
    sourceText: "Source text",
    newText: "New text",
    sourceLabels: [],
    createdAt: index,
  };
  return { item, viewed };
}

describe("shared suggestion state policy", () => {
  it("creates a fresh compatible empty projection", () => {
    const first = createEmptySuggestionState();
    const second = createEmptySuggestionState();

    expect(first).toEqual({
      entries: [],
      pinnedEntries: [],
      workspacePins: [],
      seenKeys: {},
      nextZIndex: 1,
    });
    expect(first.entries).not.toBe(second.entries);
  });

  it("evicts viewed entries before older unread entries", () => {
    const entries = Array.from(
      { length: SUGGESTION_ENTRY_LIMIT + 2 },
      (_, index) => entry(index, index === 10),
    );
    const trimmed = trimSuggestionEntries(entries);

    expect(trimmed).toHaveLength(SUGGESTION_ENTRY_LIMIT);
    expect(trimmed.some((item) => item.item.id === "item-10")).toBe(false);
    expect(trimmed.some((item) => item.item.id === "item-0")).toBe(false);
  });

  it("does not evict protected selections or previews", () => {
    const entries = Array.from(
      { length: SUGGESTION_ENTRY_LIMIT + 1 },
      (_, index) => entry(index, index < 2),
    );
    const trimmed = trimSuggestionEntries(entries, ["item-0"]);

    expect(trimmed).toHaveLength(SUGGESTION_ENTRY_LIMIT);
    expect(trimmed.some((item) => item.item.id === "item-0")).toBe(true);
    expect(trimmed.some((item) => item.item.id === "item-1")).toBe(false);
  });
});

describe("suggestion kind guards", () => {
  const edit = entry(1).item;
  const note: SuggestionItem = {
    id: "note",
    dedupeKey: "note",
    kind: "note",
    title: "Note",
    summary: "Summary",
    body: "Body",
    sourceLabels: [],
    createdAt: 2,
  };
  const diagram: SuggestionItem = {
    ...note,
    kind: "diagram",
    mermaidSource: "flowchart TD\n Idea[Idea]",
    accessibleDescription: "An idea",
  };

  it("recognizes canonical kind families", () => {
    expect(isSuggestionKind("diagram")).toBe(true);
    expect(isSuggestionKind("unknown")).toBe(false);
    expect(isEditSuggestionKind("edit")).toBe(true);
    expect(isEditSuggestionKind("note")).toBe(false);
  });

  it("narrows suggestion items for edit, note, diagram, and visual rendering", () => {
    expect(isEditSuggestion(edit)).toBe(true);
    expect(isNoteSuggestion(note)).toBe(true);
    expect(isDiagramSuggestion(diagram)).toBe(true);
    expect(isVisualSuggestion(edit)).toBe(false);
    expect(isVisualSuggestion(note)).toBe(false);
    expect(isVisualSuggestion(diagram)).toBe(true);
  });
});
