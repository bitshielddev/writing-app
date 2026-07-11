import { trimSuggestionEntries, type PersistedSuggestionState } from "./state";
import type { SuggestionEvent } from "./schema";
import { suggestionDedupeKeys } from "./dedupe";

export type DurableSuggestionCommand =
  | { type: "markViewed"; suggestionId: string }
  | { type: "dismiss"; suggestionId: string }
  | { type: "pin"; suggestionId: string; pinnedAt: number }
  | { type: "unpin"; suggestionId: string }
  | { type: "workspace.place"; suggestionId: string; rect: { x: number; y: number; width: number; height: number } }
  | { type: "workspace.return"; suggestionId: string }
  | { type: "workspace.geometry"; suggestionId: string; rect: { x: number; y: number; width: number; height: number } }
  | { type: "workspace.raise"; suggestionId: string }
  | { type: "preview.resolve"; suggestionId: string; outcome: "accepted" | "cancelled" };

export type SuggestionTransition =
  | { status: "changed"; state: PersistedSuggestionState }
  | { status: "unchanged"; state: PersistedSuggestionState }
  | { status: "rejected"; state: PersistedSuggestionState; reason: string };

/**
 * What: creates an isolated copy of mutable data before a reducer changes it.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by applySuggestionCommand and applySuggestionAgentEvent when that path needs this behavior.
 */
const clone = (state: PersistedSuggestionState): PersistedSuggestionState => structuredClone(state);
/**
 * What: locates the matching entry and index inside the current collection.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by applySuggestionCommand when that path needs this behavior.
 */
const locate = (state: PersistedSuggestionState, id: string) =>
  state.entries.find((entry) => entry.item.id === id) ??
  state.pinnedEntries.find((entry) => entry.item.id === id) ??
  state.workspacePins.find((entry) => entry.item.id === id);

/**
 * What: applies suggestion command and returns the resulting state or event.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by aggregate, decideSuggestionCommand, transitionForFact and transitions when that path needs this behavior.
 */
// The exhaustive command policy is intentionally kept in one pure switch so
// storage and optimistic rendering cannot drift into separate transition rules.
// eslint-disable-next-line complexity
export function applySuggestionCommand(
  current: PersistedSuggestionState,
  command: DurableSuggestionCommand,
): SuggestionTransition {
  const state = clone(current);
  const id = command.suggestionId;
  switch (command.type) {
    case "markViewed": {
      const entry = locate(state, id);
      if (!entry) return { status: "rejected", state: current, reason: "Suggestion not found" };
      if (!("viewed" in entry) || entry.viewed) return { status: "unchanged", state: current };
      entry.viewed = true;
      return { status: "changed", state };
    }
    case "dismiss": {
      const before = state.entries.length + state.pinnedEntries.length;
      state.entries = state.entries.filter((entry) => entry.item.id !== id);
      state.pinnedEntries = state.pinnedEntries.filter((entry) => entry.item.id !== id);
      if (before === state.entries.length + state.pinnedEntries.length) {
        return { status: "rejected", state: current, reason: "Suggestion is not dismissible" };
      }
      return { status: "changed", state };
    }
    case "pin": {
      const entry = state.entries.find((candidate) => candidate.item.id === id);
      if (!entry) return { status: "rejected", state: current, reason: "Suggestion is not in the inbox" };
      state.entries = state.entries.filter((candidate) => candidate.item.id !== id);
      state.pinnedEntries.push({ ...entry, item: structuredClone(entry.item), pinnedAt: command.pinnedAt });
      return { status: "changed", state };
    }
    case "unpin": {
      const entry = state.pinnedEntries.find((candidate) => candidate.item.id === id);
      if (!entry) return { status: "rejected", state: current, reason: "Suggestion is not pinned" };
      state.pinnedEntries = state.pinnedEntries.filter((candidate) => candidate.item.id !== id);
      state.entries = trimSuggestionEntries([...state.entries, { item: entry.item, viewed: entry.viewed }]);
      return { status: "changed", state };
    }
    case "workspace.place": {
      const entry = state.pinnedEntries.find((candidate) => candidate.item.id === id);
      if (!entry) return { status: "rejected", state: current, reason: "Suggestion is not pinned" };
      state.pinnedEntries = state.pinnedEntries.filter((candidate) => candidate.item.id !== id);
      state.workspacePins.push({ item: entry.item, pinnedAt: entry.pinnedAt, pendingInitialPlacement: true, ...command.rect, zIndex: state.nextZIndex });
      state.nextZIndex += 1;
      return { status: "changed", state };
    }
    case "workspace.return": {
      const pin = state.workspacePins.find((candidate) => candidate.item.id === id);
      if (!pin) return { status: "rejected", state: current, reason: "Suggestion is not on the workspace" };
      state.workspacePins = state.workspacePins.filter((candidate) => candidate.item.id !== id);
      state.pinnedEntries.push({ item: pin.item, viewed: true, pinnedAt: pin.pinnedAt });
      return { status: "changed", state };
    }
    case "workspace.geometry": {
      const pin = state.workspacePins.find((candidate) => candidate.item.id === id);
      if (!pin) return { status: "rejected", state: current, reason: "Suggestion is not on the workspace" };
      Object.assign(pin, command.rect, { pendingInitialPlacement: false });
      return JSON.stringify(state) === JSON.stringify(current)
        ? { status: "unchanged", state: current }
        : { status: "changed", state };
    }
    case "workspace.raise": {
      const pin = state.workspacePins.find((candidate) => candidate.item.id === id);
      if (!pin) return { status: "rejected", state: current, reason: "Suggestion is not on the workspace" };
      if (pin.zIndex === state.nextZIndex - 1) return { status: "unchanged", state: current };
      pin.zIndex = state.nextZIndex++;
      return { status: "changed", state };
    }
    case "preview.resolve": {
      const entry = locate(state, id);
      if (!entry) return { status: "rejected", state: current, reason: "Suggestion not found" };
      if (command.outcome === "cancelled") return { status: "unchanged", state: current };
      state.entries = state.entries.filter((candidate) => candidate.item.id !== id);
      state.pinnedEntries = state.pinnedEntries.filter((candidate) => candidate.item.id !== id);
      return { status: "changed", state };
    }
  }
}

/**
 * What: applies suggestion agent event and returns the resulting state or event.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by aggregate, decideSuggestionCommand, transitionForFact and transitions when that path needs this behavior.
 */
export function applySuggestionAgentEvent(
  current: PersistedSuggestionState,
  event: SuggestionEvent,
): SuggestionTransition {
  const state = clone(current);
  switch (event.type) {
    case "suggestion.state.changed":
      return { status: "unchanged", state: current };
    case "suggestion.added": {
      const keys = suggestionDedupeKeys(event.item);
      if (keys.some((key) => state.seenKeys[key])) return { status: "rejected", state: current, reason: "Duplicate suggestion" };
      for (const key of keys) state.seenKeys[key] = true;
      state.entries = trimSuggestionEntries([...state.entries, { item: event.item, viewed: false }]);
      return { status: "changed", state };
    }
    case "suggestion.updated": {
      const entry = state.entries.find((candidate) => candidate.item.id === event.item.id);
      if (!entry) return { status: "rejected", state: current, reason: "Suggestion is not live" };
      entry.item = event.item;
      return { status: "changed", state };
    }
    case "suggestion.retracted":
      if (!state.entries.some((entry) => entry.item.id === event.id)) return { status: "rejected", state: current, reason: "Suggestion is not live" };
      state.entries = state.entries.filter((entry) => entry.item.id !== event.id);
      return { status: "changed", state };
  }
}
