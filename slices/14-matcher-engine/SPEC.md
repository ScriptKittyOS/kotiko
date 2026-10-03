# 14 · Matcher engine

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [02-test-harness-and-ci](../02-test-harness-and-ci/SPEC.md), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (base tags, `spec/lang/<base>/` data) |
| **Unblocks** | [15](../15-framework-safe-swapping/SPEC.md), [16](../16-what-not-to-swap/SPEC.md), [17](../17-casing-and-script-display/SPEC.md), [18](../18-language-precedence-and-mixing/SPEC.md), [31](../31-density-and-amount/SPEC.md), [32](../32-page-coverage-and-celebrations/SPEC.md), [36](../36-grammar-and-senses/SPEC.md) |
| **Sources** | [DECISIONS 2026-10-01, "English is not the base language"](../DECISIONS.md); [02 A1-A5, B2, C4](../../docs/research/02-linguistics.md), [03 summary, section 3 "Matching engine"](../../docs/research/03-browser-extension.md), [06 F04, F07, F13, F22, F24](../../docs/research/06-adversarial-qa.md), [01 S9](../../docs/research/01-language-mixing.md) |

## Problem

Kotiko finds base-language words with one giant regular expression: every form of every word,
sorted by length, joined with `|` and wrapped in `\b…\b` with the flags `gi` and no `u`
(`extension/content.js:47-51`). It was written for English pages only. Read from the code and
reproduced in research 02 and 06:

- **Wrong boundaries.** Without the `u` flag, `\b` only knows `[A-Za-z0-9_]`, so apostrophes,
  hyphens and accented letters all count as word edges. "I can't go" becomes "I можно't go",
  which reverses the meaning; "well-known" becomes "хорошо-known"; "résumé" becomes
  "réсуммаé"; "www.house.com" becomes "www.дом.com" (06 F04, 02 A1-A4, reproduced). The same
  flaw hits every Latin base: on a Spanish page, "pingüino" splits at "ü", and "acción" at "ó".
- **No idea of a word outside English.** Japanese, Chinese and Thai write words without
  spaces, so `\b` either never fires inside a sentence or fires around every character: a
  Japanese reader's form 犬 can't be found in "犬が好き". French elisions ("l'eau") and
  Spanish inverted punctuation ("¿perro?") have no rules at all. Read from the code.
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

This slice replaces the regex with a tokenizer and one index per base language, and defines
the exact boundary rules for each base. Which language wins (18), what to skip (16), casing
(17) and DOM changes (15) are separate slices that consume this one's output.

## Goals

- The matcher works for any base language in slice [50](../50-ui-localization-and-base-language/SPEC.md):
  spaced scripts, scripts without spaces (Japanese, Chinese, Thai, Khmer, Lao) and everything
  `Intl.Segmenter` supports.
- Every row in the boundary tables below (English, Spanish, French, Italian, German,
  Japanese, Chinese, Thai) passes as a unit test.
- Per-language boundary behavior is data, not code: one entry per language that needs one in
  the shared `spec/lang/_generic/boundaries.json` (50 §5); every other language uses its
  `default`.
- Matching cost does not grow with vocabulary size: within the budgets in "Performance".
- One pure, DOM-free module that runs in the content script, extension pages (dashboard
  preview, onboarding preview) and Node tests unchanged.
- Multi-word forms ("thank you", "ice cream", "give up"; "por favor", "helado de fresa")
  match as one unit, longest first.
- The matcher returns every candidate word for a form, not one per language, so slices 18
  and 36 can choose.

## Non-goals

- Choosing among candidates: [18](../18-language-precedence-and-mixing/SPEC.md).
- Deciding which base applies to a piece of text (page and `lang` subtree language),
  proper-noun, acronym, single-letter and element skip rules:
  [16](../16-what-not-to-swap/SPEC.md). This slice only reports the facts those rules need
  (case shape, sentence start, neighbours) for the base it was given.
- Display casing: [17](../17-casing-and-script-display/SPEC.md).
- DOM traversal and mutation: [15](../15-framework-safe-swapping/SPEC.md).
- The base-language setting, detection and the layout of `spec/lang/`:
  [50](../50-ui-localization-and-base-language/SPEC.md). This slice owns the contents and
  schema of `boundaries.json`.
