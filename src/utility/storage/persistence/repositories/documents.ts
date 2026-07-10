import type { DatabaseSync } from "node:sqlite";

import type { DocumentSnapshot } from "../../../../contracts/desktop-bridge.js";
import {
  COMPATIBILITY_REGISTRY,
  encodeVersionedJson,
} from "../../../../contracts/compatibility.js";
import { DocumentBlocksSchema } from "../../../../contracts/events.js";
import { parseOrContractError } from "../../../../contracts/validation.js";
import { createEmptySuggestionState } from "../../../../domain/suggestions/state.js";
import type { DocumentStore } from "../../application/ports.js";
import { DOCUMENT_SCHEMA_VERSION } from "../../workspace/config.js";
import { suggestionProjectionChecksum } from "../projection-checksum.js";
import {
  decode,
  LEGACY_TO_CURRENT,
  validatePersisted,
} from "./json.js";

export class DocumentRepository implements DocumentStore {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * What: lists records from the current store.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, catalog, deleteProject and selectProject when that path needs this behavior.
   */
  list(projectId?: string) {
    const sql = `SELECT id, project_id, title, revision FROM documents
      ${projectId ? "WHERE project_id = ?" : ""} ORDER BY created_at, id`;
    const rows = (projectId ? this.db.prepare(sql).all(projectId) : this.db.prepare(sql).all()) as
      Array<{ id: string; project_id: string; title: string; revision: number }>;
    return rows.map((row) => ({ id: row.id, projectId: row.project_id, title: row.title, revision: row.revision }));
  }

  /**
   * What: performs the get step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, hydrate, repairWorkspace and performDocumentSave when that path needs this behavior.
   */
  get(projectId: string, id: string): DocumentSnapshot {
    if (id === undefined) {
      id = projectId;
      const owner = this.db.prepare("SELECT project_id FROM documents WHERE id = ?").get(id) as { project_id: string } | undefined;
      if (!owner) throw new Error(`Document not found: ${id}`);
      projectId = owner.project_id;
    }
    const row = this.db.prepare(
      `SELECT id, project_id, title, blocks_json, markdown, schema_version, revision, updated_at
       FROM documents WHERE project_id = ? AND id = ?`,
    ).get(projectId, id) as {
      id: string; project_id: string; title: string; blocks_json: string;
      markdown: string; schema_version: number; revision: number; updated_at: number;
    } | undefined;
    if (!row) throw new Error(`Document not found: ${id}`);
    const policy = COMPATIBILITY_REGISTRY.documentBlocks;
    const decoded = decode(this.db, {
      text: row.blocks_json,
      format: policy.name,
      currentVersion: policy.currentVersion,
      minimumReadableVersion: policy.minimumReadableVersion,
      legacyVersion: 0,
      payloadKey: "blocks",
      migrations: LEGACY_TO_CURRENT,
      recordIdentity: id,
    });
    const blocks = validatePersisted({
      db: this.db, schema: DocumentBlocksSchema, value: decoded.payload,
      boundary: "persisted.document-blocks", format: policy.name, identity: id,
      sourceText: row.blocks_json, version: decoded.detectedVersion,
    });
    if (decoded.migrated) this.db.prepare(
      "UPDATE documents SET blocks_json = ? WHERE id = ? AND blocks_json = ?",
    ).run(encodeVersionedJson(policy.name, policy.currentVersion, blocks, "blocks"), id, row.blocks_json);
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      blocks,
      markdown: row.markdown,
      schemaVersion: row.schema_version,
      revision: row.revision,
      updatedAt: row.updated_at,
    };
  }

  /**
   * What: performs the create step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, createProject and createDocument when that path needs this behavior.
   */
  create(projectId: string, id: string, title: string, now: number) {
    const blocks = [{ type: "heading", props: { level: 1 }, content: "New Page" }];
    this.db.prepare(`INSERT INTO documents
      (id, project_id, title, blocks_json, markdown, schema_version, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, '# New Page\n', ?, 0, ?, ?)`)
      .run(id, projectId, title, encodeVersionedJson(
        COMPATIBILITY_REGISTRY.documentBlocks.name,
        COMPATIBILITY_REGISTRY.documentBlocks.currentVersion,
        blocks,
        "blocks",
      ), DOCUMENT_SCHEMA_VERSION, now, now);
    const suggestionState = createEmptySuggestionState();
    this.db.prepare(`INSERT INTO suggestion_projection
      (project_id, document_id, state_json, revision, covered_through_sequence,
       projection_version, checksum, updated_at) VALUES (?, ?, ?, 0, 0, 1, ?, ?)`)
      .run(projectId, id, encodeVersionedJson(
        COMPATIBILITY_REGISTRY.suggestionProjection.name,
        COMPATIBILITY_REGISTRY.suggestionProjection.currentVersion,
        suggestionState,
        "state",
      ), suggestionProjectionChecksum(suggestionState, 0), now);
    return this.get(projectId, id);
  }

  /**
   * What: performs the rename step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports and renameDocument when that path needs this behavior.
   */
  rename(projectId: string, id: string, title: string, now: number) {
    const result = this.db.prepare(
      "UPDATE documents SET title = ?, updated_at = ? WHERE project_id = ? AND id = ?",
    ).run(title, now, projectId, id);
    if (result.changes !== 1) throw new Error("Document not found or not owned by project");
    return this.get(projectId, id);
  }

  /**
   * What: performs the count step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports and delete when that path needs this behavior.
   */
  count(projectId: string) {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM documents WHERE project_id = ?")
      .get(projectId) as { count: number }).count;
  }

  /**
   * What: performs the delete step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports and deleteDocument when that path needs this behavior.
   */
  delete(projectId: string, id: string) {
    if (this.count(projectId) <= 1) throw new Error("LAST_DOCUMENT_DELETE_FORBIDDEN");
    const result = this.db.prepare(
      "DELETE FROM documents WHERE project_id = ? AND id = ?",
    ).run(projectId, id);
    if (result.changes !== 1) throw new Error("Document not found or not owned by project");
  }

  /**
   * What: performs the save step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, performDocumentSave, fixture and operations when that path needs this behavior.
   */
  save(projectId: string, id: string | unknown[], blocks: unknown[] | string, markdown: string | number, updatedAt?: number) {
    if (updatedAt === undefined) {
      updatedAt = markdown as number;
      markdown = blocks as string;
      blocks = id as unknown[];
      id = projectId;
      const owner = this.db.prepare("SELECT project_id FROM documents WHERE id = ?").get(id as string) as { project_id: string } | undefined;
      if (!owner) throw new Error(`Document not found: ${id as string}`);
      projectId = owner.project_id;
    }
    const validatedBlocks = parseOrContractError(
      DocumentBlocksSchema,
      blocks as unknown[],
      "persisted.document-blocks.write",
    );
    const result = this.db.prepare(
      `UPDATE documents SET blocks_json = ?, markdown = ?, revision = revision + 1, updated_at = ?
       WHERE project_id = ? AND id = ?`,
    ).run(encodeVersionedJson(
      COMPATIBILITY_REGISTRY.documentBlocks.name,
      COMPATIBILITY_REGISTRY.documentBlocks.currentVersion,
      validatedBlocks,
      "blocks",
    ), markdown as string, updatedAt, projectId, id as string);
    if (result.changes !== 1) throw new Error(`Document not found: ${id}`);
    return this.get(projectId, id as string);
  }
}
