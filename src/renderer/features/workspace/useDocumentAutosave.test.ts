import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WritingEditor } from "../editor/schema";
import { DesktopBridgeHarness, createDocumentSnapshot } from "../../../test/desktopBridgeHarness";
import { useDocumentAutosave } from "./useDocumentAutosave";

/**
 * What: performs the editor step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by useDocumentAutosave when that path needs this behavior.
 */
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
  } as unknown as WritingEditor;
  return { state, value };
}

afterEach(() => vi.useRealTimers());

describe("useDocumentAutosave", () => {
  it("debounces, excludes previews, saves blocks, and advances revisions", async () => {
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

  it("normalizes live editor metadata before saving through preload", async () => {
    vi.useFakeTimers();
    const harness = new DesktopBridgeHarness();
    const writingEditor = editor();
    writingEditor.state.document = [
      {
        id: "text",
        type: "paragraph",
        props: { textColor: "default", backgroundColor: undefined },
        content: [
          { type: "text", text: "Draft", styles: { bold: undefined } },
          undefined,
        ],
      },
      { id: "preview", type: "suggestionPreview", content: undefined },
    ] as typeof writingEditor.state.document;
    const { result } = renderHook(() =>
      useDocumentAutosave(harness.bridge, writingEditor.value, true),
    );
    act(() => result.current.initialize(createDocumentSnapshot({ revision: 3 })));

    act(() => result.current.handleChange());
    await act(async () => vi.advanceTimersByTime(650));

    expect(harness.saveDocument.calls[0]?.args[0].blocks).toEqual([
      {
        id: "text",
        type: "paragraph",
        props: { textColor: "default" },
        content: [
          { type: "text", text: "Draft", styles: {} },
          null,
        ],
      },
    ]);
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

  it("does not flush when the document has no pending edits", async () => {
    vi.useFakeTimers();
    const harness = new DesktopBridgeHarness();
    const writingEditor = editor();
    const { result } = renderHook(() =>
      useDocumentAutosave(harness.bridge, writingEditor.value, true),
    );
    act(() => result.current.initialize(createDocumentSnapshot()));
    act(() => result.current.flush());
    expect(harness.saveDocument.calls).toHaveLength(0);

    act(() => result.current.handleChange());
    await act(async () => vi.advanceTimersByTime(650));
    expect(harness.saveDocument.calls).toHaveLength(1);
    await act(async () => {
      harness.saveDocument.resolve(0, createDocumentSnapshot({ revision: 2 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => result.current.flush());
    expect(harness.saveDocument.calls).toHaveLength(1);
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
