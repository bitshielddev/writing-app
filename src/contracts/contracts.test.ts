import { describe, expect, it } from "vitest";
import { Check } from "typebox/schema";

import {
  AGENT_PARENT_MESSAGE_KINDS,
  CHILD_MESSAGE_KINDS,
  StorageRpcRequestSchema,
} from "./process-messages";
import {
  AgentActivityInputSchema,
  AgentActivitySchema,
  DESKTOP_EVENT_TYPES,
  DesktopEventSchema,
} from "./events";
import {
  AGENT_RPC_METHODS,
  AgentOperations,
} from "./operations/agent";
import {
  DESKTOP_INVOKE_CHANNELS,
  RendererOperations,
} from "./operations/renderer";
import {
  STORAGE_RPC_METHODS,
  StorageOperations,
} from "./operations/storage";
import {
  parseOrContractError,
  toContractError,
} from "./validation";
import { createDocumentSaveReceipt, createDocumentSnapshot, createSourceSnapshot, createThemeCatalog, createWorkspaceSnapshot } from "../test/desktopBridgeHarness";
import { createEmptySuggestionState } from "../domain/suggestions/state";

const suggestion = {
  id: "suggestion",
  dedupeKey: "suggestion",
  kind: "edit" as const,
  title: "Title",
  summary: "Summary",
  body: "Body",
  sourceDocumentRevision: 1,
  sourceBlockId: "block-1",
  sourceStart: 0,
  sourceEnd: 4,
  sourceText: "Text",
  newText: "New text",
  sourceLabels: [],
  createdAt: 1,
};
const document = createDocumentSnapshot();
const source = createSourceSnapshot();
const workspace = createWorkspaceSnapshot();
const state = createEmptySuggestionState();
const accepted = { accepted: true };
const scope = { projectId: workspace.project.id, documentId: document.id };
const catalog = { projects: [workspace.project], documents: [{ id: document.id,
  projectId: document.projectId, title: document.title, revision: document.revision }], selection: scope };
const health = { storage: { state: "healthy" as const, since: 1 }, agent: { state: "healthy" as const, since: 1 } };
const command = { commandId: "command", ...scope, expectedSuggestionRevision: 0,
  command: { type: "dismiss" as const, suggestionId: suggestion.id } };
const commandResult = { commandId: "command", status: "unchanged" as const, suggestionRevision: 0, state };
const replayResult = { streamId: workspace.streamId, events: [], headSequence: 0,
  hasMore: false, historyAvailable: true };
const documentRead = {
  projectId: document.projectId,
  documentId: document.id,
  title: document.title,
  documentRevision: document.revision,
  schemaVersion: document.schemaVersion,
  blocks: document.blocks,
  plainTextBlocks: [{ id: "block-1", type: "paragraph", text: "Opening" }],
};

const rendererFixtures = {
  "events.subscribe": { params: undefined, result: { consumerId: "consumer" } },
  "workspace.catalog": { params: undefined, result: catalog },
  "theme.catalog": { params: undefined, result: createThemeCatalog() },
  "theme.select": { params: { themeId: "scribe-light" }, result: createThemeCatalog() },
  "project.create": { params: { name: "Project" }, result: catalog },
  "project.rename": { params: { projectId: scope.projectId, name: "Renamed" }, result: catalog },
  "project.delete": { params: { projectId: scope.projectId }, result: catalog },
  "project.select": { params: { projectId: scope.projectId }, result: catalog },
  "document.create": { params: { projectId: scope.projectId, title: "Draft" }, result: catalog },
  "document.rename": { params: { ...scope, title: "Renamed" }, result: catalog },
  "document.delete": { params: scope, result: catalog },
  "document.select": { params: scope, result: catalog },
  hydrate: { params: scope, result: workspace },
  "events.replay": { params: { ...scope, streamId: workspace.streamId, afterSequence: 0 }, result: replayResult },
  "events.acknowledge": { params: { ...scope, streamId: workspace.streamId, sequence: 0 },
    result: { streamId: workspace.streamId, acknowledgedSequence: 0 } },
  "agent.start": { params: scope, result: { status: "working", cycleCount: 1 } },
  "agent.stop": { params: scope, result: { status: "stopped", cycleCount: 1 } },
  "document.save": { params: { ...scope, blocks: [], expectedRevision: 0 }, result: createDocumentSaveReceipt() },
  "suggestions.command": { params: command, result: commandResult },
  "source.import": { params: scope, result: source },
  "process.retry": { params: { process: "storage" as const }, result: health },
} as const;

