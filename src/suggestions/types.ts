export const SUGGESTION_KINDS = [
  "snippet",
  "fact",
  "term",
  "outline",
  "layout",
  "mindMap",
] as const;
export const TEXT_SUGGESTION_KINDS = ["snippet", "fact", "term"] as const;
export const STRUCTURE_SUGGESTION_KINDS = ["outline", "layout"] as const;

export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export type TextSuggestionKind = (typeof TEXT_SUGGESTION_KINDS)[number];
export type StructureSuggestionKind =
  (typeof STRUCTURE_SUGGESTION_KINDS)[number];

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function isSuggestionKind(value: unknown): value is SuggestionKind {
  return includes(SUGGESTION_KINDS, value);
}

export function isTextSuggestionKind(value: unknown): value is TextSuggestionKind {
  return includes(TEXT_SUGGESTION_KINDS, value);
}

export function isStructureSuggestionKind(
  value: unknown,
): value is StructureSuggestionKind {
  return includes(STRUCTURE_SUGGESTION_KINDS, value);
}

type SuggestionBase = {
  id: string;
  dedupeKey: string;
  kind: SuggestionKind;
  title: string;
  summary: string;
  body: string;
  sourceLabels: string[];
  createdAt: number;
};

export type TextSuggestion = SuggestionBase & {
  kind: TextSuggestionKind;
  insertText: string;
};

export type StructureNode = {
  id: string;
  label: string;
  detail?: string;
  children?: StructureNode[];
};

export type StructureSuggestion = SuggestionBase & {
  kind: StructureSuggestionKind;
  nodes: StructureNode[];
};

export type MindMapSuggestion = SuggestionBase & {
  kind: "mindMap";
  mermaidSource: string;
  accessibleDescription: string;
};

export type SuggestionItem =
  | TextSuggestion
  | StructureSuggestion
  | MindMapSuggestion;

export function isTextSuggestion(item: SuggestionItem): item is TextSuggestion {
  return isTextSuggestionKind(item.kind);
}

export function isStructureSuggestion(
  item: SuggestionItem,
): item is StructureSuggestion {
  return isStructureSuggestionKind(item.kind);
}

export function isMindMapSuggestion(
  item: SuggestionItem,
): item is MindMapSuggestion {
  return item.kind === "mindMap";
}

export function isVisualSuggestion(
  item: SuggestionItem,
): item is StructureSuggestion | MindMapSuggestion {
  return isStructureSuggestion(item) || isMindMapSuggestion(item);
}

export type SuggestionEvent =
  | { type: "suggestion.added"; item: SuggestionItem }
  | { type: "suggestion.updated"; item: SuggestionItem }
  | { type: "suggestion.retracted"; id: string };

export interface SuggestionFeed {
  subscribe(listener: (event: SuggestionEvent) => void): () => void;
}
