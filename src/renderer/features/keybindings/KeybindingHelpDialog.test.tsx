import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { KeybindingHelpDialog } from "./KeybindingHelpDialog";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open shortcuts
      </button>
      <KeybindingHelpDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe("KeybindingHelpDialog", () => {
  it("shows the keymap, closes with Escape, and restores focus", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open shortcuts" });
    await userEvent.click(trigger);

    expect(
      screen.getByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeTruthy();
    expect(screen.getByText("Dismiss suggestion")).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Close keyboard shortcuts" }),
      ),
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
