# 32 · Page coverage and celebrations

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | M (about a week) |
| **Depends on** | [14-matcher-engine](../14-matcher-engine/SPEC.md), [06-design-system](../06-design-system/SPEC.md), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (base languages, per-base data, `KotikoI18n.t()`); uses [15](../15-framework-safe-swapping/SPEC.md)'s coverage hook, [16](../16-what-not-to-swap/SPEC.md)'s text language, [18](../18-language-precedence-and-mixing/SPEC.md)'s known signal, [36](../36-grammar-and-senses/SPEC.md)'s `spec/lang/<base>/no-standalone.json` |
| **Unblocks** | The popup's This page meter ([20](../20-popup-redesign/SPEC.md)); [31](../31-density-and-amount/SPEC.md)'s "showing" line |
| **Sources** | Maintainer request (confetti) and [DECISIONS: celebrations on by default; English is not the base language](../DECISIONS.md); [01 S18, S19, S20, S21](../../docs/research/01-language-mixing.md); [05 S29, S30](../../docs/research/05-learner-ux.md) |

## Problem

Learners can't see their progress on the page in front of them. Nothing in Kotiko measures
how much of a page is in the learner's languages: every match is swapped and nothing is
counted (`extension/content.js:84-100`), and the popup shows only a total word count
(`popup.js:128-129`). The maintainer wants the moment when most of a page is in your
languages to feel special, confetti included, and has decided celebrations are on by default
([DECISIONS](../DECISIONS.md)). Done carelessly, that becomes an interruption on someone
else's website, a guilt mechanic, or a claim that the learner "can read" a language when they
only know its words in their own language's order ([36](../36-grammar-and-senses/SPEC.md)).

Done with English as the yardstick, it is worse: the maintainer's example is a learner in
Puerto Rico with an all-Spanish browser, whose confetti "is waiting on English to be done"
and never comes, because they never read English pages
([DECISIONS 2026-10-01](../DECISIONS.md)). Coverage and celebrations must count words on
pages in the learner's own base languages ([50](../50-ui-localization-and-base-language/SPEC.md)),
whatever those are, with each base language's own rules for what counts as a word.

## Goals

- An honest, cheap measure of **coverage**: the share of a page's words, in each of the
  learner's base languages, that have a word in the learner's target languages, overall and
  per target language, before density caps. Counted per base language with that base's own
  tokenizer, stopwords and no-standalone tables; a Spanish page is never measured against
  English rules.
- Coverage visible in the popup and, optionally, the toolbar badge.
- Milestone celebrations that are rare (each fires once, ever), gentle (at most one a day,
  never during typing), honest in wording, calm under reduced motion, and easy to turn off.
- No URLs or page content stored; negligible cost on pages.
- Every celebration works for any base language: the first one a Spanish-only reader sees
  happens on a Spanish page, with Spanish copy, and nothing waits on English.

## Non-goals

- Stats over time, weekly recaps: [46](../46-local-stats-and-recap/SPEC.md).
- Which words are swapped and how many: [18](../18-language-precedence-and-mixing/SPEC.md),
  [31](../31-density-and-amount/SPEC.md).
- Streaks or any loss-based mechanic: never.

## User stories

- As a learner who reads English, I want to open the popup and see that 18 % of this
  article's words could be in Spanish, and which of my languages covers most.
- As a learner in Puerto Rico who reads only Spanish, I want my first celebration to happen
  on the Spanish pages I actually read, in Spanish.
- As a bilingual reader of Spanish and English, I want my Spanish pages and my English
  pages measured separately, each by its own language's rules.
- As a learner who has worked for months, I want a small, delightful moment the first time
  half a page is in my languages.
- As a learner who finds animations distracting, I want a quiet message instead, or nothing.
- As anyone, I never want to be interrupted while I'm typing or reading something serious.

## Specification

### 1. Measuring coverage

