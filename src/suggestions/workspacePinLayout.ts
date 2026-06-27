import type { WorkspacePinRect } from "./inbox";
import type { SuggestionItem } from "./types";

export function getInitialWorkspacePinSize(
  item: SuggestionItem,
): Pick<WorkspacePinRect, "width" | "height"> {
  if (item.kind === "mindMap") {
    return { width: 460, height: 340 };
  }
  if (item.kind === "outline" || item.kind === "layout") {
    return { width: 380, height: 300 };
  }
  return { width: 320, height: 240 };
}
