import type { PersistedSuggestionState } from "./state.js";
import type { SuggestionItem } from "./schema.js";
import {
  applySuggestionAgentEvent,
  applySuggestionCommand,
  type DurableSuggestionCommand,
} from "./transitions.js";

export const SUGGESTION_COMMAND_VERSION = 1 as const;
export const SUGGESTION_EVENT_VERSION = 1 as const;
export const SUGGESTION_PROJECTION_VERSION = 1 as const;

export type SuggestionActor = {
  type: "writer" | "agent" | "system";
  id?: string;
};

export type SuggestionIntent = DurableSuggestionCommand
  | { type: "publish"; item: SuggestionItem }
  | { type: "update"; item: SuggestionItem }
  | { type: "retract"; suggestionId: string };

export type SuggestionCommandEnvelope = {
  commandId: string;
  projectId: string;
  documentId: string;
  actor: SuggestionActor;
  version: typeof SUGGESTION_COMMAND_VERSION;
  command: SuggestionIntent;
  expectedSuggestionRevision: number;
  expectedDocumentRevision?: number;
  requestedAt: number;
};

export type SuggestionFact =
  | { type: "suggestion.projectionImported"; version: 1; state: PersistedSuggestionState }
  | { type: "suggestion.published"; version: 1; item: SuggestionItem }
  | { type: "suggestion.updated"; version: 1; item: SuggestionItem }
  | { type: "suggestion.retracted"; version: 1; suggestionId: string }
  | { type: "suggestion.viewed"; version: 1; suggestionId: string }
  | { type: "suggestion.dismissed"; version: 1; suggestionId: string }
  | { type: "suggestion.pinned"; version: 1; suggestionId: string; pinnedAt: number }
  | { type: "suggestion.unpinned"; version: 1; suggestionId: string }
  | { type: "suggestion.workspacePlaced"; version: 1; suggestionId: string; rect: Rect }
  | { type: "suggestion.workspaceReturned"; version: 1; suggestionId: string }
  | { type: "suggestion.workspaceMoved"; version: 1; suggestionId: string; rect: Rect }
  | { type: "suggestion.workspaceRaised"; version: 1; suggestionId: string }
  | { type: "suggestion.previewAccepted"; version: 1; suggestionId: string }
  | { type: "suggestion.previewCancelled"; version: 1; suggestionId: string };

type Rect = { x: number; y: number; width: number; height: number };

export type SequencedSuggestionFact = {
  eventId: string;
  sequence: number;
  commandId: string;
  actor: SuggestionActor;
  occurredAt: number;
  fact: SuggestionFact;
};

export type SuggestionProjectionView = {
  state: PersistedSuggestionState;
  revision: number;
  coveredThroughSequence: number;
};

export type AggregateDecision =
  | { status: "changed"; facts: SuggestionFact[] }
  | { status: "unchanged"; facts: [] }
  | { status: "rejected"; facts: []; reason: string };

/** Pure aggregate: validates intent against current state and emits facts only. */
export function decideSuggestionCommand(
  current: PersistedSuggestionState,
  command: SuggestionIntent,
): AggregateDecision {
  if (command.type === "publish" || command.type === "update" || command.type === "retract") {
    const event = command.type === "publish"
      ? { type: "suggestion.added" as const, item: command.item }
      : command.type === "update"
        ? { type: "suggestion.updated" as const, item: command.item }
        : { type: "suggestion.retracted" as const, id: command.suggestionId };
    const transition = applySuggestionAgentEvent(current, event);
    if (transition.status !== "changed") return transition.status === "unchanged"
      ? { status: "unchanged", facts: [] }
      : { status: "rejected", facts: [], reason: transition.reason };
    return { status: "changed", facts: [command.type === "publish"
      ? { type: "suggestion.published", version: 1, item: command.item }
      : command.type === "update"
        ? { type: "suggestion.updated", version: 1, item: command.item }
        : { type: "suggestion.retracted", version: 1, suggestionId: command.suggestionId }] };
  }

  const transition = applySuggestionCommand(current, command);
  if (transition.status !== "changed") return transition.status === "unchanged"
    ? { status: "unchanged", facts: [] }
    : { status: "rejected", facts: [], reason: transition.reason };
  return { status: "changed", facts: [factForWriterCommand(command)] };
}