Coverage is counted in the content script at [15](../15-framework-safe-swapping/SPEC.md)'s
hook, `coverage.count(T, tokenCount, matches)`, which runs for every processed text node
before rules, precedence and density are applied. Only text that Kotiko considers is counted:
nodes inside regions [16](../16-what-not-to-swap/SPEC.md) skips never reach the hook.

Each text node has a base language `B`: the language [16](../16-what-not-to-swap/SPEC.md)
resolves for it (nearest `lang`, else the page's declared or detected language), reduced
to one of the learner's bases ([50 §2](../50-ui-localization-and-base-language/SPEC.md)).
Text in a language that isn't one of the learner's bases never reaches the hook and is
never counted. All numbers below are kept **per base**; a page in two bases (an English
article quoting Spanish) has two independent measures.

For each text node `T` with base `B`:

- **Tokens** = [14](../14-matcher-engine/SPEC.md)'s `tokenCount` for `T` (word-like
  `Intl.Segmenter` tokens after `B`'s boundary adjustments) minus tokens listed in
  `spec/lang/<B>/no-standalone.json`'s `always` list, compared with `B`'s case folding.
  That list holds `B`'s articles: "the", "a", "an" for `en`; "el", "la", "los", "las", "un",
  "una", "unos", "unas" (and "lo") for `es`; "le", "la", "les", "l'", "un", "une", "des"
  for `fr`; "der", "die", "das", "ein", "eine", … for `de`; nothing for `ja` or `zh`, which
  have none. Many target languages have no articles, so counting them would make 100 %
  impossible ([01 S18](../../docs/research/01-language-mixing.md)). A base with no
  `no-standalone.json` (Basic level, 50 §5) uses `_generic`'s empty list.
- **Covered (overall)** = tokens inside matches that have at least one candidate in a
  **shown** language (the set [18](../18-language-precedence-and-mixing/SPEC.md) uses, which
  respects hidden languages and Focus). Matches come only from `B`'s index (records with
  `base_lang` = `B`, 14). A multi-word match covers all its tokens. Matches that 18 drops as
  no-ops (native equals the gloss: Spanish "hotel" on an English page, English "hotel" on a
  Spanish page) are reported to coverage as **known** and count as covered
  ([01 S7](../../docs/research/01-language-mixing.md)).
- **Covered (per target language L)**, for every language the learner has, shown or hidden =
  tokens inside matches with a candidate in L. Its denominator additionally excludes the
  `B` words that [36](../36-grammar-and-senses/SPEC.md)'s `spec/lang/<B>/no-standalone.json`
  lists under `by_target[L]` (articles for article-less target languages; for Turkish,
  Finnish, Hungarian and Korean targets also the base's prepositions and possessive
  determiners that those languages express as suffixes), so English "in" or Spanish "en"
  never counts against Turkish. With base `ja`, Japanese particles (が, を, に, は) are
  listed for targets that express those roles with word order or prepositions.
- Contributions are stored per node in a `WeakMap<Text, {base, tokens, covered, perLang}>`.
  Reprocessing a node replaces its previous contribution; nodes that [15](../15-framework-safe-swapping/SPEC.md)'s
  cleanup finds removed are subtracted. Totals are plain integers per base per page view.

Coverage is **potential** coverage: what Kotiko could swap, measured before
[31](../31-density-and-amount/SPEC.md)'s caps, so a lower Amount never hides progress. The
actually shown share ("showing") is counted from 15's `KotikoEngine.onSwap` and used only by 31's
popup line.

Accuracy note: the hook runs before [16](../16-what-not-to-swap/SPEC.md)'s per-match name
and acronym filters, so a rejected "May" still counts as covered. This overstates coverage by
well under 1 % on ordinary pages; Future work moves the count after the filter.

Frames ([42](../42-frames-and-shadow-dom/SPEC.md)): each frame counts its own text; the
background sums frames per tab.

### 2. Reporting

