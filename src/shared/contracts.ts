import { Type, type Static, type TSchema } from "typebox";
import { Check, Errors } from "typebox/schema";

import { SuggestionItemSchema } from "../suggestions/schema";

const strict = { additionalProperties: false } as const;
const identifier = Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" });
const text = (maxLength: number) => Type.String({ maxLength });
const revision = Type.Integer({ minimum: 0 });
const timestamp = Type.Number({ minimum: 0 });

export const PROTOCOL_VERSION = 1 as const;
export const BUILD_IDENTIFIER = "0.1.0" as const;
export const STORAGE_PROTOCOL_NAME = "scribe.storage" as const;
export const AGENT_PROTOCOL_NAME = "scribe.agent" as const;
export const DEFAULT_EVENT_STREAM_ID = "document:default-document" as const;
export const ProtocolVersionSchema = Type.Literal(PROTOCOL_VERSION);
export const IdentifierSchema = identifier;
export const RevisionSchema = revision;
export const TimestampSchema = timestamp;

const JsonValueRuntimeSchema = Type.Cyclic(
  {
    JsonValue: Type.Union([
      Type.Null(),
      Type.Boolean(),
      Type.Number(),
      Type.String(),
      Type.Array(Type.Ref("JsonValue")),
      Type.Record(Type.String(), Type.Ref("JsonValue")),
    ]),
  },
  "JsonValue",
);
export const JsonValueSchema = Type.Unsafe<unknown>(JsonValueRuntimeSchema);

export const ContractErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 100, pattern: "^[A-Z][A-Z0-9_]*$" }),
    message: Type.String({ minLength: 1, maxLength: 500 }),
    retryable: Type.Boolean(),
    details: Type.Optional(
      Type.Record(
        Type.String({ minLength: 1, maxLength: 100 }),
        Type.Union([Type.String({ maxLength: 200 }), Type.Number(), Type.Boolean()]),
      ),
    ),
  },
  strict,
);
export type ContractError = Static<typeof ContractErrorSchema>;

export const WorkspacePinRectSchema = Type.Object(
  {
    x: Type.Number({ minimum: -1_000_000, maximum: 1_000_000 }),
    y: Type.Number({ minimum: -1_000_000, maximum: 1_000_000 }),
    width: Type.Number({ minimum: 1, maximum: 10_000 }),
    height: Type.Number({ minimum: 1, maximum: 10_000 }),
  },
  strict,
);

