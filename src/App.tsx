import { useCreateBlockNote } from "@blocknote/react";
import { useEffect } from "react";

import { ColumnResizeHandle } from "./components/ColumnResizeHandle";
import { EditorWorkspace } from "./components/EditorWorkspace";
import { ResponsiveDrawer } from "./components/ResponsiveDrawer";
import { Sidebar } from "./components/Sidebar";
import { SuggestionDock } from "./components/SuggestionDock";
import { writingSchema, type WritingPartialBlock } from "./editor/schema";
import { KeybindingCommandStrip } from "./keybindings/KeybindingCommandStrip";
import { KeybindingHelpBoundary } from "./keybindings/KeybindingHelpBoundary";
import { useWorkspaceKeybindings } from "./keybindings/useWorkspaceKeybindings";
import { markPerformance, PERFORMANCE_MARKS } from "./performance/marks";
import type { DesktopBridge } from "./shared/desktop";
import { useWorkspaceController } from "./workspace/useWorkspaceController";
import {
  MIN_CONTEXT_WIDTH,
  MIN_NAVIGATION_WIDTH,
  useWorkspaceLayout,
} from "./workspace/useWorkspaceLayout";

const initialContent: WritingPartialBlock[] = [
  {
    type: "heading",
    props: { level: 1 },
    content: "New Page",
  },
];

type AppProps = {
  desktop: DesktopBridge;
};

