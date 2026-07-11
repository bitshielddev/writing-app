/**
 * What: extracts visible text from BlockNote-ish inline content values.
 *
 * Why: agent document reads and renderer edit matching must share one text view.
 * Called when: storage exposes read-only document context and renderer validates edit anchors.
 */
export function plainTextFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(plainTextFromContent).join("");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if ("content" in record) return plainTextFromContent(record.content);
  }
  return "";
}

export function plainTextBlockFromUnknown(block: unknown, fallbackId = "block") {
  const record = block && typeof block === "object"
    ? block as Record<string, unknown>
    : {};
  const id = typeof record.id === "string" && record.id.trim() ? record.id : fallbackId;
  const type = typeof record.type === "string" && record.type.trim() ? record.type : "unknown";
  return {
    id,
    type,
    text: plainTextFromContent(record.content),
  };
}

export function plainTextBlocksFromBlocks(blocks: readonly unknown[]) {
  return blocks.map((block, index) => plainTextBlockFromUnknown(block, `block-${index}`));
}
