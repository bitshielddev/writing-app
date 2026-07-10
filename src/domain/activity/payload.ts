const MAX_PAYLOAD_BYTES = 50 * 1024;
const REDACTED = "[redacted]";
const SENSITIVE_KEY = /(?:api[-_]?key|authorization|cookie|credentials?|password|secret|(?:access|refresh|id)[-_]?token|bearer|headers?)/i;

/**
 * What: redacts nested payload data that should not be logged or shown directly.
 *
 * Why: agent activity payloads need to be safe before they cross process or UI boundaries.
 * Called when: used by safeActivityPayload when that path needs this behavior.
 */
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

/**
 * What: converts arbitrary agent activity payloads into a UI-safe value.
 *
 * Why: agent activity payloads need to be safe before they cross process or UI boundaries.
 * Called when: used by payload, activity, add and index when that path needs this behavior.
 */
export function safeActivityPayload(payload: unknown): unknown {
  const redacted = redact(payload);
  let serialized: string;
  try {
    serialized = JSON.stringify(redacted);
  } catch {
    return "[unserializable payload]";
  }
  const bytes = new TextEncoder().encode(serialized);
  if (bytes.byteLength <= MAX_PAYLOAD_BYTES) {
    return JSON.parse(serialized) as unknown;
  }
  return {
    truncated: true,
    preview: new TextDecoder().decode(
      bytes.subarray(0, Math.floor(MAX_PAYLOAD_BYTES / 2)),
    ),
  };
}
