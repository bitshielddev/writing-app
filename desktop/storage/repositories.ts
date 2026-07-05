import type { DatabaseSync } from "node:sqlite";

import type { DesktopEvent, DocumentSnapshot, SourceSnapshot } from "../../src/shared/desktop.js";
import type { PersistedSuggestionState } from "../../src/suggestions/state.js";
import {
  DesktopEventSchema,
  DocumentBlocksSchema,
  PersistedSuggestionStateSchema,
  SuggestionCommandResultSchema,
  StorageOperations,
  type OperationResult,
  parseOrContractError,
} from "../../src/shared/contracts.js";

export type ProjectSnapshot = { id: string; name: string; revision: number };
export type PendingEvent = { sequence: number; event: DesktopEvent };

export interface ProjectStore {
  get(id: string): ProjectSnapshot;
  incrementRevision(id: string, updatedAt: number): void;
}

export interface DocumentStore {
  get(id: string): DocumentSnapshot;
  save(id: string, blocks: unknown[], markdown: string, updatedAt: number): DocumentSnapshot;
}

export interface SourceStore {
  list(projectId: string): SourceSnapshot[];
  insert(source: SourceSnapshot, createdAt: number): void;
  get(id: string): SourceSnapshot;
}

export interface SuggestionStore {
  get(projectId: string): SuggestionProjection;
  compareAndPut(projectId: string, expectedRevision: number, state: PersistedSuggestionState): SuggestionProjection;
  findReceipt(commandId: string): SuggestionCommandResult | undefined;
  recordReceipt(projectId: string, result: SuggestionCommandResult): void;
}
export type SuggestionProjection = { state: PersistedSuggestionState; revision: number };
export type SuggestionCommandResult = OperationResult<typeof StorageOperations, "suggestions.command">;

export interface EventOutbox {
  enqueue(event: DesktopEvent): void;
  pending(): PendingEvent[];
  markDispatched(sequence: number): void;
}

function parseJson(value: string, format: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Invalid persisted ${format} JSON`);
  }
}

export function assertSuggestionProjection(value: unknown): asserts value is PersistedSuggestionState {
  parseOrContractError(PersistedSuggestionStateSchema, value, "persisted.suggestion-projection");
}

export class ProjectRepository implements ProjectStore {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): ProjectSnapshot {
    const row = this.db.prepare(
      "SELECT id, name, revision FROM projects WHERE id = ?",
    ).get(id) as ProjectSnapshot | undefined;
    if (!row) throw new Error(`Project not found: ${id}`);
    return row;
  }

  incrementRevision(id: string, updatedAt: number) {
    const result = this.db.prepare(
      "UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?",
    ).run(updatedAt, id);
    if (result.changes !== 1) throw new Error(`Project not found: ${id}`);
  }
}

export class DocumentRepository implements DocumentStore {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): DocumentSnapshot {
    const row = this.db.prepare(
      `SELECT id, project_id, title, blocks_json, markdown, schema_version, revision, updated_at
       FROM documents WHERE id = ?`,
    ).get(id) as {
      id: string; project_id: string; title: string; blocks_json: string;
      markdown: string; schema_version: number; revision: number; updated_at: number;
    } | undefined;
    if (!row) throw new Error(`Document not found: ${id}`);
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      blocks: parseOrContractError(
        DocumentBlocksSchema,
        parseJson(row.blocks_json, "document blocks"),
        "persisted.document-blocks",
      ),
      markdown: row.markdown,
      schemaVersion: row.schema_version,
      revision: row.revision,
      updatedAt: row.updated_at,
    };
  }

  save(id: string, blocks: unknown[], markdown: string, updatedAt: number) {
    const validatedBlocks = parseOrContractError(
      DocumentBlocksSchema,
      blocks,
      "persisted.document-blocks.write",
    );
    const result = this.db.prepare(
      `UPDATE documents SET blocks_json = ?, markdown = ?, revision = revision + 1, updated_at = ?
       WHERE id = ?`,
    ).run(JSON.stringify(validatedBlocks), markdown, updatedAt, id);
    if (result.changes !== 1) throw new Error(`Document not found: ${id}`);
    return this.get(id);
  }
}

export class SourceRepository implements SourceStore {
  constructor(private readonly db: DatabaseSync) {}

  list(projectId: string): SourceSnapshot[] {
    const rows = this.db.prepare(
      `SELECT id, project_id, title, storage_path, bytes, updated_at
       FROM sources WHERE project_id = ? ORDER BY updated_at DESC`,
    ).all(projectId) as Array<{
      id: string; project_id: string; title: string; storage_path: string;
      bytes: number; updated_at: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      storagePath: row.storage_path,
      bytes: row.bytes,
      updatedAt: row.updated_at,
    }));
  }

  insert(source: SourceSnapshot, createdAt: number) {
    this.db.prepare(
      `INSERT INTO sources
        (id, project_id, title, storage_path, bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      source.id, source.projectId, source.title, source.storagePath,
      source.bytes, createdAt, source.updatedAt,
    );
  }

  get(id: string): SourceSnapshot {
    const source = this.db.prepare(
      `SELECT id, project_id, title, storage_path, bytes, updated_at FROM sources WHERE id = ?`,
    ).get(id) as {
      id: string; project_id: string; title: string; storage_path: string;
      bytes: number; updated_at: number;
    } | undefined;
    if (!source) throw new Error(`Source not found: ${id}`);
    return {
      id: source.id,
      projectId: source.project_id,
      title: source.title,
      storagePath: source.storage_path,
      bytes: source.bytes,
      updatedAt: source.updated_at,
    };
  }
}

