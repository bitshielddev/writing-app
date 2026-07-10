import { Type, type Static } from "typebox";

import { SuggestionItemSchema, type SuggestionItem } from "./schema";

const strict = { additionalProperties: false } as const;
const timestamp = Type.Number({ minimum: 0 });

export const WorkspacePinRectSchema = Type.Object(
  {
    x: Type.Number({ minimum: -1_000_000, maximum: 1_000_000 }),
    y: Type.Number({ minimum: -1_000_000, maximum: 1_000_000 }),
    width: Type.Number({ minimum: 1, maximum: 10_000 }),
    height: Type.Number({ minimum: 1, maximum: 10_000 }),
  },
  strict,
);

const PersistedInboxEntrySchema = Type.Object(
  {
    item: SuggestionItemSchema,
    viewed: Type.Boolean(),
  },
  strict,
);
const PersistedPinnedEntrySchema = Type.Object(
  {
    item: SuggestionItemSchema,
    viewed: Type.Boolean(),
    pinnedAt: timestamp,
  },
  strict,
);
const PersistedWorkspacePinSchema = Type.Object(
  {
    item: SuggestionItemSchema,
    pinnedAt: timestamp,
    pendingInitialPlacement: Type.Boolean(),
    zIndex: Type.Integer({ minimum: 0 }),
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number(),
    height: Type.Number(),
  },
  strict,
);
export const PersistedSuggestionStateSchema = Type.Object(
  {
    entries: Type.Array(PersistedInboxEntrySchema, { maxItems: 30 }),
    pinnedEntries: Type.Array(PersistedPinnedEntrySchema, { maxItems: 30 }),
    workspacePins: Type.Array(PersistedWorkspacePinSchema, { maxItems: 30 }),
    seenKeys: Type.Record(Type.String({ maxLength: 200 }), Type.Literal(true)),
    nextZIndex: Type.Integer({ minimum: 1 }),
  },
  strict,
);

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

/**
 * What: creates empty suggestion state with the dependencies and defaults this workflow expects.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by desktopBridgeHarness, createWorkspaceSnapshot, contracts and aggregate when that path needs this behavior.
 */
export function createEmptySuggestionState(): PersistedSuggestionState {
  return {
    entries: [],
    pinnedEntries: [],
    workspacePins: [],
    seenKeys: {},
    nextZIndex: 1,
  };
}

/**
 * What: performs the trim suggestion entries step for this file's workflow.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by transitions, applySuggestionCommand, applySuggestionAgentEvent and state when that path needs this behavior.
 */
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
