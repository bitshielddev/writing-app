import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";

import mammoth from "mammoth";

import type {
  DesktopEvent,
  DocumentSnapshot,
  ObservationSeed,
  PersistedSuggestionState,
  ProjectContentItem,
  ProviderSettings,
  SourceSnapshot,
  WorkspaceSnapshot,
} from "../src/shared/desktop.js";
import type { SuggestionEvent, SuggestionItem } from "../src/suggestions/types.js";

type RpcRequest = { kind: "rpc"; id: string; method: string; params?: unknown };
type RpcResult =
  | { kind: "rpc.result"; id: string; result: unknown }
  | { kind: "rpc.result"; id: string; error: string };

const PROJECT_ID = "default-project";
const DOCUMENT_ID = "default-document";
const DOCUMENT_SCHEMA_VERSION = 1;
const dbPath = process.parentPort ? process.argv[2] : ":memory:";

if (!dbPath) {
  throw new Error("Storage process requires a database path");
}

const db = new DatabaseSync(dbPath, {
  enableForeignKeyConstraints: true,
  timeout: 5_000,
});

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = FULL");
db.exec(`
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    blocks_json TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    storage_path TEXT NOT NULL DEFAULT '',
    extracted_text TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS suggestion_state (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS provider_settings (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    base_url TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS agent_memory (
    document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    document_revision INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    project_revision INTEGER NOT NULL,
    document_revision INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    error TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS agent_transcript (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS event_outbox (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    dispatched_at INTEGER
  ) STRICT;
`);

const emptySuggestionState = (): PersistedSuggestionState => ({
  entries: [],
  pinnedEntries: [],
  workspacePins: [],
  seenKeys: {},
  nextZIndex: 1,
});

