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
import { NodeWorkspaceFiles, type WorkspaceFiles } from "./workspace-files";

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

    expect(projects.get("default-project")).toMatchObject({ revision: 0 });
    expect(documents.get("default-document")).toMatchObject({ markdown: "# New Page\n" });
    expect(() => projects.get("missing")).toThrow("Project not found: missing");
    expect(() => documents.get("missing")).toThrow("Document not found: missing");

    expect(() => instance.database.run(() => {
      projects.incrementRevision("default-project", 1);
      throw new Error("rollback");
    })).toThrow("rollback");
    expect(projects.get("default-project").revision).toBe(0);

    instance.database.run(() => projects.incrementRevision("default-project", 2));
    expect(projects.get("default-project").revision).toBe(1);
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

    db.prepare("UPDATE documents SET blocks_json = ? WHERE id = ?")
      .run("not-json", "default-document");
    expect(() => documents.get("default-document"))
      .toThrow("Invalid persisted document blocks JSON");
    db.prepare("UPDATE documents SET blocks_json = ? WHERE id = ?")
      .run("[]", "default-document");

    db.prepare("UPDATE suggestion_state SET state_json = ? WHERE project_id = ?")
      .run(JSON.stringify({ entries: [] }), "default-project");
    expect(() => suggestions.get("default-project"))
      .toThrow("Invalid data at persisted.suggestion-projection");

    db.prepare(`INSERT INTO event_outbox
      (event_id, stream_id, sequence, event_json, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run("invalid-event", "document:default-document", 1,
        JSON.stringify({ type: "unknown" }), 1, 1);
    expect(() => outbox.pending()).toThrow("Invalid data at persisted.outbox-event");
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
          ensureDirectories: () => real.ensureDirectories(),
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
