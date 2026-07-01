// @vitest-environment node

import { describe, expect, it } from "vitest";

import { ActivityRing, safeActivityPayload } from "./activity";

describe("agent activity ring", () => {
  it("aggregates streaming entries by ID", () => {
    const ring = new ActivityRing();
    ring.add({ id: "message:1", kind: "message", timestamp: 1, title: "Message", text: "a" });
    ring.add({ id: "message:1", kind: "message", timestamp: 2, title: "Message", text: "ab" });
    expect(ring.snapshot()).toHaveLength(1);
    expect(ring.snapshot()[0]).toMatchObject({ timestamp: 1, text: "ab" });
  });

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

  it("truncates payloads at 50 KB and evicts beyond 500 items", () => {
    const payload = safeActivityPayload({ body: "x".repeat(60 * 1024) });
    expect(payload).toMatchObject({ truncated: true });
    expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeLessThanOrEqual(50 * 1024);
    const ring = new ActivityRing();
    for (let index = 0; index < 505; index += 1) {
      ring.add({
        id: `item:${index}`,
        kind: "lifecycle",
        timestamp: index,
        title: String(index),
      });
    }
    expect(ring.snapshot()).toHaveLength(500);
    expect(ring.snapshot()[0]?.id).toBe("item:5");
  });
});
