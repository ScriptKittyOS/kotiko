# 18 · Language precedence and mixing

| | |
|---|---|
| **Status** | Built (2026-10-04); see Implementation notes |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [14-matcher-engine](../14-matcher-engine/SPEC.md), [50](../50-ui-localization-and-base-language/SPEC.md) (base languages); uses `created_at` from [07](../07-word-model-v2/SPEC.md) and canonical tags from [08](../08-language-tags/SPEC.md) |
| **Unblocks** | [31-density-and-amount](../31-density-and-amount/SPEC.md), [38-per-site-rules](../38-per-site-rules/SPEC.md), [20](../20-popup-redesign/SPEC.md) (languages, focus and mixing controls) |
| **Sources** | [01 S1-S8, S11, S12, section 3](../../docs/research/01-language-mixing.md), [05 S31-S33](../../docs/research/05-learner-ux.md), [03 A6](../../docs/research/03-browser-extension.md), [DECISIONS 2026-10-01](../DECISIONS.md) |

## Problem

When several of your languages know the same word of the page's language, Kotiko rotates through
them in page order: on an English page the first "thanks" is Spanish, the second Russian, the
third Mandarin; on a Spanish page the first "gracias" is English, the second Japanese
(`extension/content.js:87-89`). Read from the code (research 01):

- **One paragraph can hold three scripts for one idea**: "спасибо … 谢谢 … gracias" (01 S1).
- **Words change language while you read.** The rotation counter lives in the matcher
  (`content.js:51`) and resets whenever any setting or the word list changes
  (`content.js:143-149`, `178-188`). A word added on Telegram makes every open tab re-render,
  and many words flip language (01 S2). Re-rendered content advances the counter too (03 A6).
- **"Only" isn't only.** Clicking "only" hides every language that exists at that moment
  (`extension/popup.js:90`); a language added later shows up anyway, breaking a focus session
  (01 S11).
- **Lossy candidates.** Within a language, the newest word silently takes a form
  (`content.js:42-43`), so "hogar" never appears once "casa" claims "home" (01 S8). A swap
  whose native equals the page's word (Spanish "no" on an English page, English "hotel" on a
  Spanish page) just adds an underline (01 S7). Serbian and
  Croatian "da" alternate between identical strings (01 S6).
- **No preference can be expressed.** Every language gets an equal share of contested words,
  and there is no way to lean towards one.

The decision is made ([DECISIONS.md](../DECISIONS.md), 2026-10-01): one stable language per
base-language word per page per day, chosen by a seeded weighted choice; round-robin within a page
stays available as "Mix within the page". This slice specifies it.

## The maintainer's question, answered

> If I know most Spanish, Russian and Mandarin and mix them, which language gets precedence:
> the one I know most, least, or an option?

**Neither most nor least, by default.** Each word of the page's language (each "thanks" on an
English page, each "gracias" on a Spanish one) gets one language per page per day,
picked at random but repeatably, with every language you show getting an equal share of the
words they have in common. Words you added in the last seven days win, so new vocabulary gets
early exposure. On top of that you can choose:

- **Focus** on one or more languages: only they appear, until you leave Focus.
- **Weights**: "more Mandarin" (weight 3) means Mandarin wins about 3 in 5 shared words against
  Spanish and Russian at weight 1.
- **Priority order**: always Spanish if Spanish has the word, else Russian, else Mandarin.
- **Mix within the page**: every occurrence can be a different language, in rotation.

Why not "most known": you'd mostly see what you already know. Why not "least known": the page
gets harder, and your stronger languages starve. Why no proficiency setting: weights say what
you want directly, and your word count per language is already visible (01 S3, S4). Note that
"precedence" only matters for shared words: a language with 2,000 words still owns every word
the others don't have. Focus and weights are the tools for that imbalance; Kotiko doesn't
auto-weight by word count, because that is opaque (01 S4).

## Goals

