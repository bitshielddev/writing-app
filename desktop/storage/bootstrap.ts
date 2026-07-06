import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

import { createEmptySuggestionState } from "../../src/suggestions/state.js";
import { DOCUMENT_SCHEMA_VERSION } from "./config.js";
import { COMPATIBILITY_REGISTRY, encodeVersionedJson } from "../compatibility.js";

export function bootstrapWorkspace(
  db: DatabaseSync,
  identityOrProject: (() => string) | string = randomUUID,
  legacyDocumentId?: string,
) {
  const existing = db.prepare("SELECT id FROM documents ORDER BY created_at, id LIMIT 1")
    .get() as { id: string } | undefined;
  if (existing) return;
  const projectId = typeof identityOrProject === "string" ? identityOrProject : identityOrProject();
  const documentId = legacyDocumentId ?? (typeof identityOrProject === "string" ? randomUUID() : identityOrProject());
  const now = Date.now();
  db.prepare(
    "INSERT OR IGNORE INTO projects (id, name, revision, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
  ).run(projectId, "AI-assisted drafts", now, now);
  db.prepare(
    `INSERT OR IGNORE INTO documents
      (id, project_id, title, blocks_json, markdown, schema_version, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    documentId,
    projectId,
    "Untitled Draft",
    encodeVersionedJson(
      COMPATIBILITY_REGISTRY.documentBlocks.name,
      COMPATIBILITY_REGISTRY.documentBlocks.currentVersion,
      [{ type: "heading", props: { level: 1 }, content: "New Page" }],
      "blocks",
    ),
    "# New Page\n",
    DOCUMENT_SCHEMA_VERSION,
    now,
    now,
  );
  db.prepare(
    "INSERT INTO suggestion_state (project_id, document_id, state_json, updated_at) VALUES (?, ?, ?, ?)",
  ).run(projectId, documentId, encodeVersionedJson(
    COMPATIBILITY_REGISTRY.suggestionProjection.name,
    COMPATIBILITY_REGISTRY.suggestionProjection.currentVersion,
    createEmptySuggestionState(),
    "state",
  ), now);
  db.prepare(`INSERT INTO workspace_settings
    (id, selected_project_id, selected_document_id, updated_at) VALUES (1, ?, ?, ?)`)
    .run(projectId, documentId, now);
}
