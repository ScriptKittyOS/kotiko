# Research 01: Language mixing, precedence, density and mastery moments

Scope: what Slovo shows when several of your languages know the same English word, how dense a page gets, and how Slovo could mark progress. Code references are to the repository as of this report. Nothing was changed.

## 1. Summary

- **Precedence today is round-robin per English form, in page order** (`extension/content.js:87-89`). Every visible language gets an equal share of a shared word, whatever your proficiency. The rotation counter resets every time any setting or the word list changes (`content.js:51`, `146`, `181-187`), so a word added from your phone can make words already on the page switch language while you read.
- **Recommended default: a stable, weighted, per-page choice.** For each English form, pick one language per page per day using seeded weighted hashing. Every "thanks" in an article is then the same word, a reload looks the same, and the next page or the next day may use another language. Words added in the last week win contested forms. A "mix within page" option keeps today's behavior for people who want it.
- **There is no density limit.** Every match is swapped. With thousands of words, and especially with function words such as "and" or "is", pages become unreadable. Add one "amount" dial (Light / Medium / Heavy / Everything). Behind it sit three rules: a per-block ratio cap, no two adjacent swaps, and a per-form cap per page. Beginners almost never hit the cap.
- **"Only" isn't really "only".** It hides the languages that exist when you click it (`extension/popup.js:90`), so a language added later shows up anyway. Make "only" (focus) a mode of its own and keep `hiddenLangs` for "rest this language".
- **Measure coverage and celebrate rarely.** Count how much of a page Slovo *could* swap, overall and per language, before the density cap applies. Show it in the popup and the toolbar badge. Fire a tasteful, one-time celebration when you first cross a milestone (25/50/75/90 %) on a substantial page. Respect `prefers-reduced-motion`, allow at most one per day, and provide an off switch.
- **Some swaps change nothing or are wrong.** Spanish "no" = "no", Spanish "hotel" = "hotel", Serbian and Croatian "da" are identical strings, and homographs like "can", "left", "May" and "US" collide. Filter swaps whose native word equals the English, merge identical native strings, warn about form collisions when a word is added, and skip likely proper nouns.
- **Reject English "translations"** (lang `en`, or native equal to English with no target language). Normalize language codes so one language can't split into two (`cmn` vs `zh`).

## 2. Scenarios

### Precedence and mixing

**S1. You know lots of Spanish, Russian and Mandarin, and all three have "thanks".**
Today: `buildMatcher` keeps one candidate per language per form (`content.js:36-44`). Occurrences rotate es → ru → zh in DOM order (`content.js:87-89`), so one paragraph can read "спасибо … 谢谢 … gracias".
Why it matters: three scripts for one concept in one passage triples the load for little gain. A learner benefits more from meeting the same word several times in one context, and variety *across* encounters still gives interleaving.
Recommendation: choose one language per (form, page, day) by default. Offer "mix within page" as an option.

**S2. Reloading the page, or the minute sync landing.**
Today: a reload of a static page gives the same result, because traversal order is deterministic. Lazy-loaded content shifts the counter, though. Any storage change to `words` or `hiddenLangs` calls `apply()`, which unwraps everything and rebuilds `turns` from zero (`content.js:143-149`). Adding one word on Telegram makes every open tab re-render, and many words flip language.
Why it matters: text changing under your eyes is disorienting and looks like a bug.
Recommendation: replace occurrence counting with seeded hashing on (form, page key = origin + path, local date). Use weighted rendezvous hashing (score each candidate as `hash(seed, lang)^(1/weight)` and take the highest). Adding or hiding a language then only changes the forms that language wins, and everything else stays put. Later, re-render only the forms whose candidates changed.

**S3. Which language should win: most known, least known, newest, random, weighted?**
Today: equal share, decided by order.
Analysis:
- *Most known*: comfortable, but you mostly see what you already know, so you learn little.
- *Least known*: maximum challenge, but readability suffers and the bigger languages starve.
- *Pure random*: unstable on reload (see S2).
- *Strict priority order*: predictable, but lower-ranked languages never appear on shared forms.
- *Newest word*: matches the common view (the spacing effect, e.g. Cepeda et al. 2006) that new items need several early, spaced exposures. Applied alone, it makes the latest language dominate.

