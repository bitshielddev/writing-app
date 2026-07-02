import {
  isStructureSuggestionKind,
  isTextSuggestionKind,
  type StructureNode,
  type SuggestionItem,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStructureNode(value: unknown): value is StructureNode {
  if (!isRecord(value)) return false;

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.label) &&
    (value.detail === undefined || typeof value.detail === "string") &&
    (value.children === undefined ||
      (Array.isArray(value.children) && value.children.every(isStructureNode)))
  );
}

export function isStructureNodes(value: unknown): value is StructureNode[] {
  return Array.isArray(value) && value.length > 0 && value.every(isStructureNode);
}

export function isSuggestionItem(value: unknown): value is SuggestionItem {
  if (!isRecord(value)) return false;

  const hasCommonFields =
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.dedupeKey) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.summary) &&
    isNonEmptyString(value.body) &&
    Array.isArray(value.sourceLabels) &&
    value.sourceLabels.every((label) => typeof label === "string") &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt);

  if (!hasCommonFields) return false;

  if (isTextSuggestionKind(value.kind)) {
    return isNonEmptyString(value.insertText);
  }

  if (isStructureSuggestionKind(value.kind)) {
    return isStructureNodes(value.nodes);
  }

  if (value.kind === "mindMap") {
    return (
      isNonEmptyString(value.mermaidSource) &&
      isNonEmptyString(value.accessibleDescription)
    );
  }

  return false;
}
