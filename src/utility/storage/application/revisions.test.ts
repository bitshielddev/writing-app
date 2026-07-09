import { describe, expect, it } from "vitest";

import {
  DOCUMENT_REVISION_CONFLICT,
  assertDocumentRevision,
  revisionsMatch,
} from "./revisions";

describe("desktop domain policies", () => {
  it("compares revisions without infrastructure", () => {
    expect(revisionsMatch(2, 2)).toBe(true);
    expect(revisionsMatch(1.5, 1.5)).toBe(false);
    expect(() => assertDocumentRevision(1, 2)).toThrow(DOCUMENT_REVISION_CONFLICT);
  });
});
