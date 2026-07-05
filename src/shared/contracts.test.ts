import { describe, expect, it } from "vitest";
import { Check } from "typebox/schema";

import {
  AGENT_PARENT_MESSAGE_KINDS,
  AGENT_RPC_METHODS,
  CHILD_MESSAGE_KINDS,
  DESKTOP_EVENT_TYPES,
  DESKTOP_INVOKE_CHANNELS,
  STORAGE_RPC_METHODS,
  AgentOperations,
  DesktopEventSchema,
  RendererOperations,
  StorageOperations,
  StorageRpcRequestSchema,
  parseOrContractError,
  toContractError,
} from "./contracts";
import { createDocumentSnapshot, createSourceSnapshot, createWorkspaceSnapshot } from "../test/desktopBridgeHarness";
import { createEmptySuggestionState } from "../suggestions/state";

const suggestion = {
  id: "suggestion",
  dedupeKey: "suggestion",
  kind: "snippet" as const,
  title: "Title",
  summary: "Summary",
  body: "Body",
  insertText: "Text",
  sourceLabels: [],
  createdAt: 1,
};
const document = createDocumentSnapshot();
const source = createSourceSnapshot();
const workspace = createWorkspaceSnapshot();
const state = createEmptySuggestionState();
const accepted = { accepted: true };

const rendererFixtures = {
  hydrate: { params: undefined, result: workspace },
  "agent.start": { params: undefined, result: { status: "working", cycleCount: 1 } },
  "agent.stop": { params: undefined, result: { status: "stopped", cycleCount: 1 } },
  "document.save": { params: { documentId: document.id, blocks: [], markdown: "", expectedRevision: 0 }, result: document },
  "suggestions.save": { params: state, result: undefined },
  "source.import": { params: undefined, result: source },
  "development.suggestion.create": { params: suggestion, result: accepted },
} as const;

const storageFixtures = {
  hydrate: { params: undefined, result: workspace },
  "workspace.repair": { params: undefined, result: { workspaceRoot: "/w", draftPath: "/w/draft.md", sourcesDirectory: "/w/sources", piDirectory: "/w/.pi", repaired: false } },
  "document.save": rendererFixtures["document.save"],
  "suggestions.save": rendererFixtures["suggestions.save"],
  "source.import": { params: { path: "/source.md" }, result: source },
  "agent.seed": { params: undefined, result: { projectId: "project", projectName: "Project", projectRevision: 1, documentId: "document", documentTitle: "Draft", documentRevision: 1 } },
  "agent.suggestions.list": { params: undefined, result: { live: [suggestion], pinned: [], workspace: [] } },
  "agent.suggestion.create": { params: { item: suggestion, expectedDocumentRevision: 1 }, result: accepted },
  "agent.suggestion.update": { params: { item: suggestion, expectedDocumentRevision: 1 }, result: accepted },
  "agent.suggestion.retract": { params: { id: suggestion.id, expectedDocumentRevision: 1 }, result: accepted },
  "development.suggestion.create": { params: { item: suggestion }, result: accepted },
} as const;

const agentFixtures = {
  "agent.start": { params: { projectRevision: 1, documentRevision: 1 }, result: { status: "working", cycleCount: 1 } },
  "agent.stop": { params: undefined, result: { status: "stopped", cycleCount: 1 } },
} as const;

describe("process contract inventory", () => {
  it("tracks every renderer invoke operation", () => {
    expect(DESKTOP_INVOKE_CHANNELS).toEqual({
      hydrate: "scribe:hydrate",
      startAgent: "scribe:agent.start",
      stopAgent: "scribe:agent.stop",
      saveDocument: "scribe:document.save",
      saveSuggestionState: "scribe:suggestions.save",
      importSource: "scribe:source.import",
    });
  });

  it("tracks every storage and agent RPC method", () => {
    expect(STORAGE_RPC_METHODS).toEqual([
      "hydrate",
      "workspace.repair",
      "document.save",
      "suggestions.save",
      "source.import",
      "agent.seed",
      "agent.suggestions.list",
      "agent.suggestion.create",
      "agent.suggestion.update",
      "agent.suggestion.retract",
      "development.suggestion.create",
    ]);
    expect(AGENT_RPC_METHODS).toEqual(["agent.start", "agent.stop"]);
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
    ]);
    expect(Object.keys(DESKTOP_EVENT_TYPES)).toEqual([
      "suggestion.event",
      "agent.runtime",
      "agent.activity",
      "document.saved",
      "source.imported",
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

  it("reports safe bounded validation details without echoing rejected data", () => {
    const secret = "document-content-that-must-not-escape";
    let message = "";
    try {
      parseOrContractError(StorageOperations["document.save"].params, {
        documentId: "document",
        blocks: [],
        markdown: secret,
      }, "test.document-save");
    } catch (error) {
      message = JSON.stringify(error);
    }
    expect(message).toContain("test.document-save");
    expect(message).not.toContain(secret);
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
