# 21 · Dashboard

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | L (several weeks) |
| **Depends on** | [06-design-system](../06-design-system/SPEC.md), [07-word-model-v2](../07-word-model-v2/SPEC.md); uses [11](../11-local-first-mode/SPEC.md), [24](../24-add-flow-safety/SPEC.md), [25](../25-plain-language-errors/SPEC.md) |
| **Unblocks** | [13-bulk-add](../13-bulk-add/SPEC.md), settings for [11](../11-local-first-mode/SPEC.md), [12](../12-export-import-and-delete/SPEC.md), [31](../31-density-and-amount/SPEC.md), [32](../32-page-coverage-and-celebrations/SPEC.md), [33](../33-context-menu-and-shortcuts/SPEC.md), [35](../35-reveal-mode-and-review/SPEC.md), [37](../37-language-colors-and-reading-aids/SPEC.md) |
| **Sources** | Maintainer ("a full dashboard with a live view of all words"; "not like the other dashboards"; fewest steps); [DECISIONS](../DECISIONS.md); [05 S20, S21, S12, §3.3, §3.5](../../docs/research/05-learner-ux.md); [02 G4](../../docs/research/02-linguistics.md); [01 S23](../../docs/research/01-language-mixing.md) |

## Problem

A learner can't see, search or fix their words anywhere in the extension. The popup shows a
count (`extension/popup.js:128-129`) and per-language totals (`popup.js:37-47`); the only
delete is the add result's Undo (`popup.js:166-173`); there is no edit at all, and the server
has no update route (`server/lib/slovo/router.ex`, GET, POST and DELETE only;
[02 G4](../../docs/research/02-linguistics.md)). Telegram's `/list` shows the 15 newest.
Fixing a wrong romanization means deleting and re-adding, which may repeat the mistake. The
maintainer asked for a full dashboard with a live view of every word, and for it to feel
original rather than like another admin template.

## Goals

- A full-page extension view of every word, updating live as words arrive from the popup,
  context menu, Telegram or another device.
- Find any word in one step (type), fix any field in two, delete or pause in two, with undo
  instead of confirmation dialogs.
- Bulk actions on many words: pause, resume, move language, export, delete.
- A per-language overview that doubles as the language filter.
- Settings for every slice in one place, so the popup stays small.
- Smooth with 20,000 words; nothing waits on the network.

## Non-goals

- Bulk paste and file import UI: [13](../13-bulk-add/SPEC.md) (opened from here).
- Ready-made word lists of any kind: never ([DECISIONS](../DECISIONS.md)). Every word in
  the list is one the learner added.
- Export formats and "delete all my data": [12](../12-export-import-and-delete/SPEC.md).
- Stats and recaps: [46](../46-local-stats-and-recap/SPEC.md). The dashboard deliberately has
  no charts or KPI cards in v1.
- A server-served version for phones: Future work.

## User stories

- As a learner, I want to type a few letters and find a word, whichever script or spelling
  I use (with or without tone marks).
- As a learner who sees a wrong romanization on a page, I want to click Edit, fix it, and
  have pages update.
- As a learner who imported 300 words, I want to pause the 40 I don't want yet in a few
  clicks.
- As a learner who added a word on my phone via Telegram, I want to see it appear without
  reloading.
- As a learner, I want to see at a glance how many words I have in each language.

## Specification

### 1. Page and routes

`extension/dashboard.html`, registered as `options_ui.page` with `open_in_tab: true`, so the
browser's "Options" link opens it too. Hash routes, so every view is linkable from the popup,
popover and onboarding:

| Route | View |
|---|---|
| `#words` (default) | The word list |
| `#words/{id}` | The list with that word's inspector open |
| `#words?lang=es&status=paused&q=thank` | Filtered list (state mirrored in the hash) |
| `#add` | Bulk add sheet ([13](../13-bulk-add/SPEC.md)) |
| `#settings`, `#settings/{section}` | Settings |

Only one dashboard tab is kept: opening it from the popup focuses an existing tab and updates
its hash (`tabs.query` for the dashboard URL).

### 2. Layout

