# 12 · Export, import and delete

| | |
|---|---|
| **Status** | Built (2026-10-05); see Implementation notes |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (base languages, localized headers) |
| **Unblocks** | [11-local-first-mode](../11-local-first-mode/SPEC.md) (mode switches use the export endpoint), [28-privacy-and-store-readiness](../28-privacy-and-store-readiness/SPEC.md) (deletion is a store expectation), [39-multi-device-sync](../39-multi-device-sync/SPEC.md) (reset epoch) |
| **Sources** | [04 summary, S5, S6, S7](../../docs/research/04-architecture-release.md); [05 S17, section 3.5](../../docs/research/05-learner-ux.md); [03 C7](../../docs/research/03-browser-extension.md) |

## Problem

Learners can't get their words out of Kotiko, can't bring a backup back, and can't delete
everything.

- There is no export. Words are reachable only through `sqlite3` or
  `GET /api/words` (`server/lib/slovo/router.ex:17-28`), and that response leaves out
  `status`, `source_text` and timestamps (`server/lib/slovo/word.ex:57-68`). Read from
  the code.
- In local mode (slice 11) this becomes urgent: uninstalling an extension deletes its
  storage without asking ([04 S5](../../docs/research/04-architecture-release.md)). A
  learner with 500 words and no backup loses all of them.
- "Delete all my data" exists only as README advice to delete
  `~/.local/share/slovo/slovo.db` (`README.md:204`). The extension keeps its cache
  (`extension/background.js:28-38`) and its token (`extension/popup.js:215-219`) after
  you stop using the server, and nothing clears them.
- Anki is where serious learners keep vocabulary, and spreadsheets are where everyone
  else does. Neither is reachable ([04 S6](../../docs/research/04-architecture-release.md)).

## Goals

- One click exports every word to a JSON backup that restores losslessly, in the
  extension and on the server.
- Spreadsheet (CSV) and Anki exports that open correctly in Excel, LibreOffice, Google
  Sheets and Anki, including Cyrillic, CJK, Arabic and Devanagari text.
- Importing a JSON backup never duplicates words and never silently overwrites edits.
- "Delete everything" removes every piece of Kotiko data the extension holds, and
  optionally everything the connected server holds, and says what it can't delete.
- A gentle reminder to back up when the learner's words exist only in this browser.
- Server endpoints for export and import that slice 11 uses to move words between modes.

## Non-goals

- Importing CSV, TSV, TXT or Anki files, and pasted lists: slice [13](../13-bulk-add/SPEC.md).
  This slice imports only Kotiko's own JSON.
- A native Anki `.apkg` file (SQLite in a zip): future work.
- Automatic scheduled backups to disk (needs the `downloads` permission): future work.
- Importing word lists published by someone else, by URL or file: never
  ([DECISIONS](../DECISIONS.md)). This slice restores the learner's own backups; a list
  from anywhere else goes through bulk add's review ([13](../13-bulk-add/SPEC.md)).
- Per-word undo after a delete: slices [21](../21-dashboard/SPEC.md) and [24](../24-add-flow-safety/SPEC.md).

## User stories

- As a learner in local mode, I want a backup file I can keep, so that reinstalling the
  browser doesn't cost me months of words.
- As an Anki user, I want my Kotiko words as Anki cards, so that I can drill them.
- As a teacher, I want a spreadsheet of my words, so that I can share or print them.
- As a learner moving to a new computer, I want to restore my backup and get exactly my
  list back.
- As someone leaving Kotiko, I want one button that deletes everything, and to be told
  honestly what stays elsewhere.

## Specification

### 1. Where it lives in the UI

The dashboard's Data section (slice 21) and the settings page's Data row
([05 section 3.5](../../docs/research/05-learner-ux.md)):

```
Data
  Back up       [Export backup (JSON)]   Last backup: 12 days ago
  Share         [Spreadsheet (CSV)] [Anki cards]   ( ) all words  (o) current filter
  Restore       [Import a backup…]
  Danger zone   [Delete everything…]
```

