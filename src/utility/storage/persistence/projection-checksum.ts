import { createHash } from "node:crypto";

import type { PersistedSuggestionState } from "../../../domain/suggestions/state.js";
import { SUGGESTION_PROJECTION_VERSION } from "../../../domain/suggestions/aggregate.js";

/**
 * What: performs the suggestion projection checksum step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by bootstrap, bootstrapWorkspace, documents and create when that path needs this behavior.
 */
export function suggestionProjectionChecksum(state: PersistedSuggestionState, coverage: number) {
  return createHash("sha256").update(JSON.stringify({ version: SUGGESTION_PROJECTION_VERSION,
    coverage, state })).digest("hex");
}
