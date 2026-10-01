# 46 · Local stats and recap

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P2 (later) |
| **Size** | M (about a week) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md); stores data in [11-local-first-mode](../11-local-first-mode/SPEC.md)'s database; base languages from [50](../50-ui-localization-and-base-language/SPEC.md) |
| **Unblocks** | Light review weighting in [35-reveal-mode-and-review](../35-reveal-mode-and-review/SPEC.md) can read its per-word counters; milestone triggers in [32](../32-page-coverage-and-celebrations/SPEC.md) |
| **Sources** | [05 summary, S29, S30, wireframe 3.4, open questions 4 and 5](../../docs/research/05-learner-ux.md); [01 S20, section 3 "Feedback"](../../docs/research/01-language-mixing.md) |

## Problem

Mira gives no sense of progress. The popup's status line shows a total and a sync time
(`extension/popup.js:127-130`). Nothing records which words a learner actually met while
reading, how many swaps they saw this week, or which words they keep checking. Seeing
progress keeps people going, but streak counters that reset on a missed day punish the
learner ([05 S29](../../docs/research/05-learner-ux.md)), and a reading tool shouldn't
nag.

## Goals

- Count, per day, per target language and per base language: swaps seen, distinct words
  seen, words added, and popover opens; per word: times seen and last day seen.
- A bilingual reader's stats never mix their languages: swaps on Spanish pages and on
  English pages are counted apart ([50](../50-ui-localization-and-base-language/SPEC.md)
  rule 7), and a target word met on both still counts as one word met.
- Show a short weekly recap in the popup and a fuller view in the dashboard.
- Store no URLs, hostnames, page titles or page text, and never send stats anywhere.
- No streaks, no loss messages, no notifications, no red numbers for a quiet week.
- Counting costs under 1 ms per batch on the page.

## Non-goals

- Page coverage percentages and celebrations: slice [32](../32-page-coverage-and-celebrations/SPEC.md)
  (computed per page, not stored here).
- "Knew it" and "didn't know" signals and review weighting: slice [35](../35-reveal-mode-and-review/SPEC.md),
  which stores its counters in the same per-word table.
- Syncing stats between devices: future work after slice [39](../39-multi-device-sync/SPEC.md).

## User stories

- As a learner, I want to see that I met 214 Spanish words this week, so that reading
  feels like progress.
- As a learner, I want to know which words I keep hovering over, so that I can focus on them.
- As a learner who took a week off, I don't want to be told I failed.
- As a reader of Spanish and English learning Japanese, I want to see that my Japanese
  showed up on both kinds of pages, without 犬 counting as two words.

## Specification

### 1. What is counted

| Counter | Scope | Counted when |
|---|---|---|
| `swaps` | day × language × base | A swap is rendered while the tab is visible |
| `wordsSeen` | day × language × base | First swap of a word that day on a page in that base (distinct) |
| `added` | day × language × base | A word record is created (not when merged or imported, which count as `imported`) |
| `imported` | day × language × base | Word records created by import or bulk add |
| `checks` | day × language × base | The popover opens on a word (slice 19) |
| `seen`, `lastSeenDay` | word | Each day the word was seen at least once (`seen` counts days, not swaps) |
| `checks` | word | Popover opens on this word |

`seen` counts days rather than swaps so that one long page full of "the house" doesn't
make "house" look well practised (or "la casa" make "casa" look so on a Spanish page).

"Language" is the word's target `lang`; "base" is the record's `base_lang`, which is also
the language of the page text it was swapped into. Totals for a target language add the
base rows for `swaps`, `added`, `imported` and `checks`. Distinct-word totals (`wordsSeen`
for a language across bases, "words met this week") count target words, the group
`(lang, native_key)` that slice 21 and 19 show as one word, so a bilingual reader who met
犬 on a Spanish page and on an English page met one word.

### 2. Storage

Two stores in slice 11's `mira` database:

- `statsDaily`, key `[day, lang, base]`, where `day` is the local date `YYYY-MM-DD`.
  Fields as in section 1, plus `seenKeys`, the list of group keys seen that day (for
  cross-base distinct counts; at most a few hundred short strings). Rows older than 400
  days are folded into `statsMonthly` (`[month, lang, base]`, without `seenKeys`) on the
  first run of a new day.
- `wordStats`, key `wordId` (one per record, so per base): `{seen, lastSeenDay, checks}` plus slice 35's fields. Kept
  separate from the word record, so counting never touches the word, its `updated_at`,
  the projection or sync.

Size: one year of daily rows for 5 languages and 2 bases is about 3,600 small rows; `wordStats` is one
small row per word. Both are far below any quota.

### 3. Counting from the page

The content script keeps, while the document is visible, a `Map<wordId, swapsThisPage>`
fed by slice 15's swap routine (one map update per swap) and slice 19's popover opens.
It sends `{type: "stats", day, words: [[wordId, swaps, checks], …]}` to the background:

