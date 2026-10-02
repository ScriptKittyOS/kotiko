# 07 · Word model v2

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [02-test-harness-and-ci](../02-test-harness-and-ci/SPEC.md) |
| **Unblocks** | [08](../08-language-tags/SPEC.md), [09](../09-shared-word-spec-and-prompt/SPEC.md), [11](../11-local-first-mode/SPEC.md), [12](../12-export-import-and-delete/SPEC.md), [13](../13-bulk-add/SPEC.md), [19](../19-word-popover/SPEC.md) (pronunciation fields), [21](../21-dashboard/SPEC.md), [24](../24-add-flow-safety/SPEC.md), [34](../34-pronunciation-audio/SPEC.md), [36](../36-grammar-and-senses/SPEC.md), [39](../39-multi-device-sync/SPEC.md), [41](../41-telegram-improvements/SPEC.md), [46](../46-local-stats-and-recap/SPEC.md), [48](../48-multi-user-and-classroom/SPEC.md), [49](../49-dictionary-verification/SPEC.md), [50](../50-ui-localization-and-base-language/SPEC.md) |
| **Sources** | [DECISIONS 2026-10-02, pronunciation](../DECISIONS.md); [DECISIONS 2026-10-01, base language](../DECISIONS.md) and the record shape in [50 section 3](../50-ui-localization-and-base-language/SPEC.md#3-the-word-record-for-base-languages-decided-here-built-in-07); [06 F05, F06, F27, F29](../../docs/research/06-adversarial-qa.md); [02 C1, C6, D3, D6, G4, section 3](../../docs/research/02-linguistics.md); [04 S2, S4, S8, S15, S22](../../docs/research/04-architecture-release.md); [05 S7, S12, S21](../../docs/research/05-learner-ux.md) |

## Problem

A word is the unit everything else in Kotiko is built on, and today's record can't carry
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
  collide as soon as words are created in the extension (slice 11) or by imports
  (slice 12).
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
- **The meaning is always English.** The record has `english` and `english_forms`
  (`server/lib/slovo/word.ex:13-14`), so a learner who reads Spanish has nowhere to put
  "perro", and their Spanish pages can never be matched. The maintainer decided that
  English is not the base language ([DECISIONS](../DECISIONS.md), slice
  [50](../50-ui-localization-and-base-language/SPEC.md)).
- **Pronunciation is a guess in the wrong field.** The prompt asks for one `romanization`
  described only as "Latin pronunciation (pinyin with tone marks for Mandarin)"
  (`server/lib/slovo/llm.ex:27`, and "Put pronunciation in romanization", `llm.ex:49`). The
  model returns a spelling transliteration, inconsistently: a learner saw "pazhaluysta" for
  пожалуйста, which is said "pa-ZHAL-sta", and "spasibo" for спасибо, said "spa-SEE-ba".
  Russian spelling hides stress, the о-to-a reduction of unstressed syllables and everyday
  dropped syllables; Japanese hides readings and devoiced vowels; Arabic hides short vowels.
  Nothing says where the stress falls, and the spelling is in English conventions even for a
  Spanish reader. Reported by the maintainer ([DECISIONS 2026-10-02](../DECISIONS.md)).
- **Small edges:** a huge id in `DELETE /api/words/:id` returns 500 ([06 F27](../../docs/research/06-adversarial-qa.md),
  `router.ex:62`), and an empty language name sticks forever ([06 F29](../../docs/research/06-adversarial-qa.md), `words.ex:72-82`).

All of this is read from the code; F05, F06, F27 and F29 were reproduced by research 06.

## Goals

- One word record, defined once, used identically by the server and the extension's local
  store (slice 11), exports (slice 12) and sync (slice 39).
- Stable client-creatable ids, timestamps and tombstones, so words can move between
  devices and deletes can be undone and synced.
- Re-adding a word never loses data, and every add reports `created`, `updated` or
  `unchanged` per word.
- Concurrent writes of the same word produce one row and no errors.
- Every field can be edited through a versioned API.
- A word's meaning and its swappable forms are stored in the learner's base language
  (`gloss`, `forms`, `base_lang`), whatever that language is, with one record per base
  for learners who read several (50 section 3).
- Each record says how to say its word, for a reader of its `base_lang`: `pronunciation`
  (syllables, the stressed one in capitals, everyday form) and `pronunciation_careful`,
  separate from `romanization`, which is a named standard scheme per language (section 7).
- The existing database migrates with no data loss, after an automatic backup, and saved
  words get a pronunciation once, in the background, within the learner's free quota
  (section 8).

## Non-goals

- Canonical language tags and language names: slice [08](../08-language-tags/SPEC.md).
- Field length caps, the prompt and model-output validation: slice [09](../09-shared-word-spec-and-prompt/SPEC.md).
  This slice defines the fields; slice 09 owns the numbers in `spec/rules.json`.
- Grammar fields (part of speech, article, gender, reading, IPA) and the UI for senses:
  slice [36](../36-grammar-and-senses/SPEC.md). This slice reserves the names and puts
  `sense` in the key so slice 36 needs no key migration. One of them, `native_vocalized`,
  is stored from this slice on, because the popover (19, P0) shows the stress mark; 36 still
  owns its rules.
- The prompt text for pronunciation and the validator code: slice
  [09](../09-shared-word-spec-and-prompt/SPEC.md). This slice defines the fields, the
  romanization schemes and the respelling conventions (section 7), and proposes golden-set
  cases (section 9).
- Showing pronunciation: [19](../19-word-popover/SPEC.md); audio:
  [34](../34-pronunciation-audio/SPEC.md); checking it against dictionaries:
  [49](../49-dictionary-verification/SPEC.md).
- Delta sync, ETags and conflict resolution between devices: slice [39](../39-multi-device-sync/SPEC.md).
  This slice provides `seq`, `updated_at` and tombstones.
- The popup's wording for created/updated/unchanged and Undo: slice [24](../24-add-flow-safety/SPEC.md).
- Export and delete-all endpoints: slice [12](../12-export-import-and-delete/SPEC.md).

## User stories

- As a learner who wrote a mnemonic in a word's note, I want re-adding that word to keep
  my note, so that I never lose my own work by accident.
- As a learner who added a word twice by mistake, I want Kotiko to tell me it was already
  there, and Undo to do nothing harmful.
- As a learner who sees a wrong romanization, I want to fix just that field.
- As a learner of Russian, I want to see that пожалуйста is said "pa-ZHAL-sta", with the
  stress marked, and still type "pozhaluysta" to find it.
- As a Spanish reader learning Russian, I want the pronunciation spelled the way Spanish is
  read ("ja-ra-SHO" for хорошо), not in English conventions.
- As a learner who corrected a pronunciation by hand, I want no refresh or re-add to undo my
  correction.
- As a learner on two devices, I want a word I delete on one to disappear on the other.
- As a learner of Russian, I want замок (castle) and замок (lock) to be two words.
- As a Spanish reader, I want "perro" stored as the meaning of 犬, so that 犬 replaces
  "perro" on my pages.
- As a reader of Spanish and English, I want 犬 to carry "perro" for my Spanish pages and
  "dog" for my English pages, and to delete or pause it once for both.
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
| `base_lang` | string | yes | The base language this record is for: a base tag per slice 50 section 2 (`es`, `en`, `pt-BR`, `ja`, `zh-Hant`). Never equal to `lang` (compared as the same base, 50). Part of the natural key. |
| `sense` | string | yes, default `""` | Short lowercase gloss **in `base_lang`** that tells homographs apart ("castle" / "lock"; "castillo" / "cerradura"). Empty for most words. Part of the natural key. |
| `romanization` | string or null | no | The word in its language's standard Latin-letter scheme (section 7: pinyin with tone marks, Hepburn, Revised Romanization, Kotiko's simplified BGN/PCGN for Russian), for typing and search. Never carries stress or reduced vowels. Null for Latin-script languages. NFC. Target side: the same on every record of a group (below). |
| `native_vocalized` | string or null | no | `native` with stress or vowel marks: Russian, Ukrainian and Belarusian stress as U+0301 (пожа́луйста), Arabic harakat, Hebrew niqqud. Rules are slice 36's; stored from this slice on because the popover shows the stress mark. Target side. |
| `gloss` | string | yes | The headword meaning in `base_lang` ("dog", "perro", "犬"). Lowercase unless that base language always capitalises it (German nouns: `Hund`; English: `Monday`; slice 09 and `spec/lang/<base>/casing.json`). Replaces v1's `english`. |
| `forms` | array of Form | yes, at least 1 | Surface forms **in `base_lang`** that get swapped. See below. Unique by `text` compared case-insensitively with the base's locale. |
| `pronunciation` | string or null | no | How to say `native`, respelled for a reader of `base_lang` (section 7): syllables joined by hyphens, the stressed syllable in capitals, the everyday form ("pa-ZHAL-sta" for base `en`; "ja-ra-SHO" for хорошо, base `es`). **Base side**: differs per record of a group. Null when the base has no respelling key. |
| `pronunciation_careful` | string or null | no | The same word said slowly and clearly ("pa-ZHA-lu-sta"). Null when it equals `pronunciation`, which is most words. Base side. |
| `pronunciation_source` | string or null | no | Who wrote the two pronunciation fields: `model` or `user` (typed, edited, or imported from the learner's own file). Null when `pronunciation` is null. Decides whether the popover says "AI-generated" (19) and whether anything may replace them (section 4). |
| `note` | string or null | no | One short sentence, in `base_lang`. |
| `status` | string | yes | `active` (swapped on pages), `paused` (kept, not swapped), `pending` (a Telegram lookup awaiting Add; server-local, never synced). |
| `origin` | string | yes | `add`, `manual`, `telegram`, `bulk`, `import`, `migrated`. Informational. Each is a learner's own action (or, for `migrated`, words they already had); nothing creates words on the learner's behalf ([DECISIONS](../DECISIONS.md)). |
| `source_text` | string or null | no | What the user typed, for "why is this here". Never sent to the model again. |
| `created_at` | string | yes | RFC 3339 UTC with milliseconds, e.g. `2026-10-01T21:23:47.123Z`. |
| `updated_at` | string | yes | Same format. Set by the writer on every change. |
| `deleted_at` | string or null | yes | Null for live words. Set means tombstone. |
| `merged_into` | string or null | no | Only on tombstones: the id of the live word this one was merged into (duplicates found by the migration below, or by slice 39's sync). Clients move references (stats) to that id. |
| `language` | string | output only | The endonym of `lang` (its name in itself: "日本語", "español"), derived by slice 08. Ignored on input. Clients show names from `Intl.DisplayNames` in the interface language instead (50). |

**Form** object: `{text, enabled, case, ambiguous}`.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `text` | string | required | A surface form in `base_lang` to replace: "house", "houses", "ice cream" (base `en`); "casa", "casas", "helado de crema" (base `es`); "家" (base `ja`). NFC, trimmed. |
| `enabled` | boolean | `true` | Disabled forms are kept (so a re-add doesn't bring them back) but never matched. |
| `case` | string | `"any"` | `any`, `lower` (skip capitalised matches mid-sentence: en will, may; es Sol the newspaper vs sol), `exact` (US, EE. UU.), `proper` (Japan, Monday; Japón). Interpreted by slices 14, 16 and 17 with the base's casing rules. |
| `ambiguous` | boolean | `false` | The model or the user flagged the form as also being another word in the base language (en "saw", "glasses"; es "vino" wine / came, "sal" salt / go out). Slice 16 and 36 decide the default treatment. |

**Reserved names** for slice 36, which no other slice may use for anything else: `pos`,
`article`, `article_indefinite`, `gender`, `plural`, `inflections`, `reading`,
`ipa`, `alternatives`, `verified`, `confidence`, `source_reading`,
and `pos` on Form objects (a per-form part of speech). `native_vocalized` is 36's too,
already stored above. `verification` is slice 49's. Slice 35 may add `status` values (for example
`well_known`); readers that don't know a status must keep the word and treat it as not
swapped.

**Groups.** Records that share `(lang, native_key)` are one **group**: the same target word
for each of the learner's bases (and each sense). The server stores and syncs records
individually; groups are a client concept. The dashboard (21) and popover (19) show a group
as one word with its glosses, and pause, delete, restore and review (35) the whole group
by default, by issuing one call per record (or a batch). Target-side fields (`lang`,
`native`, `romanization`, `native_vocalized`, and slice 36's target grammar) are copied to
every live record of the group with the same `sense` mapping when one is edited from the
dashboard, with a "Only this meaning" option. The pronunciation fields are base side and
are never copied: a bilingual reader's 犬 has an English respelling on its `en` record and a
Spanish one on its `es` record.

**Forward compatibility.** `word.schema.json` allows additional properties. Readers ignore
fields they don't know. The server stores only the fields above; the extension's local
store (slice 11) keeps unknown fields it receives so a newer server's data survives a
round trip through an older extension.

### 2. Natural key and `native_key`

A live word is identified by `(lang, native_key, sense, base_lang)`. A bilingual
learner's 犬 is two live words, `(ja, 犬, "", es)` and `(ja, 犬, "", en)`; a Spanish
reader's English word "dog" is `(en, dog, "", es)`.

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
  id                     INTEGER PRIMARY KEY     -- internal row id; legacy API and Telegram only
  uuid                   TEXT NOT NULL UNIQUE    -- the public id
  lang                   TEXT NOT NULL
  native                 TEXT NOT NULL
  native_key             TEXT NOT NULL
  sense                  TEXT NOT NULL DEFAULT ''
  base_lang              TEXT NOT NULL
  romanization           TEXT
  native_vocalized       TEXT
  pronunciation          TEXT
  pronunciation_careful  TEXT
  pronunciation_source   TEXT                    -- 'model' or 'user'; NULL with no pronunciation
  gloss                  TEXT NOT NULL
  forms                  TEXT NOT NULL DEFAULT '[]'   -- JSON array of Form
  note                   TEXT
  status                 TEXT NOT NULL DEFAULT 'active'
  origin                 TEXT NOT NULL DEFAULT 'add'
  source_text            TEXT
  language               TEXT                    -- deprecated; slice 08 drops it
  created_at             TEXT NOT NULL           -- utc_datetime_usec
  updated_at             TEXT NOT NULL
  deleted_at             TEXT
  merged_into            TEXT                    -- uuid of the surviving word, on merge tombstones
  seq                    INTEGER NOT NULL        -- change sequence, see below

UNIQUE INDEX words_natural ON words(lang, native_key, sense, base_lang) WHERE deleted_at IS NULL
INDEX words_group ON words(lang, native_key)
INDEX words_seq ON words(seq)
INDEX words_status ON words(status)

sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), last_seq INTEGER NOT NULL,
            purged_through_seq INTEGER NOT NULL DEFAULT 0,
            reset_epoch INTEGER NOT NULL DEFAULT 0)   -- bumped by slice 12's delete-all

add_requests (client_request_id TEXT PRIMARY KEY, response TEXT NOT NULL,
              inserted_at TEXT NOT NULL)

maintenance_jobs (name TEXT PRIMARY KEY, state TEXT NOT NULL, done INTEGER NOT NULL,
                  total INTEGER NOT NULL, attempts TEXT NOT NULL DEFAULT '{}',
                  retry_at TEXT, finished_at TEXT)   -- section 8
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
- `Kotiko.Word` uses `@primary_key {:id, :id, autogenerate: true}` plus a `uuid` field, and
  `timestamps(inserted_at: :created_at, type: :utc_datetime_usec)`.

### 4. Writes and merge rules

All writes go through one module, `Kotiko.Words`, with these functions. Each runs in one
immediate transaction, bumps `seq`, and returns `{:ok, result}` or `{:error, reason}`;
none raises on bad input.

**`add(attrs, opts)`**, used by the add box, Telegram "add", bulk add and imports.
`attrs` is a validated word (slice 09). Looks up the live row by natural key:

1. **No live row** → insert with a new UUIDv7 (or the client's `id` if given and unused),
   `created_at = updated_at = now`. Result `created`.
2. **Live row exists** → merge, field by field:

| Field | Rule |
|---|---|
| `romanization`, `native_vocalized`, `note`, `source_text` | Fill only if the existing value is null or blank. Never overwrite. |
| `pronunciation`, `pronunciation_careful`, `pronunciation_source` | Taken together from the incoming word only if the existing `pronunciation` is null or blank, so a re-add refreshes an empty pronunciation. Never overwritten otherwise, so a learner's edit (`pronunciation_source: "user"`) always survives, and an everyday form from one answer is never paired with a careful form from another. |
| `gloss` | Keep the existing value. If the incoming one differs, its text is added as a form (below). Records for different bases never merge with each other: `base_lang` is in the key. |
| `forms` | Union by case-insensitive `text`. Existing forms keep their flags, including `enabled: false`. New forms are appended with the flags they came with. Result is re-capped (slice 09); existing forms win over new ones when the cap is hit. |
| `status` | `pending` → incoming status. `paused` → `active` when the add is an explicit user add (`opts[:explicit]`, true for the add box and Telegram "add"), else unchanged. `active` stays. |
| `origin`, `created_at`, `id` | Never change. |

   If no field changed, the row is not written and `seq` is not bumped. Result `unchanged`.
   Otherwise result `updated`, with `previous` (the full word before the merge) so Undo
   can restore it exactly (slice 24).

**`update(id, patch, opts)`**, used by edits. Explicit edits overwrite: every field
present in `patch` is set, `null` clears a nullable field, `forms` replaces the whole
list. Changing `lang`, `native` or `sense` re-checks the natural key; a clash with another
live word returns `{:error, {:conflict, other_id}}`. A patch that sets `pronunciation` or
`pronunciation_careful` also sets `pronunciation_source` to `user`, unless the patch names
the source itself (section 8's job and slice 49's re-check pass `model`); a patch that
clears `pronunciation` clears the other two. `opts[:if_updated_at]` gives
optimistic concurrency: a mismatch returns `{:error, :stale}`.

**`delete(id)`** sets `deleted_at = updated_at = now`. Content stays on the tombstone, so
**`restore(id)`** can clear `deleted_at` if no live word now holds the same natural key
(else `{:error, {:conflict, other_id}}`).

**Tombstone lifecycle**, run once a day by a new `Kotiko.Janitor` process (a GenServer with
a 24-hour timer and a first run 5 minutes after boot; slices 10 and 41 add their own
cleanup jobs to it):

- After 30 days, a tombstone's content is scrubbed: `native`, `romanization`,
  `native_vocalized`, the three pronunciation fields, `gloss`, `note`, `source_text` and
  `forms` are cleared; `native_key` becomes the `uuid` (to stay
  unique and meaningless). `id`, `lang`, `base_lang`, timestamps and `seq` remain. Restore is no longer
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
| `GET /api/v1/words` | Live words. Query: `lang=ru,ar`, `base=es,en` (records for those bases; default all), `status=active,paused` (default `active,paused`; `pending` is never returned), `limit` (default and max 20,000). Response `{"words": [Word], "cursor": "<last_seq>"}`. Slice 39 adds `since` and ETags on this route. |
| `GET /api/v1/words/:id` | One word, including a tombstone (so a client can see it was deleted). 404 `word_gone` for a malformed or unknown id. |
| `POST /api/v1/words` | Add. Body is either `{"text": "...", "base_langs": ["es", "en"], "client_request_id": "...", "hint_lang": "ja"?}` (interpreted by the model, slices 09 and 10; `base_langs` are the bases to write glosses for, in order, required, at most 4, and entries whose `lang` equals one of them as the same base are dropped for that base; `hint_lang` is slice 09's page or chip language hint) or `{"word": {...}, "client_request_id": "..."}` (structured, no model). Response `{"results": [{"result": "created" \| "updated" \| "unchanged", "word": Word, "previous": Word?}], "rejected": [...], "reply": "..."?}`. `rejected` and `reply` are defined by slice 09. With `"preview": true` (text form only) the server interprets and validates but saves nothing, returning `{"candidates": [Word-shaped, no id, one per base], "rejected": [...], "reply"?}`; the client then saves the learner's chosen candidates through the structured form. Required by the full-control decision so server-lookup mode never saves before the learner accepts. |
| `POST /api/v1/words/batch` | Structured adds, up to 500 per call, one transaction. Same `results` shape, in input order. Used by slices 12 and 13. This route alone accepts bodies up to 1 MB (its own `Plug.Parsers` limit, still after auth); every other route keeps 64 KB. |
| `PATCH /api/v1/words/:id` | Partial update (section 4). Optional `if_updated_at` in the body (or the equivalent header `If-Match: "<updated_at>"`); a mismatch is 409 `word_conflict` with `details.reason: "stale"` and the current word. A natural-key clash is 409 `word_conflict` with `details.reason: "duplicate"` and `details.other_id`. |
| `DELETE /api/v1/words/:id` | Tombstone. Returns `{"word": Word}` with `deleted_at` set. Deleting a tombstone is a no-op 200. |
| `GET`/`PUT /api/v1/profile` | The learner's `base_langs`, written by the extension so the Telegram bot looks up meanings in the right languages. Defined by [41](../41-telegram-improvements/SPEC.md). |
| `GET /api/v1/jobs/pronunciation-refresh` | Section 8's one-time job: `{"state": "running" \| "waiting" \| "paused" \| "done", "done": 40, "total": 120, "retry_at": "..."?}`. |
| `POST /api/v1/jobs/pronunciation-refresh` | `{"action": "pause" \| "resume"}`; returns the same shape. |
| `POST /api/v1/words/:id/restore` | Undo a delete. 409 `word_conflict` (`reason: "duplicate"`) if a live word took the key; 410 `word_gone` if scrubbed. |

Every route that returns a `Word` returns all of section 1's fields, including
`native_vocalized` and the three pronunciation fields (null when empty). `POST` (structured
form), `POST /batch` and `PATCH` accept them, with section 7's limits; an invalid
pronunciation in a structured add is dropped (the word is saved without it) and listed in
the response's `rejected` with `reason: "bad_pronunciation"`.

**Ids in paths** must match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`;
anything else is 404 before touching the database (fixes F27 for v1).

**Legacy routes** stay for one minor version so a 0.2 extension keeps working against a
new server:

- `GET /api/words` returns today's shape: integer `id`, `lang`, `language`, `native`,
  `romanization`, `english` (the `gloss`), `forms` as a list of strings (enabled forms
  only), `note` (no pronunciation fields: a 0.2 extension can't show them); active words only, newest first, and **only records with
  `base_lang: "en"`**, because a 0.2 extension knows no other base and would swap
  Spanish forms on any page. This adapter is the one place on the server that maps a
  field to English, and it goes away with the legacy routes.
- `POST /api/words` uses `add/2` with merging and `base_langs: ["en"]` (what a 0.2
  client meant). `words` contains only `created` words; if
  any were `updated` or `unchanged`, `reply` says "Already in your list: спасибо". The
  0.2 popup shows `reply` when `words` is empty (`extension/popup.js:148-150`), so a
  repeated add no longer offers a destructive Undo. It honours `client_request_id` the
  same way as the v1 route.
- `DELETE /api/words/:id` accepts `^\d{1,18}$` only (else 404, fixing F27) and tombstones.

### 6. Migration of an existing database

A single Ecto migration, `20261015000000_word_model_v2.exs`, with an explicit `up/0`
(no automatic `down`; the backup is the rollback). Before any pending migration runs, the
server copies the database with `VACUUM INTO '<data_dir>/backups/kotiko-pre-<version>-<UTC timestamp>.db'`
and keeps the newest five (slice 29 runs migrations before the HTTP server starts; slice
40 documents restore). Steps, in one transaction:

1. Rename `inserted_at` to `created_at`. Rewrite `created_at` and `updated_at` from
   today's naive `YYYY-MM-DDTHH:MM:SS` text to `YYYY-MM-DDTHH:MM:SS.000000Z`.
2. Add the new columns. Backfill `uuid` with a UUIDv7 whose timestamp is the row's
   `created_at`, so ids sort in creation order. UUIDv7 comes from a 30-line `Kotiko.UUID7`
   module (no new dependency), tested against the RFC 9562 layout.
3. Rename `english` to `gloss` and add `base_lang` with `'en'` for every existing row:
   every 0.2 word was looked up as an English meaning for English pages, so this records
   what the data is, not a default for anyone new. NFC-normalise and trim `native`,
   `romanization`, `gloss`, `note`; compute `native_key`; set `sense = ''`,
   `origin = 'migrated'`, `deleted_at = NULL`. `romanization` keeps its value even when it
   is a respelling rather than section 7's scheme ("pazhaluysta"); `native_vocalized`,
   `pronunciation`, `pronunciation_careful` and `pronunciation_source` are NULL. Section 8's
   job fills the pronunciation after boot.
4. Convert `english_forms` to `forms`: split on newlines, add `gloss` if missing (the
   same union `Word.forms/1` does today, `word.ex:34-37`), dedupe case-insensitively,
   wrap as `{"text": t, "enabled": true, "case": "any", "ambiguous": false}`. Then drop
   `english_forms`.
5. Find rows that now share `(lang, native_key, '', 'en')` (NFD/NFC or case duplicates, which
   the old index allowed). Keep the oldest, merge the others into it with section 4's
   rules, tombstone them with `merged_into` set to the survivor. Log the count.
6. Set `language = NULL` where it is blank (F29). Slice 08 handles the rest.
7. Assign `seq` in `created_at` order; create `sync_state` with the max.
8. Drop the old `(lang, native)` unique index; create the indexes in section 3.

The migration is tested against a fixture copy of a 0.2 database with NFD duplicates,
blank language names, empty forms and pending rows.

The extension's own store (slice 11) and imports of 0.2 exports (slice 12) apply the same
mapping: `english` becomes `gloss`, `base_lang` is `"en"`, `romanization` is kept and the
pronunciation fields are null. Slice 50 adds `en` to the
learner's base languages on upgrade when such words exist, so an existing learner's swaps
never stop.

### 7. Romanization and pronunciation

Two fields with two jobs ([DECISIONS 2026-10-02](../DECISIONS.md)):

| | `romanization` | `pronunciation` and `pronunciation_careful` |
|---|---|---|
| Answers | How is this word written in Latin letters? | How do I say it? |
| Used for | Typing and search (21, 41), the "Also" line (19), ruby above words (37) | The popover's pronunciation line (19), review (35) |
| Follows | One named standard per target language | The respelling key of the record's base language |
| Side | Target: one value for the whole group | Base: one value per record |
| пожалуйста | pozhaluysta | `en`: pa-ZHAL-sta, careful pa-ZHA-lu-sta; `es`: the same |
| хорошо | khorosho | `en`: kha-ra-SHO; `es`: ja-ra-SHO |
| 谢谢 | xièxie | `en`: shyeh4-shyeh; `es`: shie4-shie |
| gracias (target `es`, base `en`) | null | GRA-syas |

**Romanization schemes.** Each target language has one scheme, named in a new data file,
`spec/pronunciation.json`, which 09 adds to `spec/` and syncs to the extension. It also
holds the facts about each target that the respelling rules need:

```json
{ "ru": { "romanization": "kotiko-bgn-pcgn-simple", "stress": "lexical", "tones": null,
          "vocalization_marks": ["U+0301"] },
  "zh": { "romanization": "pinyin-tone-marks", "stress": "none", "tones": [1, 4] },
  "ja": { "romanization": "hepburn-modified", "stress": "none", "tones": null },
  "es": { "romanization": null, "stress": "lexical", "tones": null } }
```

| Target | Scheme | Example |
|---|---|---|
| Mandarin (`zh`, `zh-Hant`) | Hanyu Pinyin with tone marks, dictionary tones (no tone sandhi), the syllables of one word written together | 谢谢 xièxie, 你好 nǐ hǎo |
| Cantonese (`yue`) | Jyutping, tone digits | 多謝 do1 ze6 |
| Japanese | Modified Hepburn of the kana reading, macrons for long vowels | ありがとう arigatō, 好き suki |
| Korean | Revised Romanization of Korean (2000) | 감사합니다 gamsahamnida |
| Russian | Kotiko's simplified BGN/PCGN, below | пожалуйста pozhaluysta |
| Ukrainian | Ukrainian national transliteration (2010) | дякую dyakuyu |
| Belarusian | Belarusian national system (2007) | дзякуй dziakuj |
| Arabic | ALA-LC without dots and macrons; ʿayn and hamza as an apostrophe; the short vowels of Modern Standard Arabic written out | شكرا shukran, مرحبا marhaban |
| Hebrew | The Academy of the Hebrew Language's simplified rules (2006) | תודה toda |
| Greek | ELOT 743 | ευχαριστώ efcharistó |
| Hindi | Hunterian | धन्यवाद dhanyavad |
| Thai | Royal Thai General System | ขอบคุณ khop khun |
| Georgian | National system (2002) | მადლობა madloba |
| Latin-script languages (Spanish, French, German, Vietnamese, Turkish, …) | None: `romanization` is null | |
| Any other | The ISO or national standard a contributor names in the file; until then `"unspecified"`, and the prompt asks for the most standard transliteration | |

Kotiko's simplified BGN/PCGN for Russian, close to what English-language newspapers use:
а a, б b, в v, г g, д d, е e (ye at the start of a word and after a vowel, ъ or ь), ё yo,
ж zh, з z, и i, й y, к k, л l, м m, н n, о o, п p, р r, с s, т t, у u, ф f, х kh, ц ts,
ч ch, ш sh, щ shch, ы y, э e, ю yu, я ya; ъ and ь are dropped; no stress marks, dots or
apostrophes. Romanization never shows stress or vowel reduction in any language: молоко
is "moloko", never "malako". That is what `pronunciation` is for.

**Pronunciation format** (every base):

- Written for a reader of `base_lang`, with only the letters of that base's respelling
  key, `spec/lang/<base>/respelling.json`: a new file in slice 50's per-base folder with
  the key's alphabet, the spelling of each sound with an example word, and notes per
  target language. The docs (44) and the dashboard's help show it as "How to read
  pronunciations".
- Syllables are joined by hyphens and words by spaces: "da svi-DA-nya".
- For targets with word stress (`"stress": "lexical"`), the stressed syllable of each word
  of two or more syllables is in capitals, and only that one; secondary stress is not
  marked. One-syllable words and unstressed little words are lowercase ("jaus", "da"). A
  syllable is either all capitals or all lowercase. Targets without word stress
  (`"stress": "none"`: Japanese, Korean, French, Mandarin, Cantonese, Vietnamese) are all
  lowercase.
- **Tones.** Tonal targets add the tone as a digit after each syllable: Mandarin 1 to 4,
  with no digit for the neutral tone; Cantonese 1 to 6. Digits are the same in every base.
  The respelling gives the tones as actually said, after tone sandhi (你好 nee2-how3),
  while `romanization` keeps the dictionary tones (nǐ hǎo), so the popover shows both.
  It renders the digits as small raised numbers with an accessible name ("tone 4"; 19).
  Pinyin already carries the tones; the digits put them on the line the learner reads
  first.
- **Everyday first.** `pronunciation` is how a native speaker says the word at a normal
  pace in neutral speech, with the reductions every speaker makes: Russian unstressed о
  and а as "a" (молоко ma-la-KO), the dropped syllable of пожалуйста (pa-ZHAL-sta),
  Japanese devoiced vowels (好き skee). Never slang or a regional form (здрасьте for
  здравствуйте). `pronunciation_careful` is the word said slowly and clearly, the way a
  teacher would model it (pa-ZHA-lu-sta, soo-kee), and is null when it would be the same,
  which is most words. For a target with stress, the careful form, or the everyday one
  when there is no careful form, has one syllable per written vowel where the language's
  spelling allows it; slice 49 relies on this to compare stress with a dictionary.
- **Variety.** The learner's variant preference (36) decides where varieties differ
  (zapato: `es-419` sa-PA-to, `es-ES` tha-PA-to). With no preference, the model chooses and
  the prompt asks it to stay consistent within a language.
- No IPA symbols and no accent marks for stress, in any base: capitals mark stress
  everywhere, so no key explains two systems. (IPA has its own optional field, slice 36.)
- A base with no `respelling.json` gets `pronunciation: null`; its learners still get the
  stress-marked native word, the romanization and audio (34). The launch bases with a key
  are `en` and `es`, the Full-level bases (50 §5).

**English key** (`spec/lang/en/respelling.json`), in phrasebook style, read as English:

- Vowels: a as in father (also Russian's reduced unstressed о and а: spa-SEE-ba,
  ma-la-KO), e as in bed (eh at the end of a syllable), ee as in see, i as in sit, ih for
  Russian ы (between the i of sit and the u of put), o as in or, oh as in go, oo as in
  food, u as in put, uh as in cup, ay as in day, ai as in aisle, ow as in cow, oy as in
  boy.
- Consonants as in English, with g always as in go, s always as in see, j as in jam, zh
  as in measure (Russian ж), kh as in Scottish loch (Russian х, Arabic خ), ch as in
  church, sh as in ship (also Russian щ, a longer, softer sh), ts as in cats, th as in
  thin, dh as in this, y as in yes. A soft Russian consonant before a vowel adds y (нет
  nyet, здравствуйте ZDRAST-vuy-tyeh).

**Spanish key** (`spec/lang/es/respelling.json`), built on Spanish spelling so that a
reader who knows only Spanish can read it aloud. **Every choice here needs review by
native speakers from Spain, Mexico, the Caribbean and the Southern Cone before launch**
(open question 5).

| Sound | Written | Examples |
|---|---|---|
| Vowels | a e i o u, always as in Spanish; long vowels doubled | ありがとう a-ri-ga-too |
| Reduced vowels (Russian unstressed о and а, English schwa) | the full Spanish vowel they sound closest to | молоко ma-la-KO; teacher TI-cher |
| English vowels Spanish lacks | the nearest Spanish vowel | cup kap; sit sit |
| Stress | capitals, never a written accent mark | спасибо spa-SI-ba |
| [k] | k always (never c or qu, so ce and ci are never read as θ or s) | кошка KOSH-ka |
| [g] | g; gu before e and i, as in Spanish | |
| [x] and [h] | j, never h (Spanish h is silent): Russian х, Arabic ح خ ه, English h, pinyin h | хорошо ja-ra-SHO; مرحبا MAR-ja-ban; house jaus; 你好 ni2-jao3 |
| [ʃ] and [ɕ] | sh: Russian ш and щ, English sh, Arabic ش, pinyin x and sh | шапка SHAP-ka; щи shi; شكرا SHUK-ran; 谢谢 shie4-shie |
| [ʒ] | zh, explained as the ll and y of Río de la Plata Spanish: Russian ж, English measure | пожалуйста pa-ZHAL-sta |
| [z] | z, explained as a buzzing s, as in English "zoo"; readers in Spain are told not to read it as their z | здравствуйте ZDRAST-vui-tie |
| [θ] (English thin) | th, explained as the z of Spain (review: open question 5) | think think |
| [ð] (English this) | d, as between vowels in Spanish "dedo" | this dis |
| [tʃ], [ts] | ch, ts | чай chai; царь tsar |
| Palatal n | ñ (Russian нь, French gn) | нет ñet |
| [j] | y before a vowel, i after one | я ya; здравствуйте ZDRAST-vui-tie |
| Russian soft consonants | i before the vowel; нь as ñ | дети DIE-ti; люблю liu-BLIU |
| Russian ы | i, an approximation; the audio carries the difference | мы mi |
| Russian е, ё, ю, я after a consonant | ie, io, iu, ia (ye, yo, yu, ya at the start of a word) | лес lies |
| [w] | u before a vowel | window UIN-dou |
| r | r and rr as Spanish spelling reads them (a single r at the start of a word is trilled) | рыба RI-ba |

**Validation** (09's validator implements it; numbers live in `rules.json`). A failing
pronunciation or vocalised form never rejects the word: the field is set to null, the
word is saved without it, and the failure is listed in a `dropped_fields` list that 09
adds beside `dropped_forms`.

| Rule | Value | Reason |
|---|---|---|
| `pronunciation`, `pronunciation_careful` length (`max_pronunciation_chars`) | 96 | `bad_pronunciation` |
| Characters: the base key's `alphabet` in either case, hyphen, space, apostrophe; tone digits only for tonal targets and only in the target's range | | `bad_pronunciation` |
| Shape: no empty syllables (no leading, trailing or doubled hyphens); `"stress": "lexical"`: exactly one all-capital syllable in each word of two or more syllables and none elsewhere; `"stress": "none"`: no capitals; tonal targets: a digit at the end of every syllable except neutral-tone ones | | `bad_pronunciation` |
| `pronunciation_careful` equal to `pronunciation`, or present without it | | careful set to null, no reason shown |
| `native_vocalized`, with the target's `vocalization_marks` removed, equals `native`; for ru, uk and be at most one U+0301 per word and none on ё | | `bad_vocalized` |
| ru, uk, be: the vowel carrying U+0301 in `native_vocalized` is the same, counted in vowel letters, as the capitalised syllable of `pronunciation_careful` (or of `pronunciation` when there is no careful form) | | `native_vocalized` set to null, reason `stress_mismatch`; the pronunciation is kept |
| `romanization` in Latin script (with the scheme's marks), length 64 as today | | `bad_romanization` (non-Latin) or `too_long` |

### 8. Refreshing pronunciation for saved words (one time)

Words saved before this change have a `romanization`, often a spelling transliteration
("pazhaluysta"), and no pronunciation. A one-time job fills it in:

- **Who runs it.** The side that does lookups (11's `lookup.kind`): the extension's
  background when it calls a provider directly, the server when lookups go through it (the
  server then does every word in its database). An extension whose lookups go through the
  server never runs its own; the results arrive by sync. Both write the same way, so a
  second run is harmless.
- **What it picks.** Live records (any status except `pending`) with `pronunciation` null
  whose `base_lang` has a respelling key, grouped by `(lang, native_key, sense)` so one
  request covers every base of a word.
- **The request.** 09's `respell` prompt section, a short prompt with no lookup and no
  forms. Input: up to 20 words as `{lang, native, sense, base_langs}`; output
  `{"items": [{"lang", "native", "base_lang", "pronunciation", "pronunciation_careful",
  "native_vocalized"}]}`. Glosses, notes and forms are never sent. `sense` is sent so that
  stress homographs come back right (замок "castle" ZA-mak, "lock" za-MOK).
- **Checks.** Each item goes through section 7's validation. An item that matches no
  requested `(lang, native, base_lang)` is ignored.
- **Writes.** Only `pronunciation`, `pronunciation_careful` and `pronunciation_source:
  "model"`, plus `native_vocalized` when it is null, through `update/3` with
  `if_updated_at` taken when the batch was read. If the word is stale or already has a
  pronunciation (the learner edited it, or a re-add filled it), that word is skipped. Each
  write bumps `seq`, so sync carries it. No other field changes, including a non-standard
  `romanization` (open question 6).
- **Quota and priority** ([10](../10-llm-client-resilience/SPEC.md)). Uses the bulk add
  batch budget (45 s overall, 2 attempts). Runs one request at a time and only when no add
  job is waiting or running, so the learner's own adds always go first. Stops for the day
  when the known free quota (10 §3) is down to 10 remaining lookups, keeping them for the
  learner. On `quota_exhausted` or `rate_limited` it waits until `retry_at`; with no
  provider set up it waits until one is. 300 saved words take 15 requests.
- **Failures.** A word with a missing or invalid item twice is skipped and stays without
  a pronunciation until a re-add or an edit fills it. Attempts are counted in the job's
  state, never on the word.
- **State.** On the server, a row in `maintenance_jobs` (section 3) named
  `pronunciation_refresh`; in the extension, the same object under
  `jobs.pronunciationRefresh` in 11's `meta` store. `state` is `running`, `waiting` (with
  `retry_at`), `paused` (by the learner) or `done`. The job is done when no eligible word is
  left, and never starts again by itself: new words get their pronunciation when they are
  added.
- **API.** `GET` and `POST /api/v1/jobs/pronunciation-refresh` (section 5).
- **What the learner sees.** While it runs, the dashboard (21) shows one quiet line with a
  Pause button: "Adding pronunciations to your saved words: 40 of 120." ("Agregando la
  pronunciación a tus palabras guardadas: 40 de 120."). While waiting for quota: "Waiting
  for free lookups; continues at {time}." ("Esperando consultas gratuitas; sigue a las
  {time}."). Every result can be edited in the word's inspector like any field, and an edit
  makes it the learner's own (`pronunciation_source: "user"`).

### 9. Cases for slice 09's golden set

Proposed here for 09 to adopt (09 owns `spec/eval/golden.jsonl`). Each case is a bare
word or a short request in add mode, with `recent` set to the target language. The
expected strings are reference answers; the notes list what else to accept and what the
case exists to catch.

| Id | Input | Base | `romanization` | `pronunciation` | `pronunciation_careful` | Notes |
|---|---|---|---|---|---|---|
| `en-ru-pozhaluysta` | пожалуйста | en | pozhaluysta | pa-ZHAL-sta | pa-ZHA-lu-sta | `native_vocalized` пожа́луйста; careful may be pa-ZHA-luy-sta; catches "pazhaluysta" |
| `es-ru-pozhaluysta` | пожалуйста | es | pozhaluysta | pa-ZHAL-sta | pa-ZHA-lu-sta | same letters in both keys |
| `en-ru-spasibo` | спасибо | en | spasibo | spa-SEE-ba | null | спаси́бо; final о as a |
| `es-ru-spasibo` | спасибо | es | spasibo | spa-SI-ba | null | |
| `en-ru-khorosho` | хорошо | en | khorosho | kha-ra-SHO | null | хорошо́; no o in an unstressed syllable |
| `es-ru-khorosho` | хорошо | es | khorosho | ja-ra-SHO | null | Spanish j for х |
| `en-ru-moloko` | молоко | en | moloko | ma-la-KO | null | молоко́; romanization never "malako" |
| `es-ru-moloko` | молоко | es | moloko | ma-la-KO | null | |
| `en-ru-zdravstvuyte` | здравствуйте | en | zdravstvuyte | ZDRAST-vuy-tyeh | null | здра́вствуйте; first в silent; accept -tye; reject ZDRAS-tye (casual) |
| `es-ru-zdravstvuyte` | здравствуйте | es | zdravstvuyte | ZDRAST-vui-tie | null | |
| `en-zh-xiexie` | 谢谢 | en | xièxie | shyeh4-shyeh | null | no capitals; neutral second syllable has no digit |
| `es-zh-xiexie` | 谢谢 | es | xièxie | shie4-shie | null | |
| `en-zh-nihao` | 你好 | en | nǐ hǎo | nee2-how3 | null | sandhi in the respelling only; accept nǐhǎo |
| `es-zh-nihao` | 你好 | es | nǐ hǎo | ni2-jao3 | null | Spanish j for pinyin h |
| `en-ja-arigato` | ありがとう | en | arigatō | a-ree-ga-toh | null | no capitals; accept arigatou |
| `es-ja-arigato` | ありがとう | es | arigatō | a-ri-ga-too | null | |
| `en-ja-suki` | 好き | en | suki | skee | soo-kee | `reading` すき; devoiced u |
| `en-ar-shukran` | شكرا | en | shukran | SHUK-ran | null | `native_vocalized` شُكْرًا; accept SHOO-kran |
| `es-ar-shukran` | شكرا | es | shukran | SHUK-ran | null | |
| `en-ar-marhaban` | مرحبا | en | marhaban | MAR-ha-ban | null | |
| `es-ar-marhaban` | مرحبا | es | marhaban | MAR-ja-ban | null | never h for ح in the Spanish key |
| `en-es-gracias` | gracias | en | null | GRA-syas | null | accept GRA-thyas (`es-ES`) |
| `en-es-zapato` | shoe in spanish | en | null | sa-PA-to | null | with variant `es-ES`: tha-PA-to |
| `en-es-telefono` | telephone in spanish | en | null | te-LE-fo-no | null | stress from the written accent |
| `es-en-hello` | hello | es | null | je-LOU | null | Spanish j for English h |
| `es-en-house` | house | es | null | jaus | null | one syllable, lowercase |
| `es-en-teacher` | teacher | es | null | TI-cher | null | |

Assertions these cases need, which 09's runner would add: `romanization_any` (null
allowed), `pronunciation_any` and `careful_any` (with null meaning "must be null"),
`stress_syllable` (the 1-based position of the capitalised syllable per word in the careful
form, or the everyday one when there is none), `no_capitals`, `tones` (the digit
sequence, "4," for 谢谢), `native_vocalized_any` and `reading_any`. Stress and vowel
reduction are reported as their own scores per target and base, so a model that gets the
letters right but the stress wrong is visible.

## Acceptance criteria

- [ ] Re-adding a word whose model answer has null note and romanization keeps both and
      returns `unchanged` (or `updated` with `previous` if new forms were added).
- [ ] An add of 犬 with `base_langs: ["es", "en"]` creates two live words, glosses "perro"
      and "dog", each with forms in its own base; a later add with `["es"]` returns
      `unchanged` for the Spanish one and leaves the English one alone.
- [ ] An add of "dog" with `base_langs: ["es", "en"]` creates only the `es` record
      (`lang: "en"`, gloss "perro"); no stored record has `lang` equal to its `base_lang`.
- [ ] The legacy `GET /api/words` returns only `base_lang: "en"` records, with `english`
      equal to `gloss`.
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
      a backup file first, sets `gloss` from `english` and `base_lang: "en"` on every row,
      and a second boot runs no migration and makes no new backup.
- [ ] A 0.2 extension against the new server can list, add (repeat add shows "Already in
      your list") and undo.
- [ ] Re-adding a word whose `pronunciation` is null fills `pronunciation`,
      `pronunciation_careful` and `pronunciation_source: "model"` from the answer; re-adding
      a word whose pronunciation the learner edited leaves all three unchanged.
- [ ] A `PATCH` that sets `pronunciation` returns the word with `pronunciation_source:
      "user"`.
- [ ] An add of 犬 for bases `es` and `en` stores a different `pronunciation` on each
      record, and an edit of `romanization` or `native_vocalized` from the dashboard reaches
      both records while the pronunciations stay as they were.
- [ ] A structured add with pronunciation "PA-ZHAL-STA" (two capital syllables) saves the
      word with `pronunciation: null` and lists `bad_pronunciation`.
- [ ] Migrating the 0.2 fixture keeps every `romanization` byte for byte (after NFC and
      trim) and leaves the four new fields null.
- [ ] With a mock provider, the refresh job fills the pronunciation of every eligible
      migrated word in requests of at most 20 words, changes no other field (every column
      but the pronunciation fields, a null `native_vocalized`, `updated_at` and `seq`
      compares equal before and after), skips a word the learner edits mid-batch, waits at
      10 remaining quota or on `quota_exhausted` until `retry_at`, ends `done`, and does not
      run again after a restart. The same fixture passes against the extension's store.

## Test plan

- **ExUnit, `Kotiko.WordsTest`**: table-driven merge cases (each field rule, form flag
  preservation, cap overflow, status transitions), each run for a Spanish-base and an
  English-base word, plus a bilingual group; concurrency test with 20 tasks against
  a file-backed test database (sandbox in shared mode, `async: false`); tombstone,
  restore, scrub and purge with a controllable clock; `seq` monotonicity.
- **ExUnit, `Kotiko.RouterV1Test`** (`Plug.Test`): every route, error shape, id
  validation, `if_updated_at` and `If-Match`, idempotency table, legacy routes' shapes.
- **Migration test**: copy `test/fixtures/db/slovo-0.2.db` to a temp dir, run
  migrations, assert counts, merged duplicates, forms JSON, timestamps, backup file.
- **StreamData property**: for random Unicode strings, `native_key` is idempotent and
  `native_key(NFD(s)) == native_key(NFC(s))`.
- **Shared fixtures** (slice 09's CI job): `native-key.json` and `merge.json` (input word
  pairs and expected merge result, including the pronunciation fill-only-if-empty rule and
  a user-edited pronunciation) run against Elixir and the JS store used by slice 11; new
  `pronunciation/*.json` fixtures cover section 7's validation table for `en` and `es`
  keys, stressed and stressless targets, Mandarin tone digits and `native_vocalized`.
- **Refresh job** (ExUnit with `Req.Test` and a controllable clock; Node with the mock
  provider of slice 11): batching, grouping by word, stale writes, quota stop and resume,
  pause and resume through the API, two failed attempts, `done` persisted across restarts.
- **Golden evaluation** (09): section 9's cases, scored per target and base for letters,
  stress and vowel reduction.

## Rollout and migration

- Ships in the server release after slice 02. The migration runs at boot after the
  automatic backup; the log names the backup file.
- The extension adopts `/api/v1` by trying `GET /api/v1/words` and falling back to the
  legacy routes on 404 (slice 11's legacy adapter). Legacy routes are removed one minor
  version later, with a changelog note.
- The pronunciation refresh (section 8) starts after the first boot or extension update
  that has a working provider, and runs in the background within the free quota.
- Changelog: "Words now have permanent ids and keep a history of deletes. Adding a word
  you already have no longer overwrites your notes; Kotiko tells you it's already in your
  list. A word's meaning is stored in the language you read, so Kotiko works for readers
  of any language. Each word now shows how to say it, written for readers of your
  language, with the stressed syllable in capitals; Kotiko adds this to the words you
  already saved, a few at a time. Your database is backed up automatically before the
  upgrade."

## Open questions

1. **Should a re-add of a paused word un-pause it?** Recommendation: yes for explicit adds
   (the learner just typed it), no for bulk adds and imports.
2. **Tombstone windows (30 days restorable, 180 days kept).** Recommendation: keep these;
   they cover a long holiday offline and bound privacy exposure.
3. **Should deleting from the dashboard delete the whole group?** Recommendation: yes by
   default (the learner thinks of 犬 as one word), with "Only the Spanish meaning" in the
   row's menu; Undo restores every record it removed.
4. **Case-insensitive `native_key`.** It merges "Polska" (Poland) and "polska" (Polish,
   adjective) unless one gets a `sense`. Recommendation: accept; homographs are exactly
   what `sense` is for.

5. **Who reviews the Spanish respelling key?** Every choice in section 7's Spanish table
   is a proposal: z for [z] (read as θ in Spain), th for English [θ], i for Russian ы, sh
   for both ш and щ. Recommendation: a native-speaker review from at least Spain, Mexico,
   the Caribbean and the Southern Cone before launch, tested by reading ten respellings
   aloud against the audio; the key ships marked "beta" in the docs until then.
6. **Should the refresh also fix old romanizations?** Many saved words have a respelling
   in `romanization` ("pazhaluysta") rather than section 7's scheme. The decision says the
   refresh changes nothing else. Recommendation: keep that; later, offer the scheme
   spelling through 36's "Improve my words", which shows old and new side by side before
   anything changes.
7. **Respelling keys for other bases.** Without a key, a base gets no `pronunciation`.
   Recommendation: `pt`, `fr` and `de` keys next (Latin script, conventions close to
   `es` and `en`); a `ja` key in katakana after a native review; no key for `zh` bases
   (a respelling in characters misleads), where audio and IPA do the job.
8. **Is everyday the right default?** Recommendation: yes, with the careful form one
   line below it (19); learners hear the everyday form from native speakers, and a
   letter-by-letter reading of the spelling is what produced "pazhaluysta".

## Future work

- Per-device edit vectors instead of last-writer-wins on `updated_at`: slice 39 if
  conflicts turn out to matter.
- Word history (every past version) for a "what changed" view.
- Owner (`user_id`) on every word: slice [48](../48-multi-user-and-classroom/SPEC.md).