Wide (≥ 960 px):

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ (•) Mira    Your words                                  [ Add words ]   ⋯   Settings  │
│                                                                                       │
│  ┌───────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ All   │ │ Español    │ │ العربية    │ │ 中文      │ │ Русский  │ │ + Start a      │  │
│  │ 142   │ │ Spanish    │ │ Arabic     │ │ Chinese  │ │ Russian  │ │   language     │  │
│  │       │ │ 86 · +5 wk │ │ 31         │ │ 18 ◎     │ │ 7 hidden │ │               │  │
│  └───────┘ └────────────┘ └────────────┘ └──────────┘ └──────────┘ └───────────────┘  │
│                                                                                       │
│  [ / Search 142 words                       ]  Active ▾   Any time ▾   Newest ▾       │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│   Looking up xie xie…                                         Cancel │ ┌────────────┐ │
│ ▌ شكرا       shukran     thanks                  Arabic   Today      │ │  شكرا      │ │
│   gracias                thanks, thank you       Spanish  2 days     │ │  shukran   │ │
│   собака     sobaka      dog                     Russian  Sep 20     │ │  Arabic    │ │
│   犬         inu         dog                     Japanese Sep 20  ‖  │ │  ...       │ │
│   …                                                                  │ └────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────┘
                                                                         inspector, 380 px
