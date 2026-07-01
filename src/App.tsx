import { useCreateBlockNote } from "@blocknote/react";
import {
  type CSSProperties,
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
import { useSuggestionInbox } from "./suggestions/inbox";
import { getInitialWorkspacePinSize } from "./suggestions/workspacePinLayout";
import type {
  AgentActivity,
  AgentRuntime,
  DesktopBridge,
  PersistedSuggestionState,
  SourceSnapshot,
} from "./shared/desktop";
import type { SuggestionItem, TextSuggestion } from "./suggestions/types";

const initialContent: WritingPartialBlock[] = [
  {
    type: "heading",
    props: { level: 1 },
    content: "New Page",
  },
];

const MIN_NAVIGATION_WIDTH = 220;
const MAX_NAVIGATION_WIDTH = 380;
const MIN_CONTEXT_WIDTH = 280;
const MAX_CONTEXT_WIDTH = 720;
const MIN_EDITOR_WIDTH = 520;
const NAVIGATION_WIDTH_KEY = "scribe-navigation-column-width";
const CONTEXT_WIDTH_KEY = "scribe-context-column-width";
function readSavedWidth(key: string, min: number, max: number) {
  try {
    const width = Number(window.localStorage.getItem(key));
    return Number.isFinite(width) && width >= min && width <= max
      ? width
      : null;
  } catch {
    return null;
  }
}

function saveWidth(key: string, width: number | null) {
  try {
    if (width === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, String(width));
    }
  } catch {
    // Column resizing remains available when storage is blocked.
  }
}

function isTextSuggestion(item: SuggestionItem): item is TextSuggestion {
  return (
    item.kind === "snippet" || item.kind === "fact" || item.kind === "term"
  );
}

type AppProps = {
  desktop: DesktopBridge;
};

