import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emitPreviewResolution } from "./editor/previewEvents";
import {
  createDocumentSnapshot,
  createSourceSnapshot,
  createWorkspaceSnapshot,
  DesktopBridgeHarness,
} from "./test/desktopBridgeHarness";
import type { TextSuggestion } from "./domain/suggestions/schema";
import { createEmptySuggestionState } from "./domain/suggestions/state";

const appHarness = vi.hoisted(() => {
  const state = {
    document: [] as Array<{ id: string; type: string; content?: unknown }>,
    cursorId: "block-1",
  };
  const editor = {
    get document() {
      return state.document;
    },
    getTextCursorPosition: vi.fn(() => ({ block: { id: state.cursorId } })),
    replaceBlocks: vi.fn((_current: unknown, blocks: typeof state.document) => {
      state.document = [...blocks];
      return { insertedBlocks: blocks, removedBlocks: [] };
    }),
    blocksToMarkdownLossy: vi.fn((blocks: typeof state.document) =>
      blocks.map((block) => String(block.content ?? block.id)).join("\n"),
    ),
    insertBlocks: vi.fn(
      (blocks: typeof state.document, reference: { id: string }) => {
        const inserted = blocks.map((block, index) => ({
          ...block,
          id: `preview-${index}`,
        }));
        const index = state.document.findIndex((block) => block.id === reference.id);
        state.document.splice(index + 1, 0, ...inserted);
        return inserted;
      },
    ),
    setTextCursorPosition: vi.fn((id: string) => {
      state.cursorId = id;
    }),
    focus: vi.fn(),
  };
  return { state, editor };
});

vi.mock("@blocknote/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@blocknote/react")>()),
  useCreateBlockNote: () => appHarness.editor,
}));

vi.mock("./components/EditorWorkspace", () => ({
  EditorWorkspace: (props: {
    editor: typeof appHarness.editor;
    workspacePins: Array<{ item: { id: string; title: string } }>;
    onEditorChange: () => void;
  }) => (
    <section aria-label="Draft workspace">
      <div data-testid="document-blocks">
        {props.editor.document.map((block) => block.id).join(",")}
      </div>
      <div data-testid="workspace-pins">
        {props.workspacePins.map((pin) => pin.item.title).join(",")}
      </div>
      <button
        type="button"
        onClick={() => {
          appHarness.state.document.push({
            id: "edited-block",
            type: "paragraph",
            content: "Edited copy",
          });
          props.onEditorChange();
        }}
      >
        Edit document
      </button>
    </section>
  ),
}));

vi.mock("./keybindings/useWorkspaceKeybindings", () => ({
  useWorkspaceKeybindings: () => ({
    helpOpen: false,
    openHelp: vi.fn(),
    closeHelp: vi.fn(),
    stripState: undefined,
  }),
}));

import App from "./App";

const suggestion: TextSuggestion = {
  id: "suggestion-1",
  dedupeKey: "suggestion-1",
  kind: "snippet",
  title: "Clarify the opening",
  summary: "Make the first sentence concrete.",
  body: "The current opening is abstract.",
  insertText: "A concrete opening.",
  sourceLabels: ["Research.md"],
  createdAt: 1,
};

function workspaceWithSuggestion() {
  return createWorkspaceSnapshot({
    suggestions: {
      entries: [
        { item: suggestion, viewed: false },
      ],
      pinnedEntries: [],
      workspacePins: [],
      seenKeys: { [suggestion.dedupeKey]: true },
      nextZIndex: 1,
    },
  });
}

