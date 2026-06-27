import type { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";

type DocumentEditorProps = {
  editor: BlockNoteEditor;
};

export function DocumentEditor({ editor }: DocumentEditorProps) {
  return (
    <section
      aria-label="Document editor"
      className="min-h-0 flex-1 overflow-y-auto bg-white px-0 py-10 lg:py-14"
    >
      <div className="mx-auto min-h-full w-full max-w-[55rem]">
        <BlockNoteView
          editor={editor}
          theme="light"
          aria-label="Editable draft content"
          data-editor-surface
        />
      </div>
    </section>
  );
}
