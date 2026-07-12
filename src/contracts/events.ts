import { Type } from "typebox";

import {
  identifier,
  JsonValueRuntimeSchema,
  revision,
  strict,
  text,
  timestamp,
} from "./base";
import { SuggestionItemSchema } from "../domain/suggestions/schema";
import { PersistedSuggestionStateSchema, WorkspacePinRectSchema } from "../domain/suggestions/state";

export { PersistedSuggestionStateSchema, WorkspacePinRectSchema };

export const SuggestionCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal("markViewed"), suggestionId: identifier }, strict),
  Type.Object({ type: Type.Literal("dismiss"), suggestionId: identifier }, strict),
  Type.Object({ type: Type.Literal("pin"), suggestionId: identifier, pinnedAt: timestamp }, strict),
  Type.Object({ type: Type.Literal("unpin"), suggestionId: identifier }, strict),
  Type.Object({ type: Type.Literal("workspace.place"), suggestionId: identifier, rect: WorkspacePinRectSchema }, strict),
  Type.Object({ type: Type.Literal("workspace.return"), suggestionId: identifier }, strict),
  Type.Object({ type: Type.Literal("workspace.geometry"), suggestionId: identifier, rect: WorkspacePinRectSchema }, strict),
  Type.Object({ type: Type.Literal("workspace.raise"), suggestionId: identifier }, strict),
  Type.Object({ type: Type.Literal("preview.resolve"), suggestionId: identifier, outcome: Type.Union([Type.Literal("accepted"), Type.Literal("cancelled")]) }, strict),
]);
export const SuggestionActorSchema = Type.Object({
  type: Type.Union([Type.Literal("writer"), Type.Literal("agent"), Type.Literal("system")]),
  id: Type.Optional(identifier),
}, strict);
export const SuggestionIntentSchema = Type.Union([
  SuggestionCommandSchema,
  Type.Object({ type: Type.Literal("publish"), item: SuggestionItemSchema }, strict),
  Type.Object({ type: Type.Literal("update"), item: SuggestionItemSchema }, strict),
  Type.Object({ type: Type.Literal("retract"), suggestionId: identifier }, strict),
]);
export const SuggestionCommandEnvelopeSchema = Type.Object({
  commandId: identifier, projectId: identifier, documentId: identifier,
  actor: SuggestionActorSchema, version: Type.Literal(1), command: SuggestionIntentSchema,
  expectedSuggestionRevision: revision, expectedDocumentRevision: Type.Optional(revision),
  requestedAt: timestamp,
}, strict);
export const SuggestionFactSchema = Type.Union([
  Type.Object({ type: Type.Literal("suggestion.projectionImported"), version: Type.Literal(1), state: PersistedSuggestionStateSchema }, strict),
  Type.Object({ type: Type.Literal("suggestion.published"), version: Type.Literal(1), item: SuggestionItemSchema }, strict),
  Type.Object({ type: Type.Literal("suggestion.updated"), version: Type.Literal(1), item: SuggestionItemSchema }, strict),
  Type.Object({ type: Type.Literal("suggestion.retracted"), version: Type.Literal(1), suggestionId: identifier }, strict),
  Type.Object({ type: Type.Literal("suggestion.viewed"), version: Type.Literal(1), suggestionId: identifier }, strict),
  Type.Object({ type: Type.Literal("suggestion.dismissed"), version: Type.Literal(1), suggestionId: identifier }, strict),
  Type.Object({ type: Type.Literal("suggestion.pinned"), version: Type.Literal(1), suggestionId: identifier, pinnedAt: timestamp }, strict),
  Type.Object({ type: Type.Literal("suggestion.unpinned"), version: Type.Literal(1), suggestionId: identifier }, strict),
  Type.Object({ type: Type.Literal("suggestion.workspacePlaced"), version: Type.Literal(1), suggestionId: identifier, rect: WorkspacePinRectSchema }, strict),
  Type.Object({ type: Type.Literal("suggestion.workspaceReturned"), version: Type.Literal(1), suggestionId: identifier }, strict),
  Type.Object({ type: Type.Literal("suggestion.workspaceMoved"), version: Type.Literal(1), suggestionId: identifier, rect: WorkspacePinRectSchema }, strict),
  Type.Object({ type: Type.Literal("suggestion.workspaceRaised"), version: Type.Literal(1), suggestionId: identifier }, strict),
  Type.Object({ type: Type.Literal("suggestion.previewAccepted"), version: Type.Literal(1), suggestionId: identifier }, strict),
  Type.Object({ type: Type.Literal("suggestion.previewCancelled"), version: Type.Literal(1), suggestionId: identifier }, strict),
]);
export const SequencedSuggestionFactSchema = Type.Object({
  eventId: identifier, sequence: Type.Integer({ minimum: 1 }), commandId: identifier,
  actor: SuggestionActorSchema, occurredAt: timestamp, fact: SuggestionFactSchema,
}, strict);
export const SuggestionCommandRequestSchema = Type.Object({
  commandId: identifier,
  projectId: identifier,
  documentId: identifier,
  expectedSuggestionRevision: revision,
  command: SuggestionCommandSchema,
}, strict);
export const SuggestionCommandResultSchema = Type.Object({
  commandId: identifier,
  status: Type.Union([Type.Literal("applied"), Type.Literal("unchanged"), Type.Literal("conflict"), Type.Literal("rejected")]),
  suggestionRevision: revision,
  state: PersistedSuggestionStateSchema,
  reason: Type.Optional(text(500)),
}, strict);

