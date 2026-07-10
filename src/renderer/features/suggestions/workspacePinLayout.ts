import type { WorkspacePinRect } from "../../../domain/suggestions/state";
import {
  SUGGESTION_CAPABILITIES,
  type SuggestionItem,
} from "../../../domain/suggestions/schema";

/**
 * What: reads initial workspace pin size for callers that need the derived value.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by DocumentEditor and useWorkspaceController when that path needs this behavior.
 */
export function getInitialWorkspacePinSize(
  item: SuggestionItem,
): Pick<WorkspacePinRect, "width" | "height"> {
  return SUGGESTION_CAPABILITIES[item.kind].initialWorkspaceSize;
}
