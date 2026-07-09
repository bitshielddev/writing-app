export type EventCursorDecision = "duplicate" | "next" | "gap";

export function classifyEventSequence(
  observedSequence: number,
  incomingSequence: number,
): EventCursorDecision {
  if (incomingSequence <= observedSequence) return "duplicate";
  if (incomingSequence === observedSequence + 1) return "next";
  return "gap";
}

export function clampReplayLimit(requested: number | undefined, maximum = 100) {
  return Math.max(1, Math.min(maximum, requested ?? maximum));
}

export function nextAcknowledgedSequence(current: number, requested: number, head: number) {
  if (requested > head) throw new Error("ACKNOWLEDGEMENT_PAST_STREAM_HEAD");
  return Math.max(current, requested);
}
