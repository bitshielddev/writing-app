// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { WorkspaceSnapshot } from "../../src/shared/desktop";
import type { TextSuggestion } from "../../src/domain/suggestions/schema.js";
import { createStorageService, type StorageService } from "./service";
import { SuggestionRepository } from "./repositories";
import { decideSuggestionCommand } from "../domain/suggestion-persistence";

const item: TextSuggestion = {
  id: "durable-item", dedupeKey: "durable-item", kind: "snippet", title: "Opening",
  summary: "Summary", body: "Body", insertText: "Text", sourceLabels: [], createdAt: 1,
};

describe("suggestion event history and projections", () => {
  let service: StorageService;
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "scribe-suggestion-history-"));
    service = createStorageService({ databasePath: ":memory:", workspaceRoot });
  });

  afterEach(async () => {
    service.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("atomically stores commands, immutable facts, and the rebuilt projection", async () => {
    const initial = await service.handleRequest("hydrate") as WorkspaceSnapshot;
    await service.handleRequest("agent.suggestion.create", {
      item, expectedDocumentRevision: initial.document.revision,
    });
    const published = await service.handleRequest("hydrate") as WorkspaceSnapshot;
    const request = { commandId: "pin-command", documentId: published.document.id,
      expectedSuggestionRevision: published.suggestionRevision,
      command: { type: "pin", suggestionId: item.id, pinnedAt: 10 } };
    const first = await service.handleRequest("suggestions.command", request);
    expect(await service.handleRequest("suggestions.command", request)).toEqual(first);

    const counts = service.database.db.prepare(`SELECT
      (SELECT COUNT(*) FROM suggestion_event_history) AS events,
      (SELECT COUNT(*) FROM suggestion_command_receipts) AS receipts`).get();
    expect(counts).toEqual({ events: 2, receipts: 2 });
    expect(service.database.db.prepare(`SELECT COUNT(*) AS count FROM event_outbox
      WHERE suggestion_event_id IS NOT NULL AND event_json IS NULL`).get()).toEqual({ count: 2 });
    const replay = await service.handleRequest("events.replay", {
      streamId: initial.streamId, afterSequence: 0, limit: 10,
    }) as { events: Array<{ payload: { type: string; state: WorkspaceSnapshot["suggestions"] } }> };
    expect(replay.events).toHaveLength(2);
    expect(replay.events[0]?.payload.state.entries).toHaveLength(1);
    expect(replay.events[0]?.payload.state.pinnedEntries).toHaveLength(0);
    expect(replay.events[1]?.payload.state.pinnedEntries).toHaveLength(1);
    expect(service.suggestionMaintenance.verify(initial.project.id, initial.document.id))
      .toMatchObject({ valid: true, coverage: 2 });
    expect(service.suggestionMaintenance.diagnostics(initial.project.id, initial.document.id))
      .toMatchObject({ eventCount: 2, projectionMismatch: false });
  });

  it("rolls back history and projection together on transaction failure", async () => {
    const initial = await service.handleRequest("hydrate") as WorkspaceSnapshot;
    const suggestions = new SuggestionRepository(service.database.db);
    const current = suggestions.get(initial.project.id, initial.document.id);
    const command = { commandId: "rolled-back", projectId: initial.project.id,
      documentId: initial.document.id, actor: { type: "agent" as const }, version: 1 as const,
      command: { type: "publish" as const, item }, expectedSuggestionRevision: current.revision,
      expectedDocumentRevision: initial.document.revision, requestedAt: 10 };
    const decision = decideSuggestionCommand(current.state, command.command);
    if (decision.status !== "changed") throw new Error("expected changed decision");

    expect(() => service.database.run(() => {
      suggestions.appendFacts(command, decision.facts, ["rolled-back-event"]);
      throw new Error("crash after projection write");
    })).toThrow("crash after projection write");
    expect(suggestions.get(initial.project.id, initial.document.id)).toMatchObject({ revision: 0,
      coveredThroughSequence: 0 });
    expect(service.database.db.prepare("SELECT COUNT(*) AS count FROM suggestion_event_history").get())
      .toEqual({ count: 0 });
  });

  it("preserves the current projection when history or a checkpoint is invalid", async () => {
    const initial = await service.handleRequest("hydrate") as WorkspaceSnapshot;
    await service.handleRequest("agent.suggestion.create", {
      item, expectedDocumentRevision: initial.document.revision,
    });
    const before = await service.handleRequest("hydrate") as WorkspaceSnapshot;
    const checkpoint = service.suggestionMaintenance.checkpoint(initial.project.id, initial.document.id);
    expect(checkpoint).toMatchObject({ sequence: 1 });
    service.database.db.prepare("UPDATE suggestion_projection_checkpoint SET checksum = 'invalid'").run();
    expect(() => service.suggestionMaintenance.verify(initial.project.id, initial.document.id))
      .toThrow("INVALID_SUGGESTION_CHECKPOINT_CHECKSUM");
    const after = await service.handleRequest("hydrate") as WorkspaceSnapshot;
    expect(after.suggestions).toEqual(before.suggestions);
  });
});