function factForWriterCommand(command: DurableSuggestionCommand): SuggestionFact {
  switch (command.type) {
    case "markViewed": return { type: "suggestion.viewed", version: 1, suggestionId: command.suggestionId };
    case "dismiss": return { type: "suggestion.dismissed", version: 1, suggestionId: command.suggestionId };
    case "pin": return { type: "suggestion.pinned", version: 1, suggestionId: command.suggestionId, pinnedAt: command.pinnedAt };
    case "unpin": return { type: "suggestion.unpinned", version: 1, suggestionId: command.suggestionId };
    case "workspace.place": return { type: "suggestion.workspacePlaced", version: 1, suggestionId: command.suggestionId, rect: command.rect };
    case "workspace.return": return { type: "suggestion.workspaceReturned", version: 1, suggestionId: command.suggestionId };
    case "workspace.geometry": return { type: "suggestion.workspaceMoved", version: 1, suggestionId: command.suggestionId, rect: command.rect };
    case "workspace.raise": return { type: "suggestion.workspaceRaised", version: 1, suggestionId: command.suggestionId };
    case "preview.resolve": return command.outcome === "accepted"
      ? { type: "suggestion.previewAccepted", version: 1, suggestionId: command.suggestionId }
      : { type: "suggestion.previewCancelled", version: 1, suggestionId: command.suggestionId };
  }
}

/** Strict, idempotent projection reducer. Gaps and invalid facts stop replay. */
export function applySuggestionFact(
  projection: SuggestionProjectionView,
  event: Pick<SequencedSuggestionFact, "sequence" | "fact">,
): SuggestionProjectionView {
  if (event.sequence <= projection.coveredThroughSequence) return projection;
  if (event.sequence !== projection.coveredThroughSequence + 1) {
    throw new Error(`SUGGESTION_EVENT_SEQUENCE_GAP:${projection.coveredThroughSequence + 1}:${event.sequence}`);
  }
  if (event.fact.version !== SUGGESTION_EVENT_VERSION) throw new Error("UNKNOWN_SUGGESTION_EVENT_VERSION");
  if (event.fact.type === "suggestion.projectionImported") {
    if (projection.coveredThroughSequence !== 0) throw new Error("INVALID_PROJECTION_IMPORT_POSITION");
    return { state: structuredClone(event.fact.state), revision: projection.revision,
      coveredThroughSequence: event.sequence };
  }
  const transition = transitionForFact(projection.state, event.fact);
  if (transition.status !== "changed") throw new Error(
    transition.status === "rejected" ? `INVALID_SUGGESTION_EVENT:${transition.reason}` : "REDUNDANT_SUGGESTION_EVENT",
  );
  return { state: transition.state, revision: projection.revision + 1,
    coveredThroughSequence: event.sequence };
}

function transitionForFact(state: PersistedSuggestionState, fact: Exclude<SuggestionFact,
  { type: "suggestion.projectionImported" }>) {
  switch (fact.type) {
    case "suggestion.published": return applySuggestionAgentEvent(state, { type: "suggestion.added", item: fact.item });
    case "suggestion.updated": return applySuggestionAgentEvent(state, { type: "suggestion.updated", item: fact.item });
    case "suggestion.retracted": return applySuggestionAgentEvent(state, { type: "suggestion.retracted", id: fact.suggestionId });
    case "suggestion.viewed": return applySuggestionCommand(state, { type: "markViewed", suggestionId: fact.suggestionId });
    case "suggestion.dismissed": return applySuggestionCommand(state, { type: "dismiss", suggestionId: fact.suggestionId });
    case "suggestion.pinned": return applySuggestionCommand(state, { type: "pin", suggestionId: fact.suggestionId, pinnedAt: fact.pinnedAt });
    case "suggestion.unpinned": return applySuggestionCommand(state, { type: "unpin", suggestionId: fact.suggestionId });
    case "suggestion.workspacePlaced": return applySuggestionCommand(state, { type: "workspace.place", suggestionId: fact.suggestionId, rect: fact.rect });
    case "suggestion.workspaceReturned": return applySuggestionCommand(state, { type: "workspace.return", suggestionId: fact.suggestionId });
    case "suggestion.workspaceMoved": return applySuggestionCommand(state, { type: "workspace.geometry", suggestionId: fact.suggestionId, rect: fact.rect });
    case "suggestion.workspaceRaised": return applySuggestionCommand(state, { type: "workspace.raise", suggestionId: fact.suggestionId });
    case "suggestion.previewAccepted": return applySuggestionCommand(state, { type: "preview.resolve", suggestionId: fact.suggestionId, outcome: "accepted" });
    case "suggestion.previewCancelled": return applySuggestionCommand(state, { type: "preview.resolve", suggestionId: fact.suggestionId, outcome: "cancelled" });
  }
}