```

Narrow (< 960 px): the inspector becomes a full-height sheet over the list; below 600 px rows
become two lines (native and romanization; English · language · date) and the shelf scrolls
horizontally.

What makes it Mira rather than an admin template ([06 §1](../06-design-system/SPEC.md)):

- **The language shelf** replaces a sidebar and KPI cards. Each language is a card titled by
  its endonym in the script's display face, with the English name, word count, words added in
  the last 7 days ("+5 wk") and its state (hidden, focus ◎, color dot from
  [37](../37-language-colors-and-reading-aids/SPEC.md)). Selecting a card filters the list;
  "All" clears it. The shelf is the per-language overview.
- **Rows lead with the native word** in `--t-word` and the right face for its script; English
  is secondary. No avatars, no flags, no zebra stripes.
- **The inspector is a specimen.** The selected word is set at `--t-specimen` with a line
  showing how it appears on pages: "Mira shows **شكرا** where pages say “thanks”." with the
  dotted underline.
- **The live arrival** of a word uses the swap motion and a 2 s `--orange-soft` wash.

### 3. The list

- **Columns (wide):** Native (with romanization in `--ink-3` beside it), English (first form,
  then "+2" with the rest in the tooltip and inspector), Language, Added (relative, then date
  after 7 days), Status (only shown when not active: "Paused" chip with pause icon; "Well
  known" when [35](../35-reveal-mode-and-review/SPEC.md) ships; "Waiting to save" when an edit
  hasn't reached the server).
- **Pending adds** from `addJobs` ([24](../24-add-flow-safety/SPEC.md)) sit at the top as rows
  with their job line and actions.
- **Sort:** Newest (default), Oldest, Native A-Z (collated with `Intl.Collator(lang)`),
  English A-Z, Language.
- **Filters:** language (the shelf), status (Active, Paused, Well known, Recently deleted, All;
  default Active + Paused). "Recently deleted" lists tombstoned words for as long as
  [07](../07-word-model-v2/SPEC.md) keeps them (at least 30 days) with "Restore", so an Undo
  missed in a toast is never final. Other filters: added (Any time, Today, This week, This month), source (from 07's
  `origin`: Typed = `add` and `manual`, Imported = `bulk` and `import`, Telegram =
  `telegram`). Filters are chips with a menu; active ones show "×" to clear.
- **Virtualized:** only visible rows plus 10 above and below are in the DOM; row height fixed
  at 52 px (wide) or 64 px (narrow); `aria-rowcount` and `aria-rowindex` keep screen readers
  oriented.

### 4. Search

- One field, focused with `/` (or by clicking), placeholder "Search {n} words".
- Matches, as you type, against native, romanization, every English form and the note.
  Matching folds case (`toLocaleLowerCase` per the word's language), strips diacritics and
  tone marks (NFKD, then remove combining marks), so "xiexie" finds "xièxie" and "cafe"
  finds "café"; it also matches Japanese kana against romanization when present.
- Results keep the current sort, with exact native matches first; matched text is shown in
  `--purple-text` weight 600 (not color alone).
- No results: "No words match “{q}”." with **"Add “{q}” as a new word"** (one click creates an
  add job, [24](../24-add-flow-safety/SPEC.md)) and "Clear search".
- Budget: under 16 ms per keystroke for 5,000 words and under 50 ms for 20,000, using a
  folded-string index built once on load and updated on change.

### 5. Inspector and editing

```
┌──────────────────────────────────────┐
│                                   ×  │
│  شكرا                                │  --t-specimen, editable in place
│  shukran                             │  romanization, editable
│  Arabic · العربية            Move ▾  │
│  Mira shows شكرا where pages say     │
│  “thanks”.                           │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  English                             │
│  [thanks ×] [thank you ×] [+ Add]    │  forms chip editor
│  Note                                │
│  [ Formal; “shukran jazeelan” = …  ] │
│  Swap on pages              [◉  ]    │  active / paused
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  Added Sep 30 from “shukran”         │  provenance (07 origin, source_text)
│  Changed Oct 1                       │
│                                      │
│  Delete word                         │  danger quiet button
└──────────────────────────────────────┘
```

- Every field saves on Enter or blur; there is no Save button. A small check and "Saved"
  appears for 1.5 s beside the field. Writes are optimistic: the list and pages update at once,
  and the write goes through the background's word store ([11](../11-local-first-mode/SPEC.md);
  server mode uses [07](../07-word-model-v2/SPEC.md)'s `PATCH` with `if_updated_at`).
- Each change also shows a toast "Changed {field} of {native}. Undo"; Ctrl/Cmd+Z undoes the
  last change made on this page.
- **Forms:** each form is a removable chip; "+ Add" accepts one or several (comma separated).
  Removing the last form is refused inline: "A word needs at least one English meaning."
  Forms already owned by another word in the same language show a note: "“can” is also lata
  (Spanish)." ([01 S9](../../docs/research/01-language-mixing.md)).
- **Native:** changing it is allowed; if another word in that language already has the new
  native, the inspector offers "Merge with the existing {native}" (07 merge) instead of
  failing.
- **Move language:** a picker of the learner's languages plus "Other language…"; merges the
  same way if needed.
- **Validation** is shared with [09](../09-shared-word-spec-and-prompt/SPEC.md); errors appear
  under the field with an icon ([25](../25-plain-language-errors/SPEC.md)).
- **Conflicts:** if the word changes elsewhere while a field is being edited, the field keeps
  the learner's draft and shows "This word just changed on another device. [Use theirs]
  [Keep mine]". Fields not being edited update silently.
- **Delete word:** removes it at once (tombstone), closes the inspector, toast "Deleted
  {native}. Undo" (10 s). No confirmation dialog.

### 6. Selection and bulk actions

- Click a row: select it and open the inspector. Checkboxes appear on hover and focus, and on
  every row once anything is checked.
- Shift+click selects a range; Ctrl/Cmd+click toggles; Ctrl/Cmd+A selects all filtered rows
  ("Select all 142" / "Select all 1,204 matching words" link when virtualized).
- With two or more selected, a floating bar appears at the bottom (`--e-3`):

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │ 12 selected   Pause   Resume   Move to… ▾   Export   Delete      ×   │
   └──────────────────────────────────────────────────────────────────────┘
```

- Every bulk action applies at once and shows a toast with Undo ("Paused 12 words. Undo").
- Delete of any size is undoable for 10 s; afterwards words stay as tombstones per
  [07](../07-word-model-v2/SPEC.md) until compaction.
- Deleting **all words of a language** from its shelf card menu is the one confirmed action:
  "Delete all 812 Spanish words? You can undo this for 10 seconds." because one click affects
  hundreds of words.

### 7. Language shelf menu

Each card has a "⋯" menu: Show on pages / Hide on pages, Focus on {language} / Stop focusing
([18](../18-language-precedence-and-mixing/SPEC.md)), Color ([37](../37-language-colors-and-reading-aids/SPEC.md)),
Export {language} ([12](../12-export-import-and-delete/SPEC.md)), Delete all {language} words.
"+ Start a language" opens a language picker, then the add box with that language as the
hint.

### 8. Header actions

