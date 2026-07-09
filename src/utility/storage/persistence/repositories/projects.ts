import type { DatabaseSync } from "node:sqlite";

import type {
  ProjectSnapshot,
  ProjectStore,
} from "../../application/ports.js";

export class ProjectRepository implements ProjectStore {
  constructor(private readonly db: DatabaseSync) {}

  list() {
    return this.db.prepare(
      "SELECT id, name, revision FROM projects ORDER BY created_at, id",
    ).all() as ProjectSnapshot[];
  }

  get(id: string): ProjectSnapshot {
    const row = this.db.prepare(
      "SELECT id, name, revision FROM projects WHERE id = ?",
    ).get(id) as ProjectSnapshot | undefined;
    if (!row) throw new Error(`Project not found: ${id}`);
    return row;
  }

  create(id: string, name: string, now: number) {
    this.db.prepare(`INSERT INTO projects
      (id, name, revision, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`)
      .run(id, name, now, now);
    return this.get(id);
  }

  rename(id: string, name: string, now: number) {
    const result = this.db.prepare(
      "UPDATE projects SET name = ?, updated_at = ? WHERE id = ?",
    ).run(name, now, id);
    if (result.changes !== 1) throw new Error(`Project not found: ${id}`);
    return this.get(id);
  }

  delete(id: string) {
    const result = this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    if (result.changes !== 1) throw new Error(`Project not found: ${id}`);
  }

  incrementRevision(id: string, updatedAt: number) {
    const result = this.db.prepare(
      "UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?",
    ).run(updatedAt, id);
    if (result.changes !== 1) throw new Error(`Project not found: ${id}`);
  }
}
