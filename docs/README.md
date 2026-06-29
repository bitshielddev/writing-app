# ScribeAI developer documentation

This directory describes the application as it works now. It is intended to get a developer from a fresh checkout to making safe changes without first reverse-engineering the UI, editor, and suggestion state machine.

## What this application is

ScribeAI is a client-only React writing workspace. The current implementation combines:

- a BlockNote rich-text editor;
- a mock, event-driven writing-partner feed;
- an inbox for reading, dismissing, pinning, and previewing suggestions;
- desktop workspace cards for keeping references over the editor;
- responsive navigation and writing-partner panels.

There is currently no backend, authentication, router, remote model call, document persistence, or file upload pipeline. Most navigation and document-management controls are presentation-only. The only persisted values are the two desktop column widths in browser `localStorage`.

## Fastest route into the codebase

1. Follow [Getting started](getting-started.md) and run the app and checks.
2. Read [Architecture](architecture.md) for state ownership and module boundaries.
3. Read [Editor and suggestion system](editor-and-suggestions.md) before changing agent, preview, pin, or document-context behavior.
4. Use [UI and accessibility](ui-and-accessibility.md) for responsive layout, resizing, styling, and keyboard behavior.
5. Use [Testing and quality](testing-and-quality.md) before submitting a change.
6. Use [Extension guide](extension-guide.md) when adding a real service, persistence, or a new suggestion kind.

## Current user-visible behavior

| Area | Current behavior |
| --- | --- |
| Editor | Starts with a seeded article and edits in memory through BlockNote. |
| Writing partner | Emits six initial mock suggestions, accepts a typed direction, and observes accepted document changes. |
| Text suggestions | Snippets, facts, and terms can become an editable document preview, then be accepted or cancelled. |
| Structural suggestions | Outlines and layouts render nested cards; mind maps render through Mermaid. They are references, not insertable previews. |
| Pins | A suggestion can be frozen into the Pins section. On desktop it can then be placed, moved, resized, stacked, and returned. |
| Responsive layout | Below `80rem`, navigation and writing partner use modal drawers. At `80rem` and above they become independently collapsible, resizable columns. |
| Persistence | Desktop column widths only. Editor content, inbox state, pins, and workspace geometry reset on reload. |
| Static controls | Navigation destinations, document tabs, New Document, source upload, history, export, share, and overflow actions have no application behavior yet. |

## Repository map

```text
.
├── docs/                         Developer documentation
├── src/
│   ├── App.tsx                   Composition root and cross-feature orchestration
│   ├── main.tsx                  React browser entry point
│   ├── index.css                 Tailwind theme, layout rules, and editor overrides
│   ├── components/               UI components and component tests
│   ├── editor/                   BlockNote schema, context extraction, preview events
│   ├── suggestions/              Feed contracts, mock feed, context source, inbox state
│   └── test/setup.ts             Shared Vitest cleanup
├── artifacts/                    Standalone review artifacts; not used at runtime
├── index.html                    Vite HTML shell and Google Font loading
├── vite.config.ts                Vite, React, Tailwind, and Vitest configuration
├── eslint.config.js              TypeScript and React lint rules
└── package.json                  Dependencies and developer commands
```

## Terms used in the code

- **Accepted document**: all editor blocks except temporary `suggestionPreview` blocks. This is the content exposed to the agent context source.
- **Suggestion feed**: the service-shaped interface that emits suggestion and agent-status events and accepts user steering.
- **Inbox entry**: a live suggestion tracked by the reducer, including viewed, stale, and withdrawn flags.
- **Pinned entry**: a deep-copied, stable suggestion snapshot removed from the live inbox queue.
- **Workspace pin**: a pinned suggestion moved onto the desktop editor canvas with geometry and stacking state.
- **Preview**: a temporary, editable custom BlockNote block created from a text suggestion. Only one preview may be active.
- **Steering**: a direction typed by the user and passed to `SuggestionFeed.sendSteering`.

## Important implementation constraints

- [`App.tsx`](../src/App.tsx) is the composition root. It intentionally connects editor state, agent context, inbox state, previews, panel state, and workspace pins.
- [`inboxReducer`](../src/suggestions/inbox.ts) is the source of truth for suggestion lifecycle rules. UI components dispatch intent; they should not recreate those rules locally.
- [`SuggestionFeed`](../src/suggestions/types.ts) and [`AgentContextSource`](../src/suggestions/types.ts) are the service boundaries. A production integration should implement them rather than leak transport concerns into components.
- Temporary previews must not enter agent context. [`getAcceptedDocumentBlocks`](../src/editor/documentContext.ts) enforces this recursively.
- The app assumes a browser DOM. `window`, `document`, `localStorage`, media queries, `ResizeObserver`, and pointer capture are used directly.

