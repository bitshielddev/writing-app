import { createHash } from "node:crypto";

import type { PersistedSuggestionState } from "../../src/suggestions/state.js";
import { SUGGESTION_PROJECTION_VERSION } from "../domain/suggestion-persistence.js";

export function suggestionProjectionChecksum(state: PersistedSuggestionState, coverage: number) {
  return createHash("sha256").update(JSON.stringify({ version: SUGGESTION_PROJECTION_VERSION,
    coverage, state })).digest("hex");
}
