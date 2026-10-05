# 13 · Bulk add

| | |
|---|---|
| **Status** | Built (2026-10-05); see Implementation notes |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [09-shared-word-spec-and-prompt](../09-shared-word-spec-and-prompt/SPEC.md), [24-add-flow-safety](../24-add-flow-safety/SPEC.md), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (base languages); uses [14](../14-matcher-engine/SPEC.md)'s tokenizer; lives in [21-dashboard](../21-dashboard/SPEC.md) |
| **Unblocks** | [22-first-run-onboarding](../22-first-run-onboarding/SPEC.md) (reuses the one-line parser), [48-multi-user-and-classroom](../48-multi-user-and-classroom/SPEC.md) (students review a list a teacher offers in the same table), [50](../50-ui-localization-and-base-language/SPEC.md) ("Add meanings in a new base" reuses the batched lookup) |
| **Sources** | Maintainer: "Users should be able to paste a full list of words and add them all. Bulk upload; since it's local you can even drop files." ([DECISIONS](../DECISIONS.md)); [05 S17](../../docs/research/05-learner-ux.md); [04 S6 Anki and CSV](../../docs/research/04-architecture-release.md); [06 F14, F21](../../docs/research/06-adversarial-qa.md) |

## Problem

A learner who arrives with vocabulary (a textbook list, a teacher's handout, an Anki deck, a
spreadsheet) has to type each word into the popup, one model call each
(`extension/popup.js:185-203`, `extension/background.js:74-82`). With a free quota of about
50 requests a day ([05 §1](../../docs/research/05-learner-ux.md)), a 200-word list takes four
days and the learner's patience. Most such lists already contain the meaning, so the model
isn't needed at all. Those meanings are in whatever language the learner reads: an English
reader's sheet says "gato - cat", a Spanish reader learning English has "dog - perro", a
Japanese reader learning Korean has "고양이：猫". Kotiko must read all three without
assuming the meaning side is English ([DECISIONS 2026-10-01](../DECISIONS.md)).
Nothing accepts a file, and the server caps request bodies at 64 KB
([DECISIONS](../DECISIONS.md), commit 4705cb0), so a big paste couldn't go through the add
endpoint anyway.

## Goals

- Paste any list, or drop or choose a TXT, CSV, TSV, JSON or Anki plain-text export, and get
  all of it into Kotiko in three steps.
- Lines that already have a meaning are parsed locally and never touch the model, whatever
  the learner's base language, including bases without spaces (Japanese, Chinese, Thai).
- Which side of a line is the word being learned and which is the meaning is decided from
  the learner's base languages and the scripts and language of each column, never by
  assuming the meaning is English.
- Lines without a meaning are looked up in batches that respect the quota, and the learner
  can finish them by hand if lookups run out.
- A review table before saving: every row's status visible, any row editable or untickable,
  duplicates and existing words recognized.
- After saving, a summary with created / updated / unchanged counts and one Undo for the
  whole batch.

## Non-goals

- Kotiko's own JSON backup import: [12](../12-export-import-and-delete/SPEC.md) (this slice
  hands `.json` files with Kotiko's `schemaVersion` to it).
- Anki `.apkg` packages: P2 in [12](../12-export-import-and-delete/SPEC.md); here the learner
  is told how to export plain text.
- Ready-made, bundled or hosted word lists: never ([DECISIONS](../DECISIONS.md)). Every
  list here is one the learner brings, and nothing is saved until they press Add.

## User stories

- As a learner with a vocabulary sheet "gato - cat, perro - dog, …", I want to paste it and
  have every word saved in seconds, without lookups.
- As a Spanish speaker learning English with a sheet "dog - perro, cat - gato, …", I want
  Kotiko to know that "dog" is the word I'm learning and "perro" the meaning, without
  choosing columns.
- As a Japanese reader learning Korean, I want "고양이：猫" (full-width colon, no spaces)
  read as one row.
- As a Spanish reader, I want to paste a list of Spanish words ("perro, gato, mariposa")
  and have Kotiko find their Japanese words.
- As a learner with an Anki deck, I want to export it as text, drop the file on Kotiko, and
  pick which column is which.