The dashboard's word list also has "Export ▾" with the same three formats, applied to
the current filter. All exports run in the extension page, build a `Blob` and download
it through an `<a download>` link, so no `downloads` permission is needed. Exports are
instant; there are no model calls anywhere in this slice.

### 2. JSON backup (canonical)

File name: `kotiko-backup-YYYY-MM-DD.json`, UTF-8, no BOM, pretty-printed with two spaces
so it diffs well.

```json
{
  "format": "kotiko.words",
  "schemaVersion": 2,
  "exportedAt": "2026-10-01T12:00:00Z",
  "app": { "name": "Kotiko", "version": "0.3.0", "source": "extension" },
  "words": [ { "...": "one slice 07 word, exactly as spec/word.schema.json defines it" } ],
  "settings": { "...": "optional, non-secret settings from slice 39's list" },
  "stats": { "...": "optional, slice 46's daily counters" }
}
```

- `words` holds every word that is not deleted, in every status, with every field
  slice 07 defines (ids, timestamps, status, origin, source text, `base_lang`, `gloss`,
  forms, `romanization`, `native_vocalized`, and the base-side `pronunciation`,
  `pronunciation_careful` and `pronunciation_source`, null when empty). Tombstones are left out. A bilingual learner's two records for 犬 (glossed
  "perro" for `es` and "dog" for `en`) are two entries, exactly as stored. Words whose
  `base_lang` is no longer one of the learner's bases are exported too.
