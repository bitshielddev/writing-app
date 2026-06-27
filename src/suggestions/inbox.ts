import { useCallback, useEffect, useMemo, useReducer } from "react";

import type {
  AgentStatus,
  SuggestionEvent,
  SuggestionFeed,
  SuggestionItem,
} from "./types";

export type InboxEntry = {
  item: SuggestionItem;
  viewed: boolean;
  stale: boolean;
  withdrawn: boolean;
};

export type PinnedInboxEntry = InboxEntry & {
  pinnedAt: number;
};

export type WorkspacePinRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WorkspacePin = WorkspacePinRect & {
  item: SuggestionItem;
  pinnedAt: number;
  pendingInitialPlacement: boolean;
  zIndex: number;
};

type InboxState = {
  entries: InboxEntry[];
  pinnedEntries: PinnedInboxEntry[];
  workspacePins: WorkspacePin[];
  seenKeys: Record<string, true>;
  selectedId?: string;
  activePreviewId?: string;
  nextZIndex: number;
  status: AgentStatus;
  error?: { message: string; recoverable: boolean };
};

type InboxAction =
  | { type: "event"; event: SuggestionEvent }
  | { type: "select"; id: string }
  | { type: "back" }
  | { type: "dismiss"; id: string }
  | { type: "pin"; id: string; pinnedAt: number }
  | { type: "unpin"; id: string }
  | { type: "workspace.place"; id: string; rect: WorkspacePinRect }
  | { type: "workspace.return"; id: string }
  | { type: "workspace.geometry"; id: string; rect: WorkspacePinRect }
  | { type: "workspace.raise"; id: string }
  | { type: "preview.started"; id: string }
  | { type: "preview.resolved"; id: string; outcome: "accepted" | "cancelled" };

export const initialInboxState: InboxState = {
  entries: [],
  pinnedEntries: [],
  workspacePins: [],
  seenKeys: {},
  nextZIndex: 1,
  status: "idle",
};

function copySuggestion(item: SuggestionItem): SuggestionItem {
  return JSON.parse(JSON.stringify(item)) as SuggestionItem;
}

function enforceLimit(state: InboxState): InboxState {
  if (state.entries.length <= 30) {
    return state;
  }

  const protectedIds = new Set(
    [state.selectedId, state.activePreviewId].filter(
      (id): id is string => Boolean(id),
    ),
  );
  const evictionOrder = [...state.entries]
    .filter((entry) => !protectedIds.has(entry.item.id))
    .sort((a, b) => {
      if (a.viewed !== b.viewed) {
        return a.viewed ? -1 : 1;
      }
      return a.item.createdAt - b.item.createdAt;
    });
  const removeCount = state.entries.length - 30;
  const evicted = new Set(
    evictionOrder.slice(0, removeCount).map((entry) => entry.item.id),
  );

  return {
    ...state,
    entries: state.entries.filter((entry) => !evicted.has(entry.item.id)),
  };
}

function markViewed<T extends InboxEntry>(entries: T[], id: string): T[] {
  return entries.map((entry) =>
    entry.item.id === id ? { ...entry, viewed: true } : entry,
  );
}