beforeEach(() => {
  appHarness.state.document = [
    { id: "initial", type: "paragraph", content: "Initial" },
  ];
  appHarness.state.cursorId = "initial";
  Object.values(appHarness.editor).forEach((value) => {
    if (typeof value === "function" && "mockClear" in value) {
      (value as ReturnType<typeof vi.fn>).mockClear();
    }
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

describe("App desktop boundary", () => {
  it("hydrates visible state and completes a deterministic application workflow", async () => {
    const desktop = new DesktopBridgeHarness();
    render(<App desktop={desktop.bridge} />);
    await waitFor(() => expect(desktop.hydrate.calls).toHaveLength(1));

    await act(async () => {
      desktop.hydrate.resolve(0, workspaceWithSuggestion());
      await Promise.resolve();
    });
    vi.useFakeTimers();
    expect(screen.getAllByText("Research.md").length).toBeGreaterThan(0);
    expect(screen.getByText("Agent stopped")).toBeTruthy();
    expect(screen.getByRole("button", { name: `Open ${suggestion.title}` })).toBeTruthy();
    expect(screen.getByTestId("document-blocks").textContent).toContain("block-1");

    fireEvent.click(screen.getByRole("button", { name: `Open ${suggestion.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "Preview in document" }));
    expect(screen.getByRole("button", { name: "Preview active" })).toBeTruthy();
    expect(appHarness.editor.insertBlocks).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    act(() =>
      emitPreviewResolution({
        suggestionId: suggestion.id,
        outcome: "cancelled",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Place on workspace" }));
    expect(screen.getByTestId("workspace-pins").textContent).toContain(
      suggestion.title,
    );

    act(() => {
      desktop.emit({
        type: "document.saved",
        document: createDocumentSnapshot({ revision: 9 }),
        projectRevision: 11,
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit document" }));
    await act(async () => {
      vi.advanceTimersByTime(650);
      await Promise.resolve();
    });
    expect(desktop.saveDocument.calls).toHaveLength(1);
    expect(desktop.saveDocument.calls[0]?.args[0].expectedRevision).toBe(9);
    const savedBlocks = desktop.saveDocument.calls[0]?.args[0].blocks as Array<{
      type: string;
    }>;
    expect(savedBlocks.some((block) => block.type === "suggestionPreview")).toBe(
      false,
    );
    expect(savedBlocks.some((block) => block.type === "paragraph")).toBe(true);
    await act(async () => {
      desktop.saveDocument.resolve(
        0,
        createDocumentSnapshot({ revision: 4, blocks: savedBlocks }),
      );
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "Upload Sources" }));
    await act(async () => {
      desktop.importSource.resolve(
        0,
        createSourceSnapshot({ id: "source-2", title: "Notes.md" }),
      );
      await Promise.resolve();
    });
    expect(screen.getByText("Notes.md")).toBeTruthy();
    act(() => {
      desktop.emit({
        type: "source.imported",
        source: createSourceSnapshot({ id: "source-3", title: "Event source.md" }),
        projectRevision: 12,
      });
    });
    expect(screen.getByText("Event source.md")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start Agent" }));
    await act(async () => {
      desktop.startAgent.resolve(0, { status: "working", cycleCount: 3 });
      await Promise.resolve();
    });
    expect(screen.getByText("Considering your draft…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop Agent" }));
    await act(async () => {
      desktop.stopAgent.resolve(0, { status: "stopped", cycleCount: 3 });
      await Promise.resolve();
    });
    expect(screen.getByText("Agent stopped")).toBeTruthy();

    act(() => {
      desktop.emit({
        type: "agent.runtime",
        runtime: { status: "waiting", cycleCount: 4 },
      });
      desktop.emit({
        type: "agent.activity",
        activity: {
          id: "activity-1",
          kind: "message",
          timestamp: 4,
          updatedAt: 4,
          title: "Reviewed the opening",
        },
      });
    });
    expect(screen.getByText("Waiting for changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(screen.getAllByText("Reviewed the opening")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Suggestions" }));

    act(() => {
      const item = { ...suggestion, id: "suggestion-2", dedupeKey: "suggestion-2", title: "New suggestion" };
      desktop.emit({
        type: "suggestion.event",
        event: {
          type: "suggestion.added",
          item,
        },
        suggestionRevision: 1,
        state: { ...createEmptySuggestionState(), entries: [{ item, viewed: false }], seenKeys: { [item.dedupeKey]: true } },
      });
    });
    expect(screen.getByRole("button", { name: "Open New suggestion" })).toBeTruthy();
    vi.useRealTimers();
  });

  it("surfaces agent failures and cleans up subscriptions across remounts", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const desktop = new DesktopBridgeHarness();
    const mounted = render(<App desktop={desktop.bridge} />);
    await waitFor(() => expect(desktop.hydrate.calls).toHaveLength(1));
    await act(async () => {
      desktop.hydrate.resolve(0, createWorkspaceSnapshot());
      await Promise.resolve();
    });
    expect(desktop.listenerCount).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Start Agent" }));
    await act(async () => {
      desktop.startAgent.reject(0, new Error("credentials missing"));
      await Promise.resolve();
    });
    expect(screen.getByText("credentials missing")).toBeTruthy();

    mounted.unmount();
    expect(desktop.listenerCount).toBe(0);
    act(() => {
      desktop.emit({
        type: "agent.runtime",
        runtime: { status: "working", cycleCount: 9 },
      });
    });

    render(<App desktop={desktop.bridge} />);
    await waitFor(() => expect(desktop.hydrate.calls).toHaveLength(2));
    await act(async () => {
      desktop.hydrate.resolve(1, createWorkspaceSnapshot());
      await Promise.resolve();
    });
    expect(desktop.listenerCount).toBe(1);
    expect(screen.getByText("Agent stopped")).toBeTruthy();
    expect(consoleError).toHaveBeenCalledWith(
      "Agent start failed",
      expect.any(Error),
    );
  });

  it("contains hydration failures without retaining stale state", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const desktop = new DesktopBridgeHarness();
    render(<App desktop={desktop.bridge} />);
    await waitFor(() => expect(desktop.hydrate.calls).toHaveLength(1));
    await act(async () => {
      desktop.hydrate.reject(0, new Error("database unavailable"));
      await Promise.resolve();
    });
    expect(screen.getByText("Agent unavailable")).toBeTruthy();
    expect(consoleError).toHaveBeenCalledWith(
      "Workspace hydration failed",
      expect.any(Error),
    );
  });
});
