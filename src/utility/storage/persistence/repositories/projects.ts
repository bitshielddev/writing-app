import type { DatabaseSync } from "node:sqlite";

import type {
  ProjectSnapshot,
  ProjectStore,
} from "../../application/ports.js";

export class ProjectRepository implements ProjectStore {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * What: lists records from the current store.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, catalog and deleteProject when that path needs this behavior.
   */
  list() {
    return this.db.prepare(
      "SELECT id, name, revision FROM projects ORDER BY created_at, id",
    ).all() as ProjectSnapshot[];
  }

  /**
   * What: performs the get step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, selectProject, createDocument and hydrate when that path needs this behavior.
   */
  get(id: string): ProjectSnapshot {
    const row = this.db.prepare(
      "SELECT id, name, revision FROM projects WHERE id = ?",
    ).get(id) as ProjectSnapshot | undefined;
    if (!row) throw new Error(`Project not found: ${id}`);
    return row;
  }

  /**
   * What: performs the create step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports and createProject when that path needs this behavior.
   */
  create(id: string, name: string, now: number) {
    this.db.prepare(`INSERT INTO projects
      (id, name, revision, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`)
      .run(id, name, now, now);
    return this.get(id);
  }

  /**
   * What: performs the rename step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports and renameProject when that path needs this behavior.
   */
  rename(id: string, name: string, now: number) {
    const result = this.db.prepare(
      "UPDATE projects SET name = ?, updated_at = ? WHERE id = ?",
    ).run(name, now, id);
    if (result.changes !== 1) throw new Error(`Project not found: ${id}`);
    return this.get(id);
  }

  /**
   * What: performs the delete step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports and deleteProject when that path needs this behavior.
   */
  delete(id: string) {
    const result = this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    if (result.changes !== 1) throw new Error(`Project not found: ${id}`);
  }

  /**
   * What: performs the increment revision step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, performDocumentSave, importSource and fixture when that path needs this behavior.
   */
  incrementRevision(id: string, updatedAt: number) {
    const result = this.db.prepare(
      "UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?",
    ).run(updatedAt, id);
    if (result.changes !== 1) throw new Error(`Project not found: ${id}`);
  }
}
