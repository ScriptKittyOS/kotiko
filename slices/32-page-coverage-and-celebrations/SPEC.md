# 32 · Page coverage and celebrations

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | M (about a week) |
| **Depends on** | [14-matcher-engine](../14-matcher-engine/SPEC.md), [06-design-system](../06-design-system/SPEC.md); uses [15](../15-framework-safe-swapping/SPEC.md)'s coverage hook, [18](../18-language-precedence-and-mixing/SPEC.md)'s known signal, [36](../36-grammar-and-senses/SPEC.md)'s `no-standalone.json` |
| **Unblocks** | The popup's This page meter ([20](../20-popup-redesign/SPEC.md)); [31](../31-density-and-amount/SPEC.md)'s "showing" line |
| **Sources** | Maintainer request (confetti) and [DECISIONS: celebrations on by default](../DECISIONS.md); [01 S18, S19, S20, S21](../../docs/research/01-language-mixing.md); [05 S29, S30](../../docs/research/05-learner-ux.md) |

## Problem

Learners can't see their progress on the page in front of them. Nothing in Mira measures
how much of a page is in the learner's languages: every match is swapped and nothing is
counted (`extension/content.js:84-100`), and the popup shows only a total word count
(`popup.js:128-129`). The maintainer wants the moment when most of a page is in your
languages to feel special, confetti included, and has decided celebrations are on by default
([DECISIONS](../DECISIONS.md)). Done carelessly, that becomes an interruption on someone
else's website, a guilt mechanic, or a claim that the learner "can read" a language when they
only know its words in English order ([36](../36-grammar-and-senses/SPEC.md)).

## Goals

- An honest, cheap measure of **coverage**: the share of a page's English words that have a
  word in the learner's languages, overall and per language, before density caps.
- Coverage visible in the popup and, optionally, the toolbar badge.
- Milestone celebrations that are rare (each fires once, ever), gentle (at most one a day,
  never during typing), honest in wording, calm under reduced motion, and easy to turn off.
- No URLs or page content stored; negligible cost on pages.

## Non-goals

- Stats over time, weekly recaps: [46](../46-local-stats-and-recap/SPEC.md).
- Which words are swapped and how many: [18](../18-language-precedence-and-mixing/SPEC.md),
  [31](../31-density-and-amount/SPEC.md).
- Streaks or any loss-based mechanic: never.

## User stories

- As a learner, I want to open the popup and see that 18 % of this article's words could be
  in Spanish, and which of my languages covers most.
- As a learner who has worked for months, I want a small, delightful moment the first time
  half a page is in my languages.
- As a learner who finds animations distracting, I want a quiet message instead, or nothing.
- As anyone, I never want to be interrupted while I'm typing or reading something serious.

## Specification

### 1. Measuring coverage

Coverage is counted in the content script at [15](../15-framework-safe-swapping/SPEC.md)'s
hook, `coverage.count(T, tokenCount, matches)`, which runs for every processed text node
before rules, precedence and density are applied. Only text that Mira considers is counted:
nodes inside regions [16](../16-what-not-to-swap/SPEC.md) skips never reach the hook.

For each text node `T`:

- **Tokens** = [14](../14-matcher-engine/SPEC.md)'s `tokenCount` minus tokens equal to
  "the", "a" or "an" (case-insensitive). Many languages have no articles, so counting them
  would make 100 % impossible ([01 S18](../../docs/research/01-language-mixing.md)).
- **Covered (overall)** = tokens inside matches that have at least one candidate in a
  **shown** language (the set [18](../18-language-precedence-and-mixing/SPEC.md) uses, which
  respects hidden languages and Focus). A multi-word match covers all its tokens. Matches
  that 18 drops as no-ops (native equals the English, "hotel") are reported to coverage as
  **known** and count as covered ([01 S7](../../docs/research/01-language-mixing.md)).
- **Covered (per language L)**, for every language the learner has, shown or hidden =
  tokens inside matches with a candidate in L. Its denominator additionally excludes the
  English words that [36](../36-grammar-and-senses/SPEC.md)'s `extension/data/no-standalone.json`
  lists for L (articles for article-less languages; for Turkish, Finnish, Hungarian and Korean
  also suffix prepositions and possessive determiners), so "in" never counts against Turkish.
