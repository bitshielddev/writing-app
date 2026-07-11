import type { DatabaseSync } from "node:sqlite";
import {
  existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { createStoragePaths } from "./config.js";

type Journal = {
  version: 1;
  projectId: string;
  documentId: string;
  pending: Array<{ from: string; to: string }>;
};

/** Idempotent recovery journal for the v2 single-workspace directory move. */
export function migrateLegacyWorkspaceFiles(
  db: DatabaseSync,
  applicationRoot: string,
  projectId: string,
  documentId: string,
) {
  const legacyRoot = join(applicationRoot, "projects", "default-project");
  const target = createStoragePaths(applicationRoot, projectId, documentId);
  const journalPath = join(applicationRoot, "workspace-migration-v6.json");
  let journal: Journal;
  if (existsSync(journalPath)) {
    journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
    if (journal.version !== 1) throw new Error("Unsupported workspace migration journal");
  } else {
    journal = {
      version: 1,
      projectId,
      documentId,
      pending: [
        { from: join(legacyRoot, "sources"), to: target.sourcesDirectory },
        { from: join(legacyRoot, ".pi"), to: target.piDirectory },
      ].filter((move) => existsSync(move.from)),
    };
    if (!journal.pending.length) return;
    writeJournal(journalPath, journal);
  }

  while (journal.pending.length) {
    const move = journal.pending[0]!;
    mkdirSync(dirname(move.to), { recursive: true });
    if (existsSync(move.from) && !existsSync(move.to)) renameSync(move.from, move.to);
    else if (existsSync(move.from) && existsSync(move.to)) {
      throw new Error(`Workspace migration destination already exists: ${move.to}`);
    }
    journal.pending.shift();
    writeJournal(journalPath, journal);
  }

  const rows = db.prepare(`SELECT id, storage_path FROM sources
    WHERE project_id = ? AND document_id = ?`).all(projectId, documentId) as
    Array<{ id: string; storage_path: string }>;
  for (const row of rows) {
    const migratedPath = join(target.sourcesDirectory, basename(row.storage_path));
    db.prepare(`UPDATE sources SET storage_path = ?
      WHERE id = ? AND project_id = ? AND document_id = ?`)
      .run(migratedPath, row.id, projectId, documentId);
  }
  rmSync(journalPath, { force: true });
}

/**
 * What: performs the write journal step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by migrateLegacyWorkspaceFiles when that path needs this behavior.
 */
function writeJournal(path: string, journal: Journal) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(journal), "utf8");
  renameSync(temporary, path);
}
