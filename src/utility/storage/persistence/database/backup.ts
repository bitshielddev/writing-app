import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { integrityFailure } from "./inspection.js";

/**
 * What: performs the backup prefix step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by pruneBackups and backupDatabase when that path needs this behavior.
 */
function backupPrefix(databasePath: string) {
  return `${basename(databasePath)}.migration-v`;
}

/**
 * What: performs the prune backups step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by migrations and runMigrations when that path needs this behavior.
 */
export function pruneBackups(databasePath: string, retain = 3) {
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

/**
 * What: performs the backup database step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by migrations, executeMigrationStep, index and service when that path needs this behavior.
 */
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