- Contributions are stored per node in a `WeakMap<Text, {tokens, covered, perLang}>`.
  Reprocessing a node replaces its previous contribution; nodes that [15](../15-framework-safe-swapping/SPEC.md)'s
  cleanup finds removed are subtracted. Totals are plain integers per page view.

Coverage is **potential** coverage: what Mira could swap, measured before
[31](../31-density-and-amount/SPEC.md)'s caps, so a lower Amount never hides progress. The
actually shown share ("showing") is counted from 15's `MiraEngine.onSwap` and used only by 31's
popup line.

Accuracy note: the hook runs before [16](../16-what-not-to-swap/SPEC.md)'s per-match name
and acronym filters, so a rejected "May" still counts as covered. This overstates coverage by
well under 1 % on ordinary pages; Future work moves the count after the filter.

Frames ([42](../42-frames-and-shadow-dom/SPEC.md)): each frame counts its own text; the
background sums frames per tab.

### 2. Reporting

- The content script sends `{type: "coverage", tokens, covered, perLang: {es: [covered,
  tokens], …}, showing}` to the background at most once per second (trailing throttle), on
  `visibilitychange` to visible, and once 1 s after the initial walk finishes.
- The background keeps the latest per `tabId` in `storage.session` (`coverage:<tabId>`), so the
  popup reads it instantly, and clears it on navigation (`tabs.onUpdated` with a URL change)
  and on tab close. No URL is stored with it.
- **Popup** ([20](../20-popup-redesign/SPEC.md) This page section):

```
│ This page · en.wikipedia.org                 │
│ ●●●●●●●●○○○○○○○○○○○○  18 % could be in your  │
│                       languages              │
│ Español 14 % · 中文 6 % · العربية 2 %     ▾  │
```

  The meter uses [06](../06-design-system/SPEC.md)'s meter component (`--orange` fill,
  `role="meter"`, `aria-valuetext="18 % of this page's words could be in your languages"`).
  The per-language line lists languages with at least 1 %, by size; hidden languages are
  shown with "(hidden)". With Amount below Everything, [31](../31-density-and-amount/SPEC.md)
  adds "Medium is showing 9 %". Pages under 50 counted tokens show "Not enough English text
  here to measure." Paused, off, unsupported and non-English pages show their own states.
- **Badge** (setting "Toolbar badge": Coverage (default) · Nothing): the rounded percentage
  ("18%") when the page has at least 150 counted tokens and coverage is at least 1 %;
  background `--orange` light value #B4501A (white text 5.12:1). Precedence with "off" and the
  running-jobs dot is in [20 §5](../20-popup-redesign/SPEC.md).

### 3. Milestones

There are two kinds, and they never appear in the same place.

**Page milestones** (on the page, as a toast and, motion allowed, confetti):

| Key | Fires when |
|---|---|
| `page:all:25`, `:50`, `:75`, `:90` | Overall coverage on one page crosses 25, 50, 75 or 90 % for the first time ever |
| `page:<lang>:25` … `:90` | One language's own coverage crosses the threshold for the first time ever |

