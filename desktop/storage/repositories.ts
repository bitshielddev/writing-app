import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Static, TSchema } from "typebox";

import type {
  DurableEventEnvelope,
  DurableEventPayload,
  DocumentSnapshot,
  SourceSnapshot,
} from "../../src/contracts/desktop-bridge.js";
import type { PersistedSuggestionState } from "../../src/domain/suggestions/state.js";
import {
  COMPATIBILITY_REGISTRY,
  DurableCompatibilityError,
  decodeVersionedJson,
  encodeVersionedJson,
  type JsonMigration,
} from "../../src/contracts/compatibility.js";
import {
  DurableEventEnvelopeSchema,
  DurableEventPayloadSchema,
  DocumentBlocksSchema,
  PersistedSuggestionStateSchema,
  SequencedSuggestionFactSchema,
  SuggestionCommandEnvelopeSchema,
  SuggestionFactSchema,
  SuggestionCommandResultSchema,
} from "../../src/contracts/events.js";
import {
  parseOrContractError,
} from "../../src/contracts/validation.js";
import type {
  DocumentStore,
  EventOutbox,
  ProjectSnapshot,
  ProjectStore,
  SourceStore,
  SuggestionCommandResult,
  SuggestionProjection,
  SuggestionStore,
  SelectionStore,
} from "../application/storage-ports.js";
import { createEmptySuggestionState } from "../../src/domain/suggestions/state.js";
import { DOCUMENT_SCHEMA_VERSION } from "./config.js";
import {
  clampReplayLimit,
  nextAcknowledgedSequence,
} from "../domain/event-sequence.js";
import {
  applySuggestionFact,
  SUGGESTION_PROJECTION_VERSION,
  type SequencedSuggestionFact,
  type SuggestionCommandEnvelope,
  type SuggestionFact,
} from "../../src/domain/suggestions/aggregate.js";
import { suggestionProjectionChecksum } from "./projection-checksum.js";

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

export class DocumentRepository implements DocumentStore {
  constructor(private readonly db: DatabaseSync) {}

  list(projectId?: string) {
    const sql = `SELECT id, project_id, title, revision FROM documents
      ${projectId ? "WHERE project_id = ?" : ""} ORDER BY created_at, id`;
    const rows = (projectId ? this.db.prepare(sql).all(projectId) : this.db.prepare(sql).all()) as
      Array<{ id: string; project_id: string; title: string; revision: number }>;
    return rows.map((row) => ({ id: row.id, projectId: row.project_id, title: row.title, revision: row.revision }));
  }

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

  rename(projectId: string, id: string, title: string, now: number) {
    const result = this.db.prepare(
      "UPDATE documents SET title = ?, updated_at = ? WHERE project_id = ? AND id = ?",
    ).run(title, now, projectId, id);
    if (result.changes !== 1) throw new Error("Document not found or not owned by project");
    return this.get(projectId, id);
  }

  count(projectId: string) {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM documents WHERE project_id = ?")
      .get(projectId) as { count: number }).count;
  }

  delete(projectId: string, id: string) {
    if (this.count(projectId) <= 1) throw new Error("LAST_DOCUMENT_DELETE_FORBIDDEN");
    const result = this.db.prepare(
      "DELETE FROM documents WHERE project_id = ? AND id = ?",
    ).run(projectId, id);
    if (result.changes !== 1) throw new Error("Document not found or not owned by project");
  }

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

export class SuggestionRepository implements SuggestionStore {
  constructor(private readonly db: DatabaseSync) {}

