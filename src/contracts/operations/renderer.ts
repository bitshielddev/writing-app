import { Type } from "typebox";

import { identifier, operation, strict, type OperationName } from "../base";
import {
  AgentRuntimeSchema,
  DocumentSnapshotSchema,
  ProcessHealthSnapshotSchema,
  SourceSnapshotSchema,
  SuggestionCommandRequestSchema,
  SuggestionCommandResultSchema,
  WorkspaceCatalogSchema,
  WorkspaceSnapshotSchema,
} from "../events";
import {
  acknowledgeResult,
  documentScope,
  namedDocument,
  namedProject,
  noParams,
  projectIdentity,
  renamedDocument,
  renamedProject,
  replayParams,
  replayResult,
  saveDocumentParams,
} from "./common";

const rendererAcknowledgeParams = Type.Object({
  projectId: identifier,
  documentId: identifier,
  streamId: identifier,
  sequence: Type.Integer({ minimum: 0 }),
}, strict);

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
  "process.retry": operation(Type.Object({ process: Type.Union([Type.Literal("storage"), Type.Literal("agent")]) }, strict), ProcessHealthSnapshotSchema),
} as const;

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
  retryProcess: "scribe:process.retry",
} as const;
export const DESKTOP_EVENT_CHANNEL = "scribe:event" as const;
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
  "process.retry": DESKTOP_INVOKE_CHANNELS.retryProcess,
} as const satisfies Record<OperationName<typeof RendererOperations>, string>;