Recommendation, default "Balanced":
(a) candidates added in the last 7 days win contested forms, with a seeded tie-break among them;
(b) otherwise, a seeded weighted pick with equal language weights.

Options: "Focus on X" (X weighted about 3:1), custom weights, strict priority order, and "mix within page". This needs `inserted_at` in the API payload; `Word.to_json` omits it today (`server/lib/slovo/word.ex:57-68`).

**S4. One language has 2,000 words and another has 50.**
Today: rotation is per form, so the big language owns every form the small one lacks. Its share of the page is overwhelming even though shared forms split evenly.
Why it matters: someone starting Mandarin next to strong Spanish hardly ever sees Mandarin.
Recommendation: the 7-day freshness rule already helps new languages. "Focus" mode raises the small language's weight on shared forms. Per-language coverage in the popup (S16) shows the imbalance. Don't auto-weight by inverse word count; it is opaque.

**S5. Closely related languages (Spanish + Portuguese, Russian + Ukrainian, Serbian + Croatian).**
Today: they rotate like any other pair.
Why it matters: learners commonly report interference between similar languages. Alternating "obrigado"/"gracias" in one paragraph makes it worse.
Recommendation: per-page consistency (S1) is the main fix. Interleaving research (e.g. Kornell & Bjork 2008) shows benefits for telling categories apart, but it studied category learning, not mixing vocabularies across languages, so it doesn't justify within-sentence mixing.

**S6. Two languages share the same native spelling (Serbian/Croatian "da"; Russian and Serbian Cyrillic "да").**
Today: they are separate rows, because uniqueness is per (lang, native) (`server/lib/slovo/words.ex:60-68`). Rotation alternates between visually identical strings, and the tooltip lists both (`content.js:65-71`).
Recommendation: when building candidates, merge identical native strings into one display. The tooltip then reads "da · Serbian, Croatian", and exposure credit goes to both.

**S7. The native word equals the English (Spanish "no", "hotel"; German "Hotel"; Italian "taxi").**
Today: the "swap" changes nothing except a dotted underline (`extension/content.css`).
Why it matters: it wastes a contested slot and inflates coverage.
Recommendation: when native equals the matched text, ignoring case and diacritics, drop that candidate if another one exists. Otherwise leave the English unmarked. Count it as covered for coverage, since you do know it.

**S8. The same concept added twice in one language ("casa" and "hogar" both claim "home").**
Today: the newest wins within a language (`content.js:42-43`). The older word never appears for that form, and the tooltip never mentions it.
Recommendation: keep every same-language candidate and seed among them. List synonyms in the tooltip ("also: hogar").

**S9. An English form that belongs to two meanings ("can" for poder and for lata; "left" for leave and izquierda).**
Today: within one language, the newest word silently takes the form. Across languages, rotation alternates the right and the wrong sense. The prompt asks for forms of the main meaning only (`server/lib/slovo/llm.ex:47-49`), but it can't stop real homographs.
Recommendation: when a word is added, have the server report collisions with forms that are already owned ("'can' is also lata (Spanish)"). Let the user drop a form from a word. Add a local "never swap this form" list, reachable from the tooltip or a context menu later.

**S10. Proper nouns and acronyms (May, Will, Bill, Apple, US).**
Today: the regex is case-insensitive (`content.js:51`), so "US" becomes "НАС" (`matchCase`, `content.js:54-58`).
Recommendation: skip matches that are capitalized mid-sentence when the stored form is lowercase, and skip all-caps matches of 2-3 letters. Accept that sentence-initial ambiguity remains.

### Hidden, new and per-site languages

