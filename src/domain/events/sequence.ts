export type EventCursorDecision = "duplicate" | "next" | "gap";

/**
 * What: classifies a requested durable event sequence relative to the known event head.
 *
 * Why: durable event replay and acknowledgement need consistent sequencing rules.
 * Called when: used by sequence and index when that path needs this behavior.
 */
export function classifyEventSequence(
  observedSequence: number,
  incomingSequence: number,
): EventCursorDecision {
  if (incomingSequence <= observedSequence) return "duplicate";
  if (incomingSequence === observedSequence + 1) return "next";
  return "gap";
}

/**
 * What: clamps replay limits to the range the durable event store supports.
 *
 * Why: durable event replay and acknowledgement need consistent sequencing rules.
 * Called when: used by sequence, outbox and replay when that path needs this behavior.
 */
export function clampReplayLimit(requested: number | undefined, maximum = 100) {
  return Math.max(1, Math.min(maximum, requested ?? maximum));
}

/**
 * What: calculates the acknowledgement sequence that should follow a replay batch.
 *
 * Why: durable event replay and acknowledgement need consistent sequencing rules.
 * Called when: used by sequence, outbox and acknowledge when that path needs this behavior.
 */
export function nextAcknowledgedSequence(current: number, requested: number, head: number) {
  if (requested > head) throw new Error("ACKNOWLEDGEMENT_PAST_STREAM_HEAD");
  return Math.max(current, requested);
}
