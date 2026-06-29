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

`npm run build` is also the authoritative type check because it runs `tsc -b` before Vite. TypeScript uses strict mode, rejects unused locals and parameters, and disallows fallthrough switch cases.

## Current automated coverage

The suite currently contains 29 tests across eight files.

| File | What it protects |
| --- | --- |
| [`suggestions/inbox.test.ts`](../src/suggestions/inbox.test.ts) | Dedupe, 30-item eviction, stale/withdrawn previews, frozen pins, workspace transitions, preview resolution, and z-order. |
| [`dev/mockSuggestions/createInjectedSuggestionFeed.test.ts`](../src/dev/mockSuggestions/createInjectedSuggestionFeed.test.ts) | Channel delivery, malformed-message rejection, and unsubscribe cleanup. |
| [`dev/mockSuggestions/mockSuggestionDraft.test.ts`](../src/dev/mockSuggestions/mockSuggestionDraft.test.ts) | Common metadata, every kind-specific payload, recursive node JSON, and validation failures. |
| [`dev/mockSuggestions/MockSuggestionController.test.tsx`](../src/dev/mockSuggestions/MockSuggestionController.test.tsx) | Dynamic fields, form submission/reset, channel publication, and unsupported-browser behavior. |
| [`components/SuggestionDock.test.tsx`](../src/components/SuggestionDock.test.tsx) | Absence of legacy steering controls, unified stream, text preview action, pin presentation, and workspace placement callback. |
| [`components/WorkspacePins.test.tsx`](../src/components/WorkspacePins.test.tsx) | Card content, return action, keyboard geometry, and pointer drag commit. |
| [`components/DocumentHeader.test.tsx`](../src/components/DocumentHeader.test.tsx) | Desktop panel semantics, hidden-partner unread count, and independent mobile controls. |
| [`components/ResponsiveDrawer.test.tsx`](../src/components/ResponsiveDrawer.test.tsx) | Escape/close behavior and focus restoration. |

### Why reducer tests matter most

The inbox reducer contains the application's lifecycle invariants and is pure. Any change to dedupe, updates, retractions, selection, previewing, pins, workspace geometry, queue limits, or unread behavior should begin with a reducer case. Component tests should then verify that the correct intent is exposed to users.

### Feed lifecycle tests

The mock feed owns a browser channel while it has subscribers. Always unsubscribe and verify no new events arrive; feed cleanup is required for React `StrictMode` and future reconnection logic.

### Geometry tests

jsdom does not perform layout. Workspace tests mock `clientWidth` and `clientHeight`, and pointer-capture methods are stubbed where needed. A passing geometry unit test does not replace browser testing for actual scroll, resizing, and pointer behavior.

## What is not covered automatically

The current suite does not render the full `App` or BlockNote editor. It therefore does not directly verify:

- preview block insertion, editing, accepting, or cancellation;
- panel drag resizing and `localStorage` restoration;
- breakpoint transitions and drawer/desktop handoff;
- initial workspace-card placement in the real scrolling canvas;
- canvas clamping through a real `ResizeObserver`;
- Mermaid SVG rendering and failure handling;
- production bundle execution;
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
