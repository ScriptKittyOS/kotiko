# 13 · Bulk add

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [09-shared-word-spec-and-prompt](../09-shared-word-spec-and-prompt/SPEC.md), [24-add-flow-safety](../24-add-flow-safety/SPEC.md); lives in [21-dashboard](../21-dashboard/SPEC.md) |
| **Unblocks** | [22-first-run-onboarding](../22-first-run-onboarding/SPEC.md) (reuses the one-line parser), [48-multi-user-and-classroom](../48-multi-user-and-classroom/SPEC.md) (students review a list a teacher offers in the same table) |
| **Sources** | Maintainer: "Users should be able to paste a full list of words and add them all. Bulk upload; since it's local you can even drop files." ([DECISIONS](../DECISIONS.md)); [05 S17](../../docs/research/05-learner-ux.md); [04 S6 Anki and CSV](../../docs/research/04-architecture-release.md); [06 F14, F21](../../docs/research/06-adversarial-qa.md) |

## Problem

A learner who arrives with vocabulary (a textbook list, a teacher's handout, an Anki deck, a
spreadsheet) has to type each word into the popup, one model call each
(`extension/popup.js:185-203`, `extension/background.js:74-82`). With a free quota of about
50 requests a day ([05 §1](../../docs/research/05-learner-ux.md)), a 200-word list takes four
days and the learner's patience. Most such lists already contain the meaning, so the model
isn't needed at all. Nothing accepts a file, and the server caps request bodies at 64 KB
([DECISIONS](../DECISIONS.md), commit 4705cb0), so a big paste couldn't go through the add
endpoint anyway.

## Goals

- Paste any list, or drop or choose a TXT, CSV, TSV, JSON or Anki plain-text export, and get
  all of it into Mira in three steps.
- Lines that already have a meaning are parsed locally and never touch the model.
- Lines without a meaning are looked up in batches that respect the quota, and the learner
  can finish them by hand if lookups run out.
- A review table before saving: every row's status visible, any row editable or untickable,
  duplicates and existing words recognized.
- After saving, a summary with created / updated / unchanged counts and one Undo for the
  whole batch.

## Non-goals

- Mira's own JSON backup import: [12](../12-export-import-and-delete/SPEC.md) (this slice
  hands `.json` files with Mira's `schemaVersion` to it).
- Anki `.apkg` packages: P2 in [12](../12-export-import-and-delete/SPEC.md); here the learner
  is told how to export plain text.
- Ready-made, bundled or hosted word lists: never ([DECISIONS](../DECISIONS.md)). Every
  list here is one the learner brings, and nothing is saved until they press Add.

## User stories

- As a learner with a vocabulary sheet "gato - cat, perro - dog, …", I want to paste it and
  have every word saved in seconds, without lookups.
- As a learner with an Anki deck, I want to export it as text, drop the file on Mira, and
  pick which column is which.
- As a learner with a bare list of 40 Russian words, I want Mira to look them up within my
  free quota and tell me if some have to wait.
- As a learner who pasted a list containing words I already have, I want those marked and not
  overwritten.

## Specification

### 1. Entry points

| Entry | Steps to the review table |
|---|---|
| Dashboard "Add words" → paste into the box | 2 (Add words, paste) |
| Drop a file anywhere on the dashboard | 1 (drop) |
| Dashboard ⋯ → "Import a list or file" → choose file | 3 |
| Popup: paste text with line breaks → "Open bulk add" | 3 (open popup, paste, Open bulk add); the text is handed over through `storage.session` (`bulkDraft`) and the dashboard opens at `#add` |
| Welcome page "Add it in one go" ([22](../22-first-run-onboarding/SPEC.md)), then paste | 2 |

Saving is one more step ("Add {n} words"). So: paste a list with meanings into the dashboard
and save in 3 steps; drop a file and save in 2.

Dragging is never the only way: every drop target also has a "Choose a file" button (WCAG
2.5.7).

### 2. The sheet

```
#add, empty:

┌──────────────────────────────────────────────────────────────────────────┐
│ Add words                                                            ×   │
│ [ Add a word, any language                              ] [ Auto ▾ ]     │
│                                                                          │
│ ┌ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┐ │
│   Paste a list here, one word per line.                                  │
│ ┆ For example:                                                         ┆ │
│     gato = cat                                                           │
│ ┆   perro - dog                                                        ┆ │
│     спасибо (spasibo) = thanks                                           │
│ ┆   mariposa                                                           ┆ │
│                                                                          │
│ ┆ Or drop a .txt, .csv, .tsv or .json file.   [ Choose a file ]        ┆ │
│ └ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┘ │
│ These words are in  [ Spanish ▾ ]   (rows can override)                  │
└──────────────────────────────────────────────────────────────────────────┘
```

