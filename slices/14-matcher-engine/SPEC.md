# 14 · Matcher engine

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [02-test-harness-and-ci](../02-test-harness-and-ci/SPEC.md) |
| **Unblocks** | [15](../15-framework-safe-swapping/SPEC.md), [16](../16-what-not-to-swap/SPEC.md), [17](../17-casing-and-script-display/SPEC.md), [18](../18-language-precedence-and-mixing/SPEC.md), [31](../31-density-and-amount/SPEC.md), [32](../32-page-coverage-and-celebrations/SPEC.md), [36](../36-grammar-and-senses/SPEC.md) |
| **Sources** | [02 A1-A5, B2, C4](../../docs/research/02-linguistics.md), [03 summary, section 3 "Matching engine"](../../docs/research/03-browser-extension.md), [06 F04, F07, F13, F22, F24](../../docs/research/06-adversarial-qa.md), [01 S9](../../docs/research/01-language-mixing.md) |

## Problem

Mira finds English words with one giant regular expression: every form of every word, sorted
by length, joined with `|` and wrapped in `\b…\b` with the flags `gi` and no `u`
(`extension/content.js:47-51`). Read from the code and reproduced in research 02 and 06:

- **Wrong boundaries.** Without the `u` flag, `\b` only knows `[A-Za-z0-9_]`, so apostrophes,
  hyphens and accented letters all count as word edges. "I can't go" becomes "I можно't go",
  which reverses the meaning; "well-known" becomes "хорошо-known"; "résumé" becomes
  "réсуммаé"; "www.house.com" becomes "www.дом.com" (06 F04, 02 A1-A4, reproduced).
- **Text-node edges count as word edges.** Each text node is matched on its own
  (`content.js:73-104`), so "hot<wbr>dog" becomes "hotсобака" (06 F07, reproduced).
- **Forms with punctuation never match.** "C++", "C#", ".NET", "U.S." and "thank you!" fail,
  because `\b` needs a word character on one side (06 F22, reproduced).
- **It does not scale.** Over 100,000 short text nodes, matching alone took about 60 ms with
  1,000 words, 430 ms with 5,000 and 880 ms with 20,000; a 242 KB page with 30,000
  alternatives took about 4 s (03 summary, 06 F24). A tokenizer plus a `Set` lookup stayed
  at 60-80 ms at every size. Every word or setting change redoes this in every tab
  (`content.js:143-149`, `178-188`).
- **Lookup is lossy.** `buildMatcher` keeps only the newest word per language per form
  (`content.js:42-43`) and normalizes with a plain `toLowerCase()` and whitespace collapse
  (`content.js:20`), with no Unicode normalization, so decomposed text never matches.

This slice replaces the regex with a tokenizer and an index, and defines the exact
boundary rules. Which language wins (18), what to skip (16), casing (17) and DOM changes
(15) are separate slices that consume this one's output.

## Goals

- Every row in the boundary table below passes as a unit test.
- Matching cost does not grow with vocabulary size: within the budgets in "Performance".
- One pure, DOM-free module that runs in the content script, extension pages (dashboard
  preview, onboarding preview) and Node tests unchanged.
- Multi-word forms ("thank you", "ice cream", "give up") match as one unit, longest first.
- The matcher returns every candidate word for a form, not one per language, so slices 18
  and 36 can choose.

## Non-goals

- Choosing among candidates: [18](../18-language-precedence-and-mixing/SPEC.md).
- Proper-noun, acronym, single-letter and element skip rules:
  [16](../16-what-not-to-swap/SPEC.md). This slice only reports the facts those rules need
  (case shape, sentence start, neighbours).