export default function App({ desktop }: AppProps) {
  const workspaceRef = useRef<HTMLElement>(null);
  const navigationColumnRef = useRef<HTMLDivElement>(null);
  const contextColumnRef = useRef<HTMLDivElement>(null);
  const [navigationDrawerOpen, setNavigationDrawerOpen] = useState(false);
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);
  const [navigationPanelOpen, setNavigationPanelOpen] = useState(true);
  const [contextPanelOpen, setContextPanelOpen] = useState(true);
  const [navigationColumnWidth, setNavigationColumnWidth] = useState<
    number | null
  >(() =>
    readSavedWidth(
      NAVIGATION_WIDTH_KEY,
      MIN_NAVIGATION_WIDTH,
      MAX_NAVIGATION_WIDTH,
    ),
  );
  const [contextColumnWidth, setContextColumnWidth] = useState<number | null>(
    () =>
      readSavedWidth(CONTEXT_WIDTH_KEY, MIN_CONTEXT_WIDTH, MAX_CONTEXT_WIDTH),
  );
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
  const resolvePreview = inbox.previewResolved;
  const hydrateInbox = inbox.hydrate;
  const [sources, setSources] = useState<SourceSnapshot[]>([]);
  const [runtime, setRuntime] = useState<AgentRuntime>({
    status: "offline",
    cycleCount: 0,
  });
  const [activity, setActivity] = useState<AgentActivity[]>([]);
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

  const getMaximumNavigationWidth = useCallback(() => {
    const workspaceWidth =
      workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const contextWidth = contextPanelOpen
      ? (contextColumnRef.current?.getBoundingClientRect().width ??
        MIN_CONTEXT_WIDTH)
      : 0;
    return Math.max(
      MIN_NAVIGATION_WIDTH,
      Math.min(
        MAX_NAVIGATION_WIDTH,
        workspaceWidth - contextWidth - MIN_EDITOR_WIDTH,
      ),
    );
  }, [contextPanelOpen]);

  const getMaximumContextWidth = useCallback(() => {
    const workspaceWidth =
      workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const navigationWidth = navigationPanelOpen
      ? (navigationColumnRef.current?.getBoundingClientRect().width ??
        MIN_NAVIGATION_WIDTH)
      : 0;
    return Math.max(
      MIN_CONTEXT_WIDTH,
      Math.min(
        MAX_CONTEXT_WIDTH,
        workspaceWidth - navigationWidth - MIN_EDITOR_WIDTH,
      ),
    );
  }, [navigationPanelOpen]);

  const resizeNavigationColumn = useCallback((width: number) => {
    setNavigationColumnWidth(width);
    saveWidth(NAVIGATION_WIDTH_KEY, width);
  }, []);

  const resizeContextColumn = useCallback((width: number) => {
    setContextColumnWidth(width);
    saveWidth(CONTEXT_WIDTH_KEY, width);
  }, []);

  const resetNavigationColumn = useCallback(() => {
    setNavigationColumnWidth(null);
    saveWidth(NAVIGATION_WIDTH_KEY, null);
  }, []);

  const resetContextColumn = useCallback(() => {
    setContextColumnWidth(null);
    saveWidth(CONTEXT_WIDTH_KEY, null);
  }, []);

  useEffect(() => {
    const constrainSavedWidths = () => {
      if (!window.matchMedia("(min-width: 1280px)").matches) {
        return;
      }

      setNavigationColumnWidth((width) => {
        if (width === null) {
          return null;
        }
        const constrained = Math.min(width, getMaximumNavigationWidth());
        saveWidth(NAVIGATION_WIDTH_KEY, constrained);
        return constrained;
      });
      setContextColumnWidth((width) => {
        if (width === null) {
          return null;
        }
        const constrained = Math.min(width, getMaximumContextWidth());
        saveWidth(CONTEXT_WIDTH_KEY, constrained);
        return constrained;
      });
    };

    constrainSavedWidths();
    window.addEventListener("resize", constrainSavedWidths);
    return () => window.removeEventListener("resize", constrainSavedWidths);
  }, [getMaximumContextWidth, getMaximumNavigationWidth]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1280px)");
    const closeDrawersAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setNavigationDrawerOpen(false);
        setContextDrawerOpen(false);
      }
    };

    desktopQuery.addEventListener("change", closeDrawersAtDesktop);
    return () =>
      desktopQuery.removeEventListener("change", closeDrawersAtDesktop);
  }, []);

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

  const handleEditorSelectionChange = () => {
    try {
      setLastActiveBlockId(editor.getTextCursorPosition().block.id);
    } catch {
      // The editor can briefly have no text cursor during block selection.
    }
  };

  const handlePreview = (item: SuggestionItem) => {
    if (inbox.activePreviewId || !isTextSuggestion(item)) {
      return;
    }

    const acceptedBlocks = editor.document.filter(
      (block) => block.type !== "suggestionPreview",
    );
    const referenceBlock =
      acceptedBlocks.find((block) => block.id === lastActiveBlockId) ??
      acceptedBlocks.at(-1);
    if (!referenceBlock) {
      return;
    }

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
  };

  const handlePlaceOnWorkspace = (item: SuggestionItem) => {
    inbox.placeOnWorkspace(item.id, {
      x: 16,
      y: 16,
      ...getInitialWorkspacePinSize(item),
    });
  };

  const dock = (
    <SuggestionDock
      entries={inbox.entries}
      pinnedEntries={inbox.pinnedEntries}
      selectedEntry={inbox.selectedEntry}
      activePreviewId={inbox.activePreviewId}
      unreadCount={inbox.unreadCount}
      status={runtime.status}
      error={runtime.error ? { message: runtime.error, recoverable: true } : inbox.error}
      activity={activity}
      runtime={runtime}
      onSelect={inbox.select}
      onBack={inbox.back}
      onDismiss={inbox.dismiss}
      onPin={inbox.pin}
      onUnpin={inbox.unpin}
      onPlaceOnWorkspace={handlePlaceOnWorkspace}
      onPreview={handlePreview}
    />
  );

  const workspaceColumnStyles = {
    ...(navigationColumnWidth === null
      ? {}
      : { "--navigation-column-width": `${navigationColumnWidth}px` }),
    ...(contextColumnWidth === null
      ? {}
      : { "--context-column-width": `${contextColumnWidth}px` }),
  } as CSSProperties;

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
        style={workspaceColumnStyles}
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
          <Sidebar sources={sources} onUploadSource={handleUploadSource} />
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
          onOpenNavigationDrawer={() => setNavigationDrawerOpen(true)}
          onOpenContextDrawer={() => setContextDrawerOpen(true)}
          onToggleNavigationPanel={() =>
            setNavigationPanelOpen((open) => !open)
          }
          onToggleContextPanel={() => setContextPanelOpen((open) => !open)}
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
          {dock}
        </div>
      </main>

      <ResponsiveDrawer
        id="navigation-drawer"
        title="Project navigation"
        side="left"
        open={navigationDrawerOpen}
        onClose={() => setNavigationDrawerOpen(false)}
      >
        <Sidebar sources={sources} onUploadSource={handleUploadSource} />
      </ResponsiveDrawer>

      <ResponsiveDrawer
        id="context-drawer"
        title="Writing partner"
        side="right"
        wide
        open={contextDrawerOpen}
        onClose={() => setContextDrawerOpen(false)}
      >
        {dock}
      </ResponsiveDrawer>
    </div>
  );
}