The paste area is a `<textarea>` (so keyboard and screen-reader users can paste normally),
styled with a dotted border. Parsing runs 150 ms after the last change and the review table
replaces the hint text below the area; the textarea collapses to three lines with "Edit
text" to expand.

Dropping a file while dragging over the dashboard shows a full-page overlay: "Drop to add
words from {filename}". Only one file at a time; a second file replaces the first after
confirmation if rows were edited.

### 3. Parsing

All parsing is local, in a pure module `extension/bulk/parse.js` shared with the add box's
inline syntax ([24 §7](../24-add-flow-safety/SPEC.md)).

**Decoding.** Files up to 5 MB. UTF-8 (BOM stripped); UTF-16 LE/BE by BOM; if strict UTF-8
decoding fails, decode as windows-1252 and warn: "Some characters may be wrong. Save the file
as UTF-8 and try again." Line endings `\r\n`, `\r`, `\n`. Text is NFC-normalized
([07](../07-word-model-v2/SPEC.md)).

**Format detection,** in order:

1. `.json`: if it has Mira's `schemaVersion`, hand to [12](../12-export-import-and-delete/SPEC.md);
   if it is an array of objects, map keys case-insensitively (`native|word|front|term`,
   `english|meaning|back|translation|definition`, `romanization|reading|pronunciation`,
   `lang|language`, `note|notes`); otherwise `import_unreadable`.
2. **Anki plain-text export:** header lines starting with `#` (`#separator:tab`,
   `#html:true`, `#columns:Front\tBack`, `#notetype column:`, `#deck column:`,
   `#tags column:`) are read and removed. With `#html:true`, field HTML is reduced to text
   (parsed in an inert `DOMParser` document, `textContent` only; `<br>` becomes "; ");
   `[sound:…]` and `{{c1::…}}` cloze markup are stripped (cloze keeps the answer text).
3. **CSV / TSV:** by extension, or when more than half the non-empty lines contain the same
   count (≥ 2) of tabs, or of commas outside quotes. RFC 4180 quoting. A first row whose cells
   match known header names (as in 1, plus `front`, `back`, `es`, `en`, language names) is a
   header.
4. **Line list:** everything else, one item per line.