- Phrases split across elements ("thank <b>you</b>") and separable phrasal verbs ("give it
  up"): Future work.

## User stories

- As a learner reading "I can't go", I never see a word that turns a negative into a positive.
- As a learner with Spanish "café" on English pages, I see it swapped in "a café near the
  station", including when the page stores "é" as "e" plus a combining accent.
- As a Spanish reader learning Japanese, I see 犬 in "¿Tienes un perro?" and in "la casa
  del perro", and "del" is never cut into pieces.
- As a French reader learning English, "l'eau" shows "l'water", and "aujourd'hui" is never
  broken apart.
- As a Japanese reader learning Korean, I see 개 in "犬が好きです", though Japanese has no
  spaces between words.
- As a learner with 8,000 words across four languages, pages don't slow down as my list grows.
- As a learner who added "ice cream" (or "helado"), I see the word for "ice cream" and
  "ice-cream", and never "ice" or "cream" swapped on their own inside that phrase.

## Specification

### Module layout and API

Slice 02 moves today's matcher verbatim into `extension/lib/matcher.js`. This slice replaces
its contents. Files (no build step; content scripts are listed in order in the manifest's `js`
array and share the isolated world, per research 03 section 3):

```
extension/lib/text.js      character classes, tokenizer, key normalization, case shape
extension/lib/matcher.js   buildIndex(), buildIndexes(), scan()
extension/spec/lang/_generic/boundaries.json copied from spec/lang/ by slice 09's sync script
```

Following slice 02's convention, each lib file is a classic script that attaches one
namespace to `globalThis` (`KotikoText`, `KotikoMatcher`; later slices add `KotikoRules`,
`KotikoPrecedence`, `KotikoDensity`, `KotikoCasing`, `KotikoSpeak`) and assigns `module.exports` when
`module` exists, so Node tests load the same file with slice 02's `load-script.mjs`.

```js
// Build once per word-list version and base-language set. Pure; no DOM.
const indexes = KotikoMatcher.buildIndexes(words, baseLangs, { maxPhraseTokens: 6 });
// -> Map<baseTag, Index>; same as calling buildIndex(words, { base, ... }) per base

// Scan one string in one base. 16 decides the base from the text's language;
// text in a language that isn't a base is never scanned.
const { matches, tokenCount } = KotikoMatcher.scan(text, {
  base: "es",
  before: "…up to 16 chars of preceding inline text, or U+2029 at block start",
  after:  "…up to 16 chars of following inline text, or U+2029 at block end",
}, indexes.get("es"));
```

`baseLangs` is `storage.local.baseLangs` (50's mirror of `s:ui.baseLangs`). `scan` throws in
tests (and logs once in production) if `ctx.base` is not the same base as `index.base`.

`words` is the `storage.local.words` projection that slice
[11](../11-local-first-mode/SPEC.md) writes for content scripts, in the shape defined by
[07](../07-word-model-v2/SPEC.md) and [09](../09-shared-word-spec-and-prompt/SPEC.md). The
projection must contain every word whose status is `active` or `well_known` (35), with these
fields: `id`, `lang`, `native`, `romanization`, `base_lang`, `gloss`, `forms`, `status`,
`created_at`, `note`, and, once slice 36 ships, `sense`, `pos`, `article`,
`article_indefinite`, `gender`, `plural`, `reading`, `ipa`; slice 07's `native_vocalized`,
`pronunciation`, `pronunciation_careful` and `pronunciation_source` are in the projection from
the start. The matcher itself reads `id`, `lang`, `native`, `base_lang`, `gloss`, `forms`,
`status` and `created_at`; the rest is carried for slices 18, 19, 35, 36 and 37. **The
pronunciation fields and `romanization` play no part in matching**: matching runs on the
page's base-language text against `forms`, never on how the target word is said or
romanized, so they are not tokenized or indexed. An index built from a projection that
differs only in these fields is identical, so an edit to a pronunciation, or slice 07's
refresh filling one in, may skip the rebuild; the popover reads the new value from the
projection. A form is 07's object
`{ text, enabled, case, ambiguous }` (slice 36 adds an optional `pos`), and its `text` is a
surface form in the word's `base_lang`; a bare string is accepted during migration and means
`{ text, enabled: true, case: "any", ambiguous: false }`. Display names come from slice 08 and
50 (`Intl.DisplayNames` in the interface language), never from a stored name.

Each match:

```ts
type Match = {
  start: number; end: number;      // UTF-16 offsets into `text`, end exclusive
  surface: string;                 // text.slice(start, end), exactly as on the page
  key: string;                     // normalized form key, e.g. "thank you", "por favor", "犬"
  entry: FormEntry;                // see Index
  tokens: number;                  // base-language tokens covered (2 for "thank you")
  tokenIndex: number;              // index of its first token among the tokens inside `text`
  shape: "lower" | "title" | "upper" | "mixed" | "caseless";
  sentenceStart: boolean;
  prevToken: Neighbour | null;     // previous token in text+ctx, for 16 and 36
  nextToken: Neighbour | null;
  prevGap: string; nextGap: string;// the characters between this match and its neighbours
};
```

`Neighbour = { key, surface, shape, sentenceStart }` describes the adjacent token in the same
sentence (null across a sentence end or a block boundary).

`tokenCount` is the number of word-like tokens of `ctx.base` wholly inside `text`. Because
every scan is in one base, callers get per-base counts for coverage
([32](../32-page-coverage-and-celebrations/SPEC.md)) and density
([31](../31-density-and-amount/SPEC.md)) by keying their totals on `ctx.base`; nothing adds a
Spanish page's tokens to an English total (50 rule 7).

### Character classes

Defined once in `text.js`, the same for every base:

| Class | Characters |
|---|---|
| **W** word | `\p{L}`, `\p{M}`, `\p{N}` |
| **A** apostrophe | U+0027 `'`, U+2019 `’`, U+02BC `ʼ` |
| **H** hyphen | U+002D `-`, U+2010 `‐`, U+2011 non-breaking hyphen. Not en or em dashes, which separate words. |
| **I** invisible joiner | U+00AD soft hyphen, U+200B, U+200C, U+200D, U+2060, U+FEFF |
| **S** phrase space | any `\s` including U+00A0 and U+202F (French puts U+202F before `? ! ; :` and inside « ») |
| **G** glue | `_ @ # / \ = + & % ~ \| < > ^ * $` and backtick, always; `.` and `:` only when the character on their far side is **W** |

### Tokenizer

**Segmentation.** `KotikoText.tokenize(full, base)` runs `Intl.Segmenter(segLocale(base),
{ granularity: "word" })` over the string and keeps the segments with `isWordLike: true`.
`segLocale` is the base tag (`zh-Hans`, `ja`, `th`, `pt-BR`). One segmenter instance per base
is created lazily and cached for the life of the content script, because construction costs
far more than a call. `Intl.Segmenter` is in Chrome 87, Firefox 125 and Safari 14.1; slice
02's minimum versions already exceed these.

**Why Segmenter, when an earlier draft rejected it.** That draft only had English pages to
think about. With any base language (50), Segmenter is the only built-in that splits
Japanese, Chinese, Thai, Khmer and Lao text into dictionary words, and it applies UAX #29 to
every other script, so the matcher has one code path for every base. The two objections still
hold and are handled: Segmenter splits hyphenated words, which the adjustment pass below joins
back; and it is several times slower than a regex, which the budgets, a first-character
prefilter and slice 15's time-slicing absorb (Performance).

**Adjustment pass.** Segmenter output is then adjusted by the base's
boundaries: its entry in the shared `spec/lang/_generic/boundaries.json`, keyed by the full
tag, then the primary language, then `default` (50 §5). Its schema is
`spec/lang/schema/boundaries.schema.json`; the English entry, as an example (the other
languages' values are given with their boundary tables below):

```json
{
  "spaces": true,
  "join": ["apostrophe", "hyphen", "invisible"],
  "contractions_whole": ["n't", "'ll", "'re", "'ve", "'d", "'m"],
  "possessive_suffix": "'s",
  "possessive_whole_after": ["it", "he", "she", "that", "what", "there", "here", "who", "where", "how", "let"],
  "elision_prefixes": [],
  "keep_whole": ["o'clock", "ma'am", "rock'n'roll"],
  "trailing_apostrophe_words": [],
  "sentence_openers": [],
  "fold": [],
  "fast_path": true
}
```

| Key | Effect |
|---|---|
| `spaces` | `false` for bases written without spaces (`ja`, `zh-Hans`, `zh-Hant`, `th`, `km`, `lo`, `my`). Then a phrase may continue across an empty gap (see Longest phrase), and the regex fast path is never used. |
| `join` | Which joiners merge two adjacent word-like segments with exactly one joiner between them: `apostrophe` (**A**), `hyphen` (**H**), `invisible` (**I**; always on, in `_generic` too). So "well-known", "can't" and "hot­dog" (soft hyphen) are one token whatever the segmenter returned. |
| `contractions_whole` | Suffixes after **A** that make the token match only whole, never by its stem ("can't" never matches "can"). |
| `possessive_suffix`, `possessive_whole_after` | English `'s`: match the stem only, leaving `'s` outside the swap, except after the listed words, where `'s` is "is" or "us" and the token is whole-only. |
| `elision_prefixes` | Prefixes ending in **A** that split off as their own non-matching token: French "l'eau" → `l'` + `eau`. The prefix keeps its apostrophe and is never swapped. |
| `keep_whole` | Lexicalised tokens never split or partly matched (aujourd'hui, d'accord, quelqu'un, o'clock). A form equal to one of them still matches it whole. |
| `trailing_apostrophe_words` | Words whose apostrophe is part of the word at the end (Italian "po'", "perché" written "perche'"). |
| `sentence_openers` | Extra characters that start a sentence (Spanish `¿ ¡`). |
| `fold` | Extra key folding: `"width"` maps halfwidth katakana and fullwidth Latin with NFKC on the token only (ｺｰﾋｰ → コーヒー, ｄｏｇ → dog). Nothing else is folded. |
| `fast_path` | Allows the regex tokenizer below for this base, only if the differential test passes (below). |

**Regex fast path.** For a base with `fast_path: true` and `spaces: true`, `tokenize` may use
the sticky regex `W+ ( (A | H | I) W+ )*` (flags `gu`) followed by the same adjustment pass.
It exists only for speed. CI runs a differential test per base: the regex path and the
Segmenter path must produce identical tokens over that base's fixture corpus
(`test/fixtures/lang/<base>/*.txt`, at least 20,000 words of real page text) in Node and in
Chromium and Firefox; a base whose test fails has `fast_path` turned off in its file. At
launch the flag is proposed for `en`, `es`, `fr`, `it`, `de`, `pt` and off for every other
base.

**Key normalization** (`text.js: keyOf(token, base)`):

1. Fast path: if the token is ASCII and the base's `casing.json` has no special lowering,
   the key is `token.toLowerCase()`.
2. Otherwise: remove **I** characters, map every **A** to `'` and every **H** to `-`,
   `normalize("NFC")`, apply the base's `fold`, then lowercase with the base's locale where
   `casing.json` says so (`tr`, `az`: "İ" → "i", "I" → "ı"; `lt`) and the root locale
   otherwise. Caseless scripts are unchanged by lowercasing.
3. No accent folding. "cafe" and "café" are different keys, as are Spanish "si" (if) and "sí"
   (yes), and French "ou" (or) and "où" (where); folding would make "resume" match "résumé".
   Slice 09's prompt asks for every spelling a base actually uses.

Forms are normalized the same way at build time, with the tokenizer of their record's
`base_lang`, after one check. A form that contains a **G** character anywhere except as
trailing sentence punctuation (`. ! ? , ; :` at the end) is **symbolic** ("c++", "c#",
".net", "u.s.") and is kept exactly, lowercased. Any other form has leading and trailing
characters outside **W**, **A**, **H** and **S** trimmed ("thank you!" becomes "thank you",
"¡hola!" becomes "hola", "dog." becomes "dog").

**Case shape** of a surface: `caseless` if it has no cased letter (Han, kana, Thai, Arabic);
`upper` if it has at least two letters and every cased letter is uppercase; `title` if the
first letter is uppercase and the rest are lowercase; `lower` if every cased letter is
lowercase; otherwise `mixed` ("iPhone", "eBay"). A single uppercase letter ("I", "A", "Y") is
`title`. What a shape means is per base and decided by 16 and 17 (a German title-shaped noun
is ordinary).

**Sentence start**: true when the nearest preceding non-**S** character in `before + text` is
one of `. ! ? : ; … " “ « ( [ — –`, the full-width `。！？`, the base's `sentence_openers`
(`¿ ¡` in Spanish), bullet characters, or the block-start sentinel U+2029. For "¿Tienes un
perro?", "Tienes" starts the sentence because the character before it is "¿".

### Index

```ts
type Candidate = { word: Word; form: FormFlags };   // one per (word, form)
type FormEntry = { key: string; candidates: Candidate[]; symbolic: boolean };
type TrieNode  = { entry?: FormEntry; next?: Map<string, TrieNode> };

type Index = {
  base: string;                    // base tag (50), e.g. "es", "ja", "zh-Hant"
  boundaries: Boundaries;          // the parsed boundaries.json for this base
  root: Map<string, TrieNode>;     // keyed by the first token key of every form
  firstChars: Set<string> | null;  // first code point of every form key; null when not useful
  symbolic: RegExp | null;         // forms that contain glue characters, see below
  maxPhraseTokens: number;
  version: string;                 // hash of the inputs, for incremental re-apply in 15
};
```

`buildIndex(words, { base, maxPhraseTokens })`:

```
for word in words where word.status is active or well_known (07)
                  and sameBase(word.base_lang, base)          // 50: primary + script match
                  and not sameBase(word.lang, base):          // a target never swaps into its own language
  for form in word.forms (fall back to [word.gloss]):
    if form.enabled === false: continue
    if isSymbolic(form.text): add keyOf(form.text, base) to symbolicForms; continue   // c++, c#, .net
    k = keyOf(trim(form.text), base)
    if k is empty: continue
    path = tokenize(k, base) with H inside a token also splitting it ("ice-cream" -> ["ice","cream"]),
           remembering whether the form was written hyphenated, spaced or closed
    if path.length > maxPhraseTokens: drop and report (09 should prevent this)
    node = root.get(path[0]) ... descend/create through path
    node.entry ??= { key: k, candidates: [] }
    node.entry.candidates.push({ word, form })
firstChars = boundaries.spaces ? null : set of first code points of every k
symbolic = symbolicForms.length
  ? new RegExp("(?<![\\p{L}\\p{M}\\p{N}])(?:" + escaped forms sorted by length desc + ")(?![\\p{L}\\p{M}\\p{N}])", "giu")
  : null
```

Forms are tokenized with the same segmenter as the page, so a Japanese form such as 食べた
becomes whatever token path the segmenter gives page text (for example `食べ` + `た`), and the
two agree by construction.

All candidates are kept, including several in one language (S8 in research 01): the old
"newest wins within a language" rule (`content.js:42-43`) is removed; slice 18 chooses.
Symbolic forms are capped at 200 per index; beyond that they are dropped and counted in a
diagnostic, because they are the only part that is still a regex.

Single-letter forms ("a", "I", Spanish "y" and "o") are indexed. Whether a single-letter match
may be swapped is decided by slice 16.

`buildIndexes(words, baseLangs, opts)` builds one index per base in `baseLangs` (at most 4,
50) and returns them in a `Map`. An index for a base with no words is empty and cheap.

### Scanning

```
scan(text, ctx, index):
  if text has no W character: return { matches: [], tokenCount: 0 }      // fast reject
  if index.firstChars and no code point of text is in index.firstChars and coverage is off:
      return { matches: [], tokenCount: countOnly(text) }                // prefilter, no-space bases
  full = ctx.before + text + ctx.after; off = ctx.before.length
  tokens = tokenize(full, ctx.base), each with start, end, key, segments
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

`countOnly` uses the same segmenter; slice 32 asks for counts only when coverage is on, so a
learner with coverage off pays nothing on nodes that can't match.

**Longest phrase** starting at token `i`: walk the trie from `root.get(tokens[i].key)`; extend
to token `j+1` only if the gap between tokens `j` and `j+1` is allowed, token `j+1` is inside
`text`, and it is not glued. Allowed gaps: one or more **S** characters and nothing else;
for a `spaces: false` base, also the empty gap (Japanese, Chinese and Thai words touch); for a
form that was written with an elision ("d'accord" as a phrase, "dell'acqua"), the zero-width
gap after an `elision_prefixes` token. Record the deepest node with an `entry`.
Leftmost-longest wins; matches never overlap. Phrase length is capped at `maxPhraseTokens`
(6). Cost is O(tokens x maxPhraseTokens) in the worst case and close to O(tokens) in practice,
since most first tokens miss the root map.

**Whole token or part of it**, for a token with internal joiners. Generic rules, then the
base's `boundaries.json`:

| Token shape | Rule |
|---|---|
| Plain word ("dog", "perro", "犬") | Look up `[key]`. |
| Whole token is a form ("can't", "well-known", "e-mail", "aujourd'hui") | Match the whole token. |
| Hyphenated, not a form ("ice-cream", "est-ce") | Look up its hyphen segments as a path that must end exactly at the token end. "ice-cream" matches the form "ice cream"; "well-known" never matches "well"; "est-ce" never matches "est". |
| In `keep_whole` | Whole token only. |
| Ends in a `contractions_whole` suffix | Whole token only. Never match the stem. |
| Possessive suffix after a word in `possessive_whole_after` (it's, let's) | Whole token only. |
| Other possessive (`X's`) | Match `X` only; the suffix stays as written, outside the swap. |
| Starts with an `elision_prefixes` prefix (l'eau, qu'il, dell'acqua) | Split: the prefix is its own token, never swapped; the rest is looked up as a word. |
| Other apostrophe or invisible-joiner token | Whole token only. |

### Boundary tables

"Swap" here means the matcher reports a match; rows marked with 16 are then dropped by slice
16's rules, listed so the full behaviour is in one place. Each table is a test file,
`test/fixtures/boundaries/<base>.json`. The tokenizations for `ja`, `zh` and `th` are what
ICU's dictionaries give in Node 22, Chromium and Firefox at the time of writing; the tests
check matches (which depend only on agreement between page and form tokenization), and note
the tokens for readers.

**English base** (`en`). Words: "can" (es poder), "can't" (es no poder), "sum", "café",
"dog", "house", "well", "mail", "it", "us", "a" (de ein), "I" (es yo), "thank you", "ice
cream", "c++", "résumé", "may", "will", "bill".

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

**Spanish base** (`es`). Words with `base_lang: "es"`: ja 犬 (forms "perro", "perros"), en
"house" ("casa"), en "water" ("agua"), en "park" ("parque"), ja こんにちは ("hola"), en
"give it to me" ("dámelo"), en "please" ("por favor"), en "yes" ("sí"), en "and" ("y").
`boundaries.json`: `join: ["hyphen", "invisible"]`, `sentence_openers: ["¿", "¡"]`,
`fast_path: true`.

| # | Input | Matches reported | Final result |
|---|---|---|---|
| es1 | `¿Tienes un perro?` | `perro`; `Tienes` is sentence start (after ¿) | `¿Tienes un 犬?` |
| es2 | `¡Hola! ¿Qué tal?` | `Hola`, title, sentence start | swapped, casing by 17 |
| es3 | `la casa del perro` | `casa`, `perro`; `del` is one token | `del` never cut into "de" + "el" |
| es4 | `vamos al parque` | `parque`; `al` is one token | `al` stays |
| es5 | `dámelo` with only "dar" known | none | clitic verb forms are left whole |
| es6 | `dámelo` (form "dámelo") | `dámelo` | swapped whole |
| es7 | `un acuerdo hispano-americano` (form "americano") | none | hyphen compound joined |
| es8 | `pingüino`, `acción` with NFD accents (form "pingüino") | `pingüino` | swapped; "acción" is one token |
| es9 | `si quieres`, `sí, claro` (form "sí") | `sí` only | "si" (if) and "sí" (yes) are different keys |
| es10 | `por favor` across U+00A0 | one match, key "por favor" | swapped |
| es11 | `perros y gatos` (form "y") | `y` | 16 decides (single letter) |
| es12 | `agua» dijo` (« » quotes) | `agua` | quotes stay |

**French base** (`fr`). Words: en "water" ("eau"), en "okay" ("d'accord"), en "today"
("aujourd'hui"), en "dog" ("chien", "chiens"), en "is" ("est"). `boundaries.json`:
`join: ["hyphen", "invisible"]`, `elision_prefixes: ["l'", "d'", "j'", "m'", "n'", "s'",
"t'", "c'", "qu'", "jusqu'", "lorsqu'", "puisqu'", "quoiqu'"]`, `keep_whole: ["aujourd'hui",
"d'accord", "quelqu'un", "presqu'île", "prud'homme"]`, `fast_path: true`.

| # | Input | Matches reported | Final result |
|---|---|---|---|
| fr1 | `l'eau froide` | `eau`; `l'` is its own token | `l'water froide` |
| fr2 | `l’eau` (curly) | same as fr1 | same |
| fr3 | `d'accord !` (U+202F before !) | `d'accord` whole | swapped whole |
| fr4 | `d'accord` with only "accord" known | none | lexicalised, kept whole |
| fr5 | `qu'il pleuve` | `qu'` and `il` are separate tokens | `il` matched only if it is a form |
| fr6 | `aujourd'hui` with only "hui" known | none | kept whole |
| fr7 | `est-ce que` (form "est") | none | `est-ce` is one hyphenated token |
| fr8 | `« chien »` with U+202F inside the quotes | `chien` | quotes and spaces stay |
| fr9 | `des chiens` | `chiens` (form) | swapped |

**Italian base** (`it`). Words: en "water" ("acqua"), en "friend" ("amica"), en "a little"
("un po'"). `elision_prefixes: ["l'", "un'", "dell'", "dall'", "nell'", "sull'", "all'",
"quest'", "quell'", "c'", "d'"]`, `trailing_apostrophe_words: ["po'", "piu'", "perche'"]`.

| # | Input | Matches reported | Final result |
|---|---|---|---|
| it1 | `un bicchiere dell'acqua` | `acqua`; `dell'` is its own token | `dell'water` |
| it2 | `un'amica` | `amica` | swapped; `un'` stays |
| it3 | `un po' di pane` | `un po'`, key "un po'" | swapped whole, apostrophe included |

**German base** (`de`). Words: en "dog" ("Hund", "Hunde"), en "doghouse" ("Hundehütte"),
en "mail" ("Mail"). `join: ["hyphen", "invisible"]`, `contractions_whole: ["'s"]` (geht's,
wie geht's), `fast_path: true`. `casing.json` marks nouns as capitalised (17 and 16 read it).

| # | Input | Matches reported | Final result |
|---|---|---|---|
| de1 | `der Hund bellt` | `Hund`, shape title, not sentence start | swapped; 16 doesn't treat it as a proper noun |
| de2 | `die Hundehütte` with only "Hund" known | none | compounds are one token |
| de3 | `die Hundehütte` (form "Hundehütte") | `Hundehütte` | swapped |
| de4 | `eine E-Mail` (form "Mail") | none | hyphen compound joined |
| de5 | `wie geht's` (form "geht") | none | contraction whole only |
| de6 | `Straße`, `STRASSE` (form "Straße") | `Straße` only | "STRASSE" lowercases to "strasse", another key; accepted |

**Japanese base** (`ja`). Words: ko 개 (form "犬"), en "coffee" ("コーヒー"), en "ate"
("食べた"), en "like" ("好き"). `spaces: false`, `join: ["invisible"]`, `fold: ["width"]`,
`sentence_openers: []`, `fast_path: false`.

| # | Input | Tokens (ICU) | Matches reported | Final result |
|---|---|---|---|---|
| ja1 | `犬が好きです` | 犬 \| が \| 好き \| です | `犬`, `好き` | both swapped; particles stay |
| ja2 | `子犬を飼う` (form "犬") | 子犬 \| を \| 飼う | none | "puppy" is its own word; accepted |
| ja3 | `昨日寿司を食べた` (form "食べた") | … \| 食べ \| た | `食べた` (phrase over the empty gap) | swapped whole, okurigana included |
| ja4 | `食べる` with only "食べた" known | 食べる | none | inflections are separate forms |
| ja5 | `コーヒーを飲む` | コーヒー \| を \| 飲む | `コーヒー` | long-vowel mark ー stays inside the token |
| ja6 | `ｺｰﾋｰ` (halfwidth) | ｺｰﾋｰ | `ｺｰﾋｰ`, key "コーヒー" | swapped via width folding |
| ja7 | `いぬ` with only "犬" known | いぬ | none | kana and kanji spellings are separate forms |

**Chinese bases** (`zh-Hans`, `zh-Hant`, separate indexes). Words: en "dog" (zh-Hans "狗"),
en "like" (zh-Hans "喜欢"; zh-Hant "喜歡"). `spaces: false`, `fold: ["width"]`.

| # | Input | Tokens (ICU) | Matches reported | Final result |
|---|---|---|---|---|
| zh1 | `我喜欢狗` (zh-Hans page) | 我 \| 喜欢 \| 狗 | `喜欢`, `狗` | swapped |
| zh2 | `小狗很可爱` (form "狗") | 小狗 \| 很 \| 可爱 | none | compound word; accepted |
| zh3 | `我喜歡狗` (zh-Hant page) | 我 \| 喜歡 \| 狗 | `喜歡` from the zh-Hant index only | the zh-Hans index is never used here |

**Thai base** (`th`). Words: en "dog" ("หมา"), en "like" ("ชอบ"). `spaces: false`.

| # | Input | Tokens (ICU) | Matches reported | Final result |
|---|---|---|---|---|
| th1 | `ฉันชอบหมา` | ฉัน \| ชอบ \| หมา | `ชอบ`, `หมา` | swapped |
| th2 | `หมา ตัวนี้` (space between phrases) | หมา \| ตัว \| นี้ | `หมา` | spaces in Thai mark phrases, not words; same result |

Languages without an entry use `default`: Segmenter tokens, `join: ["hyphen", "invisible"]`,
nothing else. Hyphens join by default because a hyphenated word is safer kept whole in any
language (Portuguese "dá-me", French "est-ce", Spanish "hispano-americano"): precision over
coverage. The tables above for French, Italian, German, Japanese, Chinese and Thai are entries
(or no entry at all, where the default already gives the right tokens) in the same shared
file, not folders of their own; they are Basic-level bases in 50's terms.

### Edges across text nodes

Slice 15 passes `ctx.before` and `ctx.after`: up to 16 characters of the neighbouring text in
the same inline run, or U+2029 at a block boundary. A run continues across inline elements
(`a, abbr, b, bdi, bdo, cite, data, del, dfn, em, font, i, ins, mark, q, s, small, span,
strong, sub, sup, time, u, wbr`, and Kotiko's own `kotiko-w`) and stops at anything else,
including `br` and any element slice 16 skips. Kotiko's own `kotiko-w` counts as a word character
for edge purposes, so nothing new can glue onto a swapped word. Tokens that straddle the edge
are discarded, never truncated, which fixes rows 16 and 17. For `spaces: false` bases a
16-character context can hold several words, and a token that straddles is still discarded;
segmenting the context with the text keeps dictionary segmentation stable at the edge. A
phrase that would cross an element is not matched (Future work).

### Performance

Budgets, measured by slice 02's benchmark job on the CI runner, matching only (no DOM):

| Case | Budget | Today (03, 06) |
|---|---|---|
| `buildIndex`, 1,000 words (about 4,000 forms), one base | 10 ms | regex compile, negligible |
| `buildIndex`, 20,000 words (about 80,000 forms), one base | 80 ms | 880 ms per scan below |
| `scan` over 100,000 eight-word text nodes, fast-path base (`en`, `es`), any vocabulary 1k-20k | 100 ms | 60 / 430 / 880 ms |
| `scan` over the same nodes with the Segmenter path, spaced base | 300 ms | — |
| `scan` over 100,000 Japanese text nodes of about 20 characters, 5,000 forms | 300 ms | — (fails today) |
| `scan` of a 250 KB page with 10,000 forms, fast-path base | 50 ms | 117-435 ms |
| Segmenter construction, per base, once per content script | 5 ms | — |

These are totals of work, not of blocking: slice 15 runs scans in time-sliced batches of at
most 8 ms each, yielding between batches, so no budget above becomes a long task. Build cost
roughly doubles from the forms' own segmentation and is paid once per word-list version per
base, in the background idle time slice 15 schedules.

Rules that keep it there: a fast reject for strings with no letter; the first-character
prefilter for `spaces: false` bases; one cached segmenter per base; the regex fast path where
allowed; ASCII fast path in `keyOf`; one `Map` lookup per token; no allocation for tokens
that miss the root map; the index built once per word-list `version` and reused across scans;
no per-match string building beyond `surface` (tooltips are lazy, slice 19). Memory for
80,000 forms stays under 20 MB of heap per base, checked in the benchmark.

The client also refuses absurd input before indexing, as research 03 E2 recommends: forms
longer than 64 characters, natives longer than 64 characters or containing a newline, and
vocabularies above 20,000 active words (the newest 20,000 are kept) are dropped and counted
in a diagnostic that slice 25 can show.

### Privacy and safety

The matcher never sends page text anywhere and keeps nothing after a scan. Server strings
are only used as `Map` keys or escaped into the small symbolic regex, so no ReDoS is possible
from word data. `boundaries.json` lists are compared as strings, never compiled into regexes.

## Acceptance criteria

- [ ] `content.js` no longer builds a regex from the vocabulary; all matching goes through
      `KotikoMatcher` (the symbolic list is the only regex, capped at 200 forms per index).
- [ ] All rows of every boundary table (en 1-32, es, fr, it, de, ja, zh, th) pass as unit
      tests on the matcher plus slice 16's filter, with exact offsets, in Node and in
      Chromium and Firefox.
- [ ] One index is built per base in `baseLangs`; a word with `base_lang: "es"` is never
      matched on text scanned as `en`, and a word whose `lang` is the scanned base is never
      indexed for it.
- [ ] `tokenCount` is reported per scan, and scans are always in exactly one base.
- [ ] Forms are normalized with NFC, the A/H/I mappings and the base's folding and locale
      lowering; an NFD page matches an NFC form; Turkish "İSTANBUL" keys to "istanbul".
- [ ] Multi-word forms match across any whitespace (and across the empty gap in `spaces:
      false` bases), never across punctuation or elements, and leftmost-longest wins
      ("thank you" beats "thank"; "por favor" beats "favor").
- [ ] Every candidate for a form is returned, including several in one language.
- [ ] The regex fast path is used only for bases whose differential test passes.
- [ ] Budgets in the Performance table are enforced in CI with a 25 % tolerance.
- [ ] Oversized forms, natives and vocabularies are dropped and counted, never thrown.
- [ ] The shared `boundaries.json` validates against its schema, every entry included.

## Test plan

- **Unit (`node --test`, slice 02):** the boundary tables as data-driven tests
  (`test/fixtures/boundaries/<base>.json`: input, ctx, base, words, expected matches); key
  normalization (NFD, curly apostrophes, soft hyphens, non-breaking hyphens, halfwidth kana,
  Turkish I); phrase walk with gaps of every **S** kind and the empty gap; elision and
  `keep_whole` lists; symbolic forms; property test that matches never overlap and always lie
  inside `text`.
- **Differential:** regex path versus Segmenter path per fast-path base, over
  `test/fixtures/lang/<base>/*.txt`.
- **Cross-engine:** the `ja`, `zh` and `th` tables run in Chromium and Firefox through
  Playwright as well as Node, because ICU data versions differ; a mismatch fails the build
  and is fixed by adjusting the fixture or adding a form, never by special-casing an engine.
- **jsdom:** a page built from the multi-node rows (`<wbr>`, `<span>`-split words,
  `<b>`-split phrases) run through the full pipeline from slice 15.
- **Benchmark:** slice 02's job generates 100,000 nodes in English, Spanish and Japanese and
  vocabularies of 1k, 5k and 20k random words; records build and scan time and heap; fails on
  the budgets.
- **End-to-end:** fixture pages `boundaries.html`, `es-news.html`, `fr-news.html` and
  `ja-news.html` (50) loaded with the unpacked extension; screenshot diffs of expected swaps.

## Rollout and migration

No data migration: the indexes are rebuilt from the cached word list on load. Words migrated
by slice 07 carry `base_lang: "en"` and land in the English index. Behaviour changes users
will notice, for the changelog: "Kotiko no longer swaps parts of words: contractions like can't,
hyphenated words, accented words and web addresses stay as they are. Phrases like 'thank you'
and 'por favor' swap as one. Kotiko now finds words in Japanese, Chinese and Thai pages too."
Ship together with 15, 16, 17 and 50 in one release, because the boundary tables assume slice
16's filter and 50's base languages.

## Open questions

1. **Accent folding.** Should "cafe" on a page match a stored "café"? Recommendation: no
   folding in the matcher; have slice 09 emit every spelling a base uses, which avoids
   "resume" against "résumé" and Spanish "si" against "sí".
2. **Leading-apostrophe clippings** ("'cause", "'em"). Recommendation: accept the rare
   wrong swap rather than keep a list; revisit if reports come in.
3. **Compounds in German, Dutch and the Nordic languages.** "Hundehütte" never matches "Hund".
   Recommendation: accept for launch (a swap inside a compound would produce "犬hütte");
   revisit with a compound splitter as a `boundaries.json` option if learners ask.
4. **Words inside Chinese and Japanese compounds** (小狗, 子犬). Recommendation: accept; the
   segmenter's dictionary word is the right unit to swap, and learners can add the compound.

## Future work

- Phrases across inline elements ("thank <b>you</b>") using the run text plus an offset map,
  swapping into two elements.
- Separable phrasal verbs ("give it up") and Spanish split clitics ("se lo dio") with a gap of
  one or two tokens.
- Compound splitting for German, Dutch and the Nordic languages, as a `boundaries.json` option.
- An incremental index update when one word is added, instead of a rebuild (rebuild is
  already under 80 ms at 20,000 words).
- Running the Segmenter path in a worker for very large `spaces: false` pages.
