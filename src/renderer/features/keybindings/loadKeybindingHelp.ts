let helpModule: Promise<typeof import("./KeybindingHelpDialog")> | undefined;

/**
 * What: loads keybinding help before it is needed interactively.
 *
 * Why: keyboard workflows need shared sequence and command behavior across the UI.
 * Called when: used by preloadKeybindingHelp and KeybindingHelpBoundary when that path needs this behavior.
 */
export function loadKeybindingHelp() {
  helpModule ??= import("./KeybindingHelpDialog");
  return helpModule;
}

/**
 * What: performs the preload keybinding help step for this file's workflow.
 *
 * Why: keyboard workflows need shared sequence and command behavior across the UI.
 * Called when: used by DocumentEditor when that path needs this behavior.
 */
export function preloadKeybindingHelp() {
  void loadKeybindingHelp();
}
