import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MockSuggestionPublisher } from "./mockSuggestionChannel";
import { MockSuggestionController } from "./MockSuggestionController";

describe("MockSuggestionController", () => {
  it("switches kind-specific fields and publishes a validated suggestion", async () => {
    const user = userEvent.setup();
    const publisher: MockSuggestionPublisher = {
      publish: vi.fn(),
      close: vi.fn(),
    };
    const createPublisher = vi.fn(() => publisher);
    const { unmount } = render(
      <MockSuggestionController createPublisher={createPublisher} />,
    );

    expect(screen.getByLabelText("Insert text")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Kind"), "outline");
    expect(screen.queryByLabelText("Insert text")).toBeNull();
    expect(screen.getByLabelText("Nodes JSON")).toBeTruthy();

    await user.type(screen.getByLabelText("Title"), "Manual outline");
    await user.type(screen.getByLabelText("Summary"), "A short outline summary");
    await user.type(screen.getByLabelText("Body"), "A longer outline body");
    await user.type(
      screen.getByLabelText(/Source labels/),
      "Source.pdf",
    );
    fireEvent.change(screen.getByLabelText("Nodes JSON"), {
      target: { value: '[{"id":"one","label":"First"}]' },
    });

    await user.click(screen.getByRole("button", { name: "Send suggestion" }));

    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "outline",
        title: "Manual outline",
        sourceLabels: ["Source.pdf"],
        nodes: [{ id: "one", label: "First" }],
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("Manual outline");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Kind") as HTMLSelectElement).value).toBe(
      "snippet",
    );

    unmount();
    expect(publisher.close).toHaveBeenCalledOnce();
  });

  it("disables submission when BroadcastChannel is unavailable", () => {
    render(<MockSuggestionController channelSupported={false} />);

    expect(screen.getByRole("alert").textContent).toContain(
      "does not support BroadcastChannel",
    );
    expect(
      (screen.getByRole("button", {
        name: "Send suggestion",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
