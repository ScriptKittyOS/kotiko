# 20 · Popup redesign

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [06-design-system](../06-design-system/SPEC.md), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (`t()`, base languages); uses [24-add-flow-safety](../24-add-flow-safety/SPEC.md) and [25-plain-language-errors](../25-plain-language-errors/SPEC.md) |
| **Unblocks** | [22-first-run-onboarding](../22-first-run-onboarding/SPEC.md); hosts controls from [18](../18-language-precedence-and-mixing/SPEC.md), [31](../31-density-and-amount/SPEC.md), [32](../32-page-coverage-and-celebrations/SPEC.md), [38](../38-per-site-rules/SPEC.md) |
| **Sources** | [DECISIONS 2026-10-01, base language](../DECISIONS.md); Maintainer ("as few steps as possible… regardless of the load on the backend"); [05 S5, S6, S10, S13, S33, S35, §3.4](../../docs/research/05-learner-ux.md); [01 S11](../../docs/research/01-language-mixing.md); [06 F16, F37](../../docs/research/06-adversarial-qa.md) |

## Problem

The popup is where learners spend most of their time in Mira, and today it:

- Leads with a server connection: on a fresh install it shows a red error and opens a
  Connection panel (`extension/popup.js:123-134`, `popup.html:138-151`).
- Blocks while adding: the Add button is disabled until the model answers
  (`popup.js:189-202`); the result disappears when the popup closes.
- Hides "only" behind hover (`popup.html:99-100`), which never shows on touch, and "only"
  doesn't stay only: a language added later appears anyway (`popup.js:90`;
  [01 S11](../../docs/research/01-language-mixing.md)).
- Says "12 words known, synced 3 min ago" (`popup.js:129`): "known" is wrong for new words and
  "synced" is jargon ([05 S5](../../docs/research/05-learner-ux.md)).
- Shows a disabled "Pause on this site" on browser pages with no explanation
  (`popup.js:116-119`), and leaves no trace when Mira is off or paused
  ([05 S35](../../docs/research/05-learner-ux.md)).
- Has no way to see your words ([05 S20](../../docs/research/05-learner-ux.md)).
- Loses a language toggle when two are clicked quickly, because handlers use stale state
  (`popup.js:74-76`; [06 F37](../../docs/research/06-adversarial-qa.md)), and a sync can
  overwrite Connection fields mid-edit (`popup.js:107-108`; [06 F16](../../docs/research/06-adversarial-qa.md)).
- Is 300 px wide with 13 px text over graph paper (`popup.html:31-40`).
- Is English only: every label is a literal in `popup.html` and `popup.js`, language names
  come from `Intl.DisplayNames(["en"], …)` (`popup.js:32`), and each word is shown as
  "native = english" (`popup.js:165`). A learner with a Spanish browser gets English
  buttons, and nothing tells them why their Spanish pages aren't changing
  ([50](../50-ui-localization-and-base-language/SPEC.md)).

## Goals

- The three things learners do most (add a word, choose languages, pause this site) each take
  two or three steps, and none waits on the network.
- The popup is interactive within 100 ms of opening and never shows a spinner.
- Every state (first run, empty, normal, adding, off, paused, unsupported page, offline,
  backend trouble, missing permission) has a designed screen and exact copy.
- Connection and other settings move out to the dashboard ([21](../21-dashboard/SPEC.md)); the
  popup stays small.
- Full keyboard operation with a visible focus order.
- Every string is in Mira's interface language through `MiraI18n.t()`, with English and
  Spanish complete at launch; language names follow the interface language.
- The popup tells the learner when the current page is in a language they don't read, so
  "nothing happened" is never a mystery.

## Non-goals

- The add queue, result model and copy: [24](../24-add-flow-safety/SPEC.md).
- Error wording: [25](../25-plain-language-errors/SPEC.md).
- Focus mode semantics and weights: [18](../18-language-precedence-and-mixing/SPEC.md).
- Editing base languages (the languages the learner reads in): dashboard settings
  ([21](../21-dashboard/SPEC.md)) and the welcome tab ([22](../22-first-run-onboarding/SPEC.md)).
  The popup only shows the page's state and links there ([50 §2](../50-ui-localization-and-base-language/SPEC.md)).
