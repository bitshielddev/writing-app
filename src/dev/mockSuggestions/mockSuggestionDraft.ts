import type {
  SuggestionItem,
  SuggestionKind,
} from "../../suggestions/types";
import { isStructureNodes } from "./mockSuggestionValidation";

export type MockSuggestionDraft = {
  kind: SuggestionKind;
  title: string;
  summary: string;
  body: string;
  sourceLabels: string;
  insertText?: string;
  nodes?: string;
  mermaidSource?: string;
  accessibleDescription?: string;
};

type GeneratedMetadata = {
  id: string;
  createdAt: number;
};

function required(value: string | undefined, label: string) {
  const cleanValue = value?.trim();
  if (!cleanValue) {
    throw new Error(`${label} is required.`);
  }
  return cleanValue;
}

function defaultMetadata(): GeneratedMetadata {
  const token =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { id: `mock-${token}`, createdAt: Date.now() };
}

export function buildMockSuggestion(
  draft: MockSuggestionDraft,
  metadata: GeneratedMetadata = defaultMetadata(),
): SuggestionItem {
  const common = {
    id: metadata.id,
    dedupeKey: metadata.id,
    title: required(draft.title, "Title"),
    summary: required(draft.summary, "Summary"),
    body: required(draft.body, "Body"),
    sourceLabels: draft.sourceLabels
      .split(/\r?\n/)
      .map((label) => label.trim())
      .filter(Boolean),
    createdAt: metadata.createdAt,
  };

  if (
    draft.kind === "snippet" ||
    draft.kind === "fact" ||
    draft.kind === "term"
  ) {
    return {
      ...common,
      kind: draft.kind,
      insertText: required(draft.insertText, "Insert text"),
    };
  }

  if (draft.kind === "outline" || draft.kind === "layout") {
    let nodes: unknown;
    try {
      nodes = JSON.parse(required(draft.nodes, "Nodes JSON"));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Nodes must be valid JSON.", { cause: error });
      }
      throw error;
    }

    if (!isStructureNodes(nodes)) {
      throw new Error(
        "Nodes must be a non-empty array with string id and label fields; detail is optional and children must use the same shape.",
      );
    }

    return { ...common, kind: draft.kind, nodes };
  }

  return {
    ...common,
    kind: "mindMap",
    mermaidSource: required(draft.mermaidSource, "Mermaid source"),
    accessibleDescription: required(
      draft.accessibleDescription,
      "Accessible description",
    ),
  };
}