const storageFixtures = {
  "health.ping": { params: undefined, result: { respondedAt: 1, databaseReadable: true } },
  "workspace.catalog": rendererFixtures["workspace.catalog"],
  "project.create": rendererFixtures["project.create"],
  "project.rename": rendererFixtures["project.rename"],
  "project.delete": rendererFixtures["project.delete"],
  "project.select": rendererFixtures["project.select"],
  "document.create": rendererFixtures["document.create"],
  "document.rename": rendererFixtures["document.rename"],
  "document.delete": rendererFixtures["document.delete"],
  "document.select": rendererFixtures["document.select"],
  hydrate: rendererFixtures.hydrate,
  "events.replay": rendererFixtures["events.replay"],
  "events.acknowledge": { params: { consumerId: "consumer", ...scope, streamId: workspace.streamId, sequence: 0 },
    result: { streamId: workspace.streamId, acknowledgedSequence: 0 } },
  "document.save": rendererFixtures["document.save"],
  "suggestions.command": rendererFixtures["suggestions.command"],
  "source.import": { params: { ...scope, path: "/source.md" }, result: source },
  "agent.seed": { params: scope, result: { streamId: workspace.streamId,
    coveredThroughSequence: 0, projectId: "project", projectName: "Project",
    projectRevision: 1, documentId: "document", documentTitle: "Draft", documentRevision: 1 } },
  "agent.document.read": { params: scope, result: documentRead },
  "agent.suggestions.list": { params: scope, result: { live: [suggestion], pinned: [], workspace: [] } },
  "agent.suggestion.create": { params: { ...scope, item: suggestion, expectedDocumentRevision: 1 }, result: accepted },
  "agent.suggestion.update": { params: { ...scope, item: suggestion, expectedDocumentRevision: 1 }, result: accepted },
  "agent.suggestion.retract": { params: { ...scope, id: suggestion.id, expectedDocumentRevision: 1 }, result: accepted },
} as const;

const agentFixtures = {
  "health.ping": { params: undefined, result: { respondedAt: 1 } },
  "agent.start": { params: { ...scope, projectRevision: 1, documentRevision: 1 }, result: { status: "working", cycleCount: 1 } },
  "agent.stop": { params: scope, result: { status: "stopped", cycleCount: 1 } },
} as const;