- The Amount control's behavior: [31](../31-density-and-amount/SPEC.md); coverage numbers:
  [32](../32-page-coverage-and-celebrations/SPEC.md); site rules:
  [38](../38-per-site-rules/SPEC.md). The popup reserves their places and shows them when
  those slices ship.

## User stories

- As a learner reading an article, I want to add the word I just met in one keystroke after
  opening the popup, and keep reading.
- As a learner of three languages, I want to switch to just Mandarin for a while in two
  clicks, and have it stay that way when I add a Turkish word from my phone.
- As a learner on a site where swaps get in the way, I want to pause it in two clicks and see
  at a glance that it's paused.
- As a new learner, I want the popup to point me to setup in a friendly way, not show an
  error.
- As a reader in Puerto Rico with a Spanish browser, I want the popup in Spanish and, on an
  English page, a plain note that Mira only changes pages in the languages I read.

## Specification

### 1. Layout

Width 360 px (Chrome allows up to 800 × 600). Height fits content up to 600 px; beyond that
only the middle region scrolls, so the add box and footer stay visible. Canvas `--canvas`;
sections separated by the dotted rule ([06 §10](../06-design-system/SPEC.md)). Body text
`--t-body` (14 px).

```
┌──────────────────────────────────────────────┐
│ (•) Mira                         [On ◉] ⚙ ↗ │  header
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────┐ ┌────────┐ │
│ │ Add a word, any language     │ │ Auto ▾ │ │  add box + language hint (24 §8)
│ └──────────────────────────────┘ └────────┘ │
│  Added شكرا (shukran) = thanks               │  up to 3 recent jobs (24 §4); gloss in the page's base
│        [Arabic ▾]                     Undo   │
├┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤
│ Languages                                    │
│ [✓ Español 30 ◎] [✓ العربية 12 ◎] [○ 中文 4 ◎]│  chip: toggle + focus button
├┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤
│ This page · en.wikipedia.org                 │
│ ●●●●●●●●○○○○○○○○○○○○  18 % in your languages │  32 (when shipped)
│ Amount [Light|Medium|Heavy|Everything]       │  31 (when shipped)
│ Pause on this site                     [○ ]  │
├┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤
│ All 46 words                              →  │  footer: opens dashboard
└──────────────────────────────────────────────┘
```

The same popup with the interface in Spanish (base `es`), on a Spanish news site:

```
┌──────────────────────────────────────────────┐
│ (•) Mira                    [Activo ◉] ⚙ ↗ │
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────┐ ┌────────┐ │
│ │ Agrega una palabra, en cualq…│ │ Auto ▾ │ │
│ └──────────────────────────────┘ └────────┘ │
│  Agregada 犬 (inu) = perro          Deshacer │
├┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤
│ Idiomas                                      │
│ [✓ 日本語 12 ◎] [✓ English 8 ◎]               │
├┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤
│ Esta página · elnuevodia.com                 │
│ Pausar en este sitio                   [○ ]  │
├┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤
│ Tus 20 palabras                           →  │
└──────────────────────────────────────────────┘
```

All strings are keys in `extension/_locales/<locale>/messages.json` read through
`MiraI18n.t()` ([50 §8](../50-ui-localization-and-base-language/SPEC.md)); the add box
placeholder's Spanish form is truncated with an ellipsis only in this drawing.

- **Header:** the mark (16 px) and "Mira" in `--font-display`; the master switch
  ("On"/"Off", `role="switch"`, label "Swap words on pages"); a settings button (sliders
  icon, "Settings", opens `dashboard.html#settings`); an open button ("Open your words",
  opens the dashboard). Both open in a tab and close the popup.
