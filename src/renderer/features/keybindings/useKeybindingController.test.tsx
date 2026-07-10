import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APP_COMMAND_IDS,
  executed,
  type CommandHandlers,
} from "./commands";
import { KeybindingCommandStrip } from "./KeybindingCommandStrip";
import { useKeybindingController } from "./useKeybindingController";

/**
 * What: creates handlers with the dependencies and defaults this workflow expects.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by useKeybindingController when that path needs this behavior.
 */
function createHandlers() {
  return Object.fromEntries(
    APP_COMMAND_IDS.map((id) => [id, vi.fn(() => executed())]),
  ) as unknown as CommandHandlers;
}

/**
 * What: renders the harness component and wires its props into the surrounding UI.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by useKeybindingController when that path needs this behavior.
 */
function Harness({ handlers }: { handlers: CommandHandlers }) {
  const controller = useKeybindingController({ handlers });
  return <KeybindingCommandStrip state={controller.stripState} />;
}

/**
 * What: performs the press step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by useKeybindingController when that path needs this behavior.
 */
function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  fireEvent(document, event);
  return event;
}

afterEach(() => vi.useRealTimers());

describe("useKeybindingController", () => {
  it("arms with Ctrl+; and executes a recognized command", () => {
    const handlers = createHandlers();
    render(<Harness handlers={handlers} />);

    const leader = press(";", { code: "Semicolon", ctrlKey: true });
    expect(leader.defaultPrevented).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "Focus project navigation",
    );

    const command = press("h");
    expect(command.defaultPrevented).toBe(true);
    expect(handlers["region.navigation.focus"]).toHaveBeenCalledOnce();
  });

  it("requires the second d before dismissing", () => {
    const handlers = createHandlers();
    render(<Harness handlers={handlers} />);

    press(";", { code: "Semicolon", ctrlKey: true });
    press("d");
    expect(handlers["suggestion.dismiss"]).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain(
      "Dismiss suggestion",
    );
    press("d");
    expect(handlers["suggestion.dismiss"]).toHaveBeenCalledOnce();
  });

  it("does not consume an invalid continuation", () => {
    const handlers = createHandlers();
    render(<Harness handlers={handlers} />);

    press(";", { code: "Semicolon", ctrlKey: true });
    const invalid = press("x");
    expect(invalid.defaultPrevented).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("Unknown shortcut");
  });

  it("expires a pending sequence", () => {
    vi.useFakeTimers();
    const handlers = createHandlers();
    render(<Harness handlers={handlers} />);

    press(";", { code: "Semicolon", ctrlKey: true });
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_001));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
