import { describe, expect, it } from "vitest";

import { createEmptySuggestionState } from "./state";
import { applySuggestionAgentEvent, applySuggestionCommand, type DurableSuggestionCommand } from "./transitions";
import type { TextSuggestion } from "./types";

const item: TextSuggestion = { id: "one", dedupeKey: "one", kind: "snippet", title: "One",
  summary: "Summary", body: "Body", insertText: "Text", sourceLabels: [], createdAt: 1 };

const changed = (state: ReturnType<typeof createEmptySuggestionState>, command: DurableSuggestionCommand) => {
  const result = applySuggestionCommand(state, command);
  expect(result.status).toBe("changed");
  return result.state;
};

describe("durable suggestion transitions", () => {
  it("applies every valid renderer command without transient state", () => {
    const added = applySuggestionAgentEvent(createEmptySuggestionState(), { type: "suggestion.added", item });
    let state = added.state;
    state = changed(state, { type: "markViewed", suggestionId: item.id });
    state = changed(state, { type: "pin", suggestionId: item.id, pinnedAt: 2 });
    state = changed(state, { type: "workspace.place", suggestionId: item.id, rect: { x: 0, y: 0, width: 100, height: 100 } });
    state = changed(state, { type: "workspace.geometry", suggestionId: item.id, rect: { x: 5, y: 6, width: 120, height: 110 } });
    state = changed(state, { type: "workspace.return", suggestionId: item.id });
    state = changed(state, { type: "unpin", suggestionId: item.id });
    expect(applySuggestionCommand(state, { type: "preview.resolve", suggestionId: item.id, outcome: "cancelled" }).status).toBe("unchanged");
    state = changed(state, { type: "pin", suggestionId: item.id, pinnedAt: 3 });
    state = changed(state, { type: "dismiss", suggestionId: item.id });
    expect(state.pinnedEntries).toEqual([]);
    expect(state).not.toHaveProperty("selectedId");
  });

  it("raises workspace cards and resolves accepted previews", () => {
    const second = { ...item, id: "two", dedupeKey: "two" };
    let state = applySuggestionAgentEvent(createEmptySuggestionState(), { type: "suggestion.added", item }).state;
    state = applySuggestionAgentEvent(state, { type: "suggestion.added", item: second }).state;
    state = changed(state, { type: "pin", suggestionId: item.id, pinnedAt: 1 });
    state = changed(state, { type: "workspace.place", suggestionId: item.id, rect: { x: 0, y: 0, width: 1, height: 1 } });
    state = changed(state, { type: "pin", suggestionId: second.id, pinnedAt: 2 });
    state = changed(state, { type: "workspace.place", suggestionId: second.id, rect: { x: 0, y: 0, width: 1, height: 1 } });
    state = changed(state, { type: "workspace.raise", suggestionId: item.id });
    state = changed(state, { type: "workspace.return", suggestionId: item.id });
    state = changed(state, { type: "preview.resolve", suggestionId: item.id, outcome: "accepted" });
    expect(state.pinnedEntries.some((entry) => entry.item.id === item.id)).toBe(false);
  });

  it("rejects commands and agent events that are invalid for the source state", () => {
    const empty = createEmptySuggestionState();
    expect(applySuggestionCommand(empty, { type: "dismiss", suggestionId: "missing" }).status).toBe("rejected");
    expect(applySuggestionAgentEvent(empty, { type: "suggestion.updated", item }).status).toBe("rejected");
    const state = applySuggestionAgentEvent(empty, { type: "suggestion.added", item }).state;
    expect(applySuggestionAgentEvent(state, { type: "suggestion.added", item }).status).toBe("rejected");
  });
});