- `settings` and `stats` are included by default with a checkbox each ("Include
  settings", "Include learning stats"). Secrets (API keys, server token) are never
  included; slice 11 keeps them out of reach of this code entirely.
- `schemaVersion` follows `spec/export.schema.json`, which this slice adds to slice 09's
  `spec/` folder so the extension and the server validate the same document. Its `words`
  items are `spec/word.schema.json` (07), so version 2 includes the pronunciation fields;
  they are optional there, and a version 2 file without them reads them as null. A newer
  Kotiko reads every older version; an older Kotiko refuses a newer file with
  "This backup was made by a newer version of Kotiko. Update Kotiko, then try again."
- **Version 1** is the shape before base languages (slice 50): words with `english` and
  no `base_lang`. Kotiko reads it by mapping `english` to `gloss` and setting
  `base_lang: "en"`, which is what those words were for (their forms were English
  forms). Any word in any version that has `english` but no `gloss` is read the same way.
  If the learner's bases don't include `en`, the preview says "These words are for pages
  in English, which isn't one of your languages. Add English to your languages?" with
  [Add English] [Import anyway] (imported words are kept and don't swap until `en` is a
  base; slice 50 section 2). Version 1 words keep their `romanization` as it was (often a
  respelling such as "pazhaluysta", 07 open question 6) and get null pronunciation
  fields.

### 3. Spreadsheet (CSV)

File name: `kotiko-words-YYYY-MM-DD.csv`. UTF-8 **with** a byte-order mark, so Excel on
Windows shows non-Latin scripts correctly ([04 S6](../../docs/research/04-architecture-release.md)).
RFC 4180: comma separator, CRLF line ends, double quotes around fields that contain a
comma, quote or newline.

Columns, in this order. One row per word record, so a bilingual learner gets one row
per base for the same target word. The header row is localized: each column's header
is the `export_csv_col_<id>` message in the interface language (slice 50), so a Spanish
learner sees `palabra, palabra_con_marcas, pronunciación, pronunciación_lenta,
romanización, significado, formas, idioma, código_idioma, idioma_base, código_base, nota,
estado, agregada, origen_pronunciación, id`. Slice 13's CSV import recognises
the headers of every shipped locale and the stable ids below.

| Column (stable id) | Content |
|---|---|
| `native` | The word |
| `native_vocalized` | The word with its stress or vowel marks (пожа́луйста); empty when none |
| `pronunciation` | How to say it, written for this record's base language (07 section 7: pa-ZHAL-sta); empty when none |
| `pronunciation_careful` | The slow, careful form (pa-ZHA-lu-sta); empty when none |
| `romanization` | The standard Latin spelling (pozhaluysta); empty when none |
| `gloss` | Main meaning, in the base language |
| `forms` | Base-language forms joined with ` | ` (perro \| perros; dog \| dogs) |
| `language` | Target language's display name in the interface language |
| `language_code` | BCP 47 tag (slice 08) |
| `base_language` | Base language's display name in the interface language |
| `base_language_code` | Base tag (slice 50) |
| `note` | In the base language |
| `status` | Slice 07's values (`active`, `paused`, and any slice 35 adds) |
| `added` | `YYYY-MM-DD` in local time (ISO, not the locale's date format, so spreadsheets sort it) |
| `pronunciation_source` | `model` or `user` (07), empty with no pronunciation; kept on re-import so a model pronunciation keeps its "AI-generated" label |
| `id` | UUID, last so it stays out of the way |

**Formula injection.** A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage
return is prefixed with a single quote (OWASP's guidance), because notes and forms come
from a model. For a Kotiko CSV to round-trip, slice 13's CSV import must strip a leading
quote that is followed by one of those characters (an addition slice 13 doesn't yet
specify).

### 4. Anki cards (TSV)

File name: `kotiko-anki-YYYY-MM-DD.txt`. Anki's text import with file headers (Anki
2.1.55 and later; high confidence on the header syntax, medium on `guid column`, to
verify against the current Anki manual):

```
#separator:tab
#html:false
#notetype:Basic (and reversed card)
#deck column:4
#tags column:5
#guid column:6
#columns:Front	Back	Language	Deck	Tags	GUID
```

| Field | Content |
|---|---|
| Front | `native_vocalized` (else `native`), then ` (romanization)` when present, then ` · pronunciation` and ` · Slowly: careful` (19's `popover_careful` in the interface language) when present: "пожа́луйста (pozhaluysta) · pa-ZHAL-sta · Slowly: pa-ZHA-lu-sta" |
| Back | `gloss` (in the record's base language), then ` - note` when present |
| Language | Target language's display name in the interface language |
| Deck | `Kotiko::<Language>`, so each language gets a subdeck; when the export holds more than one base, `Kotiko::<Base language>::<Language>` (`Kotiko::español::japonés`, `Kotiko::English::Japanese`), so a bilingual learner drills each base separately |
| Tags | `kotiko lang::<code> base::<base tag>` |
| GUID | `kotiko-<word id>`, so re-importing an updated export updates the same notes instead of duplicating them |

One note per word record: 犬 for a Spanish reader is Front "犬 (inu) · i-nu", Back
"perro"; for an English reader, Front "犬 (inu) · ee-noo", Back "dog".

**Pronunciation on the Front, not the Back.** The note type makes a reversed card too,
whose question is the Back. A pronunciation on the Back would read the answer aloud on
that card ("perro · pa-ZHAL-sta" asking for пожалуйста). On the Front it is part of the
answer on the reversed card, and on the forward card it says how to say the word without
giving away its meaning, as in the popover's Reveal mode (35), where pronunciation stays
visible before revealing. The stock note type's name is localized by Anki's own
interface language ("Basic (and reversed card)" in English Anki), so the dialog has
"My Anki is in: [English ▾]", defaulting to the interface language, and writes that
locale's name of the stock note type in `#notetype`, from a table in
`extension/data/anki-notetypes.json` taken from Anki's translation files (each entry
verified against Anki before it ships; a locale with no verified name falls back to
leaving `#notetype` out, and Anki asks which note type to use).

Tabs and newlines inside fields are replaced with spaces. The dialog says, in the
interface language, "In Anki: File, Import, choose this file." A link to the docs site
(slice 44) shows screenshots.

### 5. Importing a backup

"Import a backup…" accepts a `.json` file by file picker or drop. Limits: 20 MB file,
20,000 words (the vocabulary cap from slice 09).

1. **Parse and check** in the extension page: `format`, `schemaVersion`, then each word
   through slice 09's validator. Invalid words are listed, not fatal; an invalid
   pronunciation is dropped from its word (09's `dropped_fields`) and counted in the
   preview, and the word is kept. `pronunciation_source` is restored as saved.
2. **Preview**, computed against the local store without writing:

   ```
   Restore kotiko-backup-2026-09-30.json
   312 words in the file
     290 new           15 will be merged     7 already identical
     0 can't be used
   [x] Also restore 3 words you deleted after this backup was made
   [x] Restore settings from the backup
                                  [Cancel]  [Restore 305 words]
   ```

3. **Commit** in one IndexedDB transaction through slice 11's store, so pages update
   once. In server mode the words go to the server through slice 07's batch route instead
   (section 7), in batches of 500.

**Merge rules** (slice 07 defines field-level merging; this slice only picks the
target):

- Same `id` exists locally: merge with slice 07's rules; the newer `updated_at` wins
  per field where 07 says so.
- Otherwise, same natural key `(lang, native_key, sense, base_lang)` exists: merge into
  the existing word and keep the local id. A file's 犬 glossed "dog" (`en`) never merges
  into a local 犬 glossed "perro" (`es`); it is a separate record.
- Local tombstone for the same id, newer than the file's `updated_at`: skipped unless
  "Also restore words you deleted" is ticked (default on for a full restore into an empty
  store, off otherwise).
- Otherwise: insert with the file's id.

Words restored without a pronunciation, in a base with a respelling key (a version 1
backup), get one through slice 13's pronunciation follow-up (09's `respell` request), shown
in the preview as a ticked option: "[x] Add pronunciations to 290 words (about 15
lookups)".

**Undo.** The result line says "Restored 305 words. Undo" for 24 hours. Undo deletes the
words this import created and puts back the previous versions of merged words, kept in
the store's `meta` under `lastImport`. Only the most recent import can be undone.

### 6. Delete everything

"Delete everything…" opens:

```
Delete everything Kotiko keeps in this browser?
  312 words, your settings, learning stats, and your OpenRouter key.

[x] Download a backup first
[ ] Also clear settings synced to your other browsers
[ ] Also delete all 1,204 words on my Kotiko server (home.example:4747)

Kotiko can't delete: messages in your Telegram chat, what your model provider
keeps under its own policy, and backup files you've downloaded.

                                   [Cancel]  [Delete 312 words]
```

- The server checkbox appears only when a server is connected, and is unchecked by
  default, because the server may also serve Telegram and other devices.
- The browser-sync checkbox appears only where `storage.sync` really syncs (not Safari
  or Firefox for Android, per MDN browser-compat-data) and is unchecked by default,
  because clearing it changes every signed-in browser.

On confirm, in this order:

1. If ticked, download the backup and wait for the Blob URL to be consumed.
2. If ticked, call the server's delete-all (section 7) and stop with an error if it fails.
3. Cancel all jobs; clear alarms; remove context menus; reset the toolbar badge.
4. `indexedDB.deleteDatabase("kotiko")` (words, jobs, secrets, stats, cache).
5. `storage.local.clear()`, `storage.session.clear()`, and `storage.sync.clear()` if ticked.
6. Tell every tab to unwrap its swaps (the projection is now empty, so slice 15's
   storage listener does this).
7. Show "Everything is deleted." with "Start again" (opens slice 22's welcome page) and
   "Close".

Uninstalling also deletes everything in the extension; the docs and the uninstall URL
page (if slice 28 sets one) say so.

### 7. Server endpoints and command

Under slice 07's `/api/v1`, behind the same bearer auth (`router.ex:89-103` today).

**`GET /api/v1/export`** returns the section 2 document with `source: "server"`.
Query: `include=pending` adds Telegram lookups that were never saved (excluded by
default). `download=1` adds `Content-Disposition: attachment`. Words are streamed in
id order so a 20,000-word export doesn't build one large term.

**Importing to a server** uses slice 07's `POST /api/v1/words/batch` (structured words,
at most 500 per call, one transaction, per-word `created | updated | unchanged` results).
The extension sends the backup's words with their ids, so words new to the server keep
them; settings and stats stay in the extension. No separate import route is needed. The
batch route's body limit is set by slice 07, after auth; the global 64 KB limit
(`router.ex:9`) stays for every other route.

**`DELETE /api/v1/words`** with body `{"confirm": "delete-all-words"}` deletes every
word, pending row and tombstone, and increments a `reset_epoch` in the server's metadata
table. Returns `{"deleted": 1204, "reset_epoch": 3}`. Without the confirm body it returns
400. Slice 39 uses `reset_epoch` so other devices don't push their copies straight back.

**`bin/kotiko reset`** (release command; `mix kotiko.reset` in development, after slice 04's
rename): prints the word count, asks `Delete all 1204 words? [y/N]`, takes a
`VACUUM INTO` backup first (slice 40's backup helper) unless `--no-backup`, then does
the same as the endpoint. `bin/kotiko export > file.json` and `bin/kotiko import file.json`
cover files too large for HTTP.

### 8. Backup reminder

Only when words live in the browser (`wordsHome = "local"`, slice 11) and there are at
least 20 words. If the last export or import is more than 30 days ago (or never), the
popup's status area shows one quiet line: "Your 312 words are only in this browser.
Back up now · Not now". "Not now" hides it for 30 days. A setting, "Remind me to back
up", defaults on. No system notifications.

## Implementation notes

Built 2026-10-05. English strings only (DECISIONS 2026-10-05), so "Spanish headers" and
the Spanish deck names below read "in the interface language"; the English ones are tested.

- **Where the code is.**
  - `extension/lib/backup.js`: the document, reading any version, the restore's plan, and
    the settings allowlist. Loaded by the background and, on first use, by the dashboard.
  - `extension/lib/export-files.js`: CSV, Anki and file names.
  - `extension/data-tools.js`: the dashboard's "Your data" dialogs.
  - The dashboard loads these three, with `lib/word-merge.js` and `lib/wordspec.js` (the
    file checks), on first use, so its first view loads nothing more. The background loads
    only `lib/backup.js` (20 KB).
  - The store: `importWords` (one transaction), `undoImport`, `KotikoStore.wipe`.
  - The background: `backup.preview`, `backup.restore`, `backup.undo`, `backup.status`,
    `backup.saved`, `data.describe`, `data.deleteAll`. Only extension pages may call them.
    Words a page sends are checked again there.
  - The server: `Kotiko.Backup`, `GET /api/v1/export`, `DELETE /api/v1/words`, and
    `mix kotiko.reset`, `mix kotiko.export`, `mix kotiko.import`.
  - `spec/export.schema.json` and `spec/fixtures/export/`: multi-script, v1, bilingual,
    newer and invalid-words backups, plus English CSV and Anki golden files.
- **§1.**
  - "Your data" is a Settings section (`#settings/data`).
  - The list's "Export ▾" is two ⋯ menu entries, "Export these words as a spreadsheet"
    and "… as Anki cards". They follow the list's filters, and say "all words" when there
    are none. The E key, the selection bar and the shelf menu have no export yet.
  - The JSON backup reads the words through `words.list` in both homes. The server's
    `/api/v1/export` is for the commands and for other tools.
- **§2.**
  - `settings` is an allowlist from slice 39's list: `enabled`, `pausedHosts`,
    `hiddenLangs`, `prefs`, `mixing`, `speech`, `seedSalt`, `lookup` (provider, base URL,
    model, data collection) and `server.url`, both addresses without user name, password
    or query, and `ui` (`uiLang`, `baseLangs`).
  - Restoring settings never changes where words live, the lookup kind, the provider, any
    address or any secret: where requests go is set only in Kotiko's settings, which slice
    28 binds each key to (lead review). The model comes back only for the provider already
    chosen.
  - `stats` is never written and there is no "Include learning stats" box: slice 46 isn't
    built.
- **§3.**
  - English headers: `word, word_with_marks, pronunciation, pronunciation_slow,
    romanization, meaning, forms, language, language_code, base_language,
    base_language_code, note, status, added, pronunciation_source, id`.
  - Slice 13's reader (`bulk/parse.js`) now knows these and the stable ids, plus the
    interface language's own headers, which the dashboard passes in. It keeps
    `native_vocalized`, `pronunciation_careful`, `pronunciation_source`, each row's base
    (`base_language_code`) and the forms column.
  - The "Already in your list" check still uses the sheet's base.
  - `forms` lists the enabled forms.
- **§4.**
  - Header syntax checked against Anki's manual (text import, 2.1.54 and later), including
    `#guid column`, which updates notes in place.
  - `extension/data/anki-notetypes.json` holds only the English name, "Basic (and reversed
    card)", from Anki's manual. The spec ships a name only once it is verified in a running
    Anki; none of the other languages' names were (a first draft took 49 from Anki's
    translation files, whose licensing was also unclear), so for every other "My Anki is
    in" choice the export leaves `#notetype` out and Anki asks which note type to use. The
    dialog defaults to "another language" unless the interface language has a verified
    name (lead review).
  - A field with a double quote is quoted, since Anki reads the file as CSV.
  - The docs link (slice 44) isn't there; the dialog says "In Anki: File, Import, …".
- **§5, merge rules.** 07 has no per-field "newer wins", so:
  - **Same id:** the newer `updated_at` wins as a whole. An older backup leaves a later
    edit alone, without re-adding its old forms. A newer one brings its version back,
    keeping the local key if another word took it.
  - The preview gets a fourth line for the first case: "{n} changed here since this
    backup; yours are kept".
  - **Same natural key, other id:** 07's additive merge (`explicit: false`), keeping the
    local id.
  - **A tombstone newer than the file's word:** "Also restore … you deleted". It starts
    ticked when the store has no live words.
  - **A file word newer than its tombstone:** restored.
  - Restored words keep their ids, times, origin and status. That's what makes the round
    trip deep-equal.
- **§5, server mode.**
  - New words go through `/api/v1/words/batch`, 500 at a time, keeping their ids.
  - Merges and restored deletes are `words.write` edits, checked against the version read.
  - Deletes the server still has are found from this browser's "Recently deleted" (the
    server lists no tombstones). A delete the server has purged is sent as a new word.
  - The server sets its own `created_at`, and turns origin `migrated` into `bulk` (07
    keeps `migrated` for its own upgrade).