export function inboxReducer(
  state: InboxState,
  action: InboxAction,
): InboxState {
  if (action.type === "event") {
    const event = action.event;

    if (event.type === "agent.status") {
      return { ...state, status: event.status, error: undefined };
    }

    if (event.type === "agent.error") {
      return {
        ...state,
        status: "idle",
        error: { message: event.message, recoverable: event.recoverable },
      };
    }

    if (event.type === "suggestion.added") {
      if (state.seenKeys[event.item.dedupeKey]) {
        return state;
      }

      return enforceLimit({
        ...state,
        entries: [
          ...state.entries,
          { item: event.item, viewed: false, stale: false, withdrawn: false },
        ],
        seenKeys: { ...state.seenKeys, [event.item.dedupeKey]: true },
      });
    }

    if (event.type === "suggestion.updated") {
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.item.id === event.item.id
            ? {
                ...entry,
                item: event.item,
                stale: entry.item.id === state.activePreviewId,
              }
            : entry,
        ),
      };
    }

    if (
      state.pinnedEntries.some((entry) => entry.item.id === event.id) ||
      state.workspacePins.some((pin) => pin.item.id === event.id)
    ) {
      return state;
    }

    const protectedItem =
      event.id === state.selectedId || event.id === state.activePreviewId;
    return {
      ...state,
      entries: protectedItem
        ? state.entries.map((entry) =>
            entry.item.id === event.id
              ? { ...entry, withdrawn: true, stale: true }
              : entry,
          )
        : state.entries.filter((entry) => entry.item.id !== event.id),
    };
  }

  if (action.type === "select") {
    return {
      ...state,
      selectedId: action.id,
      entries: markViewed(state.entries, action.id),
      pinnedEntries: markViewed(state.pinnedEntries, action.id),
    };
  }

  if (action.type === "back") {
    return {
      ...state,
      selectedId: undefined,
      entries: state.entries.filter(
        (entry) =>
          !entry.withdrawn || entry.item.id === state.activePreviewId,
      ),
    };
  }

  if (action.type === "dismiss") {
    return {
      ...state,
      selectedId: state.selectedId === action.id ? undefined : state.selectedId,
      entries: state.entries.filter((entry) => entry.item.id !== action.id),
      pinnedEntries: state.pinnedEntries.filter(
        (entry) => entry.item.id !== action.id,
      ),
    };
  }

  if (action.type === "pin") {
    const entry = state.entries.find((candidate) => candidate.item.id === action.id);
    if (!entry) {
      return state;
    }
    return {
      ...state,
      entries: state.entries.filter((candidate) => candidate.item.id !== action.id),
      pinnedEntries: [
        ...state.pinnedEntries,
        {
          ...entry,
          item: copySuggestion(entry.item),
          stale: false,
          withdrawn: false,
          pinnedAt: action.pinnedAt,
        },
      ],
    };
  }

  if (action.type === "unpin") {
    const entry = state.pinnedEntries.find(
      (candidate) => candidate.item.id === action.id,
    );
    if (!entry) {
      return state;
    }
    return enforceLimit({
      ...state,
      entries: [
        ...state.entries,
        {
          item: entry.item,
          viewed: entry.viewed,
          stale: false,
          withdrawn: false,
        },
      ],
      pinnedEntries: state.pinnedEntries.filter(
        (candidate) => candidate.item.id !== action.id,
      ),
    });
  }

  if (action.type === "workspace.place") {
    if (state.activePreviewId === action.id) {
      return state;
    }
    const entry = state.pinnedEntries.find(
      (candidate) => candidate.item.id === action.id,
    );
    if (!entry) {
      return state;
    }
    return {
      ...state,
      selectedId: state.selectedId === action.id ? undefined : state.selectedId,
      pinnedEntries: state.pinnedEntries.filter(
        (candidate) => candidate.item.id !== action.id,
      ),
      workspacePins: [
        ...state.workspacePins,
        {
          item: entry.item,
          pinnedAt: entry.pinnedAt,
          pendingInitialPlacement: true,
          ...action.rect,
          zIndex: state.nextZIndex,
        },
      ],
      nextZIndex: state.nextZIndex + 1,
    };
  }

  if (action.type === "workspace.return") {
    const pin = state.workspacePins.find(
      (candidate) => candidate.item.id === action.id,
    );
    if (!pin) {
      return state;
    }
    return {
      ...state,
      pinnedEntries: [
        ...state.pinnedEntries,
        {
          item: pin.item,
          viewed: true,
          stale: false,
          withdrawn: false,
          pinnedAt: pin.pinnedAt,
        },
      ],
      workspacePins: state.workspacePins.filter(
        (candidate) => candidate.item.id !== action.id,
      ),
    };
  }

  if (action.type === "workspace.geometry") {
    return {
      ...state,
      workspacePins: state.workspacePins.map((pin) =>
        pin.item.id === action.id
          ? { ...pin, ...action.rect, pendingInitialPlacement: false }
          : pin,
      ),
    };
  }

  if (action.type === "workspace.raise") {
    const pin = state.workspacePins.find(
      (candidate) => candidate.item.id === action.id,
    );
    if (!pin || pin.zIndex === state.nextZIndex - 1) {
      return state;
    }
    return {
      ...state,
      workspacePins: state.workspacePins.map((candidate) =>
        candidate.item.id === action.id
          ? { ...candidate, zIndex: state.nextZIndex }
          : candidate,
      ),
      nextZIndex: state.nextZIndex + 1,
    };
  }

  if (action.type === "preview.started") {
    return {
      ...state,
      activePreviewId: action.id,
      entries: markViewed(state.entries, action.id),
      pinnedEntries: markViewed(state.pinnedEntries, action.id),
    };
  }

  const resolvedEntry =
    state.entries.find((entry) => entry.item.id === action.id) ??
    state.pinnedEntries.find((entry) => entry.item.id === action.id);
  const shouldRemove =
    action.outcome === "accepted" || resolvedEntry?.withdrawn === true;
  return {
    ...state,
    activePreviewId: undefined,
    selectedId: shouldRemove ? undefined : state.selectedId,
    entries: shouldRemove
      ? state.entries.filter((entry) => entry.item.id !== action.id)
      : state.entries,
    pinnedEntries: shouldRemove
      ? state.pinnedEntries.filter((entry) => entry.item.id !== action.id)
      : state.pinnedEntries,
  };
}

export function useSuggestionInbox(feed: SuggestionFeed) {
  const [state, dispatch] = useReducer(inboxReducer, initialInboxState);

  useEffect(
    () => feed.subscribe((event) => dispatch({ type: "event", event })),
    [feed],
  );

  const entries = useMemo(
    () =>
      [...state.entries].sort((a, b) => {
        if (a.viewed !== b.viewed) {
          return a.viewed ? 1 : -1;
        }
        return b.item.createdAt - a.item.createdAt;
      }),
    [state.entries],
  );
  const pinnedEntries = useMemo(
    () => [...state.pinnedEntries].sort((a, b) => b.pinnedAt - a.pinnedAt),
    [state.pinnedEntries],
  );
  const selectedEntry = state.selectedId
    ? state.entries.find((entry) => entry.item.id === state.selectedId) ??
      state.pinnedEntries.find((entry) => entry.item.id === state.selectedId)
    : undefined;
  const select = useCallback((id: string) => dispatch({ type: "select", id }), []);
  const back = useCallback(() => dispatch({ type: "back" }), []);
  const dismiss = useCallback(
    (id: string) => dispatch({ type: "dismiss", id }),
    [],
  );
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

  return {
    ...state,
    entries,
    pinnedEntries,
    selectedEntry,
    unreadCount:
      state.entries.filter((entry) => !entry.viewed).length +
      state.pinnedEntries.filter((entry) => !entry.viewed).length,
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
  };
}