- Every occurrence of one base-language word on a page shows the same language (default mode),
  whatever the base.
- Reloading, syncing, re-rendering or adding unrelated words never changes a shown word.
- Adding or hiding a language only changes the words that language wins or loses.
- Long-run shares match the weights exactly in expectation.
- Focus is a real mode that new languages respect.
- Every candidate word can appear: synonyms in one language take turns across pages and days.

## Non-goals

- How many words to swap: [31](../31-density-and-amount/SPEC.md).
- Per-site language sets and their UI: [38](../38-per-site-rules/SPEC.md); this slice defines
  how they feed eligibility.
- Popup controls: [20](../20-popup-redesign/SPEC.md); this slice defines the settings and copy.
- Homographs with different meanings: [36](../36-grammar-and-senses/SPEC.md) filters candidates
  by sense before this slice chooses.
- Review weighting per word: [35](../35-reveal-mode-and-review/SPEC.md) supplies a hook used here.

## User stories

- As a learner of Spanish, Russian and Mandarin, an article shows "gracias" every time it says
  "thanks", and tomorrow or on the next article it may be "спасибо".
- As a learner who just started Mandarin, the words I added this week show up in Mandarin.
- As a learner preparing for a Mandarin exam, I focus on Mandarin and nothing else appears,
  even if I add a Turkish word from my phone.
- As a learner who wants a little Russian and lots of Spanish, I set Russian to "less".
- As someone who liked the old rotation, I turn on "Mix within the page".

## Specification

File: `extension/lib/precedence.js`, pure; the page context is passed in.

### Settings

Stored in [39](../39-multi-device-sync/SPEC.md)'s `s:langs` settings group, which syncs
through `storage.sync` (the salt included, so a page looks the same on every device):

```ts
mixing: {
  mode: "balanced" | "mix" | "priority";   // default "balanced"
  weights: Record<Lang, number>;           // 0..10, default 1; 0 = backup only
  priority: Lang[];                        // for mode "priority"
  focus: Lang[] | null;                    // null = not focusing
  freshDays: number;                       // default 7; 0 turns freshness off
}
hiddenLangs: Lang[];                       // existing key, unchanged meaning: "rest this language"
seedSalt: string;                          // 32 random hex chars, created once, synced
```

`Lang` is the canonical tag from slice 08 (`zh`, `zh-Hant`, `sr-Latn`, `yue`).

### Step 1: eligible languages

```
L_all = languages with at least one active or well-known word
site  = slice 38's effective().langs for this page (null when the site has no language rule)
if site and site.focus:       E = {site.focus} ∩ L_all
else if site and site.show:   E = site.show ∩ L_all
else if mixing.focus:         E = focus ∩ L_all            // hidden is ignored for focused languages
else:                         E = L_all − hiddenLangs
```

A site's own language rule is more specific than global settings, so it wins, as slice 38
specifies; on every other site, global Focus applies. The popup shows which one is in effect
("Focus: Mandarin" or "This site: Spanish only"). Focus never edits `hiddenLangs`, so leaving
Focus restores exactly what was shown before (fixes 01 S11). A language whose first word arrives
during Focus is not shown; the popup says "Turkish is new. It's waiting until you leave Focus."
In normal mode a new language appears immediately, as today. Stale entries in `hiddenLangs`
and `focus` are pruned with the rule that exists today (`popup.js:96-99`).

### Step 2: candidate cleanup, per form occurrence

From the matcher's `entry.candidates` (14), after slice 36's sense filter:

1. Drop candidates whose language isn't in `E`, whose word status isn't `active` or
   `well_known` (07: paused, pending, deleted), whose status is `well_known` while slice 35's
   "Words you know well" setting is "Stop swapping", whose `base_lang` isn't the base this text
   was scanned in or whose `lang` is that base (14 already excludes both at build time; this is
   the guard for stale indexes), or whose `native` starts or ends with a hyphen (a suffix saved
   as a grammar note, 36).