- **§5, Undo.**
  - `lastImport` in the store's `meta`, for both homes, for 24 hours, the latest restore
    only.
  - Locally, records the restore created are removed outright and changed ones get their
    exact previous version.
  - A record changed again since is left alone and counted.
- **§5, other.**
  - "Add pronunciations to {n} words (about {k} lookups)" shows in local mode only.
    Ticked, it starts the pronunciation refresh job, as slice 13 does, rather than 09's
    `respell` in groups of 20.
  - The base notice covers any base the file has that the learner doesn't read, not only
    English. "Add" adds as many as fit in four.
  - Over the 20,000-word cap the restore changes nothing and says so.
- **§6.**
  - The page saves the backup, then waits 1.5 s before anything is deleted. There's no
    event for a download link being read.
  - If the server's delete fails, nothing is deleted.
  - The background then stops jobs and waits for running ones, clears alarms and context
    menus, closes and deletes the `kotiko` database, writes `words: []` (open tabs unwrap),
    clears `storage.local` and `storage.session`, and clears `storage.sync` when asked.
    The page clears its own `localStorage` (the theme cache).
  - Root cause found on the way: `content.js` kept a removed key's old value
    (`newValue ?? state[k]`), so clearing storage left swaps on open tabs. A removed key
    now goes back to its default.
  - Until an extension page asks for something, the background opens no store and writes
    nothing. Pages left open (the popup, a welcome tab) react to the cleared storage at
    once, and their status requests fail for 2 s rather than set Kotiko up again. After
    that, or for anything a person asks for, Kotiko starts as a fresh install.
  - "Start again" opens the welcome tab and closes this one. "Close" closes the tab.
  - The browser-sync box shows unless the platform is Android or the browser is Safari.
  - The server box counts the server's words (one `GET`), or omits the count when it
    can't get one.
  - The server's delete also empties `add_requests` (they hold copies of words) and the
    lookup cache (what was looked up). It sets `purged_through_seq` to `last_seq`, so a
    sync cursor from before the reset starts over.
  - The Telegram pairing stays (open question 3).