  get(projectId: string, documentId?: string): SuggestionProjection {
    documentId ??= (this.db.prepare(
      "SELECT id FROM documents WHERE project_id = ? ORDER BY created_at, id LIMIT 1",
    ).get(projectId) as { id: string } | undefined)?.id;
    if (!documentId) throw new Error(`Suggestion projection not found: ${projectId}`);
    const row = this.db.prepare(
      `SELECT state_json, revision, covered_through_sequence FROM suggestion_projection
       WHERE project_id = ? AND document_id = ?`,
    ).get(projectId, documentId) as { state_json: string; revision: number; covered_through_sequence: number } | undefined;
    if (!row) throw new Error(`Suggestion projection not found: ${documentId}`);
    const policy = COMPATIBILITY_REGISTRY.suggestionProjection;
    const decoded = decode(this.db, {
      text: row.state_json,
      format: policy.name,
      currentVersion: policy.currentVersion,
      minimumReadableVersion: policy.minimumReadableVersion,
      legacyVersion: 0,
      payloadKey: "state",
      migrations: LEGACY_TO_CURRENT,
      recordIdentity: documentId,
    });
    const state = validatePersisted({
      db: this.db, schema: PersistedSuggestionStateSchema, value: decoded.payload,
      boundary: "persisted.suggestion-projection", format: policy.name,
      identity: documentId, sourceText: row.state_json, version: decoded.detectedVersion,
    });
    if (decoded.migrated) this.db.prepare(
      "UPDATE suggestion_projection SET state_json = ? WHERE project_id = ? AND document_id = ? AND state_json = ?",
    ).run(encodeVersionedJson(policy.name, policy.currentVersion, state, "state"), projectId, documentId, row.state_json);
    return { state, revision: row.revision, coveredThroughSequence: row.covered_through_sequence };
  }

  compareAndPut(projectId: string, documentId: string | number, expectedRevision: number | PersistedSuggestionState, state?: PersistedSuggestionState) {
    if (typeof documentId === "number") {
      state = expectedRevision as PersistedSuggestionState;
      expectedRevision = documentId;
      documentId = (this.db.prepare("SELECT id FROM documents WHERE project_id = ? ORDER BY created_at, id LIMIT 1")
        .get(projectId) as { id: string }).id;
    }
    const validated = parseOrContractError(
      PersistedSuggestionStateSchema,
      state!,
      "persisted.suggestion-projection.write",
    );
    const result = this.db.prepare(
      `UPDATE suggestion_projection SET state_json = ?, revision = revision + 1,
       checksum = ?, updated_at = ? WHERE project_id = ? AND document_id = ? AND revision = ?`,
    ).run(encodeVersionedJson(
      COMPATIBILITY_REGISTRY.suggestionProjection.name,
      COMPATIBILITY_REGISTRY.suggestionProjection.currentVersion,
      validated,
      "state",
    ), suggestionProjectionChecksum(validated, this.get(projectId, documentId).coveredThroughSequence ?? 0),
    Date.now(), projectId, documentId, expectedRevision as number);
    if (result.changes !== 1) throw new Error("SUGGESTION_REVISION_CONFLICT");
    return this.get(projectId, documentId);
  }