export default function App({ desktop }: AppProps) {
  const layout = useWorkspaceLayout();
  const {
    workspaceRef,
    navigationColumnRef,
    contextColumnRef,
    navigationRegionRef,
    contextRegionRef,
    desktop: desktopLayout,
    navigationDrawerOpen,
    contextDrawerOpen,
    navigationPanelOpen,
    contextPanelOpen,
    columnStyles,
    openNavigation,
    openContext,
    toggleNavigation,
    toggleContext,
    closeNavigationDrawer,
    closeContextDrawer,
    getMaximumNavigationWidth,
    getMaximumContextWidth,
    resizeNavigationColumn,
    resizeContextColumn,
    resetNavigationColumn,
    resetContextColumn,
  } = layout;
  const editor = useCreateBlockNote({ schema: writingSchema, initialContent });
  const {
    inbox,
    catalog,
    switchPending,
    switchError,
    selectDocument,
    createDocument,
    retrySwitch,
    discardAndSwitch,
    createProject,
    renameProject,
    deleteProject,
    renameDocument,
    deleteDocument,
    sources,
    runtime,
    activity,
    agentControlPending,
    agentError,
    suggestionPersistenceStatus,
    suggestionPersistenceError,
    retrySuggestionSave,
    partnerView,
    setPartnerView,
    suggestionNavigator,
    handleEditorChange,
    handleEditorSelectionChange,
    handleUploadSource,
    handleStartAgent,
    handleStopAgent,
    handlePreview,
    handlePlaceOnWorkspace,
  } = useWorkspaceController(desktop, editor);

  const keybindings = useWorkspaceKeybindings({
    editor,
    layout,
    navigator: suggestionNavigator,
    pinnedEntries: inbox.pinnedEntries,
    selectedEntry: inbox.selectedEntry,
    activePreviewId: inbox.activePreviewId,
    setPartnerView,
    onSelect: inbox.select,
    onBack: inbox.back,
    onDismiss: inbox.dismiss,
    onPin: inbox.pin,
    onUnpin: inbox.unpin,
    onPreview: handlePreview,
  });

  useEffect(() => {
    markPerformance(PERFORMANCE_MARKS.reactMounted);
  }, []);

  const renderDock = (
    keyboardNavigationActive: boolean,
    regionRef?: typeof contextRegionRef,
  ) => (
    <SuggestionDock
      entries={inbox.entries}
      pinnedEntries={inbox.pinnedEntries}
      selectedEntry={inbox.selectedEntry}
      activePreviewId={inbox.activePreviewId}
      unreadCount={inbox.unreadCount}
      error={agentError}
      persistenceStatus={suggestionPersistenceStatus}
      persistenceError={suggestionPersistenceError}
      activity={activity}
      runtime={runtime}
      controlPending={agentControlPending}
      view={partnerView}
      keyboardTargetId={
        keyboardNavigationActive ? suggestionNavigator.targetId : undefined
      }
      regionRef={regionRef}
      onViewChange={setPartnerView}
      onKeyboardTargetChange={suggestionNavigator.setTargetId}
      onSelect={inbox.select}
      onBack={inbox.back}
      onDismiss={inbox.dismiss}
      onPin={inbox.pin}
      onUnpin={inbox.unpin}
      onPlaceOnWorkspace={handlePlaceOnWorkspace}
      onPreview={handlePreview}
      onStartAgent={handleStartAgent}
      onStopAgent={handleStopAgent}
      onRetrySuggestionSave={retrySuggestionSave}
    />
  );

  return (
    <div className="min-h-dvh bg-white">
      <main
        ref={workspaceRef}
        aria-label="ScribeAI writing workspace"
        className={`workspace-grid grid h-dvh min-h-0 overflow-hidden bg-white ${
          inbox.selectedEntry ? "workspace-grid--detail" : ""
        } ${
          navigationPanelOpen ? "" : "workspace-grid--navigation-closed"
        } ${contextPanelOpen ? "" : "workspace-grid--context-closed"}`}
        style={columnStyles}
      >
        <div
          ref={navigationColumnRef}
          id="project-navigation-column"
          className={
            navigationPanelOpen
              ? "relative hidden min-h-0 xl:col-start-1 xl:block"
              : "hidden"
          }
        >
          <Sidebar
            sources={sources}
            catalog={catalog}
            switching={switchPending}
            switchError={switchError}
            onCreateDocument={createDocument}
            onSelectDocument={selectDocument}
            onRetrySwitch={retrySwitch}
            onDiscardAndSwitch={discardAndSwitch}
            onCreateProject={createProject}
            onRenameProject={renameProject}
            onDeleteProject={deleteProject}
            onRenameDocument={renameDocument}
            onDeleteDocument={deleteDocument}
            regionRef={navigationRegionRef}
            onOpenKeybindingHelp={keybindings.openHelp}
            onUploadSource={handleUploadSource}
          />
          {navigationPanelOpen ? (
            <ColumnResizeHandle
              controls="project-navigation-column"
              label="Resize project navigation"
              maxWidth={getMaximumNavigationWidth}
              minWidth={MIN_NAVIGATION_WIDTH}
              panelRef={navigationColumnRef}
              resizeDirection="right"
              onReset={resetNavigationColumn}
              onResize={resizeNavigationColumn}
            />
          ) : null}
        </div>

        <EditorWorkspace
          editor={editor}
          workspacePins={inbox.workspacePins}
          navigationPanelOpen={navigationPanelOpen}
          contextPanelOpen={contextPanelOpen}
          navigationDrawerOpen={navigationDrawerOpen}
          contextDrawerOpen={contextDrawerOpen}
          contextUnreadCount={inbox.unreadCount}
          onOpenNavigationDrawer={openNavigation}
          onOpenContextDrawer={openContext}
          onToggleNavigationPanel={toggleNavigation}
          onToggleContextPanel={toggleContext}
          onEditorSelectionChange={handleEditorSelectionChange}
          onEditorChange={handleEditorChange}
          onWorkspacePinGeometryChange={inbox.updateWorkspaceGeometry}
          onRaiseWorkspacePin={inbox.raiseWorkspacePin}
          onReturnToPins={inbox.returnToPins}
        />

        <div
          ref={contextColumnRef}
          id="writing-partner-column"
          className={
            contextPanelOpen
              ? "relative hidden min-h-0 xl:col-start-3 xl:block"
              : "hidden"
          }
        >
          {contextPanelOpen ? (
            <ColumnResizeHandle
              controls="writing-partner-column"
              label="Resize writing partner"
              maxWidth={getMaximumContextWidth}
              minWidth={MIN_CONTEXT_WIDTH}
              panelRef={contextColumnRef}
              resizeDirection="left"
              onReset={resetContextColumn}
              onResize={resizeContextColumn}
            />
          ) : null}
          {renderDock(desktopLayout, contextRegionRef)}
        </div>
      </main>

      <ResponsiveDrawer
        id="navigation-drawer"
        title="Project navigation"
        side="left"
        open={navigationDrawerOpen}
        onClose={closeNavigationDrawer}
      >
        <Sidebar
          sources={sources}
          catalog={catalog}
          switching={switchPending}
          switchError={switchError}
          onCreateDocument={createDocument}
          onSelectDocument={selectDocument}
          onRetrySwitch={retrySwitch}
          onDiscardAndSwitch={discardAndSwitch}
          onCreateProject={createProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          onRenameDocument={renameDocument}
          onDeleteDocument={deleteDocument}
          onOpenKeybindingHelp={keybindings.openHelp}
          onUploadSource={handleUploadSource}
        />
      </ResponsiveDrawer>

      <ResponsiveDrawer
        id="context-drawer"
        title="Writing partner"
        side="right"
        wide
        open={contextDrawerOpen}
        onClose={closeContextDrawer}
      >
        {renderDock(!desktopLayout)}
      </ResponsiveDrawer>

      <KeybindingCommandStrip state={keybindings.stripState} />
      <KeybindingHelpBoundary
        open={keybindings.helpOpen}
        onClose={keybindings.closeHelp}
      />
    </div>
  );
}