2. **No-op, native equals gloss**: drop a candidate whose `native` equals the matched surface
   in the page's base, compared with the base's `keyOf` (14: its locale lowering, so Turkish
   I/ı is right) after removing diacritics (NFD, strip `\p{M}`), if any other candidate
   remains. English base: Spanish "no" for "no", French "hôtel" for "hotel". Spanish base:
   English "hotel" for "hotel", English "chocolate" for "chocolate". Japanese base: Chinese
   "学生" for "学生". If it is the only one, nothing is swapped, and the match is reported to coverage
   ([32](../32-page-coverage-and-celebrations/SPEC.md)) as known (01 S7).
3. **Identical natives** across languages (Serbian and Croatian "da") are not merged for the
   choice; the pick runs normally. After the pick, other candidates with the same native string
   are attached to the swap as `alsoLangs`, so the popover (19) reads "da · Serbian, Croatian"
   and exposure counts for both (01 S6).

### Step 3: the seed

```
pageKey   = origin + pathname + canonical query
            (drop utm_*, fbclid, gclid, dclid, msclkid, mc_cid, mc_eid, igshid, si, ref,
             ref_src, _hsenc, _hsmi, yclid; sort the rest; no fragment).
            In frames, the top page's key (slice 42). Recomputed on single-page navigation.
dayKey    = local date "YYYY-MM-DD" when the page session starts (not at midnight mid-read)
concept   = keyOf(word.gloss, base) of the oldest candidate in the matcher's entry for this
            form (by created_at, then id), taken before cleanup so hiding a language never
            changes it; "dog" and "dogs" (or "perro" and "perros") then share one choice.
            Falls back to the form key
seed      = cyrb53([seedSalt, concept, pageKey, dayKey].join("\u001f")).toString(16)
u(x)      = (cyrb53(seed + "\u001f" + x) + 0.5) / 2^53          // uniform in (0, 1)
```

`cyrb53` is the public-domain 53-bit string hash by bryc: integer-only (`Math.imul`), identical
in every JavaScript engine, about 1.4 µs per pick on the CI runner. Its reference
implementation is copied verbatim into `precedence.js` with attribution. Nothing derived from
the URL is stored or sent anywhere; `pageKey` exists only in memory.

### Step 4: choose a language

Let `C` be the cleaned candidates and `E_C` the languages that have at least one of them.

**Mode "balanced" (default):**

```
P = { l in E_C : weight(l) > 0 };  if P is empty: P = E_C with every weight 1   // backup-only languages
F = { l in P : l has a candidate with now − created_at < freshDays days }       // computed at session start
if F nonempty: P = F                                                            // fresh words win
winner = argmin over l in P of  −ln(u(l)) / weight(l)
```

This is weighted rendezvous hashing: `−ln(u)/w` is an exponential variable with rate `w`, and
the smallest of independent exponentials is language `l` with probability exactly
`w_l / Σ w`. Because each language's score depends only on the seed and that language, adding a
language can only take words for itself, and hiding one only gives away the words it held.

**Mode "priority":** order is `mixing.priority`, then any language not listed, by the
`created_at` of its first word. The winner is the first language in that order present in
`E_C`. Weights and freshness don't apply: this mode is for predictable comfort reading.

**Mode "mix" (Mix within the page):** a smooth weighted round-robin per concept, so occurrences
rotate in proportion to the weights (fresh languages count with weight x3 here, so mixing
still happens):

```
state[concept] = { current: Map<Lang, number> (all 0), total: Σ w }
nextLang(concept):
  for l in P: current[l] += w[l]
  best = argmax current (ties broken by smaller −ln(u(l)), so the start is seeded)
  current[best] −= total
  return best
occurrence key = cyrb53(concept + 32 chars before the match + "\u001f" + 32 chars after)
                 + ordinal among identical keys on the page
memo: Map<occurrence key, Lang> for the page session
choice for an occurrence = memo.get(key) ?? memo.set(key, nextLang(concept))
```

