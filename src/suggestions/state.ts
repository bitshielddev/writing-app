import type { SuggestionItem } from "./types";

export const SUGGESTION_ENTRY_LIMIT = 30;

export type PersistedInboxEntry = {
  item: SuggestionItem;
  viewed: boolean;
  stale: boolean;
  withdrawn: boolean;
};

export type PersistedPinnedEntry = PersistedInboxEntry & {
  pinnedAt: number;
};

export type PersistedWorkspacePin = {
  item: SuggestionItem;
  pinnedAt: number;
  pendingInitialPlacement: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
};

export type PersistedSuggestionState = {
  entries: PersistedInboxEntry[];
  pinnedEntries: PersistedPinnedEntry[];
  workspacePins: PersistedWorkspacePin[];
  seenKeys: Record<string, true>;
  nextZIndex: number;
};

export function createEmptySuggestionState(): PersistedSuggestionState {
  return {
    entries: [],
    pinnedEntries: [],
    workspacePins: [],
    seenKeys: {},
    nextZIndex: 1,
  };
}

export function trimSuggestionEntries<T extends PersistedInboxEntry>(
  entries: readonly T[],
  protectedIds: Iterable<string> = [],
): T[] {
  if (entries.length <= SUGGESTION_ENTRY_LIMIT) return [...entries];

  const protectedSet = new Set(protectedIds);
  const evictionOrder = entries
    .filter((entry) => !protectedSet.has(entry.item.id))
    .sort((left, right) => {
      if (left.viewed !== right.viewed) return left.viewed ? -1 : 1;
      return left.item.createdAt - right.item.createdAt;
    });
  const removeCount = entries.length - SUGGESTION_ENTRY_LIMIT;
  const evictedIds = new Set(
    evictionOrder.slice(0, removeCount).map((entry) => entry.item.id),
  );
  return entries.filter((entry) => !evictedIds.has(entry.item.id));
}