- **Add box:** `--t-lead` input with placeholder "Add a word, any language", `dir="auto"`,
  focused on open. Enter submits. The hint chip ([24 §8](../24-add-flow-safety/SPEC.md))
  sits at the end. When the lookup client reports remaining free lookups
  ([10](../10-llm-client-resilience/SPEC.md) quota) and 20 or fewer remain, a quiet line under
  the box reads "{r} free lookups left today"; at 0 it reads "No free lookups left today.
  Type “word = meaning” to add without one." Pasting text with line breaks shows, under the box: "Paste {n} lines as a
  list? [Open bulk add]" which opens [13](../13-bulk-add/SPEC.md) prefilled; Enter still adds
  the first line only if the learner insists.
- **Recent jobs:** the three newest jobs from `addJobs`, rendered per
  [24 §4](../24-add-flow-safety/SPEC.md); the newest gets the swap motion
  ([06 §9](../06-design-system/SPEC.md)). Older jobs are in the dashboard.
- **Languages:** one chip per language, ordered by word count then name (as
  `popup.js:44-46` does, with names compared by `Intl.Collator(uiLocale)`). Chip label is
  the endonym (from `Intl.DisplayNames([lang], {type: "language"})`), with the name in the
  interface language in the chip's tooltip and accessible name ("Spanish, Español, 30
  words, shown"; in Spanish, "japonés, 日本語, 12 palabras, visible"). These are target
  languages; a word counted under a chip is a group of records (same `lang` and
  `native_key`, [07](../07-word-model-v2/SPEC.md)), so a bilingual learner's 犬 counts once. Clicking the chip
  toggles shown/hidden. The trailing ◎ button ("Focus on Spanish") sets Focus. With more than
  six languages, the row wraps to at most three lines, then "+4 more" opens the full list in
  place.
- **Focus:** when Focus is on, a strip replaces the section title: "Focusing on Español ·
  Stop". Hidden and new languages follow [18](../18-language-precedence-and-mixing/SPEC.md);
  if a language arrived while focusing, the strip adds "Türkçe is new, hidden while you
  focus."
- **This page:** host name (registrable domain, `--ink-2`); coverage meter
  ([32](../32-page-coverage-and-celebrations/SPEC.md)); Amount segmented control
  ([31](../31-density-and-amount/SPEC.md)); "Pause on this site" switch. Per-site language
  rules ([38](../38-per-site-rules/SPEC.md)) appear here as "Languages on this site: All ▾"
  when that slice ships.
- **Footer:** "All {n} words →" opens the dashboard. When there are unseen finished jobs
  ([24 §9](../24-add-flow-safety/SPEC.md)) it reads "All {n} words · {k} new →".

Removed from the popup: "Sync now" (sync is automatic; a manual "Check now" lives in
Connection settings), the Connection panel (moves to the dashboard settings,
[11](../11-local-first-mode/SPEC.md)), and the status line about syncing.

### 2. States

Each state below has exact copy. Banners use [25](../25-plain-language-errors/SPEC.md)'s
presentation.

**A. First run (not onboarded, no words).** The add box stays usable. Below it:

```
│ ┌──────────────────────────────────────────┐ │
│ │ Finish setting up Mira                   │ │
│ │ Choose your first word, in any language. │ │
│ │ It takes under a minute.                 │ │
│ │                        [ Get started ]   │ │
│ └──────────────────────────────────────────┘ │
```

"Get started" opens or focuses the welcome tab ([22](../22-first-run-onboarding/SPEC.md)).
The Languages and This page sections are hidden.

**B. Empty (onboarded, no words).** "No words yet. Type one above, in any language." and a
quiet link "Or add a list" (opens bulk add, [13](../13-bulk-add/SPEC.md), in the
dashboard). This page section shows, with the meter hidden.

**C. Normal.** As in §1.

**D. Adding.** Recent jobs per [24](../24-add-flow-safety/SPEC.md). The input is never
disabled.

**E. Off everywhere.** The switch reads "Off"; Languages and This page dim to 60 % opacity
but stay operable; a banner: "Mira is off on all sites. [Turn on]". Toolbar badge "off" (§5).

**F. Paused on this site.** The switch row reads "Paused on en.wikipedia.org" with
"[Resume]"; the meter and Amount are hidden. Badge "off".

**G. Unsupported page.** The This page section is replaced by "Mira can't run on browser
pages like this one." (`unsupported_page`). Everything else works.

