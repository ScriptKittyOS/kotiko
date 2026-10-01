# 07 · Word model v2

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [02-test-harness-and-ci](../02-test-harness-and-ci/SPEC.md) |
| **Unblocks** | [08](../08-language-tags/SPEC.md), [09](../09-shared-word-spec-and-prompt/SPEC.md), [11](../11-local-first-mode/SPEC.md), [12](../12-export-import-and-delete/SPEC.md), [13](../13-bulk-add/SPEC.md), [21](../21-dashboard/SPEC.md), [24](../24-add-flow-safety/SPEC.md), [36](../36-grammar-and-senses/SPEC.md), [39](../39-multi-device-sync/SPEC.md), [41](../41-telegram-improvements/SPEC.md), [46](../46-local-stats-and-recap/SPEC.md), [48](../48-multi-user-and-classroom/SPEC.md) |
| **Sources** | [06 F05, F06, F27, F29](../../docs/research/06-adversarial-qa.md); [02 C1, C6, D3, D6, G4, section 3](../../docs/research/02-linguistics.md); [04 S2, S4, S8, S15, S22](../../docs/research/04-architecture-release.md); [05 S7, S12, S21](../../docs/research/05-learner-ux.md) |

## Problem

A word is the unit everything else in Mira is built on, and today's record can't carry
the weight.

- **Re-adding a word you already have destroys it.** `Words.upsert/2` looks the row up by
  `(lang, native)` and runs the full changeset over it (`server/lib/slovo/words.ex:61-68`).
  The changeset casts with `empty_values: [nil]` (`server/lib/slovo/word.ex:25`), so a
  model answer with `note: null` wipes the learner's note and replaces the forms. The
  router then reports the row as newly added (`server/lib/slovo/router.ex:40-49`), the
  popup says "Added", and its Undo deletes the original. Reproduced in [06 F05](../../docs/research/06-adversarial-qa.md).
- **Two adds of the same word at once crash.** Read-then-insert without a transaction
  raises `Ecto.ConstraintError` on the unique index (`words.ex:64-66`,
  `server/priv/repo/migrations/20261001000000_create_words.exs:21`): 7 of 8 parallel
  upserts failed and one HTTP request returned 500. Reproduced in [06 F06](../../docs/research/06-adversarial-qa.md).
- **IDs only work on one server.** Integer autoincrement ids (`migrations/...create_words.exs:5`)
  collide as soon as words are created in the extension (slice 11), by imports (slice 12)
  or from packs (slice 23).
- **Deletes leave no trace.** `Words.delete/1` removes the row (`words.ex:86`), so a second
  device can't learn that a word is gone, and Undo can't restore it.
- **Nothing can be edited.** The router has GET, POST and DELETE only
  (`router.ex:18-68`); fixing a romanization means delete and re-add ([02 G4](../../docs/research/02-linguistics.md), [05 S12](../../docs/research/05-learner-ux.md)).
- **Text isn't normalised.** `clean/1` only trims (`server/lib/slovo/llm.ex:226`), so an
  NFD "phở" and an NFC "phở" are two different words ([02 D6](../../docs/research/02-linguistics.md)).
- **Homographs overwrite each other.** `(lang, native)` is unique, so замок (castle) and
  замок (lock) can't both exist ([02 D3](../../docs/research/02-linguistics.md)).
- **Forms are a newline-joined string** (`word.ex:11`, `word.ex:32-37`) with no room for
  per-form switches or case rules ([02 C1, C6](../../docs/research/02-linguistics.md)).
- **Small edges:** a huge id in `DELETE /api/words/:id` returns 500 ([06 F27](../../docs/research/06-adversarial-qa.md),
  `router.ex:62`), and an empty language name sticks forever ([06 F29](../../docs/research/06-adversarial-qa.md), `words.ex:72-82`).

All of this is read from the code; F05, F06, F27 and F29 were reproduced by research 06.

## Goals

- One word record, defined once, used identically by the server and the extension's local
  store (slice 11), exports (slice 12), packs (slice 23) and sync (slice 39).
- Stable client-creatable ids, timestamps and tombstones, so words can move between
  devices and deletes can be undone and synced.
