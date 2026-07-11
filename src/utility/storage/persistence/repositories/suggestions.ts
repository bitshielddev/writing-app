import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  COMPATIBILITY_REGISTRY,
  decodeVersionedJson,
  encodeVersionedJson,
} from "../../../../contracts/compatibility.js";
import {
  PersistedSuggestionStateSchema,
  SequencedSuggestionFactSchema,
  SuggestionCommandEnvelopeSchema,
  SuggestionCommandResultSchema,
  SuggestionFactSchema,
} from "../../../../contracts/events.js";
import { parseOrContractError } from "../../../../contracts/validation.js";
import {
  applySuggestionFact,
  SUGGESTION_PROJECTION_VERSION,
  type SequencedSuggestionFact,
  type SuggestionCommandEnvelope,
  type SuggestionFact,
} from "../../../../domain/suggestions/aggregate.js";
import { suggestionContentDedupeKey } from "../../../../domain/suggestions/dedupe.js";
import {
  createEmptySuggestionState,
  type PersistedSuggestionState,
} from "../../../../domain/suggestions/state.js";
import type {
  SuggestionCommandResult,
  SuggestionProjection,
  SuggestionStore,
} from "../../application/ports.js";
import { suggestionProjectionChecksum } from "../projection-checksum.js";
import {
  decode,
  LEGACY_TO_CURRENT,
  validatePersisted,
} from "./json.js";

export class SuggestionRepository implements SuggestionStore {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * What: performs the get step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, hydrate, executeSuggestionCommand and listSuggestions when that path needs this behavior.
   */
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

  /**
   * What: performs the compare and put step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports and fixture when that path needs this behavior.
   */
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

  /**
   * What: performs the append facts step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, executeSuggestionCommand, mutateSuggestion and fixture when that path needs this behavior.
   */
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

  /**
   * What: performs the record command receipt step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, executeSuggestionCommand, mutateSuggestion and fixture when that path needs this behavior.
   */
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

  hasSeenContentDedupeKey(projectId: string, documentId: string, key: string): boolean {
    const rows = this.db.prepare(`SELECT payload_json FROM suggestion_event_history
      WHERE project_id = ? AND document_id = ? AND event_type IN ('suggestion.published', 'suggestion.updated')`)
      .all(projectId, documentId) as Array<{ payload_json: string }>;
    return rows.some((row) => {
      const fact = JSON.parse(row.payload_json) as SuggestionFact;
      return ("item" in fact) && suggestionContentDedupeKey(fact.item) === key;
    });
  }

  /**
   * What: performs the history step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by rebuild and parseRow when that path needs this behavior.
   */
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

  /**
   * What: performs the rebuild step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by verify and repair when that path needs this behavior.
   */
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

  /**
   * What: performs the verify step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports and diagnostics when that path needs this behavior.
   */
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

  /**
   * What: performs the repair step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports when that path needs this behavior.
   */
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

  /**
   * What: creates checkpoint with the dependencies and defaults this workflow expects.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, executeSuggestionCommand, mutateSuggestion and fixture when that path needs this behavior.
   */
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

  /**
   * What: performs the diagnostics step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports when that path needs this behavior.
   */
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

  /**
   * What: performs the find receipt step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, executeSuggestionCommand and fixture when that path needs this behavior.
   */
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

  /**
   * What: performs the record receipt step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports and fixture when that path needs this behavior.
   */
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
