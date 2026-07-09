import { describe, expect, it } from "vitest";

import { APP_COMMAND_IDS, COMMAND_CATALOG } from "./commands";
import { DEFAULT_KEYMAP } from "./defaultKeymap";
import { matchSequence } from "./sequenceMatcher";

describe("keybinding sequence matcher", () => {
  it("keeps command documentation and default bindings exhaustive", () => {
    expect(COMMAND_CATALOG.map(({ id }) => id).sort()).toEqual(
      [...APP_COMMAND_IDS].sort(),
    );
    expect(Object.keys(DEFAULT_KEYMAP).sort()).toEqual([...APP_COMMAND_IDS].sort());
  });

  it("distinguishes continuations, complete commands, and misses", () => {
    const initial = matchSequence([], DEFAULT_KEYMAP);
    expect(initial.status).toBe("partial");
    if (initial.status === "partial") {
      expect(initial.continuations.map(({ stroke }) => stroke)).toContain("j");
      expect(initial.continuations.map(({ stroke }) => stroke)).toContain("H");
    }

    expect(matchSequence(["j"], DEFAULT_KEYMAP)).toEqual({
      status: "exact",
      commandId: "suggestion.next",
    });
    expect(matchSequence(["d"], DEFAULT_KEYMAP)).toEqual({
      status: "partial",
      continuations: [
        { stroke: "d", commandIds: ["suggestion.dismiss"] },
      ],
    });
    expect(matchSequence(["d", "d"], DEFAULT_KEYMAP)).toEqual({
      status: "exact",
      commandId: "suggestion.dismiss",
    });
    expect(matchSequence(["x"], DEFAULT_KEYMAP)).toEqual({ status: "invalid" });
  });
});
