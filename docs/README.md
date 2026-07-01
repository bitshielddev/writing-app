# ScribeAI developer documentation

This directory describes the application as it works now. It is intended to get a developer from a fresh checkout to making safe changes without first reverse-engineering the UI, editor, and suggestion state machine.

## What this application is

ScribeAI is an Electron writing workspace with a React renderer. The current implementation combines:

- a BlockNote rich-text editor;
- persistent live and development-injected writing-partner feeds;
- an inbox for reading, dismissing, pinning, and previewing suggestions;
- desktop workspace cards for keeping references over the editor;
- responsive navigation and writing-partner panels;
- SQLite document, Markdown mirror, source, and suggestion persistence;
- a durable Pi coding-agent session with writer-controlled autonomous work and launch-scoped activity diagnostics.

Electron owns SQLite and Pi in utility processes, imports UTF-8 Markdown sources, and restores the workspace and Pi session after restart. Development uses the same runtime with Vite renderer HMR and a dedicated mock-suggestion window.

## Fastest route into the codebase

1. Follow [Getting started](getting-started.md) to run the app, configure the Pi agent under Electron `userData`, import Markdown sources, and run the checks.
2. Read [Architecture](architecture.md) for state ownership and module boundaries.
3. Read [Editor and suggestion system](editor-and-suggestions.md) before changing feed, preview, pin, or inbox behavior.
4. Use [UI and accessibility](ui-and-accessibility.md) for responsive layout, resizing, styling, and keyboard behavior.
5. Use [Testing and quality](testing-and-quality.md) before submitting a change.
6. Read [Desktop runtime](desktop-runtime.md) before changing persistence, IPC, source import, or Pi behaviour.
7. Use [Extension guide](extension-guide.md) when extending those boundaries or adding a new suggestion kind.

## Current user-visible behavior

| Area | Current behavior |
| --- | --- |
| Editor | Electron hydrates and autosaves the current BlockNote document. |
| Writing partner | The agent starts stopped on every app launch. A persistent control starts or immediately stops autonomous work. Electron receives committed suggestions from the Pi agent or its development-only mock controller. |
| Text suggestions | Snippets, facts, and terms can become an editable document preview, then be accepted or cancelled. |
| Structural suggestions | Outlines and layouts render nested cards; mind maps render through Mermaid. They are references, not insertable previews. |
| Pins | A suggestion can be frozen into the Pins section. On desktop it can then be placed, moved, resized, stacked, and returned. |
| Responsive layout | Below `80rem`, navigation and writing partner use modal drawers. At `80rem` and above they become independently collapsible, resizable columns. |
| Persistence | Electron restores the document, Markdown mirror, sources, suggestion inbox, pins, workspace cards, and Pi session. |
| Sources | Electron imports complete UTF-8 `.md` and `.markdown` files through **Upload Sources** into the managed project workspace. |
| Static controls | Navigation destinations, document tabs, New Document, history, export, share, and overflow actions have no application behavior yet. |

## Repository map

```text
.
├── docs/                         Developer documentation
├── desktop/                      Electron main, preload, storage, Pi, and build entries
├── src/
│   ├── App.tsx                   Composition root and cross-feature orchestration
│   ├── main.tsx                  React renderer entry point
│   ├── index.css                 Tailwind theme, layout rules, and editor overrides
│   ├── components/               UI components and component tests
│   ├── dev/mockSuggestions/      Electron-only development controller and payload builder
│   ├── desktop/                  Renderer-side desktop feed adapter
│   ├── editor/                   BlockNote schema and preview events
│   ├── suggestions/              Suggestion contracts, inbox state, and workspace layout
│   ├── shared/                   Cross-process desktop contracts
│   └── test/setup.ts             Shared Vitest cleanup
├── artifacts/                    Standalone review artifacts; not used at runtime
├── index.html                    Vite HTML shell and Google Font loading
├── vite.config.ts                Vite, React, Tailwind, and Vitest configuration
├── eslint.config.js              TypeScript and React lint rules
└── package.json                  Dependencies and developer commands
```

## Terms used in the code

- **Suggestion feed**: the subscription interface that emits suggestion and agent-status events.
- **Inbox entry**: a live suggestion tracked by the reducer, including viewed, stale, and withdrawn flags.
- **Pinned entry**: a deep-copied, stable suggestion snapshot removed from the live inbox queue.
- **Workspace pin**: a pinned suggestion moved onto the desktop editor canvas with geometry and stacking state.
- **Preview**: a temporary, editable custom BlockNote block created from a text suggestion. Only one preview may be active.

## Important implementation constraints

- [`App.tsx`](../src/App.tsx) is the renderer composition root. It connects the required Electron bridge, hydration, autosave, feed, previews, panel state, and workspace pins.
- [`inboxReducer`](../src/suggestions/inbox.ts) is the source of truth for suggestion lifecycle rules. UI components dispatch intent; they should not recreate those rules locally.
- [`SuggestionFeed`](../src/suggestions/types.ts) is the event-stream boundary. The Electron adapter maps committed desktop events into renderer events.
- The app assumes a browser DOM. `window`, `document`, `localStorage`, media queries, `ResizeObserver`, and pointer capture are used directly.
