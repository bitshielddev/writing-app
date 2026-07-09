import { DatabaseSync } from "node:sqlite";

import {
  CURRENT_SCHEMA_SQL,
  DATABASE_VERSION,
  MINIMUM_SUPPORTED_DATABASE_VERSION,
} from "./schema.js";

export type DatabaseInspection =
  | { kind: "empty"; version: 0 }
  | { kind: "supported"; version: number }
  | { kind: "older"; version: number }
  | { kind: "newer"; version: number }
  | { kind: "legacy-unknown"; version: 0; tables: string[] }
  | { kind: "corrupt"; version?: number; reason: string };

export function pragmaVersion(db: DatabaseSync) {
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

export function integrityFailure(db: DatabaseSync) {
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