  appendFacts(command: SuggestionCommandEnvelope, facts: SuggestionFact[], eventIds: string[]) {
    const validatedCommand = parseOrContractError(
      SuggestionCommandEnvelopeSchema, command, "persisted.suggestion-command.write",
    );
    if (facts.length !== eventIds.length) throw new Error("SUGGESTION_EVENT_ID_COUNT_MISMATCH");
    const current = this.get(command.projectId, command.documentId);
    let projection = { ...current, coveredThroughSequence: current.coveredThroughSequence ?? 0 };
    const events: SequencedSuggestionFact[] = [];
    for (const [index, candidate] of facts.entries()) {
      const fact = parseOrContractError(SuggestionFactSchema, candidate, "persisted.suggestion-event.write");
      const event = parseOrContractError(SequencedSuggestionFactSchema, {
        eventId: eventIds[index], sequence: projection.coveredThroughSequence + 1,
        commandId: command.commandId, actor: validatedCommand.actor,
        occurredAt: command.requestedAt, fact,
      }, "persisted.suggestion-event-envelope.write") as SequencedSuggestionFact;
      projection = applySuggestionFact(projection, event);
      this.db.prepare(`INSERT INTO suggestion_event_history
        (event_id, project_id, document_id, sequence, command_id, actor_json, event_type,
         event_version, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(event.eventId, command.projectId, command.documentId, event.sequence, command.commandId,
          JSON.stringify(event.actor), event.fact.type, event.fact.version, JSON.stringify(event.fact),
          event.occurredAt);
      events.push(event);
    }
    if (events.length) {
      const validatedState = parseOrContractError(
        PersistedSuggestionStateSchema, projection.state, "persisted.suggestion-projection.write",
      );
      const result = this.db.prepare(`UPDATE suggestion_projection SET state_json = ?, revision = ?,
        covered_through_sequence = ?, projection_version = ?, checksum = ?, updated_at = ?
        WHERE project_id = ? AND document_id = ? AND revision = ? AND covered_through_sequence = ?`)
        .run(encodeVersionedJson(COMPATIBILITY_REGISTRY.suggestionProjection.name,
          COMPATIBILITY_REGISTRY.suggestionProjection.currentVersion, validatedState, "state"),
        projection.revision, projection.coveredThroughSequence, SUGGESTION_PROJECTION_VERSION,
        suggestionProjectionChecksum(validatedState, projection.coveredThroughSequence), command.requestedAt,
        command.projectId, command.documentId, current.revision, current.coveredThroughSequence ?? 0);
      if (result.changes !== 1) throw new Error("SUGGESTION_REVISION_CONFLICT");
    }
    return { projection, events };
  }

  recordCommandReceipt(command: SuggestionCommandEnvelope, result: SuggestionCommandResult,
    firstSequence?: number, resultingSequence = this.get(command.projectId, command.documentId).coveredThroughSequence ?? 0,
    errorCode?: string) {
    const validatedCommand = parseOrContractError(
      SuggestionCommandEnvelopeSchema, command, "persisted.suggestion-command-receipt.command",
    );
    const validated = parseOrContractError(
      SuggestionCommandResultSchema, result, "persisted.suggestion-command-receipt.write",
    );
    this.db.prepare(`INSERT INTO suggestion_command_receipts
      (command_id, project_id, document_id, result_json, actor_json, command_type, command_version,
       payload_json, outcome, first_sequence, resulting_sequence, error_code, requested_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(validated.commandId, command.projectId, command.documentId,
        encodeVersionedJson(COMPATIBILITY_REGISTRY.suggestionCommands.name,
          COMPATIBILITY_REGISTRY.suggestionCommands.currentVersion, validated, "result"),
        JSON.stringify(validatedCommand.actor), validatedCommand.command.type, validatedCommand.version,
        JSON.stringify(validatedCommand), validated.status, firstSequence ?? null, resultingSequence,
        errorCode ?? null, validatedCommand.requestedAt, Date.now());
  }

  history(projectId: string, documentId: string, afterSequence = 0): SequencedSuggestionFact[] {
    const rows = this.db.prepare(`SELECT event_id, sequence, command_id, actor_json, payload_json, occurred_at
      FROM suggestion_event_history WHERE project_id = ? AND document_id = ? AND sequence > ?
      ORDER BY sequence`).all(projectId, documentId, afterSequence) as Array<{
        event_id: string; sequence: number; command_id: string; actor_json: string;
        payload_json: string; occurred_at: number;
      }>;
    return rows.map((row) => parseOrContractError(SequencedSuggestionFactSchema, {
      eventId: row.event_id, sequence: row.sequence, commandId: row.command_id,
      actor: JSON.parse(row.actor_json), occurredAt: row.occurred_at, fact: JSON.parse(row.payload_json),
    }, "persisted.suggestion-event.read") as SequencedSuggestionFact);
  }

  rebuild(projectId: string, documentId: string) {
    const empty = createEmptySuggestionState();
    let projection = { state: empty, revision: 0, coveredThroughSequence: 0 };
    const checkpoint = this.db.prepare(`SELECT sequence, projection_revision, state_json, checksum,
      projection_version FROM suggestion_projection_checkpoint WHERE project_id = ? AND document_id = ?
      ORDER BY sequence DESC LIMIT 1`).get(projectId, documentId) as {
        sequence: number; projection_revision: number; state_json: string; checksum: string;
        projection_version: number;
      } | undefined;
    if (checkpoint) {
      if (checkpoint.projection_version !== SUGGESTION_PROJECTION_VERSION) {
        throw new Error("UNKNOWN_SUGGESTION_CHECKPOINT_VERSION");
      }
      const decoded = decodeVersionedJson({ text: checkpoint.state_json,
        format: COMPATIBILITY_REGISTRY.suggestionProjection.name,
        currentVersion: COMPATIBILITY_REGISTRY.suggestionProjection.currentVersion,
        minimumReadableVersion: COMPATIBILITY_REGISTRY.suggestionProjection.minimumReadableVersion,
        legacyVersion: 0, payloadKey: "state", migrations: LEGACY_TO_CURRENT,
        recordIdentity: `checkpoint:${documentId}:${checkpoint.sequence}` });
      const state = parseOrContractError(PersistedSuggestionStateSchema, decoded.payload,
        "persisted.suggestion-checkpoint.read");
      if (suggestionProjectionChecksum(state, checkpoint.sequence) !== checkpoint.checksum) {
        throw new Error("INVALID_SUGGESTION_CHECKPOINT_CHECKSUM");
      }
      projection = { state, revision: checkpoint.projection_revision,
        coveredThroughSequence: checkpoint.sequence };
    }
    for (const event of this.history(projectId, documentId, projection.coveredThroughSequence)) {
      projection = applySuggestionFact(projection, event);
    }
    return { ...projection, checksum: suggestionProjectionChecksum(
      projection.state, projection.coveredThroughSequence),
    };
  }

  verify(projectId: string, documentId: string) {
    const started = performance.now();
    try {
      const rebuilt = this.rebuild(projectId, documentId);
      const current = this.get(projectId, documentId);
      const checksum = suggestionProjectionChecksum(current.state, current.coveredThroughSequence ?? 0);
      return { valid: rebuilt.checksum === checksum && rebuilt.revision === current.revision,
        currentChecksum: checksum, rebuiltChecksum: rebuilt.checksum,
        coverage: rebuilt.coveredThroughSequence, replayDurationMs: performance.now() - started };
    } catch (error) {
      this.db.prepare(`INSERT INTO durable_json_quarantine
        (format_name, record_identity, source_text, error_code, quarantined_at)
        VALUES (?, ?, '', ?, ?) ON CONFLICT(format_name, record_identity) DO UPDATE SET
        error_code = excluded.error_code, quarantined_at = excluded.quarantined_at`)
        .run("scribe.suggestion-history", documentId,
          error instanceof Error ? error.message.slice(0, 100) : "REBUILD_FAILED", Date.now());
      throw error;
    }
  }

  repair(projectId: string, documentId: string, backupConfirmed: boolean) {
    if (!backupConfirmed) throw new Error("SUGGESTION_REPAIR_REQUIRES_BACKUP");
    const rebuilt = this.rebuild(projectId, documentId);
    const result = this.db.prepare(`UPDATE suggestion_projection SET state_json = ?, revision = ?,
      covered_through_sequence = ?, projection_version = ?, checksum = ?, updated_at = ?
      WHERE project_id = ? AND document_id = ?`).run(
      encodeVersionedJson(COMPATIBILITY_REGISTRY.suggestionProjection.name,
        COMPATIBILITY_REGISTRY.suggestionProjection.currentVersion, rebuilt.state, "state"),
      rebuilt.revision, rebuilt.coveredThroughSequence, SUGGESTION_PROJECTION_VERSION,
      rebuilt.checksum, Date.now(), projectId, documentId);
    if (result.changes !== 1) throw new Error("SUGGESTION_PROJECTION_NOT_FOUND");
    return rebuilt;
  }

  createCheckpoint(projectId: string, documentId: string, replayDurationMs = 0, force = false) {
    const projection = this.get(projectId, documentId);
    const coverage = projection.coveredThroughSequence ?? 0;
    const latest = this.db.prepare(`SELECT COALESCE(MAX(sequence), 0) AS sequence
      FROM suggestion_projection_checkpoint WHERE document_id = ?`).get(documentId) as { sequence: number };
    if (!force && coverage - latest.sequence < 500 && replayDurationMs <= 2_000) return undefined;
    const checkpointId = randomUUID();
    const checksum = suggestionProjectionChecksum(projection.state, coverage);
    const inserted = this.db.prepare(`INSERT OR IGNORE INTO suggestion_projection_checkpoint
      (checkpoint_id, project_id, document_id, sequence, projection_version, projection_revision,
       state_json, checksum, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM suggestion_projection WHERE document_id = ? AND covered_through_sequence = ?
      )`).run(checkpointId, projectId, documentId, coverage, SUGGESTION_PROJECTION_VERSION,
      projection.revision, encodeVersionedJson(COMPATIBILITY_REGISTRY.suggestionProjection.name,
        COMPATIBILITY_REGISTRY.suggestionProjection.currentVersion, projection.state, "state"),
      checksum, Date.now(), documentId, coverage);
    if (inserted.changes !== 1) return undefined;
    this.db.prepare(`DELETE FROM suggestion_projection_checkpoint WHERE document_id = ? AND checkpoint_id NOT IN
      (SELECT checkpoint_id FROM suggestion_projection_checkpoint WHERE document_id = ?
       ORDER BY sequence DESC LIMIT 10)`).run(documentId, documentId);
    return { checkpointId, sequence: coverage, checksum };
  }

  diagnostics(projectId: string, documentId: string) {
    const events = this.db.prepare(`SELECT COUNT(*) AS count,
      COALESCE(SUM(LENGTH(payload_json) + LENGTH(actor_json)), 0) AS bytes
      FROM suggestion_event_history WHERE project_id = ? AND document_id = ?`)
      .get(projectId, documentId) as { count: number; bytes: number };
    const checkpoint = this.db.prepare(`SELECT COALESCE(MAX(sequence), 0) AS sequence
      FROM suggestion_projection_checkpoint WHERE document_id = ?`).get(documentId) as { sequence: number };
    const pageCount = (this.db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
    const pageSize = (this.db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size;
    const verification = this.verify(projectId, documentId);
    return { eventCount: events.count, eventBytes: events.bytes,
      lastCheckpointSequence: checkpoint.sequence, replayDurationMs: verification.replayDurationMs,
      projectionMismatch: !verification.valid, databaseBytes: pageCount * pageSize };
  }

  findReceipt(projectId: string, documentId?: string, commandId?: string) {
    if (commandId === undefined) {
      commandId = projectId;
      const owner = this.db.prepare(`SELECT project_id, document_id FROM suggestion_command_receipts
        WHERE command_id = ?`).get(commandId) as { project_id: string; document_id: string } | undefined;
      if (!owner) return undefined;
      projectId = owner.project_id; documentId = owner.document_id;
    }
    if (!documentId) return undefined;
    const row = this.db.prepare(`SELECT result_json FROM suggestion_command_receipts
      WHERE command_id = ? AND project_id = ? AND document_id = ?`)
      .get(commandId, projectId, documentId) as { result_json: string } | undefined;
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

  recordReceipt(projectId: string, documentId: string | SuggestionCommandResult, result?: SuggestionCommandResult) {
    if (typeof documentId !== "string") {
      result = documentId;
      documentId = (this.db.prepare("SELECT id FROM documents WHERE project_id = ? ORDER BY created_at, id LIMIT 1")
        .get(projectId) as { id: string }).id;
    }
    const validated = parseOrContractError(SuggestionCommandResultSchema, result, "persisted.suggestion-command-receipt.write");
    this.db.prepare(`INSERT INTO suggestion_command_receipts
      (command_id, project_id, document_id, result_json, actor_json, command_type, command_version,
       payload_json, outcome, resulting_sequence, requested_at, created_at)
      VALUES (?, ?, ?, ?, '{"type":"system","id":"legacy-adapter"}', 'legacy', 1, '{}', ?, ?, ?, ?)`)
      .run(result!.commandId, projectId, documentId, encodeVersionedJson(
        COMPATIBILITY_REGISTRY.suggestionCommands.name,
        COMPATIBILITY_REGISTRY.suggestionCommands.currentVersion,
        validated,
        "result",
      ), result!.status, this.get(projectId, documentId).coveredThroughSequence ?? 0, Date.now(), Date.now());
  }
}

export class OutboxRepository implements EventOutbox {
  constructor(private readonly db: DatabaseSync) {}

  enqueue(projectId: string | DurableEventPayload, documentId?: string, event?: DurableEventPayload, causationId?: string) {
    if (typeof projectId !== "string") {
      causationId = documentId;
      event = projectId;
      const selected = this.db.prepare(`SELECT selected_project_id, selected_document_id
        FROM workspace_settings WHERE id = 1`).get() as
        { selected_project_id: string; selected_document_id: string };
      projectId = selected.selected_project_id;
      documentId = selected.selected_document_id;
    }
    if (!documentId || !event) throw new Error("Event scope is required");
    const validated = parseOrContractError(
      DurableEventPayloadSchema,
      event,
      "persisted.outbox-event.write",
    );
    const streamId = `document:${documentId}`;
    const sequence = this.head(streamId) + 1;
    const eventId = randomUUID();
    const occurredAt = Date.now();
    this.db.prepare(
      `INSERT INTO event_outbox
        (event_id, project_id, document_id, stream_id, sequence, event_json, occurred_at, causation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(eventId, projectId, documentId, streamId, sequence, encodeVersionedJson(
      COMPATIBILITY_REGISTRY.suggestionEvents.name,
      COMPATIBILITY_REGISTRY.suggestionEvents.currentVersion,
      validated,
      "event",
    ), occurredAt, causationId ?? null, occurredAt);
    return { eventId, streamId, sequence, occurredAt, causationId, payload: validated };
  }

  enqueueSuggestionFact(projectId: string, documentId: string, suggestionEventId: string) {
    const factRow = this.db.prepare(`SELECT command_id, occurred_at FROM suggestion_event_history
      WHERE event_id = ? AND project_id = ? AND document_id = ?`).get(
      suggestionEventId, projectId, documentId,
    ) as { command_id: string; occurred_at: number } | undefined;
    if (!factRow) throw new Error("SUGGESTION_EVENT_NOT_FOUND");
    const streamId = `document:${documentId}`;
    const sequence = this.head(streamId) + 1;
    const eventId = randomUUID();
    this.db.prepare(`INSERT INTO event_outbox
      (event_id, project_id, document_id, stream_id, sequence, event_json, suggestion_event_id,
       occurred_at, causation_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`)
      .run(eventId, projectId, documentId, streamId, sequence, suggestionEventId,
        factRow.occurred_at, factRow.command_id, factRow.occurred_at);
    return this.parseRow({ event_id: eventId, project_id: projectId, document_id: documentId,
      stream_id: streamId, sequence, event_json: null, suggestion_event_id: suggestionEventId,
      occurred_at: factRow.occurred_at, causation_id: factRow.command_id });
  }

  pending(): PendingEvent[] {
    const rows = this.db.prepare(
      `SELECT event_id, project_id, document_id, stream_id, sequence, event_json,
       suggestion_event_id, occurred_at, causation_id
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
    if (!this.streamOwnership(streamId)) {
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
      `SELECT event_id, project_id, document_id, stream_id, sequence, event_json,
       suggestion_event_id, occurred_at, causation_id
       FROM event_outbox WHERE stream_id = ? AND sequence > ?
       ORDER BY sequence LIMIT ?`,
    ).all(streamId, afterSequence, limit) as PersistedEventRow[];
    const events = this.parseContiguous(rows);
    return { streamId, events, headSequence,
      hasMore: (events.at(-1)?.sequence ?? afterSequence) < headSequence,
      historyAvailable: true };
  }

  acknowledge(consumerId: string, streamId: string, sequence: number) {
    const ownership = this.streamOwnership(streamId);
    if (!ownership) throw new Error("UNKNOWN_EVENT_STREAM");
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
      (consumer_id, project_id, document_id, stream_id, acknowledged_sequence, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (consumer_id, stream_id) DO UPDATE SET
        acknowledged_sequence = MAX(acknowledged_sequence, excluded.acknowledged_sequence),
        updated_at = CASE WHEN excluded.acknowledged_sequence > acknowledged_sequence
          THEN excluded.updated_at ELSE updated_at END`
    ).run(consumerId, ownership.projectId, ownership.documentId, streamId, acknowledgedSequence, Date.now());
    const row = this.db.prepare(`SELECT acknowledged_sequence FROM event_consumer_cursor
      WHERE consumer_id = ? AND stream_id = ?`).get(consumerId, streamId) as { acknowledged_sequence: number };
    return row.acknowledged_sequence;
  }

  private streamOwnership(streamId: string) {
    const row = this.db.prepare(`SELECT project_id, id AS document_id FROM documents
      WHERE 'document:' || id = ?`).get(streamId) as
      { project_id: string; document_id: string } | undefined;
    return row && { projectId: row.project_id, documentId: row.document_id };
  }

  private parseContiguous(rows: PersistedEventRow[]) {
    const events: DurableEventEnvelope[] = [];
    for (const row of rows) {
      try {
        events.push(this.parseRow(row));
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
          quarantine(this.db, compatibilityError, row.event_json ?? "");
          break;
        }
        throw error;
      }
    }
    return events;
  }

  private parseRow(row: PersistedEventRow) {
    if (!row.suggestion_event_id) {
      if (row.event_json === null) throw new Error("INVALID_DURABLE_DELIVERY_REFERENCE");
      return parseEnvelope(this.db, row);
    }
    const repository = new SuggestionRepository(this.db);
    let projection = { state: createEmptySuggestionState(), revision: 0, coveredThroughSequence: 0 };
    let delivered: SequencedSuggestionFact | undefined;
    for (const event of repository.history(row.project_id, row.document_id)) {
      projection = applySuggestionFact(projection, event);
      if (event.eventId === row.suggestion_event_id) {
        delivered = event;
        break;
      }
    }
    if (!delivered) throw new Error("SUGGESTION_DELIVERY_HISTORY_MISSING");
    const payload = parseOrContractError(DurableEventPayloadSchema, {
      type: "suggestion.event",
      event: legacySuggestionEvent(delivered.fact),
      commandId: delivered.commandId,
      suggestionRevision: projection.revision,
      state: projection.state,
    }, "persisted.suggestion-delivery.payload");
    return parseOrContractError(DurableEventEnvelopeSchema, {
      eventId: row.event_id, streamId: row.stream_id, sequence: row.sequence,
      occurredAt: row.occurred_at, causationId: row.causation_id ?? undefined, payload,
    }, "persisted.suggestion-delivery");
  }
}

type PersistedEventRow = {
  event_id: string; project_id: string; document_id: string; stream_id: string; sequence: number;
  event_json: string | null; suggestion_event_id: string | null;
  occurred_at: number; causation_id: string | null;
};

function legacySuggestionEvent(fact: SuggestionFact) {
  switch (fact.type) {
    case "suggestion.published": return { type: "suggestion.added" as const, item: fact.item };
    case "suggestion.updated": return { type: "suggestion.updated" as const, item: fact.item };
    case "suggestion.retracted": return { type: "suggestion.retracted" as const, id: fact.suggestionId };
    case "suggestion.projectionImported": return {
      type: "suggestion.state.changed" as const, suggestionId: "projection-import",
      commandType: fact.type,
    };
    default: return { type: "suggestion.state.changed" as const,
      suggestionId: fact.suggestionId, commandType: fact.type };
  }
}

function parseEnvelope(db: DatabaseSync, row: PersistedEventRow): DurableEventEnvelope {
  if (row.event_json === null) throw new Error("DURABLE_EVENT_PAYLOAD_MISSING");
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
