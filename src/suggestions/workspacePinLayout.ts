import type { WorkspacePinRect } from "./state";
import {
  SUGGESTION_CAPABILITIES,
  type SuggestionItem,
} from "./types";

export function getInitialWorkspacePinSize(
  item: SuggestionItem,
): Pick<WorkspacePinRect, "width" | "height"> {
  return SUGGESTION_CAPABILITIES[item.kind].initialWorkspaceSize;
}
