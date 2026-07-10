import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WritingEditor } from "../editor/schema";
import { DesktopBridgeHarness, createWorkspaceSnapshot } from "../../../test/desktopBridgeHarness";
import { useWorkspaceHydration } from "./useWorkspaceHydration";

/**
 * What: performs the editor step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by useWorkspaceHydration when that path needs this behavior.
 */
function editor() {
  const document = [{ id: "initial", type: "paragraph" }];
  return {
    document,
    replaceBlocks: vi.fn(),
  } as unknown as WritingEditor;
}

describe("useWorkspaceHydration", () => {
  it("installs the document and becomes ready after initialization", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const harness = new DesktopBridgeHarness();
    const initialize = vi.fn();
    const writingEditor = editor();
    const { result } = renderHook(() =>
      useWorkspaceHydration({ desktop: harness.bridge, editor: writingEditor,
        scope: { projectId: "project-1", documentId: "document-1" }, initialize }),
    );

    act(() => harness.hydrate.resolve(0, createWorkspaceSnapshot()));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(writingEditor.replaceBlocks).toHaveBeenCalledOnce();
    expect(initialize).toHaveBeenCalledOnce();
  });

  it("reports failure and ignores completion after unmount", async () => {
    const failed = new DesktopBridgeHarness();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = renderHook(() =>
      useWorkspaceHydration({ desktop: failed.bridge, editor: editor(),
        scope: { projectId: "project-1", documentId: "document-1" }, initialize: vi.fn() }),
    );
    act(() => failed.hydrate.reject(0, new Error("database unavailable")));
    await waitFor(() => expect(first.result.current.phase).toBe("failed"));
    expect(first.result.current.error).toBe("database unavailable");

    const pending = new DesktopBridgeHarness();
    const initialize = vi.fn();
    const second = renderHook(() =>
      useWorkspaceHydration({ desktop: pending.bridge, editor: editor(),
        scope: { projectId: "project-1", documentId: "document-1" }, initialize }),
    );
    second.unmount();
    await act(async () => pending.hydrate.resolve(0, createWorkspaceSnapshot()));
    expect(initialize).not.toHaveBeenCalled();
  });
});