- The content script sends `{type: "coverage", perBase: {en: {tokens, covered, perLang:
  {es: [covered, tokens], …}, showing}, es: {…}}}` to the background at most once per second (trailing throttle), on
  `visibilitychange` to visible, and once 1 s after the initial walk finishes.
- The background keeps the latest per `tabId` in `storage.session` (`coverage:<tabId>`), so the
  popup reads it instantly, and clears it on navigation (`tabs.onUpdated` with a URL change)
  and on tab close. No URL is stored with it.
- **Popup** ([20](../20-popup-redesign/SPEC.md) This page section). The page's **main
  base** is the base with the most counted tokens; the meter shows it. All text comes from
  `KotikoI18n.t()` in the interface language, and language names from
  `Intl.DisplayNames([uiLocale])` (50 §7). English interface, English page:

```
│ This page · en.wikipedia.org                 │
│ ●●●●●●●●○○○○○○○○○○○○  18 % could be in your  │
│                       languages              │
│ Spanish 14 % · Chinese 6 % · Arabic 2 %   ▾  │
```

  Spanish interface, Spanish page (base `es`):

```
│ Esta página · es.wikipedia.org               │
│ ●●●●●●○○○○○○○○○○○○○○  12 % podría estar en   │
│                       tus idiomas            │
│ inglés 9 % · japonés 3 %                  ▾  │
```

  If a second base has at least 50 counted tokens on the page, a line below reads "Also
  in English on this page: 4 %" ("También en inglés en esta página: 4 %").

  The meter uses [06](../06-design-system/SPEC.md)'s meter component (`--orange` fill,
  `role="meter"`, `aria-valuetext` from the same localized string as the visible label).
  The per-language line lists languages with at least 1 %, by size; hidden languages are
  shown with "(hidden)". With Amount below Everything, [31](../31-density-and-amount/SPEC.md)
  adds "Medium is showing 9 %". Pages under 50 counted tokens show "Not enough text in your
  languages here to measure." Paused, off and unsupported pages show their own states, and a
  page in none of the learner's bases shows 50's `base_page_other` state ("This page is in
  German, which isn't one of your languages. Kotiko leaves it alone.") with no meter.
- **Badge** (setting "Toolbar badge": Coverage (default) · Nothing): the main base's rounded
  percentage, formatted with `Intl.NumberFormat(uiLocale, {style: "percent"})` ("18%",
  "18 %" where the locale puts a space), when the page has at least 150 counted tokens in
  that base and coverage is at least 1 %;
  background `--orange` light value #B4501A (white text 5.12:1). Precedence with "off" and the
  running-jobs dot is in [20 §5](../20-popup-redesign/SPEC.md).

### 3. Milestones

There are two kinds, and they never appear in the same place.

**Page milestones** (on the page, as a toast and, motion allowed, confetti):

| Key | Fires when |
|---|---|
| `page:first-swap` | One of the learner's words is swapped on a real web page (not the welcome tab's preview) for the first time ever, on a page in any of their bases |
| `page:<base>:all:25`, `:50`, `:75`, `:90` | Overall coverage of one base on one page crosses 25, 50, 75 or 90 % for the first time ever, for that base |
| `page:<base>:<lang>:25` … `:90` | One target language's coverage of one base crosses the threshold for the first time ever |

Keys carry the base, so each base language has its own lifetime milestones: a bilingual
reader's first half-Spanish page and first half-English page are two moments, and a
Spanish-only reader's milestones are all Spanish ones. No milestone is shared across bases
or requires any particular base.

`page:first-swap` closes the loop the welcome tab opens ([22](../22-first-run-onboarding/SPEC.md)):
the learner's first word, seen where they actually read. It skips rule 3 below (a short
page is fine) and keeps every other rule. Copy: "Your first word out in the wild: 犬." with
the word in its own `lang`.

