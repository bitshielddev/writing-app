import { useCallback, useEffect, useRef, useState } from "react";

import type { WritingEditor } from "../editor/schema";
import type { DesktopBridge, DesktopEvent, ProcessHealthSnapshot, WorkspaceCatalog, WorkspaceSnapshot } from "../contracts/desktop-bridge";
import { useSuggestionController } from "../suggestions/inbox";
import { useSuggestionKeyboardNavigation } from "../suggestions/keyboardNavigation";
import { getInitialWorkspacePinSize } from "../suggestions/workspacePinLayout";
import {
  supportsWorkspacePlacement,
  type SuggestionItem,
} from "../domain/suggestions/schema";
import { useAgentController } from "./useAgentController";
import { useDocumentAutosave } from "./useDocumentAutosave";
import { usePreviewController } from "./usePreviewController";
import { useSourceController } from "./useSourceController";
import { useWorkspaceHydration } from "./useWorkspaceHydration";

export function useWorkspaceController(
  desktop: DesktopBridge,
  editor: WritingEditor,
) {
  const catalogAvailable = typeof (desktop as Partial<DesktopBridge>).getWorkspaceCatalog === "function";
  const [catalog, setCatalog] = useState<WorkspaceCatalog>();
  const [scope, setScope] = useState<{ projectId: string; documentId: string } | undefined>(() =>
    catalogAvailable ? undefined : { projectId: "default-project", documentId: "default-document" });
  const [switchPending, setSwitchPending] = useState(false);
  const [switchError, setSwitchError] = useState<string>();
  const [failedSwitch, setFailedSwitch] = useState<{ projectId: string; documentId: string }>();
  const [health, setHealth] = useState<ProcessHealthSnapshot>({
    storage: { state: "starting" }, agent: { state: "starting" },
  });
  useEffect(() => {
    let cancelled = false;
    if (!catalogAvailable) return;
    void desktop.getWorkspaceCatalog().then((next) => {
      if (cancelled) return;
      setCatalog(next);
      setScope(next.selection);
    }, (cause) => {
      if (!cancelled) setSwitchError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [catalogAvailable, desktop]);
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
    scope,
    initialize: initializeSnapshot,
    onEvent: applyDesktopEvent,
  });

  const inbox = useSuggestionController(desktop);
  const document = useDocumentAutosave(
    desktop,
    editor,
    hydration.phase === "ready",
    health.storage.state === "healthy",
  );
  const source = useSourceController(desktop, scope);
  const agent = useAgentController(desktop, scope);
  const preview = usePreviewController({
    editor,
    activePreviewId: inbox.activePreviewId,
    previewStarted: inbox.previewStarted,
    previewResolved: inbox.previewResolved,
  });

  const initializeDocument = document.initialize;
  const initializeSources = source.initialize;
  const initializeAgent = agent.initialize;
  const seedSuggestionState = inbox.seedHydratedState;
  const initializePreview = preview.initialize;
  useEffect(() => {
    initializeRef.current = (snapshot) => {
      initializeDocument(snapshot.document);
      initializeSources(snapshot.sources);
      initializeAgent(snapshot.agent, snapshot.activity);
      seedSuggestionState(snapshot.suggestions, snapshot.suggestionRevision, snapshot.project.id, snapshot.document.id);
      initializePreview();
      if (snapshot.health) setHealth(snapshot.health);
    };
  }, [
    initializeAgent,
    initializeDocument,
    initializePreview,
    initializeSources,
    seedSuggestionState,
  ]);

  const onDocumentEvent = document.onDesktopEvent;
  const onSourceEvent = source.onDesktopEvent;
  const onAgentEvent = agent.onDesktopEvent;
  const onSuggestionEvent = inbox.onDesktopEvent;
  const flushSuggestions = inbox.flush;
  const discardSuggestions = inbox.discard;

  useEffect(() => {
    eventRef.current = (event) => {
      if (event.type === "process.health") setHealth(event.health);
      onDocumentEvent(event);
      onSourceEvent(event);
      onAgentEvent(event);
      if (event.type === "suggestion.event") onSuggestionEvent(event);
    };
  }, [onAgentEvent, onDocumentEvent, onSourceEvent, onSuggestionEvent]);

  const retryProcess = useCallback(async (process: "storage" | "agent") => {
    if (!desktop.retryProcess) return;
    setHealth(await desktop.retryProcess({ process }));
  }, [desktop]);
  const flushWorkspace = useCallback(async () => {
    await Promise.allSettled([document.flushForSwitch(), flushSuggestions()]);
  }, [document, flushSuggestions]);

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

  const selectDocument = useCallback(async (projectId: string, documentId: string) => {
    if (!scope || switchPending || (scope.projectId === projectId && scope.documentId === documentId)) return;
    setSwitchPending(true);
    setSwitchError(undefined);
    setFailedSwitch(undefined);
    try {
      await document.flushForSwitch();
      await flushSuggestions();
      if (agent.runtime.status === "working" || agent.runtime.status === "waiting") await agent.stopAndWait();
      initializePreview();
      const next = await desktop.selectDocument({ projectId, documentId });
      setCatalog(next);
      setScope(next.selection);
    } catch (cause) {
      setSwitchError(cause instanceof Error ? cause.message : "The document could not be switched");
      setFailedSwitch({ projectId, documentId });
    } finally {
      setSwitchPending(false);
    }
  }, [agent, desktop, document, flushSuggestions, initializePreview, scope, switchPending]);

  const retrySwitch = useCallback(() => {
    if (failedSwitch) void selectDocument(failedSwitch.projectId, failedSwitch.documentId);
  }, [failedSwitch, selectDocument]);

  const discardAndSwitch = useCallback(async () => {
    if (!failedSwitch || !window.confirm("Discard local unpersisted changes and switch documents?")) return;
    setSwitchPending(true);
    try {
      document.discard();
      discardSuggestions();
      initializePreview();
      if (agent.runtime.status === "working" || agent.runtime.status === "waiting") await agent.stopAndWait();
      const next = await desktop.selectDocument(failedSwitch);
      setCatalog(next);
      setScope(next.selection);
      setFailedSwitch(undefined);
      setSwitchError(undefined);
    } catch (cause) {
      setSwitchError(cause instanceof Error ? cause.message : "The document could not be switched");
    } finally { setSwitchPending(false); }
  }, [agent, desktop, discardSuggestions, document, failedSwitch, initializePreview]);

  const createDocument = useCallback(async () => {
    if (!scope || switchPending) return;
    setSwitchPending(true);
    try {
      await document.flushForSwitch();
      await flushSuggestions();
      if (agent.runtime.status === "working" || agent.runtime.status === "waiting") await agent.stopAndWait();
      initializePreview();
      const next = await desktop.createDocument({ projectId: scope.projectId, title: "Untitled Draft" });
      setCatalog(next);
      setScope(next.selection);
    } catch (cause) {
      setSwitchError(cause instanceof Error ? cause.message : "The document could not be created");
    } finally { setSwitchPending(false); }
  }, [agent, desktop, document, flushSuggestions, initializePreview, scope, switchPending]);

  const createProject = useCallback(async () => {
    const name = window.prompt("Project name", "New project")?.trim();
    if (!name || switchPending) return;
    setSwitchPending(true);
    try {
      await document.flushForSwitch();
      await flushSuggestions();
      if (agent.runtime.status === "working" || agent.runtime.status === "waiting") await agent.stopAndWait();
      initializePreview();
      const next = await desktop.createProject({ name });
      setCatalog(next); setScope(next.selection);
    } catch (cause) { setSwitchError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSwitchPending(false); }
  }, [agent, desktop, document, flushSuggestions, initializePreview, switchPending]);

  const renameProject = useCallback(async (projectId: string, currentName: string) => {
    const name = window.prompt("Rename project", currentName)?.trim();
    if (!name) return;
    try { setCatalog(await desktop.renameProject({ projectId, name })); }
    catch (cause) { setSwitchError(cause instanceof Error ? cause.message : String(cause)); }
  }, [desktop]);
  const deleteProject = useCallback(async (projectId: string) => {
    if (!window.confirm("Delete this project and all of its documents?")) return;
    try { setCatalog(await desktop.deleteProject({ projectId })); }
    catch (cause) { setSwitchError(cause instanceof Error ? cause.message : String(cause)); }
  }, [desktop]);
  const renameDocument = useCallback(async (projectId: string, documentId: string, currentTitle: string) => {
    const title = window.prompt("Rename document", currentTitle)?.trim();
    if (!title) return;
    try { setCatalog(await desktop.renameDocument({ projectId, documentId, title })); }
    catch (cause) { setSwitchError(cause instanceof Error ? cause.message : String(cause)); }
  }, [desktop]);
  const deleteDocument = useCallback(async (projectId: string, documentId: string) => {
    if (!window.confirm("Delete this document?")) return;
    try { setCatalog(await desktop.deleteDocument({ projectId, documentId })); }
    catch (cause) { setSwitchError(cause instanceof Error ? cause.message : String(cause)); }
  }, [desktop]);

  return {
    inbox,
    catalog,
    selectedScope: scope,
    switchPending,
    switchError,
    selectDocument,
    createDocument,
    createProject,
    renameProject,
    deleteProject,
    renameDocument,
    deleteDocument,
    retrySwitch,
    discardAndSwitch,
    workspacePhase: hydration.phase,
    hydrationError: hydration.error,
    documentSaveStatus: document.status,
    documentSaveError: document.error,
    sources: source.sources,
    sourceImportPending: source.pending,
    sourceImportError: source.error,
    runtime: agent.runtime,
    health,
    retryProcess,
    activity: agent.activity,
    agentControlPending: agent.pending,
    agentError: agent.error ?? agent.runtime.error,
    suggestionPersistenceStatus: inbox.status,
    suggestionPersistenceError: inbox.failureMessage,
    retrySuggestionSave: inbox.retry,
    partnerView,
    setPartnerView,
    suggestionNavigator,
    handleEditorChange: document.handleChange,
    flushDocument: flushWorkspace,
    handleEditorSelectionChange: preview.handleSelectionChange,
    handleUploadSource: source.importSource,
    handleStartAgent: agent.start,
    handleStopAgent: agent.stop,
    handlePreview: preview.preview,
    handlePlaceOnWorkspace,
  };
}
