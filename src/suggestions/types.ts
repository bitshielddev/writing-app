export type SuggestionKind =
  | "snippet"
  | "fact"
  | "term"
  | "outline"
  | "layout"
  | "mindMap";

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
  kind: "snippet" | "fact" | "term";
  insertText: string;
};

export type StructureNode = {
  id: string;
  label: string;
  detail?: string;
  children?: StructureNode[];
};

export type StructureSuggestion = SuggestionBase & {
  kind: "outline" | "layout";
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

export type AgentStatus = "idle" | "working" | "offline";

export type SuggestionEvent =
  | { type: "suggestion.added"; item: SuggestionItem }
  | { type: "suggestion.updated"; item: SuggestionItem }
  | { type: "suggestion.retracted"; id: string }
  | { type: "agent.status"; status: AgentStatus }
  | { type: "agent.error"; message: string; recoverable: boolean };

export interface SuggestionFeed {
  subscribe(listener: (event: SuggestionEvent) => void): () => void;
}
