import { DocumentEditor } from "./DocumentEditor";
import { DocumentHeader } from "./DocumentHeader";
import type { WritingEditor } from "../editor/schema";
import type { WorkspacePin, WorkspacePinRect } from "../suggestions/inbox";

type EditorWorkspaceProps = {
  editor: WritingEditor;
  workspacePins: WorkspacePin[];
  navigationPanelOpen: boolean;
  contextPanelOpen: boolean;
  navigationDrawerOpen: boolean;
  contextDrawerOpen: boolean;
  contextUnreadCount: number;
  onOpenContextDrawer: () => void;
  onOpenNavigationDrawer: () => void;
  onToggleContextPanel: () => void;
  onToggleNavigationPanel: () => void;
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
  navigationPanelOpen,
  contextPanelOpen,
  navigationDrawerOpen,
  contextDrawerOpen,
  contextUnreadCount,
  onOpenContextDrawer,
  onOpenNavigationDrawer,
  onToggleContextPanel,
  onToggleNavigationPanel,
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
      className="flex min-h-0 min-w-0 flex-col bg-white xl:col-start-2"
    >
      <DocumentHeader
        navigationPanelOpen={navigationPanelOpen}
        contextPanelOpen={contextPanelOpen}
        navigationDrawerOpen={navigationDrawerOpen}
        contextDrawerOpen={contextDrawerOpen}
        contextUnreadCount={contextUnreadCount}
        onOpenContextDrawer={onOpenContextDrawer}
        onOpenNavigationDrawer={onOpenNavigationDrawer}
        onToggleContextPanel={onToggleContextPanel}
        onToggleNavigationPanel={onToggleNavigationPanel}
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
