import { Type } from "typebox";

import { identifier, operation, revision, strict, text, type OperationName } from "../base";
import { SuggestionItemSchema } from "../../domain/suggestions/schema";
import {
  AgentDocumentReadResultSchema,
  DocumentSnapshotSchema,
  ObservationSeedSchema,
  SourceSnapshotSchema,
  SuggestionCommandRequestSchema,
  SuggestionCommandResultSchema,
  WorkspaceCatalogSchema,
  WorkspaceSnapshotSchema,
} from "../events";
import {
  accepted,
  acknowledgeResult,
  documentScope,
  healthResult,
  namedDocument,
  namedProject,
  noParams,
  projectIdentity,
  renamedDocument,
  renamedProject,
  replayParams,
  replayResult,
  saveDocumentParams,
  suggestionMutation,
} from "./common";

export const StorageOperations = {
  "health.ping": operation(noParams, healthResult),
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
  "document.save": operation(saveDocumentParams, DocumentSnapshotSchema),
  "suggestions.command": operation(SuggestionCommandRequestSchema, SuggestionCommandResultSchema),
  "source.import": operation(Type.Object({ ...documentScope.properties, path: text(10_000) }, strict), SourceSnapshotSchema),
  "agent.seed": operation(documentScope, ObservationSeedSchema),
  "agent.document.read": operation(documentScope, AgentDocumentReadResultSchema),
  "agent.suggestions.list": operation(documentScope, Type.Object({
    live: Type.Array(SuggestionItemSchema), pinned: Type.Array(SuggestionItemSchema),
    workspace: Type.Array(SuggestionItemSchema),
  }, strict)),
  "agent.suggestion.create": operation(suggestionMutation, accepted),
  "agent.suggestion.update": operation(suggestionMutation, accepted),
  "agent.suggestion.retract": operation(Type.Object({ ...documentScope.properties, id: identifier, expectedDocumentRevision: revision }, strict), accepted),
} as const;

export const STORAGE_RPC_METHODS = Object.keys(StorageOperations) as OperationName<typeof StorageOperations>[];
export type StorageRpcMethod = OperationName<typeof StorageOperations>;
