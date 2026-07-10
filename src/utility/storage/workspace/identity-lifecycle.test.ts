// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { createStorageService, type StorageService } from "../service";
import { createStoragePaths } from "./config";
import { createCurrentDatabase } from "../persistence/database/index";
import { bootstrapWorkspace } from "./bootstrap";

const directories: string[] = [];
const services: StorageService[] = [];
const FILESYSTEM_DATABASE_TEST_TIMEOUT_MS = 30_000;

/**
 * What: performs the service step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by identity-lifecycle when that path needs this behavior.
 */
async function service(databasePath = ":memory:") {
  const root = await mkdtemp(join(tmpdir(), "scribe-identities-"));
  directories.push(root);
  const instance = createStorageService({ databasePath, workspaceRoot: root });
  services.push(instance);
  return { instance, root };
}

afterEach(async () => {
  services.splice(0).forEach((item) => item.close());
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("project and document identities", () => {
  it("creates UUID identities and isolates hydration, suggestions, and streams", async () => {
    const { instance } = await service();
    const first = instance.operations.catalog();
    const firstScope = first.selection;
    expect(firstScope.projectId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(firstScope.documentId).toMatch(/^[0-9a-f-]{36}$/i);

    const second = await instance.handleRequest("project.create", { name: "Second project" });
    const secondScope = (second as ReturnType<typeof instance.operations.catalog>).selection;
    expect(secondScope).not.toEqual(firstScope);

    const firstSnapshot = await instance.handleRequest("hydrate", firstScope);
    const secondSnapshot = await instance.handleRequest("hydrate", secondScope);
    expect((firstSnapshot as { streamId: string }).streamId).toBe(`document:${firstScope.documentId}`);
    expect((secondSnapshot as { streamId: string }).streamId).toBe(`document:${secondScope.documentId}`);
    expect((firstSnapshot as { sources: unknown[] }).sources).toEqual([]);

    await expect(instance.handleRequest("hydrate", {
      projectId: firstScope.projectId,
      documentId: secondScope.documentId,
    })).rejects.toThrow("Document not found");
  });

  it("enforces active and last-document deletion safeguards", async () => {
    const { instance } = await service();
    const first = instance.operations.catalog().selection;
    const withSecond = await instance.handleRequest("document.create", {
      projectId: first.projectId,
      title: "Chapter two",
    }) as ReturnType<typeof instance.operations.catalog>;
    const second = withSecond.selection;

    await expect(instance.handleRequest("document.delete", second))
      .rejects.toThrow("ACTIVE_DOCUMENT_DELETE_FORBIDDEN");
    await instance.handleRequest("document.select", first);
    await instance.handleRequest("document.delete", second);

    const other = await instance.handleRequest("project.create", { name: "Other" }) as
      ReturnType<typeof instance.operations.catalog>;
    await expect(instance.handleRequest("document.delete", first))
      .rejects.toThrow("LAST_DOCUMENT_DELETE_FORBIDDEN");
    await expect(instance.handleRequest("project.delete", { projectId: other.selection.projectId }))
      .rejects.toThrow("ACTIVE_PROJECT_DELETE_FORBIDDEN");
  });

  it("restores persisted selection and rejects path traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "scribe-selection-"));
    directories.push(root);
    const databasePath = join(root, "scribe.sqlite3");
    const first = createStorageService({ databasePath, workspaceRoot: root });
    const created = await first.handleRequest("project.create", { name: "Persistent" }) as
      ReturnType<typeof first.operations.catalog>;
    const selected = created.selection;
    first.close();

    const restarted = createStorageService({ databasePath, workspaceRoot: root });
    services.push(restarted);
    expect(restarted.operations.catalog().selection).toEqual(selected);
    expect(restarted.paths.workspaceRoot).toContain(join("projects", selected.projectId, "documents", selected.documentId));
    expect(() => createStoragePaths(root, "../escape", selected.documentId)).toThrow("Invalid project identity");
  }, FILESYSTEM_DATABASE_TEST_TIMEOUT_MS);

  it("moves the legacy workspace through a recovery journal without losing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "scribe-legacy-files-"));
    directories.push(root);
    const databasePath = join(root, "scribe.sqlite3");
    const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
    createCurrentDatabase(db);
    bootstrapWorkspace(db, "default-project", "default-document");
    db.close();
    const legacy = join(root, "projects", "default-project");
    await mkdir(join(legacy, "sources"), { recursive: true });
    await mkdir(join(legacy, ".pi", "sessions"), { recursive: true });
    await writeFile(join(legacy, "draft.md"), "legacy draft\n");
    await writeFile(join(legacy, "sources", "notes.md"), "legacy source\n");
    await writeFile(join(legacy, ".pi", "sessions", "checkpoint.json"), "{}");

    const migrated = createStorageService({ databasePath, workspaceRoot: root });
    services.push(migrated);
    expect(await readFile(migrated.paths.draftPath, "utf8")).toBe("legacy draft\n");
    expect(await readFile(join(migrated.paths.sourcesDirectory, "notes.md"), "utf8"))
      .toBe("legacy source\n");
    expect(await readFile(join(migrated.paths.piDirectory, "sessions", "checkpoint.json"), "utf8"))
      .toBe("{}");
  }, FILESYSTEM_DATABASE_TEST_TIMEOUT_MS);
});