- As a learner with a bare list of 40 Russian words, I want Kotiko to look them up within my
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
│ Learning  [ Spanish ▾ ]  (rows can override)   Meanings in  [ English ▾ ] │
└──────────────────────────────────────────────────────────────────────────┘
```

The same sheet for a Spanish reader learning English (interface in Spanish; the example
lines are the `bulk_example_*` messages of the interface locale, slice 50):

```
│   Pega una lista aquí, una palabra por línea.                            │
│ ┆ Por ejemplo:                                                         ┆ │
│     dog = perro                                                          │
│ ┆   cat - gato                                                         ┆ │
│     спасибо (spasibo) = gracias                                          │
│ ┆   butterfly                                                          ┆ │
│ Aprendiendo  [ inglés ▾ ]               Significados en  [ español ▾ ]   │
```

**Meanings in** is the list's base language: default the learner's primary base
(`s:ui.baseLangs[0]`, slice 50), with the other bases in the menu; it is shown only when
the learner has more than one base. Every meaning in the list is stored as `gloss` and
forms in that base. "Learning" is the target language, as before.

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
decoding fails, decode as windows-1252 and warn (in the interface language): "Some characters may be wrong. Save the file
as UTF-8 and try again." Line endings `\r\n`, `\r`, `\n`. Text is NFC-normalized
([07](../07-word-model-v2/SPEC.md)).

**Format detection,** in order:

1. `.json`: if it has Kotiko's `schemaVersion`, hand to [12](../12-export-import-and-delete/SPEC.md);
   if it is an array of objects, map keys case-insensitively (`native|word|front|term`,
   `gloss|meaning|back|translation|definition|english`,
   `romanization|transliteration|translit|pinyin|romaji|jyutping` (to `romanization`),
   `pronunciation|respelling` (to `pronunciation`), `pronunciation_careful|careful` (to
   `pronunciation_careful`), `native_vocalized`, `pronunciation_source`, `reading` (to `romanization` when its values are in Latin
   script; otherwise ignored until [36](../36-grammar-and-senses/SPEC.md) adds Reading),
   `lang|language`, `base_lang|base_language`, `note|notes`, plus the localized column
   names below); a key that is a language tag or name (`"es"`, `"en"`, `"Japanese"`) is
   that language's column (see Columns); otherwise `import_unreadable`.
2. **Anki plain-text export:** header lines starting with `#` (`#separator:tab`,
   `#html:true`, `#columns:Front\tBack`, `#notetype column:`, `#deck column:`,
   `#tags column:`) are read and removed. With `#html:true`, field HTML is reduced to text
   (parsed in an inert `DOMParser` document, `textContent` only; `<br>` becomes "; ");
   `[sound:…]` and `{{c1::…}}` cloze markup are stripped (cloze keeps the answer text).
   A Kotiko Anki export (tags start with `kotiko`, GUIDs are `kotiko-<uuid>`) is read with
   [12](../12-export-import-and-delete/SPEC.md) section 4's layout: the Front's parts after
   the word are the romanization in parentheses, then, each after ` · `, the pronunciation
   and the careful form (after its "Slowly:" label in any shipped locale).
3. **CSV / TSV:** by extension, or when more than half the non-empty lines contain the same
   count (≥ 2) of tabs, or of commas outside quotes, or of `；` (full-width semicolons, common
   in CJK spreadsheets). RFC 4180 quoting. A first row whose cells match known header names
   is a header: the names in 1; every shipped locale's `export_csv_col_*` messages (so a
   Spanish Kotiko CSV's `palabra, significado, …` header round-trips, slice 12); `front`,
   `back`; and language tags or names in any shipped interface locale (`es`, `en`,
   `Spanish`, `español`, `日本語`).
4. **Line list:** everything else, one item per line.

