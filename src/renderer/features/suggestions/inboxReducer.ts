import type {
  PersistedInboxEntry,
  PersistedPinnedEntry,
  PersistedSuggestionState,
  PersistedWorkspacePin,
} from "../../../domain/suggestions/state";

export type InboxEntry = PersistedInboxEntry & {
  stale: boolean;
  withdrawn: boolean;
};
export type PinnedInboxEntry = PersistedPinnedEntry & {
  stale: boolean;
  withdrawn: boolean;
};
export type WorkspacePin = PersistedWorkspacePin;
export type { WorkspacePinRect } from "../../../domain/suggestions/state";

/**
 * What: performs the present inbox entry step for this file's workflow.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by selectSortedInboxEntries, useSuggestionController and inbox when that path needs this behavior.
 */
export function presentInboxEntry(
  entry: PersistedInboxEntry,
  flags: Partial<Pick<InboxEntry, "stale" | "withdrawn">> = {},
): InboxEntry {
  return { ...entry, stale: flags.stale ?? false, withdrawn: flags.withdrawn ?? false };
}

/**
 * What: performs the present pinned entry step for this file's workflow.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by selectSortedPinnedEntries, useSuggestionController and inbox when that path needs this behavior.
 */
export function presentPinnedEntry(entry: PersistedPinnedEntry): PinnedInboxEntry {
  return { ...entry, stale: false, withdrawn: false };
}

/**
 * What: selects sorted inbox entries from the current state for UI or application callers.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by useSuggestionController and inbox when that path needs this behavior.
 */
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

/**
 * What: selects sorted pinned entries from the current state for UI or application callers.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by useSuggestionController and inbox when that path needs this behavior.
 */
export function selectSortedPinnedEntries(
  state: PersistedSuggestionState,
): PinnedInboxEntry[] {
  return state.pinnedEntries
    .map(presentPinnedEntry)
    .sort((left, right) => right.pinnedAt - left.pinnedAt);
}

/**
 * What: selects unread count from the current state for UI or application callers.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by useSuggestionController and inbox when that path needs this behavior.
 */
export function selectUnreadCount(state: PersistedSuggestionState): number {
  return [...state.entries, ...state.pinnedEntries].filter((entry) => !entry.viewed).length;
}