- when the tab becomes hidden (`visibilitychange`),
- every 60 seconds while visible, if anything changed,
- on `pagehide`.

No URL, hostname or text is in the message. The background maps word ids to their target
language and base (the record's `base_lang`) and updates both stores in one transaction. A page that is swapped while hidden (a
background tab) counts nothing until it's shown. Frames (slice 42) count separately and
are merged by the background.

### 4. Popup line and weekly recap

The popup's status area (slice 20) shows one line under the word count:

```
This week: 214 swaps · 63 words met · 9 new
Esta semana: 214 cambios · 63 palabras vistas · 9 nuevas
```

(English and Spanish interface; every string is a `MiraI18n.t()` key with plural forms.)

**Weekly recap card**: shown once, on the first popup open after the week ends. The week
starts on the interface locale's first day from `Intl.Locale(uiLocale).getWeekInfo()` where the browser
has it (Chromium and Safari; Firefox is believed not to, medium confidence), otherwise
Monday, with a setting to change it.

```
+------------------------------------------+
| Your week                                |
| Spanish   148 swaps · 41 words · 6 new   |
| Japanese   66 swaps · 22 words · 3 new   |
| Most checked: 机 (tsukue), aunque, 窓     |
| New this week: perro, ventana, 犬 …      |
| [See more]                    [Got it]   |
+------------------------------------------+
```

For a learner with more than one base language, each language line gets a quiet second
line saying where the words appeared, and the line totals still count each target word
once:

```
| Japanese   66 swaps · 22 words · 3 new   |
|   on Spanish pages 41 · English pages 25 |
```

Language names come from `Intl.DisplayNames` in the interface language ("japonés",
"en páginas en español").

Rules for the copy: describe, never judge. No comparisons with previous weeks unless they
are increases phrased neutrally ("More Japanese than last week"); a quiet week says "A
quiet week. Your words are ready when you are." No numbers in red. No system
notifications. A language with no activity is simply left out.

### 5. Dashboard: Progress

A "Progress" view in slice 21's dashboard:

- per-language bar chart of words met per day over the last 8 weeks (with a "Pages in"
  filter for learners with several base languages), built with slice
  06's tokens and its color-vision checks, labelled directly rather than by color alone,
  with an accessible table toggle;
- a list of words sorted by `checks` ("Words you check most") and by `lastSeenDay`
  ("Not seen for a while"), each linking to the word;
- totals: words, languages, days with any reading this month (shown as a count, never as
  a streak).

### 6. Privacy and controls

- Setting "Keep learning stats" (default on). Turning it off stops counting and deletes
  both stores after a confirmation.
- Stats are included in slice 12's JSON export only when "Include learning stats" is
  ticked, and are removed by Delete everything.
- The privacy policy row already covers them (slice 28: "Learning stats, stored in the
  extension, never leave").

## Acceptance criteria

- [ ] Reading a fixture page with 30 swaps of 10 distinct Spanish words increments
      `swaps` by 30 and `wordsSeen` by 10 for today; reloading it adds 30 swaps and 0 words.
- [ ] A background tab that is never shown adds nothing.
- [ ] With bases `es` and `en`, meeting 犬 on a Spanish fixture and on an English fixture
      on the same day records swaps under both bases and counts one Japanese word met in
      the popup line and the recap.
- [ ] With the interface in Spanish, the popup line and the recap are entirely Spanish,
      with correct plurals ("1 palabra nueva", "9 nuevas").
- [ ] No stats message or stored row contains a URL, hostname or page text (test asserts
      on every message and row).
- [ ] The recap appears exactly once per week and never as a system notification.
- [ ] Turning "Keep learning stats" off deletes both stores.
- [ ] Counting adds under 1 ms per 100 swaps on the page (benchmark in CI).
- [ ] The Progress chart has a table alternative reachable by keyboard.

## Test plan

- **Unit** (slice 02): counter aggregation, day rollover across midnight and time-zone
  change, monthly folding, week start fallback, recap copy selection.
- **End-to-end** (Playwright): fixture pages; visibility changes via a second tab;
  inspection of IndexedDB through the extension's test hook.
- **Manual**: recap wording reviewed against slice 05's voice; screen reader pass on the
  chart table.

## Rollout and migration

- Counting starts on update; there is no history before it, and the first recap says
  "Your first week with stats".
- Changelog: "See how many of your words you met this week. Stats stay on your device."

## Open questions

1. **Days active this month.** Show "Read on 12 days this month" in the dashboard
   ([05 open question 4](../../docs/research/05-learner-ux.md))? Recommendation: yes as a
   plain count in the dashboard only, never in the popup or recap, and never framed as a
   streak.
2. **Sync stats later?** Recommendation: not until slice 39 has been stable for a release;
   counters can then merge by addition per device.

## Future work

- Sync of stats and learning signals through the server (slice 39).
- A yearly recap.
- Optional opt-in Telegram weekly digest for server users ([01 S20](../../docs/research/01-language-mixing.md)).
