# Getting started

## Prerequisites

- Node.js `>=22.19.0`. Pi agent-core sets the effective project minimum.
- npm, using the committed `package-lock.json`.

No database daemon is required. Electron creates its SQLite database in the platform application-data directory. An API key or local inference endpoint is only required when enabling the Pi agent.

## Install and run

From the repository root:

```bash
npm ci
npm run dev
```

Vite builds the Electron main, preload, storage, and agent entries, starts its renderer development server, and launches Electron. Renderer changes use HMR; main, storage, or agent changes restart Electron; preload changes reload the renderer.

Development intentionally uses Electron's persistent `userData` directory instead of a throwaway Vite profile. Edits, imported sources, settings, and suggestions therefore survive restarts and can affect the same persisted workspace as a built application when both resolve to the same app-data profile. Do not run development and an installed build concurrently against that profile.

Use `npm ci`, rather than `npm install`, for a clean checkout or CI job so dependency versions remain aligned with the lockfile.

To build and launch the persistent desktop application:

```bash
npm run desktop
```

This command always builds the renderer and Electron processes before launching. The first launch creates the default project workspace under `<userData>/projects/default-project/`; Pi reads native configuration from `<userData>/pi/`.

## Local data layout

`<userData>` means the directory returned by Electron's `app.getPath("userData")` for the running app. For a packaged ScribeAI build this is normally:

| Platform | Typical `<userData>` location |
| --- | --- |
| macOS | `~/Library/Application Support/ScribeAI/` |
| Windows | `%APPDATA%\ScribeAI\` |
| Linux | `~/.config/ScribeAI/` |

The running app owns this tree:

```text
<userData>/
  settings.yaml
  scribe.sqlite3
  pi/
    settings.json
    auth.json
    models.json
  projects/default-project/
    sources/
      <imported-source>.md
    .pi/sessions/
      *.jsonl
```

The source checkout is not the writing project workspace. Electron stores BlockNote document blocks, the source list, and suggestions in `scribe.sqlite3`, copies imported files under `sources/`, and resumes Pi sessions from the project-specific `.pi/sessions/` directory.

## What to expect after startup

Electron opens the persisted writing workspace with the agent stopped. Import sources and edit the draft without model activity, then choose **Start Agent** in the writing-partner toolbar when ready. **Stop Agent** immediately cancels active model work and keeps later revisions queued until the next start.

React runs in `StrictMode`. During development, effects are mounted, cleaned up, and mounted again to expose unsafe effect code.

## Set up the Pi agent

Launch the app once before configuring Pi so Electron creates `<userData>/`. Then add Pi's native configuration files under `<userData>/pi/`.

`settings.json` selects the default provider and model:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-6"
}
```

Credentials can either live in Pi's native `<userData>/pi/auth.json` file or be supplied as standard provider environment variables, such as `ANTHROPIC_API_KEY`, before starting Electron. Custom providers and model aliases belong in `<userData>/pi/models.json`.

Restart the app after changing these files. If Pi cannot load settings, models, or credentials, the writing partner remains offline, Start Agent is unavailable, and the reason appears in the Activity tab. A configured agent remains stopped until the writer starts it. It reads the active BlockNote document through Scribe's read-only `read_document` tool plus Markdown files in `sources/`, but it cannot edit them directly; it publishes suggestions through Scribe's suggestion tools.

Scribe's agent instructions live in [`experience/prompts/default.yaml`](../experience/prompts/default.yaml). To test a variant, copy that file, edit `system_append` or `review_cycle`, select the copy with `prompt_file` in [`experience/config.yaml`](../experience/config.yaml), then stop and relaunch the app. The review prompt supports `{{project_revision}}` and `{{document_revision}}`; other placeholders are rejected. An invalid prompt configuration leaves the editor available but keeps the agent offline with the validation error in Activity.

## Import writing sources

Use the Electron app to import sources:

1. Open the sidebar section labelled **AI research context**.
2. Choose **Upload Sources**.
3. Select a UTF-8 `.md` or `.markdown` file.

Electron copies the selected file into `<userData>/projects/default-project/sources/`, records it in SQLite, adds it to the sidebar, and increments the project revision. A running agent wakes immediately; a stopped agent retains the latest revision for the next start. Name collisions are kept readable, for example `notes (2).md`.

Do not place source files directly in the `sources/` directory as the normal workflow. Direct copies bypass the SQLite source record and revision event, so the file may not appear in the app or wake the agent. The original selected file is not watched after import; import the changed Markdown file again when source content changes.

