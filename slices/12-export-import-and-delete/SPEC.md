# 12 · Export, import and delete

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md) |
| **Unblocks** | [11-local-first-mode](../11-local-first-mode/SPEC.md) (mode switches use the export endpoint), [28-privacy-and-store-readiness](../28-privacy-and-store-readiness/SPEC.md) (deletion is a store expectation), [39-multi-device-sync](../39-multi-device-sync/SPEC.md) (reset epoch) |
| **Sources** | [04 summary, S5, S6, S7](../../docs/research/04-architecture-release.md); [05 S17, section 3.5](../../docs/research/05-learner-ux.md); [03 C7](../../docs/research/03-browser-extension.md) |

## Problem

Learners can't get their words out of Mira, can't bring a backup back, and can't delete
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
- "Delete everything" removes every piece of Mira data the extension holds, and
  optionally everything the connected server holds, and says what it can't delete.
- A gentle reminder to back up when the learner's words exist only in this browser.
- Server endpoints for export and import that slice 11 uses to move words between modes.

## Non-goals

- Importing CSV, TSV, TXT or Anki files, and pasted lists: slice [13](../13-bulk-add/SPEC.md).
  This slice imports only Mira's own JSON.
- A native Anki `.apkg` file (SQLite in a zip): future work.
- Automatic scheduled backups to disk (needs the `downloads` permission): future work.
- Importing word lists published by someone else, by URL or file: never
  ([DECISIONS](../DECISIONS.md)). This slice restores the learner's own backups; a list
  from anywhere else goes through bulk add's review ([13](../13-bulk-add/SPEC.md)).
- Per-word undo after a delete: slices [21](../21-dashboard/SPEC.md) and [24](../24-add-flow-safety/SPEC.md).

## User stories

- As a learner in local mode, I want a backup file I can keep, so that reinstalling the
  browser doesn't cost me months of words.
- As an Anki user, I want my Mira words as Anki cards, so that I can drill them.
- As a teacher, I want a spreadsheet of my words, so that I can share or print them.
- As a learner moving to a new computer, I want to restore my backup and get exactly my
  list back.
- As someone leaving Mira, I want one button that deletes everything, and to be told
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

File name: `mira-backup-YYYY-MM-DD.json`, UTF-8, no BOM, pretty-printed with two spaces
so it diffs well.

```json
{
  "format": "mira.words",
  "schemaVersion": 1,
  "exportedAt": "2026-10-01T12:00:00Z",
  "app": { "name": "Mira", "version": "0.3.0", "source": "extension" },
  "words": [ { "...": "one slice 07 word, exactly as spec/word.schema.json defines it" } ],
  "settings": { "...": "optional, non-secret settings from slice 39's list" },
  "stats": { "...": "optional, slice 46's daily counters" }
}
```

- `words` holds every word that is not deleted, in every status, with every field
  slice 07 defines (ids, timestamps, status, origin, source text, forms).
  Tombstones are left out.
