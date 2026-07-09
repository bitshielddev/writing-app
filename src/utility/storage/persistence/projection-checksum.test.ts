// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createEmptySuggestionState } from "../../../domain/suggestions/state";
import { suggestionProjectionChecksum } from "./projection-checksum";

describe("suggestion projection checksum", () => {
  it("produces a SHA-256 checksum for projection state and coverage", () => {
    expect(suggestionProjectionChecksum(createEmptySuggestionState(), 5)).toHaveLength(64);
  });
});