The memo means a re-rendered paragraph keeps the languages it had (03 A6). Equal weights give
exactly the old es, ru, zh, es, ru, zh rotation, but stable.

### Step 5: choose a word within the language

```
W = candidates of the winning language
if any of W is fresh: W = the fresh ones
winner = argmin over word in W of  −ln(u(lang + "\u001f" + word.id)) / wordWeight(word)
wordWeight(word) = 1, or slice 35's review weight (recently missed 2, well known 0.5)
```

Two levels keep language shares fair: a language with five synonyms for "home" doesn't win
"home" five times as often. Synonyms rotate across pages and days, and the popover lists the
others ("also: hogar"), fixing 01 S8.

The result handed to the rest of the pipeline is
`Choice = { concept, lang, word, alsoLangs, fresh, others }`, where `others` are the remaining
candidates for the popover (19) and `fresh` is used by density ranking (31).

### Memoization and cost

Choices are memoized per page session in `Map<concept, Choice>` (balanced, priority) or the
occurrence memo (mix), so a page computes one pick per distinct concept, typically a few
hundred. Measured: 100,000 picks take about 140 ms, so a page's picks cost well under 1 ms.
When words or mixing settings change, the memo is recomputed and slice 15 rewrites only nodes
whose chosen word changed.

### Several base languages on one page

A learner with more than one base (50) can meet several of them on one page: a Spanish
article quoting an English speech, or a bilingual site. Slice 16 decides each subtree's base and
14 scans it with that base's index, so candidates on a Spanish passage are always records with
`base_lang: "es"`, and on the English quote records with `base_lang: "en"`. Precedence then
works the same way in each:

- Memos are keyed by `(base, concept)` (and the occurrence memo by `base` plus occurrence key),
  so "no" on the English part and "no" on the Spanish part never share a `Choice` whose word
  belongs to the other base.
