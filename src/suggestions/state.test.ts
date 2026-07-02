import { describe, expect, it } from "vitest";

import {
  createEmptySuggestionState,
  SUGGESTION_ENTRY_LIMIT,
  trimSuggestionEntries,
  type PersistedInboxEntry,
} from "./state";
import {
  isMindMapSuggestion,
  isStructureSuggestion,
  isStructureSuggestionKind,
  isSuggestionKind,
  isTextSuggestion,
  isTextSuggestionKind,
  isVisualSuggestion,
  type SuggestionItem,
  type TextSuggestion,
} from "./types";

function entry(index: number, viewed = false): PersistedInboxEntry {
  const item: TextSuggestion = {
    id: `item-${index}`,
    dedupeKey: `item-${index}`,
    kind: "snippet",
    title: `Item ${index}`,
    summary: "Summary",
    body: "Body",
    insertText: "Text",
    sourceLabels: [],
    createdAt: index,
  };
  return { item, viewed, stale: false, withdrawn: false };
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
  const text = entry(1).item;
  const structure: SuggestionItem = {
    ...text,
    kind: "outline",
    nodes: [{ id: "node", label: "Node" }],
  };
  const mindMap: SuggestionItem = {
    ...text,
    kind: "mindMap",
    mermaidSource: "mindmap\n root((Idea))",
    accessibleDescription: "An idea",
  };

  it("recognizes canonical kind families", () => {
    expect(isSuggestionKind("mindMap")).toBe(true);
    expect(isSuggestionKind("unknown")).toBe(false);
    expect(isTextSuggestionKind("fact")).toBe(true);
    expect(isTextSuggestionKind("layout")).toBe(false);
    expect(isStructureSuggestionKind("layout")).toBe(true);
  });

  it("narrows suggestion items for text, structure, and visual rendering", () => {
    expect(isTextSuggestion(text)).toBe(true);
    expect(isStructureSuggestion(structure)).toBe(true);
    expect(isMindMapSuggestion(mindMap)).toBe(true);
    expect(isVisualSuggestion(text)).toBe(false);
    expect(isVisualSuggestion(structure)).toBe(true);
    expect(isVisualSuggestion(mindMap)).toBe(true);
  });
});
