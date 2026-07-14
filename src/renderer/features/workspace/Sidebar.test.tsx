import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("opens keyboard help from the existing Help item", async () => {
    const onOpenKeybindingHelp = vi.fn();
    render(<Sidebar onOpenKeybindingHelp={onOpenKeybindingHelp} />);

    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(onOpenKeybindingHelp).toHaveBeenCalledOnce();
  });

  it("places Settings in the secondary navigation and removes Archive", async () => {
    const onOpenSettings = vi.fn();
    render(<Sidebar onOpenSettings={onOpenSettings} />);

    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
