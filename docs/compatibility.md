# Durable-format and process compatibility

Scribe versions each durable JSON format independently from SQLite and requires exact compatibility between packaged processes. The executable registry is `desktop/compatibility.ts`; this document is the release and recovery policy.

## Supported versions

| Boundary | Format/protocol name | Current | Minimum readable | Minimum migratable | Newer-version behaviour |
| --- | --- | ---: | ---: | ---: | --- |
| SQLite | `scribe.sqlite` | 5 | 2 | 2 | Open only for inspection, reject startup, preserve the file. |
| Block document | `scribe.blocks` | 1 | 0 | 0 | Preserve and quarantine; do not overwrite; document hydration is unavailable. |
| Suggestion command result | `scribe.suggestion-command-result` | 1 | 0 | 0 | Preserve and quarantine; reject the command lookup. |
| Suggestion event | `scribe.event` | 1 | 0 | 0 | Preserve and quarantine; stop projection at that sequence. Later events are not applied. |
| Suggestion projection | `scribe.suggestion-projection` | 1 | 0 | 0 | Preserve and quarantine; suggestion hydration is unavailable. |
| Pi loop entry | `scribe.pi.loop-state` | 1 | 0 | 0 | Preserve the Pi session and disable autonomous resume. |
| Storage process | `scribe.storage` | 1 | 1 | 1 | Reject readiness before any request. |
| Agent process | `scribe.agent` | 1 | 1 | 1 | Reject readiness before any request. |

Version 0 means the legacy unwrapped JSON shipped before explicit envelopes. Successful reads validate and upgrade it once. Current writes use named envelopes; document blocks specifically use `{ format, version, blocks }`, while projections, events, and command results use named payload fields. Transforms are pure, sequential, and must provide every contiguous version edge.

## Preservation and quarantine

The `durable_json_quarantine` table records the original JSON text, format name, record identity, detected version, stable error code, and timestamp. A unique format/identity pair prevents duplicate records. Active reads never cast quarantined content into runtime state. Normal logs and errors identify the feature and record but do not include its content.

The Markdown `draft.md` mirror remains recovery material when block JSON cannot be read. An unsupported format error tells the caller which feature is unavailable, identifies the database quarantine location, and requires a newer application. Unknown Pi entries not owned by Scribe are left entirely to Pi and are not modified.

## Process readiness

Every utility-process ready message contains the protocol name, exact version, build identifier, and complete supported operation set. Main compares all four values with its own registry. A version, build, protocol-name, or operation-set mismatch fails readiness with `PROTOCOL_VERSION_MISMATCH`; a structurally invalid ready message fails with `MALFORMED_READY_HANDSHAKE`. No RPC request is sent before this check succeeds, and arbitrary cross-version feature negotiation is not attempted.

## Release checklist

Before every release:

1. Review the SQLite schema, event payloads, BlockNote serialization, suggestion projection and command result, Pi Scribe entries, and both operation registries.
2. If a durable shape changed, increment only that format version, add a pure contiguous migration, retain all old fixture files unchanged, and add a new current fixture.
3. If an operation registry or wire contract changed, increment the protocol version and update the build identifier. Storage and agent operation sets must match their ready handshakes.
4. Test oldest, every intermediate, current, future, invalid, failed-transform, and idempotent legacy-upgrade cases. Verify future/invalid source text remains preserved exactly once.
5. Test a future event followed by a known event and confirm projection stops at the gap until snapshot recovery.
6. For a database migration, add the next contiguous `user_version` edge, a historical schema fixture, preservation tests, and backup/failure tests.
7. Run `npm test`, `npm run lint`, `npm run build`, and `npm run docs:build`.

Do not regenerate a historical fixture with a current serializer. Fixtures under `desktop/fixtures/compatibility/` are immutable after release.

## Backup and rollback

Downgrade writes are unsupported. To return to an older application after migration:

1. Close Scribe completely.
2. Preserve the newer `scribe.sqlite3` and its WAL/SHM files as a recovery copy.
3. Locate the pre-migration `.bak` beside the database and copy it into place as `scribe.sqlite3`.
4. Run the application release whose schema version matches that backup.

Never point an older application at the migrated database. Never automate rollback by deleting or rewriting the newer database.
