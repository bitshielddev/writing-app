PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

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
  markdown TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE suggestion_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE event_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  dispatched_at INTEGER
) STRICT;

INSERT INTO projects VALUES ('fixture-project', 'Fixture project', 4, 1000, 2000);
INSERT INTO documents VALUES (
  'fixture-document', 'fixture-project', 'Preserved draft',
  '[{"type":"paragraph","content":"Keep me"}]', 'Keep me' || char(10), 1, 3, 1000, 2000
);
INSERT INTO sources VALUES (
  'fixture-source', 'fixture-project', 'notes.md', '/fixture/notes.md', 12, 1000, 2000
);
INSERT INTO suggestion_state VALUES (
  'fixture-project', '{"entries":[],"pinnedEntries":[],"workspacePins":[],"seenKeys":{},"nextZIndex":1}', 2000
);
INSERT INTO event_outbox (event_json, created_at) VALUES ('{"type":"fixture"}', 2000);

PRAGMA user_version = 2;
COMMIT;
