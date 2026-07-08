import type { AgentActivity } from "../src/contracts/desktop-bridge.js";

const MAX_ITEMS = 500;
const MAX_PAYLOAD_BYTES = 50 * 1024;
const REDACTED = "[redacted]";
const SENSITIVE_KEY = /(?:api[-_]?key|authorization|cookie|credentials?|password|secret|(?:access|refresh|id)[-_]?token|bearer|headers?)/i;

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redact(item, seen),
    ]),
  );
}

export function safeActivityPayload(payload: unknown): unknown {
  const redacted = redact(payload);
  let serialized: string;
  try {
    serialized = JSON.stringify(redacted);
  } catch {
    return "[unserializable payload]";
  }
  if (Buffer.byteLength(serialized, "utf8") <= MAX_PAYLOAD_BYTES) {
    return JSON.parse(serialized) as unknown;
  }
  return {
    truncated: true,
    preview: Buffer.from(serialized, "utf8")
      .subarray(0, Math.floor(MAX_PAYLOAD_BYTES / 2))
      .toString("utf8"),
  };
}

export class ActivityRing {
  private items: AgentActivity[] = [];

  add(input: Omit<AgentActivity, "updatedAt" | "payload"> & { payload?: unknown }) {
    const activity: AgentActivity = {
      ...input,
      updatedAt: Date.now(),
      ...(input.payload === undefined ? {} : { payload: safeActivityPayload(input.payload) }),
    };
    const existing = this.items.findIndex((item) => item.id === activity.id);
    if (existing >= 0) {
      this.items[existing] = {
        ...this.items[existing],
        ...activity,
        timestamp: this.items[existing].timestamp,
      };
    } else {
      this.items.push(activity);
      if (this.items.length > MAX_ITEMS) this.items.splice(0, this.items.length - MAX_ITEMS);
    }
    return existing >= 0 ? this.items[existing] : this.items.at(-1)!;
  }

  snapshot() {
    return this.items.map((item) => ({ ...item }));
  }
}
