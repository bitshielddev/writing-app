import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DesktopBridge, DesktopEvent } from "../../../contracts/desktop-bridge";
import {
  presentInboxEntry,
  presentPinnedEntry,
  selectSortedInboxEntries,
  selectSortedPinnedEntries,
  selectUnreadCount,
  type InboxEntry,
  type WorkspacePinRect,
} from "./inboxReducer";
import { createEmptySuggestionState, type PersistedSuggestionState } from "../../../domain/suggestions/state";
import { applySuggestionCommand, type DurableSuggestionCommand } from "../../../domain/suggestions/transitions";

export type SuggestionControllerStatus =
  | { state: "idle"; acknowledgedVersion: number }
  | { state: "saving" | "pending" | "retrying"; acknowledgedVersion: number }
  | { state: "failed"; acknowledgedVersion: number; message: string };

type Candidate = { commandId: string; command: DurableSuggestionCommand };
type TransientEntry = { id: string; entry: InboxEntry; stale: boolean; withdrawn: boolean };

const failureText = "A suggestion change could not be applied. Retry or refresh the workspace.";
const newCommandId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function locate(state: PersistedSuggestionState, id: string) {
  return state.entries.find((entry) => entry.item.id === id) ??
    state.pinnedEntries.find((entry) => entry.item.id === id);
}

function optimisticProjection(
  authoritative: PersistedSuggestionState,
  active: Candidate | undefined,
  pending: Candidate[],
) {
  let projection = structuredClone(authoritative);
  for (const candidate of [...(active ? [active] : []), ...pending]) {
    const transition = applySuggestionCommand(projection, candidate.command);
    if (transition.status !== "rejected") projection = transition.state;
  }
  return projection;
}

