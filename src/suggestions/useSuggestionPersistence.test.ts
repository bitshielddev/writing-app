import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DesktopBridge } from "../shared/desktop";
import { deferred } from "../test/desktopBridgeHarness";
import { createEmptySuggestionState } from "./state";
import { useSuggestionPersistence } from "./useSuggestionPersistence";

describe("useSuggestionPersistence", () => {
  it("serializes commands and uses the acknowledged revision", async () => {
    const first = deferred<Awaited<ReturnType<DesktopBridge["executeSuggestionCommand"]>>>();
    const executeSuggestionCommand = vi.fn<DesktopBridge["executeSuggestionCommand"]>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ commandId: "second", status: "unchanged", suggestionRevision: 2, state: createEmptySuggestionState() });
    const { result } = renderHook(() => useSuggestionPersistence({ executeSuggestionCommand } as unknown as DesktopBridge));
    act(() => result.current.seedHydratedState(createEmptySuggestionState(), 1, "document"));
    act(() => result.current.dispatchCommand({ type: "dismiss", suggestionId: "one" }));
    act(() => result.current.dispatchCommand({ type: "dismiss", suggestionId: "two" }));
    expect(executeSuggestionCommand).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve({ commandId: executeSuggestionCommand.mock.calls[0]![0].commandId, status: "unchanged", suggestionRevision: 2, state: createEmptySuggestionState() }));
    expect(executeSuggestionCommand).toHaveBeenCalledTimes(2);
    expect(executeSuggestionCommand.mock.calls[1]![0].expectedSuggestionRevision).toBe(2);
  });

  it("coalesces unsent geometry commands", () => {
    const executeSuggestionCommand = vi.fn<DesktopBridge["executeSuggestionCommand"]>(() => new Promise(() => undefined));
    const { result } = renderHook(() => useSuggestionPersistence({ executeSuggestionCommand } as unknown as DesktopBridge));
    act(() => result.current.seedHydratedState(createEmptySuggestionState(), 0, "document"));
    act(() => result.current.dispatchCommand({ type: "dismiss", suggestionId: "active" }));
    act(() => result.current.dispatchCommand({ type: "workspace.geometry", suggestionId: "card", rect: { x: 1, y: 1, width: 10, height: 10 } }));
    act(() => result.current.dispatchCommand({ type: "workspace.geometry", suggestionId: "card", rect: { x: 2, y: 2, width: 10, height: 10 } }));
    expect(executeSuggestionCommand).toHaveBeenCalledTimes(1);
    expect(result.current.status.state).toBe("pending");
  });
});
