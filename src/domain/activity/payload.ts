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
