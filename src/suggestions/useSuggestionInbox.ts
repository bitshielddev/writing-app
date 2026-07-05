import { useCallback, useEffect, useMemo, useReducer } from "react";

import {
  inboxReducer,
  initialInboxState,
  selectSelectedEntry,
  selectSortedInboxEntries,
  selectSortedPinnedEntries,
  selectUnreadCount,
  type WorkspacePinRect,
} from "./inboxReducer";
import type { PersistedSuggestionState } from "./state";
import type { SuggestionFeed } from "./types";
import type { DurableSuggestionCommand } from "./transitions";

export type SuggestionInboxOptions = {
  onCommand?: (command: DurableSuggestionCommand) => void;
  subscribeToAuthoritativeState?: (listener: (state: PersistedSuggestionState) => void) => () => void;
};

export function useSuggestionInbox(
  feed: SuggestionFeed,
  options: SuggestionInboxOptions = {},
) {
  const onCommand = options.onCommand;
  const subscribeToAuthoritativeState = options.subscribeToAuthoritativeState;
  const [state, dispatch] = useReducer(inboxReducer, initialInboxState);

  useEffect(
    () => feed.subscribe((event) => dispatch({ type: "event", event })),
    [feed],
  );

  useEffect(() => subscribeToAuthoritativeState?.(
    (next) => dispatch({ type: "hydrate", state: next })),
  [subscribeToAuthoritativeState]);

  const sortedEntries = useMemo(() => selectSortedInboxEntries(state), [state]);
  const sortedPinnedEntries = useMemo(() => selectSortedPinnedEntries(state), [state]);
  const selectedEntry = useMemo(() => selectSelectedEntry(state), [state]);
  const unreadCount = useMemo(() => selectUnreadCount(state), [state]);

  const select = useCallback((id: string) => {
    dispatch({ type: "select", id });
    onCommand?.({ type: "markViewed", suggestionId: id });
  }, [onCommand]);
  const back = useCallback(() => dispatch({ type: "back" }), []);
  const dismiss = useCallback((id: string) => { dispatch({ type: "dismiss", id }); onCommand?.({ type: "dismiss", suggestionId: id }); }, [onCommand]);
  const pin = useCallback(
    (id: string) => { const pinnedAt = Date.now(); dispatch({ type: "pin", id, pinnedAt }); onCommand?.({ type: "pin", suggestionId: id, pinnedAt }); },
    [onCommand],
  );
  const unpin = useCallback((id: string) => { dispatch({ type: "unpin", id }); onCommand?.({ type: "unpin", suggestionId: id }); }, [onCommand]);
  const placeOnWorkspace = useCallback(
    (id: string, rect: WorkspacePinRect) =>
      { dispatch({ type: "workspace.place", id, rect }); onCommand?.({ type: "workspace.place", suggestionId: id, rect }); },
    [onCommand],
  );
  const returnToPins = useCallback(
    (id: string) => { dispatch({ type: "workspace.return", id }); onCommand?.({ type: "workspace.return", suggestionId: id }); },
    [onCommand],
  );
  const updateWorkspaceGeometry = useCallback(
    (id: string, rect: WorkspacePinRect) =>
      { dispatch({ type: "workspace.geometry", id, rect }); onCommand?.({ type: "workspace.geometry", suggestionId: id, rect }); },
    [onCommand],
  );
  const raiseWorkspacePin = useCallback(
    (id: string) => { dispatch({ type: "workspace.raise", id }); onCommand?.({ type: "workspace.raise", suggestionId: id }); },
    [onCommand],
  );
  const previewStarted = useCallback(
    (id: string) => { dispatch({ type: "preview.started", id }); onCommand?.({ type: "markViewed", suggestionId: id }); },
    [onCommand],
  );
  const previewResolved = useCallback(
    (id: string, outcome: "accepted" | "cancelled") =>
      { dispatch({ type: "preview.resolved", id, outcome }); onCommand?.({ type: "preview.resolve", suggestionId: id, outcome }); },
    [onCommand],
  );
  const hydrate = useCallback((nextState: PersistedSuggestionState) => {
    dispatch({ type: "hydrate", state: nextState });
  }, []);

  return {
    ...state,
    entries: sortedEntries,
    pinnedEntries: sortedPinnedEntries,
    selectedEntry,
    unreadCount,
    select,
    back,
    dismiss,
    pin,
    unpin,
    placeOnWorkspace,
    returnToPins,
    updateWorkspaceGeometry,
    raiseWorkspacePin,
    previewStarted,
    previewResolved,
    hydrate,
  };
}