const PersistedInboxEntrySchema = Type.Object(
  {
    item: SuggestionItemSchema,
    viewed: Type.Boolean(),
    stale: Type.Boolean(),
    withdrawn: Type.Boolean(),
  },
  strict,
);
const PersistedPinnedEntrySchema = Type.Object(
  {
    item: SuggestionItemSchema,
    viewed: Type.Boolean(),
    stale: Type.Boolean(),
    withdrawn: Type.Boolean(),
    pinnedAt: timestamp,
  },
  strict,
);
const PersistedWorkspacePinSchema = Type.Object(
  {
    item: SuggestionItemSchema,
    pinnedAt: timestamp,
    pendingInitialPlacement: Type.Boolean(),
    zIndex: Type.Integer({ minimum: 0 }),
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number(),
    height: Type.Number(),
  },
  strict,
);
export const PersistedSuggestionStateSchema = Type.Object(
  {
    entries: Type.Array(PersistedInboxEntrySchema, { maxItems: 30 }),
    pinnedEntries: Type.Array(PersistedPinnedEntrySchema, { maxItems: 30 }),
    workspacePins: Type.Array(PersistedWorkspacePinSchema, { maxItems: 30 }),
    seenKeys: Type.Record(Type.String({ maxLength: 200 }), Type.Literal(true)),
    nextZIndex: Type.Integer({ minimum: 1 }),
  },
  strict,
);
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
  type: Type.Union([Type.Literal("writer"), Type.Literal("agent"), Type.Literal("development"), Type.Literal("system")]),
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
export const AgentActivityKindSchema = Type.Union([
  Type.Literal("lifecycle"), Type.Literal("message"), Type.Literal("reasoning"),
  Type.Literal("tool"), Type.Literal("provider"), Type.Literal("loop"), Type.Literal("error"),
]);
const activityProperties = {
  id: identifier,
  kind: AgentActivityKindSchema,
  timestamp,
  title: text(500),
  text: Type.Optional(text(100_000)),
  payload: Type.Optional(JsonValueSchema),
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
export const DocumentSnapshotSchema = Type.Object(
  {
    id: identifier,
    projectId: identifier,
    title: text(1_000),
    blocks: DocumentBlocksSchema,
    markdown: text(10_000_000),
    schemaVersion: Type.Integer({ minimum: 1 }),
    revision,
    updatedAt: timestamp,
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
  Type.Object({ type: Type.Literal("document.saved"), document: DocumentSnapshotSchema, projectRevision: revision }, strict),
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
  },
  strict,
);

const noParams = Type.Undefined();
const documentScope = Type.Object({ projectId: identifier, documentId: identifier }, strict);
const projectIdentity = Type.Object({ projectId: identifier }, strict);
const namedProject = Type.Object({ name: text(1_000) }, strict);
const renamedProject = Type.Object({ projectId: identifier, name: text(1_000) }, strict);
const namedDocument = Type.Object({ projectId: identifier, title: text(1_000) }, strict);
const renamedDocument = Type.Object({
  projectId: identifier, documentId: identifier, title: text(1_000),
}, strict);
const accepted = Type.Object({ accepted: Type.Boolean() }, strict);
const replayParams = Type.Object({
  projectId: identifier,
  documentId: identifier,
  streamId: identifier,
  afterSequence: Type.Integer({ minimum: 0 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
}, strict);
const replayResult = Type.Object({
  streamId: identifier,
  events: Type.Array(DurableEventEnvelopeSchema, { maxItems: 100 }),
  headSequence: Type.Integer({ minimum: 0 }),
  hasMore: Type.Boolean(),
  historyAvailable: Type.Boolean(),
}, strict);
const rendererAcknowledgeParams = Type.Object({
  projectId: identifier,
  documentId: identifier,
  streamId: identifier,
  sequence: Type.Integer({ minimum: 0 }),
}, strict);
const acknowledgeResult = Type.Object({
  streamId: identifier,
  acknowledgedSequence: Type.Integer({ minimum: 0 }),
}, strict);
const saveDocumentParams = Type.Object(
  {
    projectId: identifier,
    documentId: identifier,
    blocks: DocumentBlocksSchema,
    markdown: text(10_000_000),
    expectedRevision: revision,
  },
  strict,
);
const suggestionMutation = Type.Object(
  { projectId: identifier, documentId: identifier, item: SuggestionItemSchema, expectedDocumentRevision: revision },
  strict,
);
const repairResult = Type.Object(
  {
    workspaceRoot: text(10_000), draftPath: text(10_000),
    sourcesDirectory: text(10_000), piDirectory: text(10_000),
    repaired: Type.Boolean(),
  },
  strict,
);

function operation<Params extends TSchema, Result extends TSchema>(params: Params, result: Result) {
  return { params, result, error: ContractErrorSchema } as const;
}

export const RendererOperations = {
  "events.subscribe": operation(noParams, Type.Object({ consumerId: identifier }, strict)),
  "workspace.catalog": operation(noParams, WorkspaceCatalogSchema),
  "project.create": operation(namedProject, WorkspaceCatalogSchema),
  "project.rename": operation(renamedProject, WorkspaceCatalogSchema),
  "project.delete": operation(projectIdentity, WorkspaceCatalogSchema),
  "project.select": operation(projectIdentity, WorkspaceCatalogSchema),
  "document.create": operation(namedDocument, WorkspaceCatalogSchema),
  "document.rename": operation(renamedDocument, WorkspaceCatalogSchema),
  "document.delete": operation(documentScope, WorkspaceCatalogSchema),
  "document.select": operation(documentScope, WorkspaceCatalogSchema),
  hydrate: operation(documentScope, WorkspaceSnapshotSchema),
  "events.replay": operation(replayParams, replayResult),
  "events.acknowledge": operation(rendererAcknowledgeParams, acknowledgeResult),
  "agent.start": operation(documentScope, AgentRuntimeSchema),
  "agent.stop": operation(documentScope, AgentRuntimeSchema),
  "document.save": operation(saveDocumentParams, DocumentSnapshotSchema),
  "suggestions.command": operation(SuggestionCommandRequestSchema, SuggestionCommandResultSchema),
  "source.import": operation(documentScope, Type.Union([SourceSnapshotSchema, Type.Undefined()])),
  "development.suggestion.create": operation(SuggestionItemSchema, accepted),
} as const;

export const StorageOperations = {
  "workspace.catalog": operation(noParams, WorkspaceCatalogSchema),
  "project.create": operation(namedProject, WorkspaceCatalogSchema),
  "project.rename": operation(renamedProject, WorkspaceCatalogSchema),
  "project.delete": operation(projectIdentity, WorkspaceCatalogSchema),
  "project.select": operation(projectIdentity, WorkspaceCatalogSchema),
  "document.create": operation(namedDocument, WorkspaceCatalogSchema),
  "document.rename": operation(renamedDocument, WorkspaceCatalogSchema),
  "document.delete": operation(documentScope, WorkspaceCatalogSchema),
  "document.select": operation(documentScope, WorkspaceCatalogSchema),
  hydrate: operation(documentScope, WorkspaceSnapshotSchema),
  "events.replay": operation(replayParams, replayResult),
  "events.acknowledge": operation(Type.Object({
    consumerId: identifier,
    projectId: identifier,
    documentId: identifier,
    streamId: identifier,
    sequence: Type.Integer({ minimum: 0 }),
  }, strict), acknowledgeResult),
  "workspace.repair": operation(documentScope, repairResult),
  "document.save": operation(saveDocumentParams, DocumentSnapshotSchema),
  "suggestions.command": operation(SuggestionCommandRequestSchema, SuggestionCommandResultSchema),
  "source.import": operation(Type.Object({ ...documentScope.properties, path: text(10_000) }, strict), SourceSnapshotSchema),
  "agent.seed": operation(documentScope, ObservationSeedSchema),
  "agent.suggestions.list": operation(documentScope, Type.Object({
    live: Type.Array(SuggestionItemSchema), pinned: Type.Array(SuggestionItemSchema),
    workspace: Type.Array(SuggestionItemSchema),
  }, strict)),
  "agent.suggestion.create": operation(suggestionMutation, accepted),
  "agent.suggestion.update": operation(suggestionMutation, accepted),
  "agent.suggestion.retract": operation(Type.Object({ ...documentScope.properties, id: identifier, expectedDocumentRevision: revision }, strict), accepted),
  "development.suggestion.create": operation(Type.Object({ ...documentScope.properties, item: SuggestionItemSchema }, strict), accepted),
} as const;

const agentStartParams = Type.Object(
  { projectId: identifier, documentId: identifier, projectRevision: revision, documentRevision: revision },
  strict,
);
export const AgentOperations = {
  "agent.start": operation(agentStartParams, AgentRuntimeSchema),
  "agent.stop": operation(documentScope, AgentRuntimeSchema),
} as const;

export type OperationRegistry = Record<string, { params: TSchema; result: TSchema; error: TSchema }>;
export type OperationName<Registry extends OperationRegistry> = Extract<keyof Registry, string>;
export type OperationParams<Registry extends OperationRegistry, Name extends OperationName<Registry>> = Static<Registry[Name]["params"]>;
export type OperationResult<Registry extends OperationRegistry, Name extends OperationName<Registry>> = Static<Registry[Name]["result"]>;
export type OperationArgs<Registry extends OperationRegistry, Name extends OperationName<Registry>> =
  undefined extends OperationParams<Registry, Name>
    ? [params?: OperationParams<Registry, Name>]
    : [params: OperationParams<Registry, Name>];
export interface OperationCaller<Registry extends OperationRegistry> {
  call<Name extends OperationName<Registry>>(
    operation: Name,
    ...args: OperationArgs<Registry, Name>
  ): Promise<OperationResult<Registry, Name>>;
}

export const DESKTOP_INVOKE_CHANNELS = {
  subscribeEvents: "scribe:events.subscribe",
  workspaceCatalog: "scribe:workspace.catalog",
  createProject: "scribe:project.create",
  renameProject: "scribe:project.rename",
  deleteProject: "scribe:project.delete",
  selectProject: "scribe:project.select",
  createDocument: "scribe:document.create",
  renameDocument: "scribe:document.rename",
  deleteDocument: "scribe:document.delete",
  selectDocument: "scribe:document.select",
  hydrate: "scribe:hydrate",
  replayEvents: "scribe:events.replay",
  acknowledgeEvents: "scribe:events.acknowledge",
  startAgent: "scribe:agent.start",
  stopAgent: "scribe:agent.stop",
  saveDocument: "scribe:document.save",
  executeSuggestionCommand: "scribe:suggestions.command",
  importSource: "scribe:source.import",
} as const;
export const DESKTOP_EVENT_CHANNEL = "scribe:event" as const;
export const DEVELOPMENT_SUGGESTION_CHANNEL = "scribe:development.suggestion.create" as const;
export const RENDERER_OPERATION_CHANNELS = {
  "events.subscribe": DESKTOP_INVOKE_CHANNELS.subscribeEvents,
  "workspace.catalog": DESKTOP_INVOKE_CHANNELS.workspaceCatalog,
  "project.create": DESKTOP_INVOKE_CHANNELS.createProject,
  "project.rename": DESKTOP_INVOKE_CHANNELS.renameProject,
  "project.delete": DESKTOP_INVOKE_CHANNELS.deleteProject,
  "project.select": DESKTOP_INVOKE_CHANNELS.selectProject,
  "document.create": DESKTOP_INVOKE_CHANNELS.createDocument,
  "document.rename": DESKTOP_INVOKE_CHANNELS.renameDocument,
  "document.delete": DESKTOP_INVOKE_CHANNELS.deleteDocument,
  "document.select": DESKTOP_INVOKE_CHANNELS.selectDocument,
  hydrate: DESKTOP_INVOKE_CHANNELS.hydrate,
  "events.replay": DESKTOP_INVOKE_CHANNELS.replayEvents,
  "events.acknowledge": DESKTOP_INVOKE_CHANNELS.acknowledgeEvents,
  "agent.start": DESKTOP_INVOKE_CHANNELS.startAgent,
  "agent.stop": DESKTOP_INVOKE_CHANNELS.stopAgent,
  "document.save": DESKTOP_INVOKE_CHANNELS.saveDocument,
  "suggestions.command": DESKTOP_INVOKE_CHANNELS.executeSuggestionCommand,
  "source.import": DESKTOP_INVOKE_CHANNELS.importSource,
  "development.suggestion.create": DEVELOPMENT_SUGGESTION_CHANNEL,
} as const satisfies Record<OperationName<typeof RendererOperations>, string>;
export const STORAGE_RPC_METHODS = Object.keys(StorageOperations) as OperationName<typeof StorageOperations>[];
export type StorageRpcMethod = OperationName<typeof StorageOperations>;
export const AGENT_RPC_METHODS = Object.keys(AgentOperations) as OperationName<typeof AgentOperations>[];
export type AgentRpcMethod = OperationName<typeof AgentOperations>;
export const DURABLE_EVENT_TYPES = {
  "suggestion.event": true, "document.saved": true, "source.imported": true,
} as const satisfies Record<Static<typeof DurableEventPayloadSchema>["type"], true>;
/** Application event names; durable members are enveloped on transport. */
export const DESKTOP_EVENT_TYPES = {
  "suggestion.event": true,
  "agent.runtime": true,
  "agent.activity": true,
  "document.saved": true,
  "source.imported": true,
} as const;

function requestSchemas(registry: OperationRegistry) {
  return Object.entries(registry).map(([name, value]) => Type.Object({
    kind: Type.Literal("rpc"), protocolVersion: ProtocolVersionSchema,
    id: identifier, operation: Type.Literal(name), params: value.params,
  }, strict));
}
function resultSchemas(registry: OperationRegistry) {
  return Object.entries(registry).flatMap(([name, value]) => [
    Type.Object({ kind: Type.Literal("rpc.success"), protocolVersion: ProtocolVersionSchema,
      id: identifier, operation: Type.Literal(name), result: value.result }, strict),
    Type.Object({ kind: Type.Literal("rpc.failure"), protocolVersion: ProtocolVersionSchema,
      id: identifier, operation: Type.Literal(name), error: ContractErrorSchema }, strict),
  ]);
}
export const StorageRpcRequestSchema = Type.Union(requestSchemas(StorageOperations));
export const StorageRpcResultSchema = Type.Union(resultSchemas(StorageOperations));
export const AgentRpcRequestSchema = Type.Union(requestSchemas(AgentOperations));
export const AgentRpcResultSchema = Type.Union(resultSchemas(AgentOperations));

export const ProjectChangedSchema = Type.Object({
  kind: Type.Literal("project.changed"), protocolVersion: ProtocolVersionSchema,
  streamId: Type.Optional(identifier), sequence: Type.Optional(Type.Integer({ minimum: 0 })),
  projectRevision: revision, documentRevision: revision,
}, strict);
export const ShutdownSchema = Type.Object({
  kind: Type.Literal("shutdown"), protocolVersion: ProtocolVersionSchema,
}, strict);
export const StorageForwardRequestSchema = Type.Union(requestSchemas(StorageOperations).map((schema) =>
  Type.Object({ ...schema.properties, kind: Type.Literal("storage.request") }, strict),
));
export const StorageForwardResultSchema = Type.Union(resultSchemas(StorageOperations).map((schema) =>
  Type.Object({ ...schema.properties, kind: Type.Literal(
    schema.properties.kind.const === "rpc.success" ? "storage.success" : "storage.failure",
  ) }, strict),
));

export const ReadyMessageSchema = Type.Object({
  kind: Type.Literal("ready"),
  protocolName: Type.Union([
    Type.Literal(STORAGE_PROTOCOL_NAME),
    Type.Literal(AGENT_PROTOCOL_NAME),
  ]),
  protocolVersion: ProtocolVersionSchema,
  buildIdentifier: Type.String({ minLength: 1, maxLength: 100 }),
  operations: Type.Array(identifier, { uniqueItems: true, maxItems: 100 }),
}, strict);
export const HealthMessageSchema = Type.Object({
  kind: Type.Literal("health"),
  protocolVersion: ProtocolVersionSchema,
  status: Type.Union([Type.Literal("healthy"), Type.Literal("degraded")]),
  details: Type.Optional(Type.Record(Type.String({ maxLength: 100 }), Type.String({ maxLength: 200 }))),
}, strict);
export const StartupErrorMessageSchema = Type.Object({
  kind: Type.Literal("startup.error"), protocolVersion: ProtocolVersionSchema,
  error: ContractErrorSchema,
}, strict);
export const DomainEventMessageSchema = Type.Object({
  kind: Type.Literal("domain.event"), protocolVersion: ProtocolVersionSchema, event: DurableEventEnvelopeSchema,
}, strict);
export const AgentRuntimeMessageSchema = Type.Object({
  kind: Type.Literal("agent.runtime"), protocolVersion: ProtocolVersionSchema, runtime: AgentRuntimeUpdateSchema,
}, strict);
export const AgentActivityMessageSchema = Type.Object({
  kind: Type.Literal("agent.activity"), protocolVersion: ProtocolVersionSchema, activity: AgentActivityInputSchema,
}, strict);
export const StorageChildMessageSchema = Type.Union([
  ReadyMessageSchema, HealthMessageSchema, StartupErrorMessageSchema, StorageRpcResultSchema, DomainEventMessageSchema,
]);
export const AgentChildMessageSchema = Type.Union([
  ReadyMessageSchema, HealthMessageSchema, StartupErrorMessageSchema, AgentRpcResultSchema, StorageForwardRequestSchema,
  AgentRuntimeMessageSchema, AgentActivityMessageSchema,
]);
export const AgentParentMessageSchema = Type.Union([
  AgentRpcRequestSchema, StorageForwardResultSchema, ProjectChangedSchema, ShutdownSchema,
]);

type RpcRequestFor<Registry extends OperationRegistry> = {
  [Name in OperationName<Registry>]: { kind: "rpc"; protocolVersion: 1; id: string; operation: Name; params: OperationParams<Registry, Name> }
}[OperationName<Registry>];
type RpcResultFor<Registry extends OperationRegistry> = {
  [Name in OperationName<Registry>]:
    | { kind: "rpc.success"; protocolVersion: 1; id: string; operation: Name; result: OperationResult<Registry, Name> }
    | { kind: "rpc.failure"; protocolVersion: 1; id: string; operation: Name; error: ContractError }
}[OperationName<Registry>];
export type StorageRpcRequest = RpcRequestFor<typeof StorageOperations>;
export type StorageRpcResult = RpcResultFor<typeof StorageOperations>;
export type AgentRpcRequest = RpcRequestFor<typeof AgentOperations>;
export type AgentRpcResult = RpcResultFor<typeof AgentOperations>;
export type StorageForwardRequest = {
  [Name in OperationName<typeof StorageOperations>]: {
    kind: "storage.request"; protocolVersion: 1; id: string; operation: Name;
    params: OperationParams<typeof StorageOperations, Name>;
  }
}[OperationName<typeof StorageOperations>];
export type StorageForwardResult = {
  [Name in OperationName<typeof StorageOperations>]:
    | { kind: "storage.success"; protocolVersion: 1; id: string; operation: Name; result: OperationResult<typeof StorageOperations, Name> }
    | { kind: "storage.failure"; protocolVersion: 1; id: string; operation: Name; error: ContractError }
}[OperationName<typeof StorageOperations>];
type ReadyMessage = Static<typeof ReadyMessageSchema>;
type HealthMessage = Static<typeof HealthMessageSchema>;
type StartupErrorMessage = Static<typeof StartupErrorMessageSchema>;
type DomainEventMessage = Static<typeof DomainEventMessageSchema>;
export type StorageChildMessage = ReadyMessage | HealthMessage | StartupErrorMessage | StorageRpcResult | DomainEventMessage;
export type AgentChildMessage = ReadyMessage | HealthMessage | StartupErrorMessage | AgentRpcResult | StorageForwardRequest |
  Static<typeof AgentRuntimeMessageSchema> | Static<typeof AgentActivityMessageSchema>;
export type ChildMessage = StorageChildMessage | AgentChildMessage;
export type AgentParentMessage = AgentRpcRequest | StorageForwardResult |
  Static<typeof ProjectChangedSchema> | Static<typeof ShutdownSchema>;

export class ContractValidationError extends Error {
  constructor(readonly contract: ContractError) {
    super(contract.message);
    this.name = "ContractValidationError";
  }
}
const clean = (value: string, max = 160) => value.replace(/[\r\n\t]+/g, " ").slice(0, max);
export function parseOrContractError<Schema extends TSchema>(
  schema: Schema,
  value: unknown,
  boundary: string,
): Static<Schema> {
  if (Check(schema, value)) return value as Static<Schema>;
  const [, errors] = Errors(schema, value);
  const details: Record<string, string> = { boundary: clean(boundary, 100) };
  errors.slice(0, 5).forEach((issue, index) => {
    details[`issue${index + 1}`] = clean(`${issue.instancePath || "/"}: ${issue.message}`);
  });
  throw new ContractValidationError({
    code: "CONTRACT_VALIDATION_FAILED",
    message: `Invalid data at ${clean(boundary, 100)}`,
    retryable: false,
    details,
  });
}

function durableCompatibilityContractError(error: unknown): ContractError | undefined {
  if (!(error instanceof Error) || error.name !== "DurableCompatibilityError") return undefined;
  if (!("format" in error) || typeof error.format !== "string") return undefined;
  if (!("recordIdentity" in error) || typeof error.recordIdentity !== "string") return undefined;
  return {
    code: "UNSUPPORTED_DURABLE_FORMAT",
    message: error.message,
    retryable: false,
    details: {
      feature: error.format,
      preservedDataAt: `workspace database quarantine:${error.recordIdentity}`,
    },
  };
}

export function toContractError(error: unknown): ContractError {
  if (error instanceof ContractValidationError) return error.contract;
  if (typeof error === "object" && error !== null && "contract" in error && Check(ContractErrorSchema, error.contract)) {
    return error.contract as ContractError;
  }
  if (error instanceof Error && error.message === "DOCUMENT_REVISION_CONFLICT") {
    return { code: "DOCUMENT_REVISION_CONFLICT", message: "The document changed before it could be saved", retryable: true };
  }
  if (error instanceof Error && error.message === "STALE_SUGGESTION_REVISION") {
    return { code: "STALE_SUGGESTION_REVISION", message: "The suggestion targets an older document revision", retryable: true };
  }
  const compatibilityError = durableCompatibilityContractError(error);
  if (compatibilityError) return compatibilityError;
  return { code: "INTERNAL_ERROR", message: "The operation could not be completed", retryable: false };
}

export class RemoteContractError extends Error {
  constructor(readonly contract: ContractError) {
    super(contract.message);
    this.name = "RemoteContractError";
  }
}

export const CHILD_MESSAGE_KINDS = {
  ready: true, health: true, "startup.error": true, "rpc.success": true, "rpc.failure": true,
  "domain.event": true, "storage.request": true, "agent.runtime": true, "agent.activity": true,
} as const;
export const AGENT_PARENT_MESSAGE_KINDS = {
  rpc: true, "storage.success": true, "storage.failure": true,
  "project.changed": true, shutdown: true,
} as const;