**H. Page in a language you don't read.** The page's declared or detected language
([16](../16-what-not-to-swap/SPEC.md)) isn't one of the learner's base languages
(`s:ui.baseLangs`, [50 §2](../50-ui-localization-and-base-language/SPEC.md)). The This page
section reads `base_page_other`: "This page is in German, which isn't one of your
languages. Mira leaves it alone." / "Esta página está en alemán, que no es uno de tus
idiomas. Mira no la toca." with two quiet links: "I read German too" (opens
`dashboard.html#settings-languages` with German ready to add) and "Swap here anyway"
(a per-site override, 16). When the page language can't be determined, nothing is shown.

**H2. Page in a base language with no words for it.** The page is in one of the bases, but
no word has a gloss in that base (for example the learner just added French as a base).
"No words have meanings in French yet. [Add meanings]" opens the dashboard's "Add meanings
in French" action ([21](../21-dashboard/SPEC.md)).

**I. Offline.** A small "Offline" pill in the header (info icon, `--blue-soft`). Pending jobs
show their waiting line. No banner unless an add is waiting.

**J. Backend trouble.** One state banner from [25](../25-plain-language-errors/SPEC.md)
under the header, e.g. `server_unreachable` with the word count. Never red, never opens
settings.

**K. Missing permission (Firefox).** Banner: "Mira needs permission to read pages to swap
words. [Allow]". The button calls `permissions.request({origins: ["<all_urls>"]})` (a user
gesture).

**L. Loading.** The popup renders from one `storage.local.get` and one
`storage.session.get`; both normally resolve in under 20 ms. Nothing is shown for the first
100 ms; if storage hasn't answered by then, chips render as three `--sunken` placeholders.
The popup sends a fire-and-forget sync request ([26](../26-background-sync-correctness/SPEC.md))
and never waits for it.

### 3. Steps for key tasks

A step is one deliberate action: a click, a key press that commits (Enter), or typing one
entry. Opening the popup counts as a step (toolbar click or the shortcut from
[33](../33-context-menu-and-shortcuts/SPEC.md)).

| Task | Today | New | Waits on network? |
|---|---|---|---|
| Add a word | 3 (open, type, Enter), then blocked until the model answers | 3 | No: input clears at once |
| Add three words in a row | 7 plus three waits | 7 (open, then type + Enter × 3) | No |
| Add a word you know the meaning of, in any base ("gracias = thanks"; "犬 = perro") | not possible without the model | 3 | No, and no model call |
| Fix the wrong language on a just-added word | delete, retype, wait (5+) | 2 (chip, pick language) | Lookup runs in the background |
| Undo one of several added words | not possible (one Undo for all) | 1 | No |
| Hide a language | 2 | 2 | No |
| Focus on one language | 2, hover-only | 2 (open, ◎) | No |
| Stop focusing | 2 | 2 (open, Stop) | No |
| Pause on this site | 2 | 2 | No |
| Turn Mira off everywhere | 2 | 2 | No |
| See all your words | not possible | 2 (open, footer) | No |
| Finish setup on first run | n/a (red error) | 2 (open, Get started) | No |

### 4. Keyboard

- On open, focus is in the add box (as `popup.js:237` does today).
- Tab order: add box → hint chip → recent job actions (in order) → language chips → Focus/Stop
  → This page controls → footer → header switch → settings → open. The header comes last
  because the add box is the reason most people open the popup.
- Language chips are one composite widget with roving `tabindex`: ←/→ (mirrored in RTL) move,
  Space or Enter toggles, F focuses on the current language, Home/End jump.
