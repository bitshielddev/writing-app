import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Static, TSchema } from "typebox";

import type {
  DurableEventEnvelope,
  DurableEventPayload,
  DocumentSnapshot,
  SourceSnapshot,
} from "../../src/shared/desktop.js";
import type { PersistedSuggestionState } from "../../src/suggestions/state.js";
import {
  COMPATIBILITY_REGISTRY,
  DurableCompatibilityError,
  decodeVersionedJson,
  encodeVersionedJson,
  type JsonMigration,
} from "../compatibility.js";
import {
  DEFAULT_EVENT_STREAM_ID,
  DurableEventEnvelopeSchema,
  DurableEventPayloadSchema,
  DocumentBlocksSchema,
  PersistedSuggestionStateSchema,
  SuggestionCommandResultSchema,
  parseOrContractError,
} from "../../src/shared/contracts.js";
import type {
  DocumentStore,
  EventOutbox,
  ProjectSnapshot,
  ProjectStore,
  SourceStore,
  SuggestionCommandResult,
  SuggestionProjection,
  SuggestionStore,
} from "../application/storage-ports.js";
import {
  clampReplayLimit,
  nextAcknowledgedSequence,
} from "../domain/event-sequence.js";

export type PendingEvent = DurableEventEnvelope;

const LEGACY_TO_CURRENT: readonly JsonMigration[] = [{
  fromVersion: 0,
  toVersion: 1,
  migrate: (value) => value,
}];

function quarantine(db: DatabaseSync, error: DurableCompatibilityError, sourceText: string) {
  db.prepare(`INSERT INTO durable_json_quarantine
    (format_name, record_identity, source_text, detected_version, error_code, quarantined_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (format_name, record_identity) DO NOTHING`
  ).run(
    error.format,
    error.recordIdentity,
    sourceText,
    error.detectedVersion ?? null,
    error.code,
    Date.now(),
  );
}

function decode(db: DatabaseSync, options: Parameters<typeof decodeVersionedJson>[0]) {
  try {
    return decodeVersionedJson(options);
  } catch (error) {
    if (error instanceof DurableCompatibilityError) quarantine(db, error, options.text);
    throw error;
  }
}

