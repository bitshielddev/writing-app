export const DATABASE_VERSION = 6;

// Alpha databases are disposable. Only the current schema is supported; an
// incompatible files must be removed and recreated instead of migrated in place.
export const MINIMUM_SUPPORTED_DATABASE_VERSION = DATABASE_VERSION;

export const CURRENT_SCHEMA_SQL = `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    blocks_json TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (project_id, id)
  ) STRICT;

  CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    title TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id, document_id) REFERENCES documents(project_id, id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE suggestion_projection (
    project_id TEXT NOT NULL,
    document_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    covered_through_sequence INTEGER NOT NULL DEFAULT 0,
    projection_version INTEGER NOT NULL DEFAULT 1,
    checksum TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id, document_id) REFERENCES documents(project_id, id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE suggestion_command_receipts (
    command_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    result_json TEXT NOT NULL,
    actor_json TEXT NOT NULL,
    command_type TEXT NOT NULL,
    command_version INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    outcome TEXT NOT NULL,
    first_sequence INTEGER,
    resulting_sequence INTEGER NOT NULL,
    error_code TEXT,
    requested_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (project_id, document_id) REFERENCES documents(project_id, id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE suggestion_event_history (
    event_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    command_id TEXT NOT NULL,
    actor_json TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_version INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    UNIQUE (document_id, sequence),
    FOREIGN KEY (project_id, document_id) REFERENCES documents(project_id, id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX suggestion_event_history_document_sequence
    ON suggestion_event_history (document_id, sequence);

  CREATE TABLE suggestion_projection_checkpoint (
    checkpoint_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    projection_version INTEGER NOT NULL,
    projection_revision INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    checksum TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (document_id, sequence),
    FOREIGN KEY (project_id, document_id) REFERENCES documents(project_id, id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE event_outbox (
    event_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_json TEXT,
    suggestion_event_id TEXT REFERENCES suggestion_event_history(event_id) ON DELETE CASCADE,
    occurred_at INTEGER NOT NULL,
    causation_id TEXT,
    created_at INTEGER NOT NULL,
    dispatched_at INTEGER,
    CHECK (event_json IS NOT NULL OR suggestion_event_id IS NOT NULL),
    UNIQUE (stream_id, sequence),
    FOREIGN KEY (project_id, document_id) REFERENCES documents(project_id, id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX event_outbox_stream_sequence
    ON event_outbox (stream_id, sequence);

  CREATE TABLE event_consumer_cursor (
    consumer_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    acknowledged_sequence INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (consumer_id, stream_id),
    FOREIGN KEY (project_id, document_id) REFERENCES documents(project_id, id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE workspace_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    selected_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    selected_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE durable_json_quarantine (
    id INTEGER PRIMARY KEY,
    format_name TEXT NOT NULL,
    record_identity TEXT NOT NULL,
    source_text TEXT NOT NULL,
    detected_version INTEGER,
    error_code TEXT NOT NULL,
    quarantined_at INTEGER NOT NULL,
    UNIQUE (format_name, record_identity)
  ) STRICT;
`;
