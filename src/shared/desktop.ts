import type { Static } from "typebox";

import type {
  AgentActivityInputSchema,
  AgentActivityKindSchema,
  AgentActivitySchema,
  AgentRuntimeSchema,
  AgentStatusSchema,
  DesktopEventSchema,
  DurableEventEnvelopeSchema,
  DurableEventPayloadSchema,
  EphemeralDesktopEventSchema,
  DocumentSnapshotSchema,
  ObservationSeedSchema,
  ProcessHealthSchema,
  ProcessHealthSnapshotSchema,
  OperationParams,
  OperationResult,
  RendererOperations,
  SourceSnapshotSchema,
  WorkspaceCatalogSchema,
  WorkspaceSnapshotSchema,
} from "./contracts";

export type AgentStatus = Static<typeof AgentStatusSchema>;
export type AgentRuntime = Static<typeof AgentRuntimeSchema>;
export type AgentActivityKind = Static<typeof AgentActivityKindSchema>;
export type AgentActivity = Static<typeof AgentActivitySchema>;
export type AgentActivityInput = Static<typeof AgentActivityInputSchema>;
export type DocumentSnapshot = Static<typeof DocumentSnapshotSchema>;
export type SourceSnapshot = Static<typeof SourceSnapshotSchema>;
export type WorkspaceCatalog = Static<typeof WorkspaceCatalogSchema>;
export type WorkspaceSnapshot = Static<typeof WorkspaceSnapshotSchema>;
/** Events after durable envelope coordination, plus the ephemeral live channel. */
export type DesktopEvent = Static<typeof DurableEventPayloadSchema> | Static<typeof EphemeralDesktopEventSchema>;
export type DesktopTransportEvent = Static<typeof DesktopEventSchema>;
export type DurableEventEnvelope = Static<typeof DurableEventEnvelopeSchema>;
export type DurableEventPayload = Static<typeof DurableEventPayloadSchema>;
export type EphemeralDesktopEvent = Static<typeof EphemeralDesktopEventSchema>;
export type ObservationSeed = Static<typeof ObservationSeedSchema>;
export type ProcessHealth = Static<typeof ProcessHealthSchema>;
export type ProcessHealthSnapshot = Static<typeof ProcessHealthSnapshotSchema>;
export type { PersistedSuggestionState } from "../suggestions/state";

export type DesktopBridge = {
  subscribeEvents?(): Promise<OperationResult<typeof RendererOperations, "events.subscribe">>;
  getWorkspaceCatalog(): Promise<OperationResult<typeof RendererOperations, "workspace.catalog">>;
  createProject(input: OperationParams<typeof RendererOperations, "project.create">): Promise<OperationResult<typeof RendererOperations, "project.create">>;
  renameProject(input: OperationParams<typeof RendererOperations, "project.rename">): Promise<OperationResult<typeof RendererOperations, "project.rename">>;
  deleteProject(input: OperationParams<typeof RendererOperations, "project.delete">): Promise<OperationResult<typeof RendererOperations, "project.delete">>;
  selectProject(input: OperationParams<typeof RendererOperations, "project.select">): Promise<OperationResult<typeof RendererOperations, "project.select">>;
  createDocument(input: OperationParams<typeof RendererOperations, "document.create">): Promise<OperationResult<typeof RendererOperations, "document.create">>;
  renameDocument(input: OperationParams<typeof RendererOperations, "document.rename">): Promise<OperationResult<typeof RendererOperations, "document.rename">>;
  deleteDocument(input: OperationParams<typeof RendererOperations, "document.delete">): Promise<OperationResult<typeof RendererOperations, "document.delete">>;
  selectDocument(input: OperationParams<typeof RendererOperations, "document.select">): Promise<OperationResult<typeof RendererOperations, "document.select">>;
  hydrate(input: OperationParams<typeof RendererOperations, "hydrate">): Promise<OperationResult<typeof RendererOperations, "hydrate">>;
  replayEvents?(input: OperationParams<typeof RendererOperations, "events.replay">): Promise<OperationResult<typeof RendererOperations, "events.replay">>;
  acknowledgeEvents?(input: OperationParams<typeof RendererOperations, "events.acknowledge">): Promise<OperationResult<typeof RendererOperations, "events.acknowledge">>;
  startAgent(input: OperationParams<typeof RendererOperations, "agent.start">): Promise<OperationResult<typeof RendererOperations, "agent.start">>;
  stopAgent(input: OperationParams<typeof RendererOperations, "agent.stop">): Promise<OperationResult<typeof RendererOperations, "agent.stop">>;
  saveDocument(input: OperationParams<typeof RendererOperations, "document.save">): Promise<OperationResult<typeof RendererOperations, "document.save">>;
  executeSuggestionCommand(input: OperationParams<typeof RendererOperations, "suggestions.command">): Promise<OperationResult<typeof RendererOperations, "suggestions.command">>;
  importSource(input: OperationParams<typeof RendererOperations, "source.import">): Promise<OperationResult<typeof RendererOperations, "source.import">>;
  retryProcess?(input: OperationParams<typeof RendererOperations, "process.retry">): Promise<OperationResult<typeof RendererOperations, "process.retry">>;
  subscribe(listener: (event: DesktopTransportEvent) => void): () => void;
};
