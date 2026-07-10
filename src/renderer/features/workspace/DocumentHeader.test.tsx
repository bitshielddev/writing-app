import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DocumentHeader } from "./DocumentHeader";

/**
 * What: performs the render header step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by DocumentHeader when that path needs this behavior.
 */
function renderHeader(
  overrides: Partial<React.ComponentProps<typeof DocumentHeader>> = {},
) {
  const props: React.ComponentProps<typeof DocumentHeader> = {
    navigationPanelOpen: true,
    contextPanelOpen: true,
    navigationDrawerOpen: false,
    contextDrawerOpen: false,
    contextUnreadCount: 0,
    onOpenContextDrawer: vi.fn(),
    onOpenNavigationDrawer: vi.fn(),
    onToggleContextPanel: vi.fn(),
    onToggleNavigationPanel: vi.fn(),
    ...overrides,
  };

  render(<DocumentHeader {...props} />);
  return props;
}

describe("DocumentHeader panel controls", () => {
  it("exposes the open desktop panels as collapsible controls", async () => {
    const props = renderHeader();
    const navigationToggle = screen.getByRole("button", {
      name: "Hide project navigation",
    });
    const contextToggle = screen.getByRole("button", {
      name: "Hide writing partner",
    });

    expect(navigationToggle.getAttribute("aria-controls")).toBe(
      "project-navigation-column",
    );
    expect(navigationToggle.getAttribute("aria-expanded")).toBe("true");
    expect(contextToggle.getAttribute("aria-expanded")).toBe("true");

    await userEvent.click(navigationToggle);
    await userEvent.click(contextToggle);
    expect(props.onToggleNavigationPanel).toHaveBeenCalledOnce();
    expect(props.onToggleContextPanel).toHaveBeenCalledOnce();
  });

  it("announces unread suggestions when the writing partner is hidden", async () => {
    const props = renderHeader({
      contextPanelOpen: false,
      contextUnreadCount: 5,
    });
    const contextToggle = screen.getByRole("button", {
      name: "Show writing partner, 5 unread suggestions",
    });

    expect(contextToggle.getAttribute("aria-expanded")).toBe("false");
    expect(contextToggle.textContent).toContain("5");
    await userEvent.click(contextToggle);
    expect(props.onToggleContextPanel).toHaveBeenCalledOnce();
  });

  it("keeps mobile drawer controls separate from desktop panel state", async () => {
    const props = renderHeader({
      navigationPanelOpen: false,
      contextPanelOpen: false,
      navigationDrawerOpen: true,
      contextDrawerOpen: true,
      contextUnreadCount: 1,
    });
    const navigationDrawerButton = screen.getByRole("button", {
      name: "Open project navigation",
    });
    const contextDrawerButton = screen.getByRole("button", {
      name: "Open writing partner, 1 unread suggestion",
    });

    expect(navigationDrawerButton.getAttribute("aria-expanded")).toBe("true");
    expect(contextDrawerButton.getAttribute("aria-expanded")).toBe("true");
    expect(contextDrawerButton.getAttribute("aria-haspopup")).toBe("dialog");

    await userEvent.click(navigationDrawerButton);
    await userEvent.click(contextDrawerButton);
    expect(props.onOpenNavigationDrawer).toHaveBeenCalledOnce();
    expect(props.onOpenContextDrawer).toHaveBeenCalledOnce();
  });
});
