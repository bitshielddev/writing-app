# Extension guide

This guide identifies the existing seams for likely next steps in the Electron runtime.

## Evolve the writing-partner transport

Keep transport details behind the existing [`SuggestionFeed`](../src/suggestions/types.ts) contract. The Electron adapter receives committed events from the storage and Pi processes; the development controller injects through that same persisted path.

A production adapter must define:

- how it starts and stops when subscribers come and go;
- how server messages map to every `SuggestionEvent` variant;
- stable `id` and `dedupeKey` rules;
- reconnection and replay semantics;
- ordering of status, suggestion, and error events;
- cleanup under React `StrictMode`.

Choose or introduce adapters at the construction boundary in [`App.tsx`](../src/App.tsx). Preserve stable construction with `useMemo`, or move service creation above React if it is intentionally process-wide.

Do not call an HTTP or model SDK directly from `SuggestionDock`. That would couple view lifecycle to transport lifecycle, make replay/dedupe inconsistent, and bypass reducer tests.

### Introduce context for a real service

The current application does not publish editor or artifact context to the feed. Before introducing a network payload, decide and document:

- whether block IDs are stable across saved sessions;
- whether formatting, hierarchy, current selection, title, and metadata are required;
- whether revisions are client-local counters or server-visible concurrency tokens;
- whether whole snapshots or deltas are sent;
- source/artifact identifiers and authorization;
- maximum document size and redaction rules;
- how temporary previews and other non-accepted content are excluded.

Version the payload if a server will persist or process it independently.

## Extend persistence

The desktop runtime separates SQLite document/suggestion data, managed Markdown files, Pi-native configuration, project session JSONL, and launch-scoped activity. Preserve those ownership boundaries rather than replacing them with one opaque React-state blob.

### Document data

Document saves contain BlockNote's serializable model and `blocksToMarkdownLossy()` output. Storage atomically refreshes `draft.md` before publishing the committed revision. Preserve that ordering and startup repair path.

Temporary `suggestionPreview` blocks are excluded from the saved accepted document. If preview recovery is added later, store it as a separate draft concept.

### Suggestion data

The live inbox, pins, workspace cards, dedupe keys, and geometry are stored as a document-scoped projection. Changes to dedupe retention should be made deliberately because a dismissed item currently cannot be re-added with the same key.

Pinned entries are user-owned frozen snapshots. Preserve that distinction if live suggestions are server-backed: server updates should not mutate a saved pin.

### Workspace preferences

Column widths remain renderer-local preferences. Workspace-card geometry is stored per document and restored through the same clamp path because available canvas dimensions change.

Add new durable data through the storage-process RPC boundary. Hydrate owners at application startup and keep serialization out of display components.

## Add a suggestion kind

Adding a kind affects the discriminated union and every exhaustive presentation or behavior decision.

1. Add the literal to `SuggestionKind` and a new union member in [`types.ts`](../src/suggestions/types.ts).
2. Decide whether it is text-insertable, structural/reference-only, or requires a new action.
3. Add badge label/icon/tone and visual rendering in [`SuggestionPresentation.tsx`](../src/components/SuggestionPresentation.tsx).
4. Update `isTextSuggestion` in [`App.tsx`](../src/App.tsx) if it can preview.
5. Update detail/workspace visual conditions in [`SuggestionDock.tsx`](../src/components/SuggestionDock.tsx) and [`WorkspacePins.tsx`](../src/components/WorkspacePins.tsx).
6. Add an initial size in [`workspacePinLayout.ts`](../src/suggestions/workspacePinLayout.ts) if the default is unsuitable.
7. Ensure external data validation rejects malformed payloads before they reach the reducer.
8. Add reducer and component tests, plus Mermaid-like failure handling if rendering is asynchronous.
9. Update the kind table in [Editor and suggestion system](editor-and-suggestions.md).

The current app uses manual kind checks in several places. If kinds grow substantially, centralize behavior metadata instead of adding more scattered conditionals.

## Add a custom editor block