describe("process contract inventory", () => {
  it("tracks every renderer invoke operation", () => {
    expect(DESKTOP_INVOKE_CHANNELS).toEqual({
      subscribeEvents: "scribe:events.subscribe",
      workspaceCatalog: "scribe:workspace.catalog",
      themeCatalog: "scribe:theme.catalog",
      selectTheme: "scribe:theme.select",
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
    });
  });

  it("tracks every storage and agent RPC method", () => {
    expect(STORAGE_RPC_METHODS).toEqual([
      "health.ping", "workspace.catalog",
      "project.create", "project.rename", "project.delete", "project.select",
      "document.create", "document.rename", "document.delete", "document.select",
      "hydrate",
      "events.replay",
      "events.acknowledge",
      "document.save",
      "suggestions.command",
      "source.import",
      "agent.seed",
      "agent.document.read",
      "agent.suggestions.list",
      "agent.suggestion.create",
      "agent.suggestion.update",
      "agent.suggestion.retract",
    ]);
    expect(AGENT_RPC_METHODS).toEqual(["health.ping", "agent.start", "agent.stop"]);
  });

  it("tracks every child, parent, and desktop event variant", () => {
    expect(Object.keys(CHILD_MESSAGE_KINDS)).toEqual([
      "ready",
      "health",
      "startup.error",
      "rpc.success",
      "rpc.failure",
      "domain.event",
      "storage.request",
      "agent.runtime",
      "agent.activity",
    ]);
    expect(Object.keys(AGENT_PARENT_MESSAGE_KINDS)).toEqual([
      "rpc",
      "storage.success",
      "storage.failure",
      "project.changed",
      "shutdown",
      "rpc.cancel",
    ]);
    expect(Object.keys(DESKTOP_EVENT_TYPES)).toEqual([
      "suggestion.event",
      "agent.runtime",
      "agent.activity",
      "document.saved",
      "source.imported",
      "process.health",
    ]);
  });

  it("validates every registry operation from its single schema owner", () => {
    for (const [name, definition] of Object.entries(RendererOperations)) {
      const fixture = rendererFixtures[name as keyof typeof rendererFixtures];
      expect(Check(definition.params, fixture.params), `${name} params`).toBe(true);
      expect(Check(definition.result, fixture.result), `${name} result`).toBe(true);
    }
    for (const [name, definition] of Object.entries(StorageOperations)) {
      const fixture = storageFixtures[name as keyof typeof storageFixtures];
      expect(Check(definition.params, fixture.params), `${name} params`).toBe(true);
      expect(Check(definition.result, fixture.result), `${name} result`).toBe(true);
    }
    for (const [name, definition] of Object.entries(AgentOperations)) {
      const fixture = agentFixtures[name as keyof typeof agentFixtures];
      expect(Check(definition.params, fixture.params), `${name} params`).toBe(true);
      expect(Check(definition.result, fixture.result), `${name} result`).toBe(true);
    }
  });

  it("rejects extra fields, unknown variants, and unsupported protocol versions", () => {
    for (const [name, definition] of Object.entries(StorageOperations)) {
      const fixture = storageFixtures[name as keyof typeof storageFixtures].params;
      const invalid = fixture === undefined ? { unexpected: true } : { ...fixture, unexpected: true };
      expect(Check(definition.params, invalid), name).toBe(false);
    }
    expect(Check(StorageRpcRequestSchema, {
      kind: "rpc", protocolVersion: 2, id: "request", operation: "hydrate", params: undefined,
    })).toBe(false);
    expect(Check(StorageRpcRequestSchema, {
      kind: "rpc", protocolVersion: 1, id: "request", operation: "unknown", params: undefined,
    })).toBe(false);
    expect(Check(DesktopEventSchema, { type: "unknown" })).toBe(false);
  });

  it("rejects raw and debug-only agent activity fields", () => {
    const activity = {
      id: "activity",
      kind: "message",
      timestamp: 1,
      title: "Message",
    };
    expect(Check(AgentActivityInputSchema, activity)).toBe(true);
    expect(Check(AgentActivitySchema, { ...activity, updatedAt: 2 })).toBe(true);
    expect(Check(AgentActivityInputSchema, {
      ...activity,
      payload: { raw: true },
    })).toBe(false);
    expect(Check(AgentActivityInputSchema, {
      ...activity,
      kind: "reasoning",
    })).toBe(false);
    expect(Check(AgentActivityInputSchema, {
      ...activity,
      kind: "provider",
    })).toBe(false);
  });

  it("reports safe bounded validation details without echoing rejected data", () => {
    const secret = { secret: "document-content-that-must-not-escape" };
    let message = "";
    try {
      parseOrContractError(StorageOperations["document.save"].params, {
        documentId: "document",
        blocks: [secret],
      }, "test.document-save");
    } catch (error) {
      message = JSON.stringify(error);
    }
    expect(message).toContain("test.document-save");
    expect(message).not.toContain(secret.secret);
  });

  it("maps domain failures to stable structured errors", () => {
    expect(toContractError(new Error("DOCUMENT_REVISION_CONFLICT"))).toEqual({
      code: "DOCUMENT_REVISION_CONFLICT",
      message: "The document changed before it could be saved",
      retryable: true,
    });
    expect(toContractError(new Error("SQL SELECT secret"))).toEqual({
      code: "INTERNAL_ERROR",
      message: "The operation could not be completed",
      retryable: false,
    });
  });
});