## Developer commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite and launch the complete Electron development runtime. |
| `npm run build` | Type-check and build the renderer and all Electron process entries. |
| `npm run desktop` | Build and launch the Electron application. |
| `npm run package` | Build an unpacked desktop application with electron-builder. |
| `npm run dist` | Build platform installers with electron-builder. |
| `npm run docs:build` | Regenerate the static site in `docs/html/` from the Markdown documentation. |
| `npm run lint` | Run ESLint over the repository. |
| `npm test` | Run all Vitest tests once in jsdom. |
| `npm run test:watch` | Run Vitest in watch mode. |

A normal pre-handoff check is:

```bash
npm run lint
npm test
npm run build
```

See [Testing and quality](testing-and-quality.md) for the current automated coverage and manual checks.

The production build currently completes with Vite's warning that some minified chunks exceed 500 kB. The main application bundle and parts of Mermaid are the principal contributors. This is a warning, not a failed build; treat a new error separately. The performance watch points in the [Extension guide](extension-guide.md#performance-watch-points) describe the relevant boundaries.

## Runtime entry points

- initial editor content: [`initialContent`](../src/renderer/app/App.tsx);
- autonomous Pi runtime and extension: [`src/utility/agent/index.ts`](../src/utility/agent/index.ts) and [`src/utility/agent/extension.ts`](../src/utility/agent/extension.ts).

## Renderer preferences

The app stores two optional values:

| Key | Meaning | Valid range |
| --- | --- | --- |
| `scribe-navigation-column-width` | Desktop navigation width in pixels | 220–380 |
| `scribe-context-column-width` | Desktop writing-partner width in pixels | 280–720 |

Invalid or unavailable values are ignored. Double-clicking a resize separator removes its key and restores the CSS default. If browser storage is blocked, resizing still works for the current session.

These values remain renderer-local in both runtimes. Electron workspace data lives in `scribe.sqlite3` under Electron's `userData` directory.

## First-pass manual tour

At a viewport at least `80rem` wide:

1. Configure and start Pi, then let it publish representative suggestion kinds.
2. Open a text suggestion, preview it, edit the purple preview block, then cancel it.
3. Preview again and accept it; it becomes a normal paragraph and the suggestion disappears.
4. Pin a suggestion, open it, and place it on the workspace.
5. Drag and resize the workspace card, then return it to Pins.
6. Collapse and reopen both side columns.
7. Resize both columns with the pointer and keyboard; double-click a separator to reset.

Below `80rem`:

1. Open each side drawer from the header.
2. Press Escape and confirm the drawer closes and focus returns to its trigger.
3. Confirm workspace placement is not offered; workspace cards are desktop-only.

For an Electron smoke test:

1. Run `npm run desktop` and confirm the workspace, editor, and both side panels render.
2. Edit the document, wait at least 650 ms, restart, and confirm the accepted blocks return.
3. Import `.md` and `.markdown` sources; confirm invalid UTF-8 and other extensions are rejected.
4. Configure Pi, edit the draft, observe autonomous cycles and activity, reach `waiting`, then edit again and confirm immediate wake-up.

## Common problems

### Vite refuses to start

Check `node --version`. Vite 8 does not support early Node 20 releases; use Node 20.19 or newer, or Node 22.12 or newer.

### Electron opens a blank window

Inspect `dist/index.html`. Built script, stylesheet, module-preload, and lazy-chunk URLs must be relative to the file, such as `./assets/index-….js`. [`vite.config.ts`](../vite.config.ts) sets `base: "./"` for this reason. Root-relative `/assets/...` references resolve from the filesystem root under Electron and fail with `ERR_FILE_NOT_FOUND`.

### Electron starts but no window appears

Run Electron with logging enabled and inspect `Desktop startup failed` plus utility-process stderr. A database compatibility or integrity failure also displays the affected path and recovery guidance; preserve that file and adjacent migration backups before troubleshooting. Main waits for both storage and agent readiness before creating the window. Keep the ES-module entry free of a top-level `await app.whenReady()`; startup must be attached with `app.whenReady().then(start)` so module evaluation can complete.

Wayland compositor capability warnings are not, by themselves, evidence that window creation failed. Diagnose renderer load failures and utility-process startup before forcing an X11 backend.

### Fonts look different

[`index.html`](../index.html) loads Inter and Literata from Google Fonts. If the network request is blocked, the UI falls back to system sans-serif and Georgia-style serif fonts. Functionality is unaffected.

### A diagram says “Diagram unavailable”

Mermaid is loaded lazily only when a diagram visual renders. Invalid Mermaid source or a failed module render activates the accessible text fallback. Inspect [`MermaidDiagram.tsx`](../src/renderer/features/suggestions/dock/MermaidDiagram.tsx) and the `mermaidSource` on the suggestion.

### A workspace pin is missing

Workspace cards render only at the desktop `xl` breakpoint (`80rem` and above). A card also remains hidden for one animation frame while its initial geometry is calculated. It must first be pinned in the writing partner before “Place on workspace” is available.
