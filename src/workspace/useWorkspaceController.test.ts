import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emitPreviewResolution } from "../editor/previewEvents";
import type { WritingEditor } from "../editor/schema";
import type {
  DesktopBridge,
  DesktopEvent,
  DocumentSnapshot,
  WorkspaceSnapshot,
} from "../shared/desktop";
import { createEmptySuggestionState } from "../suggestions/state";
import { useWorkspaceController } from "./useWorkspaceController";

function documentSnapshot(revision: number, blocks: unknown[]): DocumentSnapshot {
  return {
    id: "document",
    projectId: "project",
    title: "Draft",
    blocks,
    markdown: "Draft",
    schemaVersion: 1,
    revision,
    updatedAt: revision,
  };
}

function snapshot(): WorkspaceSnapshot {
  return {
    project: { id: "project", name: "Project", revision: 3 },
    document: documentSnapshot(3, [{ id: "hydrated", type: "paragraph" }]),
    sources: [
      {
        id: "source-1",
        projectId: "project",
        title: "Source one",
        storagePath: "/source-1.md",
        bytes: 10,
        updatedAt: 1,
      },
    ],
    suggestions: createEmptySuggestionState(),
    agent: { status: "waiting", cycleCount: 2 },
    activity: [],
  };
}

function createHarness() {
  const listeners = new Set<(event: DesktopEvent) => void>();
  const editorState = {
    document: [{ id: "initial", type: "paragraph", content: "Initial" }],
  };
  const editor = {
    get document() {
      return editorState.document;
    },
    getTextCursorPosition: vi.fn(() => ({ block: { id: "initial" } })),
    replaceBlocks: vi.fn((_current, blocks) => {
      editorState.document = blocks as typeof editorState.document;
      return { insertedBlocks: editorState.document, removedBlocks: [] };
    }),
    blocksToMarkdownLossy: vi.fn((blocks) =>
      blocks.map((block: { id: string }) => block.id).join("\n"),
    ),
    insertBlocks: vi.fn(() => [{ id: "preview", type: "suggestionPreview" }]),
    setTextCursorPosition: vi.fn(),
  } as unknown as WritingEditor;
  const bridge: DesktopBridge = {
    hydrate: vi.fn().mockResolvedValue(snapshot()),
    startAgent: vi.fn().mockResolvedValue({ status: "working", cycleCount: 0 }),
    stopAgent: vi.fn().mockResolvedValue({ status: "stopped", cycleCount: 0 }),
    saveDocument: vi.fn().mockResolvedValue(documentSnapshot(4, [])),
    saveSuggestionState: vi.fn().mockResolvedValue(undefined),
    importSource: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  return {
    bridge,
    editor,
    editorState,
    listenerCount: () => listeners.size,
    emit(event: DesktopEvent) {
      listeners.forEach((listener) => listener(event));
    },
  };
}

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

describe("workspace controller", () => {
  it("hydrates the editor and renderer-owned workspace state", async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useWorkspaceController(harness.bridge, harness.editor),
    );

    await waitFor(() => expect(result.current.runtime.status).toBe("waiting"));
    expect(harness.editor.replaceBlocks).toHaveBeenCalled();
    expect(result.current.sources.map((source) => source.id)).toEqual(["source-1"]);
    expect(result.current.inbox.entries).toEqual([]);
    expect(harness.bridge.saveSuggestionState).not.toHaveBeenCalled();
  });

  it("serializes autosaves and advances the expected revision", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    let resolveFirst!: (document: DocumentSnapshot) => void;
    const firstSave = new Promise<DocumentSnapshot>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(harness.bridge.saveDocument)
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce(documentSnapshot(5, []));
    const { result } = renderHook(() =>
      useWorkspaceController(harness.bridge, harness.editor),
    );
    await act(async () => Promise.resolve());

    act(() => result.current.handleEditorChange());
    await act(async () => {
      vi.advanceTimersByTime(650);
      await Promise.resolve();
    });
    expect(harness.bridge.saveDocument).toHaveBeenCalledTimes(1);

    harness.editorState.document = [
      { id: "second", type: "paragraph", content: "Second" },
    ];
    act(() => result.current.handleEditorChange());
    await act(async () => {
      vi.advanceTimersByTime(650);
      await Promise.resolve();
    });
    expect(harness.bridge.saveDocument).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst(documentSnapshot(4, []));
      await firstSave;
      await Promise.resolve();
    });
    expect(harness.bridge.saveDocument).toHaveBeenCalledTimes(2);
    expect(vi.mocked(harness.bridge.saveDocument).mock.calls[1]?.[0])
      .toMatchObject({ expectedRevision: 4 });
    vi.useRealTimers();
  });

  it("applies source, runtime, and activity desktop events", async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useWorkspaceController(harness.bridge, harness.editor),
    );
    await waitFor(() => expect(result.current.runtime.status).toBe("waiting"));
    const source = {
      id: "source-2",
      projectId: "project",
      title: "Source two",
      storagePath: "/source-2.md",
      bytes: 20,
      updatedAt: 2,
    };
    const activity = {
      id: "activity",
      kind: "message" as const,
      timestamp: 1,
      updatedAt: 1,
      title: "First title",
    };

    act(() => {
      harness.emit({ type: "source.imported", source, projectRevision: 4 });
      harness.emit({
        type: "agent.runtime",
        runtime: { status: "working", cycleCount: 3 },
      });
      harness.emit({ type: "agent.activity", activity });
      harness.emit({
        type: "agent.activity",
        activity: { ...activity, updatedAt: 2, title: "Updated title" },
      });
    });

    expect(result.current.sources[0]?.id).toBe("source-2");
    expect(result.current.runtime.status).toBe("working");
    expect(result.current.activity).toEqual([
      { ...activity, updatedAt: 2, title: "Updated title" },
    ]);
  });

  it("reports control failures without changing runtime authority", async () => {
    const harness = createHarness();
    vi.mocked(harness.bridge.startAgent).mockRejectedValueOnce(
      new Error("credentials missing"),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useWorkspaceController(harness.bridge, harness.editor),
    );
    await waitFor(() => expect(result.current.runtime.status).toBe("waiting"));

    act(() => result.current.handleStartAgent());
    await waitFor(() => expect(result.current.agentError).toBe("credentials missing"));
    expect(result.current.runtime.status).toBe("waiting");
    expect(result.current.agentControlPending).toBeUndefined();
  });

  it("resolves preview lifecycle events through the inbox", async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useWorkspaceController(harness.bridge, harness.editor),
    );
    await waitFor(() => expect(result.current.runtime.status).toBe("waiting"));
    act(() => result.current.inbox.previewStarted("suggestion"));
    expect(result.current.inbox.activePreviewId).toBe("suggestion");

    act(() =>
      emitPreviewResolution({ suggestionId: "suggestion", outcome: "cancelled" }),
    );
    expect(result.current.inbox.activePreviewId).toBeUndefined();
  });

  it("cleans up the shared desktop subscription on remount", () => {
    const harness = createHarness();
    const first = renderHook(() =>
      useWorkspaceController(harness.bridge, harness.editor),
    );
    expect(harness.listenerCount()).toBe(1);
    first.unmount();
    expect(harness.listenerCount()).toBe(0);

    const second = renderHook(() =>
      useWorkspaceController(harness.bridge, harness.editor),
    );
    expect(harness.listenerCount()).toBe(1);
    second.unmount();
    expect(harness.listenerCount()).toBe(0);
  });
});
