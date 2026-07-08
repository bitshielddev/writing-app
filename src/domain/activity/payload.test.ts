import { describe, expect, it } from "vitest";

import { safeActivityPayload } from "./payload";

describe("activity payload redaction", () => {
  it("redacts credential and header fields recursively", () => {
    expect(safeActivityPayload({
      authorization: "Bearer secret",
      nested: { apiKey: "key", safe: "visible" },
      headers: { "x-request-id": "also hidden" },
    })).toEqual({
      authorization: "[redacted]",
      nested: { apiKey: "[redacted]", safe: "visible" },
      headers: "[redacted]",
    });
  });

  it("truncates serialized payloads at 50 KB", () => {
    const payload = safeActivityPayload({ body: "x".repeat(60 * 1024) });
    expect(payload).toMatchObject({ truncated: true });
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength)
      .toBeLessThanOrEqual(50 * 1024);
  });
});
