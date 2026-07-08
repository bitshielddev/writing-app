import type { Static } from "typebox";

import type { PersistedSuggestionStateSchema, WorkspacePinRectSchema } from "../shared/contracts";
import type { SuggestionItem } from "../domain/suggestions/schema";

export const SUGGESTION_ENTRY_LIMIT = 30;

export type PersistedInboxEntry = {
  item: SuggestionItem;
  viewed: boolean;
};

export type PersistedPinnedEntry = PersistedInboxEntry & {
  pinnedAt: number;
};

export type WorkspacePinRect = Static<typeof WorkspacePinRectSchema>;

export type PersistedWorkspacePin = WorkspacePinRect & {
  item: SuggestionItem;
  pinnedAt: number;
  pendingInitialPlacement: boolean;
  zIndex: number;
};

export type PersistedSuggestionState = Static<typeof PersistedSuggestionStateSchema>;

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
