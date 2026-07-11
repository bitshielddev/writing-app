import {
  isEditSuggestion,
  type EditSuggestion,
  type SuggestionItem,
} from "../../../domain/suggestions/schema";
import { plainTextFromContent } from "../../../domain/document/plain-text";
import type { WritingEditor, WritingPartialBlock } from "./schema";

export type EditSuggestionStatus =
  | { enabled: true; blockId: string; start: number; end: number }
  | { enabled: false; reason: "missing" | "ambiguous" | "unsupported" };
export type EditSuggestionDisabledReason = Extract<
  EditSuggestionStatus,
  { enabled: false }
>["reason"];

/**
 * What: determines whether an edit suggestion still has one exact target.
 *
 * Why: edits must survive text movement but disable when the target text changes or becomes ambiguous.
 * Called when: used by dock rendering, keybindings, preview, and accept behavior.
 */
export function getEditSuggestionStatus(
  editor: WritingEditor,
  item: EditSuggestion,
): EditSuggestionStatus {
  const match = editor.document.find((block) =>
    block.type !== "suggestionPreview" && block.id === item.sourceBlockId);
  if (!match) return { enabled: false, reason: "missing" };
  const text = plainTextFromContent(match.content);
  if (item.sourceEnd < item.sourceStart || item.sourceEnd > text.length) {
    return { enabled: false, reason: "missing" };
  }
  if (text.slice(item.sourceStart, item.sourceEnd) !== item.sourceText) {
    return { enabled: false, reason: "missing" };
  }
  return {
    enabled: true,
    blockId: match.id,
    start: item.sourceStart,
    end: item.sourceEnd,
  };
}

/**
 * What: previews an edit by focusing and scrolling to its current target block.
 *
 * Why: edit preview is non-mutating; the dock diff remains the source of visible change detail.
 * Called when: used by useWorkspaceController when a writer previews an edit.
 */
export function previewEditSuggestion(editor: WritingEditor, item: EditSuggestion): boolean {
  const status = getEditSuggestionStatus(editor, item);
  if (!status.enabled) return false;
  try {
    editor.setTextCursorPosition(status.blockId, "start");
  } catch {
    return false;
  }
  window.requestAnimationFrame(() => {
    const escaped = globalThis.CSS?.escape?.(status.blockId) ?? status.blockId;
    document
      .querySelector(`[data-id="${escaped}"], [data-block-id="${escaped}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  return true;
}

/**
 * What: accepts an edit by replacing the current exact source text.
 *
 * Why: accepting an edit must fail closed if the target changed after the UI rendered.
 * Called when: used by useWorkspaceController when a writer accepts an edit.
 */
export function acceptEditSuggestion(editor: WritingEditor, item: EditSuggestion): boolean {
  const status = getEditSuggestionStatus(editor, item);
  if (!status.enabled) return false;
  const block = editor.document.find((candidate) => candidate.id === status.blockId);
  if (!block || block.type === "suggestionPreview") return false;
  const text = plainTextFromContent(block.content);
  const nextText = `${text.slice(0, status.start)}${item.newText}${text.slice(status.end)}`;
  const replacement = { ...block, content: nextText } as unknown as WritingPartialBlock;
  const result = editor.replaceBlocks([block.id], [replacement]);
  const acceptedBlock = result.insertedBlocks[0];
  if (acceptedBlock) {
    try {
      editor.setTextCursorPosition(acceptedBlock.id, "end");
    } catch {
      // Focus restoration is best-effort; the edit itself has already been applied.
    }
  }
  return true;
}

export function getSuggestionDisabledReason(
  editor: WritingEditor,
  item: SuggestionItem,
): EditSuggestionDisabledReason | undefined {
  if (!isEditSuggestion(item)) return undefined;
  const status = getEditSuggestionStatus(editor, item);
  if (status.enabled) return undefined;
  return status.reason;
}