function bootstrap() {
  const now = Date.now();
  db.prepare(
    "INSERT OR IGNORE INTO projects (id, name, revision, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
  ).run(PROJECT_ID, "AI-assisted drafts", now, now);
  db.prepare(
    `INSERT OR IGNORE INTO documents
      (id, project_id, title, blocks_json, schema_version, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    DOCUMENT_ID,
    PROJECT_ID,
    "Untitled Draft",
    JSON.stringify([
      { type: "heading", props: { level: 1 }, content: "New Page" },
    ]),
    DOCUMENT_SCHEMA_VERSION,
    now,
    now,
  );
  db.prepare(
    "INSERT OR IGNORE INTO suggestion_state (project_id, state_json, updated_at) VALUES (?, ?, ?)",
  ).run(PROJECT_ID, JSON.stringify(emptySuggestionState()), now);
  db.prepare(
    `INSERT OR IGNORE INTO provider_settings
      (id, provider, model, base_url, enabled, updated_at)
      VALUES ('global', 'anthropic', 'claude-sonnet-4-6', '', 0, ?)`,
  ).run(now);
  db.prepare(
    "INSERT OR IGNORE INTO app_meta (key, value) VALUES ('agent_paused', '0')",
  ).run();
}

bootstrap();

function json<T>(value: string): T {
  return JSON.parse(value) as T;
}

function scalar(key: string, fallback = "0") {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

function setScalar(key: string, value: string) {
  db.prepare(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

function getProvider(): ProviderSettings {
  const row = db.prepare(
    "SELECT provider, model, base_url, enabled FROM provider_settings WHERE id = 'global'",
  ).get() as {
    provider: string;
    model: string;
    base_url: string;
    enabled: number;
  };
  return {
    provider: row.provider,
    model: row.model,
    baseUrl: row.base_url,
    enabled: Boolean(row.enabled),
  };
}

function getDocument(): DocumentSnapshot {
  const row = db.prepare(
    `SELECT id, project_id, title, blocks_json, schema_version, revision, updated_at
     FROM documents WHERE id = ?`,
  ).get(DOCUMENT_ID) as {
    id: string;
    project_id: string;
    title: string;
    blocks_json: string;
    schema_version: number;
    revision: number;
    updated_at: number;
  };
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    blocks: json<unknown[]>(row.blocks_json),
    schemaVersion: row.schema_version,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

function getSuggestionState(): PersistedSuggestionState {
  const row = db.prepare(
    "SELECT state_json FROM suggestion_state WHERE project_id = ?",
  ).get(PROJECT_ID) as { state_json: string };
  return json<PersistedSuggestionState>(row.state_json);
}

function listSources(): SourceSnapshot[] {
  const rows = db.prepare(
    `SELECT id, project_id, title, storage_path, length(extracted_text) AS extracted_characters, updated_at
     FROM sources WHERE project_id = ? ORDER BY updated_at DESC`,
  ).all(PROJECT_ID) as {
    id: string;
    project_id: string;
    title: string;
    storage_path: string;
    extracted_characters: number;
    updated_at: number;
  }[];
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    storagePath: row.storage_path,
    extractedCharacters: row.extracted_characters,
    updatedAt: row.updated_at,
  }));
}

function putSuggestionState(state: PersistedSuggestionState) {
  db.prepare(
    "UPDATE suggestion_state SET state_json = ?, updated_at = ? WHERE project_id = ?",
  ).run(JSON.stringify(state), Date.now(), PROJECT_ID);
}

function queueEvent(event: DesktopEvent) {
  db.prepare(
    "INSERT INTO event_outbox (event_json, created_at) VALUES (?, ?)",
  ).run(JSON.stringify(event), Date.now());
}

function flushOutbox() {
  const rows = db.prepare(
    "SELECT sequence, event_json FROM event_outbox WHERE dispatched_at IS NULL ORDER BY sequence",
  ).all() as { sequence: number; event_json: string }[];
  const mark = db.prepare(
    "UPDATE event_outbox SET dispatched_at = ? WHERE sequence = ?",
  );
  for (const row of rows) {
    const event = json<DesktopEvent>(row.event_json);
    const payload =
      event.type === "suggestion.event"
        ? { ...event, sequence: row.sequence }
        : event;
    process.parentPort?.postMessage({ kind: "domain.event", event: payload });
    mark.run(Date.now(), row.sequence);
  }
}

function transaction<T>(work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    flushOutbox();
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function hydrate(): WorkspaceSnapshot {
  const project = db.prepare(
    "SELECT id, name, revision FROM projects WHERE id = ?",
  ).get(PROJECT_ID) as { id: string; name: string; revision: number };
  const sequenceRow = db.prepare(
    "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM event_outbox",
  ).get() as { sequence: number };
  return {
    project,
    document: getDocument(),
    sources: listSources(),
    suggestions: getSuggestionState(),
    provider: getProvider(),
    agent: {
      paused: scalar("agent_paused") === "1",
      running: false,
      configured: getProvider().enabled,
    },
    sequence: sequenceRow.sequence,
  };
}

async function extractSourceText(path: string) {
  const extension = extname(path).toLocaleLowerCase();
  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path });
    return result.value;
  }
  if (extension === ".pdf") {
    // PDF.js deliberately skips its Node canvas polyfills in Electron utility
    // processes, where process.type is "utility" rather than "browser".
    const canvas = await import("@napi-rs/canvas");
    for (const name of ["DOMMatrix", "ImageData", "Path2D"] as const) {
      if (!(name in globalThis)) {
        Object.defineProperty(globalThis, name, {
          configurable: true,
          value: canvas[name],
          writable: true,
        });
      }
    }
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(await readFile(path)) });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  return readFile(path, "utf8");
}

async function importSource(params: unknown): Promise<SourceSnapshot> {
  const sourcePath = (params as { path: string }).path;
  const id = randomUUID();
  const extension = extname(sourcePath).toLocaleLowerCase();
  const sourceDirectory =
    dbPath === ":memory:"
      ? join(tmpdir(), "scribe-storage-test-sources")
      : join(dirname(dbPath), "sources");
  await mkdir(sourceDirectory, { recursive: true });
  const storagePath = join(sourceDirectory, `${id}${extension}`);
  const extractedText = (await extractSourceText(sourcePath)).slice(0, 2_000_000);
  await copyFile(sourcePath, storagePath);
  return transaction(() => {
    const now = Date.now();
    db.prepare(
      `INSERT INTO sources
        (id, project_id, title, storage_path, extracted_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      PROJECT_ID,
      basename(sourcePath),
      storagePath,
      extractedText,
      now,
      now,
    );
    db.prepare(
      "UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?",
    ).run(now, PROJECT_ID);
    const source = listSources().find((candidate) => candidate.id === id);
    if (!source) throw new Error("Imported source was not persisted");
    queueEvent({ type: "source.imported", source });
    return source;
  });
}

