import { useCallback, useState } from "react";

import {
  acceptEditSuggestion,
  previewEditSuggestion,
} from "../editor/editSuggestions";
import type { WritingEditor } from "../editor/schema";
import {
  isEditSuggestion,
  type SuggestionItem,
} from "../../../domain/suggestions/schema";

type Options = {
  editor: WritingEditor;
  markViewed(id: string): void;
  previewResolved(id: string, outcome: "accepted" | "cancelled"): void;
  documentChanged(): void;
};

/**
 * What: coordinates preview controller state, side effects, and callbacks for the renderer workflow.
 *
 * Why: workspace views and controllers need one source for selection, layout, and persistence behavior.
 * Called when: used by useWorkspaceController and workspaceServices when that path needs this behavior.
 */
export function usePreviewController({
  editor,
  markViewed,
  previewResolved,
  documentChanged,
}: Options) {
  const [lastActiveBlockId, setLastActiveBlockId] = useState(() => {
    try {
      return editor.getTextCursorPosition().block.id;
    } catch {
      return editor.document.at(-1)?.id;
    }
  });

  const initialize = useCallback(() => {
    const finalBlock = editor.document.at(-1);
    if (finalBlock) setLastActiveBlockId(finalBlock.id);
  }, [editor]);

  const handleSelectionChange = useCallback(() => {
    try {
      setLastActiveBlockId(editor.getTextCursorPosition().block.id);
    } catch {
      // Block selections briefly have no text cursor.
    }
  }, [editor]);

  const preview = useCallback(
    (item: SuggestionItem) => {
      if (!isEditSuggestion(item)) return false;
      const didPreview = previewEditSuggestion(editor, item);
      if (didPreview) markViewed(item.id);
      return didPreview;
    },
    [editor, markViewed],
  );

  const accept = useCallback(
    (item: SuggestionItem) => {
      if (!isEditSuggestion(item)) return false;
      const didAccept = acceptEditSuggestion(editor, item);
      if (!didAccept) return false;
      documentChanged();
      previewResolved(item.id, "accepted");
      return true;
    },
    [documentChanged, editor, previewResolved],
  );

  return { preview, accept, handleSelectionChange, initialize, lastActiveBlockId };
}