- The Amount control is a radiogroup: arrows change the value immediately.
- `/` from anywhere outside a text field returns focus to the add box.
- In the add box, ↓ moves to the newest job's first action.
- All controls show the [06](../06-design-system/SPEC.md) focus ring; nothing relies on hover
  (the "only" link's hover-only visibility at `popup.html:99-100` is gone).

### 5. Toolbar badge

The popup slice owns the off and paused badge; [32](../32-page-coverage-and-celebrations/SPEC.md)
adds coverage. Precedence, per tab:

1. Off everywhere or paused on this site: text "off", background `#6B6379` (white text
   5.70:1).
2. Otherwise, while any add job is queued or looking up (for example one started from the
   context menu, [33](../33-context-menu-and-shortcuts/SPEC.md)): text "•", background
   `--primary` (light value). Cleared when no job is running.
3. Otherwise, coverage from 32 if enabled.
4. Otherwise no badge.

The background computes the badge per tab and sets it with `action.setBadgeText({tabId})`
(per-tab values override a global one, so nothing is set globally); it recomputes the active
tab on tab switches and every tab when a job starts or ends.

The toolbar tooltip (`action.setTitle`) mirrors the state through `t()`: "Mira", "Mira ·
paused on example.com" / "Mira · en pausa en example.com", "Mira · off" / "Mira ·
desactivado". The badge text "off" is a key too (`badge_off`; es "no").

### 6. Behavior and correctness

- **Optimistic toggles.** Chip, switch and Amount changes render immediately and write to
  storage in the same tick; handlers read the current value from storage inside the handler
  and write the merged result, which fixes [06 F37](../../docs/research/06-adversarial-qa.md).
- **Partial re-render.** `storage.onChanged` updates only the sections whose keys changed
  (`addJobs` → recent jobs; `words` → chips and footer; `prefs` → controls). Inputs are never
  overwritten while focused or dirty ([06 F16](../../docs/research/06-adversarial-qa.md)).
- **Counts.** "All {n} words" counts active and paused word groups (records sharing `lang`
  and `native_key` count once; not tombstones). Chip counts count active groups in that
  language. Numbers use `Intl.NumberFormat(uiLocale)` and plural keys
  (`words_count_one` / `_other`).
- **Host.** The host is computed as today (`popup.js:179-180`); pausing stores the hostname
  in `pausedHosts` as today until [38](../38-per-site-rules/SPEC.md) replaces it.

### 7. Copy

Keys in `_locales`; English and Spanish ship complete at launch. `{lang}` and `{base}` are
names from `Intl.DisplayNames([uiLocale], {type: "language"})`.

| Key | en | es |
|---|---|---|
| `popup_add_placeholder` | Add a word, any language | Agrega una palabra, en cualquier idioma |
| `popup_add_label` (accessible) | Add a word | Agregar una palabra |
| `popup_hint_auto` | Auto; accessible "Language for new words: Auto" | Auto; accesible "Idioma de las palabras nuevas: Auto" |
| `popup_switch_label` | Swap words on pages | Cambiar palabras en las páginas |
| `popup_languages_title` | Languages | Idiomas |
| `popup_chip_name` | {lang}, {endonym}, {n} words, shown/hidden | {lang}, {endonym}, {n} palabras, visible/oculto |
| `popup_focus_button` | Focus on {lang} | Concentrarte en {lang} |
| `popup_focus_strip` | Focusing on {endonym} · Stop | Concentrada en {endonym} · Parar |
| `popup_this_page` | This page · {host} | Esta página · {host} |
| `popup_pause_site` | Pause on this site | Pausar en este sitio |
| `popup_footer` | All {n} words | Tus {n} palabras |
| `popup_settings` | Settings | Ajustes |
| `popup_open` | Open your words | Abrir tus palabras |
| `popup_first_run_title` | Finish setting up Mira | Termina de configurar Mira |
| `popup_first_run_body` | Choose your first word, in any language. It takes under a minute. | Elige tu primera palabra, en cualquier idioma. Toma menos de un minuto. |
| `popup_get_started` | Get started | Empezar |
| `popup_empty` | No words yet. Type one above, in any language. | Aún no hay palabras. Escribe una arriba, en cualquier idioma. |
| `base_page_other` | This page is in {lang}, which isn't one of your languages. Mira leaves it alone. | Esta página está en {lang}, que no es uno de tus idiomas. Mira no la toca. |
| `popup_read_too` | I read {lang} too | También leo {lang} |
| `popup_swap_anyway` | Swap here anyway | Cambiar aquí de todos modos |
| `popup_no_meanings_base` | No words have meanings in {base} yet. | Aún no hay palabras con significado en {base}. |
| `error_unsupported_page` (25) | Mira can't run on browser pages like this one. | Mira no puede funcionar en páginas del navegador como esta. |
| `popup_off_banner` | Mira is off on all sites. | Mira está desactivado en todos los sitios. |
| `popup_lookups_left` | {r} free lookups left today | Te quedan {r} búsquedas gratis hoy |

"Concentrada" in the focus strip describes the list (la lista), so it doesn't gender the
learner; the Spanish copy uses `tú` and gender-neutral phrasing per
[50 §8](../50-ui-localization-and-base-language/SPEC.md).

### 8. Performance

Popup JS and CSS under 60 KB uncompressed, no framework (plain modules, as today). First
render within one frame of storage resolving; no layout shift after first paint. No network
request is awaited on open.

## Acceptance criteria

- [ ] On a fresh install the popup shows state A, with no red text and no settings panel.
- [ ] After pressing Enter in the add box, the input is empty and focused within 50 ms with a
      mock backend that takes 30 s.
- [ ] Each task in §3 completes in the listed number of steps in a Playwright script that
      counts clicks and Enter presses.
- [ ] Ten rapid language toggles end in the state of the last click (regression for 06 F37).
- [ ] Every state A-L has a screenshot test in light and dark.
- [ ] Badge shows "off" on a paused site and nothing on others when coverage is disabled.
- [ ] Keyboard-only: every control reachable and operable in the order in §4; no focus traps.
- [ ] The popup's first paint happens within 100 ms on a mid-range laptop (Performance
      timeline in CI, median of 10 runs, budget 150 ms in CI).
