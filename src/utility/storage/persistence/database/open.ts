import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  inspectDatabase,
  type DatabaseInspection,
} from "./inspection.js";
import {
  DATABASE_MIGRATIONS,
  runMigrations,
  validateMigrationRegistry,
  type DatabaseMigration,
} from "./migrations.js";
import {
  CURRENT_SCHEMA_SQL,
  DATABASE_VERSION,
} from "./schema.js";
import { DatabaseStartupError } from "./startup-error.js";

/**
 * What: creates current database with the dependencies and defaults this workflow expects.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by openApplicationDatabase, index, database and identity-lifecycle when that path needs this behavior.
 */
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

/**
 * What: performs the error for inspection step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by openApplicationDatabase when that path needs this behavior.
 */
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

/**
 * What: performs the open read only step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by openApplicationDatabase when that path needs this behavior.
 */
function openReadOnly(databasePath: string) {
  return new DatabaseSync(databasePath, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });
}

/**
 * What: performs the open application database step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by index, database and lifecycle when that path needs this behavior.
 */
export function openApplicationDatabase(
  databasePath: string,
  migrations: readonly DatabaseMigration[] = DATABASE_MIGRATIONS,
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
