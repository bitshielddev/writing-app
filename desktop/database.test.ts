// @vitest-environment node

import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  DatabaseStartupError,
  createCurrentDatabase,
  inspectDatabase,
  openApplicationDatabase,
  runMigrations,
  validateMigrationRegistry,
  type DatabaseMigration,
} from "./database";

const fixturePath = fileURLToPath(
  new URL("./fixtures/schema-v2.sql", import.meta.url),
);
const directories: string[] = [];

async function temporaryPath(filename = "scribe.sqlite3") {
  const directory = await mkdtemp(join(tmpdir(), "scribe-database-"));
  directories.push(directory);
  return join(directory, filename);
}

async function createFixture() {
  const path = await temporaryPath();
  const db = new DatabaseSync(path);
  db.exec(await readFile(fixturePath, "utf8"));
  db.close();
  return path;
}

function version(db: DatabaseSync) {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

describe("database lifecycle", () => {
  it("creates the complete current schema only for an empty version-0 database", async () => {
    const path = await temporaryPath();
    const db = openApplicationDatabase(path);
    expect(version(db)).toBe(2);
    expect(inspectDatabase(db)).toEqual({ kind: "supported", version: 2 });
    expect((db.prepare(
      "SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND sql LIKE '%STRICT%'",
    ).get() as { count: number }).count).toBe(5);
    db.close();
  });

  it("opens the representative version-2 fixture without recreating tables or losing rows", async () => {
    const path = await createFixture();
    const db = openApplicationDatabase(path);
    expect(db.prepare("SELECT name, revision FROM projects WHERE id = ?")
      .get("fixture-project")).toEqual({ name: "Fixture project", revision: 4 });
    expect(db.prepare("SELECT markdown FROM documents WHERE id = ?")
      .get("fixture-document")).toEqual({ markdown: "Keep me\n" });
    expect(db.prepare("SELECT bytes FROM sources WHERE id = ?")
      .get("fixture-source")).toEqual({ bytes: 12 });
    db.close();
  });

  it("rejects a version-0 database containing known tables without changing it", async () => {
    const path = await temporaryPath();
    const setup = new DatabaseSync(path);
    setup.exec("CREATE TABLE projects (id TEXT PRIMARY KEY) STRICT");
    setup.close();
    const before = await readFile(path);

    expect(() => openApplicationDatabase(path)).toThrowError(
      expect.objectContaining<Partial<DatabaseStartupError>>({
        code: "DATABASE_LEGACY_UNKNOWN",
        databasePath: path,
      }),
    );
    expect(await readFile(path)).toEqual(before);
  });

  it("rejects a newer database without opening it for writes or changing it", async () => {
    const path = await createFixture();
    const setup = new DatabaseSync(path);
    setup.exec("PRAGMA user_version = 99");
    setup.close();
    const before = await readFile(path);

    expect(() => openApplicationDatabase(path)).toThrowError(
      expect.objectContaining<Partial<DatabaseStartupError>>({
        code: "DATABASE_TOO_NEW",
        databasePath: path,
      }),
    );
    expect(await readFile(path)).toEqual(before);
  });

  it("runs a synthetic migration atomically, preserves data, and is idempotent", async () => {
    const path = await createFixture();
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    const migration: DatabaseMigration = {
      fromVersion: 2,
      toVersion: 3,
      name: "add project description",
      requiresBackup: false,
      up(database) {
        database.exec("ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''");
      },
    };
    runMigrations({ db, databasePath: path, migrations: [migration], targetVersion: 3 });
    runMigrations({ db, databasePath: path, migrations: [migration], targetVersion: 3 });

    expect(version(db)).toBe(3);
    expect(db.prepare("SELECT name, description FROM projects WHERE id = ?")
      .get("fixture-project")).toEqual({ name: "Fixture project", description: "" });
    db.close();
  });

  it("rolls back a failed risky migration and retains a valid backup", async () => {
    const path = await createFixture();
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    const migration: DatabaseMigration = {
      fromVersion: 2,
      toVersion: 3,
      name: "failing fixture migration",
      requiresBackup: true,
      up(database) {
        database.exec("CREATE TABLE partial_change (id INTEGER PRIMARY KEY) STRICT");
        throw new Error("synthetic failure");
      },
    };

    expect(() => runMigrations({
      db,
      databasePath: path,
      migrations: [migration],
      targetVersion: 3,
    })).toThrowError(expect.objectContaining<Partial<DatabaseStartupError>>({
      code: "DATABASE_MIGRATION_FAILED",
    }));
    expect(version(db)).toBe(2);
    expect(db.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'partial_change'",
    ).get()).toBeUndefined();
    expect(db.prepare("SELECT name FROM projects WHERE id = ?")
      .get("fixture-project")).toEqual({ name: "Fixture project" });

    const backups = (await readdir(dirname(path))).filter((name) => name.endsWith(".bak"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/\.failed\.bak$/);
    const backup = new DatabaseSync(join(dirname(path), backups[0]!), { readOnly: true });
    expect(inspectDatabase(backup)).toEqual({ kind: "supported", version: 2 });
    backup.close();
    db.close();
  });

  it("classifies corrupt and foreign-key-invalid databases explicitly", async () => {
    const corruptPath = await temporaryPath("corrupt.sqlite3");
    await writeFile(corruptPath, "not a sqlite database");
    expect(() => openApplicationDatabase(corruptPath)).toThrowError(
      expect.objectContaining<Partial<DatabaseStartupError>>({ code: "DATABASE_CORRUPT" }),
    );

    const invalidPath = await temporaryPath("invalid.sqlite3");
    const invalid = new DatabaseSync(invalidPath);
    createCurrentDatabase(invalid);
    invalid.exec("PRAGMA foreign_keys = OFF");
    invalid.exec(`INSERT INTO documents
      (id, project_id, title, blocks_json, markdown, schema_version, revision, created_at, updated_at)
      VALUES ('orphan', 'missing', 'Orphan', '[]', '', 1, 0, 1, 1)`);
    invalid.close();
    expect(() => openApplicationDatabase(invalidPath)).toThrowError(
      expect.objectContaining<Partial<DatabaseStartupError>>({ code: "DATABASE_CORRUPT" }),
    );
  });

  it("validates migration edges before making schema changes", async () => {
    const path = await createFixture();
    const db = new DatabaseSync(path);
    const invalid: DatabaseMigration = {
      fromVersion: 2,
      toVersion: 4,
      name: "skips a version",
      requiresBackup: false,
      up() {},
    };
    expect(() => runMigrations({
      db,
      databasePath: path,
      migrations: [invalid],
      targetVersion: 4,
    })).toThrow("must advance exactly one version");
    expect(version(db)).toBe(2);
    db.close();
  });

  it("rejects duplicate and disconnected migration registries", () => {
    const migration = (fromVersion: number, toVersion: number): DatabaseMigration => ({
      fromVersion,
      toVersion,
      name: `${fromVersion}-to-${toVersion}`,
      requiresBackup: false,
      up() {},
    });
    expect(() => validateMigrationRegistry(
      [migration(2, 3), migration(2, 3)],
      2,
      3,
    )).toThrow("Duplicate migration");
    expect(() => validateMigrationRegistry(
      [migration(2, 3), migration(4, 5)],
      2,
      3,
    )).toThrow("only the contiguous path");
  });

  it("retains only the newest three successful automatic backups", async () => {
    const path = await createFixture();
    const db = new DatabaseSync(path);
    const migrations = [2, 3, 4, 5].map((fromVersion): DatabaseMigration => ({
      fromVersion,
      toVersion: fromVersion + 1,
      name: `${fromVersion}-to-${fromVersion + 1}`,
      requiresBackup: true,
      up() {},
    }));
    runMigrations({ db, databasePath: path, migrations, targetVersion: 6 });
    const backups = (await readdir(dirname(path))).filter((name) =>
      name.startsWith("scribe.sqlite3.migration-v") && name.endsWith(".bak"));
    expect(backups).toHaveLength(3);
    db.close();
  });
});
