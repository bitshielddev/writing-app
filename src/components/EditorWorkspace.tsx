import type { PartialBlock } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";

import { DocumentEditor } from "./DocumentEditor";
import { DocumentHeader } from "./DocumentHeader";
import { LayoutSuggestions } from "./LayoutSuggestions";

type EditorWorkspaceProps = {
  onOpenContext: () => void;
  onOpenNavigation: () => void;
};

const initialContent: PartialBlock[] = [
  {
    type: "heading",
    props: { level: 1 },
    content: "The Future of AI Collaboration",
  },
  {
    type: "paragraph",
    content:
      "The integration of artificial intelligence into creative workflows is no longer a speculative concept; it is an active paradigm shift. As we observe the maturation of language models, the focus is moving from mere automation to profound augmentation.",
  },
  {
    type: "paragraph",
    content:
      "Unlike early tools that acted as opaque oracles, the next generation of AI interfaces is designed for cognitive partnership. They exist in the gutters of our digital canvas, offering contextual relevance without disrupting the user's flow state.",
  },
  {
    type: "paragraph",
  },
];

export function EditorWorkspace({
  onOpenContext,
  onOpenNavigation,
}: EditorWorkspaceProps) {
  const editor = useCreateBlockNote({ initialContent });

  return (
    <section aria-label="Draft workspace" className="flex min-h-0 min-w-0 flex-col bg-white">
      <DocumentHeader
        onOpenContext={onOpenContext}
        onOpenNavigation={onOpenNavigation}
      />
      <LayoutSuggestions />
      <DocumentEditor editor={editor} />
    </section>
  );
}
