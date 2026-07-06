// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceSnapshot } from "../../src/shared/desktop";
import { createStorageService, type StorageService } from "./service";
import {
  DocumentRepository,
  OutboxRepository,
  ProjectRepository,
  SuggestionRepository,
} from "./repositories";
import type { WorkspaceFiles } from "../application/storage-ports";
import { NodeWorkspaceFiles } from "./workspace-files";

const workspaces: string[] = [];
const services: StorageService[] = [];

async function service(
  publishEvent?: Parameters<typeof createStorageService>[0]["publishEvent"],
) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "scribe-storage-layer-"));
  workspaces.push(workspaceRoot);
  const instance = createStorageService({ databasePath: ":memory:", workspaceRoot, publishEvent });
  services.push(instance);
  await instance.operations.repairWorkspace();
  return instance;
}

afterEach(async () => {
  services.splice(0).forEach((instance) => instance.close());
  await Promise.all(workspaces.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

describe("storage database and repositories", () => {
  it("maps records, reports missing records, and commits or rolls back explicitly", async () => {
    const instance = await service();
    const projects = new ProjectRepository(instance.database.db);
    const documents = new DocumentRepository(instance.database.db);
    const selected = instance.operations.catalog().selection;

    expect(projects.get(selected.projectId)).toMatchObject({ revision: 0 });
    expect(documents.get(selected.documentId)).toMatchObject({ markdown: "# New Page\n" });
    expect(() => projects.get("missing")).toThrow("Project not found: missing");
    expect(() => documents.get("missing")).toThrow("Document not found: missing");

    expect(() => instance.database.run(() => {
      projects.incrementRevision(selected.projectId, 1);
      throw new Error("rollback");
    })).toThrow("rollback");
    expect(projects.get(selected.projectId).revision).toBe(0);

    instance.database.run(() => projects.incrementRevision(selected.projectId, 2));
    expect(projects.get(selected.projectId).revision).toBe(1);
  });

  it("keeps independently created storage instances isolated", async () => {
    const first = await service();
    const second = await service();
    const initial = await first.handleRequest("hydrate") as WorkspaceSnapshot;
    await first.handleRequest("document.save", {
      documentId: initial.document.id,
      expectedRevision: initial.document.revision,
      blocks: [{ type: "paragraph", content: "Only first" }],
      markdown: "Only first\n",
    });

    const untouched = await second.handleRequest("hydrate") as WorkspaceSnapshot;
    expect(untouched.document.markdown).toBe("# New Page\n");
    expect(untouched.document.revision).toBe(0);
  });

  it("rejects malformed persisted document, suggestion, and outbox JSON at load", async () => {
    const instance = await service();
    const db = instance.database.db;
    const documents = new DocumentRepository(db);
    const suggestions = new SuggestionRepository(db);
    const outbox = new OutboxRepository(db);
    const selected = instance.operations.catalog().selection;

    db.prepare("UPDATE documents SET blocks_json = ? WHERE id = ?")
      .run("not-json", selected.documentId);
    expect(() => documents.get(selected.documentId))
      .toThrow("Invalid persisted scribe.blocks JSON");
    db.prepare("UPDATE documents SET blocks_json = ? WHERE id = ?")
      .run("[]", selected.documentId);

    db.prepare("UPDATE suggestion_projection SET state_json = ? WHERE project_id = ?")
      .run(JSON.stringify({ entries: [] }), selected.projectId);
    expect(() => suggestions.get(selected.projectId))
      .toThrow("Invalid data at persisted.suggestion-projection");

    db.prepare(`INSERT INTO event_outbox
      (event_id, project_id, document_id, stream_id, sequence, event_json, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("invalid-event", selected.projectId, selected.documentId, `document:${selected.documentId}`, 1,
        JSON.stringify({ type: "unknown" }), 1, 1);
    expect(outbox.pending()).toEqual([]);
    expect(db.prepare(`SELECT format_name, record_identity, error_code
      FROM durable_json_quarantine WHERE record_identity = ?`).get("invalid-event"))
      .toEqual({
        format_name: "scribe.event",
        record_identity: "invalid-event",
        error_code: "DURABLE_JSON_INVALID",
      });
  });

  it("upgrades legacy envelopes once after validation and keeps the upgrade idempotent", async () => {
    const instance = await service();
    const db = instance.database.db;
    const documents = new DocumentRepository(db);
    const suggestions = new SuggestionRepository(db);
    const selected = instance.operations.catalog().selection;
    const legacyBlocks = JSON.stringify([{ type: "paragraph", content: "legacy" }]);
    const legacyState = JSON.stringify({
      entries: [], pinnedEntries: [], workspacePins: [], seenKeys: {}, nextZIndex: 1,
    });
    db.prepare("UPDATE documents SET blocks_json = ? WHERE id = ?")
      .run(legacyBlocks, selected.documentId);
    db.prepare("UPDATE suggestion_projection SET state_json = ? WHERE project_id = ?")
      .run(legacyState, selected.projectId);

    expect(documents.get(selected.documentId).blocks).toHaveLength(1);
    expect(suggestions.get(selected.projectId).state.entries).toEqual([]);
    const upgradedBlocks = (db.prepare("SELECT blocks_json FROM documents WHERE id = ?")
      .get(selected.documentId) as { blocks_json: string }).blocks_json;
    const upgradedState = (db.prepare("SELECT state_json FROM suggestion_projection WHERE project_id = ?")
      .get(selected.projectId) as { state_json: string }).state_json;
    expect(JSON.parse(upgradedBlocks)).toMatchObject({ format: "scribe.blocks", version: 1 });
    expect(JSON.parse(upgradedState)).toMatchObject({
      format: "scribe.suggestion-projection", version: 1,
    });

    documents.get(selected.documentId);
    suggestions.get(selected.projectId);
    expect((db.prepare("SELECT blocks_json FROM documents WHERE id = ?")
      .get(selected.documentId) as { blocks_json: string }).blocks_json).toBe(upgradedBlocks);
    expect((db.prepare("SELECT state_json FROM suggestion_projection WHERE project_id = ?")
      .get(selected.projectId) as { state_json: string }).state_json).toBe(upgradedState);
  });

  it("preserves future blocks and quarantines them exactly once", async () => {
    const instance = await service();
    const db = instance.database.db;
    const documents = new DocumentRepository(db);
    const selected = instance.operations.catalog().selection;
    const source = JSON.stringify({
      format: "scribe.blocks", version: 99,
      blocks: [{ type: "paragraph", content: "future" }],
    });
    db.prepare("UPDATE documents SET blocks_json = ? WHERE id = ?")
      .run(source, selected.documentId);

    expect(() => documents.get(selected.documentId)).toThrow("requires a newer ScribeAI release");
    expect(() => documents.get(selected.documentId)).toThrow();
    expect((db.prepare("SELECT blocks_json FROM documents WHERE id = ?")
      .get(selected.documentId) as { blocks_json: string }).blocks_json).toBe(source);
    expect(db.prepare(`SELECT source_text, count(*) AS count FROM durable_json_quarantine
      WHERE format_name = ? AND record_identity = ?`).get("scribe.blocks", selected.documentId))
      .toEqual({ source_text: source, count: 1 });
  });

  it("preserves an unknown event and does not project known history beyond the gap", async () => {
    const instance = await service();
    const db = instance.database.db;
    const outbox = new OutboxRepository(db);
    const selected = instance.operations.catalog().selection;
    const future = JSON.stringify({ format: "scribe.event", version: 99, event: { opaque: true } });
    db.prepare(`INSERT INTO event_outbox
      (event_id, project_id, document_id, stream_id, sequence, event_json, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "future-event", selected.projectId, selected.documentId, `document:${selected.documentId}`, 1, future, 1, 1,
    );
    outbox.enqueue({
      type: "suggestion.event",
      event: { type: "suggestion.state.changed", suggestionId: "later", commandType: "dismiss" },
      suggestionRevision: 1,
      state: { entries: [], pinnedEntries: [], workspacePins: [], seenKeys: {}, nextZIndex: 1 },
    });

    expect(outbox.pending()).toEqual([]);
    expect(outbox.replay(`document:${selected.documentId}`, 0).events).toEqual([]);
    expect((db.prepare(`SELECT count(*) AS count FROM durable_json_quarantine
      WHERE record_identity = ?`).get("future-event") as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT event_json FROM event_outbox WHERE event_id = ?")
      .get("future-event") as { event_json: string }).event_json).toBe(future);
  });
});

describe("storage operation consistency", () => {
  it("does not mutate the database when the draft write fails", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "scribe-storage-layer-"));
    workspaces.push(workspaceRoot);
    const instance = createStorageService({
      databasePath: ":memory:",
      workspaceRoot,
      createWorkspaceFiles(paths) {
        const real = new NodeWorkspaceFiles(paths);
        return {
          ensureDirectories: () => real.ensureDirectories(),
          repairDraft: (markdown) => real.repairDraft(markdown),
          copySource: (path) => real.copySource(path),
          removeSource: (path) => real.removeSource(path),
          writeDraft: async () => { throw new Error("draft disk full"); },
        };
      },
    });
    services.push(instance);
    await instance.operations.repairWorkspace();
    const initial = await instance.handleRequest("hydrate") as WorkspaceSnapshot;

    await expect(instance.handleRequest("document.save", {
      documentId: initial.document.id,
      expectedRevision: initial.document.revision,
      blocks: [{ type: "paragraph", content: "Not persisted" }],
      markdown: "Not persisted\n",
    })).rejects.toThrow("draft disk full");
    expect((await instance.handleRequest("hydrate") as WorkspaceSnapshot).document)
      .toEqual(initial.document);
  });

  it("serializes document saves so only one request can consume a revision", async () => {
    const instance = await service();
    const initial = await instance.handleRequest("hydrate") as WorkspaceSnapshot;
    const input = (markdown: string) => ({
      documentId: initial.document.id,
      expectedRevision: initial.document.revision,
      blocks: [{ type: "paragraph", content: markdown.trim() }],
      markdown,
    });

    const results = await Promise.allSettled([
      instance.handleRequest("document.save", input("First\n")),
      instance.handleRequest("document.save", input("Second\n")),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const persisted = (await instance.handleRequest("hydrate") as WorkspaceSnapshot).document;
    expect(["First\n", "Second\n"]).toContain(persisted.markdown);
    expect(await readFile(instance.paths.draftPath, "utf8")).toBe(persisted.markdown);
  });

  it("repairs the draft from the database when the transaction fails after the file write", async () => {
    const instance = await service();
    const initial = await instance.handleRequest("hydrate") as WorkspaceSnapshot;
    instance.database.db.exec(`CREATE TRIGGER reject_document_save
      BEFORE UPDATE ON documents BEGIN SELECT RAISE(ABORT, 'database rejected save'); END`);

    await expect(instance.handleRequest("document.save", {
      documentId: initial.document.id,
      expectedRevision: initial.document.revision,
      blocks: [{ type: "paragraph", content: "Rejected" }],
      markdown: "Rejected\n",
    })).rejects.toThrow("database rejected save");

    expect(await readFile(instance.paths.draftPath, "utf8")).toBe(initial.document.markdown);
    expect((await instance.handleRequest("hydrate") as WorkspaceSnapshot).document)
      .toEqual(initial.document);
  });

  it("leaves outbox rows pending after publication failure and dispatches them on retry", async () => {
    let shouldFail = true;
    const published: unknown[] = [];
    const instance = await service((event) => {
      if (shouldFail) throw new Error("publisher unavailable");
      published.push(event);
    });
    const initial = await instance.handleRequest("hydrate") as WorkspaceSnapshot;

    await expect(instance.handleRequest("document.save", {
      documentId: initial.document.id,
      expectedRevision: initial.document.revision,
      blocks: [{ type: "paragraph", content: "Committed" }],
      markdown: "Committed\n",
    })).rejects.toThrow("publisher unavailable");

    expect((await instance.handleRequest("hydrate") as WorkspaceSnapshot).document.markdown)
      .toBe("Committed\n");
    expect((instance.database.db.prepare(
      "SELECT count(*) AS count FROM event_outbox WHERE dispatched_at IS NULL",
    ).get() as { count: number }).count).toBe(1);

    shouldFail = false;
    await Promise.all([
      instance.dispatchPendingEvents(),
      instance.dispatchPendingEvents(),
    ]);
    expect(published).toHaveLength(1);
    expect((instance.database.db.prepare(
      "SELECT count(*) AS count FROM event_outbox WHERE dispatched_at IS NULL",
    ).get() as { count: number }).count).toBe(0);
  });

  it("logs the recovery path when source cleanup fails after a database failure", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "scribe-storage-layer-"));
    workspaces.push(workspaceRoot);
    const inputPath = join(workspaceRoot, "input.md");
    await writeFile(inputPath, "source");
    const error = vi.fn();
    let copiedPath = "";
    const instance = createStorageService({
      databasePath: ":memory:",
      workspaceRoot,
      logger: { error },
      createWorkspaceFiles(paths) {
        const real = new NodeWorkspaceFiles(paths);
        const files: WorkspaceFiles = {
          writeDraft: (markdown) => real.writeDraft(markdown),
          repairDraft: (markdown) => real.repairDraft(markdown),
          async copySource(path) {
            const copied = await real.copySource(path);
            copiedPath = copied.destination;
            return copied;
          },
          removeSource: async () => { throw new Error("cleanup denied"); },
        };
        return files;
      },
    });
    services.push(instance);
    await instance.operations.repairWorkspace();
    instance.database.db.exec(`CREATE TRIGGER reject_source
      BEFORE INSERT ON sources BEGIN SELECT RAISE(ABORT, 'source database failure'); END`);

    await expect(instance.handleRequest("source.import", { path: inputPath }))
      .rejects.toThrow("source database failure");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(copiedPath),
      expect.objectContaining({ message: "cleanup denied" }),
    );
    expect(await readFile(copiedPath, "utf8")).toBe("source");
  });
});
