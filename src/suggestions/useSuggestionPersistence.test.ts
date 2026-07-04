import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DesktopBridge } from "../shared/desktop";
import { deferred } from "../test/desktopBridgeHarness";
import { createEmptySuggestionState, type PersistedSuggestionState } from "./state";
import { useSuggestionPersistence } from "./useSuggestionPersistence";

function state(nextZIndex: number): PersistedSuggestionState {
  return { ...createEmptySuggestionState(), nextZIndex };
}

function setup() {
  const saveSuggestionState = vi.fn<DesktopBridge["saveSuggestionState"]>();
  const desktop = { saveSuggestionState } as unknown as DesktopBridge;
  const hook = renderHook(() => useSuggestionPersistence(desktop));
  act(() => hook.result.current.seedHydratedState(state(1)));
  return { ...hook, saveSuggestionState };
}

describe("useSuggestionPersistence", () => {
  it("runs one save at a time and coalesces pending projections", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const { result, saveSuggestionState } = setup();
    saveSuggestionState
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    act(() => result.current.requestSave(state(2)));
    for (let version = 3; version <= 12; version += 1) {
      act(() => result.current.requestSave(state(version)));
    }

    expect(saveSuggestionState).toHaveBeenCalledTimes(1);
    expect(result.current.status.state).toBe("pending");
    await act(async () => first.resolve());
    expect(saveSuggestionState).toHaveBeenCalledTimes(2);
    expect(saveSuggestionState.mock.calls[1]?.[0].nextZIndex).toBe(12);

    await act(async () => second.resolve());
    expect(result.current.status).toEqual({
      state: "idle",
      acknowledgedVersion: 11,
    });
  });

  it("copies a projection before starting the bridge call", () => {
    const pending = deferred<void>();
    const { result, saveSuggestionState } = setup();
    saveSuggestionState.mockReturnValueOnce(pending.promise);
    const projection = state(2);

    act(() => result.current.requestSave(projection));
    projection.nextZIndex = 99;

    expect(saveSuggestionState.mock.calls[0]?.[0].nextZIndex).toBe(2);
  });

  it("retains the newest projection after failure and retries it", async () => {
    const first = deferred<void>();
    const retry = deferred<void>();
    const { result, saveSuggestionState } = setup();
    saveSuggestionState
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    act(() => result.current.requestSave(state(2)));
    act(() => result.current.requestSave(state(3)));
    await act(async () => first.reject(new Error("disk full")));

    expect(result.current.status).toMatchObject({
      state: "failed",
      acknowledgedVersion: 0,
      message: "disk full",
    });
    expect(result.current.failureMessage).toMatch(/may not survive/i);

    act(() => result.current.retry());
    expect(result.current.status.state).toBe("retrying");
    expect(saveSuggestionState.mock.calls[1]?.[0].nextZIndex).toBe(3);
    expect(result.current.failureMessage).toBeDefined();

    await act(async () => retry.resolve());
    expect(result.current.status).toEqual({
      state: "idle",
      acknowledgedVersion: 2,
    });
    expect(result.current.failureMessage).toBeUndefined();
  });

  it("lets a new projection supersede and restart a failed save", async () => {
    const first = deferred<void>();
    const replacement = deferred<void>();
    const { result, saveSuggestionState } = setup();
    saveSuggestionState
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(replacement.promise);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    act(() => result.current.requestSave(state(2)));
    await act(async () => first.reject(new Error("unavailable")));
    act(() => result.current.requestSave(state(4)));

    expect(saveSuggestionState).toHaveBeenCalledTimes(2);
    expect(saveSuggestionState.mock.calls[1]?.[0].nextZIndex).toBe(4);
    await act(async () => replacement.resolve());
    expect(result.current.status).toEqual({
      state: "idle",
      acknowledgedVersion: 2,
    });
  });

  it("does not save hydration or start duplicate work during unmount", async () => {
    const active = deferred<void>();
    const { result, saveSuggestionState, unmount } = setup();
    expect(saveSuggestionState).not.toHaveBeenCalled();
    saveSuggestionState.mockReturnValueOnce(active.promise);

    act(() => result.current.requestSave(state(2)));
    unmount();
    await act(async () => active.resolve());

    expect(saveSuggestionState).toHaveBeenCalledTimes(1);
  });
});
