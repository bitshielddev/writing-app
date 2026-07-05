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

export type SuggestionInboxOptions = {
  onStateChange?: (state: PersistedSuggestionState) => void;
};

export function useSuggestionInbox(
  feed: SuggestionFeed,
  options: SuggestionInboxOptions = {},
) {
  const onStateChange = options.onStateChange;
  const [state, dispatch] = useReducer(inboxReducer, initialInboxState);
  const [hydrated, setHydrated] = useReducer(() => true, !onStateChange);
  const { entries, nextZIndex, pinnedEntries, seenKeys, workspacePins } = state;
  const durableState = useMemo(
    () => ({ entries, pinnedEntries, workspacePins, seenKeys, nextZIndex }),
    [entries, nextZIndex, pinnedEntries, seenKeys, workspacePins],
  );

  useEffect(
    () => feed.subscribe((event) => dispatch({ type: "event", event })),
    [feed],
  );

  useEffect(() => {
    if (hydrated) onStateChange?.(durableState);
  }, [durableState, hydrated, onStateChange]);

  const sortedEntries = useMemo(() => selectSortedInboxEntries(state), [state]);
  const sortedPinnedEntries = useMemo(() => selectSortedPinnedEntries(state), [state]);
  const selectedEntry = useMemo(() => selectSelectedEntry(state), [state]);
  const unreadCount = useMemo(() => selectUnreadCount(state), [state]);

  const select = useCallback((id: string) => dispatch({ type: "select", id }), []);
  const back = useCallback(() => dispatch({ type: "back" }), []);
  const dismiss = useCallback((id: string) => dispatch({ type: "dismiss", id }), []);
  const pin = useCallback(
    (id: string) => dispatch({ type: "pin", id, pinnedAt: Date.now() }),
    [],
  );
  const unpin = useCallback((id: string) => dispatch({ type: "unpin", id }), []);
  const placeOnWorkspace = useCallback(
    (id: string, rect: WorkspacePinRect) =>
      dispatch({ type: "workspace.place", id, rect }),
    [],
  );
  const returnToPins = useCallback(
    (id: string) => dispatch({ type: "workspace.return", id }),
    [],
  );
  const updateWorkspaceGeometry = useCallback(
    (id: string, rect: WorkspacePinRect) =>
      dispatch({ type: "workspace.geometry", id, rect }),
    [],
  );
  const raiseWorkspacePin = useCallback(
    (id: string) => dispatch({ type: "workspace.raise", id }),
    [],
  );
  const previewStarted = useCallback(
    (id: string) => dispatch({ type: "preview.started", id }),
    [],
  );
  const previewResolved = useCallback(
    (id: string, outcome: "accepted" | "cancelled") =>
      dispatch({ type: "preview.resolved", id, outcome }),
    [],
  );
  const hydrate = useCallback((nextState: PersistedSuggestionState) => {
    dispatch({ type: "hydrate", state: nextState });
    setHydrated();
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
