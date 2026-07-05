import {
  createEmptySuggestionState,
  trimSuggestionEntries,
  type PersistedInboxEntry,
  type PersistedPinnedEntry,
  type PersistedSuggestionState,
  type PersistedWorkspacePin,
  type WorkspacePinRect,
} from "./state";
import type { SuggestionEvent, SuggestionItem } from "./types";

export type InboxEntry = PersistedInboxEntry;
export type PinnedInboxEntry = PersistedPinnedEntry;
export type WorkspacePin = PersistedWorkspacePin;
export type { WorkspacePinRect } from "./state";

export type InboxState = PersistedSuggestionState & {
  selectedId?: string;
  activePreviewId?: string;
};

export type InboxAction =
  | { type: "hydrate"; state: PersistedSuggestionState }
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

export const initialInboxState: InboxState = createEmptySuggestionState();

function assertNever(value: never): never {
  throw new Error(`Unhandled inbox action: ${JSON.stringify(value)}`);
}

function copySuggestion(item: SuggestionItem): SuggestionItem {
  return JSON.parse(JSON.stringify(item)) as SuggestionItem;
}

function protectedQueueIds(state: InboxState): string[] {
  return [state.selectedId, state.activePreviewId].filter(
    (id): id is string => id !== undefined,
  );
}

function trimQueue(state: InboxState): InboxState {
  const entries = trimSuggestionEntries(state.entries, protectedQueueIds(state));
  return entries.length === state.entries.length ? state : { ...state, entries };
}

function markViewed<T extends InboxEntry>(entries: T[], id: string): T[] {
  return entries.map((entry) =>
    entry.item.id === id ? { ...entry, viewed: true } : entry,
  );
}

function reduceFeedEvent(state: InboxState, event: SuggestionEvent): InboxState {
  switch (event.type) {
    case "suggestion.added":
      if (state.seenKeys[event.item.dedupeKey]) return state;
      return trimQueue({
        ...state,
        entries: [
          ...state.entries,
          { item: event.item, viewed: false, stale: false, withdrawn: false },
        ],
        seenKeys: { ...state.seenKeys, [event.item.dedupeKey]: true },
      });
    case "suggestion.updated":
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
    case "suggestion.retracted": {
      const frozen =
        state.pinnedEntries.some((entry) => entry.item.id === event.id) ||
        state.workspacePins.some((pin) => pin.item.id === event.id);
      if (frozen) return state;
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
    default:
      return assertNever(event);
  }
}

function reduceSelectionAction(
  state: InboxState,
  action: Extract<InboxAction, { type: "select" | "back" | "dismiss" }>,
): InboxState {
  switch (action.type) {
    case "select":
      return {
        ...state,
        selectedId: action.id,
        entries: markViewed(state.entries, action.id),
        pinnedEntries: markViewed(state.pinnedEntries, action.id),
      };
    case "back": {
      const entries = state.entries.filter(
        (entry) => !entry.withdrawn || entry.item.id === state.activePreviewId,
      );
      return {
        ...state,
        selectedId: undefined,
        entries: entries.length === state.entries.length ? state.entries : entries,
      };
    }
    case "dismiss":
      return {
        ...state,
        selectedId: state.selectedId === action.id ? undefined : state.selectedId,
        entries: state.entries.filter((entry) => entry.item.id !== action.id),
        pinnedEntries: state.pinnedEntries.filter(
          (entry) => entry.item.id !== action.id,
        ),
      };
    default:
      return assertNever(action);
  }
}

function reducePinAction(
  state: InboxState,
  action: Extract<InboxAction, { type: "pin" | "unpin" }>,
): InboxState {
  if (action.type === "pin") {
    const entry = state.entries.find((candidate) => candidate.item.id === action.id);
    if (!entry) return state;
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

  const entry = state.pinnedEntries.find(
    (candidate) => candidate.item.id === action.id,
  );
  if (!entry) return state;
  return trimQueue({
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

function placeWorkspacePin(
  state: InboxState,
  action: Extract<InboxAction, { type: "workspace.place" }>,
): InboxState {
  if (state.activePreviewId === action.id) return state;
  const entry = state.pinnedEntries.find(
    (candidate) => candidate.item.id === action.id,
  );
  if (!entry) return state;
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

function returnWorkspacePin(state: InboxState, id: string): InboxState {
  const pin = state.workspacePins.find((candidate) => candidate.item.id === id);
  if (!pin) return state;
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
      (candidate) => candidate.item.id !== id,
    ),
  };
}

function reduceWorkspaceAction(
  state: InboxState,
  action: Extract<InboxAction, { type: `workspace.${string}` }>,
): InboxState {
  switch (action.type) {
    case "workspace.place":
      return placeWorkspacePin(state, action);
    case "workspace.return":
      return returnWorkspacePin(state, action.id);
    case "workspace.geometry":
      return {
        ...state,
        workspacePins: state.workspacePins.map((pin) =>
          pin.item.id === action.id
            ? { ...pin, ...action.rect, pendingInitialPlacement: false }
            : pin,
        ),
      };
    case "workspace.raise": {
      const pin = state.workspacePins.find(
        (candidate) => candidate.item.id === action.id,
      );
      if (!pin || pin.zIndex === state.nextZIndex - 1) return state;
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
    default:
      return assertNever(action);
  }
}

function reducePreviewAction(
  state: InboxState,
  action: Extract<InboxAction, { type: `preview.${string}` }>,
): InboxState {
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

export function inboxReducer(state: InboxState, action: InboxAction): InboxState {
  switch (action.type) {
    case "hydrate":
      return { ...createEmptySuggestionState(), ...action.state };
    case "event":
      return reduceFeedEvent(state, action.event);
    case "select":
    case "back":
    case "dismiss":
      return reduceSelectionAction(state, action);
    case "pin":
    case "unpin":
      return reducePinAction(state, action);
    case "workspace.place":
    case "workspace.return":
    case "workspace.geometry":
    case "workspace.raise":
      return reduceWorkspaceAction(state, action);
    case "preview.started":
    case "preview.resolved":
      return reducePreviewAction(state, action);
    default:
      return assertNever(action);
  }
}

export function projectPersistedSuggestionState(
  state: InboxState,
): PersistedSuggestionState {
  return {
    entries: state.entries,
    pinnedEntries: state.pinnedEntries,
    workspacePins: state.workspacePins,
    seenKeys: state.seenKeys,
    nextZIndex: state.nextZIndex,
  };
}

export const persistedSuggestionState = projectPersistedSuggestionState;

export function selectSortedInboxEntries(state: InboxState): InboxEntry[] {
  return [...state.entries].sort((left, right) => {
    if (left.viewed !== right.viewed) return left.viewed ? 1 : -1;
    return right.item.createdAt - left.item.createdAt;
  });
}

export function selectSortedPinnedEntries(state: InboxState): PinnedInboxEntry[] {
  return [...state.pinnedEntries].sort((left, right) => right.pinnedAt - left.pinnedAt);
}

export function selectSelectedEntry(state: InboxState): InboxEntry | undefined {
  if (!state.selectedId) return undefined;
  return (
    state.entries.find((entry) => entry.item.id === state.selectedId) ??
    state.pinnedEntries.find((entry) => entry.item.id === state.selectedId)
  );
}

export function selectUnreadCount(state: InboxState): number {
  return [...state.entries, ...state.pinnedEntries].filter((entry) => !entry.viewed)
    .length;
}