export const AgentStatusSchema = Type.Union([
  Type.Literal("offline"), Type.Literal("stopped"), Type.Literal("working"),
  Type.Literal("waiting"), Type.Literal("capped"), Type.Literal("error"),
]);
export const AgentRuntimeSchema = Type.Object(
  {
    status: AgentStatusSchema,
    sessionId: Type.Optional(identifier),
    activeRevision: Type.Optional(revision),
    cycleCount: Type.Integer({ minimum: 0 }),
    error: Type.Optional(text(2_000)),
  },
  strict,
);
export const AgentRuntimeUpdateSchema = Type.Partial(AgentRuntimeSchema, strict);
export const ProcessHealthSchema = Type.Union([
  Type.Object({ state: Type.Literal("starting") }, strict),
  Type.Object({ state: Type.Literal("healthy"), since: timestamp }, strict),
  Type.Object({ state: Type.Literal("degraded"), reason: text(2_000) }, strict),
  Type.Object({ state: Type.Literal("restarting"), attempt: Type.Integer({ minimum: 1, maximum: 3 }), nextAttemptAt: timestamp }, strict),
  Type.Object({ state: Type.Literal("failed"), reason: text(2_000) }, strict),
]);
export const ProcessHealthSnapshotSchema = Type.Object({ storage: ProcessHealthSchema, agent: ProcessHealthSchema }, strict);
export const AgentActivityKindSchema = Type.Union([
  Type.Literal("lifecycle"), Type.Literal("message"), Type.Literal("tool"),
  Type.Literal("loop"), Type.Literal("error"),
]);
const activityProperties = {
  id: identifier,
  kind: AgentActivityKindSchema,
  timestamp,
  title: text(500),
  text: Type.Optional(text(100_000)),
  status: Type.Optional(AgentStatusSchema),
};
export const AgentActivityInputSchema = Type.Object(activityProperties, strict);
export const AgentActivitySchema = Type.Object(
  { ...activityProperties, updatedAt: timestamp },
  strict,
);