- The seed formula is unchanged (it doesn't include the base), so the reference vectors below
  stay valid, and when the same concept string exists in two bases the same language tends to
  win in both, which reads as consistent.
- Focus, hidden languages, weights, priority, freshness and mix mode are global: they describe
  the learner's target languages, not the page's.
- A base with no candidates for a concept simply leaves that word as written; no other base's
  word is ever used as a fallback.

### Determinism guarantees

For the same `seedSalt`, word list, settings, `pageKey` and `dayKey`:

1. The same concept shows the same word everywhere on the page, including in frames (42) and
   content that loads later.
2. Reloads, syncs that don't change candidates, re-renders and changes to unrelated words
   change nothing visible.
3. Adding a language or a word changes a concept's choice only to that new language or word
   (or to a fresh word, which is the intended "fresh words win").
4. Hiding a language changes only the concepts it had won; un-hiding restores them.
5. Changing one language's weight moves words only between that language and the others.
6. The same user sees the same choices on every device where the word list and the synced
   salt match; different users see different choices.
7. A new day, a new page, or the end of a word's fresh week can change choices; nothing else does.

### Worked examples

Reference vectors, computed with the algorithm above (they become the golden unit test):
`seedSalt = "test-salt"`, concept `thanks`, `pageKey = "https://example.com/news/article"`,
languages es, ru, zh, none fresh.

| Day | Seed | u(es) | u(ru) | u(zh) | Equal weights: scores, winner | zh weight 3: zh score, winner |
|---|---|---|---|---|---|---|
| 2026-10-01 | 1ba24251354798 | 0.2070 | 0.7117 | 0.5977 | es 1.5752, ru 0.3402, zh 0.5147: **ru** | 0.1716: **zh** |
| 2026-10-02 | 155a7786560603 | 0.9837 | 0.8225 | 0.3750 | es 0.0164, ru 0.1954, zh 0.9808: **es** | 0.3269: **es** |
| 2026-10-03 | 1cd800f758f466 | 0.4843 | 0.3737 | 0.7728 | es 0.7250, ru 0.9842, zh 0.2577: **zh** | 0.0859: **zh** |

- Same day, page `…/news/other`: seed `10fcffe272112b`, **zh** wins with equal weights.
- Adding Turkish on 2026-10-01: u(tr) = 0.1667, score 1.7914, so **ru** still wins; nothing on
  the page changes.
- Over 200,000 simulated pages: equal weights give 0.334 / 0.332 / 0.334; zh weight 3 gives
  0.200 / 0.199 / 0.601. Adding Turkish moved 25.2 % of choices to Turkish and none between the
  other three.

Scenarios:

| Situation | Result |
|---|---|
| You added 谢谢 yesterday; "thanks" also exists in es and ru | zh on every page for 7 days, then back to the shared draw |
| Russian hidden ("rest this language") | ru never shown; concepts it won go to their next-best language; nothing else moves |
| Focus: Mandarin; "dog" exists only in es | "dog" stays as the page wrote it |
| Focus: Mandarin; you add a Turkish word | Turkish is not shown; popup notice |
| Priority es > ru > zh; "thanks" in ru and zh only | ru |
| Weight es 0 (backup only); "dog" in es and ru | ru; "cat" in es only: es |
| Spanish "no" for "no", Russian "нет" | нет (the no-op is dropped) |
| Spanish "no" only | "no" stays unswapped, counted as known |
| "home" in es as casa and hogar | es wins as usual; casa or hogar chosen per page and day |
| sr "da" and hr "da" | "da", tagged with whichever language won; popover lists both |
| Base es; "perro" known in en (dog) and ja (犬) | one of dog or 犬 for every "perro" on the page that day |
| Base es; English "hotel" and Japanese ホテル for "hotel" | ホテル (the English no-op is dropped) |
| Bases es and en; a Spanish article quoting an English paragraph | "perro" and "dog" each get their own choice, from their own base's records |

### Copy for slice 20

Slice 20 owns the final strings (its Focus strip reads "Focusing on {language} · Stop");
these are the meanings each control must convey, with suggested wording.

- Mixing options, under Languages: "Each word: **One language per page** (default) · Mix within
  the page · Always in this order".
- Weights per language: "Less · Normal · More" (0.33, 1, 3), plus "Only when no other language
  has it" (0). Help text: "Kotiko picks one of your languages for each word on a page.
  'More' makes a language win more of the words your languages share."
- Focus: the "only" link becomes a Focus button on each language, always visible (05 S33), and a
  strip shows while Focus is on, with a way to stop.
- Fresh words: "New words show up first for a week" (toggle maps to `freshDays` 7 or 0).

## Implementation notes

Built 2026-10-04:

- `extension/lib/precedence.js` follows steps 1 to 5. bryc's `cyrb53` is copied with its
  notice. The reference vectors reproduce exactly. The 100,000-page simulation gives shares
  within one point for three weight sets, and adding Turkish moved about 25 % of choices,
  all to Turkish.
- **Storage.** `mixing` is in `storage.local`, with `hiddenLangs`, until slice 39 moves both
  into `s:langs`. `seedSalt` is in `storage.sync`: the background makes it once and copies
  it to `storage.local` for content scripts. A page that opens before the copy uses a
  salt for that page view only, never stored.
- **The index holds every word** (hidden languages included), so a concept never depends on
  what is hidden. Eligibility is applied in cleanup.
- **A stale Focus** (its languages lost all their words) is ignored rather than hiding
  everything. The popup prunes it after a good sync, like `hiddenLangs`.
- **The no-op rule** compares against the match's key (the page's word through the base's
  `keyOf`), without diacritics.
- **Mix within the page.** Occurrences are told apart by 32 characters on each side within
  their text node, numbered among identical ones in that node. A re-rendered paragraph
  keeps its languages. Two identical sentences elsewhere on the page share one.
