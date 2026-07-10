import {
  isEditSuggestion,
  type EditSuggestion,
  type SuggestionItem,
} from "../../../domain/suggestions/schema";
import type { WritingBlock, WritingEditor, WritingPartialBlock } from "./schema";

export type EditSuggestionStatus =
  | { enabled: true; blockId: string; start: number; end: number }
  | { enabled: false; reason: "missing" | "ambiguous" | "unsupported" };
export type EditSuggestionDisabledReason = Extract<
  EditSuggestionStatus,
  { enabled: false }
>["reason"];

/**
 * What: extracts visible text from BlockNote-ish content values.
 *
 * Why: edit suggestions are anchored to exact current document text.
 * Called when: used by edit suggestion status, preview, and accept behavior.
 */
export function plainTextFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(plainTextFromContent).join("");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if ("content" in record) return plainTextFromContent(record.content);
  }
  return "";
}

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
  const matches: Array<{ block: WritingBlock; start: number; end: number }> = [];
  for (const block of editor.document) {
    if (block.type === "suggestionPreview") continue;
    const text = plainTextFromContent(block.content);
    let from = 0;
    while (from <= text.length) {
      const index = text.indexOf(item.sourceText, from);
      if (index < 0) break;
      matches.push({ block, start: index, end: index + item.sourceText.length });
      from = index + Math.max(item.sourceText.length, 1);
      if (matches.length > 1) return { enabled: false, reason: "ambiguous" };
    }
  }

  if (matches.length !== 1) return { enabled: false, reason: "missing" };
  const match = matches[0]!;
  return {
    enabled: true,
    blockId: match.block.id,
    start: match.start,
    end: match.end,
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
