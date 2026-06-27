import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { InboxEntry, PinnedInboxEntry } from "../suggestions/inbox";
import type { SuggestionFeed, TextSuggestion } from "../suggestions/types";
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

const feed: SuggestionFeed = {
  subscribe: () => () => undefined,
  sendSteering: vi.fn(async () => undefined),
  retry: vi.fn(async () => undefined),
};

function renderDock(
  overrides: Partial<React.ComponentProps<typeof SuggestionDock>> = {},
) {
  const props: React.ComponentProps<typeof SuggestionDock> = {
    feed,
    entries: [entry],
    pinnedEntries: [],
    unreadCount: 1,
    status: "idle",
    focusRequest: 0,
    onSelect: vi.fn(),
    onBack: vi.fn(),
    onDismiss: vi.fn(),
    onPin: vi.fn(),
    onUnpin: vi.fn(),
    onPlaceOnWorkspace: vi.fn(),
    onPreview: vi.fn(),
    ...overrides,
  };
  render(<SuggestionDock {...props} />);
  return props;
}

describe("SuggestionDock", () => {
  it("renders one unified stream without type navigation", async () => {
    const props = renderDock();
    expect(screen.queryByRole("tablist")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: `Open ${item.title}` }),
    );
    expect(props.onSelect).toHaveBeenCalledWith(item.id);
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
});
