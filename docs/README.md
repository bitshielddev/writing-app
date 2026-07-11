# ScribeAI developer documentation

This directory describes the application as it works now. It is intended to get a developer from a fresh checkout to making safe changes without first reverse-engineering the UI, editor, and suggestion state machine.

## What this application is

ScribeAI is an Electron writing workspace with a React renderer. The current implementation combines:

- a BlockNote rich-text editor;
- persistent writing-partner suggestions produced by the Pi agent;
- an inbox for reading, dismissing, pinning, and previewing suggestions;
- desktop workspace cards for keeping references over the editor;
- responsive navigation and writing-partner panels;
- SQLite document, source, and suggestion persistence;
- a durable Pi coding-agent session with writer-controlled autonomous work and launch-scoped activity diagnostics.

Electron owns SQLite and Pi in utility processes, imports UTF-8 Markdown sources, and restores the workspace and Pi session after restart. Development uses the same runtime with Vite renderer HMR and DevTools.

## Fastest route into the codebase

1. Follow [Getting started](getting-started.md) to run the app, configure the Pi agent under Electron `userData`, import Markdown sources, and run the checks.
2. Read [Architecture](architecture.md) for state ownership and module boundaries.
3. Read [Editor and suggestion system](editor-and-suggestions.md) before changing feed, preview, pin, or inbox behavior.
4. Use [UI and accessibility](ui-and-accessibility.md) for responsive layout, resizing, styling, and keyboard behavior.
5. Use [Testing and quality](testing-and-quality.md) before submitting a change.
6. Read [Desktop runtime](desktop-runtime.md) before changing persistence, IPC, source import, or Pi behaviour.
7. Use [Extension guide](extension-guide.md) when extending those boundaries or adding a new suggestion kind.
8. Review [Compatibility](compatibility.md) before changing any durable format, migration, process contract, or operation registry.

## Current user-visible behavior

| Area | Current behavior |
| --- | --- |
| Editor | Electron hydrates and autosaves the current BlockNote document. |
| Writing partner | The agent starts stopped on every app launch. A persistent control starts or immediately stops autonomous work. Electron receives committed suggestions from the Pi agent. |
| Edit suggestions | Edits target an exact source range in a persisted BlockNote block, can preview the source location, and can be accepted when that range still matches. |
| Notes and diagrams | Notes surface reference guidance; diagrams render Mermaid. They are references, not accepted into the draft. |
| Pins | A suggestion can be frozen into the Pins section. On desktop it can then be placed, moved, resized, stacked, and returned. |
| Responsive layout | Below `80rem`, navigation and writing partner use modal drawers. At `80rem` and above they become independently collapsible, resizable columns. |
| Persistence | Electron restores the document, sources, suggestion inbox, pins, workspace cards, and Pi session. |
| Sources | Electron imports complete UTF-8 `.md` and `.markdown` files through **Upload Sources** into the managed project workspace. |
| Static controls | Navigation destinations, document tabs, New Document, history, export, share, and overflow actions have no application behavior yet. |

## Repository map

```text
.
├── docs/                         Authored developer documentation and docs build script
├── docs/assets/                  Static assets copied into generated documentation
├── src/
│   ├── contracts/                Cross-process schemas, operations, and bridge types
│   ├── domain/                   Runtime-neutral product policy shared across runtimes
│   ├── main/                     Electron main-process composition, IPC, and diagnostics
│   ├── preload/                  Isolated preload bridge entry and exposed API
│   ├── renderer/                 React application, features, UI primitives, and browser adapters
│   ├── test/                     Cross-runtime test harness support
│   └── utility/                  Storage and agent utility-process implementations
├── artifacts/                    Historical standalone review artifacts; not runtime source
├── index.html                    Vite HTML shell and Google Font loading
├── vite.config.ts                Vite, React, Tailwind, and Vitest configuration
├── eslint.config.js              TypeScript and React lint rules
└── package.json                  Dependencies and developer commands
```

## Terms used in the code

- **Suggestion projection**: the durable, rebuildable inbox/pin/workspace state committed by storage.
- **Inbox entry**: a live suggestion; stale and withdrawn flags are renderer-only presentation state.
- **Pinned entry**: a deep-copied, stable suggestion snapshot removed from the live inbox queue.
- **Workspace pin**: a pinned suggestion moved onto the desktop editor canvas with geometry and stacking state.
- **Preview**: a temporary, editable custom BlockNote block created from a text suggestion. Only one preview may be active.

## Important implementation constraints

- [`App.tsx`](../src/renderer/app/App.tsx) is the renderer layout composition root. [`useWorkspaceController`](../src/renderer/features/workspace/useWorkspaceController.ts) connects the Electron bridge, hydration, autosave, previews, agent runtime, and suggestion controller.
- [`transitions.ts`](../src/domain/suggestions/transitions.ts) is the source of truth for durable suggestion lifecycle rules in both renderer and storage.
- [`useSuggestionController`](../src/renderer/features/suggestions/useSuggestionController.ts) owns command serialization, authoritative event reconciliation, selection, and preview presentation state.
- The app assumes a browser DOM. `window`, `document`, `localStorage`, media queries, `ResizeObserver`, and pointer capture are used directly.
