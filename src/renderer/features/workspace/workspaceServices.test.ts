import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WritingEditor } from "../editor/schema";
import type { TextSuggestion } from "../../../domain/suggestions/schema";
import {
  DesktopBridgeHarness,
  createSourceSnapshot,
} from "../../../test/desktopBridgeHarness";
import { AGENT_ACTIVITY_LIMIT, useAgentController } from "../agent/useAgentController";
import { usePreviewController } from "./usePreviewController";
import { useSourceController } from "./useSourceController";

describe("source and agent services", () => {
  it("reconciles source imports by identity and reports import failures", async () => {
    const harness = new DesktopBridgeHarness();
    const scope = { projectId: "project-1", documentId: "document-1" };
    const { result } = renderHook(() => useSourceController(harness.bridge, scope));
    const first = createSourceSnapshot();
    act(() => result.current.initialize([first]));
    act(() => void result.current.importSource());
    expect(result.current.pending).toBe(true);
    await act(async () => harness.importSource.resolve(0, undefined));
    await waitFor(() => expect(result.current.pending).toBe(false));

    const updated = createSourceSnapshot({ title: "Updated", updatedAt: 2 });
    act(() => result.current.onDesktopEvent({
      type: "source.imported",
      source: updated,
      projectRevision: 6,
    }));
    expect(result.current.sources).toEqual([updated]);

    act(() => void result.current.importSource());
    await act(async () => harness.importSource.reject(1, new Error("file denied")));
    await waitFor(() => expect(result.current.error).toBe("file denied"));
  });

  it("controls runtime, handles failure, upserts activity, and caps history", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = new DesktopBridgeHarness();
    const scope = { projectId: "project-1", documentId: "document-1" };
    const { result } = renderHook(() => useAgentController(harness.bridge, scope));
    act(() => result.current.initialize({ status: "stopped", cycleCount: 0 }, []));
    act(() => result.current.start());
    await act(async () => harness.startAgent.resolve(0, { status: "working", cycleCount: 1 }));
    await waitFor(() => expect(result.current.runtime.status).toBe("working"));

    act(() => result.current.stop());
    await act(async () => harness.stopAgent.reject(0, new Error("stop failed")));
    await waitFor(() => expect(result.current.error).toBe("stop failed"));
    expect(result.current.runtime.status).toBe("working");

    const history = Array.from({ length: AGENT_ACTIVITY_LIMIT }, (_, index) => ({
      id: `activity-${index}`,
      kind: "message" as const,
      timestamp: index,
      updatedAt: index,
      title: `Activity ${index}`,
    }));
    act(() => result.current.initialize(result.current.runtime, history));
    act(() => result.current.onDesktopEvent({
      type: "agent.activity",
      activity: {
        id: `activity-${AGENT_ACTIVITY_LIMIT}`,
        kind: "message",
        timestamp: AGENT_ACTIVITY_LIMIT,
        updatedAt: AGENT_ACTIVITY_LIMIT,
        title: "Newest activity",
      },
    }));
    expect(result.current.activity).toHaveLength(AGENT_ACTIVITY_LIMIT);
    expect(result.current.activity[0]?.id).toBe("activity-1");
  });
});

describe("preview service", () => {
  it("places a preview and removes temporary content on teardown", () => {
    const suggestion: TextSuggestion = {
      id: "suggestion",
      dedupeKey: "suggestion",
      kind: "snippet",
      title: "Suggestion",
      summary: "Summary",
      body: "Body",
      insertText: "Suggested text",
      sourceLabels: [],
      createdAt: 1,
    };
    const state = {
      document: [{ id: "paragraph", type: "paragraph", props: {} }],
    };
    const editor = {
      get document() {
        return state.document;
      },
      getTextCursorPosition: vi.fn(() => ({ block: { id: "paragraph" } })),
      insertBlocks: vi.fn(() => {
        const preview = {
          id: "preview",
          type: "suggestionPreview",
          props: { suggestionId: "suggestion", targetBlockId: "paragraph" },
        };
        state.document.push(preview);
        return [preview];
      }),
      setTextCursorPosition: vi.fn(),
      removeBlocks: vi.fn((ids: string[]) => {
        state.document = state.document.filter((block) => !ids.includes(block.id));
      }),
    } as unknown as WritingEditor;
    const previewStarted = vi.fn();
    const previewResolved = vi.fn();
    const hook = renderHook(
      ({ activePreviewId }: { activePreviewId?: string }) =>
        usePreviewController({
          editor,
          activePreviewId,
          previewStarted,
          previewResolved,
        }),
      { initialProps: { activePreviewId: undefined as string | undefined } },
    );
    act(() => hook.result.current.preview(suggestion));
    expect(previewStarted).toHaveBeenCalledWith("suggestion");
    hook.rerender({ activePreviewId: "suggestion" });
    hook.unmount();
    expect(editor.removeBlocks).toHaveBeenCalledWith(["preview"]);
  });
});
