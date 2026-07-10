import { DocumentEditor } from "./DocumentEditor";
import { DocumentHeader } from "../workspace/DocumentHeader";
import type { WritingEditor } from "./schema";
import type { WorkspacePin, WorkspacePinRect } from "../suggestions/inbox";

type EditorWorkspaceProps = {
  editor: WritingEditor;
  workspacePins: WorkspacePin[];
  editable: boolean;
  navigationPanelOpen: boolean;
  contextPanelOpen: boolean;
  navigationDrawerOpen: boolean;
  contextDrawerOpen: boolean;
  contextUnreadCount: number;
  onOpenContextDrawer: () => void;
  onOpenNavigationDrawer: () => void;
  onToggleContextPanel: () => void;
  onToggleNavigationPanel: () => void;
  onEditorSelectionChange: () => void;
  onEditorChange: () => void;
  onWorkspacePinGeometryChange: (id: string, rect: WorkspacePinRect) => void;
  onRaiseWorkspacePin: (id: string) => void;
  onReturnToPins: (id: string) => void;
};

/**
 * What: renders the editor workspace component and wires its props into the surrounding UI.
 *
 * Why: editor code needs a stable adapter around BlockNote and preview-specific behavior.
 * Called when: used by App when that path needs this behavior.
 */
export function EditorWorkspace({
  editor,
  workspacePins,
  editable,
  navigationPanelOpen,
  contextPanelOpen,
  navigationDrawerOpen,
  contextDrawerOpen,
  contextUnreadCount,
  onOpenContextDrawer,
  onOpenNavigationDrawer,
  onToggleContextPanel,
  onToggleNavigationPanel,
  onEditorSelectionChange,
  onEditorChange,
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
      />
      <DocumentEditor
        editor={editor}
        editable={editable}
        workspacePins={workspacePins}
        onSelectionChange={onEditorSelectionChange}
        onChange={onEditorChange}
        onWorkspacePinGeometryChange={onWorkspacePinGeometryChange}
        onRaiseWorkspacePin={onRaiseWorkspacePin}
        onReturnToPins={onReturnToPins}
      />
    </section>
  );
}
