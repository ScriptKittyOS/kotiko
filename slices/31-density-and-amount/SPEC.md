# 31 · Density and amount

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | M (about a week) |
| **Depends on** | [18-language-precedence-and-mixing](../18-language-precedence-and-mixing/SPEC.md); uses [14](../14-matcher-engine/SPEC.md)'s per-base `tokenCount` and [50](../50-ui-localization-and-base-language/SPEC.md)'s base languages |
| **Unblocks** | [38-per-site-rules](../38-per-site-rules/SPEC.md) (amount per site), [52](../52-video-captions/SPEC.md) (caption amount) |
| **Sources** | [01 S15-S17, section 3 "Density"](../../docs/research/01-language-mixing.md), [05 S23, S32](../../docs/research/05-learner-ux.md), [03 B11](../../docs/research/03-browser-extension.md), [02 C4](../../docs/research/02-linguistics.md) |

## Problem

Every match is swapped (`extension/content.js:84-100`). With 30 words that is fine. With 3,000
words across three languages, long passages become mostly foreign, often with adjacent swaps
("the большой 狗 corrió"), and a single function word such as "и" for "and" (or "and" for
"y", for a Spanish reader learning English) replaces it on every page (01 S15, S16). Reading research commonly cited for this (Laufer 1989;
Hu and Nation 2000) puts comfortable reading at roughly 95-98 % known running words, and
Kotiko's swaps are by definition words still being learned. Past a point, more swaps stop
teaching: the context in the learner's own language that makes a swapped word guessable
disappears. This is true in every base language: a Spanish reader with 3,000 English and
Japanese words loses their Spanish pages the same way.

There is no control for this today, so a successful learner's reward for adding words is pages
they can't read.

## Goals

- One **Amount** control with four levels; Medium is the default.
- On Light, Medium and Heavy, no block of text exceeds its level's ratio, no two swaps touch,
  and no word repeats more than its per-page cap.
- A learner with thousands of words still gets readable pages; a beginner with 30 words almost
  never hits a cap.
- When a cap binds, the most useful words win: fresh, then missed, then least seen today, then
  a stable seeded order.
- Results are stable on reload and re-render, like slice 18's choices.

## Non-goals

- Which language a swap uses: [18](../18-language-precedence-and-mixing/SPEC.md).
- Coverage measurement: [32](../32-page-coverage-and-celebrations/SPEC.md) measures before
  this slice's caps, so a capped page can still report high coverage.
- Per-site amount and its UI: [38](../38-per-site-rules/SPEC.md). Popup placement:
  [20](../20-popup-redesign/SPEC.md).
- Per-language intensity (05 S32): expressed with weights in slice 18.

## User stories

- As a learner with 4,000 words, I set Medium and articles stay readable, with roughly one
  word in seven in my languages.
- As a learner who added "и" for "and", I see it a few times per page, not 200 times.
- As a Spanish reader who added English "the" for "el", I see it a few times per Spanish
  page, not on every line.
- As a bilingual reader of Spanish and English, I want a Spanish quotation inside an
  English article to be judged on its own, not to use up the English paragraph's swaps.
- As a beginner, I see every one of my 30 words wherever they appear.
- As someone who wants total immersion, I choose Everything and accept harder pages.

## Specification

File: `extension/lib/density.js` (pure; block state passed in), called by slice 15's pipeline
after precedence (18) and before casing (17).

### Levels

| Level | Ratio (`N`: one swap per N base-language tokens per block) | Adjacent swaps | Same word per page (`K`) | Same word per block |
|---|---|---|---|---|
| Light | 15 | never | 2 | 1 |
| Medium (default) | 7 | never | 5 | 1 |
| Heavy | 3 | never | 15 | 2 |
| Everything | no cap | allowed | no cap | no cap |

These are starting values to tune by use, not research-derived numbers (01 S15). They live in
one table in `density.js`, the same for every base language.