export const DocumentBlocksSchema = Type.Unsafe<unknown[]>(
  Type.Array(JsonValueRuntimeSchema, { maxItems: 100_000 }),
);
export const PlainTextBlockSchema = Type.Object(
  {
    id: identifier,
    type: identifier,
    text: text(100_000),
  },
  strict,
);
export const DocumentSnapshotSchema = Type.Object(
  {
    id: identifier,
    projectId: identifier,
    title: text(1_000),
    blocks: DocumentBlocksSchema,
    schemaVersion: Type.Integer({ minimum: 1 }),
    revision,
    updatedAt: timestamp,
  },
  strict,
);
export const DocumentSaveReceiptSchema = Type.Object(
  {
    projectId: identifier,
    documentId: identifier,
    documentRevision: revision,
    projectRevision: revision,
    updatedAt: timestamp,
  },
  strict,
);
export const AgentDocumentReadResultSchema = Type.Object(
  {
    projectId: identifier,
    documentId: identifier,
    title: text(1_000),
    documentRevision: revision,
    schemaVersion: Type.Integer({ minimum: 1 }),
    blocks: DocumentBlocksSchema,
    plainTextBlocks: Type.Array(PlainTextBlockSchema, { maxItems: 100_000 }),
  },
  strict,
);
export const SourceSnapshotSchema = Type.Object(
  {
    id: identifier,
    projectId: identifier,
    documentId: identifier,
    title: text(1_000),
    storagePath: text(10_000),
    bytes: Type.Integer({ minimum: 0 }),
    updatedAt: timestamp,
  },
  strict,
);
export const ProjectSnapshotSchema = Type.Object(
  { id: identifier, name: text(1_000), revision },
  strict,
);
export const DocumentSummarySchema = Type.Object({
  id: identifier, projectId: identifier, title: text(1_000), revision,
}, strict);
export const WorkspaceSelectionSchema = Type.Object({
  projectId: identifier, documentId: identifier,
}, strict);
export const WorkspaceCatalogSchema = Type.Object({
  projects: Type.Array(ProjectSnapshotSchema),
  documents: Type.Array(DocumentSummarySchema),
  selection: WorkspaceSelectionSchema,
}, strict);
export const ObservationSeedSchema = Type.Object(
  {
    streamId: identifier,
    coveredThroughSequence: Type.Integer({ minimum: 0 }),
    projectId: identifier,
    projectName: text(1_000),
    projectRevision: revision,
    documentId: identifier,
    documentTitle: text(1_000),
    documentRevision: revision,
  },
  strict,
);

export const SuggestionEventSchema = Type.Union([
  Type.Object({ type: Type.Literal("suggestion.added"), item: SuggestionItemSchema }, strict),
  Type.Object({ type: Type.Literal("suggestion.updated"), item: SuggestionItemSchema }, strict),
  Type.Object({ type: Type.Literal("suggestion.retracted"), id: identifier }, strict),
  Type.Object({ type: Type.Literal("suggestion.state.changed"), suggestionId: identifier, commandType: text(100) }, strict),
]);
export const DurableEventPayloadSchema = Type.Union([
  Type.Object({ type: Type.Literal("suggestion.event"), event: SuggestionEventSchema,
    commandId: Type.Optional(identifier), suggestionRevision: revision,
    state: PersistedSuggestionStateSchema }, strict),
  Type.Object({ type: Type.Literal("document.saved"), ...DocumentSaveReceiptSchema.properties }, strict),
  Type.Object({ type: Type.Literal("source.imported"), source: SourceSnapshotSchema, projectRevision: revision }, strict),
]);
export const DurableEventEnvelopeSchema = Type.Object({
  eventId: identifier,
  streamId: identifier,
  sequence: Type.Integer({ minimum: 1 }),
  occurredAt: timestamp,
  causationId: Type.Optional(identifier),
  payload: DurableEventPayloadSchema,
}, strict);
export const EphemeralDesktopEventSchema = Type.Union([
  Type.Object({ type: Type.Literal("agent.runtime"), runtime: AgentRuntimeSchema }, strict),
  Type.Object({ type: Type.Literal("agent.activity"), activity: AgentActivitySchema }, strict),
  Type.Object({ type: Type.Literal("process.health"), health: ProcessHealthSnapshotSchema }, strict),
]);
export const DesktopEventSchema = Type.Union([
  DurableEventEnvelopeSchema,
  EphemeralDesktopEventSchema,
]);
export const WorkspaceSnapshotSchema = Type.Object(
  {
    streamId: identifier,
    coveredThroughSequence: Type.Integer({ minimum: 0 }),
    project: ProjectSnapshotSchema,
    document: DocumentSnapshotSchema,
    sources: Type.Array(SourceSnapshotSchema),
    suggestions: PersistedSuggestionStateSchema,
    suggestionRevision: revision,
    agent: AgentRuntimeSchema,
    activity: Type.Array(AgentActivitySchema, { maxItems: 500 }),
    health: Type.Optional(ProcessHealthSnapshotSchema),
  },
  strict,
);

export const DURABLE_EVENT_TYPES = {
  "suggestion.event": true, "document.saved": true, "source.imported": true,
} as const;

/** Application event names; durable members are enveloped on transport. */
export const DESKTOP_EVENT_TYPES = {
  "suggestion.event": true,
  "agent.runtime": true,
  "agent.activity": true,
  "document.saved": true,
  "source.imported": true,
  "process.health": true,
} as const;
