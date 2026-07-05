import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

import type { DurableEventEnvelope, DurableEventPayload, DocumentSnapshot, SourceSnapshot } from "../../src/shared/desktop.js";
import type { PersistedSuggestionState } from "../../src/suggestions/state.js";
import {
  DEFAULT_EVENT_STREAM_ID,
  DurableEventEnvelopeSchema,
  DurableEventPayloadSchema,
  DocumentBlocksSchema,
  PersistedSuggestionStateSchema,
  SuggestionCommandResultSchema,
  StorageOperations,
  type OperationResult,
  parseOrContractError,
} from "../../src/shared/contracts.js";

export type ProjectSnapshot = { id: string; name: string; revision: number };
export type PendingEvent = DurableEventEnvelope;

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
  enqueue(event: DurableEventPayload, causationId?: string): DurableEventEnvelope;
  pending(): PendingEvent[];
  markDispatched(eventId: string): void;
  replay(streamId: string, afterSequence: number, limit?: number): {
    streamId: string; events: DurableEventEnvelope[]; headSequence: number;
    hasMore: boolean; historyAvailable: boolean;
  };
  head(streamId: string): number;
  acknowledge(consumerId: string, streamId: string, sequence: number): number;
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

  enqueue(event: DurableEventPayload, causationId?: string) {
    const validated = parseOrContractError(
      DurableEventPayloadSchema,
      event,
      "persisted.outbox-event.write",
    );
    const streamId = DEFAULT_EVENT_STREAM_ID;
    const sequence = this.head(streamId) + 1;
    const eventId = randomUUID();
    const occurredAt = Date.now();
    this.db.prepare(
      `INSERT INTO event_outbox
        (event_id, stream_id, sequence, event_json, occurred_at, causation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(eventId, streamId, sequence, JSON.stringify(validated), occurredAt, causationId ?? null, occurredAt);
    return { eventId, streamId, sequence, occurredAt, causationId, payload: validated };
  }

  pending(): PendingEvent[] {
    const rows = this.db.prepare(
      `SELECT event_id, stream_id, sequence, event_json, occurred_at, causation_id
       FROM event_outbox WHERE dispatched_at IS NULL ORDER BY stream_id, sequence`,
    ).all() as PersistedEventRow[];
    return rows.map(parseEnvelope);
  }

  markDispatched(eventId: string) {
    this.db.prepare(
      "UPDATE event_outbox SET dispatched_at = ? WHERE event_id = ?",
    ).run(Date.now(), eventId);
  }

  head(streamId: string) {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM event_outbox WHERE stream_id = ?",
    ).get(streamId) as { sequence: number };
    return row.sequence;
  }

  replay(streamId: string, afterSequence: number, requestedLimit = 100) {
    const limit = Math.max(1, Math.min(100, requestedLimit));
    const headSequence = this.head(streamId);
    if (streamId !== DEFAULT_EVENT_STREAM_ID) {
      return { streamId, events: [], headSequence, hasMore: false, historyAvailable: false };
    }
    const first = this.db.prepare(
      "SELECT MIN(sequence) AS sequence FROM event_outbox WHERE stream_id = ?",
    ).get(streamId) as { sequence: number | null };
    const historyAvailable = afterSequence === 0
      ? first.sequence === null || first.sequence === 1
      : afterSequence <= headSequence && (afterSequence === headSequence || this.db.prepare(
          "SELECT 1 FROM event_outbox WHERE stream_id = ? AND sequence = ?",
        ).get(streamId, afterSequence) !== undefined);
    if (!historyAvailable) return { streamId, events: [], headSequence, hasMore: false, historyAvailable };
    const rows = this.db.prepare(
      `SELECT event_id, stream_id, sequence, event_json, occurred_at, causation_id
       FROM event_outbox WHERE stream_id = ? AND sequence > ?
       ORDER BY sequence LIMIT ?`,
    ).all(streamId, afterSequence, limit) as PersistedEventRow[];
    const events = rows.map(parseEnvelope);
    return { streamId, events, headSequence,
      hasMore: (events.at(-1)?.sequence ?? afterSequence) < headSequence,
      historyAvailable: true };
  }

  acknowledge(consumerId: string, streamId: string, sequence: number) {
    if (streamId !== DEFAULT_EVENT_STREAM_ID) throw new Error("UNKNOWN_EVENT_STREAM");
    const head = this.head(streamId);
    if (sequence > head) throw new Error("ACKNOWLEDGEMENT_PAST_STREAM_HEAD");
    this.db.prepare(`INSERT INTO event_consumer_cursor
      (consumer_id, stream_id, acknowledged_sequence, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (consumer_id, stream_id) DO UPDATE SET
        acknowledged_sequence = MAX(acknowledged_sequence, excluded.acknowledged_sequence),
        updated_at = CASE WHEN excluded.acknowledged_sequence > acknowledged_sequence
          THEN excluded.updated_at ELSE updated_at END`
    ).run(consumerId, streamId, sequence, Date.now());
    const row = this.db.prepare(`SELECT acknowledged_sequence FROM event_consumer_cursor
      WHERE consumer_id = ? AND stream_id = ?`).get(consumerId, streamId) as { acknowledged_sequence: number };
    return row.acknowledged_sequence;
  }
}

type PersistedEventRow = {
  event_id: string; stream_id: string; sequence: number;
  event_json: string; occurred_at: number; causation_id: string | null;
};

function parseEnvelope(row: PersistedEventRow): DurableEventEnvelope {
  return parseOrContractError(DurableEventEnvelopeSchema, {
    eventId: row.event_id,
    streamId: row.stream_id,
    sequence: row.sequence,
    occurredAt: row.occurred_at,
    ...(row.causation_id ? { causationId: row.causation_id } : {}),
    payload: parseJson(row.event_json, "outbox event"),
  }, "persisted.outbox-event");
}