**Tokens** are the word tokens slice 14's tokenizer reports for the text's base language
(`Intl.Segmenter` word segments with `isWordLike`, after that base's `boundaries.json`
adjustments). Punctuation and spaces never count. In spaced languages a token is roughly a
word ("el perro come" is 3; "can't" is 1 in English; "l'eau" is 2 in French, l' and eau). In
Japanese and Chinese a token is a dictionary segment, so particles count ("犬が好きです" is 犬,
が, 好き, です: 4), which makes a Japanese block's ratio a little denser in meaning than an
English one at the same `N` (open question 3).

### Blocks

A block is the nearest ancestor whose tag is block-level by name: `p, li, dd, dt, td, th,
blockquote, figcaption, caption, h1-h6, article, section, aside, header, footer, main, div,
body, form, fieldset, details, summary`. Tag names, not computed style, so there are no layout
reads. The text-node-to-block lookup is cached in a `WeakMap<Element, Map<base, BlockState>>`
on the parent element: one state per base language present in the block, so a
`<q lang="es">` inside an English paragraph is budgeted against Spanish tokens only, and
English tokens never pay for Spanish swaps. Text whose language is not one of the
learner's bases (16) is never swapped and never counted. Shadow roots and frames are
separate blocks (42); captions are handled by slice 52.

```ts
type BlockState = {
  base: string;            // the base language this state counts (50's base tag)
  tokens: number;          // tokens in that base seen in this block (from 14's tokenCount)
  swaps: number;           // swaps made
  lastSwapToken: number;   // block-level token index of the last swap, for adjacency
  perForm: Map<string, number>;
};
```

### Selection algorithm

Per text node, with the node's matches (already filtered by 16, with choices from 18) and the
`BlockState` for the node's base language:

```
select(T, matches, block, page, level):
  if level is Everything: return matches
  base = block.tokens                                  // tokens before this node
  block.tokens += tokenCount(T)
  budget = floor(1 + block.tokens / N) − block.swaps   // credit: first eligible word always fits
  ranked = matches sorted by
             (fresh first, recently missed first (35), fewer views today (46, if present),
              then u(seed + "\u001f" + occurrence index))   // 18's seed: stable
  chosen = []
  for m in ranked while budget > 0:
    t = base + m.tokenIndex                            // block-level index
    if adjacent(t, m.tokens, chosen ∪ {block.lastSwapToken}): continue
    if page.perForm[m.choice.concept] >= K: continue
    if block.perForm[m.choice.concept] >= perBlock: continue
    chosen.push(m); budget -= 1
    page.perForm[m.choice.concept]++; block.perForm[m.choice.concept]++
  block.swaps += chosen.length; block.lastSwapToken = max(last swap token)
  record (T -> chosen, tokenCount) for refunds
  return chosen sorted by start
```

- **Credit model.** A block earns one swap per `N` tokens plus one starting credit, so a short
  heading or list item can always show one word, and swaps spread out across a long paragraph
  instead of bunching at its start.
- **Adjacency.** Two swaps are adjacent if no base-language token lies between them in the block
  (whitespace and punctuation don't count). A multi-word form counts as one swap covering its
  tokens.
- **Refunds.** When slice 15 reprocesses a node (site re-render, word change), the node's
  previous tokens, swaps and per-form counts are subtracted first, so re-renders don't drain
  the budget and a re-rendered node gets the same result.
- **Per-form page cap** counts per page session and resets when the page key changes
  (single-page navigation, 18). On an infinite feed, the first `K` occurrences of a word are
  swapped and later ones stay as the page wrote them; function words thin out naturally
  (01 S16, S17). The per-form count is keyed by the choice's concept, which already
  includes the base (one record per base, 50 §3), so "perro" and "dog" have separate caps.

### Readability guard for large vocabularies

The ratio cap is what keeps a learner with thousands of words readable: on Medium, at most about
14 % of a long block's tokens plus one word are foreign, whatever the vocabulary size, and never
two in a row. Two further rules apply on Light, Medium and Heavy:

- **Hard ceiling**: no block exceeds one swap per three tokens, even if a later setting or
  per-site override asks for more (Everything is the only way past it).
- **Choosing Everything** shows a one-time note in the popup: "Everything swaps every word you
  know. Pages can get hard to read; Heavy keeps about one word in three." Selecting it again on
  another site doesn't repeat the note.

The popup's coverage line (32) shows how much more Kotiko *could* swap ("Medium is showing 14 % ·
62 % of this page is in your languages"), so the cap never hides progress.

### The Amount control

A four-stop segmented control in the popup (20) and settings, with one line describing the
selected level. Copy:

- **Light**: "A word here and there."
- **Medium**: "About one word in seven."
- **Heavy**: "About one word in three."
- **Everything**: "Every word you know, everywhere."

Stored as `amount: "light" | "medium" | "heavy" | "everything"` in slice 39's `s:amount`
group; per-site overrides in 38. Changing it re-applies through slice 15's diffed re-apply.
Keyboard: arrow keys move between stops; it is a radio group for assistive technology (27).

### Performance

O(m log m) per node for `m` matches (usually 0-3); block lookup O(depth) once per parent element,
then cached. No DOM reads beyond tag names. Adds under 2 % to slice 15's pipeline time on the
100,000-node fixture.

## Acceptance criteria

- [ ] On a 1,000-token article with every word known, Medium swaps between 10 % and 16 % of
      tokens, with no two adjacent swaps, and each block within its ratio plus one.
- [ ] Light and Heavy produce ratios within their table values on the same fixture; Everything
      swaps every match.
- [ ] A word known as "and" is swapped at most 5 times per page on Medium; with base `es`,
      a word known as "y" likewise on a Spanish page.
- [ ] On a 1,000-token Spanish article with base `es` and every word known, Medium swaps
      between 10 % and 16 % of tokens, counted with the Spanish tokenizer.
- [ ] On a Japanese article with base `ja`, ratios use `Intl.Segmenter` tokens and no two
      swaps are adjacent (particles count as tokens between them).
- [ ] An English paragraph containing a `<q lang="es">` quotation, with bases `en` and
      `es`, budgets the two separately: the quotation's swaps don't reduce the paragraph's
      and vice versa.
- [ ] With 30 known words on a typical article, no match is dropped by the caps (fixture with a
      realistic 30-word vocabulary of common words).
- [ ] When a cap binds, fresh words are chosen before older ones (unit test).
- [ ] Reloading gives identical swaps; re-rendering a block gives identical swaps (refunds work).
- [ ] The Everything note appears once.

## Test plan

- **Unit (slice 02):** selection with synthetic blocks: credits, adjacency with multi-word forms,
  per-form caps, ranking order, refunds; level table.
- **jsdom:** articles with many paragraphs and lists; a React-style re-render of one paragraph.
- **Playwright corpus:** `dense-article.html` (English) and `dense-article-es.html`
  (Spanish, base `es`) with a 3,000-word fixture vocabulary at each level, plus a short
  Japanese article, asserting ratios and adjacency from the DOM; an infinite-feed fixture for per-form caps.
- **Manual:** read three long articles at each level with a large vocabulary and judge
  readability; tune `N` and `K` if needed.

## Rollout and migration

Existing users get Medium, which reduces swaps for anyone with a large list. Changelog: "New
Amount setting: Light, Medium, Heavy or Everything. Medium, the new default, keeps pages readable
by swapping about one word in seven. Choose Everything for the old behaviour." Because this
lowers swaps for current users, the popup shows a one-time note after the update: "Kotiko now
keeps pages readable. Want every word? Set Amount to Everything."

## Open questions

1. **Default level.** Recommendation: Medium for everyone, including existing users, with the
   one-time note.
2. **Should Everything still prevent adjacent swaps?** Recommendation: no; it means everything,
   and Heavy covers dense-but-readable.
3. **Should `N` differ for bases whose tokens are smaller than words (Japanese, Chinese,
   Thai)?** Particles and auxiliaries count as tokens there, so the same `N` gives a slightly
   different feel. Recommendation: one table for every base at launch; add an optional
   per-base multiplier in `spec/lang/<base>/` only if Japanese and Chinese readers report
   pages too sparse or too dense.

## Future work

- Per-language amount if weights in 18 prove too indirect.
- An adaptive level that lowers density on pages that are long and dense.
