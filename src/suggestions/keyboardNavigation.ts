import { useCallback, useMemo, useState } from "react";

import type { InboxEntry, PinnedInboxEntry } from "./inbox";

type SuggestionKeyboardNavigationOptions = {
  entries: InboxEntry[];
  pinnedEntries: PinnedInboxEntry[];
  selectedId?: string;
  onSelect: (id: string) => void;
};

export type SuggestionMoveResult =
  | { status: "moved" }
  | { status: "empty" }
  | { status: "boundary"; edge: "first" | "last" };

export function useSuggestionKeyboardNavigation({
  entries,
  pinnedEntries,
  selectedId,
  onSelect,
}: SuggestionKeyboardNavigationOptions) {
  const orderedEntries = useMemo(
    () => [...pinnedEntries, ...entries],
    [entries, pinnedEntries],
  );
  const [targetId, setTargetId] = useState<string>();

  const effectiveTargetId =
    selectedId ??
    (targetId && orderedEntries.some((entry) => entry.item.id === targetId)
      ? targetId
      : undefined);

  const move = useCallback(
    (direction: -1 | 1): SuggestionMoveResult => {
      if (!orderedEntries.length) return { status: "empty" };

      const anchorId = effectiveTargetId;
      const currentIndex = anchorId
        ? orderedEntries.findIndex((entry) => entry.item.id === anchorId)
        : -1;
      const nextIndex =
        currentIndex < 0
          ? direction > 0
            ? 0
            : orderedEntries.length - 1
          : currentIndex + direction;

      if (nextIndex < 0) return { status: "boundary", edge: "first" };
      if (nextIndex >= orderedEntries.length) {
        return { status: "boundary", edge: "last" };
      }

      const nextId = orderedEntries[nextIndex].item.id;
      setTargetId(nextId);
      if (selectedId) onSelect(nextId);
      return { status: "moved" };
    },
    [effectiveTargetId, onSelect, orderedEntries, selectedId],
  );

  const neighborAfterRemoval = useCallback(
    (id: string) => {
      const currentIndex = orderedEntries.findIndex(
        (entry) => entry.item.id === id,
      );
      if (currentIndex < 0) return undefined;
      return (
        orderedEntries[currentIndex + 1] ?? orderedEntries[currentIndex - 1]
      )?.item.id;
    },
    [orderedEntries],
  );

  const targetEntry =
    orderedEntries.find((entry) => entry.item.id === effectiveTargetId);

  return {
    orderedEntries,
    targetId: effectiveTargetId,
    targetEntry,
    setTargetId,
    move,
    neighborAfterRemoval,
  };
}

export type SuggestionKeyboardNavigationController = ReturnType<
  typeof useSuggestionKeyboardNavigation
>;
