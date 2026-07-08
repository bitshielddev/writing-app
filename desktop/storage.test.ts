// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createStorageService, type StorageService } from "./storage/service";
import type { SourceSnapshot, WorkspaceSnapshot } from "../src/shared/desktop";
import type { TextSuggestion } from "../src/suggestions/types";

describe("desktop storage service", () => {
  let service: StorageService;
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "scribe-storage-test-"));
    service = createStorageService({ databasePath: ":memory:", workspaceRoot });
    await service.operations.repairWorkspace();
  });

  afterEach(async () => {
    service.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const handleStorageRequest = (method: string, params?: unknown) =>
    service.handleRequest(method, params);

  it("saves block JSON and Markdown before returning the durable revision", async () => {
    const initial = await handleStorageRequest("hydrate") as WorkspaceSnapshot;
    const saved = await handleStorageRequest("document.save", {
      documentId: initial.document.id,
      expectedRevision: initial.document.revision,
      blocks: [{ type: "paragraph", content: "Persisted draft" }],
      markdown: "Persisted draft\n",
    }) as WorkspaceSnapshot["document"];

    expect(saved.revision).toBe(initial.document.revision + 1);
    expect(saved.markdown).toBe("Persisted draft\n");
    expect(await readFile(service.paths.draftPath, "utf8"))
      .toBe("Persisted draft\n");
  });

  it("repairs a damaged draft mirror from SQLite", async () => {
    const { draftPath } = service.paths;
    await writeFile(draftPath, "damaged mirror", "utf8");
    const result = await handleStorageRequest("workspace.repair") as { repaired: boolean };
    const snapshot = await handleStorageRequest("hydrate") as WorkspaceSnapshot;

    expect(result.repaired).toBe(true);
    expect(await readFile(draftPath, "utf8")).toBe(snapshot.document.markdown);
  });

  it("persists suggestions and rejects stale mutations", async () => {
    const snapshot = await handleStorageRequest("hydrate") as WorkspaceSnapshot;
    const item: TextSuggestion = {
      id: "agent-suggestion",
      dedupeKey: "agent-suggestion",
      kind: "snippet",
      title: "Tighten the opening",
      summary: "A more direct opening sentence.",
      body: "This removes the introductory hedge.",
      insertText: "Start with the central claim.",
      sourceLabels: ["draft.md"],
      createdAt: 10,
    };

    await expect(handleStorageRequest("agent.suggestion.create", {
      item,
      expectedDocumentRevision: snapshot.document.revision + 1,
    })).rejects.toThrow("STALE_SUGGESTION_REVISION");
    await handleStorageRequest("agent.suggestion.create", {
      item,
      expectedDocumentRevision: snapshot.document.revision,
    });
    const hydrated = await handleStorageRequest("hydrate") as WorkspaceSnapshot;
    expect(hydrated.suggestions.entries[0]?.item).toEqual(item);
  });

  it("deduplicates commands and returns authoritative state on revision conflicts", async () => {
    const snapshot = await handleStorageRequest("hydrate") as WorkspaceSnapshot;
    const item: TextSuggestion = { id: "command-item", dedupeKey: "command-item", kind: "snippet",
      title: "Command item", summary: "Summary", body: "Body", insertText: "Text", sourceLabels: [], createdAt: 1 };
    await handleStorageRequest("agent.suggestion.create", { item, expectedDocumentRevision: snapshot.document.revision });
    const current = await handleStorageRequest("hydrate") as WorkspaceSnapshot;
    const request = { commandId: "pin-once", documentId: current.document.id,
      expectedSuggestionRevision: current.suggestionRevision,
      command: { type: "pin", suggestionId: item.id, pinnedAt: 10 } };
    const first = await handleStorageRequest("suggestions.command", request);
    const duplicate = await handleStorageRequest("suggestions.command", request);
    expect(duplicate).toEqual(first);
    const after = await handleStorageRequest("hydrate") as WorkspaceSnapshot;
    expect(after.suggestions.pinnedEntries).toHaveLength(1);
    expect(after.suggestionRevision).toBe(current.suggestionRevision + 1);

    const conflict = await handleStorageRequest("suggestions.command", {
      commandId: "stale-dismiss", documentId: current.document.id,
      expectedSuggestionRevision: current.suggestionRevision,
      command: { type: "dismiss", suggestionId: item.id },
    }) as { status: string; suggestionRevision: number; state: typeof after.suggestions };
    expect(conflict).toMatchObject({ status: "conflict", suggestionRevision: after.suggestionRevision });
    expect(conflict.state.pinnedEntries).toHaveLength(1);
  });

  it("handles every suggestion, seed, and projection RPC method", async () => {
    const snapshot = await handleStorageRequest("hydrate") as WorkspaceSnapshot;
    const seed = await handleStorageRequest("agent.seed") as {
      projectRevision: number;
      documentRevision: number;
    };
    expect(seed.documentRevision).toBe(snapshot.document.revision);

    const initialItem: TextSuggestion = {
      id: "rpc-suggestion",
      dedupeKey: "rpc-suggestion",
      kind: "snippet",
      title: "Initial title",
      summary: "Summary",
      body: "Body",
      insertText: "Insert",
      sourceLabels: [],
      createdAt: 20,
    };
    await handleStorageRequest("agent.suggestion.create", {
      item: initialItem,
      expectedDocumentRevision: snapshot.document.revision,
    });
    const listed = await handleStorageRequest("agent.suggestions.list") as {
      live: TextSuggestion[];
    };
    const existing = listed.live[0];
    expect(existing).toBeTruthy();
    const updated = { ...existing!, title: "Updated title" };
    await expect(
      handleStorageRequest("agent.suggestion.update", {
        item: updated,
        expectedDocumentRevision: snapshot.document.revision,
      }),
    ).resolves.toEqual({ accepted: true });
    await expect(
      handleStorageRequest("agent.suggestion.retract", {
        id: updated.id,
        expectedDocumentRevision: snapshot.document.revision,
      }),
    ).resolves.toEqual({ accepted: true });

    await expect(handleStorageRequest("unknown.method")).rejects.toThrow(
      "Unknown storage operation",
    );
  });

  it("imports only UTF-8 Markdown with readable collision-safe filenames", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scribe-source-"));
    const path = join(directory, "research notes.md");
    await writeFile(path, "A durable Markdown source.");
    try {
      const first = await handleStorageRequest("source.import", { path }) as SourceSnapshot;
      const second = await handleStorageRequest("source.import", { path }) as SourceSnapshot;
      expect(first.title).toBe("research notes.md");
      expect(second.title).toBe("research notes (2).md");
      expect(await readFile(second.storagePath, "utf8")).toBe("A durable Markdown source.");
      expect(first.bytes).toBeGreaterThan(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects unsupported extensions and invalid UTF-8", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scribe-source-invalid-"));
    const textPath = join(directory, "notes.txt");
    const invalidPath = join(directory, "invalid.md");
    await writeFile(textPath, "plain text");
    await writeFile(invalidPath, Buffer.from([0xc3, 0x28]));
    try {
      await expect(handleStorageRequest("source.import", { path: textPath }))
        .rejects.toThrow("Only .md and .markdown");
      await expect(handleStorageRequest("source.import", { path: invalidPath }))
        .rejects.toThrow("valid UTF-8");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("replays retained events in pages and keeps consumer cursors independent and monotonic", async () => {
    const initial = await handleStorageRequest("hydrate") as WorkspaceSnapshot;
    await handleStorageRequest("document.save", {
      documentId: initial.document.id, expectedRevision: initial.document.revision,
      blocks: [{ type: "paragraph", content: "one" }], markdown: "one\n",
    });
    await handleStorageRequest("document.save", {
      documentId: initial.document.id, expectedRevision: initial.document.revision + 1,
      blocks: [{ type: "paragraph", content: "two" }], markdown: "two\n",
    });

    const first = await handleStorageRequest("events.replay", {
      streamId: initial.streamId, afterSequence: 0, limit: 1,
    }) as { events: Array<{ sequence: number }>; hasMore: boolean; headSequence: number };
    const second = await handleStorageRequest("events.replay", {
      streamId: initial.streamId, afterSequence: 1, limit: 1,
    }) as typeof first;
    expect(first).toMatchObject({ headSequence: 2, hasMore: true });
    expect(first.events.map((event) => event.sequence)).toEqual([1]);
    expect(second.events.map((event) => event.sequence)).toEqual([2]);
    expect((service.database.db.prepare("SELECT count(*) AS count FROM event_outbox")
      .get() as { count: number }).count).toBe(2);

    const acknowledge = (consumerId: string, sequence: number) => handleStorageRequest(
      "events.acknowledge", { consumerId, streamId: initial.streamId, sequence },
    ) as Promise<{ acknowledgedSequence: number }>;
    expect(await acknowledge("renderer-a", 2)).toMatchObject({ acknowledgedSequence: 2 });
    expect(await acknowledge("renderer-a", 1)).toMatchObject({ acknowledgedSequence: 2 });
    expect(await acknowledge("renderer-b", 1)).toMatchObject({ acknowledgedSequence: 1 });
  });
});
