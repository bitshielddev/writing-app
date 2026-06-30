# Desktop persistence and Pi runtime

## Process topology

The packaged application has four cooperating runtimes:

1. The React renderer owns BlockNote and presentation state.
2. Electron main owns application lifecycle, IPC routing, provider launch state, and the observation timer.
3. The storage utility process is the only SQLite owner.
4. The agent utility process runs `@earendil-works/pi-agent-core` with application-domain tools.

The preload exposes named methods from `DesktopBridge`. The renderer never imports Electron, SQLite, or Pi packages.

## Startup and renderer loading

The Electron entry is an ES module. It registers startup with `app.whenReady().then(start)` rather than using a top-level `await app.whenReady()`: Electron does not emit `ready` until the entry module has finished evaluating, so awaiting that event during module evaluation deadlocks startup.

`start` forks both utility processes and waits for an explicit `ready` message from each before it registers IPC handlers or creates a window. If either child exits first, its readiness promise rejects and main logs `Desktop startup failed` before quitting instead of leaving a hidden process running indefinitely.

In a production launch, main loads `dist/index.html` with `BrowserWindow.loadFile`. Vite therefore uses `base: "./"` so scripts, styles, and lazy chunks resolve relative to that HTML file. A root-relative `/assets/...` URL resolves to `file:///assets/...` in Electron and produces a blank window. `SCRIBE_DEV_SERVER_URL` can instead direct the window at an already-running development server.

The renderer runs with context isolation enabled and Node integration disabled. `desktop/preload.ts` is bundled as CommonJS and exposes the narrow bridge through `contextBridge`; main, storage, and agent entries are bundled as ES modules under `dist-electron/`.

## Persistence model

The database is `scribe.sqlite3` under Electron's `userData` directory. Startup creates a default project and document and enables SQLite WAL mode. Schema creation is idempotent.

The current implementation persists:

- the latest accepted BlockNote block snapshot and monotonic document/project revisions;
- imported source metadata, app-owned file copies, and extracted text;
- the complete visible suggestion projection, including pins and workspace geometry;
- provider/model/base-URL settings and paused state;
- per-document agent memory;
- agent runs and every Pi lifecycle/tool/message event;
- committed desktop events in an outbox.

Temporary `suggestionPreview` blocks are filtered from document saves. They are not restored after restart. Document history, transcript retention, automatic backups, encrypted storage, and persisted API keys are not implemented.

## Editor and event flow

On mount, `App` hydrates a `WorkspaceSnapshot`, replaces seeded BlockNote content, restores suggestions, and enables autosave. Editor changes are debounced for 650 ms. Suggestion reducer changes save a durable projection.

Storage mutations write canonical data and any desktop event in one transaction. After commit, the storage process forwards outbox events through main to every renderer. The desktop feed converts suggestion and agent runtime events into the existing `SuggestionEvent` variants.

## Source import

The sidebar's Upload Sources action opens the native file picker. The storage process copies the file into the application-data `sources` directory and extracts text from:

- plain text, Markdown, and JSON with UTF-8 reads;
- DOCX with Mammoth;
- PDF with pdf-parse.

Extracted text is capped at two million characters per source. Agent read results are capped separately.

PDF.js does not install its normal Node canvas globals inside an Electron utility process because `process.type` is `utility`. Before `pdf-parse` is loaded, storage installs `DOMMatrix`, `ImageData`, and `Path2D` from `@napi-rs/canvas`. Keep that initialization before the dynamic `pdf-parse` import or PDF source import will fail during module evaluation.

## Agent lifecycle

The scheduler checks every 10 seconds while the app is open. It starts a run only when the project revision differs from the last completed observation, unless the user selects Consider now. Only one run executes at once; newer observations are coalesced.

Each run receives the active project/document IDs and revisions plus the previous document-memory summary. Its tools can list, search, and read project content; list current suggestions; create, update, or retract live suggestions; and save the next memory summary. Suggestion and memory writes fail when the document revision has changed.

The provider selection is global. Built-in Pi models use the catalog; a custom base URL can override a catalog model or define an OpenAI-compatible model. The API key remains in Electron/agent process memory for the current launch.

## Failure behaviour

- A utility process that exits before its `ready` message rejects desktop startup; main logs the error and quits.
- Provider or tool errors update the writing-partner error state and mark the run failed.
- Runs time out after two minutes.
- Pausing aborts the active run and clears queued observations.
- Storage errors reject the originating IPC or agent tool call.
- Renderer reload hydrates canonical SQLite state rather than relying on event replay.

## Build and packaging

`npm run build` type-checks and builds the Vite renderer, then type-checks and bundles all Electron entries. `npm run desktop` performs that full build before launching Electron. `npm run package` produces an unpacked electron-builder application, while `npm run dist` produces the configured platform packages. Generated `dist-electron/` and `release/` directories are not source and remain ignored by Git.