**S11. You click "only Mandarin", then add a Turkish word from your phone.**
Today: "only" writes every *current* other language into `hiddenLangs` (`popup.js:90`), so Turkish appears. The README calls this deliberate ("a language you've just started always shows up").
Why it matters: someone who chose a focus session sees it broken.
Recommendation: store `mode: {only: "zh"}` separately from `hiddenLangs`. New languages respect focus mode and get a popup notice ("Turkish is new, hidden while you focus on Mandarin"). In normal mode they still appear immediately, which keeps the current intent. Leaving "only" restores the earlier hidden set.

**S12. A language you hid is removed and later started again.**
Today: stale hidden entries are pruned only when the popup opens after a good sync (`popup.js:96-99`).
Recommendation: this is fine. Keep it, and apply the same pruning to the new focus mode.

**S13. Spanish on news, Mandarin on Reddit.**
Today: not possible. There is only a site-wide pause (`popup.js:208-213`).
Recommendation: add a "This site" row in the popup with a language set and an amount override, stored as `siteRules[host]`. It costs little once modes exist. Settings are per browser (`storage.local`), so syncing them across devices would need a server settings endpoint (owner's call, section 4).

**S14. The page itself is not in English (a Spanish news site while you learn Russian).**
Today: content.js never checks the page language, so coincidental forms ("no", "me", "he", "a") get swapped inside Spanish text.
Recommendation: skip when `<html lang>` is present and not `en*`, with a per-site override. This probably overlaps another researcher's area. It's listed here because it produces nonsense mixing.

### Density

**S15. You know 3,000 words across three languages.**
Today: every match is swapped (`content.js:84-100`). Long passages become mostly foreign, often with adjacent swaps ("the большой 狗 corrió").
Why it matters: a commonly cited reading result (Laufer 1989; Hu & Nation 2000) holds that comfortable reading needs roughly 95-98 % of running words to be known. Slovo's swapped words are, by definition, still being learned. Past a point, more swaps stop teaching and start blocking comprehension, and the page loses the context that makes the meaning of a swapped word guessable.
Recommendation: one "Amount" dial controls internal parameters. The values below are starting points to tune by use, not research-derived numbers.

| Level | Max swaps per block | Adjacent swaps | Same form per page |
|---|---|---|---|
| Light | 1 per 15 words | never | 2 |
| Medium (default) | 1 per 7 words | never | 5 |
| Heavy | 1 per 3 words | never | 15 |
| Everything | no cap | allowed | no cap |

A "block" is the nearest block-level ancestor. Text nodes are processed one at a time today (`content.js:73`), so the walk needs a small `WeakMap` of block → {words, swaps, last swap index}. A multi-word form counts as one swap. When the cap binds, swap fresh words first, then words seen least today, then by seeded order. With 30 words you will almost never hit the cap, so this costs beginners nothing.

**S16. Function words ("and", "is", "the", "of").**
Today: if you add "и" = "and", every "and" on every page becomes "и", because nothing gates frequency.
Recommendation: don't block them; learning them is useful. The per-form-per-page cap thins them naturally, so on Medium you see the first five "и" and the rest stay English. "Everything" lifts the cap.

**S17. Infinite scroll and live-updating feeds.**
Today: the rotation counter carries across mutation flushes (`content.js:151-158`), so assignment depends on load order.
Recommendation: with seeded choice, per-form caps count per page session, and blocks are capped independently. Feeds stay readable without bookkeeping across reloads.

### Mastery and feedback

**S18. Nearly every English word on a Turkish-heavy page is known.**
Today: nothing is measured or shown.
Why it matters: progress you can see is motivating, and the owner explicitly wants a delight moment.
Recommendation: count English word tokens in each processed text node, and count those matched by the matcher (*potential* coverage, measured before the density cap, so a capped page can still show "82 % of this page is in your languages"). Keep counts overall and per visible language: "Turkish could cover 71 %". Exclude "the/a/an" from numerator and denominator, because Turkish, Russian, Mandarin and Japanese have no articles and 100 % would otherwise be impossible. Show it in the popup and as the toolbar badge (`action.setBadgeText`, no new permission).

**S19. The confetti moment.**
Recommendation: trigger only when all of these hold:
- the page has at least 150 counted tokens (so a "Thanks!" page doesn't count);
- the tab is visible;
- you are not typing in a field;
- a milestone (25, 50, 75, 90 %, overall or per language) is crossed for the *first time ever*;
- no celebration has happened today.

Store `celebrated[milestone] = timestamp` in `storage.local`, so a reload never repeats it.

Presentation:
- A canvas overlay inside a shadow root, with `pointer-events: none`.
- About 80-120 particles for under 2 s, then removed. Hand-rolled, around 2 KB, no library. The animation starts only on trigger and pauses when the tab is hidden.
- A small toast: "New milestone: 75 % of this page is in Turkish". It uses `role="status"`, doesn't take focus and dismisses itself.
- With `prefers-reduced-motion: reduce`, show the toast only.
- No sound.
- A "Celebrations" toggle in the popup.

The owner's image of English dissolving can be a one-time touch: swapped words briefly fade in, and nothing ever moves layout.

**S20. Other moments.**
- *First sighting*: the first time a just-added word appears on a page, it gets one gentle highlight pulse, and the popup says "собака appeared 4 times today". This needs local exposure counts per word per day, which never leave the browser.
- *Vocabulary milestones* (10/100/500/1,000 words, first word in a new language): mark these in the popup or the Telegram reply, not on web pages.
- *Weekly digest* on Telegram: opt-in.
- Avoid streaks with loss messaging. A common view is that heavy extrinsic rewards can crowd out the intrinsic motivation a reading tool depends on.

**S21. Beyond word swapping.**
Recommendation: at high per-language coverage, Slovo still shows English word order with dictionary-form words (README "Adding words"), which isn't Turkish. A milestone toast can say so honestly and suggest real Turkish reading. An experimental option could drop "the/a/an" next to swapped words in article-less languages ("the собака" → "собака").

### Adding mistakes

**S22. You type an English word into the add box ("dog").**
Today: the add box forces intent "add" (`llm.ex:52-56`). The model may pick your most recent language (`llm.ex:165-173`), which is reasonable, or return `lang: "en"`. That creates an "English" language whose swaps change nothing.
Recommendation: on the server, reject `lang` `en`/`en-*` and entries whose native equals English unless it is a genuine loanword in a named language. With no language named, use the focus language or the most recent one, and say so in the confirmation (the existing undo, `popup.js:166-174`, handles mistakes).

**S23. One language split into two codes (`cmn` vs `zh`, `iw` vs `he`, `sr` vs `sr-Latn`).**
Today: `normalize_lang` drops regions but accepts any 2-3 letter primary tag (`word.ex:43-55`, `21`). A model that answers `cmn` once creates a second "Mandarin" in the popup and doubles its rotation share.
Recommendation: add a canonicalization table (cmn→zh, iw→he, in→id, ji→yi, tl→fil or the reverse), plus a "merge into…" action in a future word manager.

## 3. Design recommendations

**Precedence (default "Balanced, stable")**
1. Build candidates per English form from visible languages: all same-language synonyms, merged by identical native string, no-op candidates dropped (S6-S8).
2. If any candidate was added in the last 7 days, pick among those.
3. Otherwise make a weighted rendezvous pick seeded by (form, origin + path, local date). Weights default to equal; "Focus on X" sets X to 3.
4. The choice applies to every occurrence of that form on the page.

Why this default:
- Predictability: the same page looks the same on reload, with no flicker on sync.
- Learning: repetition in context within a page, variety and spacing across pages and days, and priority for new items, which is where early exposure helps most.
- Fairness: no language is starved, and nothing is hidden behind an opaque proficiency score.

Options, in order of usefulness:
- **Focus** language (replaces "only").
- **Mix within page** (today's behavior, seeded).
- **Custom weights** (advanced).
- **Priority order** (comfort reading).

A proficiency setting per language isn't needed. Word count is already a visible proxy (`popup.js:36-47`), and weights express intent more directly than "I know Spanish well" does.

**Density.** One "Amount" dial with Medium as the default, implemented as a block cap, no adjacency and a per-form page cap (S15). Allow a per-site override. Measure coverage *before* capping, so the dial never hides progress.

**Feedback.** Show coverage in the popup and badge, with rare, once-only, reduced-motion-aware celebrations and a toggle. Keep all exposure data local.

**Learning-science basis, stated cautiously.** The spacing effect and the value of repeated retrieval are well established. "Desirable difficulty" (Bjork 1994) supports some challenge but not overload. Reading-coverage studies support keeping unknown-word density low. Interleaving evidence comes mostly from category and maths learning, so it doesn't settle within-sentence language mixing. Weaving foreign words into native text is an established technique, sometimes called "diglot weave". No study known to this report sets the right ratio for multilingual weaving, which is why the dial values are presented as tunable.

## 4. Open questions for the owner

1. Should the default be per-page consistency (recommended) or the current within-page rotation?
2. Should a language added while in focus mode be held back (recommended) or shown immediately?
3. Celebrations on by default (recommended, given how rare they are) or opt-in?
4. Should settings (weights, focus, site rules, amount) stay per browser or sync through the server for multi-device use? Syncing needs a settings endpoint and a decision about where the canonical state lives.
5. Should words eventually "graduate" and stop being swapped to make room for newer ones, or stay forever? This changes what "coverage" means.
6. How much gamification fits the project's tone? This report recommends milestones without streaks.

## 5. Proposed slices

| Slice | Goal | Size | Priority | Depends on |
|---|---|---|---|---|
| `stable-seeded-choice` | Replace round-robin with weighted rendezvous hashing per (form, page, day); same form = same language on a page | S | P0 | none |
| `candidate-cleanup` | Drop native==English candidates, merge identical natives, keep same-language synonyms | S | P0 | `stable-seeded-choice` |
| `reject-english-adds` | Server refuses `lang: en` and native==English entries; confirmation names the chosen language | S | P0 | none |
| `focus-mode` | "Only" becomes a stored focus mode; new languages respect it with a notice | S | P0 | none |
| `density-cap` | Per-block ratio cap, no adjacent swaps, per-form page cap at Medium | M | P0 | `stable-seeded-choice` |
| `amount-dial` | Popup Light/Medium/Heavy/Everything control | S | P1 | `density-cap` |
| `fresh-word-priority` | Send `added_at` from the server; words from the last 7 days win contested forms | S | P1 | `stable-seeded-choice` |
| `language-weights` | Focus weighting and custom per-language weights in the popup | M | P1 | `stable-seeded-choice`, `focus-mode` |
| `lang-canonicalization` | Map cmn/iw/in/ji etc. to one code; keep one language from splitting | S | P1 | none |
| `form-collision-warnings` | Server reports forms already owned by other words at add time; per-form "never swap" list | M | P1 | none |
| `proper-noun-guard` | Skip mid-sentence capitalized and short all-caps matches | S | P1 | none |
| `page-language-guard` | Skip pages whose `<html lang>` isn't English, with a per-site override | S | P1 | none |
| `page-coverage` | Potential coverage overall and per language; popup line and toolbar badge | M | P1 | none |
| `milestone-celebrations` | Once-only milestone confetti/toast, reduced-motion aware, one per day, toggle | M | P1 | `page-coverage` |
| `incremental-rerender` | On sync, re-render only forms whose candidates changed | M | P2 | `stable-seeded-choice` |
| `site-rules` | Per-site language set and amount override | M | P2 | `focus-mode`, `amount-dial` |
| `exposure-tracking` | Local per-word daily exposure counts; first-sighting pulse; cap priority uses them | M | P2 | `density-cap` |
| `article-dropping` | Experimental: hide "the/a/an" next to swaps into article-less languages | S | P2 | `page-coverage` |
| `settings-sync` | Server-side settings so weights, focus and site rules follow you across devices | M | P2 | `language-weights`, `site-rules` |
