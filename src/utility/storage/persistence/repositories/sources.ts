import type { DatabaseSync } from "node:sqlite";

import type { SourceSnapshot } from "../../../../contracts/desktop-bridge.js";
import type { SourceStore } from "../../application/ports.js";

export class SourceRepository implements SourceStore {
  constructor(private readonly db: DatabaseSync) {}

  list(projectId: string, documentId: string): SourceSnapshot[] {
    documentId ??= (this.db.prepare(
      "SELECT id FROM documents WHERE project_id = ? ORDER BY created_at, id LIMIT 1",
    ).get(projectId) as { id: string } | undefined)?.id ?? "";
    const rows = this.db.prepare(
      `SELECT id, project_id, document_id, title, storage_path, bytes, updated_at
       FROM sources WHERE project_id = ? AND document_id = ? ORDER BY updated_at DESC`,
    ).all(projectId, documentId) as Array<{
      id: string; project_id: string; document_id: string; title: string; storage_path: string;
      bytes: number; updated_at: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      documentId: row.document_id,
      title: row.title,
      storagePath: row.storage_path,
      bytes: row.bytes,
      updatedAt: row.updated_at,
    }));
  }

  insert(source: SourceSnapshot, createdAt: number) {
    this.db.prepare(
      `INSERT INTO sources
        (id, project_id, document_id, title, storage_path, bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      source.id, source.projectId, source.documentId, source.title, source.storagePath,
      source.bytes, createdAt, source.updatedAt,
    );
  }

  get(projectId: string, documentId: string, id: string): SourceSnapshot {
    if (documentId === undefined && id === undefined) {
      id = projectId;
      const owner = this.db.prepare("SELECT project_id, document_id FROM sources WHERE id = ?").get(id) as
        { project_id: string; document_id: string } | undefined;
      if (!owner) throw new Error(`Source not found: ${id}`);
      projectId = owner.project_id;
      documentId = owner.document_id;
    }
    const source = this.db.prepare(
      `SELECT id, project_id, document_id, title, storage_path, bytes, updated_at
       FROM sources WHERE project_id = ? AND document_id = ? AND id = ?`,
    ).get(projectId, documentId, id) as {
      id: string; project_id: string; document_id: string; title: string; storage_path: string;
      bytes: number; updated_at: number;
    } | undefined;
    if (!source) throw new Error(`Source not found: ${id}`);
    return {
      id: source.id,
      projectId: source.project_id,
      documentId: source.document_id,
      title: source.title,
      storagePath: source.storage_path,
      bytes: source.bytes,
      updatedAt: source.updated_at,
    };
  }
}
