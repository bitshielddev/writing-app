import {
  BlockNoteSchema,
  defaultBlockSpecs,
  type BlockNoteEditor,
  type PartialBlock,
} from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { Check, Sparkles, X } from "lucide-react";

import { emitPreviewResolution } from "./previewEvents";

function hasVisibleContent(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some(hasVisibleContent);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return hasVisibleContent(record.text) || hasVisibleContent(record.content);
  }
  return false;
}

const suggestionPreviewBlock = createReactBlockSpec(
  {
    type: "suggestionPreview",
    propSchema: {
      suggestionId: { default: "" },
      targetBlockId: { default: "" },
    },
    content: "inline",
  },
  {
    render: ({ block, editor, contentRef }) => {
      const resolve = (outcome: "accepted" | "cancelled") => {
        const fullEditor = editor as unknown as BlockNoteEditor;
        if (outcome === "accepted") {
          const { insertedBlocks } = fullEditor.replaceBlocks(
            [block.id],
            [
              {
                type: "paragraph",
                content: block.content,
              } as unknown as PartialBlock,
            ],
          );
          const acceptedBlock = insertedBlocks[0];
          if (acceptedBlock) {
            fullEditor.setTextCursorPosition(acceptedBlock.id, "end");
          }
        } else {
          fullEditor.removeBlocks([block.id]);
          try {
            fullEditor.setTextCursorPosition(block.props.targetBlockId, "end");
          } catch {
            const finalBlock = fullEditor.document.at(-1);
            if (finalBlock) {
              fullEditor.setTextCursorPosition(finalBlock.id, "end");
            }
          }
        }

        emitPreviewResolution({
          suggestionId: block.props.suggestionId,
          outcome,
        });
      };

      return (
        <div className="suggestion-preview-shell">
          <div className="suggestion-preview-label" contentEditable={false}>
            <Sparkles aria-hidden="true" />
            <span>Editable agent draft</span>
          </div>
          <div
            ref={contentRef}
            className="suggestion-preview-content"
            aria-label="Editable suggestion preview"
          />
          <div
            className="suggestion-preview-actions"
            contentEditable={false}
            aria-label="Suggestion preview actions"
          >
            <button
              type="button"
              onClick={() => resolve("cancelled")}
              onMouseDown={(event) => event.preventDefault()}
            >
              <X aria-hidden="true" />
              Cancel
            </button>
            <button
              type="button"
              className="suggestion-preview-accept"
              disabled={!hasVisibleContent(block.content)}
              onClick={() => resolve("accepted")}
              onMouseDown={(event) => event.preventDefault()}
            >
              <Check aria-hidden="true" />
              Accept
            </button>
          </div>
        </div>
      );
    },
    toExternalHTML: () => <span />,
  },
);

export const writingSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    suggestionPreview: suggestionPreviewBlock(),
  },
});

export type WritingEditor = typeof writingSchema.BlockNoteEditor;
export type WritingBlock = typeof writingSchema.Block;
export type WritingPartialBlock = typeof writingSchema.PartialBlock;