**Columns.** For tables, the review shows a mapping row above the table ("Column 1: Word ·
Column 2: Meaning · Column 3: Ignore") with menus: Word, Meaning, Romanization,
Pronunciation, Note, Language, Ignore. A "Swap" button exchanges Word and Meaning in one
click. Defaults come from the orientation rules below, applied to whole columns.

**Romanization or pronunciation.** The two are different fields
([07](../07-word-model-v2/SPEC.md) section 7): a column headed "Pronunciation" (or
`pronunciación`, the shipped locales' `export_csv_col_pronunciation`) maps to Pronunciation;
"Romanization", "Transliteration", "Pinyin", "Romaji" and "Jyutping" (and their localized
names) map to Romanization. An unheaded column of Latin text beside a non-Latin word
defaults to Romanization, unless most of its values look like respellings (hyphenated
syllables with one all-capital syllable, such as "spa-SEE-ba"), in which case it defaults
to Pronunciation. A pronunciation from the learner's file is saved with
`pronunciation_source: "user"` (07) after 09's pronunciation checks for the list's base
(a Kotiko CSV's own `pronunciation_source` column, slice 12, is kept as exported instead);
one that fails them (IPA, accent marks for stress, two capital syllables) is dropped with a
row note, "Pronunciation not used: not in Kotiko's format. Kotiko will write one." ("No se
usó la pronunciación: no está en el formato de Kotiko. Kotiko escribirá una."), and the row
is treated as having none.

**Orientation: which side is the word being learned.** Decided once per list (or per
table), never per row and never by assuming the meaning is English. With `B` = the list's
base ("Meanings in") and `T` = the target ("Learning", if set), in order:

1. **Headers.** A column headed with a language tag or name is that language: the one
   matching `B` (slice 50's "same base" test) is Meaning, the other is Word. Known
   header names (`word`, `meaning`, `palabra`, `significado`, …) decide directly.
2. **Script.** Using [08](../08-language-tags/SPEC.md)'s script table: if `B`'s script and
   `T`'s script differ, the side whose text is mostly in `B`'s script is Meaning
   (Spanish base and Russian target: "собака = perro" puts собака as Word; Japanese base
   and Korean target: "고양이：猫" puts 고양이 as Word). When `T` is unset, a side mostly
   in a script that `B` doesn't use is Word.
3. **Language of each column.** When scripts don't settle it (Spanish base, English
   target: both Latin), each side's text across all rows is joined and passed to
   `i18n.detectLanguage` (available in extension pages in Chrome and Firefox), plus a
   count of tokens found in `B`'s stopwords (slice 50 §5: `spec/lang/<B>/stopwords.txt`,
   else `B`'s entry in `_generic/stopwords.json`).
   The side that detects as `B` with reliability, or that has clearly more of `B`'s
   common words, is Meaning. "dog = perro / cat = gato / house = casa" with base `es`
   puts dog, cat, house as Word.
4. **Undecided** (short lists, cognates): column 1 = Word, column 2 = Meaning, the most
   common textbook order, with a visible question above the table: "Are you learning
   **dog** or **perro**?" [dog] [perro], which sets the orientation for the whole list.

A side detected as `B` is never saved as a word to learn in `B` (slice 09's
`target_is_base` rule).

**One line,** for line lists (and the add box):

| Pattern | Result |
|---|---|
| `native = gloss` (also `→`, ` — `, ` – `, ` - ` with spaces, `:` followed by a space, a tab, and the full-width `＝` and `：` with or without spaces) | split at the first separator; sides oriented by the rules above |
| `native (romanization) = gloss` | romanization from the parentheses (`()` or full-width `（）`) after the native; when the text in parentheses has hyphenated syllables with one all-capital syllable and passes 09's pronunciation checks for the base ("спасибо (spa-SEE-ba) = thanks"), it is the pronunciation instead |
| `gloss = native` | the same line reversed; the list's orientation decides, so "dog = perro" and "perro = dog" both work for a Spanish reader learning English once the list is oriented |
| `gloss, gloss` on the meaning side (also `;`, `/`, `、`, `，`, `／`) | several forms of the meaning in the base language |
| `… # note` or `… // note` | note, in the base language |
| `es: gracias = thanks`, `ja：猫 = gato` | per-line target-language prefix, a known language tag or name (in any shipped interface locale) followed by `:` or `：` |
| bare `native` | needs a lookup |
| a bare word in the list's base language (scripts per rule 2, or the whole bare column detecting as `B` per rule 3) | "In español: Kotiko will find the japonés word" when a target is set: the lookup asks for the target word for this base-language word ("perro" → 犬), and the line becomes the meaning; with no target set, it needs one |
| empty lines, lines of only punctuation, numbered prefixes (`1.`, `12)`, `- `, `• `, `①`, `一、`) | prefixes stripped; empty lines skipped |

Separators are matched on the raw line before any tokenizing. Hyphenated words
(`well-known`, `bien-estar`) are never split, because an ASCII dash separator requires
spaces around it; `→`, `＝` and `：` need no spaces, since base languages without spaces
("猫＝gato", "고양이：猫") write them that way. A plain `:` without a following space is
not a separator (times, URLs, `C:`). The leading `¿` and `¡` and trailing `?` and `!` are
stripped from each side ("¿perro? = dog" reads as perro), per slice 09's normalisation.

**Examples** (fixtures in the test plan):

| Line | Base | Target | Word | Meaning (gloss, forms) |
|---|---|---|---|---|
| `gato = cat` | en | es | gato | cat |
| `dog - perro` | es | en | dog | perro |
| `perro → dog` | es | en | dog | perro (list oriented by rule 3) |
| `собака (sobaka) = perro, perros` | es | ru | собака | perro; forms perro, perros |
| `고양이：猫` | ja | ko | 고양이 | 猫 |
| `猫＝gato` | es | ja | 猫 | gato |
| `water = l'eau` | fr | en | water | eau (the elided article is dropped from the meaning with a note, because slice 14 splits l' from eau on French pages, so "l'eau" as a form would never match) |
| `Hund = perro` | es | de | Hund (capital kept: German nouns, slice 50 `casing.json`) | perro |
| `perro` (bare) | es | ja | looked up | perro |

**Language.** "Learning [language ▾]" applies to every row without its own language.
Default: the language hint from the add box, else Focus, else the most recently used
language, else unset (the Add button then reads "Choose a language"). If most words are
in a script that rules out the chosen language (Han text with Spanish selected), the
selector shows a warning: "These look like Chinese. Change to Chinese?" with one-click
accept. Script checks come from [08](../08-language-tags/SPEC.md). A target equal to the
list's base is refused in the selector ("You read español already; choose the language
you're learning").

**Several bases.** A list's meanings are in one base, so its rows create records for that
base only. When the learner has other bases, the review shows an unticked option: "Also
add meanings in English (uses about {k} lookups)", which sends the ready rows through the
batch lookup for the other bases (section 5). Rows that need a lookup anyway are looked
up for every base by default, as slice 50 section 3 specifies.

**Splitting text into words** anywhere in this slice ("Split into words" for long rows,
counting words in a column, picking words from a paragraph) uses
[14](../14-matcher-engine/SPEC.md)'s tokenizer for the language of that text
(`Intl.Segmenter` with the base's boundary rules), never a split on spaces, so a pasted
Japanese line "犬が好きです" splits into 犬 / が / 好き / です.

**Limits.** At most 5,000 rows per batch; beyond that: "Kotiko can add 5,000 words at a time.
The first 5,000 are below; add the rest after." Each field is validated by
[09](../09-shared-word-spec-and-prompt/SPEC.md) with the list's base data (native 1-64
characters, form length per base, stopwords of that base, the word's language not equal
to the base, and so on).

### 4. Review table

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 48 words · 41 ready · 4 need a meaning · 2 already in your list · 1 problem      │
│ Learning [ Spanish ▾ ]   Meanings in [ English ▾ ]        Columns: Word | Meaning │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ [x] gato         cat                 Spanish   Ready                              │
│ [x] perro        dog                 Spanish   Ready                              │
│ [x] mariposa     —                   Spanish   Needs a meaning                    │
│ [ ] gracias      thanks              Spanish   Already in your list               │
│ [x] gracias      thanks, thank you   Spanish   Adds 1 meaning to your word        │
│ [ ] hotel        hotel               Spanish   (!) Same as the meaning            │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ 4 words need a meaning.  [ Look them up ]  uses about 1 of your 37 lookups left   │
│                                                     [ Add 43 words ]   Cancel     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- Columns: checkbox, Word (native, `dir="auto"`), Meaning (gloss and forms in the list's
  base, `dir="auto"`), Romanization (shown when any row has one), Pronunciation (shown when
  any row has one), Language (only when rows differ), Status. Column titles and statuses are in the interface language.
- Every cell is editable in place (Enter or blur commits). Editing a "Needs a meaning" row's
  meaning makes it Ready.
- **Statuses** (icon plus words, [06 §4.2](../06-design-system/SPEC.md)):

| Status | Meaning | Ticked by default |
|---|---|---|
| Ready | Has word, meaning and language; new | yes |
| Needs a meaning | No meaning in the list's base yet | yes (saved only after a lookup or an edit) |
| Looking up… | In a lookup batch | yes |
| Already in your list | Same (lang, native, base) exists and nothing would change | no |
| Adds {k} meanings to your word | Exists; would union new forms or fill empty fields (07 merge) | yes |
| Duplicate in this list | Same (lang, native, base) appears earlier in this batch; merged into the first | no |
| Same as the meaning | native equals the gloss or a form (hotel = hotel; [01 S7](../../docs/research/01-language-mixing.md); 09's `same_as_gloss`) | no |
| Problem: {reason} | Fails validation (too long, empty, a word in a language you read) | no, and can't be ticked until fixed |

- Header line counts each status; clicking a count filters the table to it.
- "Untick all", "Tick all ready", and sorting by status are in a small menu.
- The table is virtualized like the dashboard list for large files.

### 5. Lookups for rows without a meaning

- "Look them up" sends **only** the ticked "Needs a meaning" rows, in batches of up to 20
  words per request, with the batch language as `hint_lang` and the learner's bases as
  `base_langs` (09's request contract). The batch prompt is this slice's addition to
  [09](../09-shared-word-spec-and-prompt/SPEC.md)'s `spec/` folder (`prompt-batch.md`:
  input is a numbered list of words plus the target language, each marked as a target
  word to explain or a base-language word to find in the target; output is one entry per
  input index and base, in 09's output schema, validated by 09's validator entry by
  entry). It ships only if
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
  "Kotiko read “spaseeba” as спасибо" (es: "Kotiko leyó «spaseeba» como спасибо") in the row,
  pre-ticked, editable. If that result
  arrives after "Add {n} words" (a pending lookup finishing as an add job), it is not saved
  on its own: the job waits in 24's `needs_choice` state with the line "Kotiko read
  “spaseeba” as спасибо. Add it?" so the learner sees the word Kotiko will add before it
  is added.
- Results failing validation become "Problem: the lookup came back unclear" with the row kept.
- **Pronunciations for rows that skip the lookup.** Looked-up rows get their pronunciation
  from the lookup (09's output schema). Rows that already have a meaning but no
  pronunciation, in a base with a respelling key, get one after saving through 09's
  `respell` request, 20 words per request, under the same quota rules and as a background
  job like 07 section 8's refresh. The footer shows it as a ticked option with its cost:
  "Add pronunciations (about {k} lookups)" ("Agregar la pronunciación (unas {k}
  consultas)"). Unticked, or when quota runs out, those words stay without a pronunciation
  until the learner edits one in or re-adds the word; nothing else is held back.

### 6. Saving and the summary

"Add {n} words" writes all ticked Ready rows through [07](../07-word-model-v2/SPEC.md)'s
batch add: locally in one IndexedDB transaction ([11](../11-local-first-mode/SPEC.md)), which
causes a single projection write; with a server holding the words, `POST
/api/v1/words/batch` with up to 500 words per call (its 1 MB body limit), each call with its
own `client_request_id` so retries are idempotent ([24 §3](../24-add-flow-safety/SPEC.md)).
Every word carries the list's `base_lang` and its meaning as `gloss` plus forms.
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
  theirs; the rest take the batch language. Meanings in mixed base languages (some rows
  in Spanish, some in English) aren't detected per row; a Base Language column (as in
  slice 12's export) is honoured, otherwise the list's base applies.
- **Base without spaces:** `cat = 猫` with base `ja` and target `en` orients by script
  (rule 2). A list with Japanese on both sides (`猫＝ねこ`, a reading list) for a learner
  whose base is `ja` is refused row by row as "a word in a language you read", with the
  hint to map the second column to Romanization/Reading instead.
- **Right-to-left words:** every cell is `<bdi>`; separators are detected on logical order, so
  `شكرا = thanks` and `شكرا = gracias` parse correctly whatever the display direction,
  including for an Arabic or Hebrew base (`perro = كلب` with base `ar` puts perro as Word
  by rule 2).
- **Very long lines** (sentences): rows over 64 characters native become "Problem: too long
  for a word", with "Split into words" that replaces the row with one row per token (14's
  tokenizer for that text's language).
- **Spreadsheets saved as .xlsx:** "Kotiko reads .csv files. In your spreadsheet app choose
  Save as → CSV, then drop that file."
- **Huge files** over 5 MB: `import_unreadable` with "This file is bigger than 5 MB."
- **Binary or unknown files:** `import_unreadable`.
- **Kotiko's own CSV exports:** [12](../12-export-import-and-delete/SPEC.md) prefixes cells that
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

## Implementation notes

Built 2026-10-05:

- **Parsing.** `extension/bulk/parse.js` is pure: decoding, format detection, columns, one
  line, orientation. The dashboard passes in the language data, the base's common words,
  `i18n.detectLanguage` and an inert `DOMParser` for Anki HTML.
  - Orientation runs rules 1-4 as written. The common-words rule needs at least two hits
    and twice the other side's.
  - A CSV is recognised by commas only on lines with no line-list separator, so
    "perro = dog, hound" stays a line list.
  - The add box's inline parser (`lib/local-mode.js`) isn't merged into this module yet.
    The two agree on the separators the add box accepts.
- **The sheet.** `extension/bulk/sheet.js` sits under the add box, with the columns,
  statuses, counts, filters, Swap and "Are you learning A or B?" as specified. It renders
  100 rows at a time with "Show more", rather than virtualizing. A 5,000-row list parses
  in about 39 ms (benchmark `bulk.parse.5k`, budget 200 ms).
- **Lookups.** The batch prompt (`prompt-batch.md`) isn't written: the spec ships it only
  after 09's batch evaluation, which hasn't been run. Until then:
  - Each row is looked up through the server's preview, two at a time, while the
    dashboard is open, so the learner sees "Kotiko read X as Y" before anything is saved.
  - Rows still looking up when "Add {n} words" is pressed become add jobs (24), as do
    "Save these {k} words for later" after the quota runs out.
  - The cost line counts one lookup per word.
- **Saving.** `words.save` in chunks of 500, each with its own `client_request_id`;
  `origin: "bulk"` or `"import"`, with `source_text`. The batch record (`bulkBatch` in
  `storage.local`) backs Undo and "See them" (`#words?batch=1`). "Add pronunciations"
  starts the pronunciation refresh job after saving, rather than 09's `respell` in groups
  of 20.
- **The popup.** Pasting two lines or more keeps the list whole in `storage.session`
  (`bulkDraft`) and offers "Open bulk add". The one-line box would drop the line breaks.
- **Not yet:**
  - Anki exports written by Kotiko (12 §4) are only recognised. Since slice 12, a Kotiko
    backup dropped or pasted here opens 12's restore preview, and Kotiko's own CSV is read
    with every column it writes;
  - the dashboard's ⋯ "Import a list or file" entry;
  - the welcome page's entry;
  - "Also add meanings in {base}";
  - the needs_choice step for a spelling correction that arrives after saving.

## Acceptance criteria

- [ ] Pasting 200 lines of `native = gloss` and pressing "Add 200 words" saves them with
      zero model calls (verified by the mock backend's request log) in 3 steps from the
      dashboard, for an English base ("gato = cat") and a Spanish base ("dog = perro").
- [ ] With base `es` and target `en`, a 20-line list "dog = perro, cat = gato, …" and the
      same list reversed ("perro = dog, …") both save `lang: "en"`, `native: "dog"`,
      `gloss: "perro"`, `base_lang: "es"`, without the learner touching Swap.
- [ ] With base `ja`, `고양이：猫` and `고양이 ： 猫` both parse as Korean 고양이 with gloss 猫;
      with base `es`, `猫＝gato` parses as Japanese 猫 with gloss gato.
- [ ] No row is ever saved with `lang` equal to its `base_lang`.
- [ ] A Spanish Kotiko CSV export (slice 12, Spanish headers) imports with no column mapping.
- [ ] With base `es` and target `ja`, a bare list "perro, gato" becomes two lookup rows that
      save 犬 and 猫 with glosses perro and gato.
- [ ] Dropping an Anki "Notes in Plain Text" export with `#separator:tab`, `#html:true` and
      `#columns:` headers produces a correctly mapped table with HTML and `[sound:]` removed.
- [ ] A CSV with a BOM, quoted commas and a header row maps columns from the header.
- [ ] A CSV with headers `Word, Pinyin, Pronunciation, Meaning` maps Pinyin to
      `romanization` and Pronunciation to `pronunciation`; the saved words have
      `pronunciation_source: "user"`; a row whose pronunciation is IPA is saved with
      `pronunciation: null` and the row note.
- [ ] 45 rows with meanings and no pronunciation, with "Add pronunciations" ticked, make
      exactly 3 `respell` requests after saving and fill only the pronunciation fields.
- [ ] `well-known = conocido` and `bien-estar = wellbeing` are not split at the hyphen;
      `gato - cat` is; `10:30 = once` is not split at the colon.
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
  scripts, each with meanings in English and in Spanish, plus Japanese-base and
  Arabic-base lists; every row of the Examples table above; Anki exports from Anki
  2.1.55+ and older (no headers), Excel CSV (windows-1252 and UTF-8 with BOM), Google
  Sheets TSV, Quizlet export ("term\tdefinition"), JSON arrays, Kotiko CSV exports with
  English and Spanish headers, RTL lines, numbered lists, cloze notes, malformed quoting.
- **Orientation:** a table of lists with expected orientation for each rule (headers,
  script, detected language with a stubbed `i18n.detectLanguage`, undecided).
- **Integration:** batch lookup with a mock model returning good, partial, corrected and
  invalid entries; quota exhaustion mid-run; idempotent retries; the `respell` follow-up
  for rows with meanings.
- **Unit:** column mapping for `pronunciation`, `romanization`, `pinyin`, `transliteration`
  and Latin or kana `reading` headers; the respelling-shape test for unheaded columns and
  for parentheses in one-line entries.
- **End-to-end:** paste, drop and choose-file paths; popup handoff; review edits; summary and
  Undo; dashboard close mid-lookup.
- **Manual:** real exports from Anki, Quizlet and a spreadsheet app.

## Rollout and migration

New feature; nothing to migrate. Server mode needs the batch upsert endpoint from
[07](../07-word-model-v2/SPEC.md); against an older server, bulk add saves one word per
request with a progress line ("Saving 120 of 200…"). Changelog: "Paste a whole list or drop a
file to add many words at once. Lines with meanings never use your lookups."

## Open questions

1. **Default column order for two-column lists without headers.** Recommendation: orient by
   script, then by the detected language of each column against the learner's base, and
   only when both are inconclusive fall back to Word then Meaning with the "Are you
   learning dog or perro?" question; never assume the meaning is English.
2. **Batch size per lookup.** Recommendation: 20, tuned with the golden set in
   [09](../09-shared-word-spec-and-prompt/SPEC.md); larger batches save quota but raise the
   error rate on small free models.
3. **Same-script orientation by language detection.** `i18n.detectLanguage` is unreliable
   on a handful of words. Recommendation: use it only on the whole column, require
   "reliable", and ask the one-tap question otherwise; measure on the fixture lists and
   lower or raise the bar from there.

## Future work

- `.apkg` import ([12](../12-export-import-and-delete/SPEC.md)).
- Pick words from a pasted paragraph (tokenize, show checkboxes) as a third mode beside list
  and file.
