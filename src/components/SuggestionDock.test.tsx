import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { InboxEntry, PinnedInboxEntry } from "../suggestions/inbox";
import type { TextSuggestion } from "../suggestions/types";
import { SuggestionDock } from "./SuggestionDock";

const item: TextSuggestion = {
  id: "suggestion",
  dedupeKey: "suggestion",
  kind: "snippet",
  title: "Bring the human role forward",
  summary: "A concise summary for the queue.",
  body: "Full suggestion content.",
  insertText: "Text to preview.",
  sourceLabels: ["Vision.docx"],
  createdAt: 1,
};

const entry: InboxEntry = {
  item,
  viewed: false,
  stale: false,
  withdrawn: false,
};

const pinnedEntry: PinnedInboxEntry = {
  ...entry,
  viewed: true,
  pinnedAt: 2,
};

function renderDock(
  overrides: Partial<React.ComponentProps<typeof SuggestionDock>> = {},
) {
  const props: React.ComponentProps<typeof SuggestionDock> = {
    entries: [entry],
    pinnedEntries: [],
    unreadCount: 1,
    runtime: { status: "waiting", cycleCount: 0 },
    view: "suggestions",
    onViewChange: vi.fn(),
    onKeyboardTargetChange: vi.fn(),
    onSelect: vi.fn(),
    onBack: vi.fn(),
    onDismiss: vi.fn(),
    onPin: vi.fn(),
    onUnpin: vi.fn(),
    onPlaceOnWorkspace: vi.fn(),
    onPreview: vi.fn(),
    onStartAgent: vi.fn(),
    onStopAgent: vi.fn(),
    ...overrides,
  };
  function DockHarness() {
    const [view, setView] = useState(props.view);
    return (
      <SuggestionDock
        {...props}
        view={view}
        onViewChange={(nextView) => {
          props.onViewChange(nextView);
          setView(nextView);
        }}
      />
    );
  }

  render(<DockHarness />);
  return props;
}

describe("SuggestionDock", () => {
  it("has no legacy steering controls", () => {
    renderDock({ entries: [], unreadCount: 0 });

    expect(screen.queryByLabelText("Give the agent a direction")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send direction" })).toBeNull();
  });

  it("renders accessible Suggestions and Activity navigation", async () => {
    const props = renderDock();
    expect(screen.getByRole("navigation", { name: "Writing partner views" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(screen.getByRole("heading", { name: "Agent activity" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Suggestions" }));

    await userEvent.click(
      screen.getByRole("button", { name: `Open ${item.title}` }),
    );
    expect(props.onSelect).toHaveBeenCalledWith(item.id);
  });

  it("orders agent activity from newest to oldest", async () => {
    renderDock({
      activity: [
        {
          id: "middle",
          kind: "message",
          timestamp: 200,
          updatedAt: 200,
          title: "Middle message",
        },
        {
          id: "oldest",
          kind: "message",
          timestamp: 100,
          updatedAt: 100,
          title: "Oldest message",
        },
        {
          id: "newest",
          kind: "message",
          timestamp: 300,
          updatedAt: 300,
          title: "Newest message",
        },
      ],
    });

    await userEvent.click(screen.getByRole("button", { name: "Activity" }));

    expect(
      screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(["Newest message", "Middle message", "Oldest message"]);
  });

  it("starts and stops the agent from the persistent toolbar", async () => {
    const stoppedProps = renderDock({
      runtime: { status: "stopped", cycleCount: 0 },
    });
    await userEvent.click(screen.getByRole("button", { name: "Start Agent" }));
    expect(stoppedProps.onStartAgent).toHaveBeenCalledOnce();
    cleanup();

    const workingProps = renderDock({
      runtime: { status: "working", cycleCount: 0 },
    });
    await userEvent.click(screen.getByRole("button", { name: "Stop Agent" }));
    expect(workingProps.onStopAgent).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(screen.getByRole("button", { name: "Stop Agent" })).toBeTruthy();
  });

  it("disables lifecycle control while offline or pending", () => {
    renderDock({ runtime: { status: "offline", cycleCount: 0 } });
    expect(
      screen.getByRole("button", { name: "Start Agent" }).hasAttribute("disabled"),
    ).toBe(true);
    cleanup();

    renderDock({
      runtime: { status: "stopped", cycleCount: 0 },
      controlPending: "start",
    });
    expect(
      screen.getByRole("button", { name: "Starting…" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it.each([
    ["offline", "Agent unavailable"],
    ["stopped", "Agent stopped"],
    ["working", "Considering your draft…"],
    ["waiting", "Waiting for changes"],
    ["capped", "Autonomous loop capped"],
    ["error", "Agent error"],
  ] as const)("presents the %s runtime in the suggestion queue", (status, label) => {
    renderDock({
      entries: [],
      unreadCount: 0,
      runtime: { status, cycleCount: 0 },
    });

    expect(screen.getByText(label)).toBeTruthy();
    cleanup();
  });

  it("offers an editable preview action only from text detail", async () => {
    const props = renderDock({ selectedEntry: { ...entry, viewed: true } });

    await userEvent.click(
      screen.getByRole("button", { name: "Preview in document" }),
    );
    expect(props.onPreview).toHaveBeenCalledWith(item);
  });

  it("pins from the queue and renders pins in a separate section", async () => {
    const firstProps = renderDock();
    await userEvent.click(
      screen.getByRole("button", { name: `Pin ${item.title}` }),
    );
    expect(firstProps.onPin).toHaveBeenCalledWith(item.id);
    cleanup();

    renderDock({
      entries: [],
      pinnedEntries: [pinnedEntry],
      unreadCount: 0,
    });
    expect(screen.getByRole("heading", { name: "Pins" })).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: `Unpin ${item.title}` }),
    );
    expect(
      screen.getByRole("heading", { name: "Suggestion inbox" }),
    ).toBeTruthy();
  });

  it("places a pinned detail item on the workspace", async () => {
    const props = renderDock({
      entries: [],
      pinnedEntries: [pinnedEntry],
      selectedEntry: pinnedEntry,
      unreadCount: 0,
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Place on workspace" }),
    );
    expect(props.onPlaceOnWorkspace).toHaveBeenCalledWith(item);
  });

  it.each(["offline", "stopped", "working", "waiting", "capped", "error"] as const)(
    "shows the %s runtime state in Activity",
    async (status) => {
      renderDock({ runtime: { status, cycleCount: 2 } });
      await userEvent.click(screen.getByRole("button", { name: "Activity" }));
      expect(screen.getByText(new RegExp(`^${status} · cycle 2`))).toBeTruthy();
      cleanup();
    },
  );
});
