import type { Static } from "typebox";

import type { SuggestionItem } from "../suggestions/types";
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
  OperationParams,
  OperationResult,
  RendererOperations,
  SourceSnapshotSchema,
  WorkspaceSnapshotSchema,
} from "./contracts";

export type AgentStatus = Static<typeof AgentStatusSchema>;
export type AgentRuntime = Static<typeof AgentRuntimeSchema>;
export type AgentActivityKind = Static<typeof AgentActivityKindSchema>;
export type AgentActivity = Static<typeof AgentActivitySchema>;
export type AgentActivityInput = Static<typeof AgentActivityInputSchema>;
export type DocumentSnapshot = Static<typeof DocumentSnapshotSchema>;
export type SourceSnapshot = Static<typeof SourceSnapshotSchema>;
export type WorkspaceSnapshot = Static<typeof WorkspaceSnapshotSchema>;
/** Events after durable envelope coordination, plus the ephemeral live channel. */
export type DesktopEvent = Static<typeof DurableEventPayloadSchema> | Static<typeof EphemeralDesktopEventSchema>;
export type DesktopTransportEvent = Static<typeof DesktopEventSchema>;
export type DurableEventEnvelope = Static<typeof DurableEventEnvelopeSchema>;
export type DurableEventPayload = Static<typeof DurableEventPayloadSchema>;
export type EphemeralDesktopEvent = Static<typeof EphemeralDesktopEventSchema>;
export type ObservationSeed = Static<typeof ObservationSeedSchema>;
export type { PersistedSuggestionState } from "../suggestions/state";

export type DesktopBridge = {
  subscribeEvents?(): Promise<OperationResult<typeof RendererOperations, "events.subscribe">>;
  hydrate(): Promise<OperationResult<typeof RendererOperations, "hydrate">>;
  replayEvents?(input: OperationParams<typeof RendererOperations, "events.replay">): Promise<OperationResult<typeof RendererOperations, "events.replay">>;
  acknowledgeEvents?(input: OperationParams<typeof RendererOperations, "events.acknowledge">): Promise<OperationResult<typeof RendererOperations, "events.acknowledge">>;
  startAgent(): Promise<OperationResult<typeof RendererOperations, "agent.start">>;
  stopAgent(): Promise<OperationResult<typeof RendererOperations, "agent.stop">>;
  saveDocument(input: OperationParams<typeof RendererOperations, "document.save">): Promise<OperationResult<typeof RendererOperations, "document.save">>;
  executeSuggestionCommand(input: OperationParams<typeof RendererOperations, "suggestions.command">): Promise<OperationResult<typeof RendererOperations, "suggestions.command">>;
  importSource(): Promise<OperationResult<typeof RendererOperations, "source.import">>;
  subscribe(listener: (event: DesktopTransportEvent) => void): () => void;
};

export type DesktopDevelopmentBridge = {
  createSuggestion(item: SuggestionItem): Promise<{ accepted: boolean }>;
};
