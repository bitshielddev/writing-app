import { describe, expect, it } from "vitest";

import {
  inboxReducer,
  initialInboxState,
  persistedSuggestionState,
} from "./inbox";
import type { TextSuggestion } from "./types";

function suggestion(index: number, dedupeKey = `item-${index}`): TextSuggestion {
  return {
    id: `item-${index}`,
    dedupeKey,
    kind: "snippet",
    title: `Suggestion ${index}`,
    summary: "Summary",
    body: "Body",
    insertText: "Insert text",
    sourceLabels: [],
    createdAt: index,
  };
}

describe("suggestion inbox reducer", () => {
  it("hydrates the durable suggestion projection without restoring previews", () => {
    const original = suggestion(1);
    const state = inboxReducer(initialInboxState, {
      type: "hydrate",
      state: {
        entries: [
          { item: original, viewed: true, stale: false, withdrawn: false },
        ],
        pinnedEntries: [],
        workspacePins: [],
        seenKeys: { [original.dedupeKey]: true },
        nextZIndex: 4,
      },
    });

    expect(state.entries[0]?.item).toEqual(original);
    expect(state.activePreviewId).toBeUndefined();
    expect(state.nextZIndex).toBe(4);
  });

  it("deduplicates and limits the session queue", () => {
    let state = initialInboxState;
    for (let index = 0; index < 31; index += 1) {
      state = inboxReducer(state, {
        type: "event",
        event: { type: "suggestion.added", item: suggestion(index) },
      });
    }
    state = inboxReducer(state, {
      type: "event",
      event: {
        type: "suggestion.added",
        item: suggestion(99, "item-30"),
      },
    });

    expect(state.entries).toHaveLength(30);
    expect(state.entries.some((entry) => entry.item.id === "item-0")).toBe(false);
    expect(state.entries.some((entry) => entry.item.id === "item-99")).toBe(false);
  });

  it("protects selected and previewed entries during queue eviction", () => {
    let state = initialInboxState;
    for (let index = 0; index < 30; index += 1) {
      state = inboxReducer(state, {
        type: "event",
        event: { type: "suggestion.added", item: suggestion(index) },
      });
    }
    state = inboxReducer(state, { type: "select", id: "item-0" });
    state = inboxReducer(state, { type: "preview.started", id: "item-0" });
    state = inboxReducer(state, {
      type: "event",
      event: { type: "suggestion.added", item: suggestion(30) },
    });

    expect(state.entries).toHaveLength(30);
    expect(state.entries.some((entry) => entry.item.id === "item-0")).toBe(true);
    expect(state.entries.some((entry) => entry.item.id === "item-1")).toBe(false);
  });

  it("marks selection viewed, clears it on back, and removes withdrawn detail", () => {
    const original = suggestion(1);
    let state = inboxReducer(initialInboxState, {
      type: "event",
      event: { type: "suggestion.added", item: original },
    });
    state = inboxReducer(state, { type: "select", id: original.id });
    expect(state.entries[0]?.viewed).toBe(true);
    state = inboxReducer(state, {
      type: "event",
      event: { type: "suggestion.retracted", id: original.id },
    });
    expect(state.entries[0]?.withdrawn).toBe(true);
    state = inboxReducer(state, { type: "back" });
    expect(state.selectedId).toBeUndefined();
    expect(state.entries).toHaveLength(0);
  });

  it("dismisses live and pinned entries and clears matching selection", () => {
    let state = initialInboxState;
    for (const index of [1, 2]) {
      state = inboxReducer(state, {
        type: "event",
        event: { type: "suggestion.added", item: suggestion(index) },
      });
    }
    state = inboxReducer(state, { type: "pin", id: "item-1", pinnedAt: 1 });
    state = inboxReducer(state, { type: "select", id: "item-1" });
    state = inboxReducer(state, { type: "dismiss", id: "item-1" });

    expect(state.selectedId).toBeUndefined();
    expect(state.pinnedEntries).toHaveLength(0);
    expect(state.entries.map((entry) => entry.item.id)).toEqual(["item-2"]);
  });

  it("preserves a preview while updates and retractions mark it stale", () => {
    const original = suggestion(1);
    let state = inboxReducer(initialInboxState, {
      type: "event",
      event: { type: "suggestion.added", item: original },
    });
    state = inboxReducer(state, { type: "select", id: original.id });
    state = inboxReducer(state, { type: "preview.started", id: original.id });
    state = inboxReducer(state, {
      type: "event",
      event: {
        type: "suggestion.updated",
        item: { ...original, title: "Refined suggestion" },
      },
    });
    state = inboxReducer(state, {
      type: "event",
      event: { type: "suggestion.retracted", id: original.id },
    });

    expect(state.entries[0]).toMatchObject({ stale: true, withdrawn: true });
    expect(state.entries[0]?.item.title).toBe("Refined suggestion");

    state = inboxReducer(state, {
      type: "preview.resolved",
      id: original.id,
      outcome: "cancelled",
    });
    expect(state.entries).toHaveLength(0);
  });

  it("freezes pinned snapshots and excludes them from the queue limit", () => {
    const original = suggestion(1);
    let state = inboxReducer(initialInboxState, {
      type: "event",
      event: { type: "suggestion.added", item: original },
    });
    state = inboxReducer(state, { type: "pin", id: original.id, pinnedAt: 10 });

    state = inboxReducer(state, {
      type: "event",
      event: {
        type: "suggestion.updated",
        item: { ...original, title: "Agent replacement" },
      },
    });
    state = inboxReducer(state, {
      type: "event",
      event: { type: "suggestion.retracted", id: original.id },
    });
    for (let index = 2; index < 33; index += 1) {
      state = inboxReducer(state, {
        type: "event",
        event: { type: "suggestion.added", item: suggestion(index) },
      });
    }

    expect(state.pinnedEntries).toHaveLength(1);
    expect(state.pinnedEntries[0]?.item.title).toBe(original.title);
    expect(state.entries).toHaveLength(30);
  });

  it("moves a pin to the workspace, updates it, and returns it to pins", () => {
    const original = suggestion(1);
    let state = inboxReducer(initialInboxState, {
      type: "event",
      event: { type: "suggestion.added", item: original },
    });
    state = inboxReducer(state, { type: "pin", id: original.id, pinnedAt: 10 });
    state = inboxReducer(state, {
      type: "workspace.place",
      id: original.id,
      rect: { x: 20, y: 30, width: 320, height: 240 },
    });

    expect(state.pinnedEntries).toHaveLength(0);
    expect(state.workspacePins[0]).toMatchObject({
      x: 20,
      y: 30,
      width: 320,
      height: 240,
      pendingInitialPlacement: true,
      zIndex: 1,
    });

    state = inboxReducer(state, {
      type: "workspace.geometry",
      id: original.id,
      rect: { x: 80, y: 90, width: 360, height: 280 },
    });
    expect(state.workspacePins[0]?.pendingInitialPlacement).toBe(false);
    state = inboxReducer(state, { type: "workspace.return", id: original.id });

    expect(state.workspacePins).toHaveLength(0);
    expect(state.pinnedEntries[0]).toMatchObject({
      item: { id: original.id },
      pinnedAt: 10,
      viewed: true,
    });
  });

  it("does not place a pin while its preview is active", () => {
    const original = suggestion(1);
    let state = inboxReducer(initialInboxState, {
      type: "event",
      event: { type: "suggestion.added", item: original },
    });
    state = inboxReducer(state, { type: "pin", id: original.id, pinnedAt: 10 });
    state = inboxReducer(state, { type: "preview.started", id: original.id });
    const unchanged = inboxReducer(state, {
      type: "workspace.place",
      id: original.id,
      rect: { x: 0, y: 0, width: 320, height: 240 },
    });

    expect(unchanged).toBe(state);
    expect(unchanged.pinnedEntries).toHaveLength(1);
    expect(unchanged.workspacePins).toHaveLength(0);
  });

  it("returns an unpinned snapshot to the bounded live queue", () => {
    let state = initialInboxState;
    for (let index = 0; index < 31; index += 1) {
      state = inboxReducer(state, {
        type: "event",
        event: { type: "suggestion.added", item: suggestion(index) },
      });
    }
    state = inboxReducer(state, { type: "pin", id: "item-30", pinnedAt: 1 });
    state = inboxReducer(state, { type: "unpin", id: "item-30" });

    expect(state.entries).toHaveLength(30);
    expect(state.pinnedEntries).toHaveLength(0);
    expect(state.entries.some((entry) => entry.item.id === "item-30")).toBe(true);
  });

  it("keeps a cancelled pinned preview and removes an accepted one", () => {
    const original = suggestion(1);
    let state = inboxReducer(initialInboxState, {
      type: "event",
      event: { type: "suggestion.added", item: original },
    });
    state = inboxReducer(state, { type: "pin", id: original.id, pinnedAt: 10 });
    state = inboxReducer(state, { type: "preview.started", id: original.id });
    state = inboxReducer(state, {
      type: "preview.resolved",
      id: original.id,
      outcome: "cancelled",
    });
    expect(state.pinnedEntries).toHaveLength(1);

    state = inboxReducer(state, { type: "preview.started", id: original.id });
    state = inboxReducer(state, {
      type: "preview.resolved",
      id: original.id,
      outcome: "accepted",
    });
    expect(state.pinnedEntries).toHaveLength(0);
  });

  it("raises an overlapping workspace pin above newer cards", () => {
    let state = initialInboxState;
    for (const index of [1, 2]) {
      state = inboxReducer(state, {
        type: "event",
        event: { type: "suggestion.added", item: suggestion(index) },
      });
      state = inboxReducer(state, {
        type: "pin",
        id: `item-${index}`,
        pinnedAt: index,
      });
      state = inboxReducer(state, {
        type: "workspace.place",
        id: `item-${index}`,
        rect: { x: 20, y: 20, width: 320, height: 240 },
      });
    }

    state = inboxReducer(state, { type: "workspace.raise", id: "item-1" });
    expect(
      state.workspacePins.find((pin) => pin.item.id === "item-1")?.zIndex,
    ).toBe(3);
  });

  it("projects only durable suggestion state", () => {
    const original = suggestion(1);
    let state = inboxReducer(initialInboxState, {
      type: "event",
      event: { type: "suggestion.added", item: original },
    });
    state = inboxReducer(state, { type: "select", id: original.id });
    state = inboxReducer(state, { type: "preview.started", id: original.id });

    expect(persistedSuggestionState(state)).toEqual({
      entries: state.entries,
      pinnedEntries: [],
      workspacePins: [],
      seenKeys: { [original.dedupeKey]: true },
      nextZIndex: 1,
    });
    expect(persistedSuggestionState(state)).not.toHaveProperty("selectedId");
    expect(persistedSuggestionState(state)).not.toHaveProperty("activePreviewId");
  });
});