function saveDocument(params: unknown): DocumentSnapshot {
  const input = params as {
    documentId: string;
    blocks: unknown[];
    expectedRevision: number;
  };
  if (input.documentId !== DOCUMENT_ID || !Array.isArray(input.blocks)) {
    throw new Error("Invalid document save request");
  }
  const current = getDocument();
  const blocksJson = JSON.stringify(input.blocks);
  if (blocksJson === JSON.stringify(current.blocks)) {
    return current;
  }
  return transaction(() => {
    const now = Date.now();
    db.prepare(
      `UPDATE documents
       SET blocks_json = ?, revision = revision + 1, updated_at = ?
       WHERE id = ?`,
    ).run(blocksJson, now, DOCUMENT_ID);
    db.prepare(
      "UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?",
    ).run(now, PROJECT_ID);
    const document = getDocument();
    queueEvent({ type: "document.saved", document });
    return document;
  });
}

function saveSuggestionState(params: unknown) {
  const state = params as PersistedSuggestionState;
  if (!Array.isArray(state.entries) || !Array.isArray(state.pinnedEntries)) {
    throw new Error("Invalid suggestion projection");
  }
  putSuggestionState(state);
}

function setProvider(params: unknown) {
  const input = params as ProviderSettings;
  db.prepare(
    `UPDATE provider_settings
     SET provider = ?, model = ?, base_url = ?, enabled = ?, updated_at = ?
     WHERE id = 'global'`,
  ).run(
    input.provider.trim(),
    input.model.trim(),
    input.baseUrl.trim(),
    input.enabled ? 1 : 0,
    Date.now(),
  );
  return getProvider();
}

function setPaused(params: unknown) {
  const paused = Boolean((params as { paused: boolean }).paused);
  setScalar("agent_paused", paused ? "1" : "0");
  return paused;
}

function getObservationSeed(): ObservationSeed {
  const project = db.prepare(
    "SELECT id, name, revision FROM projects WHERE id = ?",
  ).get(PROJECT_ID) as { id: string; name: string; revision: number };
  const document = getDocument();
  const memory = db.prepare(
    "SELECT summary FROM agent_memory WHERE document_id = ?",
  ).get(DOCUMENT_ID) as { summary: string } | undefined;
  return {
    projectId: project.id,
    projectName: project.name,
    projectRevision: project.revision,
    documentId: document.id,
    documentTitle: document.title,
    documentRevision: document.revision,
    memorySummary: memory?.summary ?? "",
    provider: getProvider(),
    paused: scalar("agent_paused") === "1",
  };
}

function listProjectContent(): ProjectContentItem[] {
  const documents = db.prepare(
    "SELECT id, title, updated_at FROM documents WHERE project_id = ?",
  ).all(PROJECT_ID) as { id: string; title: string; updated_at: number }[];
  const sources = db.prepare(
    "SELECT id, title, updated_at FROM sources WHERE project_id = ?",
  ).all(PROJECT_ID) as { id: string; title: string; updated_at: number }[];
  return [
    ...documents.map((item) => ({
      id: item.id,
      type: "document" as const,
      title: item.title,
      updatedAt: item.updated_at,
    })),
    ...sources.map((item) => ({
      id: item.id,
      type: "source" as const,
      title: item.title,
      updatedAt: item.updated_at,
    })),
  ];
}

function textFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromValue).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map(textFromValue)
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function readProjectContent(params: unknown) {
  const input = params as { id: string; type: "document" | "source" };
  if (input.type === "document") {
    const row = db.prepare(
      "SELECT title, blocks_json, revision FROM documents WHERE id = ? AND project_id = ?",
    ).get(input.id, PROJECT_ID) as
      | { title: string; blocks_json: string; revision: number }
      | undefined;
    if (!row) throw new Error("Document not found");
    return {
      id: input.id,
      type: input.type,
      title: row.title,
      revision: row.revision,
      text: textFromValue(json<unknown[]>(row.blocks_json)).slice(0, 60_000),
    };
  }
  const row = db.prepare(
    "SELECT title, extracted_text FROM sources WHERE id = ? AND project_id = ?",
  ).get(input.id, PROJECT_ID) as
    | { title: string; extracted_text: string }
    | undefined;
  if (!row) throw new Error("Source not found");
  return {
    id: input.id,
    type: input.type,
    title: row.title,
    text: row.extracted_text.slice(0, 60_000),
  };
}

function searchProjectContent(params: unknown) {
  const query = (params as { query: string }).query.trim().toLocaleLowerCase();
  if (!query) return [];
  return listProjectContent()
    .map((item) => ({ item, content: readProjectContent(item) as { text: string } }))
    .filter(({ item, content }) =>
      `${item.title}\n${content.text}`.toLocaleLowerCase().includes(query),
    )
    .slice(0, 12)
    .map(({ item, content }) => ({ ...item, excerpt: content.text.slice(0, 1_200) }));
}

function listSuggestions() {
  const state = getSuggestionState();
  return {
    live: state.entries.map((entry) => entry.item),
    pinned: state.pinnedEntries.map((entry) => entry.item),
    workspace: state.workspacePins.map((entry) => entry.item),
  };
}

function emitSuggestion(event: SuggestionEvent) {
  queueEvent({ type: "suggestion.event", sequence: 0, event });
}

function enforceSuggestionLimit(state: PersistedSuggestionState) {
  if (state.entries.length <= 30) return;
  state.entries = [...state.entries]
    .sort((a, b) => a.item.createdAt - b.item.createdAt)
    .slice(-30);
}

function createSuggestion(params: unknown) {
  const input = params as { item: SuggestionItem; expectedDocumentRevision: number };
  const document = getDocument();
  if (input.expectedDocumentRevision !== document.revision) {
    throw new Error("The target document changed; start a new observation");
  }
  return transaction(() => {
    const state = getSuggestionState();
    if (state.seenKeys[input.item.dedupeKey]) return { accepted: false };
    state.seenKeys[input.item.dedupeKey] = true;
    state.entries.push({
      item: input.item,
      viewed: false,
      stale: false,
      withdrawn: false,
    });
    enforceSuggestionLimit(state);
    putSuggestionState(state);
    emitSuggestion({ type: "suggestion.added", item: input.item });
    return { accepted: true };
  });
}

function updateSuggestion(params: unknown) {
  const input = params as { item: SuggestionItem; expectedDocumentRevision: number };
  if (getDocument().revision !== input.expectedDocumentRevision) {
    throw new Error("The target document changed; start a new observation");
  }
  return transaction(() => {
    const state = getSuggestionState();
    const entry = state.entries.find((candidate) => candidate.item.id === input.item.id);
    if (!entry) return { accepted: false };
    entry.item = input.item;
    putSuggestionState(state);
    emitSuggestion({ type: "suggestion.updated", item: input.item });
    return { accepted: true };
  });
}

