import type { AppCommandId, KeySequence, KeyStroke } from "./commands";
import type { Keymap } from "./defaultKeymap";

export type SequenceContinuation = {
  stroke: KeyStroke;
  commandIds: AppCommandId[];
};

export type SequenceMatch =
  | { status: "partial"; continuations: SequenceContinuation[] }
  | { status: "exact"; commandId: AppCommandId }
  | { status: "invalid" };

/**
 * What: returns whether the supplied value matches prefix.
 *
 * Why: keyboard workflows need shared sequence and command behavior across the UI.
 * Called when: used by matchSequence when that path needs this behavior.
 */
function isPrefix(prefix: KeySequence, sequence: KeySequence) {
  return prefix.every((stroke, index) => sequence[index] === stroke);
}

/**
 * What: performs the match sequence step for this file's workflow.
 *
 * Why: keyboard workflows need shared sequence and command behavior across the UI.
 * Called when: used by useKeybindingController, handleKeyDown and sequenceMatcher when that path needs this behavior.
 */
export function matchSequence(
  strokes: KeySequence,
  keymap: Keymap,
): SequenceMatch {
  const matches = Object.entries(keymap).filter(([, sequence]) =>
    isPrefix(strokes, sequence),
  ) as [AppCommandId, KeySequence][];

  if (!matches.length) return { status: "invalid" };

  const exact = matches.find(([, sequence]) => sequence.length === strokes.length);
  if (exact) return { status: "exact", commandId: exact[0] };

  const byStroke = new Map<KeyStroke, AppCommandId[]>();
  for (const [commandId, sequence] of matches) {
    const nextStroke = sequence[strokes.length];
    if (!nextStroke) continue;
    byStroke.set(nextStroke, [...(byStroke.get(nextStroke) ?? []), commandId]);
  }

  return {
    status: "partial",
    continuations: [...byStroke].map(([stroke, commandIds]) => ({
      stroke,
      commandIds,
    })),
  };
}
