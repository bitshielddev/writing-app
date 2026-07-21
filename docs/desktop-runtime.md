# Desktop persistence and Pi runtime

## Process topology

The packaged application has four cooperating runtimes: React owns BlockNote and presentation state; Electron main owns lifecycle, IPC, the launch-scoped activity ring, and project revision delivery; the storage utility process exclusively owns SQLite and the managed workspace; and the agent utility process owns one durable `@earendil-works/pi-coding-agent` session.

The preload exposes the typed `DesktopBridge`. The renderer never imports Electron, SQLite, filesystem, or Pi packages.

## Managed project workspace

Electron resolves `<userData>` with `app.getPath("userData")`; it is outside the repository and under the platform application-data directory. The default project uses:

```text
<userData>/projects/default-project/
  sources/<readable-collision-safe-name>.md
  .pi/sessions/*.jsonl
```

Accepted BlockNote blocks are saved in SQLite at `<userData>/scribe.sqlite3`. Storage publishes a committed document revision only after those blocks are persisted. The agent reads the same durable BlockNote revision through Scribe's read-only `read_document` tool rather than through a generated draft file.

Source import accepts only `.md` and `.markdown`. The renderer asks Electron main to open a native file picker from the sidebar's **Upload Sources** action, then storage validates the complete file as UTF-8 and copies it without extraction or truncation. Existing names receive a readable suffix such as `notes (2).md`.

The copied file is only one part of the import. Storage also records source metadata in SQLite, increments the project revision, queues a `source.imported` event, and wakes the agent with the latest document revision. Directly copying files into `sources/` bypasses those steps, so normal source ingestion should go through the Electron import flow.

The fresh schema persists projects, versioned block JSON, source metadata, suggestion command receipts, immutable suggestion facts, a rebuildable current projection, derived checkpoints, the committed delivery stream, and quarantined incompatible JSON. Suggestion history is retained indefinitely. Checkpoints are created after 500 facts or a replay longer than two seconds and only the newest ten per document are retained. Temporary `suggestionPreview` blocks remain excluded from autosave.

Suggestion maintenance reports event count and bytes, checkpoint coverage, replay duration, projection mismatch, and database size without logging suggestion content. Verification stops and quarantines on gaps, unknown versions, invalid payloads, or bad checksums. Repair requires a successfully verified database backup before replacing the current projection.

Renderers subscribe before hydration. Main assigns a process-lifetime consumer ID, buffers events while the snapshot is read, and hands off events above the snapshot's covered sequence. The renderer ignores duplicates, replays gaps in order, acknowledges only after application, and installs a fresh snapshot when history is unavailable or the bounded main buffer overflows. A reload gets a new consumer ID and authoritative snapshot.

## Pi configuration and session

Pi uses native global files under `<userData>/pi/`:

- `settings.json` for default provider/model and Pi settings;
- `auth.json` for Pi credentials;
- `models.json` for custom models/providers.

Standard provider environment variables are also supported. Invalid settings, auth, or model files—or no usable model/credential pair—leave the runtime `offline` and expose a diagnostic in the writing-partner panel.

`SessionManager.continueRecent()` targets the project-specific `.pi/sessions` directory. At launch, Electron validates the prompt set selected by `experience/config.yaml` and snapshots it for every agent process created during that launch. `DefaultResourceLoader` trusts the app-managed workspace, preserves Pi's default system prompt, appends the selected Scribe read-only/suggestion instructions, and registers the bundled Scribe extension factory. External extension tools are disabled. The exact active tool set is `read`, `grep`, `find`, `ls`, and Scribe's read-document/list/create/update/retract/wait tools; `bash`, `write`, and `edit` are excluded.

The agent process runs with `cwd` set to the managed project workspace. Its visible project files are imported files under `sources/` and its `.pi/sessions` history; the active draft is available only through `read_document`. The source repository, renderer bundle, and arbitrary filesystem locations are not used as writing context unless a future feature explicitly imports or exposes them.

## Autonomous loop

There is no polling timer. The Pi utility process and durable session initialize at launch, but autonomous work starts disabled. After storage commits a document or source revision, main forwards that durable revision through Pi's shared event bus. The extension coalesces updates while Pi is stopped or busy and starts a cycle against the latest revision only after the writer chooses **Start Agent**.

**Stop Agent** marks the runtime `stopped` before awaiting Pi's `session.abort()`. The cancelled cycle does not count toward the five-cycle cap, no later cycle is scheduled, and committed suggestions remain intact. Starting again retries aborted, errored, or capped work against the latest revision. A successfully yielded unchanged revision remains `waiting` without a redundant provider call. The enabled preference is launch-scoped, so every application start is quiet.

`wait_for_changes` succeeds only when no newer revision arrived during the active cycle. A successful yield persists the yielded revision and loop state as a Pi custom session entry and leaves the runtime `waiting`. If Pi ends without yielding, the extension immediately starts another cycle. Five consecutive cycles without a yield or new revision produce `capped`; the next revision resets the counter and wakes `waiting`, `capped`, or recoverable `error` state.

Suggestion tools include the active document revision. Storage rejects stale mutations, after which the extension schedules the latest revision. Runtime state is one of `offline`, `stopped`, `working`, `waiting`, `capped`, or `error` and includes the Pi session ID, active revision, cycle count, and optional diagnostic. `offline` means Pi cannot run; `stopped` means it is configured but disabled by the writer.

## Activity diagnostics

Agent lifecycle, message, emitted reasoning, tool, provider, loop, and error events become `agent.activity` desktop events. Main aggregates streaming message/tool updates by ID, recursively redacts credential and header fields, caps each serialized payload at 50 KB, and keeps the latest 500 entries in memory.

Agent runtime and activity are intentionally ephemeral. They have no durable ordering, acknowledgement, or replay guarantee; reloads recover only main's latest in-memory runtime and activity snapshot. Durable project-change notifications carry stream sequences so the agent can detect a gap and refresh its observation seed without replaying model work.

Hydration includes the current launch's ring, so renderer reload retains diagnostics. The ring is not persisted and starts empty on application restart. The writing-partner panel has Suggestions and Activity views. Only runtime status/error text uses live announcements; the chronological diagnostic list is not announced as it streams.

## Startup and failure behaviour

Storage is started first, inspects and opens the database, bootstraps the selected workspace, and reports readiness with its protocol name, exact version, build, and operation set. Main validates the complete handshake before sending requests. It then initializes Pi and applies the same check to the agent process, registers renderer IPC, creates the window, and delivers the current revision without starting a model cycle. Utility process startup failure is fatal; provider/tool failures put the enabled autonomous loop to sleep in `error` until a newer project revision arrives or the writer stops and starts it.

Database startup creates the current schema only for an empty database and validates current files before use. This is an early alpha: incompatible files stop startup and developers delete the local database to recreate it. The generic migration and backup framework remains for a future release boundary, but there is no migration path into this baseline.

Production loads `dist/index.html` through `BrowserWindow.loadFile`; Vite therefore uses `base: "./"`. Development loads `VITE_DEV_SERVER_URL` in Electron and exposes DevTools through the development menu. Context isolation remains enabled and Node integration disabled.

## Build and packaging

`npm run build` type-checks both TypeScript projects and builds renderer, main, preload, storage, and agent bundles. `npm run package` produces an unpacked electron-builder application; `npm run dist` produces platform packages. Generated `dist-electron/` and `release/` directories are not source.
