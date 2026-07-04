import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DATABASE_VERSION = 2;
export const MINIMUM_SUPPORTED_DATABASE_VERSION = 2;

export const CURRENT_SCHEMA_SQL = `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    blocks_json TEXT NOT NULL,
    markdown TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE suggestion_state (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE event_outbox (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    dispatched_at INTEGER
  ) STRICT;
`;

export type DatabaseMigration = {
  fromVersion: number;
  toVersion: number;
  name: string;
  requiresBackup: boolean;
  up(db: DatabaseSync): void;
};

export type DatabaseInspection =
  | { kind: "empty"; version: 0 }
  | { kind: "supported"; version: number }
  | { kind: "older"; version: number }
  | { kind: "newer"; version: number }
  | { kind: "legacy-unknown"; version: 0; tables: string[] }
  | { kind: "corrupt"; version?: number; reason: string };

export type DatabaseStartupErrorCode =
  | "DATABASE_TOO_NEW"
  | "DATABASE_LEGACY_UNKNOWN"
  | "DATABASE_MIGRATION_FAILED"
  | "DATABASE_CORRUPT";

export class DatabaseStartupError extends Error {
  constructor(
    readonly code: DatabaseStartupErrorCode,
    readonly databasePath: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message} Database: ${databasePath}`, options);
    this.name = "DatabaseStartupError";
  }
}

function pragmaVersion(db: DatabaseSync) {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function applicationTables(db: DatabaseSync) {
  const rows = db.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

let currentSchemaTableNames: readonly string[] | undefined;

function applicationTableNames() {
  if (currentSchemaTableNames) return currentSchemaTableNames;
  const schema = new DatabaseSync(":memory:");
  try {
    schema.exec(CURRENT_SCHEMA_SQL);
    currentSchemaTableNames = applicationTables(schema);
    return currentSchemaTableNames;
  } finally {
    schema.close();
  }
}

function integrityFailure(db: DatabaseSync) {
  const quickCheck = db.prepare("PRAGMA quick_check").all() as Array<{ quick_check: string }>;
  const failedCheck = quickCheck.find((row) => row.quick_check !== "ok");
  if (failedCheck) return `SQLite quick_check failed: ${failedCheck.quick_check}`;
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length > 0) return `SQLite foreign_key_check found ${foreignKeys.length} violation(s)`;
  return undefined;
}

export function inspectDatabase(
  db: DatabaseSync,
  supportedVersion = DATABASE_VERSION,
  minimumVersion = MINIMUM_SUPPORTED_DATABASE_VERSION,
): DatabaseInspection {
  let version: number | undefined;
  try {
    version = pragmaVersion(db);
    const integrityError = integrityFailure(db);
    if (integrityError) return { kind: "corrupt", version, reason: integrityError };
    const tables = applicationTables(db);
    const expectedTables = applicationTableNames();
    const knownTables = tables.filter((table) => expectedTables.includes(table));
    if (version === 0) {
      return knownTables.length === 0
        ? { kind: "empty", version: 0 }
        : { kind: "legacy-unknown", version: 0, tables: knownTables };
    }
    if (version > supportedVersion) return { kind: "newer", version };
    if (version < minimumVersion) {
      return { kind: "corrupt", version, reason: `Unsupported database version ${version}` };
    }
    if (version < supportedVersion) return { kind: "older", version };
    const missing = expectedTables.filter((table) => !tables.includes(table));
    if (missing.length > 0) {
      return { kind: "corrupt", version, reason: `Missing application table(s): ${missing.join(", ")}` };
    }
    return { kind: "supported", version };
  } catch (error) {
    return {
      kind: "corrupt",
      version,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createCurrentDatabase(
  db: DatabaseSync,
  version = DATABASE_VERSION,
  schemaSql = CURRENT_SCHEMA_SQL,
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(schemaSql);
    db.exec(`PRAGMA user_version = ${version}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrationPath(
  migrations: readonly DatabaseMigration[],
  fromVersion: number,
  targetVersion: number,
) {
  const edges = new Map<number, DatabaseMigration>();
  for (const migration of migrations) {
    if (migration.toVersion !== migration.fromVersion + 1) {
      throw new Error(`Migration ${migration.name} must advance exactly one version`);
    }
    if (edges.has(migration.fromVersion)) {
      throw new Error(`Duplicate migration from version ${migration.fromVersion}`);
    }
    edges.set(migration.fromVersion, migration);
  }
  const path: DatabaseMigration[] = [];
  for (let version = fromVersion; version < targetVersion; version += 1) {
    const migration = edges.get(version);
    if (!migration || migration.toVersion !== version + 1) {
      throw new Error(`No contiguous migration path from version ${version} to ${targetVersion}`);
    }
    path.push(migration);
  }
  return path;
}

export function validateMigrationRegistry(
  migrations: readonly DatabaseMigration[],
  minimumVersion = MINIMUM_SUPPORTED_DATABASE_VERSION,
  targetVersion = DATABASE_VERSION,
) {
  const path = migrationPath(migrations, minimumVersion, targetVersion);
  if (path.length !== migrations.length) {
    throw new Error(
      `Migration registry must contain only the contiguous path from ${minimumVersion} to ${targetVersion}`,
    );
  }
}

function backupPrefix(databasePath: string) {
  return `${basename(databasePath)}.migration-v`;
}

function pruneBackups(databasePath: string, retain = 3) {
  const directory = dirname(databasePath);
  const prefix = backupPrefix(databasePath);
  const backups = readdirSync(directory)
    .filter((entry) =>
      entry.startsWith(prefix) &&
      entry.endsWith(".bak") &&
      !entry.endsWith(".failed.bak"))
    .map((entry) => ({ entry, modified: statSync(join(directory, entry)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified);
  for (const backup of backups.slice(retain)) unlinkSync(join(directory, backup.entry));
}

export function backupDatabase(db: DatabaseSync, databasePath: string, sourceVersion: number) {
  if (databasePath === ":memory:") return undefined;
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = join(
    dirname(databasePath),
    `${backupPrefix(databasePath)}${sourceVersion}-${timestamp}-${randomUUID()}.bak`,
  );
  try {
    copyFileSync(databasePath, backupPath);
    const descriptor = openSync(backupPath, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const failure = integrityFailure(backup);
      if (failure) throw new Error(`Migration backup is invalid: ${failure}`);
    } finally {
      backup.close();
    }
  } catch (error) {
    if (existsSync(backupPath)) unlinkSync(backupPath);
    throw error;
  }
  return backupPath;
}

function executeMigrationTransaction(db: DatabaseSync, migration: DatabaseMigration) {
  db.exec("BEGIN IMMEDIATE");
  try {
    migration.up(db);
    db.exec(`PRAGMA user_version = ${migration.toVersion}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function retainFailedBackup(backupPath: string | undefined) {
  if (!backupPath) return undefined;
  const failedBackupPath = backupPath.replace(/\.bak$/, ".failed.bak");
  renameSync(backupPath, failedBackupPath);
  return failedBackupPath;
}

function migrationError(
  migration: DatabaseMigration,
  databasePath: string,
  backupPath: string | undefined,
  cause: unknown,
) {
  const recovery = backupPath ? ` Recovery backup: ${backupPath}` : "";
  return new DatabaseStartupError(
    "DATABASE_MIGRATION_FAILED",
    databasePath,
    `Migration ${migration.name} failed.${recovery}`,
    { cause },
  );
}

function executeMigrationStep(
  db: DatabaseSync,
  migration: DatabaseMigration,
  databasePath: string,
) {
  let backupPath: string | undefined;
  try {
    if (migration.requiresBackup) {
      backupPath = backupDatabase(db, databasePath, migration.fromVersion);
    }
    executeMigrationTransaction(db, migration);
    return backupPath;
  } catch (error) {
    const failedBackupPath = retainFailedBackup(backupPath);
    throw migrationError(migration, databasePath, failedBackupPath, error);
  }
}

function existingPaths(paths: Array<string | undefined>): string[] {
  return paths.filter((path): path is string => path !== undefined);
}

export function runMigrations({
  db,
  databasePath,
  migrations,
  targetVersion = DATABASE_VERSION,
}: {
  db: DatabaseSync;
  databasePath: string;
  migrations: readonly DatabaseMigration[];
  targetVersion?: number;
}) {
  const startVersion = pragmaVersion(db);
  const path = migrationPath(migrations, startVersion, targetVersion);
  const backups = existingPaths(path.map((migration) =>
    executeMigrationStep(db, migration, databasePath)));
  if (backups.length > 0) pruneBackups(databasePath);
  return backups;
}

function errorForInspection(inspection: DatabaseInspection, databasePath: string) {
  switch (inspection.kind) {
    case "newer":
      return new DatabaseStartupError(
        "DATABASE_TOO_NEW",
        databasePath,
        `Version ${inspection.version} requires a newer ScribeAI release. Open it with that release or restore a compatible backup.`,
      );
    case "legacy-unknown":
      return new DatabaseStartupError(
        "DATABASE_LEGACY_UNKNOWN",
        databasePath,
        `Version 0 contains application tables (${inspection.tables.join(", ")}). Preserve the file and recover or migrate it manually.`,
      );
    case "corrupt":
      return new DatabaseStartupError(
        "DATABASE_CORRUPT",
        databasePath,
        `${inspection.reason}. Preserve the file and restore a valid backup.`,
      );
    default:
      return undefined;
  }
}

function openReadOnly(databasePath: string) {
  return new DatabaseSync(databasePath, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });
}

export function openApplicationDatabase(
  databasePath: string,
  migrations: readonly DatabaseMigration[] = [],
) {
  validateMigrationRegistry(migrations);
  let initialInspection: DatabaseInspection = { kind: "empty", version: 0 };
  if (databasePath !== ":memory:" && existsSync(databasePath)) {
    let inspectionDb: DatabaseSync | undefined;
    try {
      inspectionDb = openReadOnly(databasePath);
      initialInspection = inspectDatabase(inspectionDb);
    } catch (error) {
      throw new DatabaseStartupError(
        "DATABASE_CORRUPT",
        databasePath,
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    } finally {
      inspectionDb?.close();
    }
  }
  const inspectionError = errorForInspection(initialInspection, databasePath);
  if (inspectionError) throw inspectionError;

  const db = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    if (initialInspection.kind === "empty") createCurrentDatabase(db);
    if (initialInspection.kind === "older") {
      runMigrations({ db, databasePath, migrations });
    }
    const finalInspection = inspectDatabase(db);
    const finalError = errorForInspection(finalInspection, databasePath);
    if (finalError) throw finalError;
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Migration authoring checklist:
 * 1. Bump DATABASE_VERSION exactly once.
 * 2. Add one contiguous DatabaseMigration and old/new schema fixtures.
 * 3. Add preservation, rollback-failure, backup, and reopen tests.
 * 4. Update database compatibility coverage and release documentation.
 */
