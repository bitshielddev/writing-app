import { useCallback, useMemo, useState } from "react";

import type { WritingEditor } from "../editor/schema";
import type { InboxEntry, PinnedInboxEntry } from "../suggestions/inbox";
import type { SuggestionKeyboardNavigationController } from "../suggestions/keyboardNavigation";
import { isTextSuggestion, type SuggestionItem } from "../suggestions/types";
import type { WorkspaceLayoutController } from "../workspace/useWorkspaceLayout";
import {
  executed,
  unavailable,
  type CommandHandlers,
  type CommandResult,
} from "./commands";
import { useKeybindingController } from "./useKeybindingController";

type WorkspaceKeybindingOptions = {
  editor: WritingEditor;
  layout: WorkspaceLayoutController;
  navigator: SuggestionKeyboardNavigationController;
  pinnedEntries: PinnedInboxEntry[];
  selectedEntry?: InboxEntry;
  activePreviewId?: string;
  setPartnerView: (view: "suggestions" | "activity") => void;
  onSelect: (id: string) => void;
  onBack: () => void;
  onDismiss: (id: string) => void;
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
  onPreview: (item: SuggestionItem) => void;
};

export function useWorkspaceKeybindings({
  editor,
  layout,
  navigator,
  pinnedEntries,
  selectedEntry,
  activePreviewId,
  setPartnerView,
  onSelect,
  onBack,
  onDismiss,
  onPin,
  onUnpin,
  onPreview,
}: WorkspaceKeybindingOptions) {
  const [helpOpen, setHelpOpen] = useState(false);

  const focusEditor = useCallback(() => {
    layout.closeDrawers();
    window.requestAnimationFrame(() => editor.focus());
  }, [editor, layout]);

  const focusRegion = useCallback(
    (side: "navigation" | "context") => {
      if (side === "navigation") layout.openNavigation();
      else layout.openContext();

      if (layout.isDesktop()) {
        window.requestAnimationFrame(() => {
          const region =
            side === "navigation"
              ? layout.navigationRegionRef.current
              : layout.contextRegionRef.current;
          region?.focus();
        });
      }
      return executed();
    },
    [layout],
  );

  const moveSuggestion = useCallback(
    (direction: -1 | 1): CommandResult => {
      setPartnerView("suggestions");
      layout.openContext();
      const result = navigator.move(direction);
      if (result.status === "empty") return unavailable("No suggestions available");
      if (result.status === "boundary") {
        return unavailable(
          result.edge === "first"
            ? "Already at the first suggestion"
            : "Already at the last suggestion",
        );
      }
      return executed();
    },
    [layout, navigator, setPartnerView],
  );

  const targetEntry = navigator.targetEntry;
  const handlers = useMemo<CommandHandlers>(
    () => ({
      "help.open": () => {
        layout.closeDrawers();
        setHelpOpen(true);
        return executed();
      },
      "region.navigation.focus": () => focusRegion("navigation"),
      "region.partner.focus": () => focusRegion("context"),
      "region.editor.focus": () => {
        focusEditor();
        return executed();
      },
      "region.navigation.toggle": () => {
        const closing = layout.isDesktop()
          ? layout.navigationPanelOpen
          : layout.navigationDrawerOpen;
        layout.toggleNavigation();
        if (closing) focusEditor();
        return executed();
      },
      "region.partner.toggle": () => {
        const closing = layout.isDesktop()
          ? layout.contextPanelOpen
          : layout.contextDrawerOpen;
        layout.toggleContext();
        if (closing) focusEditor();
        return executed();
      },
      "suggestion.next": () => moveSuggestion(1),
      "suggestion.previous": () => moveSuggestion(-1),
      "suggestion.open": () => {
        if (!targetEntry) return unavailable("No suggestion selected");
        setPartnerView("suggestions");
        layout.openContext();
        navigator.setTargetId(targetEntry.item.id);
        onSelect(targetEntry.item.id);
        return executed();
      },
      "suggestion.back": () => {
        if (!selectedEntry) return unavailable("Suggestion detail is not open");
        onBack();
        return executed();
      },
      "suggestion.pin.toggle": () => {
        if (!targetEntry) return unavailable("No suggestion selected");
        const id = targetEntry.item.id;
        if (pinnedEntries.some((entry) => entry.item.id === id)) onUnpin(id);
        else onPin(id);
        navigator.setTargetId(id);
        return executed();
      },
      "suggestion.preview": () => {
        if (!targetEntry) return unavailable("No suggestion selected");
        if (!isTextSuggestion(targetEntry.item)) {
          return unavailable("This suggestion cannot be previewed in the document");
        }
        if (targetEntry.withdrawn) {
          return unavailable("This suggestion was withdrawn");
        }
        if (activePreviewId) return unavailable("Finish the active preview first");
        onPreview(targetEntry.item);
        return executed();
      },
      "suggestion.dismiss": () => {
        if (!targetEntry) return unavailable("No suggestion selected");
        const id = targetEntry.item.id;
        if (activePreviewId === id) {
          return unavailable("Finish this suggestion's preview first");
        }
        const neighborId = navigator.neighborAfterRemoval(id);
        const keepDetailOpen = selectedEntry?.item.id === id && Boolean(neighborId);
        onDismiss(id);
        navigator.setTargetId(neighborId);
        if (keepDetailOpen && neighborId) onSelect(neighborId);
        return executed();
      },
    }),
    [
      activePreviewId,
      focusEditor,
      focusRegion,
      layout,
      moveSuggestion,
      navigator,
      onBack,
      onDismiss,
      onPin,
      onPreview,
      onSelect,
      onUnpin,
      pinnedEntries,
      selectedEntry,
      setPartnerView,
      targetEntry,
    ],
  );

  const controller = useKeybindingController({
    disabled: helpOpen,
    handlers,
  });
  const cancelSequence = controller.cancelSequence;
  const openHelp = useCallback(() => {
    layout.closeDrawers();
    cancelSequence();
    setHelpOpen(true);
  }, [cancelSequence, layout]);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  return {
    helpOpen,
    openHelp,
    closeHelp,
    stripState: helpOpen ? undefined : controller.stripState,
  };
}
