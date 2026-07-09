import type { AppCommandId, KeySequence, KeyStroke } from "./commands";

export type Keymap = Readonly<Record<AppCommandId, KeySequence>>;

export const DEFAULT_KEYMAP = {
  "help.open": ["?"],
  "region.navigation.focus": ["h"],
  "region.partner.focus": ["l"],
  "region.editor.focus": ["i"],
  "region.navigation.toggle": ["H"],
  "region.partner.toggle": ["L"],
  "suggestion.next": ["j"],
  "suggestion.previous": ["k"],
  "suggestion.open": ["Enter"],
  "suggestion.back": ["b"],
  "suggestion.pin.toggle": ["p"],
  "suggestion.preview": ["v"],
  "suggestion.dismiss": ["d", "d"],
} as const satisfies Keymap;

export function formatStroke(stroke: KeyStroke) {
  return stroke === "Enter" ? "Enter" : stroke;
}

export function formatSequence(sequence: KeySequence) {
  return ["Ctrl", ";", ...sequence.map(formatStroke)];
}
