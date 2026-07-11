export const COMPATIBILITY_REGISTRY = {
  database: {
    name: "scribe.sqlite",
    currentVersion: 6,
    minimumReadableVersion: 6,
    minimumMigratableVersion: 6,
    newerVersionBehavior: "reject-read-only",
  },
  documentBlocks: {
    name: "scribe.blocks",
    currentVersion: 1,
    minimumReadableVersion: 0,
    minimumMigratableVersion: 0,
    newerVersionBehavior: "preserve-quarantine-reject",
  },
  suggestionCommands: {
    name: "scribe.suggestion-command-result",
    currentVersion: 1,
    minimumReadableVersion: 0,
    minimumMigratableVersion: 0,
    newerVersionBehavior: "preserve-quarantine-reject",
  },
  suggestionEvents: {
    name: "scribe.event",
    currentVersion: 1,
    minimumReadableVersion: 0,
    minimumMigratableVersion: 0,
    newerVersionBehavior: "preserve-quarantine-stop-projection",
  },
  suggestionProjection: {
    name: "scribe.suggestion-projection",
    currentVersion: 1,
    minimumReadableVersion: 0,
    minimumMigratableVersion: 0,
    newerVersionBehavior: "preserve-quarantine-reject",
  },
  piLoopEntry: {
    name: "scribe.pi.loop-state",
    currentVersion: 1,
    minimumReadableVersion: 0,
    minimumMigratableVersion: 0,
    newerVersionBehavior: "preserve-disable-resume",
  },
  storageProtocol: {
    name: "scribe.storage",
    currentVersion: 1,
    minimumReadableVersion: 1,
    minimumMigratableVersion: 1,
    newerVersionBehavior: "reject-startup",
  },
  agentProtocol: {
    name: "scribe.agent",
    currentVersion: 1,
    minimumReadableVersion: 1,
    minimumMigratableVersion: 1,
    newerVersionBehavior: "reject-startup",
  },
} as const;

export type JsonMigration = {
  fromVersion: number;
  toVersion: number;
  migrate(value: unknown): unknown;
};

/**
 * What: validates json migration registry before callers depend on it.
 *
 * Why: transport, persistence, and renderer boundaries need one shared contract shape.
 * Called when: used by migrateJson and compatibility when that path needs this behavior.
 */
export function validateJsonMigrationRegistry(
  migrations: readonly JsonMigration[],
  minimumVersion: number,
  currentVersion: number,
) {
  const edges = new Map<number, JsonMigration>();
  for (const migration of migrations) {
    if (migration.toVersion !== migration.fromVersion + 1) {
      throw new Error(`JSON migration ${migration.fromVersion}->${migration.toVersion} must advance exactly one version`);
    }
    if (edges.has(migration.fromVersion)) {
      throw new Error(`Duplicate JSON migration from version ${migration.fromVersion}`);
    }
    edges.set(migration.fromVersion, migration);
  }
  for (let version = minimumVersion; version < currentVersion; version += 1) {
    if (!edges.has(version)) {
      throw new Error(`No contiguous JSON migration path from version ${version} to ${currentVersion}`);
    }
  }
  if (edges.size !== currentVersion - minimumVersion) {
    throw new Error(`JSON migration registry must contain only versions ${minimumVersion} through ${currentVersion}`);
  }
}

/**
 * What: migrates json to the current supported format.
 *
 * Why: transport, persistence, and renderer boundaries need one shared contract shape.
 * Called when: used by decodeVersionedJson and compatibility when that path needs this behavior.
 */
export function migrateJson(
  value: unknown,
  fromVersion: number,
  currentVersion: number,
  migrations: readonly JsonMigration[],
) {
  const applicable = migrations.filter((item) => item.fromVersion >= fromVersion);
  validateJsonMigrationRegistry(applicable, fromVersion, currentVersion);
  let migrated = value;
  for (let version = fromVersion; version < currentVersion; version += 1) {
    migrated = applicable.find((item) => item.fromVersion === version)!.migrate(migrated);
  }
  return migrated;
}

export type VersionedEnvelope = { format: string; version: number; payload: unknown };

export class DurableCompatibilityError extends Error {
  constructor(
    readonly code: "DURABLE_JSON_INVALID" | "DURABLE_FORMAT_TOO_NEW" | "DURABLE_FORMAT_UNSUPPORTED",
    readonly format: string,
    readonly recordIdentity: string,
    readonly detectedVersion: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "DurableCompatibilityError";
  }
}

