# Getting started

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`. This is the engine range required by the installed Vite 8 release.
- npm, using the committed `package-lock.json`.
- A modern browser with ES2022, dynamic imports, media queries, pointer events, and `ResizeObserver` support.

No environment variables, service credentials, database, or local backend are required.

## Install and run

From the repository root:

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. Vite normally uses `http://localhost:5173`, but it will select another port if that one is occupied.

Use `npm ci`, rather than `npm install`, for a clean checkout or CI job so dependency versions remain aligned with the lockfile.

## What to expect after startup

The root URL opens the writing workspace with seeded document content and an empty suggestion inbox. Suggestions are injected manually from a temporary controller:

1. Keep the writing workspace open in one tab, or use the controller's Open writing workspace link.
2. Open `/mock-suggestions` on the same origin in a second tab, for example `http://localhost:5173/mock-suggestions`.
3. Choose one of the six suggestion kinds, complete its common and kind-specific fields, and send it.
4. The suggestion appears immediately in the writing workspace inbox.

Delivery uses `BroadcastChannel`: both tabs must be open concurrently on the same origin. Events are not stored or replayed, and reloading the writing workspace clears its inbox. The existing Generate Ideas and direction controls remain interactive, but the manual mock deliberately emits no steering response.

React runs in `StrictMode`. During development, effects are mounted, cleaned up, and mounted again to expose unsafe effect code. The mock feed opens its channel receiver for the first subscriber and closes it after the final subscriber leaves, preventing duplicate streams.

## Developer commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server with hot reload. |
| `npm run build` | Type-check the project with `tsc -b`, then create a production bundle in `dist/`. |
| `npm run docs:build` | Regenerate the static site in `docs/html/` from the Markdown documentation. |
| `npm run preview` | Serve the existing production bundle locally. Run `npm run build` first. |
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

The application has no `.env` contract. Its current runtime inputs are hard-coded at the composition boundary:

- initial editor content: [`initialContent`](../src/App.tsx);
- research artifacts: [`artifacts`](../src/App.tsx);
- temporary suggestion controller and channel: [`src/dev/mockSuggestions`](../src/dev/mockSuggestions);
- manual-only mock feed adapter: [`mockSuggestionFeed.ts`](../src/suggestions/mockSuggestionFeed.ts);
- navigation labels and displayed research sources: [`Sidebar.tsx`](../src/components/Sidebar.tsx).

The artifact list passed to the agent context and the source list displayed by the sidebar are separate hard-coded values. Keep them synchronized if changing the current prototype, or replace both with shared application data when wiring a real source model.

## Browser storage

The app stores two optional values:

| Key | Meaning | Valid range |
| --- | --- | --- |
| `scribe-navigation-column-width` | Desktop navigation width in pixels | 220–380 |
| `scribe-context-column-width` | Desktop writing-partner width in pixels | 280–720 |

Invalid or unavailable values are ignored. Double-clicking a resize separator removes its key and restores the CSS default. If browser storage is blocked, resizing still works for the current session.

To reset the prototype completely, reload the page and remove those two keys from browser storage. All other application state is already in memory only.

## First-pass manual tour

At a viewport at least `80rem` wide:

1. Inject one suggestion of each kind from `/mock-suggestions`.
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

## Common problems

### Vite refuses to start

Check `node --version`. Vite 8 does not support early Node 20 releases; use Node 20.19 or newer, or Node 22.12 or newer.

### Fonts look different

[`index.html`](../index.html) loads Inter and Literata from Google Fonts. If the network request is blocked, the UI falls back to system sans-serif and Georgia-style serif fonts. Functionality is unaffected.

### A mind map says “Diagram unavailable”

Mermaid is loaded lazily only when a mind-map visual renders. Invalid Mermaid source or a failed module render activates the accessible text fallback. Inspect [`MermaidDiagram.tsx`](../src/components/MermaidDiagram.tsx) and the `mermaidSource` on the suggestion.

### A workspace pin is missing

Workspace cards render only at the desktop `xl` breakpoint (`80rem` and above). A card also remains hidden for one animation frame while its initial geometry is calculated. It must first be pinned in the writing partner before “Place on workspace” is available.

### Suggestion behavior seems duplicated in development

Check that a new feed or context source is not being created on every render. [`App.tsx`](../src/App.tsx) memoizes both. Also ensure every `SuggestionFeed.subscribe` implementation fully cleans up when the last subscriber leaves; React `StrictMode` will exercise that path.

### A manually sent suggestion does not appear

Confirm both tabs use exactly the same scheme, host, and port, and that the writing workspace was already open when Send was pressed. `BroadcastChannel` delivery is live-only. The controller reports an explicit error if the browser does not provide the API.