- **§7.**
  - `bin/kotiko` doesn't exist yet (releases are slice 40), so the commands are mix tasks.
  - `mix kotiko.reset` takes `--yes`, `--no-backup`, `--data-dir` and `--env-file`. Its
    backup is the migrations' `VACUUM INTO` helper into `backups/`.
  - `mix kotiko.export` takes `--output` and `--include-pending`. `mix kotiko.import`
    takes a file.
  - The export is written in pages of 500 by row id; each page is one chunk.
  - The extension doesn't check `/health` for the new routes. An older server's 404 shows
    as "Couldn't delete the words on your server", and nothing is deleted.
- **§8.**
  - One quiet popup banner: "Your {n} words are only in this browser." with "Back up now"
    (opens `#settings/data/backup`, which saves a backup) and "Not now" (30 days).
  - Counts the words the popup shows (the swappable ones).
  - The clock (`backupSince`) starts the first time this version runs, so nobody is
    reminded on day one.
  - "Remind me to back up" is in Your data (`prefs.backupReminder`), shown in local mode.
- **Tests.**
  - `test/unit/backup.test.mjs` (30): schema, reading, merge rules, the 2,000-word
    12-script round trip, Undo, CSV and Anki goldens, CSV read back by bulk add, no
    secrets.
  - `test/bg/backup.test.mjs` (7): restore and Undo in both homes, delete everything with
    and without the server, a failing server.
  - `test/dom/data.test.mjs` (12): the dashboard.
  - The popup reminder (2) and content unwrap-on-clear (1).
  - `server/test/kotiko/backup_test.exs` (13) and
    `server/test/mix/tasks/kotiko.backup_tasks_test.exs` (5).
  - `test/e2e/data.spec.mjs`: backup, delete everything with a swapped tab, restore, in
    Chromium.
  - The fixture server now joins request chunks before decoding. A Cyrillic character
    split across two chunks used to break large batch bodies.
