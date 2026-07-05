export {
  SUGGESTION_CAPABILITIES,
  SUGGESTION_KINDS,
  isMindMapSuggestionKind,
  isMindMapSuggestion,
  isStructureSuggestion,
  isStructureSuggestionKind,
  isSuggestionKind,
  isTextSuggestion,
  isTextSuggestionKind,
  isVisualSuggestion,
  supportsSuggestionPreview,
  supportsWorkspacePlacement,
} from "./schema";
export type {
  MindMapSuggestion,
  StructureNode,
  StructureSuggestion,
  StructureSuggestionKind,
  SuggestionCapabilities,
  SuggestionItem,
  SuggestionKind,
  TextSuggestion,
  TextSuggestionKind,
} from "./schema";

import type { SuggestionItem } from "./schema";

export type SuggestionEvent =
  | { type: "suggestion.added"; item: SuggestionItem }
  | { type: "suggestion.updated"; item: SuggestionItem }
  | { type: "suggestion.retracted"; id: string }
  | { type: "suggestion.state.changed"; suggestionId: string; commandType: string };

export interface SuggestionFeed {
  subscribe(listener: (event: SuggestionEvent) => void): () => void;
}
