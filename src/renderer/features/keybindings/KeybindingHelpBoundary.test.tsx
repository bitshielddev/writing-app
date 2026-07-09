import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KeybindingHelpBoundary } from "./KeybindingHelpBoundary";

describe("KeybindingHelpBoundary", () => {
  it("provides an accessible loading state and completes the lazy dialog", async () => {
    render(<KeybindingHelpBoundary open onClose={vi.fn()} />);

    expect(
      screen.getByRole("status", { name: "Loading keyboard shortcuts" }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Close keyboard shortcuts" }),
      ),
    );
  });
});
