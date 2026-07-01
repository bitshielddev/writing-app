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

Development intentionally uses the same Electron `userData` directory as a built or installed ScribeAI application. Edits, imported sources, settings, and mock suggestions therefore affect the same persisted workspace. Do not run development and an installed build concurrently against that profile.

Use `npm ci`, rather than `npm install`, for a clean checkout or CI job so dependency versions remain aligned with the lockfile.

To build and launch the persistent desktop application:

```bash
npm run desktop
```

This command always builds the renderer and Electron processes before launching. The first launch creates the default project workspace under `<userData>/projects/default-project/`; Pi reads native configuration from `<userData>/pi/`.

## What to expect after startup

Electron opens the persisted writing workspace. To inject deterministic suggestions without invoking a model:

1. Choose **Development → Mock suggestions**, or press `CmdOrCtrl+Shift+M`.
2. Complete one of the six suggestion forms in the dedicated development window.
3. Send it; the suggestion is validated, committed to SQLite, and delivered through the same event path as an agent suggestion.

The development window is single-instance. Closing and reopening it does not clear injected suggestions.

React runs in `StrictMode`. During development, effects are mounted, cleaned up, and mounted again to expose unsafe effect code. The mock feed opens its channel receiver for the first subscriber and closes it after the final subscriber leaves, preventing duplicate streams.

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

## Runtime configuration

Configure Pi with `<userData>/pi/settings.json`. For example:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-6"
}
```

Credentials may be stored in Pi's `auth.json` or supplied through standard provider environment variables such as `ANTHROPIC_API_KEY`. Custom providers/models use Pi's `models.json`. Invalid or incomplete native configuration leaves the agent offline and displays the diagnostic under Activity.

- initial editor content: [`initialContent`](../src/App.tsx);
- Electron-only mock suggestion controller: [`src/dev/mockSuggestions`](../src/dev/mockSuggestions);
- autonomous Pi runtime and extension: [`agent.ts`](../desktop/agent.ts) and [`scribe-extension.ts`](../desktop/scribe-extension.ts).

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

1. Inject one suggestion of each kind from **Development → Mock suggestions**.
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

Run Electron with logging enabled and inspect `Desktop startup failed` plus utility-process stderr. Main waits for both storage and agent readiness before creating the window. Keep the ES-module entry free of a top-level `await app.whenReady()`; startup must be attached with `app.whenReady().then(start)` so module evaluation can complete.

Wayland compositor capability warnings are not, by themselves, evidence that window creation failed. Diagnose renderer load failures and utility-process startup before forcing an X11 backend.

### Fonts look different

[`index.html`](../index.html) loads Inter and Literata from Google Fonts. If the network request is blocked, the UI falls back to system sans-serif and Georgia-style serif fonts. Functionality is unaffected.

### A mind map says “Diagram unavailable”

Mermaid is loaded lazily only when a mind-map visual renders. Invalid Mermaid source or a failed module render activates the accessible text fallback. Inspect [`MermaidDiagram.tsx`](../src/components/MermaidDiagram.tsx) and the `mermaidSource` on the suggestion.

### A workspace pin is missing

Workspace cards render only at the desktop `xl` breakpoint (`80rem` and above). A card also remains hidden for one animation frame while its initial geometry is calculated. It must first be pinned in the writing partner before “Place on workspace” is available.

### Suggestion behavior seems duplicated in development

Check that a new feed is not being created on every render. [`App.tsx`](../src/App.tsx) memoizes it. Also ensure every `SuggestionFeed.subscribe` implementation fully cleans up when the last subscriber leaves; React `StrictMode` will exercise that path.

### A manually sent suggestion does not appear

Confirm the controller was opened from the Electron **Development** menu rather than by visiting the Vite URL in a browser. Check the controller error message and main-process logs; development injection is rejected outside the Electron development runtime.