- **Memo.** One pick per form and candidate set per page session, looked up before cleanup.
  A new session starts when the page's address changes (single-page navigation) or the
  words or settings change.
- **Focus** stores `mixing.focus` and `mixing.focusSince`. A language whose first word is
  newer than `focusSince` gets the "waiting" notice. In the popup, a chip toggles its
  language in or out of Focus while Focus is on.
- **Coverage.** Slice 32 isn't built, so no-ops are returned as `{ known: true }` for it to
  count. Nothing is counted yet.
- **Speed (measured).** 100,000 picks without memo hits (each with cleanup, concept,
  language and word) take about 300 ms, or 3 µs a pick. The spec's 140 ms appears to cover
  the language draw alone. A page makes a few hundred picks, well under 1 ms. The
  benchmark's budget is 500 ms.
- **Not yet:** slice 35's "Words you know well" filter, its review weights, and site rules
  (38). The hooks (`status`, `site`) are in place.

## Acceptance criteria

- [ ] The reference vectors in the worked examples pass as a golden unit test.
- [ ] A simulation test over 100,000 page keys gives shares within 1 percentage point of
      `w / Σw` for three weight sets.
- [ ] Property tests: adding a language never moves a choice between existing languages;
      hiding a language never moves a choice it didn't hold.
- [ ] On a page with 20 "thanks", all show the same word in balanced and priority modes.
- [ ] Adding an unrelated word via storage leaves every existing swap's DOM untouched.
- [ ] In mix mode with equal weights, consecutive occurrences rotate through all languages, and
      re-rendering a paragraph keeps its languages.
- [ ] Focus excludes all other languages, including one added after Focus started; leaving
      Focus restores the previous `hiddenLangs` exactly; a site language rule (38) overrides
      Focus on that site only.
- [ ] Fresh words win contested forms for `freshDays` days, then rejoin the draw.
- [ ] No-op candidates are dropped and reported to coverage as known, with the English-base
      ("no") and Spanish-base ("hotel") examples as unit tests.
- [ ] With bases es and en, a Spanish page quoting English text picks from `base_lang: "es"`
      records on the Spanish part and `base_lang: "en"` records on the quote, with separate memos.
- [ ] No URL, page key or seed is written to storage or sent anywhere.

## Test plan

- **Unit (slice 02):** golden vectors; simulation shares; rendezvous properties; cleanup rules;
  smooth round-robin sequences for weights (1,1,1) and (1,1,3); concept-key selection; page-key
  canonicalization table (tracking parameters, fragments, sorting).
- **jsdom:** a page with repeated words across text nodes and a late-loaded section; storage
  change of an unrelated word with a DOM-write counter.
- **Playwright corpus:** `mixing.html` reloaded three times with screenshots compared; Focus
  flow with a word added through the background during Focus.

## Rollout and migration

- `created_at` must reach the extension (slice 07 sends it); until it does, freshness is off.
- `seedSalt` is generated on first run of the new version.
- Existing `hiddenLangs` keep their meaning. The old "only" link can't be told apart from
  manual hiding, so nothing is converted; the popup offers Focus from then on.
- Default mode is balanced. Changelog: "Each word on a page now shows one of your languages per
  page, and stays put while you read. New words show up first for a week. Focus on a language,
  give one more weight, or turn on 'Mix within the page' for the old rotation."

## Open questions

1. **Global Focus versus a site's language rule.** Specified as slice 38 decided: the site rule
   wins. Recommendation: keep it, and have the popup's Focus banner say when a site rule is
   overriding it on the current page.
2. **Freshness window.** Recommendation: 7 days, matching research 01; adjustable only through
   the on/off toggle at first.
3. **Should `seedSalt` sync across devices?** Recommendation: yes, so a page looks the same on
   your laptop and desktop.

## Future work

- A "language of the day" mode (one language for all shared words per day).
- Learning-aware weights from slice 35's signals across languages, if users ask for it.
