import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  DurableEventEnvelope,
  DurableEventPayload,
} from "../../../../contracts/desktop-bridge.js";
import {
  COMPATIBILITY_REGISTRY,
  DurableCompatibilityError,
  encodeVersionedJson,
} from "../../../../contracts/compatibility.js";
import {
  DurableEventEnvelopeSchema,
  DurableEventPayloadSchema,
} from "../../../../contracts/events.js";
import { parseOrContractError } from "../../../../contracts/validation.js";
import {
  clampReplayLimit,
  nextAcknowledgedSequence,
} from "../../../../domain/events/sequence.js";
import {
  applySuggestionFact,
  type SequencedSuggestionFact,
  type SuggestionFact,
} from "../../../../domain/suggestions/aggregate.js";
import { createEmptySuggestionState } from "../../../../domain/suggestions/state.js";
import type { EventOutbox } from "../../application/ports.js";
import {
  decode,
  LEGACY_TO_CURRENT,
  quarantine,
  validatePersisted,
} from "./json.js";
import { SuggestionRepository } from "./suggestions.js";

export type PendingEvent = DurableEventEnvelope;

export class OutboxRepository implements EventOutbox {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * What: performs the enqueue step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, performDocumentSave, importSource and fixture when that path needs this behavior.
   */
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

  /**
   * What: performs the enqueue suggestion fact step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, publishSuggestionFacts and fixture when that path needs this behavior.
   */
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

  /**
   * What: performs the pending step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, fixture, deliverPending and layers when that path needs this behavior.
   */
  pending(): PendingEvent[] {
    const rows = this.db.prepare(
      `SELECT event_id, project_id, document_id, stream_id, sequence, event_json,
       suggestion_event_id, occurred_at, causation_id
       FROM event_outbox WHERE dispatched_at IS NULL ORDER BY stream_id, sequence`,
    ).all() as PersistedEventRow[];
    return this.parseContiguous(rows);
  }

  /**
   * What: performs the mark dispatched step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, fixture and deliverPending when that path needs this behavior.
   */
  markDispatched(eventId: string) {
    this.db.prepare(
      "UPDATE event_outbox SET dispatched_at = ? WHERE event_id = ?",
    ).run(Date.now(), eventId);
  }

  /**
   * What: performs the head step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, hydrate, getObservationSeed and fixture when that path needs this behavior.
   */
  head(streamId: string) {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM event_outbox WHERE stream_id = ?",
    ).get(streamId) as { sequence: number };
    return row.sequence;
  }

  /**
   * What: performs the replay step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, replayEvents, fixture and layers when that path needs this behavior.
   */
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

  /**
   * What: performs the acknowledge step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, acknowledgeEvents and fixture when that path needs this behavior.
   */
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

  /**
   * What: performs the stream ownership step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by replay and acknowledge when that path needs this behavior.
   */
  private streamOwnership(streamId: string) {
    const row = this.db.prepare(`SELECT project_id, id AS document_id FROM documents
      WHERE 'document:' || id = ?`).get(streamId) as
      { project_id: string; document_id: string } | undefined;
    return row && { projectId: row.project_id, documentId: row.document_id };
  }

  /**
   * What: parses contiguous from untyped data into the typed representation.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by pending and replay when that path needs this behavior.
   */
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

  /**
   * What: parses row from untyped data into the typed representation.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by enqueueSuggestionFact and parseContiguous when that path needs this behavior.
   */
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

/**
 * What: performs the legacy suggestion event step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by parseRow when that path needs this behavior.
 */
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

/**
 * What: parses envelope from untyped data into the typed representation.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by parseRow when that path needs this behavior.
 */
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
