import { describe, expect, it } from "vitest";

import {
  AGENT_PARENT_MESSAGE_KINDS,
  AGENT_RPC_METHODS,
  CHILD_MESSAGE_KINDS,
  DESKTOP_EVENT_TYPES,
  DESKTOP_INVOKE_CHANNELS,
  STORAGE_RPC_METHODS,
} from "./contracts";

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
      "startup.error",
      "rpc.result",
      "domain.event",
      "storage.request",
      "agent.runtime",
      "agent.activity",
    ]);
    expect(Object.keys(AGENT_PARENT_MESSAGE_KINDS)).toEqual([
      "project.changed",
      "rpc",
      "storage.result",
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
});
