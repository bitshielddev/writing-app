import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceLayout } from "./useWorkspaceLayout";

/**
 * What: performs the install match media step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by useWorkspaceLayout when that path needs this behavior.
 */
function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: "(min-width: 1280px)",
    onchange: null,
    addEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
    ),
    removeEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    ),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
  return (nextMatches: boolean) => {
    matches = nextMatches;
    for (const listener of listeners) {
      listener({ matches: nextMatches } as MediaQueryListEvent);
    }
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("useWorkspaceLayout", () => {
  it("uses drawers below desktop and closes them at the desktop breakpoint", () => {
    const setDesktop = installMatchMedia(false);
    const { result } = renderHook(() => useWorkspaceLayout());

    act(() => result.current.openNavigation());
    expect(result.current.navigationDrawerOpen).toBe(true);
    act(() => result.current.openContext());
    expect(result.current.navigationDrawerOpen).toBe(false);
    expect(result.current.contextDrawerOpen).toBe(true);

    act(() => setDesktop(true));
    expect(result.current.desktop).toBe(true);
    expect(result.current.contextDrawerOpen).toBe(false);
  });

  it("toggles columns on desktop without opening drawers", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useWorkspaceLayout());

    act(() => result.current.toggleNavigation());
    act(() => result.current.toggleContext());
    expect(result.current.navigationPanelOpen).toBe(false);
    expect(result.current.contextPanelOpen).toBe(false);
    expect(result.current.navigationDrawerOpen).toBe(false);
    expect(result.current.contextDrawerOpen).toBe(false);
  });
});
