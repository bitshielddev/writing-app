import type { SuggestionItem } from "./schema.js";

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

export function suggestionContentDedupeKey(item: SuggestionItem): string {
  const fields = [item.kind, item.title, item.summary, item.body];
  if (item.kind === "edit") fields.push(item.sourceText, item.newText);
  if (item.kind === "diagram") {
    fields.push(item.mermaidSource, item.accessibleDescription);
  }
  return `content:${item.kind}:${hashText(fields.map(normalizeText).join("\n"))}`;
}

export function suggestionDedupeKeys(item: SuggestionItem): string[] {
  return [item.dedupeKey, suggestionContentDedupeKey(item)];
}
