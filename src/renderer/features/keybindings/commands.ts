export const APP_COMMAND_IDS = [
  "help.open",
  "region.navigation.focus",
  "region.partner.focus",
  "region.editor.focus",
  "region.navigation.toggle",
  "region.partner.toggle",
  "suggestion.next",
  "suggestion.previous",
  "suggestion.open",
  "suggestion.back",
  "suggestion.pin.toggle",
  "suggestion.preview",
  "suggestion.accept",
  "suggestion.dismiss",
] as const;

export type AppCommandId = (typeof APP_COMMAND_IDS)[number];
export type KeyStroke = string;
export type KeySequence = readonly KeyStroke[];

export type CommandResult =
  | { status: "executed" }
  | { status: "unavailable"; message: string };

export type CommandHandlers = Record<AppCommandId, () => CommandResult>;

export type CommandDefinition = {
  id: AppCommandId;
  group: "Workspace" | "Suggestions" | "Help";
  label: string;
  description: string;
};

export const COMMAND_CATALOG = [
  {
    id: "region.navigation.focus",
    group: "Workspace",
    label: "Focus project navigation",
    description: "Reveal the left region and move focus to it.",
  },
  {
    id: "region.partner.focus",
    group: "Workspace",
    label: "Focus writing partner",
    description: "Reveal the right region and move focus to it.",
  },
  {
    id: "region.editor.focus",
    group: "Workspace",
    label: "Focus editor",
    description: "Close responsive drawers and return to the draft.",
  },
  {
    id: "region.navigation.toggle",
    group: "Workspace",
    label: "Toggle project navigation",
    description: "Show or hide the left panel or drawer.",
  },
  {
    id: "region.partner.toggle",
    group: "Workspace",
    label: "Toggle writing partner",
    description: "Show or hide the right panel or drawer.",
  },
  {
    id: "suggestion.next",
    group: "Suggestions",
    label: "Next suggestion",
    description: "Move down through Pins, then the live inbox.",
  },
  {
    id: "suggestion.previous",
    group: "Suggestions",
    label: "Previous suggestion",
    description: "Move up through Pins, then the live inbox.",
  },
  {
    id: "suggestion.open",
    group: "Suggestions",
    label: "Open suggestion",
    description: "Open the currently targeted suggestion.",
  },
  {
    id: "suggestion.back",
    group: "Suggestions",
    label: "Back to suggestions",
    description: "Leave suggestion detail and return to the queue.",
  },
  {
    id: "suggestion.pin.toggle",
    group: "Suggestions",
    label: "Pin or unpin suggestion",
    description: "Move the target into or out of Pins.",
  },
  {
    id: "suggestion.preview",
    group: "Suggestions",
    label: "Preview source",
    description: "Focus the current source text for an eligible edit.",
  },
  {
    id: "suggestion.accept",
    group: "Suggestions",
    label: "Accept edit",
    description: "Apply the currently targeted edit to the draft.",
  },
  {
    id: "suggestion.dismiss",
    group: "Suggestions",
    label: "Dismiss suggestion",
    description: "Press d twice to remove the target.",
  },
  {
    id: "help.open",
    group: "Help",
    label: "Show keyboard shortcuts",
    description: "Open this complete shortcut reference.",
  },
] as const satisfies readonly CommandDefinition[];

export const COMMANDS_BY_ID = Object.fromEntries(
  COMMAND_CATALOG.map((command) => [command.id, command]),
) as Record<AppCommandId, CommandDefinition>;

/**
 * What: performs the executed step for this file's workflow.
 *
 * Why: keyboard workflows need shared sequence and command behavior across the UI.
 * Called when: used by useWorkspaceKeybindings, useKeybindingController and createHandlers when that path needs this behavior.
 */
export const executed = (): CommandResult => ({ status: "executed" });
/**
 * What: performs the unavailable step for this file's workflow.
 *
 * Why: keyboard workflows need shared sequence and command behavior across the UI.
 * Called when: used by useWorkspaceKeybindings when that path needs this behavior.
 */
export const unavailable = (message: string): CommandResult => ({
  status: "unavailable",
  message,
});
