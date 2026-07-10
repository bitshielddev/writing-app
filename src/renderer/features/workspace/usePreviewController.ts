import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeToPreviewResolutions } from "../editor/previewEvents";
import type { WritingEditor } from "../editor/schema";
import {
  supportsSuggestionPreview,
  type SuggestionItem,
} from "../../../domain/suggestions/schema";

type Options = {
  editor: WritingEditor;
  activePreviewId?: string;
  previewStarted(id: string): void;
  previewResolved(id: string, outcome: "accepted" | "cancelled"): void;
};

/**
 * What: coordinates preview controller state, side effects, and callbacks for the renderer workflow.
 *
 * Why: workspace views and controllers need one source for selection, layout, and persistence behavior.
 * Called when: used by useWorkspaceController and workspaceServices when that path needs this behavior.
 */
export function usePreviewController({
  editor,
  activePreviewId,
  previewStarted,
  previewResolved,
}: Options) {
  const [lastActiveBlockId, setLastActiveBlockId] = useState(() => {
    try {
      return editor.getTextCursorPosition().block.id;
    } catch {
      return editor.document.at(-1)?.id;
    }
  });
  const activePreviewRef = useRef(activePreviewId);
  useEffect(() => {
    activePreviewRef.current = activePreviewId;
  }, [activePreviewId]);

  const initialize = useCallback(() => {
    const finalBlock = editor.document.at(-1);
    if (finalBlock) setLastActiveBlockId(finalBlock.id);
  }, [editor]);

  useEffect(
    () =>
      subscribeToPreviewResolutions(({ suggestionId, outcome }) => {
        previewResolved(suggestionId, outcome);
      }),
    [previewResolved],
  );

  useEffect(
    () => () => {
      const id = activePreviewRef.current;
      if (!id) return;
      const blocks = editor.document.filter(
        (block) =>
          block.type === "suggestionPreview" &&
          block.props.suggestionId === id,
      );
      if (blocks.length) editor.removeBlocks(blocks.map((block) => block.id));
    },
    [editor],
  );

  const handleSelectionChange = useCallback(() => {
    try {
      setLastActiveBlockId(editor.getTextCursorPosition().block.id);
    } catch {
      // Block selections briefly have no text cursor.
    }
  }, [editor]);

  const preview = useCallback(
    (item: SuggestionItem) => {
      if (activePreviewId || !supportsSuggestionPreview(item)) return;
      const acceptedBlocks = editor.document.filter(
        (block) => block.type !== "suggestionPreview",
      );
      const referenceBlock =
        acceptedBlocks.find((block) => block.id === lastActiveBlockId) ??
        acceptedBlocks.at(-1);
      if (!referenceBlock) return;
      const block = editor.insertBlocks(
        [
          {
            type: "suggestionPreview",
            props: { suggestionId: item.id, targetBlockId: referenceBlock.id },
            content: item.insertText,
          },
        ],
        referenceBlock,
        "after",
      )[0];
      if (!block) return;
      previewStarted(item.id);
      editor.setTextCursorPosition(block.id, "end");
      window.requestAnimationFrame(() => {
        document
          .querySelector(
            `[data-content-type="suggestionPreview"][data-suggestion-id="${item.id}"]`,
          )
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    },
    [activePreviewId, editor, lastActiveBlockId, previewStarted],
  );

  return { preview, handleSelectionChange, initialize };
}