- **Not done:**
  - Firefox end-to-end: the Playwright setup is Chromium only.
  - Opening the files in Excel, LibreOffice, Google Sheets and Anki: manual, per release.
  - The docs-site page and the uninstall URL page (28, 44).

## Acceptance criteria

- [ ] JSON export, delete everything, then import gives a store deep-equal to the
      original (ignoring import bookkeeping), for a 2,000-word fixture in 12 scripts.
- [ ] The CSV opens in Excel (Windows), LibreOffice and Google Sheets with every fixture
      script readable and one row per word, including notes with commas, quotes and newlines.
- [ ] A note starting with `=1+1` appears as text in all three spreadsheet apps.
- [ ] The Anki file imports into Anki with no field mapping, makes one subdeck per
      language, and re-importing an updated export updates notes instead of adding new ones.
- [ ] A version 1 backup (words with `english`, no `base_lang`) imports with every word's
      `gloss` equal to the old `english` and `base_lang: "en"`; with bases `["es"]`, the
      preview offers to add English and nothing is lost either way.
- [ ] With bases `es` and `en`, the CSV has one row per record (犬 / perro / es and
      犬 / dog / en), and the Anki file puts them in `Kotiko::español::japonés` and
      `Kotiko::English::Japanese`.
- [ ] With the interface in Spanish, the CSV header row is Spanish, and slice 13's
      importer reads that CSV back with no column mapping, keeping `pronunciation`,
      `pronunciation_careful`, `native_vocalized`, `romanization` and
      `pronunciation_source` as exported.
