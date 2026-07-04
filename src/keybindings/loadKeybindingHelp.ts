let helpModule: Promise<typeof import("./KeybindingHelpDialog")> | undefined;

export function loadKeybindingHelp() {
  helpModule ??= import("./KeybindingHelpDialog");
  return helpModule;
}

export function preloadKeybindingHelp() {
  void loadKeybindingHelp();
}
