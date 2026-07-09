import type { WorkspacePinRect } from "../../../domain/suggestions/state";
import {
  SUGGESTION_CAPABILITIES,
  type SuggestionItem,
} from "../../../domain/suggestions/schema";

export function getInitialWorkspacePinSize(
  item: SuggestionItem,
): Pick<WorkspacePinRect, "width" | "height"> {
  return SUGGESTION_CAPABILITIES[item.kind].initialWorkspaceSize;
}
