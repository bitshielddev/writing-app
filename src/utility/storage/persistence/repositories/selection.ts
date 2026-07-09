import type { DatabaseSync } from "node:sqlite";

import type { SelectionStore } from "../../application/ports.js";

export class SelectionRepository implements SelectionStore {
  constructor(private readonly db: DatabaseSync) {}

  resolve() {
    const stored = this.db.prepare(`SELECT selected_project_id, selected_document_id
      FROM workspace_settings WHERE id = 1`).get() as
      { selected_project_id: string | null; selected_document_id: string | null } | undefined;
    if (stored?.selected_project_id && stored.selected_document_id) {
      const valid = this.db.prepare(`SELECT 1 FROM documents
        WHERE project_id = ? AND id = ?`).get(stored.selected_project_id, stored.selected_document_id);
      if (valid) return { projectId: stored.selected_project_id, documentId: stored.selected_document_id };
    }
    const fallback = this.db.prepare(`SELECT project_id, id AS document_id FROM documents
      ORDER BY created_at, id LIMIT 1`).get() as { project_id: string; document_id: string } | undefined;
    if (!fallback) throw new Error("Workspace has no documents");
    return this.set(fallback.project_id, fallback.document_id, Date.now());
  }

  set(projectId: string, documentId: string, now: number) {
    const owned = this.db.prepare(
      "SELECT 1 FROM documents WHERE project_id = ? AND id = ?",
    ).get(projectId, documentId);
    if (!owned) throw new Error("Document not found or not owned by project");
    this.db.prepare(`INSERT INTO workspace_settings
      (id, selected_project_id, selected_document_id, updated_at) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET selected_project_id = excluded.selected_project_id,
        selected_document_id = excluded.selected_document_id, updated_at = excluded.updated_at`)
      .run(projectId, documentId, now);
    return { projectId, documentId };
  }
}