Register the block in [`writingSchema`](../src/editor/schema.tsx), then address all serialization boundaries:

- accepted-document plain-text extraction;
- external HTML behavior;
- save/load schema compatibility;
- focus and selection behavior;
- agent-context inclusion or exclusion;
- copy/paste and export;
- read-only rendering, if added later.

Use the schema-derived `WritingEditor`, `WritingBlock`, and `WritingPartialBlock` types rather than importing generic BlockNote types throughout the application.

If the block needs to notify application state, prefer an explicit callback/plugin boundary. The current preview block uses [`previewEvents.ts`](../src/editor/previewEvents.ts) because its renderer is registered at schema construction and is not passed `App` callbacks.

## Implement navigation and document actions

The following are static today:

- New Document;
- Library, Recent, Templates, Collections, Settings, Help, Archive;
- Drafts, Review, Published;
- history, export, share, and overflow actions.

Before wiring buttons individually, introduce the missing domain/state boundary:

- a router for URL-addressable destinations;
- a document repository and current-document identity;
- an artifact/source repository;
- command handlers for export/share/history;
- authentication and authorization if those actions become remote.

`Sidebar` and `DocumentHeader` should remain presentation components receiving current state and callbacks. Avoid placing fetches or persistence logic directly in them.

## Extend artifact upload or source retrieval

The sidebar imports complete UTF-8 Markdown files through the main/storage boundary and shows persisted sources.

That owner should distinguish:

- upload state and errors;
- stable artifact identity;
- display metadata;
- UTF-8 validation state;
- content availability to the agent;
- deletion and access-control behavior.

Pi reads the copied files through its confined read-only tools. Keep file content out of React component props and never add a mutation tool without revisiting the read-only workspace contract.

## Evolve the inbox reducer safely

Use a new reducer action for a new user intent. Avoid mutating arrays in components or exposing raw `dispatch` outside the hook.

For every transition, consider:

- live, pinned, and workspace copies;
- selected detail;
- active preview;
- viewed/unread counts;
- stale and withdrawn flags;
- 30-item eviction;
- dedupe history;
- z-order and geometry where relevant.

Add a pure reducer test before changing component wiring. This makes subtle cross-state behavior visible without needing BlockNote or layout.

## Validate external suggestion data

TypeScript types do not validate network input. A production feed should parse runtime payloads before emitting them. Validation should cover:

- known event and suggestion kinds;
- non-empty identity/dedupe fields;
- timestamps and source-label arrays;
- kind-specific fields (`insertText`, `nodes`, Mermaid source, description);
- recursive node depth and total payload size;
- Mermaid/source text safety constraints.

Malformed events should become a controlled `agent.error` or telemetry event, not an exception during React rendering.

## Introduce routing or server rendering

The current code reads browser globals during state initialization and event handling. Server rendering would require guards or client-only boundaries for:

- `window.localStorage` and `window.matchMedia` in `App`;
- `document` queries and animation frames;
- BlockNote and Mermaid browser behavior;
- `ResizeObserver` and pointer APIs.

Routing is simpler but still needs document identity and cleanup rules. Confirm that switching documents disposes the old feed subscription, resets or restores inbox state, loads the correct editor content, and scopes saved workspace geometry.

## Performance watch points

The current data volume is intentionally small. Revisit these choices as it grows:

- suggestion deep copy uses JSON serialization;
- workspace geometry commits update the whole reducer state;
- large Mermaid diagrams render client-side and inject full SVG;
- every suggestion entry is rendered; there is no list virtualization beyond the 30-item cap.

Measure before optimizing, but keep service and reducer boundaries intact so improvements remain local.

## Documentation update triggers

Update this section when a change affects any of the following:

- setup, Node support, scripts, or environment variables;
- service or data contracts;
- state ownership or persistence;
- suggestion lifecycle invariants;
- editor schema and preview rules;
- responsive breakpoints or input behavior;
- functional versus presentation-only controls;
- testing commands or coverage boundaries.
