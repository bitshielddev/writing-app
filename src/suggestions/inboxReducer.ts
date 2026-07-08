import type {
  PersistedInboxEntry,
  PersistedPinnedEntry,
  PersistedSuggestionState,
  PersistedWorkspacePin,
} from "../domain/suggestions/state";

export type InboxEntry = PersistedInboxEntry & {
  stale: boolean;
  withdrawn: boolean;
};
export type PinnedInboxEntry = PersistedPinnedEntry & {
  stale: boolean;
  withdrawn: boolean;
};
export type WorkspacePin = PersistedWorkspacePin;
export type { WorkspacePinRect } from "../domain/suggestions/state";

export function presentInboxEntry(
  entry: PersistedInboxEntry,
  flags: Partial<Pick<InboxEntry, "stale" | "withdrawn">> = {},
): InboxEntry {
  return { ...entry, stale: flags.stale ?? false, withdrawn: flags.withdrawn ?? false };
}

export function presentPinnedEntry(entry: PersistedPinnedEntry): PinnedInboxEntry {
  return { ...entry, stale: false, withdrawn: false };
}

export function selectSortedInboxEntries(
  state: PersistedSuggestionState,
  activePreview?: { id: string; stale: boolean; withdrawn: boolean },
): InboxEntry[] {
  return state.entries
    .map((entry) => presentInboxEntry(entry, entry.item.id === activePreview?.id
      ? activePreview
      : undefined))
    .sort((left, right) => {
      if (left.viewed !== right.viewed) return left.viewed ? 1 : -1;
      return right.item.createdAt - left.item.createdAt;
    });
}

export function selectSortedPinnedEntries(
  state: PersistedSuggestionState,
): PinnedInboxEntry[] {
  return state.pinnedEntries
    .map(presentPinnedEntry)
    .sort((left, right) => right.pinnedAt - left.pinnedAt);
}

export function selectUnreadCount(state: PersistedSuggestionState): number {
  return [...state.entries, ...state.pinnedEntries].filter((entry) => !entry.viewed).length;
}
