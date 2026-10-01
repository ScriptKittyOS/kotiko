# 35 · Reveal mode and review

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | M (about a week) |
| **Depends on** | [19-word-popover](../19-word-popover/SPEC.md); uses stable word IDs and the reserved `well_known` status from [07](../07-word-model-v2/SPEC.md) |
| **Unblocks** | [46-local-stats-and-recap](../46-local-stats-and-recap/SPEC.md) (shares the local signal store) |
| **Sources** | [05 S26, S28, S29, open questions 2 and 5, wireframe 3.2](../../docs/research/05-learner-ux.md), [01 S20, open question 5](../../docs/research/01-language-mixing.md) |

## Problem

Hovering a swapped word shows the English at once (`extension/content.js:96`), so the learner
never has to recall it: recognition without retrieval (05 S26). Mira also learns nothing from
use. A word you keep getting wrong appears exactly as often as one you've known for months, and
there is no way to say "I know this one now" short of deleting it (05 S28). Retrieval practice
and spacing are among the best-supported findings in learning research (01 section 3), and Mira
already provides the spacing for free by showing words across pages and days.

## Goals

- A **Reveal mode** (test yourself): the popover hides the English until asked.
- **Knew it / Didn't know** answers in the popover, stored locally per word.
- **Light review weighting**: words you missed show up more and are easier to spot; words you
  know well fade into ordinary text.
- **Well known** status: suggested automatically from answers, set or cleared by the user, and
  either kept swapping (default) or retired.
- No schedules, notifications, streaks or guilt.

## Non-goals

- Popover layout and interaction: [19](../19-word-popover/SPEC.md) (this slice defines its
  content states and actions).
- Stats and recaps: [46](../46-local-stats-and-recap/SPEC.md).
- A spaced-repetition scheduler or flashcard sessions.
- Syncing signals across devices: [39](../39-multi-device-sync/SPEC.md) may carry them later.

## User stories

- As a learner, I turn on Reveal mode, see "собака", think "dog", then reveal and press
  "Knew it".
- As a learner who keeps forgetting "колесо", I see it more often and with a stronger underline
  until I get it.
- As a learner who has known "gracias" for months, it stops drawing my eye but stays in the page.
- As a learner who prefers known words gone, I set well-known words to stop swapping.

## Specification

### Popover states (content for slice 19)

Normal mode (Reveal off):

```
+----------------------------------------+
| 谢谢   xièxie                [speaker] |
| Mandarin                               |
| thanks                                 |
| Also: gracias · спасибо                |
|----------------------------------------|
| Knew it     Didn't know                |
+----------------------------------------+
```

Reveal mode, before revealing:

```
+----------------------------------------+
| 谢谢   xièxie                [speaker] |
| Mandarin                               |
| [ Show English ]                       |
+----------------------------------------+
```

After "Show English": the English and "Also" lines appear, focus moves to "Knew it", and the
answer buttons get primary emphasis. Romanization stays visible in both states; it is
pronunciation, not meaning. A setting "Hide pronunciation until I reveal" covers learners who
want a harder test. Keyboard: Space or Enter on "Show English"; then K for "Knew it" and D for
"Didn't know" (19 owns key handling; 33 adds a global "reveal the word under the cursor"
shortcut). Screen readers: the English is not in the accessibility tree until revealed (27).