- `settings` and `stats` are included by default with a checkbox each ("Include
  settings", "Include learning stats"). Secrets (API keys, server token) are never
  included; slice 11 keeps them out of reach of this code entirely.
- `schemaVersion` follows `spec/export.schema.json`, which this slice adds to slice 09's
  `spec/` folder so the extension and the server validate the same document. A newer
  Mira reads every older version; an older Mira refuses a newer file with
  "This backup was made by a newer version of Mira. Update Mira, then try again."

### 3. Spreadsheet (CSV)

File name: `mira-words-YYYY-MM-DD.csv`. UTF-8 **with** a byte-order mark, so Excel on
Windows shows non-Latin scripts correctly ([04 S6](../../docs/research/04-architecture-release.md)).
RFC 4180: comma separator, CRLF line ends, double quotes around fields that contain a
comma, quote or newline.

Columns, in this order, with this header row:

| Column | Content |
|---|---|
| `native` | The word |
| `romanization` | Empty when none |
| `english` | Main meaning |
| `forms` | English forms joined with ` | ` |
| `language` | Display name in the UI language |
| `language_code` | BCP 47 tag (slice 08) |
| `note` | |
| `status` | Slice 07's values (`active`, `paused`, and any slice 35 adds) |
| `added` | `YYYY-MM-DD` in local time |
| `id` | UUID, last so it stays out of the way |

**Formula injection.** A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage
return is prefixed with a single quote (OWASP's guidance), because notes and forms come
from a model. For a Mira CSV to round-trip, slice 13's CSV import must strip a leading
quote that is followed by one of those characters (an addition slice 13 doesn't yet
specify).

### 4. Anki cards (TSV)

File name: `mira-anki-YYYY-MM-DD.txt`. Anki's text import with file headers (Anki
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
| Front | `native`, then ` (romanization)` when present |
| Back | `english`, then ` - note` when present |
| Language | Display name |
| Deck | `Mira::<Language>`, so each language gets a subdeck |
| Tags | `mira lang::<code>` |
| GUID | `mira-<word id>`, so re-importing an updated export updates the same notes instead of duplicating them |

Tabs and newlines inside fields are replaced with spaces. The dialog says "In Anki: File,
Import, choose this file." A link to the docs site (slice 44) shows screenshots.

### 5. Importing a backup

"Import a backup…" accepts a `.json` file by file picker or drop. Limits: 20 MB file,
20,000 words (the vocabulary cap from slice 09).

1. **Parse and check** in the extension page: `format`, `schemaVersion`, then each word
   through slice 09's validator. Invalid words are listed, not fatal.
2. **Preview**, computed against the local store without writing:

   ```
   Restore mira-backup-2026-09-30.json
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
- Otherwise, same natural key `(lang, native_key, sense)` exists: merge into the existing word and
  keep the local id.
- Local tombstone for the same id, newer than the file's `updated_at`: skipped unless
  "Also restore words you deleted" is ticked (default on for a full restore into an empty
  store, off otherwise).
- Otherwise: insert with the file's id.

**Undo.** The result line says "Restored 305 words. Undo" for 24 hours. Undo deletes the
words this import created and puts back the previous versions of merged words, kept in
the store's `meta` under `lastImport`. Only the most recent import can be undone.

### 6. Delete everything

"Delete everything…" opens:

```
Delete everything Mira keeps in this browser?
  312 words, your settings, learning stats, and your OpenRouter key.

[x] Download a backup first
[ ] Also clear settings synced to your other browsers
[ ] Also delete all 1,204 words on my Mira server (home.example:4747)

Mira can't delete: messages in your Telegram chat, what your model provider
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
4. `indexedDB.deleteDatabase("mira")` (words, jobs, secrets, stats, cache).
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

**`bin/mira reset`** (release command; `mix mira.reset` in development, after slice 04's
rename): prints the word count, asks `Delete all 1204 words? [y/N]`, takes a
`VACUUM INTO` backup first (slice 40's backup helper) unless `--no-backup`, then does
the same as the endpoint. `bin/mira export > file.json` and `bin/mira import file.json`
cover files too large for HTTP.

### 8. Backup reminder

Only when words live in the browser (`wordsHome = "local"`, slice 11) and there are at
least 20 words. If the last export or import is more than 30 days ago (or never), the
popup's status area shows one quiet line: "Your 312 words are only in this browser.
Back up now · Not now". "Not now" hides it for 30 days. A setting, "Remind me to back
up", defaults on. No system notifications.

## Acceptance criteria

- [ ] JSON export, delete everything, then import gives a store deep-equal to the
      original (ignoring import bookkeeping), for a 2,000-word fixture in 12 scripts.
- [ ] The CSV opens in Excel (Windows), LibreOffice and Google Sheets with every fixture
      script readable and one row per word, including notes with commas, quotes and newlines.
- [ ] A note starting with `=1+1` appears as text in all three spreadsheet apps.
- [ ] The Anki file imports into Anki with no field mapping, makes one subdeck per
      language, and re-importing an updated export updates notes instead of adding new ones.
- [ ] Importing the same backup twice reports everything as "already identical" the
      second time and creates nothing.
- [ ] A word edited locally after the backup keeps the edit after importing the backup
      (merge, not overwrite).
- [ ] A file from a newer `schemaVersion` is refused with the "newer version" message
      and changes nothing.
- [ ] Undo import within 24 hours restores the pre-import store exactly.
- [ ] After "Delete everything", every storage area is empty, the `mira` database does
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
- **Shared fixtures** in `spec/fixtures/export/`: a multi-script backup, an old-version
  backup, a newer-version backup, a backup with invalid words.
- **End-to-end (Playwright)**: export, delete everything, import round trip in Chromium
  and Firefox; delete everything with an open tab showing swaps.
- **Manual, per release**: open the CSV in Excel on Windows and in LibreOffice; import
  the Anki file in the current Anki release; download on Firefox for Android (slice 45).

## Rollout and migration

- No data migration. The server endpoints ship with the server release that carries
  slice 07; the extension hides server checkboxes when the server lacks them (detected
  from slice 07's versioned `/health`).
- The backup reminder starts counting from the update, so nobody is nagged on day one.
- README "Start over" (`README.md:204`) is replaced by `bin/mira reset` and the button.
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
   only. A separate `bin/mira unpair` is clearer.

## Future work

- `.apkg` export built with sql.js ([04 S6](../../docs/research/04-architecture-release.md)).
- Monthly automatic backup to the Downloads folder (needs `downloads`, opt-in).
- Backup to a cloud drive (WebDAV, Gist) alongside slice 39's future cloud sync.
- Export to a printable PDF word list.
