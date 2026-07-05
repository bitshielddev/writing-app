import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopBridge, DesktopEvent } from "../shared/desktop";
import { applySuggestionCommand, type DurableSuggestionCommand } from "./transitions";
import type { PersistedSuggestionState } from "./state";

export type SuggestionPersistenceStatus =
  | { state: "idle"; acknowledgedVersion: number }
  | { state: "saving" | "pending" | "retrying"; acknowledgedVersion: number }
  | { state: "failed"; acknowledgedVersion: number; message: string };

type Candidate = { commandId: string; command: DurableSuggestionCommand };
type ReconcileListener = (state: PersistedSuggestionState) => void;

const failureText = "A suggestion change could not be applied. Retry or refresh the workspace.";
const newCommandId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function useSuggestionPersistence(desktop: DesktopBridge) {
  const [status, setStatus] = useState<SuggestionPersistenceStatus>({ state: "idle", acknowledgedVersion: 0 });
  const [failureMessage, setFailureMessage] = useState<string>();
  const mounted = useRef(true);
  const documentId = useRef<string | undefined>(undefined);
  const revision = useRef(0);
  const authoritative = useRef<PersistedSuggestionState | undefined>(undefined);
  const active = useRef<Candidate | undefined>(undefined);
  const pending = useRef<Candidate[]>([]);
  const failed = useRef<Candidate | undefined>(undefined);
  const listeners = useRef(new Set<ReconcileListener>());

  const publishProjection = useCallback(() => {
    if (!authoritative.current) return;
    let display = structuredClone(authoritative.current);
    for (const candidate of [...(active.current ? [active.current] : []), ...pending.current]) {
      const transition = applySuggestionCommand(display, candidate.command);
      if (transition.status !== "rejected") display = transition.state;
    }
    listeners.current.forEach((listener) => listener(display));
  }, []);

  const drain = useCallback(function drainQueue() {
    if (!mounted.current || active.current || pending.current.length === 0 || !documentId.current || !authoritative.current) return;
    const candidate = pending.current.shift()!;
    active.current = candidate;
    setStatus({ state: pending.current.length ? "pending" : "saving", acknowledgedVersion: revision.current });
    void desktop.executeSuggestionCommand({
      commandId: candidate.commandId,
      documentId: documentId.current,
      expectedSuggestionRevision: revision.current,
      command: candidate.command,
    }).then((result) => {
      if (!mounted.current) return;
      if (active.current?.commandId !== candidate.commandId) return;
      active.current = undefined;
      authoritative.current = structuredClone(result.state);
      revision.current = result.suggestionRevision;
      if (result.status === "conflict" && candidate.command.type === "workspace.geometry") {
        pending.current.unshift({ commandId: newCommandId(), command: candidate.command });
      } else if (result.status === "conflict" || result.status === "rejected") {
        failed.current = candidate;
        setFailureMessage(result.reason ?? failureText);
        setStatus({ state: "failed", acknowledgedVersion: revision.current, message: result.reason ?? failureText });
        publishProjection();
        return;
      } else {
        failed.current = undefined;
        setFailureMessage(undefined);
      }
      publishProjection();
      if (pending.current.length) drainQueue();
      else setStatus({ state: "idle", acknowledgedVersion: revision.current });
    }, (error: unknown) => {
      if (!mounted.current) return;
      active.current = undefined;
      failed.current = candidate;
      const message = error instanceof Error ? error.message : String(error);
      setFailureMessage(failureText);
      setStatus({ state: "failed", acknowledgedVersion: revision.current, message });
      publishProjection();
    });
  }, [desktop, publishProjection]);

  const dispatchCommand = useCallback((command: DurableSuggestionCommand) => {
    const candidate = { commandId: newCommandId(), command };
    if (command.type === "workspace.geometry") {
      const index = pending.current.findIndex((queued) =>
        queued.command.type === "workspace.geometry" && queued.command.suggestionId === command.suggestionId);
      if (index >= 0) pending.current[index] = candidate;
      else pending.current.push(candidate);
    } else pending.current.push(candidate);
    failed.current = undefined;
    if (active.current) setStatus({ state: "pending", acknowledgedVersion: revision.current });
    drain();
  }, [drain]);

  const seedHydratedState = useCallback((state: PersistedSuggestionState, suggestionRevision = 0, hydratedDocumentId?: string) => {
    authoritative.current = structuredClone(state);
    revision.current = suggestionRevision;
    documentId.current = hydratedDocumentId;
    active.current = undefined;
    pending.current = [];
    failed.current = undefined;
    setFailureMessage(undefined);
    setStatus({ state: "idle", acknowledgedVersion: suggestionRevision });
  }, []);

  const onDesktopEvent = useCallback((event: DesktopEvent) => {
    if (event.type !== "suggestion.event" || event.suggestionRevision <= revision.current) return;
    authoritative.current = structuredClone(event.state);
    revision.current = event.suggestionRevision;
    publishProjection();
  }, [publishProjection]);

  const subscribe = useCallback((listener: ReconcileListener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  const retry = useCallback(() => {
    if (!failed.current || active.current) return;
    pending.current.unshift({ ...failed.current, commandId: newCommandId() });
    failed.current = undefined;
    setFailureMessage(undefined);
    setStatus({ state: "retrying", acknowledgedVersion: revision.current });
    drain();
  }, [drain]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  return { status, failureMessage, dispatchCommand, seedHydratedState, onDesktopEvent, subscribe, retry };
}