- [ ] No string in the popup contains "sync", "token" or "known" (string lint).
- [ ] With the browser in Spanish, every visible and accessible string in states A-L and H2
      is Spanish (screenshot review plus slice 50's literal-string check).
- [ ] With base `es`, on an English fixture page the popup shows state H with "inglés"
      named; "También leo inglés" opens settings with English ready to add; on a Spanish
      page state H is not shown.
- [ ] A bilingual learner's 犬 (two records, `es` and `en`) counts as one word in the footer
      and the 日本語 chip.

## Test plan

- **Unit:** language ordering (with `Intl.Collator` in `en` and `es`) and endonyms; page
  state H/H2 selection from page language and `baseLangs`; group counting; the badge precedence function; the multi-line
  paste detector.
- **End-to-end (Playwright):** each state via storage fixtures; step-count scripts for §3;
  keyboard traversal; the 30 s slow-backend add; RTL endonym rendering; every state with
  the browser launched with `--lang=es` and with slice 50's `en-XA` pseudo-locale (no
  truncation at 360 px).
- **Manual:** Chrome and Firefox, light and dark toolbar themes, 200 % zoom, Windows High
  Contrast, NVDA and VoiceOver passes per [27](../27-accessibility-baseline/SPEC.md).

## Rollout and migration

Replaces `popup.html` and `popup.js` entirely. Existing settings keys (`enabled`,
`pausedHosts`, `hiddenLangs`) are read as they are; `hiddenLangs` keeps its meaning and
Focus is stored separately per [18](../18-language-precedence-and-mixing/SPEC.md). Server
users find their connection in Settings → Connection (the changelog says where). Changelog:
"A new popup: add words without waiting, focus on one language, and open all your words."

## Open questions

1. **Header order.** Recommendation: master switch in the header (it's a global state), pause
   in This page (it's per site), as above.
2. **Show state H on every page in another language, or only once per site?**
   Recommendation: every time, as a quiet line in This page, never a banner; it is the
   answer to "why isn't anything changing here?".
3. **Popup width.** Recommendation: 360 px; it fits endonyms like "Bahasa Indonesia" in a chip
   and stays narrow enough to feel like a popup.

## Future work

- Per-language intensity (off / some / all) inside the chip menu, if
  [18](../18-language-precedence-and-mixing/SPEC.md) weights prove too hidden.
- A "words on this page" list in This page, to reveal a swap on touch devices
  ([45](../45-firefox-android/SPEC.md)).
