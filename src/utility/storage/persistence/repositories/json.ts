import type { DatabaseSync } from "node:sqlite";
import type { Static, TSchema } from "typebox";

import {
  COMPATIBILITY_REGISTRY,
  DurableCompatibilityError,
  decodeVersionedJson,
  type JsonMigration,
} from "../../../../contracts/compatibility.js";
import { PersistedSuggestionStateSchema } from "../../../../contracts/events.js";
import { parseOrContractError } from "../../../../contracts/validation.js";
import type { PersistedSuggestionState } from "../../../../domain/suggestions/state.js";

export const LEGACY_TO_CURRENT: readonly JsonMigration[] = [{
  fromVersion: 0,
  toVersion: 1,
  migrate: (value) => value,
}];

export function quarantine(db: DatabaseSync, error: DurableCompatibilityError, sourceText: string) {
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

export function decode(db: DatabaseSync, options: Parameters<typeof decodeVersionedJson>[0]) {
  try {
    return decodeVersionedJson(options);
  } catch (error) {
    if (error instanceof DurableCompatibilityError) quarantine(db, error, options.text);
    throw error;
  }
}

export function validatePersisted<Schema extends TSchema>(options: {
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

export function suggestionProjectionPolicy() {
  return COMPATIBILITY_REGISTRY.suggestionProjection;
}