function validatePersisted<Schema extends TSchema>(options: {
  db: DatabaseSync;
  schema: Schema;
  value: unknown;
  boundary: string;
  format: string;
  identity: string;
  sourceText: string;
  version: number;
}): Static<Schema> {
  try {
    return parseOrContractError(options.schema, options.value, options.boundary);
  } catch (error) {
    const compatibilityError = new DurableCompatibilityError(
      "DURABLE_JSON_INVALID",
      options.format,
      options.identity,
      options.version,
      `Invalid persisted ${options.format} data`,
    );
    quarantine(options.db, compatibilityError, options.sourceText);
    throw error;
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

  save(id: string, blocks: unknown[], markdown: string, updatedAt: number) {
    const validatedBlocks = parseOrContractError(
      DocumentBlocksSchema,
      blocks,
      "persisted.document-blocks.write",
    );
    const result = this.db.prepare(
      `UPDATE documents SET blocks_json = ?, markdown = ?, revision = revision + 1, updated_at = ?
       WHERE id = ?`,
    ).run(encodeVersionedJson(
      COMPATIBILITY_REGISTRY.documentBlocks.name,
      COMPATIBILITY_REGISTRY.documentBlocks.currentVersion,
      validatedBlocks,
      "blocks",
    ), markdown, updatedAt, id);
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
    const policy = COMPATIBILITY_REGISTRY.suggestionProjection;
    const decoded = decode(this.db, {
      text: row.state_json,
      format: policy.name,
      currentVersion: policy.currentVersion,
      minimumReadableVersion: policy.minimumReadableVersion,
      legacyVersion: 0,
      payloadKey: "state",
      migrations: LEGACY_TO_CURRENT,
      recordIdentity: projectId,
    });
    const state = validatePersisted({
      db: this.db, schema: PersistedSuggestionStateSchema, value: decoded.payload,
      boundary: "persisted.suggestion-projection", format: policy.name,
      identity: projectId, sourceText: row.state_json, version: decoded.detectedVersion,
    });
    if (decoded.migrated) this.db.prepare(
      "UPDATE suggestion_state SET state_json = ? WHERE project_id = ? AND state_json = ?",
    ).run(encodeVersionedJson(policy.name, policy.currentVersion, state, "state"), projectId, row.state_json);
    return { state, revision: row.revision };
  }

  compareAndPut(projectId: string, expectedRevision: number, state: PersistedSuggestionState) {
    const validated = parseOrContractError(
      PersistedSuggestionStateSchema,
      state,
      "persisted.suggestion-projection.write",
    );
    const result = this.db.prepare(
      "UPDATE suggestion_state SET state_json = ?, revision = revision + 1, updated_at = ? WHERE project_id = ? AND revision = ?",
    ).run(encodeVersionedJson(
      COMPATIBILITY_REGISTRY.suggestionProjection.name,
      COMPATIBILITY_REGISTRY.suggestionProjection.currentVersion,
      validated,
      "state",
    ), Date.now(), projectId, expectedRevision);
    if (result.changes !== 1) throw new Error("SUGGESTION_REVISION_CONFLICT");
    return this.get(projectId);
  }

  findReceipt(commandId: string) {
    const row = this.db.prepare("SELECT result_json FROM suggestion_command_receipts WHERE command_id = ?")
      .get(commandId) as { result_json: string } | undefined;
    if (!row) return undefined;
    const policy = COMPATIBILITY_REGISTRY.suggestionCommands;
    const decoded = decode(this.db, {
      text: row.result_json, format: policy.name, currentVersion: policy.currentVersion,
      minimumReadableVersion: policy.minimumReadableVersion, legacyVersion: 0,
      payloadKey: "result", migrations: LEGACY_TO_CURRENT, recordIdentity: commandId,
    });
    const result = validatePersisted({
      db: this.db, schema: SuggestionCommandResultSchema, value: decoded.payload,
      boundary: "persisted.suggestion-command-receipt", format: policy.name,
      identity: commandId, sourceText: row.result_json, version: decoded.detectedVersion,
    });
    if (decoded.migrated) this.db.prepare(
      "UPDATE suggestion_command_receipts SET result_json = ? WHERE command_id = ? AND result_json = ?",
    ).run(encodeVersionedJson(policy.name, policy.currentVersion, result, "result"), commandId, row.result_json);
    return result;
  }

  recordReceipt(projectId: string, result: SuggestionCommandResult) {
    const validated = parseOrContractError(SuggestionCommandResultSchema, result, "persisted.suggestion-command-receipt.write");
    this.db.prepare("INSERT INTO suggestion_command_receipts (command_id, project_id, result_json, created_at) VALUES (?, ?, ?, ?)")
      .run(result.commandId, projectId, encodeVersionedJson(
        COMPATIBILITY_REGISTRY.suggestionCommands.name,
        COMPATIBILITY_REGISTRY.suggestionCommands.currentVersion,
        validated,
        "result",
      ), Date.now());
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
    ).run(eventId, streamId, sequence, encodeVersionedJson(
      COMPATIBILITY_REGISTRY.suggestionEvents.name,
      COMPATIBILITY_REGISTRY.suggestionEvents.currentVersion,
      validated,
      "event",
    ), occurredAt, causationId ?? null, occurredAt);
    return { eventId, streamId, sequence, occurredAt, causationId, payload: validated };
  }

  pending(): PendingEvent[] {
    const rows = this.db.prepare(
      `SELECT event_id, stream_id, sequence, event_json, occurred_at, causation_id
       FROM event_outbox WHERE dispatched_at IS NULL ORDER BY stream_id, sequence`,
    ).all() as PersistedEventRow[];
    return this.parseContiguous(rows);
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
    const limit = clampReplayLimit(requestedLimit);
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
    const events = this.parseContiguous(rows);
    return { streamId, events, headSequence,
      hasMore: (events.at(-1)?.sequence ?? afterSequence) < headSequence,
      historyAvailable: true };
  }

  acknowledge(consumerId: string, streamId: string, sequence: number) {
    if (streamId !== DEFAULT_EVENT_STREAM_ID) throw new Error("UNKNOWN_EVENT_STREAM");
    const head = this.head(streamId);
    const existing = this.db.prepare(`SELECT acknowledged_sequence FROM event_consumer_cursor
      WHERE consumer_id = ? AND stream_id = ?`).get(consumerId, streamId) as
      { acknowledged_sequence: number } | undefined;
    const acknowledgedSequence = nextAcknowledgedSequence(
      existing?.acknowledged_sequence ?? 0,
      sequence,
      head,
    );
    this.db.prepare(`INSERT INTO event_consumer_cursor
      (consumer_id, stream_id, acknowledged_sequence, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (consumer_id, stream_id) DO UPDATE SET
        acknowledged_sequence = MAX(acknowledged_sequence, excluded.acknowledged_sequence),
        updated_at = CASE WHEN excluded.acknowledged_sequence > acknowledged_sequence
          THEN excluded.updated_at ELSE updated_at END`
    ).run(consumerId, streamId, acknowledgedSequence, Date.now());
    const row = this.db.prepare(`SELECT acknowledged_sequence FROM event_consumer_cursor
      WHERE consumer_id = ? AND stream_id = ?`).get(consumerId, streamId) as { acknowledged_sequence: number };
    return row.acknowledged_sequence;
  }

  private parseContiguous(rows: PersistedEventRow[]) {
    const events: DurableEventEnvelope[] = [];
    for (const row of rows) {
      try {
        events.push(parseEnvelope(this.db, row));
      } catch (error) {
        if (error instanceof DurableCompatibilityError) break;
        if (error instanceof Error && error.name === "ContractValidationError") {
          const compatibilityError = new DurableCompatibilityError(
            "DURABLE_JSON_INVALID",
            COMPATIBILITY_REGISTRY.suggestionEvents.name,
            row.event_id,
            undefined,
            "Invalid persisted event payload",
          );
          quarantine(this.db, compatibilityError, row.event_json);
          break;
        }
        throw error;
      }
    }
    return events;
  }
}

