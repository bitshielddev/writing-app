import { DocumentEditor } from "./DocumentEditor";
import { DocumentHeader } from "./DocumentHeader";
import type { WritingEditor } from "../editor/schema";
import type { WorkspacePin, WorkspacePinRect } from "../suggestions/inbox";

type EditorWorkspaceProps = {
  editor: WritingEditor;
  workspacePins: WorkspacePin[];
  onOpenContext: () => void;
  onOpenNavigation: () => void;
  onGenerateIdeas: () => void;
  onEditorChange: () => void;
  onEditorSelectionChange: () => void;
  onWorkspacePinGeometryChange: (id: string, rect: WorkspacePinRect) => void;
  onRaiseWorkspacePin: (id: string) => void;
  onReturnToPins: (id: string) => void;
};

export function EditorWorkspace({
  editor,
  workspacePins,
  onOpenContext,
  onOpenNavigation,
  onGenerateIdeas,
  onEditorChange,
  onEditorSelectionChange,
  onWorkspacePinGeometryChange,
  onRaiseWorkspacePin,
  onReturnToPins,
}: EditorWorkspaceProps) {
  return (
    <section
      aria-label="Draft workspace"
      className="flex min-h-0 min-w-0 flex-col bg-white"
    >
      <DocumentHeader
        onOpenContext={onOpenContext}
        onOpenNavigation={onOpenNavigation}
        onGenerateIdeas={onGenerateIdeas}
      />
      <DocumentEditor
        editor={editor}
        workspacePins={workspacePins}
        onChange={onEditorChange}
        onSelectionChange={onEditorSelectionChange}
        onWorkspacePinGeometryChange={onWorkspacePinGeometryChange}
        onRaiseWorkspacePin={onRaiseWorkspacePin}
        onReturnToPins={onReturnToPins}
      />
    </section>
  );
}
