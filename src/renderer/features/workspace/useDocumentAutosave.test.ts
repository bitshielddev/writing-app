import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WritingEditor } from "../editor/schema";
import { DesktopBridgeHarness, createDocumentSnapshot } from "../../../test/desktopBridgeHarness";
import { useDocumentAutosave } from "./useDocumentAutosave";

function editor() {
  const state = {
    document: [
      { id: "text", type: "paragraph" },
      { id: "preview", type: "suggestionPreview" },
    ],
  };
  const value = {
    get document() {
      return state.document;
    },
    blocksToMarkdownLossy: vi.fn(() => "strict markdown"),
  } as unknown as WritingEditor;
  return { state, value };
}

afterEach(() => vi.useRealTimers());

describe("useDocumentAutosave", () => {
  it("debounces, excludes previews, serializes, and advances revisions", async () => {
    vi.useFakeTimers();
    const harness = new DesktopBridgeHarness();
    const writingEditor = editor();
    const { result } = renderHook(() =>
      useDocumentAutosave(harness.bridge, writingEditor.value, true),
    );
    act(() => result.current.initialize(createDocumentSnapshot({ revision: 3 })));
    act(() => {
      result.current.handleChange();
      vi.advanceTimersByTime(649);
    });
    expect(harness.saveDocument.calls).toHaveLength(0);
    await act(async () => vi.advanceTimersByTime(1));
    expect(harness.saveDocument.calls[0]?.args[0]).toMatchObject({
      expectedRevision: 3,
      markdown: "strict markdown",
      blocks: [{ id: "text", type: "paragraph" }],
    });

    act(() => result.current.handleChange());
    await act(async () => vi.advanceTimersByTime(650));
    expect(harness.saveDocument.calls).toHaveLength(1);
    await act(async () => {
      harness.saveDocument.resolve(0, createDocumentSnapshot({ revision: 4 }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(harness.saveDocument.calls).toHaveLength(2);
    expect(harness.saveDocument.calls[1]?.args[0].expectedRevision).toBe(4);
  });

  it("supports explicit flush, suppresses writes before ready, and exposes conflicts", async () => {
    const harness = new DesktopBridgeHarness();
    const writingEditor = editor();
    const hook = renderHook(
      ({ ready }) => useDocumentAutosave(harness.bridge, writingEditor.value, ready),
      { initialProps: { ready: false } },
    );
    act(() => {
      hook.result.current.initialize(createDocumentSnapshot());
      hook.result.current.handleChange();
      hook.result.current.flush();
    });
    expect(harness.saveDocument.calls).toHaveLength(0);

    hook.rerender({ ready: true });
    act(() => hook.result.current.flush());
    await waitFor(() => expect(harness.saveDocument.calls).toHaveLength(1));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    act(() => harness.saveDocument.reject(0, new Error("revision conflict")));
    await waitFor(() => expect(hook.result.current.status).toBe("failed"));
    expect(hook.result.current.error).toBe("revision conflict");
  });

  it("flushes a pending edit on unmount", async () => {
    vi.useFakeTimers();
    const harness = new DesktopBridgeHarness();
    const writingEditor = editor();
    const hook = renderHook(() =>
      useDocumentAutosave(harness.bridge, writingEditor.value, true),
    );
    act(() => {
      hook.result.current.initialize(createDocumentSnapshot());
      hook.result.current.handleChange();
    });
    hook.unmount();
    await act(async () => Promise.resolve());
    expect(harness.saveDocument.calls).toHaveLength(1);
  });
});
