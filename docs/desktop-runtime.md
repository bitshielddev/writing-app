# Desktop persistence and Pi runtime

## Process topology

The packaged application has four cooperating runtimes: React owns BlockNote and presentation state; Electron main owns lifecycle, IPC, the launch-scoped activity ring, and project revision delivery; the storage utility process exclusively owns SQLite and the managed workspace; and the agent utility process owns one durable `@earendil-works/pi-coding-agent` session.

The preload exposes the typed `DesktopBridge`. The renderer never imports Electron, SQLite, filesystem, or Pi packages.

## Managed project workspace

The default project uses:

```text
<userData>/projects/default-project/
  draft.md
  sources/<readable-collision-safe-name>.md
  .pi/sessions/*.jsonl
```

Accepted BlockNote blocks and the lossy Markdown export are saved together in SQLite. Storage atomically replaces `draft.md` before it commits and publishes the new revision. Startup repairs a missing or damaged mirror from SQLite before the agent is woken.

Source import accepts only `.md` and `.markdown`. Storage validates the complete file as UTF-8 and copies it without extraction or truncation. Existing names receive a readable suffix such as `notes (2).md`.

The fresh schema persists projects, block JSON plus Markdown, source metadata, suggestion projection, and the committed event outbox. It intentionally contains no provider settings, extracted-content index, agent memory, run transcript, or run-history tables. Temporary `suggestionPreview` blocks remain excluded from autosave.

## Pi configuration and session

Pi uses native global files under `<userData>/pi/`:

- `settings.json` for default provider/model and Pi settings;
- `auth.json` for Pi credentials;
- `models.json` for custom models/providers.

Standard provider environment variables are also supported. Invalid settings, auth, or model files—or no usable model/credential pair—leave the runtime `offline` and expose a diagnostic in the writing-partner panel.

`SessionManager.continueRecent()` targets the project-specific `.pi/sessions` directory. `DefaultResourceLoader` trusts the app-managed workspace, preserves Pi's default system prompt, appends Scribe's read-only/suggestion instructions, and registers the bundled Scribe extension factory. External extension tools are disabled. The exact active tool set is `read`, `grep`, `find`, `ls`, and Scribe's list/create/update/retract/wait tools; `bash`, `write`, and `edit` are excluded.

## Autonomous loop

There is no polling timer. After storage commits a document or source revision, main forwards that durable revision through Pi's shared event bus. The extension coalesces updates while Pi is busy and starts the next cycle against the latest revision.

`wait_for_changes` succeeds only when no newer revision arrived during the active cycle. A successful yield persists the yielded revision and loop state as a Pi custom session entry and leaves the runtime `waiting`. If Pi ends without yielding, the extension immediately starts another cycle. Five consecutive cycles without a yield or new revision produce `capped`; the next revision resets the counter and wakes `waiting`, `capped`, or recoverable `error` state.

Suggestion tools include the active document revision. Storage rejects stale mutations, after which the extension schedules the latest revision. Runtime state is one of `offline`, `working`, `waiting`, `capped`, or `error` and includes the Pi session ID, active revision, cycle count, and optional diagnostic.

## Activity diagnostics

Agent lifecycle, message, emitted reasoning, tool, provider, loop, and error events become `agent.activity` desktop events. Main aggregates streaming message/tool updates by ID, recursively redacts credential and header fields, caps each serialized payload at 50 KB, and keeps the latest 500 entries in memory.

Hydration includes the current launch's ring, so renderer reload retains diagnostics. The ring is not persisted and starts empty on application restart. The writing-partner panel has Suggestions and Activity views. Only runtime status/error text uses live announcements; the chronological diagnostic list is not announced as it streams.

## Startup and failure behaviour

Storage is started first, creates/repairs the workspace mirror, and reports readiness. Main then starts the Pi process, waits for its readiness diagnostic, registers renderer IPC, creates the window, and delivers the current revision. Utility process startup failure is fatal; provider/tool failures put the autonomous loop to sleep in `error` until a newer project revision arrives.

Production loads `dist/index.html` through `BrowserWindow.loadFile`; Vite therefore uses `base: "./"`. Development loads `VITE_DEV_SERVER_URL` in Electron and adds the isolated mock-suggestion window. Context isolation remains enabled and Node integration disabled.

## Build and packaging

`npm run build` type-checks both TypeScript projects and builds renderer, main, preload, storage, and agent bundles. `npm run package` produces an unpacked electron-builder application; `npm run dist` produces platform packages. Generated `dist-electron/` and `release/` directories are not source.