**Vocabulary milestones** (inside Mira's own popup or dashboard only, never on pages):
first word in a new language, and 10, 50, 100, 250, 500, 1,000, 2,500 and 5,000 words. They
are computed from the word store ([11](../11-local-first-mode/SPEC.md)) or
[46](../46-local-stats-and-recap/SPEC.md)'s counters, and shown once as a milestone card at
the top of the popup or dashboard the next time it opens.

### 4. When a page milestone fires

All of these must hold, checked in this order (cheapest first):

1. Celebrations are on (`prefs.celebrations`, default **on**) and the tab isn't private
   (`extension.inIncognitoContext` is false).
2. Mira is on for this page: not off, not paused, not a site [16](../16-what-not-to-swap/SPEC.md)
   or [38](../38-per-site-rules/SPEC.md) marks sensitive.
3. The page has at least **150 counted tokens**, so a two-line page can't trigger it.
4. Coverage is **stable**: it hasn't moved more than 2 points in the last 2 s, and the page
   view is at least 5 s old. Partial loads don't fire early.
5. The tab is visible and its window focused (`document.hasFocus()`).
6. The learner isn't busy: focus isn't in an editable element, no key was pressed in the last
   3 s, no text is selected, no pointer button is held, no media element is playing in
   fullscreen.
7. The highest newly crossed milestone key is not in `celebrations.done`.
8. No page milestone was shown today (local calendar day), anywhere.

If several thresholds are crossed at once (a first visit at 60 %), only the highest one
fires, and the lower ones are marked done silently, so the learner never gets a 25 % moment
after a 50 % one. Overall wins over a per-language milestone on the same page; the other
stays pending for another day and page.

**Claiming.** The content script sends `{type: "claimMilestone", key}`; the background (one
thread) checks `celebrations.done` and the daily limit, writes
`celebrations.done[key] = now` and `celebrations.lastPageAt = now` in one `storage.local.set`,
and answers yes or no. Only on yes does the page show anything. Two tabs can't both fire.

Storage, all local: `celebrations: {done: {"page:all:50": 1727771234567, …}, lastPageAt}`.
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
- Copy, by threshold (overall / one language):

| | Overall | One language |
|---|---|---|
| 25 | "A quarter of this page's words could be in your languages." | "A quarter of this page's words could be in {Language}." |
| 50 | "Half of this page's words could be in your languages." | "Half of this page's words could be in {Language}." |
| 75 | "Three quarters of this page's words could be in your languages." | "Three quarters of this page's words could be in {Language}." |
| 90 | "Nine in ten of this page's words could be in your languages." | "Nine in ten of this page's words could be in {Language}." |

  For 90 % in an agglutinative or verb-final language ([36](../36-grammar-and-senses/SPEC.md)'s
  list), the per-language line is 36's honest wording: "You know 90 % of these words in
  {Language}. Real {Language} puts them together differently; try a {Language} article
  next." No message ever says the learner "can read" or "speaks" a language.
- One exclamation mark is allowed by [05 §3](../05-brand-identity/SPEC.md) here; the copy above
  uses none, and that's the recommendation.

**Confetti** (only when motion is allowed):

- A full-viewport `<canvas>` inside the same closed shadow root as the popover and toast
  (`<mira-popover>`, top layer via `popover="manual"`), `pointer-events: none`, `aria-hidden`.
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

**Reduced motion** (`prefers-reduced-motion: reduce` or Mira's "Reduce motion" setting): no
confetti; the toast appears with a 120 ms fade. This is the full calm alternative, not a
lesser one.

**Vocabulary milestone card** (popup or dashboard): "100 words. Spanish 61, Japanese 39." or
"Your first Japanese word: 犬." with a small 40-particle burst confined to the card when
motion is allowed. Dismissed with ×; never shown twice.

### 6. Not annoying, by construction

| Risk | Rule |
|---|---|
| Too frequent | Each milestone fires once in a lifetime; at most one page milestone per day; about 4 + 4 per language page moments ever |
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
- [ ] A no-op word (Spanish "hotel") counts as covered and isn't swapped.
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
- [ ] No message uses "can read", "speak" or "fluent" (string lint).

## Test plan

- **Unit:** coverage arithmetic (articles, multi-word matches, no-ops, per-language
  denominators with `no-standalone.json`, node replacement and removal); the firing
  conditions with a fake clock (stability window, 5 s minimum, daily limit, highest-only);
  the claim logic under concurrent requests.
- **End-to-end (Playwright):** fixtures with controlled vocabularies hitting 24/26/49/51/89/91 %;
  two tabs racing; reduced-motion emulation; typing in a field during the trigger; a private
  window; the badge setting; dark and light pages.
- **Manual:** watch the confetti on slow hardware and at 4K; NVDA announces the toast once
  without moving focus.

## Rollout and migration

Ships in P1. Mira knows nothing about pages from before the update, so `celebrations.done`
starts empty and the first qualifying page shows only the highest milestone it crosses (the
lower ones are marked done silently, §4). Vocabulary milestones already passed (a learner with 300 words) are marked
done silently, except the next one up. Changelog: "See how much of a page could be in your
languages, and a small celebration the first time you cross a milestone (you can turn it
off)."

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