export function useSuggestionController(desktop: DesktopBridge) {
  const [projection, setProjection] = useState(createEmptySuggestionState);
  const projectionRef = useRef(projection);
  const [selected, setSelected] = useState<TransientEntry>();
  const [activePreview, setActivePreview] = useState<TransientEntry>();
  const [status, setStatus] = useState<SuggestionControllerStatus>({ state: "idle", acknowledgedVersion: 0 });
  const [failureMessage, setFailureMessage] = useState<string>();
  const mounted = useRef(true);
  const projectId = useRef<string | undefined>(undefined);
  const documentId = useRef<string | undefined>(undefined);
  const revision = useRef(0);
  const authoritative = useRef<PersistedSuggestionState>(createEmptySuggestionState());
  const active = useRef<Candidate | undefined>(undefined);
  const pending = useRef<Candidate[]>([]);
  const failed = useRef<Candidate | undefined>(undefined);

  const publishProjection = useCallback(() => {
    const next = optimisticProjection(authoritative.current, active.current, pending.current);
    projectionRef.current = next;
    setProjection(next);
  }, []);

  const drain = useCallback(function drainQueue() {
    if (!mounted.current || active.current || !pending.current.length || !projectId.current || !documentId.current) return;
    const candidate = pending.current.shift()!;
    active.current = candidate;
    setStatus({ state: pending.current.length ? "pending" : "saving", acknowledgedVersion: revision.current });
    publishProjection();
    void desktop.executeSuggestionCommand({
      commandId: candidate.commandId,
      projectId: projectId.current,
      documentId: documentId.current,
      expectedSuggestionRevision: revision.current,
      command: candidate.command,
    }).then((result) => {
      if (!mounted.current || active.current?.commandId !== candidate.commandId) return;
      active.current = undefined;
      if (result.suggestionRevision >= revision.current) {
        authoritative.current = structuredClone(result.state);
        revision.current = result.suggestionRevision;
      }
      if (result.status === "conflict" && candidate.command.type === "workspace.geometry") {
        pending.current.unshift({ commandId: newCommandId(), command: candidate.command });
      } else if (result.status === "conflict" || result.status === "rejected") {
        failed.current = candidate;
        const message = result.reason ?? failureText;
        setFailureMessage(message);
        setStatus({ state: "failed", acknowledgedVersion: revision.current, message });
        publishProjection();
        return;
      } else {
        failed.current = undefined;
        setFailureMessage(undefined);
      }
      publishProjection();
      if (pending.current.length) drainQueue();
      else setStatus({ state: "idle", acknowledgedVersion: revision.current });
    }, (cause: unknown) => {
      if (!mounted.current || active.current?.commandId !== candidate.commandId) return;
      active.current = undefined;
      failed.current = candidate;
      const message = cause instanceof Error ? cause.message : String(cause);
      setFailureMessage(failureText);
      setStatus({ state: "failed", acknowledgedVersion: revision.current, message });
      publishProjection();
    });
  }, [desktop, publishProjection]);

  const enqueue = useCallback((command: DurableSuggestionCommand) => {
    const candidate = { commandId: newCommandId(), command };
    if (command.type === "workspace.geometry") {
      const index = pending.current.findIndex((queued) =>
        queued.command.type === "workspace.geometry" && queued.command.suggestionId === command.suggestionId);
      if (index >= 0) pending.current[index] = candidate;
      else pending.current.push(candidate);
    } else pending.current.push(candidate);
    failed.current = undefined;
    setFailureMessage(undefined);
    publishProjection();
    if (active.current) setStatus({ state: "pending", acknowledgedVersion: revision.current });
    drain();
  }, [drain, publishProjection]);

  const seedHydratedState = useCallback((
    state: PersistedSuggestionState,
    suggestionRevision = 0,
    hydratedProjectId?: string,
    hydratedDocumentId?: string,
  ) => {
    if (hydratedProjectId && !hydratedDocumentId) {
      hydratedDocumentId = hydratedProjectId;
      hydratedProjectId = "default-project";
    }
    authoritative.current = structuredClone(state);
    revision.current = suggestionRevision;
    projectId.current = hydratedProjectId;
    documentId.current = hydratedDocumentId;
    active.current = undefined;
    pending.current = [];
    failed.current = undefined;
    projectionRef.current = structuredClone(state);
    setProjection(structuredClone(state));
    setSelected(undefined);
    setActivePreview(undefined);
    setFailureMessage(undefined);
    setStatus({ state: "idle", acknowledgedVersion: suggestionRevision });
  }, []);

  const updateTransientFromEvent = useCallback((event: Extract<DesktopEvent, { type: "suggestion.event" }>["event"]) => {
    if (event.type !== "suggestion.updated" && event.type !== "suggestion.retracted") return;
    const id = event.type === "suggestion.updated" ? event.item.id : event.id;
    const update = (current: TransientEntry | undefined) => {
      if (!current || current.id !== id) return current;
      if (event.type === "suggestion.retracted") {
        return { ...current, stale: true, withdrawn: true,
          entry: { ...current.entry, stale: true, withdrawn: true } };
      }
      return { ...current, stale: true,
        entry: { ...current.entry, item: event.item, stale: true } };
    };
    setSelected(update);
    setActivePreview(update);
  }, []);

  const onDesktopEvent = useCallback((event: DesktopEvent) => {
    if (event.type !== "suggestion.event" || event.suggestionRevision <= revision.current) return;
    updateTransientFromEvent(event.event);
    authoritative.current = structuredClone(event.state);
    revision.current = event.suggestionRevision;
    if (event.commandId && active.current?.commandId === event.commandId) {
      active.current = undefined;
      failed.current = undefined;
      setFailureMessage(undefined);
    }
    publishProjection();
    if (pending.current.length && !active.current) drain();
    else if (!active.current) setStatus({ state: "idle", acknowledgedVersion: revision.current });
  }, [drain, publishProjection, updateTransientFromEvent]);

  const entries = useMemo(() => selectSortedInboxEntries(projection, activePreview
    ? { id: activePreview.id, stale: activePreview.stale, withdrawn: activePreview.withdrawn }
    : undefined), [activePreview, projection]);
  const pinnedEntries = useMemo(() => selectSortedPinnedEntries(projection), [projection]);
  const selectedEntry = useMemo(() => {
    if (!selected) return undefined;
    if (selected.withdrawn) return selected.entry;
    const live = projection.entries.find((entry) => entry.item.id === selected.id);
    if (live) return presentInboxEntry(live, activePreview?.id === selected.id ? activePreview : undefined);
    const pinned = projection.pinnedEntries.find((entry) => entry.item.id === selected.id);
    return pinned ? presentPinnedEntry(pinned) : selected.entry;
  }, [activePreview, projection, selected]);

  const select = useCallback((id: string) => {
    const entry = locate(projectionRef.current, id);
    if (!entry) return;
    setSelected({ id, entry: presentInboxEntry(entry), stale: false, withdrawn: false });
    if (!entry.viewed) enqueue({ type: "markViewed", suggestionId: id });
  }, [enqueue]);
  const back = useCallback(() => setSelected(undefined), []);
  const dismiss = useCallback((id: string) => {
    if (activePreview?.id === id) return;
    if (!locate(projectionRef.current, id)) {
      setSelected((current) => current?.id === id ? undefined : current);
      return;
    }
    setSelected((current) => current?.id === id ? undefined : current);
    enqueue({ type: "dismiss", suggestionId: id });
  }, [activePreview, enqueue]);
  const pin = useCallback((id: string) => enqueue({ type: "pin", suggestionId: id, pinnedAt: Date.now() }), [enqueue]);
  const unpin = useCallback((id: string) => enqueue({ type: "unpin", suggestionId: id }), [enqueue]);
  const placeOnWorkspace = useCallback((id: string, rect: WorkspacePinRect) => {
    if (activePreview?.id !== id) {
      setSelected((current) => current?.id === id ? undefined : current);
      enqueue({ type: "workspace.place", suggestionId: id, rect });
    }
  }, [activePreview, enqueue]);
  const returnToPins = useCallback((id: string) => enqueue({ type: "workspace.return", suggestionId: id }), [enqueue]);
  const updateWorkspaceGeometry = useCallback((id: string, rect: WorkspacePinRect) =>
    enqueue({ type: "workspace.geometry", suggestionId: id, rect }), [enqueue]);
  const raiseWorkspacePin = useCallback((id: string) => enqueue({ type: "workspace.raise", suggestionId: id }), [enqueue]);
  const previewStarted = useCallback((id: string) => {
    const entry = locate(projectionRef.current, id);
    if (!entry || activePreview) return;
    const transient = { id, entry: presentInboxEntry(entry), stale: false, withdrawn: false };
    setActivePreview(transient);
    if (!entry.viewed) enqueue({ type: "markViewed", suggestionId: id });
  }, [activePreview, enqueue]);
  const previewResolved = useCallback((id: string, outcome: "accepted" | "cancelled") => {
    const shouldCloseDetail = outcome === "accepted" ||
      (activePreview?.id === id && activePreview.withdrawn);
    setActivePreview((current) => current?.id === id ? undefined : current);
    if (locate(projectionRef.current, id)) enqueue({ type: "preview.resolve", suggestionId: id, outcome });
    if (shouldCloseDetail) setSelected((current) => current?.id === id ? undefined : current);
  }, [activePreview, enqueue]);

  const retry = useCallback(() => {
    if (!failed.current || active.current) return;
    pending.current.unshift({ ...failed.current, commandId: newCommandId() });
    failed.current = undefined;
    setFailureMessage(undefined);
    setStatus({ state: "retrying", acknowledgedVersion: revision.current });
    publishProjection();
    drain();
  }, [drain, publishProjection]);
  const flush = useCallback(async () => {
    drain();
    while (active.current || pending.current.length) {
      if (failed.current) throw new Error(failureMessage ?? failureText);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (failed.current) throw new Error(failureMessage ?? failureText);
  }, [drain, failureMessage]);
  const discard = useCallback(() => {
    active.current = undefined;
    pending.current = [];
    failed.current = undefined;
    setFailureMessage(undefined);
    publishProjection();
    setStatus({ state: "idle", acknowledgedVersion: revision.current });
  }, [publishProjection]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  return {
    ...projection,
    entries,
    pinnedEntries,
    selectedEntry,
    activePreviewId: activePreview?.id,
    unreadCount: selectUnreadCount(projection),
    select, back, dismiss, pin, unpin, placeOnWorkspace, returnToPins,
    updateWorkspaceGeometry, raiseWorkspacePin, previewStarted, previewResolved,
    seedHydratedState, onDesktopEvent, status, failureMessage, retry, flush, discard,
  };
}