export class SuggestionRepository implements SuggestionStore {
  constructor(private readonly db: DatabaseSync) {}

  get(projectId: string): SuggestionProjection {
    const row = this.db.prepare(
      "SELECT state_json, revision FROM suggestion_state WHERE project_id = ?",
    ).get(projectId) as { state_json: string; revision: number } | undefined;
    if (!row) throw new Error(`Suggestion projection not found: ${projectId}`);
    return { state: parseOrContractError(
        PersistedSuggestionStateSchema,
        parseJson(row.state_json, "suggestion projection"),
        "persisted.suggestion-projection",
      ), revision: row.revision };
  }

  compareAndPut(projectId: string, expectedRevision: number, state: PersistedSuggestionState) {
    const validated = parseOrContractError(
      PersistedSuggestionStateSchema,
      state,
      "persisted.suggestion-projection.write",
    );
    const result = this.db.prepare(
      "UPDATE suggestion_state SET state_json = ?, revision = revision + 1, updated_at = ? WHERE project_id = ? AND revision = ?",
    ).run(JSON.stringify(validated), Date.now(), projectId, expectedRevision);
    if (result.changes !== 1) throw new Error("SUGGESTION_REVISION_CONFLICT");
    return this.get(projectId);
  }

  findReceipt(commandId: string) {
    const row = this.db.prepare("SELECT result_json FROM suggestion_command_receipts WHERE command_id = ?")
      .get(commandId) as { result_json: string } | undefined;
    if (!row) return undefined;
    return parseOrContractError(SuggestionCommandResultSchema, parseJson(row.result_json, "suggestion command receipt"), "persisted.suggestion-command-receipt");
  }

  recordReceipt(projectId: string, result: SuggestionCommandResult) {
    const validated = parseOrContractError(SuggestionCommandResultSchema, result, "persisted.suggestion-command-receipt.write");
    this.db.prepare("INSERT INTO suggestion_command_receipts (command_id, project_id, result_json, created_at) VALUES (?, ?, ?, ?)")
      .run(result.commandId, projectId, JSON.stringify(validated), Date.now());
  }
}

export class OutboxRepository implements EventOutbox {
  constructor(private readonly db: DatabaseSync) {}

  enqueue(event: DesktopEvent) {
    const validated = parseOrContractError(
      DesktopEventSchema,
      event,
      "persisted.outbox-event.write",
    );
    this.db.prepare(
      "INSERT INTO event_outbox (event_json, created_at) VALUES (?, ?)",
    ).run(JSON.stringify(validated), Date.now());
  }

  pending(): PendingEvent[] {
    const rows = this.db.prepare(
      "SELECT sequence, event_json FROM event_outbox WHERE dispatched_at IS NULL ORDER BY sequence",
    ).all() as Array<{ sequence: number; event_json: string }>;
    return rows.map((row) => ({
      sequence: row.sequence,
      event: parseOrContractError(
        DesktopEventSchema,
        parseJson(row.event_json, "outbox event"),
        "persisted.outbox-event",
      ),
    }));
  }

  markDispatched(sequence: number) {
    this.db.prepare(
      "UPDATE event_outbox SET dispatched_at = ? WHERE sequence = ?",
    ).run(Date.now(), sequence);
  }
}