- Re-adding a word never loses data, and every add reports `created`, `updated` or
  `unchanged` per word.
- Concurrent writes of the same word produce one row and no errors.
- Every field can be edited through a versioned API.
- The existing database migrates with no data loss, after an automatic backup.

## Non-goals

- Canonical language tags and language names: slice [08](../08-language-tags/SPEC.md).
- Field length caps, the prompt and model-output validation: slice [09](../09-shared-word-spec-and-prompt/SPEC.md).
  This slice defines the fields; slice 09 owns the numbers in `spec/rules.json`.
- Grammar fields (part of speech, article, gender, reading, vocalised form, IPA) and the
  UI for senses: slice [36](../36-grammar-and-senses/SPEC.md). This slice reserves the
  names and puts `sense` in the key so slice 36 needs no key migration.
- Delta sync, ETags and conflict resolution between devices: slice [39](../39-multi-device-sync/SPEC.md).
  This slice provides `seq`, `updated_at` and tombstones.
- The popup's wording for created/updated/unchanged and Undo: slice [24](../24-add-flow-safety/SPEC.md).
- Export and delete-all endpoints: slice [12](../12-export-import-and-delete/SPEC.md).

## User stories

- As a learner who wrote a mnemonic in a word's note, I want re-adding that word to keep
  my note, so that I never lose my own work by accident.
- As a learner who added a word twice by mistake, I want Mira to tell me it was already
  there, and Undo to do nothing harmful.
- As a learner who sees a wrong romanization, I want to fix just that field.
- As a learner on two devices, I want a word I delete on one to disappear on the other.
- As a learner of Russian, I want замок (castle) and замок (lock) to be two words.
- As a contributor writing the local store, I want one schema file to validate against.

## Specification

### 1. The word record (wire format, schema version 2)

