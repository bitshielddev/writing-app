import { useCreateBlockNote } from "@blocknote/react";
import { useEffect } from "react";

import { ColumnResizeHandle } from "../ui/ColumnResizeHandle";
import { EditorWorkspace } from "../features/editor/EditorWorkspace";
import { ResponsiveDrawer } from "../ui/ResponsiveDrawer";
import { Sidebar } from "../features/workspace/Sidebar";
import { SuggestionDock } from "../features/suggestions/dock/SuggestionDock";
import { writingSchema, type WritingPartialBlock } from "../features/editor/schema";
import { KeybindingCommandStrip } from "../features/keybindings/KeybindingCommandStrip";
import { KeybindingHelpBoundary } from "../features/keybindings/KeybindingHelpBoundary";
import { useWorkspaceKeybindings } from "../features/keybindings/useWorkspaceKeybindings";
import { markPerformance, PERFORMANCE_MARKS } from "../platform/performance/marks";
import type { DesktopBridge, ProcessHealthSnapshot } from "../../contracts/desktop-bridge";
import { useWorkspaceController } from "../features/workspace/useWorkspaceController";
import {
  MIN_CONTEXT_WIDTH,
  MIN_NAVIGATION_WIDTH,
  useWorkspaceLayout,
} from "../features/workspace/useWorkspaceLayout";

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

function ProcessHealthBanner({
  health,
  canRetry,
  retry,
}: {
  health: ProcessHealthSnapshot;
  canRetry: boolean;
  retry: (process: "storage" | "agent") => Promise<void>;
}) {
  if (health.storage.state !== "healthy") {
    const retryable = health.storage.state === "failed" || health.storage.state === "degraded";
    return (
      <div role="alert" className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-4 bg-red-800 px-4 py-2 text-sm text-white">
        <span>Storage is unavailable. Editing and workspace changes are read-only; unsaved text is retained.</span>
        {retryable && canRetry ? <button className="rounded border border-white/60 px-3 py-1 font-semibold" onClick={() => void retry("storage")}>Retry storage</button> : null}
      </div>
    );
  }
  if (health.agent.state === "healthy") return null;
  const retryable = health.agent.state === "failed" || health.agent.state === "degraded";
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-4 bg-amber-100 px-4 py-2 text-sm text-amber-950">
      <span>The writing agent is unavailable. Document editing and saving remain available.</span>
      {retryable && canRetry ? <button className="rounded border border-amber-700 px-3 py-1 font-semibold" onClick={() => void retry("agent")}>Retry agent</button> : null}
    </div>
  );
}

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
    health,
    retryProcess,
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
    flushDocument,
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

  useEffect(() => {
    window.scribeFlush = flushDocument;
    return () => { delete window.scribeFlush; };
  }, [flushDocument]);

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
      <ProcessHealthBanner health={health} canRetry={Boolean(desktop.retryProcess)} retry={retryProcess} />
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
          editable={health.storage.state === "healthy"}
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
