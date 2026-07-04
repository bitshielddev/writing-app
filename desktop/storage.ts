import { constants } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join, parse } from "node:path";
import { tmpdir } from "node:os";

import type {
  DesktopEvent,
  DocumentSnapshot,
  ObservationSeed,
  SourceSnapshot,
  WorkspaceSnapshot,
} from "../src/shared/desktop.js";
import {
  createEmptySuggestionState,
  trimSuggestionEntries,
  type PersistedSuggestionState,
} from "../src/suggestions/state.js";
import type { SuggestionEvent, SuggestionItem } from "../src/suggestions/types.js";
import { isSuggestionItem } from "../src/suggestions/validation.js";
import { createStorageTransport } from "./storage-transport.js";
import { DatabaseStartupError, openApplicationDatabase } from "./database.js";

const PROJECT_ID = "default-project";
const DOCUMENT_ID = "default-document";
const DOCUMENT_SCHEMA_VERSION = 1;
const dbPath = process.parentPort ? process.argv[2] : ":memory:";
const workspaceRoot = process.parentPort
  ? process.argv[3]
  : join(tmpdir(), `scribe-storage-test-${process.pid}`);

if (!dbPath || !workspaceRoot) {
  throw new Error("Storage process requires database and project workspace paths");
}

const sourcesDirectory = join(workspaceRoot, "sources");
const piDirectory = join(workspaceRoot, ".pi");
const draftPath = join(workspaceRoot, "draft.md");
let db: DatabaseSync;
try {
  db = openApplicationDatabase(dbPath);
} catch (error) {
  const startupError = error instanceof DatabaseStartupError
    ? error
    : new DatabaseStartupError(
        "DATABASE_CORRUPT",
        dbPath,
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
  process.parentPort?.postMessage({
    kind: "startup.error",
    error: {
      code: startupError.code,
      message: startupError.message,
      databasePath: startupError.databasePath,
    },
  });
  throw startupError;
}

function bootstrap() {
  const now = Date.now();
  db.prepare(
    "INSERT OR IGNORE INTO projects (id, name, revision, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
  ).run(PROJECT_ID, "AI-assisted drafts", now, now);
  db.prepare(
    `INSERT OR IGNORE INTO documents
      (id, project_id, title, blocks_json, markdown, schema_version, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    DOCUMENT_ID,
    PROJECT_ID,
    "Untitled Draft",
    JSON.stringify([{ type: "heading", props: { level: 1 }, content: "New Page" }]),
    "# New Page\n",
    DOCUMENT_SCHEMA_VERSION,
    now,
    now,
  );
  db.prepare(
    "INSERT OR IGNORE INTO suggestion_state (project_id, state_json, updated_at) VALUES (?, ?, ?)",
  ).run(PROJECT_ID, JSON.stringify(createEmptySuggestionState()), now);
}

bootstrap();

function json<T>(value: string): T {
  return JSON.parse(value) as T;
}

function getProject() {
  return db.prepare(
    "SELECT id, name, revision FROM projects WHERE id = ?",
  ).get(PROJECT_ID) as { id: string; name: string; revision: number };
}

function getDocument(): DocumentSnapshot {
  const row = db.prepare(
    `SELECT id, project_id, title, blocks_json, markdown, schema_version, revision, updated_at
     FROM documents WHERE id = ?`,
  ).get(DOCUMENT_ID) as {
    id: string;
    project_id: string;
    title: string;
    blocks_json: string;
    markdown: string;
    schema_version: number;
    revision: number;
    updated_at: number;
  };
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    blocks: json<unknown[]>(row.blocks_json),
    markdown: row.markdown,
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
    `SELECT id, project_id, title, storage_path, bytes, updated_at
     FROM sources WHERE project_id = ? ORDER BY updated_at DESC`,
  ).all(PROJECT_ID) as Array<{
    id: string;
    project_id: string;
    title: string;
    storage_path: string;
    bytes: number;
    updated_at: number;
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
  ).all() as Array<{ sequence: number; event_json: string }>;
  const mark = db.prepare(
    "UPDATE event_outbox SET dispatched_at = ? WHERE sequence = ?",
  );
  for (const row of rows) {
    const event = json<DesktopEvent>(row.event_json);
    process.parentPort?.postMessage({ kind: "domain.event", event });
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

async function atomicWrite(path: string, content: string) {
  const temporary = join(workspaceRoot, `.draft-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function repairDraftMirror() {
  await mkdir(sourcesDirectory, { recursive: true });
  await mkdir(piDirectory, { recursive: true });
  const markdown = getDocument().markdown;
  let current: string | undefined;
  try {
    current = await readFile(draftPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (current !== markdown) await atomicWrite(draftPath, markdown);
  return { workspaceRoot, draftPath, sourcesDirectory, repaired: current !== markdown };
}

function hydrate(): WorkspaceSnapshot {
  return {
    project: getProject(),
    document: getDocument(),
    sources: listSources(),
    suggestions: getSuggestionState(),
    agent: { status: "offline", cycleCount: 0 },
    activity: [],
  };
}

function validateMarkdownSource(path: string, bytes: Uint8Array) {
  const extension = extname(path).toLocaleLowerCase();
  if (extension !== ".md" && extension !== ".markdown") {
    throw new Error("Only .md and .markdown source files are supported");
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Markdown source must contain valid UTF-8");
  }
}

async function copyWithReadableCollisionName(sourcePath: string) {
  const original = basename(sourcePath);
  const parsed = parse(original);
  for (let index = 1; ; index += 1) {
    const filename = index === 1
      ? original
      : `${parsed.name} (${index})${parsed.ext}`;
    const destination = join(sourcesDirectory, filename);
    try {
      await copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
      return { filename, destination };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

async function importSource(params: unknown): Promise<SourceSnapshot> {
  const sourcePath = (params as { path?: unknown }).path;
  if (typeof sourcePath !== "string") throw new Error("Invalid source import request");
  const bytes = await readFile(sourcePath);
  validateMarkdownSource(sourcePath, bytes);
  await mkdir(sourcesDirectory, { recursive: true });
  const copied = await copyWithReadableCollisionName(sourcePath);
  const id = randomUUID();
  try {
    return transaction(() => {
      const now = Date.now();
      db.prepare(
        `INSERT INTO sources
          (id, project_id, title, storage_path, bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, PROJECT_ID, copied.filename, copied.destination, bytes.byteLength, now, now);
      db.prepare(
        "UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?",
      ).run(now, PROJECT_ID);
      const source = listSources().find((candidate) => candidate.id === id);
      if (!source) throw new Error("Imported source was not persisted");
      queueEvent({
        type: "source.imported",
        source,
        projectRevision: getProject().revision,
      });
      return source;
    });
  } catch (error) {
    await rm(copied.destination, { force: true });
    throw error;
  }
}

async function saveDocument(params: unknown): Promise<DocumentSnapshot> {
  const input = params as {
    documentId?: unknown;
    blocks?: unknown;
    markdown?: unknown;
    expectedRevision?: unknown;
  };
  if (
    input.documentId !== DOCUMENT_ID ||
    !Array.isArray(input.blocks) ||
    typeof input.markdown !== "string" ||
    !Number.isInteger(input.expectedRevision)
  ) {
    throw new Error("Invalid document save request");
  }
  const current = getDocument();
  if (input.expectedRevision !== current.revision) {
    throw new Error("DOCUMENT_REVISION_CONFLICT");
  }
  const blocksJson = JSON.stringify(input.blocks);
  if (blocksJson === JSON.stringify(current.blocks) && input.markdown === current.markdown) {
    return current;
  }

  const markdown = input.markdown;
  await atomicWrite(draftPath, markdown);
  return transaction(() => {
    const now = Date.now();
    db.prepare(
      `UPDATE documents
       SET blocks_json = ?, markdown = ?, revision = revision + 1, updated_at = ?
       WHERE id = ?`,
    ).run(blocksJson, markdown, now, DOCUMENT_ID);
    db.prepare(
      "UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?",
    ).run(now, PROJECT_ID);
    const document = getDocument();
    queueEvent({
      type: "document.saved",
      document,
      projectRevision: getProject().revision,
    });
    return document;
  });
}

function saveSuggestionState(params: unknown) {
  const state = params as PersistedSuggestionState;
  if (!Array.isArray(state.entries) || !Array.isArray(state.pinnedEntries)) {
    throw new Error("Invalid suggestion projection");
  }
  putSuggestionState({
    ...state,
    entries: trimSuggestionEntries(state.entries),
  });
}

function getObservationSeed(): ObservationSeed {
  const project = getProject();
  const document = getDocument();
  return {
    projectId: project.id,
    projectName: project.name,
    projectRevision: project.revision,
    documentId: document.id,
    documentTitle: document.title,
    documentRevision: document.revision,
  };
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
  queueEvent({ type: "suggestion.event", event });
}

function assertCurrentRevision(expectedDocumentRevision: number) {
  if (expectedDocumentRevision !== getDocument().revision) {
    throw new Error("STALE_SUGGESTION_REVISION");
  }
}

function createSuggestion(params: unknown) {
  const input = params as { item: SuggestionItem; expectedDocumentRevision: number };
  if (!isSuggestionItem(input.item)) throw new Error("Invalid suggestion");
  assertCurrentRevision(input.expectedDocumentRevision);
  return transaction(() => {
    const state = getSuggestionState();
    if (state.seenKeys[input.item.dedupeKey]) return { accepted: false };
    state.seenKeys[input.item.dedupeKey] = true;
    state.entries.push({ item: input.item, viewed: false, stale: false, withdrawn: false });
    state.entries = trimSuggestionEntries(state.entries);
    putSuggestionState(state);
    emitSuggestion({ type: "suggestion.added", item: input.item });
    return { accepted: true };
  });
}

function createDevelopmentSuggestion(params: unknown) {
  const item = (params as { item?: unknown }).item;
  if (!isSuggestionItem(item)) throw new Error("Invalid development suggestion");
  return createSuggestion({ item, expectedDocumentRevision: getDocument().revision });
}

function updateSuggestion(params: unknown) {
  const input = params as { item: SuggestionItem; expectedDocumentRevision: number };
  if (!isSuggestionItem(input.item)) throw new Error("Invalid suggestion");
  assertCurrentRevision(input.expectedDocumentRevision);
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
  assertCurrentRevision(input.expectedDocumentRevision);
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

export async function handleStorageRequest(method: string, params?: unknown) {
  switch (method) {
    case "hydrate": return hydrate();
    case "workspace.repair": return repairDraftMirror();
    case "document.save": return saveDocument(params);
    case "suggestions.save": return saveSuggestionState(params);
    case "source.import": return importSource(params);
    case "agent.seed": return getObservationSeed();
    case "agent.suggestions.list": return listSuggestions();
    case "agent.suggestion.create": return createSuggestion(params);
    case "agent.suggestion.update": return updateSuggestion(params);
    case "agent.suggestion.retract": return retractSuggestion(params);
    case "development.suggestion.create": return createDevelopmentSuggestion(params);
    default: throw new Error(`Unknown storage method: ${method}`);
  }
}

await repairDraftMirror();

const handleTransportMessage = createStorageTransport(
  handleStorageRequest,
  (message) => process.parentPort?.postMessage(message),
);

process.parentPort?.on("message", ({ data }: { data: unknown }) => {
  void handleTransportMessage(data);
});

process.parentPort?.postMessage({ kind: "ready" });
flushOutbox();

export function getWorkspacePathsForTest() {
  return { workspaceRoot, draftPath, sourcesDirectory, piDirectory };
}

export async function closeStorageForTest() {
  db.close();
  if (!process.parentPort) await rm(workspaceRoot, { recursive: true, force: true });
}