- [ ] JSON export and import round-trip every pronunciation field and
      `pronunciation_source` byte for byte; a backup word with "PA-ZHAL-STA" is restored
      with `pronunciation: null` and counted in the preview.
- [ ] The Anki Front for a base-`en` пожалуйста reads "пожа́луйста (pozhaluysta) ·
      pa-ZHAL-sta · Slowly: pa-ZHA-lu-sta", and the Back holds no pronunciation.
- [ ] Importing the same backup twice reports everything as "already identical" the
      second time and creates nothing.
- [ ] A word edited locally after the backup keeps the edit after importing the backup
      (merge, not overwrite).
- [ ] A file from a newer `schemaVersion` is refused with the "newer version" message
      and changes nothing.
- [ ] Undo import within 24 hours restores the pre-import store exactly.
- [ ] After "Delete everything", every storage area is empty, the `kotiko` database does
      not exist, no tab shows a swapped word, and no API key remains (checked by the test
      harness from both a page context and the background).
- [ ] The server checkbox, when ticked, leaves zero rows in `words` and increments
      `reset_epoch`; when unticked, the server is untouched.
- [ ] `DELETE /api/v1/words` without the confirm body returns 400 and deletes nothing.
- [ ] Restoring a backup into server mode sends batches of at most 500 words, keeps the
      backup's ids for words new to the server, and reports the combined counts.
