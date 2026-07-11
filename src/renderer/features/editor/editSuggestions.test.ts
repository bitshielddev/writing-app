import { describe, expect, it, vi } from "vitest";

import type { EditSuggestion } from "../../../domain/suggestions/schema";
import type { WritingEditor } from "./schema";
import {
  acceptEditSuggestion,
  getEditSuggestionStatus,
  previewEditSuggestion,
} from "./editSuggestions";

const item: EditSuggestion = {
  id: "edit",
  dedupeKey: "edit",
  kind: "edit",
  title: "Edit",
  summary: "Summary",
  body: "Body",
  sourceDocumentRevision: 1,
  sourceBlockId: "block-0",
  sourceStart: 7,
  sourceEnd: 18,
  sourceText: "target text",
  newText: "replacement text",
  sourceLabels: [],
  createdAt: 1,
};

function editorWith(contents: string[]) {
  const state = {
    document: contents.map((content, index) => ({
      id: `block-${index}`,
      type: "paragraph",
      content,
    })),
  };
  const editor = {
    get document() {
      return state.document;
    },
    replaceBlocks: vi.fn((ids: string[], blocks: typeof state.document) => {
      const index = state.document.findIndex((block) => block.id === ids[0]);
      state.document.splice(index, 1, ...blocks);
      return { insertedBlocks: blocks, removedBlocks: [] };
    }),
    setTextCursorPosition: vi.fn(),
  } as unknown as WritingEditor;
  return { editor, state };
}

describe("edit suggestion matching", () => {
  it("enables an edit when the anchored range still matches", () => {
    const { editor } = editorWith(["before target text after"]);

    expect(getEditSuggestionStatus(editor, item)).toMatchObject({
      enabled: true,
      blockId: "block-0",
    });
  });

  it("disables an edit when the anchored block is missing", () => {
    const { editor } = editorWith(["before target text after"]);

    expect(getEditSuggestionStatus(editor, { ...item, sourceBlockId: "missing" }))
      .toEqual({ enabled: false, reason: "missing" });
  });

  it("disables an edit when the anchored text changed", () => {
    const { editor } = editorWith(["before changed text after"]);

    expect(getEditSuggestionStatus(editor, item)).toEqual({
      enabled: false,
      reason: "missing",
    });
  });

  it("keeps an edit enabled when the same source text appears elsewhere", () => {
    const { editor, state } = editorWith(["before target text after"]);
    state.document.unshift({ id: "new-block", type: "paragraph", content: "target text" });

    expect(getEditSuggestionStatus(editor, item)).toMatchObject({
      enabled: true,
      blockId: "block-0",
    });
  });

  it("previews without mutating and accepts by replacing the source", () => {
    const { editor, state } = editorWith(["before target text after"]);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    expect(previewEditSuggestion(editor, item)).toBe(true);
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith("block-0", "start");
    expect(state.document[0]?.content).toBe("before target text after");

    expect(acceptEditSuggestion(editor, item)).toBe(true);
    expect(state.document[0]?.content).toBe("before replacement text after");
  });
});