/**
 * What: returns whether the supplied value matches record.
 *
 * Why: transport, persistence, and renderer boundaries need one shared contract shape.
 * Called when: used by inspectEnvelope when that path needs this behavior.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What: parses durable json from untyped data into the typed representation.
 *
 * Why: transport, persistence, and renderer boundaries need one shared contract shape.
 * Called when: used by decodeVersionedJson when that path needs this behavior.
 */
function parseDurableJson(text: string, format: string, recordIdentity: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DurableCompatibilityError(
      "DURABLE_JSON_INVALID", format, recordIdentity, undefined,
      `Invalid persisted ${format} JSON`,
    );
  }
}

/**
 * What: inspects envelope so later validation can make a precise decision.
 *
 * Why: transport, persistence, and renderer boundaries need one shared contract shape.
 * Called when: used by decodeVersionedJson when that path needs this behavior.
 */
function inspectEnvelope(source: unknown, payloadKey: string, legacyVersion: number) {
  const sourceRecord = isRecord(source) ? source : undefined;
  const enveloped = Boolean(
    sourceRecord && "format" in sourceRecord && "version" in sourceRecord && payloadKey in sourceRecord,
  );
  const detectedVersion = enveloped && sourceRecord && Number.isInteger(sourceRecord.version)
    ? sourceRecord.version as number
    : legacyVersion;
  return { sourceRecord, enveloped, detectedVersion };
}

/**
 * What: checks supported envelope and throws before invalid state crosses the boundary.
 *
 * Why: transport, persistence, and renderer boundaries need one shared contract shape.
 * Called when: used by decodeVersionedJson when that path needs this behavior.
 */
function assertSupportedEnvelope(options: {
  enveloped: boolean;
  sourceRecord?: Record<string, unknown>;
  detectedVersion: number;
  format: string;
  recordIdentity: string;
  currentVersion: number;
  minimumReadableVersion: number;
}) {
  if (options.enveloped && options.sourceRecord?.format !== options.format) {
    throw new DurableCompatibilityError(
      "DURABLE_FORMAT_UNSUPPORTED", options.format, options.recordIdentity, options.detectedVersion,
      `Unsupported durable format for ${options.format}`,
    );
  }
  if (options.detectedVersion > options.currentVersion) {
    throw new DurableCompatibilityError(
      "DURABLE_FORMAT_TOO_NEW", options.format, options.recordIdentity, options.detectedVersion,
      `${options.format} version ${options.detectedVersion} requires a newer ScribeAI release. The original data was preserved in the workspace database quarantine.`,
    );
  }
  if (options.detectedVersion < options.minimumReadableVersion) {
    throw new DurableCompatibilityError(
      "DURABLE_FORMAT_UNSUPPORTED", options.format, options.recordIdentity, options.detectedVersion,
      `${options.format} version ${options.detectedVersion} is no longer supported`,
    );
  }
}

/**
 * What: decodes versioned json from persisted or transported data.
 *
 * Why: transport, persistence, and renderer boundaries need one shared contract shape.
 * Called when: used by compatibility, decode, json and suggestions when that path needs this behavior.
 */
export function decodeVersionedJson(options: {
  text: string;
  format: string;
  currentVersion: number;
  minimumReadableVersion: number;
  legacyVersion: number;
  legacyPayload?: (value: unknown) => unknown;
  payloadKey?: string;
  migrations: readonly JsonMigration[];
  recordIdentity: string;
}) {
  const source = parseDurableJson(options.text, options.format, options.recordIdentity);
  const payloadKey = options.payloadKey ?? "payload";
  const { sourceRecord, enveloped, detectedVersion } = inspectEnvelope(
    source, payloadKey, options.legacyVersion,
  );
  assertSupportedEnvelope({ ...options, sourceRecord, enveloped, detectedVersion });
  const payload = enveloped ? sourceRecord![payloadKey] : (options.legacyPayload?.(source) ?? source);
  try {
    return {
      payload: migrateJson(payload, detectedVersion, options.currentVersion, options.migrations),
      detectedVersion,
      migrated: !enveloped || detectedVersion !== options.currentVersion,
    };
  } catch (error) {
    throw new DurableCompatibilityError(
      "DURABLE_JSON_INVALID", options.format, options.recordIdentity, detectedVersion,
      `Could not migrate persisted ${options.format} data: ${error instanceof Error ? error.message : "invalid data"}`,
    );
  }
}

/**
 * What: encodes versioned json for persistence, transport, or external runtime use.
 *
 * Why: transport, persistence, and renderer boundaries need one shared contract shape.
 * Called when: used by bootstrap, bootstrapWorkspace, documents and get when that path needs this behavior.
 */
export function encodeVersionedJson(
  format: string,
  version: number,
  payload: unknown,
  payloadKey = "payload",
) {
  return JSON.stringify({ format, version, [payloadKey]: payload });
}