- [ ] Exports never contain an API key or server token (grep test over generated files).

## Test plan

Uses slice [02](../02-test-harness-and-ci/SPEC.md)'s harness.

- **Unit (Node)**: CSV writer (quoting, BOM, CRLF, injection prefix); Anki writer
  (headers, tab and newline stripping, GUID); JSON export and import against
  `spec/export.schema.json`; preview counts and merge targets for every rule in section 5;
  undo snapshot and restore.
- **ExUnit**: export streaming and content; a backup restored through the batch route
  (shared fixtures with the JS tests); delete-all with and without confirm; `reset_epoch`; body limit and auth
  order; the `reset` release command in a temp data directory.
- **Shared fixtures** in `spec/fixtures/export/`: a multi-script backup with
  pronunciations from both sources, a version 1
  backup with `english` fields, a bilingual (es and en bases) backup, a newer-version
  backup, a backup with invalid words; CSV and Anki golden files with English and
  Spanish headers.
- **End-to-end (Playwright)**: export, delete everything, import round trip in Chromium
  and Firefox; delete everything with an open tab showing swaps.
- **Manual, per release**: open the CSV in Excel on Windows and in LibreOffice; import
  the Anki file in the current Anki release; download on Firefox for Android (slice 45).

## Rollout and migration

- No data migration. The server endpoints ship with the server release that carries
  slice 07; the extension hides server checkboxes when the server lacks them (detected
  from slice 07's versioned `/health`).
- The backup reminder starts counting from the update, so nobody is nagged on day one.
- README "Start over" (`README.md:204`) is replaced by `bin/kotiko reset` and the button.
- Changelog: "Back up your words to a file and restore them, export to a spreadsheet or
  Anki, and delete everything with one button."

## Open questions

1. **Backup reminder on by default?** Recommendation: yes, as specified: one dismissible
   line, local mode only, after 30 days. Losing words on uninstall is the worst thing
   local mode can do to someone.
2. **Anki note type.** "Basic (and reversed card)" makes two cards per word.
   Recommendation: keep it; recognition and recall both matter, and Anki users can
   change it in the import dialog.
3. **Server delete-all and Telegram pairing.** Should "delete everything" on the server
   also forget the paired Telegram owner (slice 41)? Recommendation: no; it deletes words
   only. A separate `bin/kotiko unpair` is clearer.

## Future work

- `.apkg` export built with sql.js ([04 S6](../../docs/research/04-architecture-release.md)).
- Monthly automatic backup to the Downloads folder (needs `downloads`, opt-in).
- Backup to a cloud drive (WebDAV, Gist) alongside slice 39's future cloud sync.
- Export to a printable PDF word list.
