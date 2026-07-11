/**
 * What: converts editor-owned document blocks into JSON-compatible data.
 *
 * Why: BlockNote may keep undefined or other non-JSON metadata on live block
 * objects, while IPC and persistence intentionally accept only JSON values.
 * Called when: used by autosave before crossing the preload boundary.
 */
export function toJsonCompatibleDocumentBlocks(blocks: readonly unknown[]) {
  const seen = new WeakSet<object>();
  return blocks.map((block) => toJsonCompatibleValue(block, seen));
}

/**
 * What: converts an arbitrary value into the subset accepted by JSON contracts.
 *
 * Why: mirroring JSON serialization keeps durable document snapshots portable
 * without weakening validation at process boundaries.
 */
function toJsonCompatibleValue(
  value: unknown,
  seen: WeakSet<object>,
): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const next = toJsonCompatibleValue(item, seen);
      return next === undefined ? null : next;
    });
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const record: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, entry]) => {
      const next = toJsonCompatibleValue(entry, seen);
      if (next !== undefined) record[key] = next;
    });
    seen.delete(value);
    return record;
  }
  return undefined;
}
