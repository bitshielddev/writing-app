import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DesktopBridge } from "../../../contracts/desktop-bridge";
import { deferred } from "../../../test/desktopBridgeHarness";
import { createEmptySuggestionState, type PersistedSuggestionState } from "../../../domain/suggestions/state";
import { useSuggestionController } from "./useSuggestionController";
import type { TextSuggestion } from "../../../domain/suggestions/schema";

const item: TextSuggestion = {
  id: "one", dedupeKey: "one", kind: "snippet", title: "One",
  summary: "Summary", body: "Body", insertText: "Text", sourceLabels: [], createdAt: 1,
};

function state(viewed = false): PersistedSuggestionState {
  return { ...createEmptySuggestionState(), entries: [{ item, viewed }], seenKeys: { one: true } };
}

describe("useSuggestionController", () => {
  it("applies commands optimistically and serializes against acknowledged revisions", async () => {
    const first = deferred<Awaited<ReturnType<DesktopBridge["executeSuggestionCommand"]>>>();
    const executeSuggestionCommand = vi.fn<DesktopBridge["executeSuggestionCommand"]>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ commandId: "pin", status: "applied", suggestionRevision: 2,
        state: { ...createEmptySuggestionState(), pinnedEntries: [{ item, viewed: true, pinnedAt: 10 }], seenKeys: { one: true } } });
    const { result } = renderHook(() => useSuggestionController({ executeSuggestionCommand } as unknown as DesktopBridge));
    act(() => result.current.seedHydratedState(state(), 0, "project", "document"));

    act(() => result.current.select(item.id));
    expect(result.current.entries[0]?.viewed).toBe(true);
    act(() => result.current.pin(item.id));
    expect(result.current.pinnedEntries[0]?.item.id).toBe(item.id);
    expect(executeSuggestionCommand).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve({
      commandId: executeSuggestionCommand.mock.calls[0]![0].commandId,
      status: "applied", suggestionRevision: 1, state: state(true),
    }));
    expect(executeSuggestionCommand).toHaveBeenCalledTimes(2);
    expect(executeSuggestionCommand.mock.calls[1]![0].expectedSuggestionRevision).toBe(1);
  });

  it("acknowledges a matching durable event once regardless of RPC ordering", async () => {
    const completion = deferred<Awaited<ReturnType<DesktopBridge["executeSuggestionCommand"]>>>();
    const executeSuggestionCommand = vi.fn<DesktopBridge["executeSuggestionCommand"]>(() => completion.promise);
    const { result } = renderHook(() => useSuggestionController({ executeSuggestionCommand } as unknown as DesktopBridge));
    act(() => result.current.seedHydratedState(state(true), 0, "project", "document"));
    act(() => result.current.pin(item.id));
    const commandId = executeSuggestionCommand.mock.calls[0]![0].commandId;
    const pinned = { ...createEmptySuggestionState(),
      pinnedEntries: [{ item, viewed: true, pinnedAt: 0 }], seenKeys: { one: true } };
    const pinnedAt = executeSuggestionCommand.mock.calls[0]![0].command.type === "pin"
      ? executeSuggestionCommand.mock.calls[0]![0].command.pinnedAt : 0;
    pinned.pinnedEntries[0]!.pinnedAt = pinnedAt;
    act(() => result.current.onDesktopEvent({ type: "suggestion.event", commandId,
      suggestionRevision: 1, state: pinned,
      event: { type: "suggestion.state.changed", suggestionId: item.id, commandType: "pin" } }));
    expect(result.current.status.state).toBe("idle");
    expect(result.current.pinnedEntries).toHaveLength(1);
    await act(async () => completion.resolve({ commandId, status: "applied", suggestionRevision: 1, state: pinned }));
    expect(result.current.pinnedEntries).toHaveLength(1);
  });

  it("keeps preview and selection state transient across updates and retractions", () => {
    const executeSuggestionCommand = vi.fn<DesktopBridge["executeSuggestionCommand"]>();
    const { result } = renderHook(() => useSuggestionController({ executeSuggestionCommand } as unknown as DesktopBridge));
    act(() => result.current.seedHydratedState(state(true), 1, "project", "document"));
    act(() => { result.current.select(item.id); result.current.previewStarted(item.id); });

    const updated = { ...item, title: "Refined" };
    act(() => result.current.onDesktopEvent({ type: "suggestion.event", suggestionRevision: 2,
      state: { ...state(true), entries: [{ item: updated, viewed: true }] },
      event: { type: "suggestion.updated", item: updated } }));
    expect(result.current.selectedEntry).toMatchObject({ item: { title: "Refined" }, stale: true, withdrawn: false });

    act(() => result.current.onDesktopEvent({ type: "suggestion.event", suggestionRevision: 3,
      state: { ...createEmptySuggestionState(), seenKeys: { one: true } },
      event: { type: "suggestion.retracted", id: item.id } }));
    expect(result.current.selectedEntry).toMatchObject({ stale: true, withdrawn: true });
    expect(result.current.activePreviewId).toBe(item.id);
    act(() => result.current.previewResolved(item.id, "cancelled"));
    expect(result.current.activePreviewId).toBeUndefined();
    expect(result.current.selectedEntry).toBeUndefined();
    expect(executeSuggestionCommand).not.toHaveBeenCalled();
  });
});
