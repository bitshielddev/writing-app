import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createSuggestionFeedRelay } from "../desktop/desktopClient";
import { subscribeToPreviewResolutions } from "../editor/previewEvents";
import type { WritingEditor, WritingPartialBlock } from "../editor/schema";
import type {
  AgentActivity,
  AgentRuntime,
  DesktopBridge,
  SourceSnapshot,
} from "../shared/desktop";
import { useSuggestionInbox } from "../suggestions/inbox";
import { useSuggestionKeyboardNavigation } from "../suggestions/keyboardNavigation";
import { useSuggestionPersistence } from "../suggestions/useSuggestionPersistence";
import { getInitialWorkspacePinSize } from "../suggestions/workspacePinLayout";
import { markPerformance, PERFORMANCE_MARKS } from "../performance/marks";
import {
  isTextSuggestion,
  type SuggestionItem,
} from "../suggestions/types";

const AUTOSAVE_DELAY_MS = 650;
const ACTIVITY_LIMIT = 500;

function initialRuntime(): AgentRuntime {
  return { status: "offline", cycleCount: 0 };
}

function upsertActivity(
  items: AgentActivity[],
  activity: AgentActivity,
): AgentActivity[] {
  const index = items.findIndex((item) => item.id === activity.id);
  if (index < 0) return [...items, activity].slice(-ACTIVITY_LIMIT);
  const next = [...items];
  next[index] = activity;
  return next;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useWorkspaceController(
  desktop: DesktopBridge,
  editor: WritingEditor,
) {
  const suggestionFeed = useMemo(() => createSuggestionFeedRelay(), []);
  const feed = suggestionFeed.feed;
  const suggestionPersistence = useSuggestionPersistence(desktop);
  const {
    status: suggestionPersistenceStatus,
    failureMessage: suggestionPersistenceError,
    requestSave: saveSuggestionState,
    seedHydratedState,
    retry: retrySuggestionSave,
  } = suggestionPersistence;
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
  const [sources, setSources] = useState<SourceSnapshot[]>([]);
  const [runtime, setRuntime] = useState<AgentRuntime>(initialRuntime);
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
  const hydrateInbox = inbox.hydrate;
  const resolvePreview = inbox.previewResolved;

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
        seedHydratedState(snapshot.suggestions);
        hydrateInbox(snapshot.suggestions);
        const finalBlock = editor.document.at(-1);
        if (finalBlock) setLastActiveBlockId(finalBlock.id);
        window.requestAnimationFrame(() => {
          if (cancelled) return;
          hydrationInProgressRef.current = false;
          documentHydratedRef.current = true;
          markPerformance(PERFORMANCE_MARKS.hydrationComplete);
        });
      })
      .catch((error: unknown) => {
        console.error("Workspace hydration failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [desktop, editor, hydrateInbox, seedHydratedState]);

  useEffect(
    () =>
      desktop.subscribe((event) => {
        switch (event.type) {
          case "document.saved":
            documentRevisionRef.current = event.document.revision;
            break;
          case "source.imported":
            setSources((current) => [
              event.source,
              ...current.filter((source) => source.id !== event.source.id),
            ]);
            break;
          case "agent.runtime":
            setRuntime(event.runtime);
            break;
          case "agent.activity":
            setActivity((current) => upsertActivity(current, event.activity));
            break;
          case "suggestion.event":
            suggestionFeed.emit(event.event);
            break;
        }
      }),
    [desktop, suggestionFeed],
  );

  useEffect(
    () =>
      subscribeToPreviewResolutions(({ suggestionId, outcome }) => {
        resolvePreview(suggestionId, outcome);
      }),
    [resolvePreview],
  );

  const persistDocument = useCallback(() => {
    if (!documentHydratedRef.current || hydrationInProgressRef.current) return;
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
      .catch((error: unknown) => {
        console.error("Document save failed", error);
      });
  }, [desktop, editor]);

  const handleEditorChange = useCallback(() => {
    if (hydrationInProgressRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(persistDocument, AUTOSAVE_DELAY_MS);
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
    if (!source) return;
    setSources((current) => [
      source,
      ...current.filter((candidate) => candidate.id !== source.id),
    ]);
  }, [desktop]);

  const controlAgent = useCallback(
    async (control: "start" | "stop") => {
      setAgentControlPending(control);
      setAgentControlError(undefined);
      try {
        const nextRuntime = await (control === "start"
          ? desktop.startAgent()
          : desktop.stopAgent());
        setRuntime(nextRuntime);
      } catch (error) {
        setAgentControlError(
          errorMessage(
            error,
            control === "start"
              ? "The agent could not be started"
              : "The agent could not be stopped",
          ),
        );
        console.error(`Agent ${control} failed`, error);
      } finally {
        setAgentControlPending(undefined);
      }
    },
    [desktop],
  );

  const handleStartAgent = useCallback(
    () => void controlAgent("start"),
    [controlAgent],
  );
  const handleStopAgent = useCallback(
    () => void controlAgent("stop"),
    [controlAgent],
  );

  const handleEditorSelectionChange = useCallback(() => {
    try {
      setLastActiveBlockId(editor.getTextCursorPosition().block.id);
    } catch {
      // Block selections briefly have no text cursor.
    }
  }, [editor]);

  const activePreviewId = inbox.activePreviewId;
  const previewStarted = inbox.previewStarted;
  const handlePreview = useCallback(
    (item: SuggestionItem) => {
      if (activePreviewId || !isTextSuggestion(item)) return;
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
      if (!preview) return;
      previewStarted(item.id);
      editor.setTextCursorPosition(preview.id, "end");
      window.requestAnimationFrame(() => {
        document
          .querySelector(
            `[data-content-type="suggestionPreview"][data-suggestion-id="${item.id}"]`,
          )
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    },
    [activePreviewId, editor, lastActiveBlockId, previewStarted],
  );

  const placeOnWorkspace = inbox.placeOnWorkspace;
  const handlePlaceOnWorkspace = useCallback(
    (item: SuggestionItem) => {
      placeOnWorkspace(item.id, {
        x: 16,
        y: 16,
        ...getInitialWorkspacePinSize(item),
      });
    },
    [placeOnWorkspace],
  );

  return {
    inbox,
    sources,
    runtime,
    activity,
    agentControlPending,
    agentError: agentControlError ?? runtime.error,
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
  };
}