- Display casing: [17](../17-casing-and-script-display/SPEC.md).
- DOM traversal and mutation: [15](../15-framework-safe-swapping/SPEC.md).
- Phrases split across elements ("thank <b>you</b>") and separable phrasal verbs ("give it
  up"): Future work.
- Pages in languages other than English: [50](../50-ui-localization-and-base-language/SPEC.md).

## User stories

- As a learner reading "I can't go", I never see a word that turns a negative into a positive.
- As a learner with Spanish "café", I see it swapped in "a café near the station", including
  when the page stores "é" as "e" plus a combining accent.
- As a learner with 8,000 words across four languages, pages don't slow down as my list grows.
- As a learner who added "ice cream", I see "helado" for "ice cream" and for "ice-cream", and
  never "ice" or "cream" swapped on their own inside that phrase.

## Specification

### Module layout and API

Slice 02 moves today's matcher verbatim into `extension/lib/matcher.js`. This slice replaces
its contents. Files (no build step; content scripts are listed in order in the manifest's `js`
array and share the isolated world, per research 03 section 3):

```
extension/lib/text.js      character classes, key normalization, case shape
extension/lib/matcher.js   buildIndex(), scan()
```

Following slice 02's convention, each lib file is a classic script that attaches one
namespace to `globalThis` (`MiraText`, `MiraMatcher`; later slices add `MiraRules`,
`MiraPrecedence`, `MiraDensity`, `MiraCasing`, `MiraSpeak`) and assigns `module.exports` when
`module` exists, so Node tests load the same file with slice 02's `load-script.mjs`.

```js
// Build once per word-list version. Pure; no DOM.
const index = MiraMatcher.buildIndex(words, { maxPhraseTokens: 6 });

// Scan one string. ctx gives neighbouring text so edges are judged correctly.
const { matches, tokenCount } = MiraMatcher.scan(text, {
  before: "…up to 16 chars of preceding inline text, or U+2029 at block start",
  after:  "…up to 16 chars of following inline text, or U+2029 at block end",
}, index);
```

`words` is the `storage.local.words` projection that slice
[11](../11-local-first-mode/SPEC.md) writes for content scripts, in the shape defined by
[07](../07-word-model-v2/SPEC.md) and [09](../09-shared-word-spec-and-prompt/SPEC.md). The
projection must contain every word whose status is `active` or `well_known` (35), with these
fields: `id`, `lang`, `language`, `native`, `romanization`, `english`, `forms`, `status`,
`created_at`, `note`, and, once slice 36 ships, `sense`, `pos`, `article`,
`article_indefinite`, `gender`, `plural`, `reading`, `native_vocalized`, `ipa`. The matcher
itself reads `id`, `lang`, `native`, `english`, `forms`, `status` and `created_at`; the rest
is carried for slices 18, 19 and 36. A form is 07's object `{ text, enabled, case, ambiguous }`
(slice 36 adds an optional `pos`); a bare string is accepted during migration and means
`{ text, enabled: true, case: "any", ambiguous: false }`.

Each match:

```ts
type Match = {
  start: number; end: number;      // UTF-16 offsets into `text`, end exclusive
  surface: string;                 // text.slice(start, end), exactly as on the page
  key: string;                     // normalized form key, e.g. "thank you"
  entry: FormEntry;                // see Index
  tokens: number;                  // English tokens covered (2 for "thank you")
  tokenIndex: number;              // index of its first token among the tokens inside `text`
  shape: "lower" | "title" | "upper" | "mixed";
  sentenceStart: boolean;
  prevToken: Neighbour | null;     // previous token in text+ctx, for 16 and 36
  nextToken: Neighbour | null;
  prevGap: string; nextGap: string;// the characters between this match and its neighbours
};
```

`Neighbour = { key, surface, shape, sentenceStart }` describes the adjacent token in the same
sentence (null across `. ! ?` or a block boundary).

`tokenCount` is the number of English word tokens wholly inside `text`, for coverage
([32](../32-page-coverage-and-celebrations/SPEC.md)) and density ([31](../31-density-and-amount/SPEC.md)).

### Character classes

Defined once in `text.js`:

| Class | Characters |
|---|---|
| **W** word | `\p{L}`, `\p{M}`, `\p{N}` |
| **A** apostrophe | U+0027 `'`, U+2019 `’`, U+02BC `ʼ` |
| **H** hyphen | U+002D `-`, U+2010 `‐`, U+2011 non-breaking hyphen. Not en or em dashes, which separate words. |
| **I** invisible joiner | U+00AD soft hyphen, U+200B, U+200C, U+200D, U+2060, U+FEFF |
| **S** phrase space | any `\s` including U+00A0 and U+202F |
| **G** glue | `_ @ # / \ = + & % ~ \| < > ^ * $` and backtick, always; `.` and `:` only when the character on their far side is **W** |

### Tokenizer

One sticky Unicode regex finds tokens:

```
TOKEN = W+ ( (A | H | I) W+ )*        with flags "gu"
```

So "can't", "well-known", "house's", "rock'n'roll", "e-mail" and "hot<U+00AD>dog" (with a soft hyphen) are each one
token. A lone quote, a trailing apostrophe ("dogs'") and a double hyphen ("word--word") are
not part of a token.

`Intl.Segmenter` was considered and rejected for the hot path: it splits hyphenated words,
which the rules below need whole, and it was several times slower in research 03's
benchmark setup. It may still be used for grapheme work in slice 17.

**Key normalization** (`text.js: keyOf(token)`):

1. Fast path: if the token is ASCII, the key is `token.toLowerCase()`.
2. Otherwise: remove **I** characters, map every **A** to `'` and every **H** to `-`,
   `normalize("NFC")`, then `toLowerCase()` (root locale; the page is English).
3. No accent folding. "cafe" and "café" are different keys, because folding would make
   "resume" match "résumé" and similar pairs. Slice 09's prompt asks for both spellings
   where English uses both.

Forms are normalized the same way at build time, after one check. A form that contains a
**G** character anywhere except as trailing sentence punctuation (`. ! ? , ; :` at the end) is
**symbolic** ("c++", "c#", ".net", "u.s.") and is kept exactly, lowercased. Any other form has
leading and trailing characters outside **W**, **A**, **H** and **S** trimmed ("thank you!"
becomes "thank you", "dog." becomes "dog").

**Case shape** of a surface: `upper` if it has at least two letters and every cased letter is
uppercase; `title` if the first letter is uppercase and the rest are lowercase; `lower` if
every cased letter is lowercase; otherwise `mixed` ("iPhone", "eBay"). A single uppercase
letter ("I", "A") is `title`.

**Sentence start**: true when the nearest preceding non-**S** character in `before + text` is
one of `. ! ? : ; … " “ ( [ — –` or bullet characters, or is the block-start sentinel U+2029.

### Index

```ts
type Candidate = { word: Word; form: FormFlags };   // one per (word, form)
type FormEntry = { key: string; candidates: Candidate[]; symbolic: boolean };
type TrieNode  = { entry?: FormEntry; next?: Map<string, TrieNode> };

type Index = {
  root: Map<string, TrieNode>;     // keyed by the first token key of every form
  symbolic: RegExp | null;         // forms that contain glue characters, see below
  maxPhraseTokens: number;
  version: string;                 // hash of the inputs, for incremental re-apply in 15
};
```

`buildIndex(words)`:

```
for word in words where word.status is active or well_known (07) and lang is not "en":
  for form in word.forms (fall back to [word.english]):
    if form.enabled === false: continue
    if isSymbolic(form.text): add keyOf(form.text) to symbolicForms; continue   // c++, c#, .net, u.s.
    k = keyOf(trim(form.text))
    if k is empty: continue
    path = tokenize(k) with H inside a token also splitting it ("ice-cream" -> ["ice","cream"]),
           remembering whether the form was written hyphenated, spaced or closed
    if path.length > maxPhraseTokens: drop and report (09 should prevent this)
    node = root.get(path[0]) ... descend/create through path
    node.entry ??= { key: k, candidates: [] }
    node.entry.candidates.push({ word, form })
symbolic = symbolicForms.length
  ? new RegExp("(?<![\\p{L}\\p{M}\\p{N}])(?:" + escaped forms sorted by length desc + ")(?![\\p{L}\\p{M}\\p{N}])", "giu")
  : null
```

All candidates are kept, including several in one language (S8 in research 01): the old
"newest wins within a language" rule (`content.js:42-43`) is removed; slice 18 chooses.
Symbolic forms are capped at 200; beyond that they are dropped and counted in a
diagnostic, because they are the only part that is still a regex.

Single-letter forms ("a", "I") are indexed. Whether a single-letter match may be swapped is
decided by slice 16.

### Scanning

```
scan(text, ctx, index):
  if text has no W character: return { matches: [], tokenCount: 0 }      // fast reject
  full = ctx.before + text + ctx.after; off = ctx.before.length
  tokens = all TOKEN matches in full, each with start, end, key, segments
  for each token t:
    t.inside  = t.start >= off and t.end <= off + text.length
    t.glued   = previous char of t is G (or "." / ":" with W before it)
                or next char is G (or "." / ":" with W after it)
  results = []
  i = 0
  while i < tokens.length:
    t = tokens[i]
    if not t.inside or t.glued: i++; continue
    best = longestPhrase(tokens, i)        // trie walk, below
    if best is null: best = wholeTokenOrPartial(t)
    if best: results.push(best); i = best.lastTokenIndex + 1
    else: i++
  results += symbolic matches inside text, dropping any that overlap earlier results
  return { matches: results (sorted by start), tokenCount: count of inside tokens }
```

**Longest phrase** starting at token `i`: walk the trie from `root.get(tokens[i].key)`; extend
to token `j+1` only if the gap between tokens `j` and `j+1` is one or more **S** characters
and nothing else, token `j+1` is inside `text`, and it is not glued. Record the deepest node
with an `entry`. Leftmost-longest wins; matches never overlap. Phrase length is capped at
`maxPhraseTokens` (6). Cost is O(tokens x maxPhraseTokens) in the worst case and close to
O(tokens) in practice, since most first tokens miss the root map.

**Whole token or part of it**, for a token with internal joiners:

| Token shape | Rule |
|---|---|
| Plain word ("dog") | Look up `[key]`. |
| Whole token is a form ("can't", "well-known", "e-mail") | Match the whole token. |
| Hyphenated, not a form ("ice-cream") | Look up its hyphen segments as a path that must end exactly at the token end. "ice-cream" matches the form "ice cream"; "well-known" never matches "well". |
| Negative or verbal contraction (`n't`, `'ll`, `'re`, `'ve`, `'d`, `'m`) | Whole token only. Never match the stem. |
| `'s` on a pronoun or wh-word (it's, he's, she's, that's, what's, there's, here's, who's, where's, how's, let's) | Whole token only. These are "it is", "let us". |
| Other `X's` | Possessive or "is"/"has": match `X` only; `'s` stays English, outside the swap. |
| Elisions (o'clock, ma'am, rock'n'roll) | Whole token only. |

### Boundary table

Words used: "can" (es poder), "can't" (es no poder), "sum", "café", "dog", "house", "well",
"mail", "it", "us", "a" (de ein), "I" (es yo), "thank you", "ice cream", "c++", "résumé",
"may", "will", "bill". "Swap" here means the matcher reports a match; rows marked with 16
are then dropped by slice 16's rules, which are listed so the full behaviour is in one place.

| # | Input | Matches reported | Final result |
|---|---|---|---|
| 1 | `I can't go` | `can't` (form "can't") | swapped whole; with only "can" known: nothing |
| 2 | `I can’t go` (curly) | same as 1 | same as 1 |
| 3 | `we won't` (form "won") | none | unchanged |
| 4 | `the house's roof` | `house` | `дом's roof` |
| 5 | `it's late` (form "it") | none | unchanged |
| 6 | `a well-known fact` (form "well") | none | unchanged |
| 7 | `send an e-mail` (form "mail") | none | unchanged |
| 8 | `ice-cream` and `ice cream` | one match each, key "ice cream" | both swapped whole |
| 9 | `ice  cream` (two spaces), `ice<U+00A0>cream`, `ice\ncream` | one match | swapped |
| 10 | `ice, cream` | `ice` and `cream` separately, if known | phrase not matched |
| 11 | `a passé résumé` (forms "sum", "pass") | none | unchanged |
| 12 | `my résumé` with "e" + U+0301 (NFD) | `résumé` | swapped |
| 13 | `a café`, `cafés` (form "café") | `café`; `cafés` only if it is a form | correct |
| 14 | `www.house.com`, `house.com`, `@house`, `#house`, `house_2` | none | unchanged |
| 15 | `My house. The dog` | `house`, `dog` (period then space is not glue) | swapped |
| 16 | `hot<wbr>dog` (two text nodes, ctx.before = "hot") | none: token "hotdog" straddles | unchanged |
| 17 | `do<span>g</span>` | none | unchanged |
| 18 | `hot<U+00AD>dog` (soft hyphen) in one node | token "hotdog" | swapped only if "hotdog" is a form |
| 19 | `Thank you!` | `Thank you`, shape title, sentence start | swapped, casing by 17 |
| 20 | `C++ and C#` (forms "c++", "c#") | both, via the symbolic list | swapped |
| 21 | `the US army` (form "us") | `US`, shape upper | 16 drops it (acronym) |
| 22 | `the IT team` (form "it") | `IT`, shape upper | 16 drops it |
| 23 | `Vitamin A.` (form "a") | `A`, title, prevToken "vitamin" | 16 drops it |
| 24 | `I think a cat is a pet` | `I`, `a`, `a` | 16 keeps all three |
| 25 | `World War I` | `I` | 16 drops it |
| 26 | `May 2026`, `in May we` | `May` twice, title | 16 drops both (number, mid-sentence capital) |
| 27 | `Will Smith`, `Bill Gates` | `Will`, `Bill` | 16 drops both (name pair) |
| 28 | `THANK YOU FOR READING` | `THANK YOU`, upper | 16 keeps it (shouting context) |
| 29 | `'cause I said so` (form "cause") | `cause` | swapped (accepted limitation) |
| 30 | `the dogs' bowls` (form "dogs") | `dogs` | swapped; apostrophe stays |
| 31 | `node.js`, `U.S.` (form "us") | none for "us"; `U.S.` only if "u.s." is a symbolic form | unchanged |
| 32 | `9am`, `house2` | none (single tokens with digits) | unchanged |

### Edges across text nodes

Slice 15 passes `ctx.before` and `ctx.after`: up to 16 characters of the neighbouring text in
the same inline run, or U+2029 at a block boundary. A run continues across inline elements
(`a, abbr, b, bdi, bdo, cite, data, del, dfn, em, font, i, ins, mark, q, s, small, span,
strong, sub, sup, time, u, wbr`, and Mira's own `mira-w`) and stops at anything else,
including `br` and any element slice 16 skips. Mira's own `mira-w` counts as a word
character for edge purposes, so nothing new can glue onto a swapped word. Tokens that straddle the edge are discarded, never truncated, which
fixes rows 16 and 17. A phrase that would cross an element is not matched (Future work).

### Performance

Budgets, measured by slice 02's benchmark job on the CI runner, matching only (no DOM):

| Case | Budget | Today (03, 06) |
|---|---|---|
| `buildIndex`, 1,000 words (about 4,000 forms) | 5 ms | regex compile, negligible |
| `buildIndex`, 20,000 words (about 80,000 forms) | 40 ms | 880 ms per scan below |
| `scan` over 100,000 eight-word text nodes, any vocabulary 1k-20k | 100 ms | 60 / 430 / 880 ms |
| `scan` of a 250 KB page with 10,000 forms | 50 ms | 117-435 ms |

Rules that keep it there: a fast reject for strings with no letter; ASCII fast path in
`keyOf`; one `Map` lookup per token; no allocation for tokens that miss the root map; the
index built once per word-list `version` and reused across scans; no per-match string
building beyond `surface` (tooltips are lazy, slice 19). Memory for 80,000 forms stays under
20 MB of heap, checked in the benchmark.

The client also refuses absurd input before indexing, as research 03 E2 recommends: forms
longer than 64 characters, natives longer than 64 characters or containing a newline, and
vocabularies above 20,000 active words (the newest 20,000 are kept) are dropped and counted
in a diagnostic that slice 25 can show.

### Privacy and safety

The matcher never sends page text anywhere and keeps nothing after a scan. Server strings
are only used as `Map` keys or escaped into the small symbolic regex, so no ReDoS is possible
from word data.

## Acceptance criteria

- [ ] `content.js` no longer builds a regex from the vocabulary; all matching goes through
      `MiraMatcher` (the symbolic list is the only regex, capped at 200 forms).
- [ ] All 32 rows of the boundary table pass as unit tests on the matcher plus slice 16's
      filter, with exact offsets.
- [ ] Forms are normalized with NFC and the A/H/I mappings; an NFD page matches an NFC form.
- [ ] Multi-word forms match across any whitespace, never across punctuation or elements,
      and leftmost-longest wins ("thank you" beats "thank").
- [ ] Every candidate for a form is returned, including several in one language.
- [ ] Budgets in the Performance table are enforced in CI with a 25 % tolerance.
- [ ] Oversized forms, natives and vocabularies are dropped and counted, never thrown.

## Test plan

- **Unit (`node --test`, slice 02):** the boundary table as a data-driven test
  (`test/fixtures/boundaries.json`, input, ctx, words, expected matches); key normalization
  (NFD, curly apostrophes, soft hyphens, non-breaking hyphens); phrase walk with gaps of
  every **S** kind; symbolic forms; `'s` and contraction lists; property test that matches
  never overlap and always lie inside `text`.
- **jsdom:** a page built from the table's multi-node rows (`<wbr>`, `<span>`-split words,
  `<b>`-split phrases) run through the full pipeline from slice 15.
- **Benchmark:** slice 02's job generates 100,000 nodes and vocabularies of 1k, 5k and 20k
  random words; records build and scan time and heap; fails on the budgets.
- **End-to-end:** the fixture corpus page `boundaries.html` loaded with the unpacked
  extension; a screenshot diff of expected swaps.

## Rollout and migration

No data migration: the index is rebuilt from the cached word list on load. Behaviour changes
users will notice, for the changelog: "Mira no longer swaps parts of words: contractions like
can't, hyphenated words, accented words and web addresses stay as they are. Phrases like
'thank you' and 'ice cream' swap as one." Ship together with 15, 16 and 17 in one release,
because the boundary table assumes slice 16's filter.

## Open questions

1. **Accent folding.** Should "cafe" on a page match a stored "café"? Recommendation: no
   folding in the matcher; have slice 09 emit both spellings, which avoids "resume" against
   "résumé".
2. **Leading-apostrophe clippings** ("'cause", "'em"). Recommendation: accept the rare
   wrong swap rather than keep a list; revisit if reports come in.

## Future work

- Phrases across inline elements ("thank <b>you</b>") using the run text plus an offset map,
  swapping into two elements.
- Separable phrasal verbs ("give it up") with a gap of one or two tokens.
- An incremental index update when one word is added, instead of a rebuild (rebuild is
  already under 40 ms at 20,000 words).
- English base-language assumptions moved behind a per-base-language config for slice 50.
