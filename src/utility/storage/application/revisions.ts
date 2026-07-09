export const DOCUMENT_REVISION_CONFLICT = "DOCUMENT_REVISION_CONFLICT";
export const STALE_SUGGESTION_REVISION = "STALE_SUGGESTION_REVISION";

export function revisionsMatch(expected: number, actual: number) {
  return Number.isInteger(expected) && expected === actual;
}

export function assertDocumentRevision(expected: number, actual: number) {
  if (!revisionsMatch(expected, actual)) throw new Error(DOCUMENT_REVISION_CONFLICT);
}

export function assertSuggestionDocumentRevision(expected: number, actual: number) {
  if (!revisionsMatch(expected, actual)) throw new Error(STALE_SUGGESTION_REVISION);
}