- **Add words** (primary): opens `#add` ([13](../13-bulk-add/SPEC.md)) with a single-line add
  box on top (the same as the popup's) and the paste/drop area below.
- **⋯**: Import a list or file ([13](../13-bulk-add/SPEC.md)), Import a Mira backup
  ([12](../12-export-import-and-delete/SPEC.md)), Export all words (JSON, CSV, Anki), Show
  keyboard shortcuts.
- **Settings**: `#settings`.
- Drag a file anywhere onto the page to start bulk add with it.

### 9. Settings

One scrolling page, max width 720 px, with an in-page index that sticks on wide screens.
Sections and their owners:

| Section | Contents | Owner |
|---|---|---|
| Reading | Amount; skip buttons and menus; language colors; romanization above words; vowel marks; copy as English | [31](../31-density-and-amount/SPEC.md), [16](../16-what-not-to-swap/SPEC.md), [37](../37-language-colors-and-reading-aids/SPEC.md), [43](../43-copy-print-translate-coexistence/SPEC.md) |
| Learning | Celebrations; reveal mode; weekly recap | [32](../32-page-coverage-and-celebrations/SPEC.md), [35](../35-reveal-mode-and-review/SPEC.md), [46](../46-local-stats-and-recap/SPEC.md) |
| Word lookup and connection | Mode, provider, key, server address and access key, "Test" | [11](../11-local-first-mode/SPEC.md) |
| Shortcuts | Current keys; link to the browser's shortcut page | [33](../33-context-menu-and-shortcuts/SPEC.md) |
| Appearance | Theme (System, Light, Dark); Reduce motion (System, On) | [06](../06-design-system/SPEC.md) |
| Your data | Export, import, delete everything | [12](../12-export-import-and-delete/SPEC.md) |
| About | Version, source code, privacy policy, licenses, "Show welcome again" | this slice, [22](../22-first-run-onboarding/SPEC.md) |

Each setting saves on change with no Save button; settings that the owner slice hasn't shipped
are absent, not disabled.

### 10. Live updates

- The page reads every word, including paused words and recent tombstones, once from
  [11](../11-local-first-mode/SPEC.md)'s IndexedDB store (extension pages can open it
  directly). The `storage.local` `words` projection is not enough, because it holds only
  swappable words. After that it listens to `storage.onChanged` for `wordsVersion` (bumped
  after every committed write) and `addJobs`; on a `wordsVersion` change it asks the store's
  `changesSince(lastSeen)` for the changed records. Changes are diffed by `id` and
  `updated_at`; only affected rows re-render, and scroll position never jumps (rows inserted
  above the viewport adjust `scrollTop`).
- A new word that matches the current filters appears with the arrival motion and a "New"
  status chip until it is seen. One that doesn't match shows a quiet strip above the list: "3
  new words not shown by your filters. Show".
- In server mode, words added on Telegram arrive on the next background sync (within a
  minute, [26](../26-background-sync-correctness/SPEC.md)); the dashboard asks for a sync
  when it gains focus.

### 11. States

| State | What shows |
|---|---|
| Loading | Header and shelf frame at once; if words haven't loaded in 150 ms, six skeleton rows (`--sunken` bars, no shimmer under reduced motion) |
| No words | Illustration, "No words yet. Add the first one you'd love to learn, in any language, or a list you already have.", [Add words] (primary), "Import a list or file" |
| No results | §4 copy with "Add “{q}” as a new word" |
| Filters exclude everything | "No paused words." (per filter) and "Clear filters" |
| Offline / server unreachable | [25](../25-plain-language-errors/SPEC.md) state banner under the header; everything stays editable; edits queue and rows show "Waiting to save" |
| Storage full | `storage_full` blocking banner with "Export" |
| Error on one edit | The field reverts, with the [25](../25-plain-language-errors/SPEC.md) message under it and "Try again" |

### 12. Keyboard

Shortcuts are active when focus is in the list (`role="grid"`, `aria-multiselectable`), so
they don't interfere with screen-reader browse mode or typing. "?" lists them.

