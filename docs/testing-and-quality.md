# Testing and quality

## Test stack

- Vitest 4 runs the test suite.
- jsdom supplies the browser-like environment configured in [`vite.config.ts`](../vite.config.ts).
- Testing Library renders React components and queries their accessible output.
- `@testing-library/user-event` drives user-style interactions.
- [`src/test/setup.ts`](../src/test/setup.ts) cleans up rendered React trees after every test.

Tests are colocated with source files and use `*.test.ts` or `*.test.tsx`.

## Commands

```bash
npm test
npm run test:watch
npm run lint
npm run build
```

`npm run build` is also the authoritative type and bundle check. It type-checks the renderer and Electron projects, then runs the integrated Vite build for renderer, main, preload, storage, and agent entries. TypeScript uses strict mode, rejects unused locals and parameters, and disallows fallthrough switch cases.

## Current automated coverage

The suite currently contains unit and component coverage across renderer, storage, autonomous-loop, activity, and Pi-session boundaries.

| File | What it protects |
| --- | --- |
| [`suggestions/inbox.test.ts`](../src/suggestions/inbox.test.ts) | Dedupe, 30-item eviction, stale/withdrawn previews, frozen pins, workspace transitions, preview resolution, and z-order. |
| [`dev/mockSuggestions/mockSuggestionDraft.test.ts`](../src/dev/mockSuggestions/mockSuggestionDraft.test.ts) | Common metadata, every kind-specific payload, recursive node JSON, and validation failures. |
| [`dev/mockSuggestions/MockSuggestionController.test.tsx`](../src/dev/mockSuggestions/MockSuggestionController.test.tsx) | Dynamic fields, persisted development submission, rejection handling, and pending-state protection. |
| [`components/SuggestionDock.test.tsx`](../src/components/SuggestionDock.test.tsx) | Absence of legacy steering controls, unified stream, text preview action, pin presentation, and workspace placement callback. |
| [`components/WorkspacePins.test.tsx`](../src/components/WorkspacePins.test.tsx) | Card content, return action, keyboard geometry, and pointer drag commit. |
| [`components/DocumentHeader.test.tsx`](../src/components/DocumentHeader.test.tsx) | Desktop panel semantics, hidden-partner unread count, and independent mobile controls. |
| [`components/ResponsiveDrawer.test.tsx`](../src/components/ResponsiveDrawer.test.tsx) | Escape/close behavior and focus restoration. |
| [`desktop/storage.test.ts`](../desktop/storage.test.ts) | Block/Markdown saves, mirror repair, stale suggestion rejection, and Markdown-only source import. |
| [`desktop/scribe-loop.test.ts`](../desktop/scribe-loop.test.ts) | Coalescing, yields, races, five-cycle cap, error sleep, wake, and restored loop state. |
| [`desktop/activity.test.ts`](../desktop/activity.test.ts) | Aggregation, redaction, 50 KB cap, and 500-item eviction. |
| [`desktop/pi-session.test.ts`](../desktop/pi-session.test.ts) | Project session continuation, extension entries, and the read-only tool contract. |

### Why reducer tests matter most

The inbox reducer contains the application's lifecycle invariants and is pure. Any change to dedupe, updates, retractions, selection, previewing, pins, workspace geometry, queue limits, or unread behavior should begin with a reducer case. Component tests should then verify that the correct intent is exposed to users.

### Development injection tests

The controller test injects a callback rather than Electron IPC. Storage tests protect durable development suggestion behavior; manually confirm the development-only preload and main-process gates in Electron.

### Geometry tests

jsdom does not perform layout. Workspace tests mock `clientWidth` and `clientHeight`, and pointer-capture methods are stubbed where needed. A passing geometry unit test does not replace Electron renderer testing for actual scroll, resizing, and pointer behavior.

## What is not covered automatically

The current suite does not render the full `App` or BlockNote editor. It therefore does not directly verify:

- preview block insertion, editing, accepting, or cancellation;
- panel drag resizing and `localStorage` restoration;
- breakpoint transitions and drawer/desktop handoff;
- initial workspace-card placement in the real scrolling canvas;
- canvas clamping through a real `ResizeObserver`;
- Mermaid SVG rendering and failure handling;
- production bundle execution, Electron readiness, and `file://` asset resolution;
- real-provider autonomous behaviour and provider-specific streaming;
- visual layout, overflow, font fallback, or contrast.

