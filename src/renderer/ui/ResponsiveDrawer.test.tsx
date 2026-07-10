import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ResponsiveDrawer } from "./ResponsiveDrawer";

/**
 * What: renders the drawer harness component and wires its props into the surrounding UI.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by ResponsiveDrawer when that path needs this behavior.
 */
function DrawerHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open drawer
      </button>
      <ResponsiveDrawer
        id="test-drawer"
        title="Test drawer"
        side="left"
        open={open}
        onClose={() => setOpen(false)}
      >
        <button type="button">Drawer action</button>
      </ResponsiveDrawer>
    </>
  );
}

describe("ResponsiveDrawer", () => {
  it("closes with Escape and returns focus to its trigger", async () => {
    render(<DrawerHarness />);
    const trigger = screen.getByRole("button", { name: "Open drawer" });
    await userEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Test drawer" })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Close test drawer" }),
      ),
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Test drawer" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("closes from its explicit close control", async () => {
    render(<DrawerHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Open drawer" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Close test drawer" }),
    );

    expect(screen.queryByRole("dialog", { name: "Test drawer" })).toBeNull();
  });
});
