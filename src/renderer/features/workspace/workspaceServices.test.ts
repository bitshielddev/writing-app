import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WritingEditor } from "../editor/schema";
import type { EditSuggestion } from "../../../domain/suggestions/schema";
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
    await waitFor(() => expect(result.current.activity[0]?.id).toBe("activity-1"));
    expect(result.current.activity).toHaveLength(AGENT_ACTIVITY_LIMIT);
    expect(result.current.activity[0]?.id).toBe("activity-1");
  });

  it("batches agent activity events before updating renderer state", async () => {
    const harness = new DesktopBridgeHarness();
    const scope = { projectId: "project-1", documentId: "document-1" };
    const { result } = renderHook(() => useAgentController(harness.bridge, scope));
    act(() => result.current.initialize({ status: "working", cycleCount: 1 }, []));

    act(() => {
      result.current.onDesktopEvent({
        type: "agent.activity",
        activity: {
          id: "first",
          kind: "message",
          timestamp: 1,
          updatedAt: 1,
          title: "First",
        },
      });
      result.current.onDesktopEvent({
        type: "agent.activity",
        activity: {
          id: "second",
          kind: "tool",
          timestamp: 2,
          updatedAt: 2,
          title: "Second",
        },
      });
    });

    expect(result.current.activity).toEqual([]);
    await waitFor(() => expect(result.current.activity.map((item) => item.id))
      .toEqual(["first", "second"]));
  });
});

describe("preview service", () => {
  it("previews edit source and accepts by replacing text", () => {
    const suggestion: EditSuggestion = {
      id: "suggestion",
      dedupeKey: "suggestion",
      kind: "edit",
      title: "Suggestion",
      summary: "Summary",
      body: "Body",
      sourceDocumentRevision: 1,
      sourceBlockId: "paragraph",
      sourceStart: 0,
      sourceEnd: 14,
      sourceText: "Suggested text",
      newText: "Replacement text",
      sourceLabels: [],
      createdAt: 1,
    };
    const state = {
      document: [{ id: "paragraph", type: "paragraph", props: {}, content: "Suggested text" }],
    };
    const editor = {
      get document() {
        return state.document;
      },
      getTextCursorPosition: vi.fn(() => ({ block: { id: "paragraph" } })),
      replaceBlocks: vi.fn((_ids: string[], blocks: typeof state.document) => {
        state.document = blocks;
        return { insertedBlocks: blocks, removedBlocks: [] };
      }),
      setTextCursorPosition: vi.fn(),
    } as unknown as WritingEditor;
    const markViewed = vi.fn();
    const previewResolved = vi.fn();
    const documentChanged = vi.fn();
    const hook = renderHook(() =>
      usePreviewController({
        editor,
        markViewed,
        previewResolved,
        documentChanged,
      }),
    );

    act(() => expect(hook.result.current.preview(suggestion)).toBe(true));
    expect(markViewed).toHaveBeenCalledWith("suggestion");
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith("paragraph", "start");

    act(() => expect(hook.result.current.accept(suggestion)).toBe(true));
    expect(state.document[0]?.content).toBe("Replacement text");
    expect(documentChanged).toHaveBeenCalledOnce();
    expect(previewResolved).toHaveBeenCalledWith("suggestion", "accepted");
  });
});
