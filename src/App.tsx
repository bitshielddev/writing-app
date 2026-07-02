import { useCreateBlockNote } from "@blocknote/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ColumnResizeHandle } from "./components/ColumnResizeHandle";
import { EditorWorkspace } from "./components/EditorWorkspace";
import { ResponsiveDrawer } from "./components/ResponsiveDrawer";
import { Sidebar } from "./components/Sidebar";
import { SuggestionDock } from "./components/SuggestionDock";
import {
  createDesktopSuggestionFeed,
} from "./desktop/desktopClient";
import { subscribeToPreviewResolutions } from "./editor/previewEvents";
import { writingSchema, type WritingPartialBlock } from "./editor/schema";
import { KeybindingCommandStrip } from "./keybindings/KeybindingCommandStrip";
import { KeybindingHelpDialog } from "./keybindings/KeybindingHelpDialog";
import { useWorkspaceKeybindings } from "./keybindings/useWorkspaceKeybindings";
import { useSuggestionInbox } from "./suggestions/inbox";
import { useSuggestionKeyboardNavigation } from "./suggestions/keyboardNavigation";
import { getInitialWorkspacePinSize } from "./suggestions/workspacePinLayout";
import type {
  AgentActivity,
  AgentRuntime,
  DesktopBridge,
  PersistedSuggestionState,
  SourceSnapshot,
} from "./shared/desktop";
import type { SuggestionItem, TextSuggestion } from "./suggestions/types";
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