**Columns.** For tables, the review shows a mapping row above the table ("Column 1: Word ·
Column 2: Meaning · Column 3: Ignore") with menus: Word, Meaning, Romanization, Note,
Language, Ignore. Defaults: header names; else the first column whose cells are mostly
non-Latin script is Word; else column 1 = Word, column 2 = Meaning (the common textbook
order "native = english"). A "Swap" button exchanges Word and Meaning in one click.

**One line,** for line lists (and the add box):

| Pattern | Result |
|---|---|
| `native = english` (also ` — `, ` – `, ` - ` with spaces, `:` followed by a space, a tab) | split at the first separator |
| `native (romanization) = english` | romanization from the parentheses after the native |
| `english = native` | detected when the left side is Latin and the right is not; otherwise needs the Swap button |
| `english, english` on the meaning side | several English forms |
| `… # note` or `… // note` | note |
| `es: gracias = thanks` | per-line language prefix, a known language name or tag followed by `:` |
| bare `native` | needs a lookup |
| a bare English word (Latin script, found in the list of about 3,000 common English words that [09](../09-shared-word-spec-and-prompt/SPEC.md) ships for its "reject English" rule, while the batch language isn't Latin-script) | flagged "This looks like English", needs a language and a lookup |
| empty lines, lines of only punctuation, numbered prefixes (`1.`, `12)`, `- `, `• `) | prefixes stripped; empty lines skipped |

Hyphenated words (`well-known`) are never split, because a dash separator requires spaces
around it.

**Language.** "These words are in [language ▾]" applies to every row without its own
language. Default: the language hint from the add box, else Focus, else the most recently
used language, else unset (the Add button then reads "Choose a language"). If most native
words are in a script that rules out the chosen language (Han text with Spanish selected),
the selector shows a warning: "These look like Chinese. Change to Chinese?" with one-click
accept. Script checks come from [08](../08-language-tags/SPEC.md).

**Limits.** At most 5,000 rows per batch; beyond that: "Mira can add 5,000 words at a time.
The first 5,000 are below; add the rest after." Each field is validated by
[09](../09-shared-word-spec-and-prompt/SPEC.md) (native 1-64 characters, forms ≥ 2 letters,
not English, and so on).

### 4. Review table

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 48 words · 41 ready · 4 need a meaning · 2 already in your list · 1 problem      │
│ These words are in [ Spanish ▾ ]                          Columns: Word | Meaning │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ [x] gato         cat                 Spanish   Ready                              │
│ [x] perro        dog                 Spanish   Ready                              │
│ [x] mariposa     —                   Spanish   Needs a meaning                    │
│ [ ] gracias      thanks              Spanish   Already in your list               │
│ [x] gracias      thanks, thank you   Spanish   Adds 1 meaning to your word        │
│ [ ] hotel        hotel               Spanish   (!) Same as the English            │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ 4 words need a meaning.  [ Look them up ]  uses about 1 of your 37 lookups left   │
│                                                     [ Add 43 words ]   Cancel     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- Columns: checkbox, Word (native, `dir="auto"`), Meaning (English forms), Romanization
  (shown when any row has one), Language (only when rows differ), Status.
- Every cell is editable in place (Enter or blur commits). Editing a "Needs a meaning" row's
  meaning makes it Ready.
- **Statuses** (icon plus words, [06 §4.2](../06-design-system/SPEC.md)):

| Status | Meaning | Ticked by default |
|---|---|---|
| Ready | Has word, meaning and language; new | yes |
| Needs a meaning | No English yet | yes (saved only after a lookup or an edit) |
| Looking up… | In a lookup batch | yes |
| Already in your list | Same (lang, native) exists and nothing would change | no |
| Adds {k} meanings to your word | Exists; would union new forms or fill empty fields (07 merge) | yes |
| Duplicate in this list | Same (lang, native) appears earlier in this batch; merged into the first | no |
| Same as the English | native equals an English form ([01 S7](../../docs/research/01-language-mixing.md)) | no |
| Problem: {reason} | Fails validation (too long, empty, English language) | no, and can't be ticked until fixed |

- Header line counts each status; clicking a count filters the table to it.
- "Untick all", "Tick all ready", and sorting by status are in a small menu.
- The table is virtualized like the dashboard list for large files.

### 5. Lookups for rows without a meaning

- "Look them up" sends **only** the ticked "Needs a meaning" rows, in batches of up to 20
  words per request, with the batch language as `hint_lang`. The batch prompt is this slice's
  addition to [09](../09-shared-word-spec-and-prompt/SPEC.md)'s `spec/` folder
  (`prompt-batch.md`: input is a numbered list of native words plus the language; output is
  one entry per input index, validated by 09's validator entry by entry). It ships only if
  09's golden-set evaluation, run in batch form, scores within 2 points of single lookups;
  otherwise each row becomes its own add job ([24](../24-add-flow-safety/SPEC.md)) and the
  cost line counts one lookup per word. Calls go through
  [10](../10-llm-client-resilience/SPEC.md)'s client with its "Bulk add batch" deadline (45 s,
  2 attempts) and quota tracking.
- The cost line shows "uses about {k} of your {r} lookups left" when the remaining quota is
  known, otherwise "uses about {k} lookups".
- Lookups do not block the table: rows turn "Looking up…" and update as each batch returns;
  the learner can edit or save other rows meanwhile. "Add {n} words" saves Ready rows now;
  still-pending lookups continue as add jobs ([24](../24-add-flow-safety/SPEC.md)) and save
  when they finish, so closing the dashboard is safe.
- When quota runs out (`quota_exhausted`, [25](../25-plain-language-errors/SPEC.md)) the
  remaining rows go back to "Needs a meaning" with: "You've used today's free lookups. Add
  meanings yourself, or save these {k} words for later." The second option queues them as
  waiting add jobs that resume when quota returns.
- A lookup result whose native differs from the input (the model corrected spelling) shows
  "Mira read “spaseeba” as спасибо" in the row, pre-ticked, editable. If that result
  arrives after "Add {n} words" (a pending lookup finishing as an add job), it is not saved
  on its own: the job waits in 24's `needs_choice` state with the line "Mira read
  “spaseeba” as спасибо. Add it?" so the learner sees the word Mira will add before it
  is added.
- Results failing validation become "Problem: the lookup came back unclear" with the row kept.

### 6. Saving and the summary

"Add {n} words" writes all ticked Ready rows through [07](../07-word-model-v2/SPEC.md)'s
batch add: locally in one IndexedDB transaction ([11](../11-local-first-mode/SPEC.md)), which
causes a single projection write; with a server holding the words, `POST
/api/v1/words/batch` with up to 500 words per call (its 1 MB body limit), each call with its
own `client_request_id` so retries are idempotent ([24 §3](../24-add-flow-safety/SPEC.md)).
Words get 07's provenance: `origin: "bulk"` for pasted lists and `origin: "import"` for
files, with `source_text` set to the original line (so the dashboard can show "Added from
“gato - cat”"). The batch's created and updated word ids are kept in the bulk job record, which
is what "See them" and "Undo" use.

The sheet then shows:

```
┌────────────────────────────────────────────────────────────┐
│ (✓) Added 41 words to Spanish.                             │
│     2 were already in your list. 1 got a new meaning.      │
│     4 are still being looked up.                           │
│     [ See them ]    Undo    Add more                       │
└────────────────────────────────────────────────────────────┘
```

"See them" filters the dashboard list to this batch's word ids. "Undo" removes every created
word and restores every updated word from this batch (per-word rules from
[24 §5](../24-add-flow-safety/SPEC.md)), available until the next import or 24 hours.

### 7. Edge cases

- **Mixed languages in one paste:** rows with a language prefix or a Language column keep
  theirs; the rest take the batch language.
- **Right-to-left words:** every cell is `<bdi>`; separators are detected on logical order, so
  `شكرا = thanks` parses correctly whatever the display direction.
- **Very long lines** (sentences): rows over 64 characters native become "Problem: too long
  for a word", with "Split into words" that replaces the row with one row per token.
- **Spreadsheets saved as .xlsx:** "Mira reads .csv files. In your spreadsheet app choose
  Save as → CSV, then drop that file."
- **Huge files** over 5 MB: `import_unreadable` with "This file is bigger than 5 MB."
- **Binary or unknown files:** `import_unreadable`.
- **Mira's own CSV exports:** [12](../12-export-import-and-delete/SPEC.md) prefixes cells that
  start with `=`, `+`, `-`, `@`, a tab or a carriage return with an apostrophe to stop formula
  injection. When a CSV's header matches 12's export header, a leading apostrophe followed by
  one of those characters is stripped, so exports round-trip.
- **Formula injection:** values starting with `=`, `+`, `-`, `@` are stored as text; this only
  matters for CSV export, handled in [12](../12-export-import-and-delete/SPEC.md).
- **Server unreachable while saving** (server mode): rows are stored locally and queued;
  the summary says "Saved here. They'll reach your server when it's back."

### 8. Privacy

Files are read in the page with `File.text()` and never uploaded anywhere; only the "Needs a
meaning" words are sent, and only to the learner's configured lookup service. The paste draft
lives in `storage.session` and is cleared after saving or cancelling.

## Acceptance criteria

- [ ] Pasting 200 lines of `native = english` and pressing "Add 200 words" saves them with
      zero model calls (verified by the mock backend's request log) in 3 steps from the
      dashboard.
- [ ] Dropping an Anki "Notes in Plain Text" export with `#separator:tab`, `#html:true` and
      `#columns:` headers produces a correctly mapped table with HTML and `[sound:]` removed.
- [ ] A CSV with a BOM, quoted commas and a header row maps columns from the header.
- [ ] `well-known = conocido` is not split at the hyphen; `gato - cat` is.
- [ ] Existing words show "Already in your list" (unticked) or "Adds {k} meanings" correctly
      against a fixture word list.
- [ ] 45 bare words with a batch size of 20 cause exactly 3 lookup requests; with the quota
      mocked to 2 remaining, the last batch's rows return to "Needs a meaning" with the quota
      message.
- [ ] Closing the dashboard while lookups run still saves those words when they finish.
- [ ] Undo after an import of 300 words restores the exact previous word list.
- [ ] Every drop target has a working "Choose a file" button reachable by keyboard.
- [ ] A 5,000-row file parses and renders its review table in under 1 s.

## Test plan

- **Unit (Node):** `parse.js` against a fixture folder: textbook lists in 12 languages and 8
  scripts, Anki exports from Anki 2.1.55+ and older (no headers), Excel CSV (windows-1252 and
  UTF-8 with BOM), Google Sheets TSV, Quizlet export ("term\tdefinition"), JSON arrays,
  RTL lines, numbered lists, cloze notes, malformed quoting.
- **Integration:** batch lookup with a mock model returning good, partial, corrected and
  invalid entries; quota exhaustion mid-run; idempotent retries.
- **End-to-end:** paste, drop and choose-file paths; popup handoff; review edits; summary and
  Undo; dashboard close mid-lookup.
- **Manual:** real exports from Anki, Quizlet and a spreadsheet app.

## Rollout and migration

New feature; nothing to migrate. Server mode needs the batch upsert endpoint from
[07](../07-word-model-v2/SPEC.md); against an older server, bulk add saves one word per
request with a progress line ("Saving 120 of 200…"). Changelog: "Paste a whole list or drop a
file to add many words at once. Lines with meanings never use your lookups."

## Open questions

1. **Default column order for two-column lists without headers.** Recommendation: Word then
   Meaning ("gato = cat"), with automatic swap when the script makes it obvious and a one-click
   Swap otherwise.
2. **Batch size per lookup.** Recommendation: 20, tuned with the golden set in
   [09](../09-shared-word-spec-and-prompt/SPEC.md); larger batches save quota but raise the
   error rate on small free models.

## Future work

- `.apkg` import ([12](../12-export-import-and-delete/SPEC.md)).
- Pick words from a pasted paragraph (tokenize, show checkboxes) as a third mode beside list
  and file.