function retractSuggestion(params: unknown) {
  const input = params as { id: string; expectedDocumentRevision: number };
  if (getDocument().revision !== input.expectedDocumentRevision) {
    throw new Error("The target document changed; start a new observation");
  }
  return transaction(() => {
    const state = getSuggestionState();
    const exists = state.entries.some((entry) => entry.item.id === input.id);
    if (!exists) return { accepted: false };
    state.entries = state.entries.filter((entry) => entry.item.id !== input.id);
    putSuggestionState(state);
    emitSuggestion({ type: "suggestion.retracted", id: input.id });
    return { accepted: true };
  });
}

function startRun(params: unknown) {
  const input = params as {
    id: string;
    seed: ObservationSeed;
    provider: string;
    model: string;
  };
  db.prepare(
    `INSERT INTO agent_runs
      (id, project_id, document_id, project_revision, document_revision,
       provider, model, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'working', ?)`,
  ).run(
    input.id,
    input.seed.projectId,
    input.seed.documentId,
    input.seed.projectRevision,
    input.seed.documentRevision,
    input.provider,
    input.model,
    Date.now(),
  );
}

function appendTranscript(params: unknown) {
  const input = params as { runId: string; eventType: string; payload: unknown };
  db.prepare(
    `INSERT INTO agent_transcript (run_id, event_type, payload_json, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(input.runId, input.eventType, JSON.stringify(input.payload), Date.now());
}

function finishRun(params: unknown) {
  const input = params as { runId: string; status: string; error?: string };
  db.prepare(
    "UPDATE agent_runs SET status = ?, completed_at = ?, error = ? WHERE id = ?",
  ).run(input.status, Date.now(), input.error ?? null, input.runId);
}

function saveMemory(params: unknown) {
  const input = params as {
    documentId: string;
    documentRevision: number;
    summary: string;
  };
  if (input.documentId !== DOCUMENT_ID || getDocument().revision !== input.documentRevision) {
    throw new Error("Cannot save memory for an outdated document revision");
  }
  db.prepare(
    `INSERT INTO agent_memory (document_id, summary, document_revision, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(document_id) DO UPDATE SET
       summary = excluded.summary,
       document_revision = excluded.document_revision,
       updated_at = excluded.updated_at`,
  ).run(input.documentId, input.summary.slice(0, 8_000), input.documentRevision, Date.now());
}

export async function handleStorageRequest(method: string, params?: unknown) {
  switch (method) {
    case "hydrate": return hydrate();
    case "document.save": return saveDocument(params);
    case "suggestions.save": return saveSuggestionState(params);
    case "source.import": return importSource(params);
    case "provider.set": return setProvider(params);
    case "agent.pause": return setPaused(params);
    case "agent.seed": return getObservationSeed();
    case "agent.content.list": return listProjectContent();
    case "agent.content.read": return readProjectContent(params);
    case "agent.content.search": return searchProjectContent(params);
    case "agent.suggestions.list": return listSuggestions();
    case "agent.suggestion.create": return createSuggestion(params);
    case "agent.suggestion.update": return updateSuggestion(params);
    case "agent.suggestion.retract": return retractSuggestion(params);
    case "agent.run.start": return startRun(params);
    case "agent.run.transcript": return appendTranscript(params);
    case "agent.run.finish": return finishRun(params);
    case "agent.memory.save": return saveMemory(params);
    default: throw new Error(`Unknown storage method: ${method}`);
  }
}

process.parentPort?.on("message", async ({ data }: { data: RpcRequest }) => {
  if (data.kind !== "rpc") return;
  let result: RpcResult;
  try {
    result = {
      kind: "rpc.result",
      id: data.id,
      result: await handleStorageRequest(data.method, data.params),
    };
  } catch (error) {
    result = {
      kind: "rpc.result",
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  process.parentPort?.postMessage(result);
});

process.parentPort?.postMessage({ kind: "ready" });
flushOutbox();

export function closeStorageForTest() {
  db.close();
}