type PersistedEventRow = {
  event_id: string; stream_id: string; sequence: number;
  event_json: string; occurred_at: number; causation_id: string | null;
};

function parseEnvelope(db: DatabaseSync, row: PersistedEventRow): DurableEventEnvelope {
  const policy = COMPATIBILITY_REGISTRY.suggestionEvents;
  const decoded = decode(db, {
    text: row.event_json, format: policy.name, currentVersion: policy.currentVersion,
    minimumReadableVersion: policy.minimumReadableVersion, legacyVersion: 0,
    payloadKey: "event", migrations: LEGACY_TO_CURRENT, recordIdentity: row.event_id,
  });
  const payload = validatePersisted({
    db, schema: DurableEventPayloadSchema, value: decoded.payload,
    boundary: "persisted.outbox-event.payload", format: policy.name,
    identity: row.event_id, sourceText: row.event_json, version: decoded.detectedVersion,
  });
  if (decoded.migrated) db.prepare(
    "UPDATE event_outbox SET event_json = ? WHERE event_id = ? AND event_json = ?",
  ).run(encodeVersionedJson(policy.name, policy.currentVersion, payload, "event"), row.event_id, row.event_json);
  return parseOrContractError(DurableEventEnvelopeSchema, {
    eventId: row.event_id,
    streamId: row.stream_id,
    sequence: row.sequence,
    occurredAt: row.occurred_at,
    ...(row.causation_id ? { causationId: row.causation_id } : {}),
    payload,
  }, "persisted.outbox-event");
}