| Key | Action |
|---|---|
| `/` | Focus search (from anywhere outside a text field) |
| ↑ ↓, Home, End, Page Up/Down | Move the active row |
| Enter | Open the inspector and focus its native field |
| Space | Toggle the active row's checkbox |
| Shift+↑/↓ | Extend selection |
| Ctrl/Cmd+A | Select all filtered |
| Delete / Backspace | Delete selected (undoable) |
| P | Pause or resume selected |
| M | Move selected to another language |
| E | Export selected |
| N | Add words |
| Esc | Close inspector, then clear selection, then clear search |
| Ctrl/Cmd+Z | Undo the last change on this page |

### 13. Steps for key tasks

Counted as in [20 §3](../20-popup-redesign/SPEC.md); "from a page" starts with the word's
popover open.

| Task | Steps |
|---|---|
| Open the dashboard | 2 (popup, "All words") |
| Find a word (dashboard open) | 1 (type) |
| Fix a romanization from a page | 3 (Edit in popover, edit field, Enter) |
| Pause one word (dashboard open) | 2 (select, P) |
| Pause 40 contiguous words | 3 (click first, Shift+click last, P) |
| Delete a word | 2 (select, Delete) |
| Undo that | 1 |
| Move a word to another language | 3 (select, M, pick) |
| Export everything as CSV | 3 (⋯, Export, CSV) |
| See how many words per language | 0 (the shelf) |

### 14. Performance

- Interactive within 300 ms with 5,000 words and 800 ms with 20,000 on a mid-range laptop.
- Scrolling at 60 fps (no long tasks over 50 ms while scrolling).
- Search as in §4; bulk actions on 1,000 words complete in under 500 ms locally.
- No framework requirement; if one is used it must be bundled without a build step that AMO
  would need source for ([03 E7](../../docs/research/03-browser-extension.md)), so plain
  modules are preferred.

### 15. Accessibility

Per [27](../27-accessibility-baseline/SPEC.md): grid semantics with row selection announced;
the inspector is a labelled region (wide) or a dialog (narrow sheet) with focus management;
toasts are `role="status"`; every icon button is labelled; the page works at 200 % zoom and
320 px width.

## Acceptance criteria

- [ ] Every task in §13 completes in the listed steps (Playwright step-count scripts).
- [ ] A word added through the popup while the dashboard is open appears within 500 ms
      without reload; a server-side add appears within one sync interval.
- [ ] Typing "xiexie" finds "谢谢 / xièxie"; "cafe" finds "café".
- [ ] Editing a field saves without a Save button, updates swaps on an open page, and can be
      undone with Ctrl/Cmd+Z.
- [ ] Deleting 500 selected words takes one key press and is fully undone by Undo.
- [ ] With 20,000 words, scrolling produces no long task over 50 ms and search stays under
      50 ms per keystroke (CI performance test with a generated fixture).
- [ ] A conflicting remote change while a field is focused does not overwrite the draft and
      offers both choices.
- [ ] Each state in §11 has a screenshot test in light and dark.
- [ ] Keyboard-only operation of every action in §12; axe-core reports no violations.

## Test plan

- **Unit:** search folding and ranking; diffing and scroll anchoring; hash route parsing;
  undo stack.
- **End-to-end (Playwright):** fixtures with 0, 10, 5,000 and 20,000 words across 12 scripts;
  live updates from a second extension page writing to storage; server mode with a mock
  server, including 409 conflicts and an unreachable server; drag-and-drop of a file.
- **Manual:** NVDA and VoiceOver passes; RTL words in every column; Windows High Contrast;
  200 % zoom.

## Rollout and migration

New page; nothing to migrate. The popup footer, the popover's Edit and the welcome page link
to it. Words from older servers without `updated_at` are shown without "Changed" dates.
Changelog: "A new page for all your words: search, edit, pause, move and delete, live."

## Open questions

1. **Default status filter.** Recommendation: Active + Paused, so paused words aren't
   "missing"; tombstones are never shown.
2. **Confirm before deleting a whole language?** Recommendation: yes, the only confirmed
   action, because it is one click affecting hundreds of words; everything else is undo.

## Future work

- A server-served version of the same page for phones (the server already has the data).
- A "words seen today" view once [46](../46-local-stats-and-recap/SPEC.md) exists.
- Sense editing when [36](../36-grammar-and-senses/SPEC.md) lands.