JSON, `snake_case`, UTF-8. The JSON Schema lives at `spec/word.schema.json` (slice 09
owns the file and the caps; the fields below are normative).

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | string | yes | UUID, lowercase, hyphenated. New ids are UUIDv7 (RFC 9562), created by whichever side creates the word. Any valid UUID is accepted from clients. Immutable. |
| `lang` | string | yes | Canonical tag per slice 08. Part of the natural key. |
| `native` | string | yes | The word in its own script, NFC, trimmed, internal whitespace collapsed, no control characters or newlines. |
| `sense` | string | yes, default `""` | Short lowercase English gloss that tells homographs apart ("castle", "lock"). Empty for most words. Part of the natural key. |
| `romanization` | string or null | no | NFC. |
| `english` | string | yes | The headword meaning. Lowercase unless always capitalised in English (slice 09). |
| `forms` | array of Form | yes, at least 1 | See below. Unique by `text` compared case-insensitively. |
| `note` | string or null | no | One short sentence. |
| `status` | string | yes | `active` (swapped on pages), `paused` (kept, not swapped), `pending` (a Telegram lookup awaiting Add; server-local, never synced). |
| `origin` | string | yes | `add`, `manual`, `telegram`, `bulk`, `import`, `pack`, `assignment`, `migrated`. Informational. |
| `pack_id` | string or null | no | Set for words that came from a pack (slice 23/47), so a pack can be removed as a unit. |
| `source_text` | string or null | no | What the user typed, for "why is this here". Never sent to the model again. |
| `created_at` | string | yes | RFC 3339 UTC with milliseconds, e.g. `2026-10-01T21:23:47.123Z`. |
| `updated_at` | string | yes | Same format. Set by the writer on every change. |
| `deleted_at` | string or null | yes | Null for live words. Set means tombstone. |
| `merged_into` | string or null | no | Only on tombstones: the id of the live word this one was merged into (duplicates found by the migration below, or by slice 39's sync). Clients move references (stats, pack membership) to that id. |
| `language` | string | output only | English display name derived from `lang` (slice 08). Ignored on input. |

**Form** object: `{text, enabled, case, ambiguous}`.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `text` | string | required | An English surface form to replace ("house", "houses", "ice cream"). NFC, trimmed. |
| `enabled` | boolean | `true` | Disabled forms are kept (so a re-add doesn't bring them back) but never matched. |
| `case` | string | `"any"` | `any`, `lower` (skip capitalised matches mid-sentence: will, may), `exact` (US), `proper` (Japan, Monday). Interpreted by slices 14 and 16. |
| `ambiguous` | boolean | `false` | The model or the user flagged the form as also being another word ("saw", "glasses"). Slice 16 and 36 decide the default treatment. |

**Reserved names** for slice 36, which no other slice may use for anything else: `pos`,
`article`, `article_indefinite`, `gender`, `plural`, `inflections`, `reading`,
`native_vocalized`, `ipa`, `alternatives`, `verified`, `confidence`, `source_reading`,
and `pos` on Form objects (a per-form part of speech). Slice 35 may add `status` values (for example
`well_known`); readers that don't know a status must keep the word and treat it as not
swapped.

**Forward compatibility.** `word.schema.json` allows additional properties. Readers ignore
fields they don't know. The server stores only the fields above; the extension's local
store (slice 11) keeps unknown fields it receives so a newer server's data survives a
round trip through an older extension.

### 2. Natural key and `native_key`

A live word is identified by `(lang, native_key, sense)`.

`native_key(native)` = `NFC(native)`, then Unicode default lowercase (not locale-specific),
then replace final sigma `ς` with `σ`. The last step exists because JavaScript's
`toLowerCase()` produces `ς` at the end of a word and Elixir's `String.downcase/1` does
not (checked in Node 22 and Elixir 1.19: "ΣΑΣ" gives "σας" and "σασ"). Both
implementations must pass `spec/fixtures/native-key.json` (slice 09), which includes
Greek, Turkish İ, German ß, Cyrillic, Armenian, Georgian, and caseless scripts.

Case-insensitive keys mean "Hund" and "hund" in German are the same word, and the stored
`native` keeps whichever capitalisation was saved first (a later edit can change it).

### 3. Database schema (SQLite)

```
words
  id            INTEGER PRIMARY KEY     -- internal row id; legacy API and Telegram only
  uuid          TEXT NOT NULL UNIQUE    -- the public id
  lang          TEXT NOT NULL
  native        TEXT NOT NULL
  native_key    TEXT NOT NULL
  sense         TEXT NOT NULL DEFAULT ''
  romanization  TEXT
  english       TEXT NOT NULL
  forms         TEXT NOT NULL DEFAULT '[]'   -- JSON array of Form
  note          TEXT
  status        TEXT NOT NULL DEFAULT 'active'
  origin        TEXT NOT NULL DEFAULT 'add'
  pack_id       TEXT
  source_text   TEXT
  language      TEXT                    -- deprecated; slice 08 drops it
  created_at    TEXT NOT NULL           -- utc_datetime_usec
  updated_at    TEXT NOT NULL
  deleted_at    TEXT
  merged_into   TEXT                    -- uuid of the surviving word, on merge tombstones
  seq           INTEGER NOT NULL        -- change sequence, see below

UNIQUE INDEX words_natural ON words(lang, native_key, sense) WHERE deleted_at IS NULL
INDEX words_seq ON words(seq)
INDEX words_status ON words(status)
INDEX words_pack ON words(pack_id)

sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), last_seq INTEGER NOT NULL,
            purged_through_seq INTEGER NOT NULL DEFAULT 0,
            reset_epoch INTEGER NOT NULL DEFAULT 0)   -- bumped by slice 12's delete-all

add_requests (client_request_id TEXT PRIMARY KEY, response TEXT NOT NULL,
              inserted_at TEXT NOT NULL)
```

- The unique index is **partial**, so tombstones never block re-adding a word. A word
  re-added after deletion is a new row with a new `uuid`.
- `seq` is taken from `sync_state.last_seq + 1` in the same transaction as every insert,
  update, tombstone or restore. It never decreases and is never reused, even when old
  tombstones are purged, so slice 39 can use it as a cursor. (`MAX(seq) + 1` is not
  enough: purging the newest tombstone would let a number be reused.)
- The repo is configured with `default_transaction_mode: :immediate` (supported by the
  bundled exqlite, `deps/exqlite/lib/exqlite/connection.ex:99`), so every write
  transaction takes the write lock before it reads. Read-merge-write is then serialised
  and F06 can't happen. The unique index stays as a backstop: a constraint error inside
  `Words.save/2` retries once as a merge, and never surfaces as a 500.
- `Mira.Word` uses `@primary_key {:id, :id, autogenerate: true}` plus a `uuid` field, and
  `timestamps(inserted_at: :created_at, type: :utc_datetime_usec)`.

### 4. Writes and merge rules

All writes go through one module, `Mira.Words`, with these functions. Each runs in one
immediate transaction, bumps `seq`, and returns `{:ok, result}` or `{:error, reason}`;
none raises on bad input.

**`add(attrs, opts)`**, used by the add box, Telegram "add", bulk add and imports.
`attrs` is a validated word (slice 09). Looks up the live row by natural key:

1. **No live row** → insert with a new UUIDv7 (or the client's `id` if given and unused),
   `created_at = updated_at = now`. Result `created`.
2. **Live row exists** → merge, field by field:

| Field | Rule |
|---|---|
| `romanization`, `note`, `pack_id`, `source_text` | Fill only if the existing value is null or blank. Never overwrite. |
| `english` | Keep the existing value. If the incoming one differs, its text is added as a form (below). |
| `forms` | Union by case-insensitive `text`. Existing forms keep their flags, including `enabled: false`. New forms are appended with the flags they came with. Result is re-capped (slice 09); existing forms win over new ones when the cap is hit. |
| `status` | `pending` → incoming status. `paused` → `active` when the add is an explicit user add (`opts[:explicit]`, true for the add box and Telegram "add"), else unchanged. `active` stays. |
| `origin`, `created_at`, `id` | Never change. |

   If no field changed, the row is not written and `seq` is not bumped. Result `unchanged`.
   Otherwise result `updated`, with `previous` (the full word before the merge) so Undo
   can restore it exactly (slice 24).

**`update(id, patch, opts)`**, used by edits. Explicit edits overwrite: every field
present in `patch` is set, `null` clears a nullable field, `forms` replaces the whole
list. Changing `lang`, `native` or `sense` re-checks the natural key; a clash with another
live word returns `{:error, {:conflict, other_id}}`. `opts[:if_updated_at]` gives
optimistic concurrency: a mismatch returns `{:error, :stale}`.

**`delete(id)`** sets `deleted_at = updated_at = now`. Content stays on the tombstone, so
**`restore(id)`** can clear `deleted_at` if no live word now holds the same natural key
(else `{:error, {:conflict, other_id}}`).

**Tombstone lifecycle**, run once a day by a new `Mira.Janitor` process (a GenServer with
a 24-hour timer and a first run 5 minutes after boot; slices 10 and 41 add their own
cleanup jobs to it):

- After 30 days, a tombstone's content is scrubbed: `native`, `romanization`, `english`,
  `note`, `source_text` and `forms` are cleared; `native_key` becomes the `uuid` (to stay
  unique and meaningless). `id`, `lang`, timestamps and `seq` remain. Restore is no longer
  possible.
- After 180 days the row is removed. `sync_state` records `purged_through_seq` so slice 39
  can tell a client whose cursor is older than that to do a full resync.
- `add_requests` rows older than 24 hours are deleted.
- Delete-all (slice 12) removes rows immediately and records a reset marker; it does not
  wait for these windows.

**Idempotent adds.** `POST /api/v1/words` accepts `client_request_id` (a UUID). The first
response for an id is stored in `add_requests` for 24 hours; a repeat returns the stored
response with no model call and no write. Slice 24 owns the client side.

### 5. API v1

All routes live under `/api/v1` and need the bearer token (slice 01). Errors use one
shape, `{"error": {"code": "...", "message": "...", "details": {...}}}` with slice 25's
codes (`word_conflict`, `word_gone`, and the lookup codes from slice 10); slice 25 owns
the wording.

| Route | Does |
|---|---|
| `GET /api/v1/words` | Live words. Query: `lang=ru,ar`, `status=active,paused` (default `active,paused`; `pending` is never returned), `limit` (default and max 20,000). Response `{"words": [Word], "cursor": "<last_seq>"}`. Slice 39 adds `since` and ETags on this route. |
| `GET /api/v1/words/:id` | One word, including a tombstone (so a client can see it was deleted). 404 `word_gone` for a malformed or unknown id. |
| `POST /api/v1/words` | Add. Body is either `{"text": "...", "client_request_id": "...", "hint_lang": "es"?}` (interpreted by the model, slices 09 and 10; `hint_lang` is slice 09's page or chip language hint) or `{"word": {...}, "client_request_id": "..."}` (structured, no model). Response `{"results": [{"result": "created" \| "updated" \| "unchanged", "word": Word, "previous": Word?}], "rejected": [...], "reply": "..."?}`. `rejected` and `reply` are defined by slice 09. |
| `POST /api/v1/words/batch` | Structured adds, up to 500 per call, one transaction. Same `results` shape, in input order. Used by slices 12 and 13. This route alone accepts bodies up to 1 MB (its own `Plug.Parsers` limit, still after auth); every other route keeps 64 KB. |
| `PATCH /api/v1/words/:id` | Partial update (section 4). Optional `if_updated_at` in the body (or the equivalent header `If-Match: "<updated_at>"`); a mismatch is 409 `word_conflict` with `details.reason: "stale"` and the current word. A natural-key clash is 409 `word_conflict` with `details.reason: "duplicate"` and `details.other_id`. |
| `DELETE /api/v1/words/:id` | Tombstone. Returns `{"word": Word}` with `deleted_at` set. Deleting a tombstone is a no-op 200. |
| `POST /api/v1/words/:id/restore` | Undo a delete. 409 `word_conflict` (`reason: "duplicate"`) if a live word took the key; 410 `word_gone` if scrubbed. |

**Ids in paths** must match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`;
anything else is 404 before touching the database (fixes F27 for v1).

**Legacy routes** stay for one minor version so a 0.2 extension keeps working against a
new server:

- `GET /api/words` returns today's shape: integer `id`, `lang`, `language`, `native`,
  `romanization`, `english`, `forms` as a list of strings (enabled forms only), `note`;
  active words only, newest first.
- `POST /api/words` uses `add/2` with merging. `words` contains only `created` words; if
  any were `updated` or `unchanged`, `reply` says "Already in your list: спасибо". The
  0.2 popup shows `reply` when `words` is empty (`extension/popup.js:148-150`), so a
  repeated add no longer offers a destructive Undo. It honours `client_request_id` the
  same way as the v1 route.
- `DELETE /api/words/:id` accepts `^\d{1,18}$` only (else 404, fixing F27) and tombstones.

### 6. Migration of an existing database

A single Ecto migration, `20261015000000_word_model_v2.exs`, with an explicit `up/0`
(no automatic `down`; the backup is the rollback). Before any pending migration runs, the
server copies the database with `VACUUM INTO '<data_dir>/backups/mira-pre-<version>-<UTC timestamp>.db'`
and keeps the newest five (slice 29 runs migrations before the HTTP server starts; slice
40 documents restore). Steps, in one transaction:

1. Rename `inserted_at` to `created_at`. Rewrite `created_at` and `updated_at` from
   today's naive `YYYY-MM-DDTHH:MM:SS` text to `YYYY-MM-DDTHH:MM:SS.000000Z`.
2. Add the new columns. Backfill `uuid` with a UUIDv7 whose timestamp is the row's
   `created_at`, so ids sort in creation order. UUIDv7 comes from a 30-line `Mira.UUID7`
   module (no new dependency), tested against the RFC 9562 layout.
3. NFC-normalise and trim `native`, `romanization`, `english`, `note`; compute
   `native_key`; set `sense = ''`, `origin = 'migrated'`, `deleted_at = NULL`.
4. Convert `english_forms` to `forms`: split on newlines, add `english` if missing (the
   same union `Word.forms/1` does today, `word.ex:32-37`), dedupe case-insensitively,
   wrap as `{"text": t, "enabled": true, "case": "any", "ambiguous": false}`. Then drop
   `english_forms`.
5. Find rows that now share `(lang, native_key, '')` (NFD/NFC or case duplicates, which
   the old index allowed). Keep the oldest, merge the others into it with section 4's
   rules, tombstone them with `merged_into` set to the survivor. Log the count.
6. Set `language = NULL` where it is blank (F29). Slice 08 handles the rest.
7. Assign `seq` in `created_at` order; create `sync_state` with the max.
8. Drop the old `(lang, native)` unique index; create the indexes in section 3.

The migration is tested against a fixture copy of a 0.2 database with NFD duplicates,
blank language names, empty forms and pending rows.

## Acceptance criteria

- [ ] Re-adding a word whose model answer has null note and romanization keeps both and
      returns `unchanged` (or `updated` with `previous` if new forms were added).
- [ ] 20 concurrent `Words.add/2` calls for the same `(ja, 犬)` produce one live row, 0
      exceptions, one `created` and 19 `unchanged`/`updated`.
- [ ] 6 concurrent `POST /api/v1/words` with the same text return 200 each; none is 500.
- [ ] A repeated `client_request_id` returns the identical body and makes no model call.
- [ ] `PATCH` changes only the fields given; an old `if_updated_at` returns 409 `word_conflict` with the current word.
- [ ] Changing `lang` onto an existing live word's key returns 409 with `other_id`.
- [ ] `DELETE` then `restore` returns the word with the same `id` and content; `restore`
      after scrubbing returns 410.
- [ ] Re-adding a deleted word creates a new id and leaves the tombstone in place.
- [ ] `seq` strictly increases across every write, including after purging the newest tombstone.
- [ ] `DELETE /api/words/99999999999999999999999` and `GET /api/v1/words/abc` return 404, not 500.
- [ ] `native_key` gives identical output in Elixir and JavaScript for every entry in
      `spec/fixtures/native-key.json`.
- [ ] Migrating the 0.2 fixture database keeps every word, merges NFD duplicates, writes
      a backup file first, and a second boot runs no migration and makes no new backup.
- [ ] A 0.2 extension against the new server can list, add (repeat add shows "Already in
      your list") and undo.

## Test plan

- **ExUnit, `Mira.WordsTest`**: table-driven merge cases (each field rule, form flag
  preservation, cap overflow, status transitions); concurrency test with 20 tasks against
  a file-backed test database (sandbox in shared mode, `async: false`); tombstone,
  restore, scrub and purge with a controllable clock; `seq` monotonicity.
- **ExUnit, `Mira.RouterV1Test`** (`Plug.Test`): every route, error shape, id
  validation, `if_updated_at` and `If-Match`, idempotency table, legacy routes' shapes.
- **Migration test**: copy `test/fixtures/db/slovo-0.2.db` to a temp dir, run
  migrations, assert counts, merged duplicates, forms JSON, timestamps, backup file.
- **StreamData property**: for random Unicode strings, `native_key` is idempotent and
  `native_key(NFD(s)) == native_key(NFC(s))`.
- **Shared fixtures** (slice 09's CI job): `native-key.json` and `merge.json` (input word
  pairs and expected merge result) run against Elixir and the JS store used by slice 11.

## Rollout and migration

- Ships in the server release after slice 02. The migration runs at boot after the
  automatic backup; the log names the backup file.
- The extension adopts `/api/v1` by trying `GET /api/v1/words` and falling back to the
  legacy routes on 404 (slice 11's legacy adapter). Legacy routes are removed one minor
  version later, with a changelog note.
- Changelog: "Words now have permanent ids and keep a history of deletes. Adding a word
  you already have no longer overwrites your notes; Mira tells you it's already in your
  list. Your database is backed up automatically before the upgrade."

## Open questions

1. **Should a re-add of a paused word un-pause it?** Recommendation: yes for explicit adds
   (the learner just typed it), no for bulk adds and imports.
2. **Tombstone windows (30 days restorable, 180 days kept).** Recommendation: keep these;
   they cover a long holiday offline and bound privacy exposure.
3. **Case-insensitive `native_key`.** It merges "Polska" (Poland) and "polska" (Polish,
   adjective) unless one gets a `sense`. Recommendation: accept; homographs are exactly
   what `sense` is for.

## Future work

- Per-device edit vectors instead of last-writer-wins on `updated_at`: slice 39 if
  conflicts turn out to matter.
- Word history (every past version) for a "what changed" view.
- Owner (`user_id`) on every word: slice [48](../48-multi-user-and-classroom/SPEC.md).
