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
import { createInjectedSuggestionFeed } from "./dev/mockSuggestions/createInjectedSuggestionFeed";
import { subscribeToPreviewResolutions } from "./editor/previewEvents";
import {
  writingSchema,
  type WritingPartialBlock,
} from "./editor/schema";
import { useSuggestionInbox } from "./suggestions/inbox";
import { getInitialWorkspacePinSize } from "./suggestions/workspacePinLayout";
import type { SuggestionItem, TextSuggestion } from "./suggestions/types";

const initialContent: WritingPartialBlock[] = [
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
  { type: "paragraph" },
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
    return Number.isFinite(width) && width >= min && width <= max ? width : null;
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
  return item.kind === "snippet" || item.kind === "fact" || item.kind === "term";
}

export default function App() {
  const workspaceRef = useRef<HTMLElement>(null);
  const navigationColumnRef = useRef<HTMLDivElement>(null);
  const contextColumnRef = useRef<HTMLDivElement>(null);
  const [navigationDrawerOpen, setNavigationDrawerOpen] = useState(false);
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);
  const [navigationPanelOpen, setNavigationPanelOpen] = useState(true);
  const [contextPanelOpen, setContextPanelOpen] = useState(true);
  const [navigationColumnWidth, setNavigationColumnWidth] = useState<number | null>(
    () =>
      readSavedWidth(
        NAVIGATION_WIDTH_KEY,
        MIN_NAVIGATION_WIDTH,
        MAX_NAVIGATION_WIDTH,
      ),
  );
  const [contextColumnWidth, setContextColumnWidth] = useState<number | null>(
    () =>
      readSavedWidth(
        CONTEXT_WIDTH_KEY,
        MIN_CONTEXT_WIDTH,
        MAX_CONTEXT_WIDTH,
      ),
  );
  const editor = useCreateBlockNote({ schema: writingSchema, initialContent });
  const feed = useMemo(() => createInjectedSuggestionFeed(), []);
  const inbox = useSuggestionInbox(feed);
  const resolvePreview = inbox.previewResolved;
  const [lastActiveBlockId, setLastActiveBlockId] = useState(
    () => {
      try {
        return editor.getTextCursorPosition().block.id;
      } catch {
        return editor.document.at(-1)?.id;
      }
    },
  );

  const getMaximumNavigationWidth = useCallback(() => {
    const workspaceWidth =
      workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const contextWidth = contextPanelOpen
      ? contextColumnRef.current?.getBoundingClientRect().width ?? MIN_CONTEXT_WIDTH
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
      ? navigationColumnRef.current?.getBoundingClientRect().width ??
        MIN_NAVIGATION_WIDTH
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
    return () => desktopQuery.removeEventListener("change", closeDrawersAtDesktop);
  }, []);

  useEffect(
    () =>
      subscribeToPreviewResolutions(({ suggestionId, outcome }) => {
        resolvePreview(suggestionId, outcome);
      }),
    [resolvePreview],
  );

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
      status={inbox.status}
      error={inbox.error}
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
          <Sidebar />
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
        <Sidebar />
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