Changes in these areas require targeted tests where practical and the manual checks below.

## Manual regression checklist

### Editor

- The seeded document renders and remains editable.
- Editing document text does not create suggestions.
- Block formatting, selection, slash menu, and normal BlockNote editing still work.

### Suggestion lifecycle

- The inbox remains empty until a controller event is sent.
- Each of the six controller kinds appears with its entered content and visual treatment.
- The workspace exposes no Generate Ideas, steering, or retry controls.
- Selecting marks an item read; Back returns to the correct queue.
- Pin and unpin preserve a frozen copy and correct ordering.

### Preview lifecycle

- Only text kinds offer Preview.
- The preview appears after the last active accepted block and receives focus.
- Only one preview can be active.
- The preview is editable; empty content disables Accept.
- Cancel removes the block and keeps a normal source suggestion.
- Accept converts it to a normal paragraph and removes the suggestion.
- Feed update/retraction does not overwrite an existing preview.

### Desktop layout (`>=80rem`)

- Both side columns can collapse independently.
- Pointer and keyboard resizing respect the editor's minimum space.
- Reload restores sizes; double-click resets them.
- A pinned detail can be placed on the workspace.
- Cards move, resize, stack, clamp, scroll internally, and return to Pins.
- Selecting suggestion detail does not make the center editor unusably narrow.

### Below desktop (`<80rem`)

- Navigation and writing partner open as the correct side drawers.
- Escape, backdrop, and close button dismiss a drawer.
- Focus enters the drawer, wraps, and returns to the trigger.
- Workspace placement is unavailable and no workspace card is shown.
- Header controls and status tabs remain reachable without horizontal page overflow.

### Accessibility

- Complete core flows with keyboard only.
- Inspect button/dialog/region names with browser accessibility tools.
- Confirm visible focus on all interactive elements.
- Confirm unread counts and errors are announced as text, not color alone.
- Force invalid Mermaid source and confirm the description remains available.

### Electron runtime

- Run `npm run dev` and confirm Electron launches without manually opening the Vite URL.
- Change renderer code and confirm HMR; change main/storage/agent code and confirm Electron restarts; change preload and confirm the renderer reloads.
- Open **Development → Mock suggestions** twice and confirm one controller window is focused rather than duplicated.
- Inject a suggestion, reload, and confirm it remains persisted. Confirm a production launch has no development menu or bridge.
- Launch the built application and confirm the renderer mounts without failed local script or stylesheet requests.
- Edit and restart to verify document hydration and the 650 ms autosave path.
- Import `.md` and `.markdown`, including duplicate names; reject invalid UTF-8 and other extensions.
- Restart and confirm sources, suggestions, pins, and workspace geometry hydrate from SQLite.
- Confirm Pi `settings.json`, `auth.json`, and `models.json` load; invalid configuration leaves the agent offline without exposing credentials.
- Confirm every app launch begins stopped and editing or importing sources does not invoke the provider before Start Agent.
- Start after several stopped revisions and confirm only the latest revision is reviewed. Stop during streaming and confirm cancellation is immediate, no error is reported, and no new cycle begins.
- Start again after cancellation, error, or cap and confirm the latest revision is retried; stop/start after a successful yield must not repeat unchanged work.
- Observe multi-cycle work, a suggestion, `waiting`, and immediate wake after a new durable revision.
- Reload the renderer and retain current-launch Activity; restart the app and confirm Activity clears while the Pi session resumes.
- Force a storage or agent utility-process startup failure and confirm main reports the failure and exits instead of hanging without a window.

## Adding tests

Match the test boundary to the behavior:

- pure state transition: add to `inbox.test.ts`;
- feed adapter lifecycle: test through `SuggestionFeed` events with fake time or a controlled transport;
- component semantics/callback: render the component with explicit props and query by accessible role/name;
- full editor integration: use a browser-level test rather than relying on jsdom layout and `contenteditable` emulation.

Prefer public behavior over implementation details. Tests should query accessible names and roles, assert emitted events or callback arguments, and avoid snapshotting large Tailwind class strings.

## Pre-handoff standard

Before handing off a change:

1. run lint;
2. run all unit/component tests;
3. run the production build;
4. manually exercise each changed flow at the relevant breakpoints;
5. update `/docs` if a contract, invariant, command, breakpoint, persistence rule, or static/functional boundary changed.