After an answer, the buttons are replaced by a one-line confirmation ("Marked: knew it ·
Change") for the rest of that popover session; "Change" lets the learner correct a mis-tap.

### Signal store

Local only, in `storage.local` under one key `review`, a map keyed by word UUID (07):

```ts
review: Record<WordId, {
  knew: number; missed: number;          // lifetime counts (one per page view at most)
  streak: number;                        // consecutive "knew" answers, reset by a miss
  knewDays: string[];                    // distinct local dates of the current streak, max 5
  lastAnswerAt: number; lastMissedAt: number | null;
  autoMarkedAt: number | null;           // when Mira (not the user) marked it well known
}>
```

Writes are batched (2 s debounce) through the background worker so that tabs don't race. One
answer per word per page view counts towards the streak, so rapid clicking can't retire a word.
About 80 bytes per word: 20,000 words is under 2 MB. Deleting a word deletes its entry; slice
12's export includes `review` as an optional section, and "delete all my data" clears it.

### Well known

"Well known" is a word status, not a local flag: the word's `status` becomes `well_known`
(the value slice 07 reserves), saved through the normal edit path (07's `PATCH`, or the local
store in 11), so it syncs (39), shows in the dashboard's status filter (21) and survives export
(12). The counters above stay local.

- **Auto**: a word becomes well known when `streak >= 3` across at least 3 distinct days
  (`knewDays`) and it hasn't been missed in 14 days. The next popover for it shows "Marked as
  well known · Undo".
- **User**: "Mark as well known" and "Back to learning" in the popover's overflow menu and in
  the dashboard (21), which also filters by status.
- Any "Didn't know" returns a word to `active`.
- Setting **"Words you know well"**: "Keep swapping, without the underline" (default) or "Stop
  swapping". Coverage (32) counts well-known words as known either way.

### Light review weighting

Signals feed three existing mechanisms; no new scheduling exists.

| Signal | Precedence (18) `wordWeight` | Density (31) ranking | Display |
|---|---|---|---|
| Missed in the last 7 days | 2 (wins more often among same-language synonyms) | before other non-fresh words | class `mira-missed`: solid underline, design tokens from 06 |
| Learning (default) | 1 | normal | dotted underline (15) |
| Well known, keep swapping | 0.5 | after other words | class `mira-known`: no underline, `cursor: help` kept |
| Well known, stop swapping | removed as a candidate in 18's cleanup step | n/a | n/a |

"Learning" in this table is the ordinary `active` status.

Cross-language shares in slice 18 are not changed by review signals; weights there stay the
user's own.

### Settings

```ts
revealMode: boolean;               // default false
revealHidesPronunciation: boolean; // default false
wellKnown: "keep" | "stop";        // default "keep"
```

Stored in slice 39's `s:display` group. The popup (20) shows Reveal mode as one toggle
("Test yourself"); the rest live in settings.

## Acceptance criteria

- [ ] With Reveal mode on, the popover never shows the English (visually or to assistive
      technology) until "Show English" is activated.
- [ ] "Knew it" and "Didn't know" update `review` once per word per page view; a second tap in the
      same view changes the answer instead of adding one.
- [ ] Three "knew" answers on three different days, with no miss in 14 days, mark a word well
      known (status `well_known`) with an undo; a miss returns it to `active`.
- [ ] Missed words get `wordWeight` 2 and the `mira-missed` class; well-known words get 0.5 and
      `mira-known`; "Stop swapping" removes them from candidates.
- [ ] Review data never leaves the device except in a user-initiated export.

## Test plan

- **Unit (slice 02):** state transitions for the signal store with fake dates; weight mapping;
  debounce and per-view de-duplication.
- **Playwright:** reveal flow with keyboard only; answer persistence across reload; class changes
  on swapped words after answers.
- **Manual:** screen reader pass (NVDA, VoiceOver) of the hidden and revealed states with
  slice 27's checklist.

## Rollout and migration

Off by default; no migration (empty store). Changelog: "Test yourself: turn on Reveal mode to
guess before you see the English. Tell Mira when you knew a word, and words you've mastered fade
into the page."

## Open questions

1. **Well-known words: keep swapping or stop?** (05 open question 2, 01 open question 5.)
   Recommendation: keep swapping without the underline by default, since immersion is the point;
   offer "Stop swapping".
2. **Where do signals live?** (05 open question 5.) Recommendation: browser only for now; slice 39
   can sync them later through the same tombstone model.

## Future work

- Answer buttons on the Telegram bot's word cards, feeding the same store through sync.
- A "words I missed this week" list in the dashboard.
