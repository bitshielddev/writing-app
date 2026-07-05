import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createSuggestionFeedRelay } from "../desktop/desktopClient";
import type { WritingEditor } from "../editor/schema";
import type { DesktopBridge, DesktopEvent, WorkspaceSnapshot } from "../shared/desktop";
import { useSuggestionInbox } from "../suggestions/inbox";
import { useSuggestionKeyboardNavigation } from "../suggestions/keyboardNavigation";
import { useSuggestionPersistence } from "../suggestions/useSuggestionPersistence";
import { getInitialWorkspacePinSize } from "../suggestions/workspacePinLayout";
import {
  supportsWorkspacePlacement,
  type SuggestionItem,
} from "../suggestions/types";
import { useAgentController } from "./useAgentController";
import { useDocumentAutosave } from "./useDocumentAutosave";
import { usePreviewController } from "./usePreviewController";
import { useSourceController } from "./useSourceController";
import { useWorkspaceHydration } from "./useWorkspaceHydration";

export function useWorkspaceController(
  desktop: DesktopBridge,
  editor: WritingEditor,
) {
  const initializeRef = useRef<(snapshot: WorkspaceSnapshot) => void>(() => {});
  const initializeSnapshot = useCallback(
    (snapshot: WorkspaceSnapshot) => initializeRef.current(snapshot),
    [],
  );
  const eventRef = useRef<(event: DesktopEvent) => void>(() => {});
  const applyDesktopEvent = useCallback(
    (event: DesktopEvent) => eventRef.current(event),
    [],
  );
  const hydration = useWorkspaceHydration({
    desktop,
    editor,
    initialize: initializeSnapshot,
    onEvent: applyDesktopEvent,
  });

  const suggestionFeed = useMemo(() => createSuggestionFeedRelay(), []);
  const suggestionPersistence = useSuggestionPersistence(desktop);
  const inboxOptions = useMemo(
    () => ({ onCommand: suggestionPersistence.dispatchCommand,
      subscribeToAuthoritativeState: suggestionPersistence.subscribe }),
    [suggestionPersistence.dispatchCommand, suggestionPersistence.subscribe],
  );
  const inbox = useSuggestionInbox(suggestionFeed.feed, inboxOptions);
  const document = useDocumentAutosave(
    desktop,
    editor,
    hydration.phase === "ready",
  );
  const source = useSourceController(desktop);
  const agent = useAgentController(desktop);
  const preview = usePreviewController({
    editor,
    activePreviewId: inbox.activePreviewId,
    previewStarted: inbox.previewStarted,
    previewResolved: inbox.previewResolved,
  });

  const initializeDocument = document.initialize;
  const initializeSources = source.initialize;
  const initializeAgent = agent.initialize;
  const seedSuggestionState = suggestionPersistence.seedHydratedState;
  const hydrateInbox = inbox.hydrate;
  const initializePreview = preview.initialize;
  useEffect(() => {
    initializeRef.current = (snapshot) => {
      initializeDocument(snapshot.document);
      initializeSources(snapshot.sources);
      initializeAgent(snapshot.agent, snapshot.activity);
      seedSuggestionState(snapshot.suggestions, snapshot.suggestionRevision, snapshot.document.id);
      hydrateInbox(snapshot.suggestions);
      initializePreview();
    };
  }, [
    hydrateInbox,
    initializeAgent,
    initializeDocument,
    initializePreview,
    initializeSources,
    seedSuggestionState,
  ]);

  const onDocumentEvent = document.onDesktopEvent;
  const onSourceEvent = source.onDesktopEvent;
  const onAgentEvent = agent.onDesktopEvent;
  const onSuggestionEvent = suggestionPersistence.onDesktopEvent;

  useEffect(() => {
    eventRef.current = (event) => {
      onDocumentEvent(event);
      onSourceEvent(event);
      onAgentEvent(event);
      if (event.type === "suggestion.event") onSuggestionEvent(event);
    };
  }, [onAgentEvent, onDocumentEvent, onSourceEvent, onSuggestionEvent]);

  const [partnerView, setPartnerView] = useState<"suggestions" | "activity">(
    "suggestions",
  );
  const suggestionNavigator = useSuggestionKeyboardNavigation({
    entries: inbox.entries,
    pinnedEntries: inbox.pinnedEntries,
    selectedId: inbox.selectedEntry?.item.id,
    onSelect: inbox.select,
  });

  const placeOnWorkspace = inbox.placeOnWorkspace;
  const handlePlaceOnWorkspace = useCallback(
    (item: SuggestionItem) => {
      if (!supportsWorkspacePlacement(item)) return;
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
    workspacePhase: hydration.phase,
    hydrationError: hydration.error,
    documentSaveStatus: document.status,
    documentSaveError: document.error,
    sources: source.sources,
    sourceImportPending: source.pending,
    sourceImportError: source.error,
    runtime: agent.runtime,
    activity: agent.activity,
    agentControlPending: agent.pending,
    agentError: agent.error ?? agent.runtime.error,
    suggestionPersistenceStatus: suggestionPersistence.status,
    suggestionPersistenceError: suggestionPersistence.failureMessage,
    retrySuggestionSave: suggestionPersistence.retry,
    partnerView,
    setPartnerView,
    suggestionNavigator,
    handleEditorChange: document.handleChange,
    flushDocument: document.flush,
    handleEditorSelectionChange: preview.handleSelectionChange,
    handleUploadSource: source.importSource,
    handleStartAgent: agent.start,
    handleStopAgent: agent.stop,
    handlePreview: preview.preview,
    handlePlaceOnWorkspace,
  };
}
