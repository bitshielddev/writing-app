export const DOCUMENT_REVISION_CONFLICT = "DOCUMENT_REVISION_CONFLICT";
export const STALE_SUGGESTION_REVISION = "STALE_SUGGESTION_REVISION";

/**
 * What: performs the revisions match step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by assertDocumentRevision, assertSuggestionDocumentRevision and revisions when that path needs this behavior.
 */
export function revisionsMatch(expected: number, actual: number) {
  return Number.isInteger(expected) && expected === actual;
}

/**
 * What: checks document revision and throws before invalid state crosses the boundary.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by operations, performDocumentSave and revisions when that path needs this behavior.
 */
export function assertDocumentRevision(expected: number, actual: number) {
  if (!revisionsMatch(expected, actual)) throw new Error(DOCUMENT_REVISION_CONFLICT);
}

/**
 * What: checks suggestion document revision and throws before invalid state crosses the boundary.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by operations and assertCurrentRevision when that path needs this behavior.
 */
export function assertSuggestionDocumentRevision(expected: number, actual: number) {
  if (!revisionsMatch(expected, actual)) throw new Error(STALE_SUGGESTION_REVISION);
}