**Vocabulary milestones** (inside Kotiko's own popup or dashboard only, never on pages):
first word in a new language, and 10, 50, 100, 250, 500, 1,000, 2,500 and 5,000 words. They
are computed from the word store ([11](../11-local-first-mode/SPEC.md)) or
[46](../46-local-stats-and-recap/SPEC.md)'s counters, and shown once as a milestone card at
the top of the popup or dashboard the next time it opens.

**First word ever** (`vocab:first`): fires once, with confetti, on the welcome tab when the
learner confirms their first word ([22 §7](../22-first-run-onboarding/SPEC.md)), and replaces
that word's "first word in a new language" card.

### 4. When a page milestone fires

All of these must hold, checked in this order (cheapest first):

1. Celebrations are on (`prefs.celebrations`, default **on**) and the tab isn't private
   (`extension.inIncognitoContext` is false).
2. Kotiko is on for this page: not off, not paused, not a site [16](../16-what-not-to-swap/SPEC.md)
   or [38](../38-per-site-rules/SPEC.md) marks sensitive, and the text being measured is in
   one of the learner's bases.
3. The page has at least **150 counted tokens** in the milestone's base, so a two-line page
   can't trigger it.
4. Coverage is **stable**: it hasn't moved more than 2 points in the last 2 s, and the page
   view is at least 5 s old. Partial loads don't fire early.
5. The tab is visible and its window focused (`document.hasFocus()`).
6. The learner isn't busy: focus isn't in an editable element, no key was pressed in the last
   3 s, no text is selected, no pointer button is held, no media element is playing in
   fullscreen.
7. The highest newly crossed milestone key is not in `celebrations.done`.
8. No page milestone was shown today (local calendar day), anywhere.

If several thresholds are crossed at once (a first visit at 60 %), only the highest one
fires (per base), and the lower ones are marked done silently, so the learner never gets a 25 % moment
after a 50 % one. Overall wins over a per-language milestone on the same page; the other
stays pending for another day and page.

**Claiming.** The content script sends `{type: "claimMilestone", key}`; the background (one
thread) checks `celebrations.done` and the daily limit, writes
`celebrations.done[key] = now` and `celebrations.lastPageAt = now` in one `storage.local.set`,
and answers yes or no. Only on yes does the page show anything. Two tabs can't both fire.

Storage, all local: `celebrations: {done: {"page:es:all:50": 1727771234567, …}, lastPageAt}`.
Keys and timestamps only; no URL, title or text. Included in export and "delete all my data"
([12](../12-export-import-and-delete/SPEC.md)).

### 5. What the learner sees

**The message** (always, motion or not): [19 §8](../19-word-popover/SPEC.md)'s in-page toast,
styled as [06](../06-design-system/SPEC.md)'s milestone card, bottom center:

```
   ┌──────────────────────────────────────────────────────────┐
   │ ▌ New milestone                                       ×  │
   │ ▌ Half of this page's words could be in your languages.  │
   │ ▌ Turn off celebrations                                   │
   └──────────────────────────────────────────────────────────┘
```

- `role="status"`, never takes focus, 8 s (paused on hover or focus), Esc or × dismisses.
  "Turn off celebrations" sets `prefs.celebrations = false` and replaces the line with "Off.
  You can turn them back on in Settings." for 3 s.
- Copy, by threshold (overall / one language), in `_locales` (`en` shown; `es` below the
  table). `{Language}` is the target language's name in the interface language:

| | Overall | One language |
|---|---|---|
| 25 | "A quarter of this page's words could be in your languages." | "A quarter of this page's words could be in {Language}." |
| 50 | "Half of this page's words could be in your languages." | "Half of this page's words could be in {Language}." |
| 75 | "Three quarters of this page's words could be in your languages." | "Three quarters of this page's words could be in {Language}." |
| 90 | "Nine in ten of this page's words could be in your languages." | "Nine in ten of this page's words could be in {Language}." |

  Spanish (`es`): 25 "Una cuarta parte de las palabras de esta página podría estar en tus
  idiomas." / "… podría estar en {Language}."; 50 "La mitad de las palabras de esta página
  podría estar en tus idiomas."; 75 "Tres cuartas partes …"; 90 "Nueve de cada diez …";
  first swap "Tu primera palabra, ya en la web: 犬."; "Turn off celebrations" "Desactivar
  celebraciones". The glossary (50 §9) fixes "celebración" and "palabra".

  For 90 % in an agglutinative or verb-final language ([36](../36-grammar-and-senses/SPEC.md)'s
  list), the per-language line is 36's honest wording: "You know 90 % of these words in
  {Language}. Real {Language} puts them together differently; try a {Language} article
  next." No message ever says the learner "can read" or "speaks" a language.
- One exclamation mark is allowed by [05 §3](../05-brand-identity/SPEC.md) here; the copy above
  uses none, and that's the recommendation.

**Confetti** (only when motion is allowed):

- A full-viewport `<canvas>` inside the same closed shadow root as the popover and toast
  (`<kotiko-popover>`, top layer via `popover="manual"`), `pointer-events: none`, `aria-hidden`.
  It never changes page layout or scroll.
- Particles: `clamp(60, viewportArea / 12,000, 120)`, launched in two bursts from the lower
  left and lower right corners upward and inward, with gravity, air drag and spin; shapes
  are small rounded rectangles (6 × 10 px) and circles (5 px), never stars, sparkles or
  hearts. Colors from the brand palette: `--brand`, light `--primary-hover`, `--orange`,
  a lighter orange (#F6A672), and blue (#8DBBFF).
- Duration 1.6 s: particles fade out over the last 0.4 s; then the canvas is removed from
  the DOM. Nothing loops and nothing restarts.
- No flashing (particles keep their color; nothing blinks), no sound.
- Esc, any click or any key stops it immediately.

**Reduced motion** (`prefers-reduced-motion: reduce` or Kotiko's "Reduce motion" setting): no
confetti; the toast appears with a 120 ms fade. This is the full calm alternative, not a
lesser one.

**Vocabulary milestone card** (popup or dashboard): "100 words. Spanish 61, Japanese 39." or
"Your first Japanese word: 犬." ("100 palabras. Inglés 61, japonés 39." / "Tu primera
palabra en japonés: 犬.") with plurals from `Intl.PluralRules` and a word count that counts
target words, not records (a bilingual reader's 犬 is one word, 50 §3), with a small 40-particle burst confined to the card when
motion is allowed. Dismissed with ×; never shown twice.

### 6. Not annoying, by construction

| Risk | Rule |
|---|---|
| Too frequent | Each milestone fires once in a lifetime; at most one page milestone per day; about 1 + (4 + 4 per target language) page moments ever per base |
| Interrupting | Never while typing, selecting, in fullscreen media, unfocused, or in the first 5 s of a page |
| Wrong place | Never on paused, off, sensitive or private pages; vocabulary milestones never on pages |
| Overclaiming | Wording says "could be in your languages" and follows 36 for agglutinative languages |
| Guilt | No streaks, no "you missed", no counters that reset |
| Hard to stop | "Turn off celebrations" in every toast; also dashboard Settings → Learning (one switch) |

Steps to turn celebrations off: 1 (the link in the toast), or 3 from the popup (Settings,
Learning, switch).

### 7. Performance

- Counting adds two integer additions and a small loop over matches per processed node: under
  2 % of 15's per-node budget; no extra DOM reads.
- Messages to the background: at most one a second per tab.
- The confetti code (about 2 KB) is in the content script but does nothing until a claim
  succeeds. While running: one `requestAnimationFrame` loop, no allocation per frame (particles
  in a preallocated typed array), canvas at `min(devicePixelRatio, 2)`, under 2 ms per frame
  on a mid-range laptop; paused when the tab is hidden, and abandoned (not resumed) if hidden
  for more than 1 s.

### 8. Settings

In dashboard Settings → Learning ([21 §9](../21-dashboard/SPEC.md)): "Celebrations" (on by
default): "Mark milestones, like the first time half a page could be in your languages."
In Settings → Reading: "Toolbar badge: Coverage · Nothing".

## Acceptance criteria

- [ ] On a fixture page of 400 counted tokens where 200 belong to forms in a shown language,
      coverage reads 50 %; "the", "a" and "an" don't change the numbers; a Turkish-only
      learner's denominator excludes 36's Turkish list.
- [ ] The same holds on a Spanish fixture page with base `es`: "el", "la", "los", "las",
      "un", "una" don't change the numbers, and the Turkish denominator excludes the
      Spanish list for Turkish.
- [ ] On a Japanese fixture page with base `ja`, tokens come from `Intl.Segmenter` and
      coverage counts 犬 in "犬が好きです" as one covered token of the counted total.
- [ ] A no-op word (Spanish "hotel" on an English page; English "hotel" on a Spanish page
      with base `es`) counts as covered and isn't swapped.
- [ ] **Puerto Rico.** In a browser whose interface and accept languages are only `es-PR`
      and `es`, with base `es` detected (50) and the interface in Spanish: the learner adds
      their first word on the welcome tab by asking in Spanish ("¿cómo se dice perro en
      japonés?", slice 02's fake model returning 犬 with gloss "perro"), then opens a
      Spanish fixture page containing "perro". `page:first-swap` fires on that page with
      the Spanish toast and confetti; a Spanish fixture where half the counted tokens are
      covered later fires `page:es:all:50`. No English page, English gloss or English copy
      is involved at any step (asserted by checking every toast string and stored record).
- [ ] An English page with bases `en` and `es` measures and celebrates only `en`; a Spanish
      quotation inside it adds to `es` only; a German page shows the "not one of your
      languages" state, no meter and no badge.
- [ ] The popup shows coverage within 100 ms of opening on a processed page, with no URL in
      `storage.session`.
- [ ] Crossing 50 % on a qualifying page fires one toast and, without reduced motion, confetti
      that is gone from the DOM within 2 s; reloading the page fires nothing.
- [ ] Two tabs crossing the same milestone at once produce exactly one celebration.
- [ ] A second, different milestone on the same day doesn't fire; it can fire on a later day.
- [ ] Nothing fires while focus is in a text field, on a 120-token page, in a private window,
      or on a paused site.
- [ ] With reduced motion, no canvas is created and the toast fades in.
- [ ] "Turn off celebrations" in the toast stops all later celebrations; the dashboard switch
      reflects it.
- [ ] Confetti frames take under 2 ms on the CI benchmark machine (median), and no frame is
      requested while the tab is hidden.
- [ ] No message uses "can read", "speak" or "fluent" (string lint), or their Spanish
      equivalents "puedes leer", "hablas", "con fluidez".
- [ ] Every string in the popup line, badge, toast and cards comes from `_locales` and is
      complete in `en` and `es`.

## Test plan

- **Unit:** coverage arithmetic per base (articles from each base's `no-standalone.json`
  for `en`, `es`, `fr`, `de` and `ja`, multi-word matches, no-ops, per-language
  denominators, node replacement and removal, two bases on one page); the firing
  conditions with a fake clock (stability window, 5 s minimum, daily limit, highest-only);
  the claim logic under concurrent requests.
- **End-to-end (Playwright):** English and Spanish fixtures with controlled vocabularies
  hitting 24/26/49/51/89/91 %; the Puerto Rico journey with the browser launched as
  `--lang=es-PR`; a German page as a non-base page;
  two tabs racing; reduced-motion emulation; typing in a field during the trigger; a private
  window; the badge setting; dark and light pages.
- **Manual:** watch the confetti on slow hardware and at 4K; NVDA announces the toast once
  without moving focus.

## Rollout and migration

Ships in P1. Kotiko knows nothing about pages from before the update, so `celebrations.done`
starts empty (per base) and the first qualifying page shows only the highest milestone it crosses (the
lower ones are marked done silently, §4). Vocabulary milestones already passed (a learner with 300 words) are marked
done silently, except the next one up; `page:first-swap` is marked done for anyone who
already has words. Changelog: "See how much of a page could be in your
languages, and a small celebration the first time you cross a milestone (you can turn it
off)."

## Implementation notes

*2026-10-02, shipped early by [22](../22-first-run-onboarding/SPEC.md) for the first word,
as §7 of that slice asks: the renderer, the claim and the setting. Requirements above are
unchanged; coverage and page milestones are still to build.*

**Built.**

- `extension/ui/confetti.js` (`KotikoConfetti.burst({host, win, colors, reduced, raf,
  caf, random})`): a `<canvas>` appended to `host` (the welcome page's body today; the
  popover's closed shadow root for page milestones), `position: fixed`, full viewport,
  `pointer-events: none`, `aria-hidden`, `contain: strict`, at `min(devicePixelRatio, 2)`.
  `clamp(60, viewportArea / 12,000, 120)` particles in one preallocated `Float32Array`
  (no allocation per frame), thrown from the lower left and lower right corners up and
  inward, with gravity, air drag and spin; 6 × 10 rounded rectangles that flutter with
  their spin, and 5 px circles; colors `--brand` and `--orange` read from the page's tokens,
  the light `--primary-hover` (#723CD7), #F6A672 and #8DBBFF. 1.6 s, fading over the last
  0.4 s, then removed; nothing loops; no sound. Esc, any click (`pointerdown`) or any key
  stops it. One `requestAnimationFrame` loop: a gap over 1 s (a hidden tab gets no frames)
  abandons it, a shorter one moves the clock on. `reducedMotion(win)` is the media query
  or `<html data-motion="reduce">` (Kotiko's setting); under it `burst` returns null and
  the caller fades its message in over 120 ms.
- `extension/lib/celebrations.js`: `claim(state, key, {now})` (once ever per key; `page:`
  keys also one per local calendar day; `vocab:` keys not), `markDone` (silent), `enabled`.
  The background's `celebrations.claim` runs claims one at a time (extension pages only
  for now; content scripts join with the page milestones) and answers `{claimed,
  celebrate}`, where `celebrate` is false when `prefs.celebrations` is false. Storage is
  `celebrations: {done, lastPageAt}` in `storage.local`. Updates from before 22 mark
  `vocab:first` and `page:first-swap` done for learners with words (§ Rollout).
- `prefs.celebrations` (default on) and its switch in the dashboard's Settings → Learning,
  with §8's help text; "Turn off celebrations" on the welcome tab writes the same key.

**Waiting.** Coverage counting and reporting (§1, §2), page milestones with their toast
(§3 to §5), vocabulary milestone cards in the popup and dashboard, the badge setting, the
string lint for "can read" and friends, and the per-frame benchmark (§7). The renderer's
tests are `test/unit/confetti.test.mjs` (count, duration and fade, removal, stopping,
abandoning, reduced motion, palette) and `test/unit/celebrations.test.mjs`.

## Open questions

1. **A 10 % milestone?** Recommendation: no confetti, but a toast-only "first glimpse" at
   10 % overall, because 25 % takes most learners months; decide after watching early users.
2. **Badge on by default?** Recommendation: yes, on pages with 150+ tokens only; it is the
   quietest way to see progress, and one switch removes it.

## Future work

- Move the coverage count after 16's per-match filters (needs a second hook in 15).
- A one-time "words fade in" touch on the milestone page ([01 S19](../../docs/research/01-language-mixing.md)),
  if it can be done without moving layout.
- Coverage history per language in [46](../46-local-stats-and-recap/SPEC.md), without URLs.
