import { describe, expect, it } from "vitest";

import {
  classifyEventSequence,
  clampReplayLimit,
  nextAcknowledgedSequence,
} from "./sequence";

describe("event sequence policy", () => {
  it("classifies cursor progression and bounds replay requests", () => {
    expect(classifyEventSequence(3, 3)).toBe("duplicate");
    expect(classifyEventSequence(3, 4)).toBe("next");
    expect(classifyEventSequence(3, 6)).toBe("gap");
    expect(clampReplayLimit(0)).toBe(1);
    expect(clampReplayLimit(1_000)).toBe(100);
    expect(nextAcknowledgedSequence(4, 3, 8)).toBe(4);
    expect(() => nextAcknowledgedSequence(4, 9, 8))
      .toThrow("ACKNOWLEDGEMENT_PAST_STREAM_HEAD");
  });
});