function isTextSuggestion(item: SuggestionItem): item is TextSuggestion {
  return (
    item.kind === "snippet" || item.kind === "fact" || item.kind === "term"
  );
}

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
  const feed = useMemo(() => createDesktopSuggestionFeed(desktop), [desktop]);
  const saveSuggestionState = useCallback(
    (state: PersistedSuggestionState) => {
      void desktop.saveSuggestionState(state);
    },
    [desktop],
  );
  const inboxOptions = useMemo(
    () => ({ onStateChange: saveSuggestionState }),
    [saveSuggestionState],
  );
  const inbox = useSuggestionInbox(feed, inboxOptions);
  const [partnerView, setPartnerView] = useState<"suggestions" | "activity">(
    "suggestions",
  );
  const suggestionNavigator = useSuggestionKeyboardNavigation({
    entries: inbox.entries,
    pinnedEntries: inbox.pinnedEntries,
    selectedId: inbox.selectedEntry?.item.id,
    onSelect: inbox.select,
  });
  const resolvePreview = inbox.previewResolved;
  const hydrateInbox = inbox.hydrate;
  const [sources, setSources] = useState<SourceSnapshot[]>([]);
  const [runtime, setRuntime] = useState<AgentRuntime>({
    status: "offline",
    cycleCount: 0,
  });
  const [activity, setActivity] = useState<AgentActivity[]>([]);
  const [agentControlPending, setAgentControlPending] = useState<
    "start" | "stop" | undefined
  >();
  const [agentControlError, setAgentControlError] = useState<string>();
  const documentIdRef = useRef("default-document");
  const documentRevisionRef = useRef(0);
  const documentHydratedRef = useRef(false);
  const hydrationInProgressRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [lastActiveBlockId, setLastActiveBlockId] = useState(() => {
    try {
      return editor.getTextCursorPosition().block.id;
    } catch {
      return editor.document.at(-1)?.id;
    }
  });

  useEffect(() => {
    let cancelled = false;
    void desktop
      .hydrate()
      .then((snapshot) => {
        if (cancelled) return;
        hydrationInProgressRef.current = true;
        if (snapshot.document.blocks.length) {
          editor.replaceBlocks(
            editor.document,
            snapshot.document.blocks as WritingPartialBlock[],
          );
        }
        documentIdRef.current = snapshot.document.id;
        documentRevisionRef.current = snapshot.document.revision;
        setSources(snapshot.sources);
        setRuntime(snapshot.agent);
        setActivity(snapshot.activity);
        hydrateInbox(snapshot.suggestions);
        const finalBlock = editor.document.at(-1);
        if (finalBlock) setLastActiveBlockId(finalBlock.id);
        window.requestAnimationFrame(() => {
          hydrationInProgressRef.current = false;
          documentHydratedRef.current = true;
        });
      })
      .catch((error: unknown) => console.error("Workspace hydration failed", error));
    return () => {
      cancelled = true;
    };
  }, [desktop, editor, hydrateInbox]);

  useEffect(() => {
    return desktop.subscribe((event) => {
      if (event.type === "document.saved") {
        documentRevisionRef.current = event.document.revision;
      } else if (event.type === "source.imported") {
        setSources((current) => [
          event.source,
          ...current.filter((source) => source.id !== event.source.id),
        ]);
      } else if (event.type === "agent.runtime") {
        setRuntime(event.runtime);
      } else if (event.type === "agent.activity") {
        setActivity((current) => {
          const index = current.findIndex((item) => item.id === event.activity.id);
          if (index < 0) return [...current, event.activity].slice(-500);
          const next = [...current];
          next[index] = event.activity;
          return next;
        });
      }
    });
  }, [desktop]);

  useEffect(
    () =>
      subscribeToPreviewResolutions(({ suggestionId, outcome }) => {
        resolvePreview(suggestionId, outcome);
      }),
    [resolvePreview],
  );

  const persistDocument = useCallback(() => {
    if (
      !documentHydratedRef.current ||
      hydrationInProgressRef.current
    ) {
      return;
    }
    const blocks = editor.document.filter(
      (block) => block.type !== "suggestionPreview",
    );
    const markdown = editor.blocksToMarkdownLossy(blocks);
    saveQueueRef.current = saveQueueRef.current
      .then(async () => {
        const document = await desktop.saveDocument({
          documentId: documentIdRef.current,
          blocks,
          markdown,
          expectedRevision: documentRevisionRef.current,
        });
        documentRevisionRef.current = document.revision;
      })
      .catch((error: unknown) => console.error("Document save failed", error));
  }, [desktop, editor]);

  const handleEditorChange = useCallback(() => {
    if (hydrationInProgressRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(persistDocument, 650);
  }, [persistDocument]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      persistDocument();
    },
    [persistDocument],
  );

  const handleUploadSource = useCallback(async () => {
    const source = await desktop.importSource();
    if (source) {
      setSources((current) => [
        source,
        ...current.filter((candidate) => candidate.id !== source.id),
      ]);
    }
  }, [desktop]);

  const handleStartAgent = useCallback(async () => {
    setAgentControlPending("start");
    setAgentControlError(undefined);
    try {
      setRuntime(await desktop.startAgent());
    } catch (error) {
      setAgentControlError(
        error instanceof Error ? error.message : "The agent could not be started",
      );
      console.error("Agent start failed", error);
    } finally {
      setAgentControlPending(undefined);
    }
  }, [desktop]);

  const handleStopAgent = useCallback(async () => {
    setAgentControlPending("stop");
    setAgentControlError(undefined);
    try {
      setRuntime(await desktop.stopAgent());
    } catch (error) {
      setAgentControlError(
        error instanceof Error ? error.message : "The agent could not be stopped",
      );
      console.error("Agent stop failed", error);
    } finally {
      setAgentControlPending(undefined);
    }
  }, [desktop]);

  const handleEditorSelectionChange = () => {
    try {
      setLastActiveBlockId(editor.getTextCursorPosition().block.id);
    } catch {
      // The editor can briefly have no text cursor during block selection.
    }
  };

  const handlePreview = useCallback(
    (item: SuggestionItem) => {
      if (inbox.activePreviewId || !isTextSuggestion(item)) return;

      const acceptedBlocks = editor.document.filter(
        (block) => block.type !== "suggestionPreview",
      );
      const referenceBlock =
        acceptedBlocks.find((block) => block.id === lastActiveBlockId) ??
        acceptedBlocks.at(-1);
      if (!referenceBlock) return;

      const preview = editor.insertBlocks(
        [
          {
            type: "suggestionPreview",
            props: {
              suggestionId: item.id,
              targetBlockId: referenceBlock.id,
            },
            content: item.insertText,
          },
        ],
        referenceBlock,
        "after",
      )[0];

      if (preview) {
        inbox.previewStarted(item.id);
        editor.setTextCursorPosition(preview.id, "end");
        window.requestAnimationFrame(() => {
          document
            .querySelector(
              `[data-content-type="suggestionPreview"][data-suggestion-id="${item.id}"]`,
            )
            ?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
      }
    },
    [editor, inbox, lastActiveBlockId],
  );

  const handlePlaceOnWorkspace = useCallback(
    (item: SuggestionItem) => {
      inbox.placeOnWorkspace(item.id, {
        x: 16,
        y: 16,
        ...getInitialWorkspacePinSize(item),
      });
    },
    [inbox],
  );

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
      status={runtime.status}
      error={agentControlError
        ? { message: agentControlError, recoverable: true }
        : runtime.error
          ? { message: runtime.error, recoverable: true }
          : inbox.error}
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
      <KeybindingHelpDialog
        open={keybindings.helpOpen}
        onClose={keybindings.closeHelp}
      />
    </div>
  );
}
