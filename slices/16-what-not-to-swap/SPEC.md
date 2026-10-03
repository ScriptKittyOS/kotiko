# 16 · What not to swap

| | |
|---|---|
| **Status** | Proposed; the control rules and the lone-capital rule are implemented early (see "Implemented early") |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [14-matcher-engine](../14-matcher-engine/SPEC.md), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (base languages, the shared `stopwords.json` and `casing.json`) |
| **Unblocks** | [38-per-site-rules](../38-per-site-rules/SPEC.md), [32](../32-page-coverage-and-celebrations/SPEC.md) (coverage counts only text Kotiko would consider) |
| **Sources** | [DECISIONS 2026-10-01, "English is not the base language"](../DECISIONS.md); [06 F13](../../docs/research/06-adversarial-qa.md), [02 B1-B3, C4, E6](../../docs/research/02-linguistics.md), [03 B1, B2, B5, B6, D5, E4](../../docs/research/03-browser-extension.md), [01 S10, S14](../../docs/research/01-language-mixing.md), [05 S23](../../docs/research/05-learner-ux.md) |

## Problem

Kotiko swaps nearly everything it can see. Read from the code, and reproduced where noted:

- **Pages in languages the learner doesn't read get "translated".** Nothing checks
  `<html lang>` or element `lang` (`extension/content.js:115-132`). For a learner who reads
  English, on a German page "Hand", "Kind", "also" and "will" are swapped; on French pages
  "on" and "pain"; on Spanish pages "come", "no" and "a". Wikipedia's `<i lang="de">` quotes and
  IPA spans are treated as English (02 E6, 03 B5, B6).
- **A rule that only allowed English pages would break everyone else.** The earlier draft of
  this slice swapped only English text. For the maintainer's example, a learner in Puerto Rico
  who reads Spanish, that rule skips every page they read, and Kotiko never does anything
  ([DECISIONS 2026-10-01](../DECISIONS.md)). The rule has to be "pages in one of *your*
  languages" (slice [50](../50-ui-localization-and-base-language/SPEC.md)'s base languages).
- **Names and acronyms are swapped as words.** The regex is case-insensitive
  (`content.js:51`). "the IT team" becomes "ЭТО team", "Vitamin A." becomes "Vitamin Ein.",
  every "a" in "I think a cat is a pet" becomes "ein" (06 F13, reproduced). "Will Smith",
  "May 2026", "Bill Gates" and "the US army" match too (02 B1, B2).
- **Code editors and controls are swapped.** Only a short tag list is skipped
  (`content.js:7-10`). GitHub's code view, Monaco, CodeMirror and Ace render code in plain
  `div`s and `span`s, and Monaco then misplaces the cursor (03 B1). Buttons, menus and labels
  change under the user's mouse, and voice-control users ("click Delete") no longer match the
  label (03 D5, 05 S23).
- **Editors can capture foreign words.** An element that becomes editable after Kotiko swapped
  it lets the user type around foreign words that then get saved into their document (03 B2).
- **There is no notion of a sensitive site.** Banking and health pages get swapped like any
  other (03 E4, open question 2).

## Goals

- Kotiko only swaps text in one of the learner's base languages (50): the page and each element
  are judged by declared language, with detection as a fallback and a per-site override. Text
  in any other language, including English for a learner who doesn't read it, is left alone.
- Each subtree is scanned with its own base's index, so a Spanish page quoting English text
  works for a learner who reads both.
- Precision over coverage for capitalized and short words (02 open question 1): names,
  acronyms and initials are left alone, with every example in this spec passing, using each
  base's own capitalization conventions (German nouns are capitalized and are not names;
  Spanish months and languages are lowercase; caseless scripts have no case evidence).
- Code, editors, explicit opt-outs and Kotiko's own UI are never touched.
- Controls (buttons, menus, labels) are left as the site wrote them, in the learner's own
  language, by default, with a setting to include them.
- A built-in, transparent "sensitive sites" rule that the user can turn off.

## Non-goals

- Boundary rules inside words (contractions, hyphens, URLs): [14](../14-matcher-engine/SPEC.md).
- Per-site language and amount settings and their UI: [38](../38-per-site-rules/SPEC.md);
  this slice defines the signals 38 overrides.
- Wrong-sense swaps ("like" in "looks like rain"): [36](../36-grammar-and-senses/SPEC.md).
- Function-word frequency limits: [31](../31-density-and-amount/SPEC.md).
- Iframes and shadow roots: [42](../42-frames-and-shadow-dom/SPEC.md); the same rules apply there.

## User stories

- As a reader of English and not German, learning Russian, Kotiko leaves a German news site
  alone.
- As a reader of Spanish in Puerto Rico, Kotiko swaps words on my Spanish news sites and leaves
  English pages alone, because I didn't say I read English.
- As a reader of Spanish and English, a Spanish article quoting an English speech gets Spanish
  swaps in the article and English swaps in the quote.
- As a reader of "the IT team met at the US embassy in May", nothing in that sentence is swapped
  unless I know "team", "met" or "embassy"; and in "el equipo de TI se reunió en mayo", "TI" is
  never swapped.
- As a developer reading code on GitHub, the code is untouched.
- As someone paying a bill online, the payment form says exactly what the bank wrote.

## Implemented early

A maintainer report: on a real site, clickable toggles labelled "AOI I" and "AOI II" (styled
`div`s and `label`s, not `<button>`s) showed "AOI Я" for a learner who had saved я ("I").
Two parts of this slice were built ahead of the rest to fix it, in today's content script:

- **Controls** (section 2, "Controls" row and the notes under the table), in
  `extension/lib/controls.js` (`globalThis.KotikoControls`, unit-tested in
  `test/unit/controls.test.mjs`). Always on: the setting "Swap words in buttons and menus"
  (off by default) is **not built yet** and remains future work for this slice.
- **The lone-capital rule** (section 3, "Lone capitals next to codes"), as `skipLetter()` in
  `extension/lib/matcher.js`, unit-tested in `test/unit/matcher.test.mjs`. The full token
  rules (`rules.js`) replace it.

`content.js` checks a text node's ancestors only when the node has a match, reads all
decisions for a batch before changing the DOM (so reading computed styles never forces a
style recalculation between our own writes), and caches the decision per element in a
`WeakMap` that `apply()` clears. Elements that change role or style later keep their cached
decision until the next `apply()`. Covered by `test/dom/content.test.mjs` ("controls stay as
the site wrote them", "a lone capital that is a numeral or code") and the Playwright
assertion for `controls.html` in `test/e2e/corpus.spec.mjs`.

## Specification

Three layers, cheapest first: page gate, element rules (during the walk), token rules (on each
match). Files: `extension/content/skip.js` (page and element) and `extension/lib/rules.js`
(token, pure and unit-tested).

### 1. Page gate

Kotiko runs on a document only if all of these pass:

1. URL is `http:`, `https:` or `file:`.
2. Slice 38's `effective()` returns `swap: true`. It already folds in the global switch, the
   tab's "show originals" state (33), the site's own rule and this slice's sensitive-site list
   (section 4), in that order.
3. **Page language** is one of the learner's base languages, declared or detected. The result
   is the page's base, `pageBase`, or null (leave the page alone, except for subtrees declared
   in a base, below):

```
bases    = storage.local.baseLangs              // 50, e.g. ["es"], ["es", "en"]; at most 4
declared = html[lang] || html[xml:lang] || meta[http-equiv=content-language]
isBase(t)= the base in `bases` that is the same base as baseTagOf(t) (50: primary language and
           script match; pt-BR and pt-PT are the same base), or null
sample   = up to 2,000 characters of visible text, from main/article if present, else body,
           skipping elements this slice skips; collected with the walker, no layout reads
detected = await i18n.detectLanguage(sample)       // chrome.i18n / browser.i18n, content-script safe
           -> { isReliable, languages: [{ language, percentage }] }; tags mapped with baseTagOf
top      = detected.languages[0]

if the site's rule (38) has swap: "on" -> pageBase = the rule's base, else bases[0]; done
                                            // set by "Run here anyway", which asks which of the
                                            // learner's languages the page is in when they have several
if isBase(declared) = b:
    pageBase = b, unless detected.isReliable and top is not a base and top.percentage >= 80
    (templates often leave lang="en" or lang="es" on pages in other languages); then null
    if top is reliably a different base with >= 80 %, pageBase = that base
if declared is a language that isn't a base:
    pageBase = isBase(top) if detected.isReliable and top.percentage >= 80
    otherwise null, in mixed mode: run only inside elements whose lang is a base
if nothing declared:
    pageBase = isBase(top) if top.percentage >= 50
    otherwise null, in mixed mode as above
if detection is unavailable or the sample is under 200 characters:
    function-word heuristic: for each base b with a stopword list (50 §5: its own
    stopwords.txt, else its entry in _generic/stopwords.json, about 60 languages), the share
    of word tokens (14's tokenizer for b) that are stopwords of b
    (en: the, and, of, to, a, in, is, it, you, that, ...; es: de, la, que, el, en, y, a, los,
    se, del, ...; ja: の, に, は, を, た, が, で, て, と, し, ...);
    pageBase = the best-scoring base if its share is at least 12 %; recheck once after 5 s
    if the sample was short (single-page app shells). A base with no stopword list at all
    relies on the declared language and i18n.detectLanguage.
```

`baseFor(el)` (cached per element with the element rules) is what slice 15 calls for each text
node: the base of the nearest `[lang]` or `[xml:lang]` ancestor if that language is a base,
`null` if it is declared and isn't a base, and `pageBase` otherwise (an empty `lang=""`
inherits). A Chinese page declaring bare `lang="zh"` is matched against `zh-Hans` or `zh-Hant`
by detection (`zh-CN`, `zh-TW`), falling back to `zh-Hans` per 50's `baseTagOf`.

Examples, for a learner with bases `["es"]`: a Spanish page with `lang="es"` runs with base
`es`; an English page with `lang="en"` is left alone; a Spanish page that left the template's
`lang="en"` and is reliably 95 % Spanish runs with base `es`; an undeclared page that is 70 %
Spanish runs. With bases `["es", "en"]`, both kinds run, each with its own index. With bases
`["en"]`, the rules are what the earlier English-only draft specified.

The decision is re-evaluated when the attribute observer from slice 15 sees `lang` change on
`<html>`, and by slice 43 when the page is machine-translated. The gate result and reason are
exposed to the popup ("This page is in German, which isn't one of your languages. Kotiko leaves it
alone. [Run here anyway]", with 50's copy in the interface language), whose UI is slice 20's.

### 2. Element rules

Applied in the walker's `acceptNode`: a match rejects the whole subtree. Each element's result
is cached in a `WeakMap<Element, boolean>` so the check is O(1) after the first visit.

| Rule | Selector or test | Why |
|---|---|---|
| Non-text tags | `script, style, noscript, template, textarea, input, select, option, code, pre, kbd, samp, var, svg, math, canvas, iframe, object, embed, video, audio, title, head` | Existing list (`content.js:7-10`) plus template, var, object, embed and media |
| Editable | `el.isContentEditable`, `[role=textbox]`, `[role=searchbox]`, `[role=combobox]` | Never type around foreign words (03 B2) |
| Code editors and code views | `.monaco-editor, .cm-editor, .CodeMirror, .ace_editor, .react-code-lines, .blob-code, .highlight, [class*="language-"], [role=code]`, plus per-host extras in `extension/data/skip-selectors.json` | Code and editors that measure text (03 B1) |
| Explicit opt-out | `[translate=no]`, `.notranslate`, `[data-kotiko-skip]`, `[data-slovo-skip]` (legacy) on any element **below** `body` | The site says this text isn't to be translated. Ignored on `html` and `body`, because many React sites set `translate="no"` there only to stop Google Translate crashing them; `<meta name="google" content="notranslate">` is ignored for the same reason |
| Not one of the learner's languages | `baseFor(el)` is null: the nearest `[lang]` or `[xml:lang]` ancestor declares a language that isn't a base (empty `lang=""` inherits the page decision). A subtree declared in a *different* base is not skipped; it is scanned with that base's index | Quotes, names and IPA in other languages (03 B5); bilingual pages |
| Controls (setting "Swap words in buttons and menus", **off** by default; the setting isn't built yet, so today controls are always skipped) | `button, summary, label, legend, select, option, optgroup, datalist, nav, menu, [role=button], [role=link][aria-haspopup], a[href][aria-haspopup], [role=menu], [role=menubar], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], [role=tablist], [role=option], [role=listbox], [role=combobox], [role=switch], [role=checkbox], [role=radio], [role=toolbar], [role=slider], [role=spinbutton], [role=textbox], [role=searchbox], [role=tree], [role=treeitem], [role=navigation]`, plus the three signals below: forms, focusable chips and clickable elements | Misclicks, voice control and WCAG 2.5.3 Label in Name (03 D5) |
| Sensitive forms | `form` elements containing `input[type=password]` or `[autocomplete^="cc-"]`, `[autocomplete=one-time-code]` | Logins and payments anywhere |
| Kotiko's own UI | the popover host (19), celebration overlay (32), `kotiko-w` | Never process ourselves |
| Volatile | elements slice 15 marked volatile | Rewrite budget exceeded |

Links in running text (`a` without a control role) are swapped; links inside `nav` are not,
because `nav` is a control region.

**Control signals beyond tags and roles** (implemented early, `extension/lib/controls.js`).
Many sites build toggles, chips and segmented buttons from styled `div`s, so tags and roles
alone miss them. Any ancestor of the text, up to but not including `<body>`, counts:

- **Inside a `<form>`** (the maintainer's suggestion): everything in it, except a form that
  wraps the page's content, meaning it contains `main`, `article`, `[role=main]`,
  `[role=article]` or `h1` (ASP.NET WebForms and some CMSs wrap the whole body in one form).
  The form's own buttons, labels and legends are still skipped by their tags.
- **Focusable**: `tabindex` is an integer >= 0, the element isn't a link (`a[href]`,
  `area[href]`), isn't a landmark or big container (`html, body, main, article, section,
  aside, dialog`, or `role` `main`, `region`, `document`, `dialog`, `alertdialog`, `article`,
  `application`), and its text is control-like (below). Many sites put `tabindex="-1"` or
  `"0"` on `<main>` for skip links, and `tabindex="0"` on scrollable tables and code blocks for
  keyboard scrolling; neither may skip content. `tabindex="-1"` never counts.
- **Clickable**: computed `cursor` is `pointer` on the element **and not on its parent** (the
  property is inherited, so only the element that sets it counts; everything inside a
  clickable card inherits it), the element isn't a link or a container as above, and its text
  is control-like. A long clickable news card is content and is swapped; an `<a href>` in a
  paragraph is swapped.
- **Control-like text**: the element's `textContent`, whitespace collapsed, is at most
  **40 characters and at most 4 words** (`MAX_CHARS`, `MAX_WORDS`). "AOI II", "My house",
  "Show more", "Sort by date" are controls; a card's headline plus summary is not.

`[role=gridcell]` is deliberately **not** a control: data grids, calendars and some tables use
it for content. `[contenteditable]` stays in the editable row above.

**Cost.** The ancestor chain is evaluated only for a text node that has a match. Signals that
need no style (tags, roles, `aria-haspopup`, forms, `tabindex`) are checked for the whole chain
first, nearest element first; `getComputedStyle` is read only when none is found, top down,
and once per element. Decisions are cached in a `WeakMap<Element, boolean>` until the next
full re-apply. `getComputedStyle` is never called for text nodes without a match.

**Editables that appear later.** A capture-phase `focusin` listener on `document` checks the
target: if it is editable or matches the editable row above, call
`KotikoEngine.restoreWithin(target)` and add it to the skip cache. The `contenteditable`
attribute isn't observed globally, because observing attributes on the whole subtree is too
costly; focus is the moment that matters.

### 3. Token rules

Applied to each match from slice 14 before precedence (18). Inputs: the match (`surface`,
`shape`, `sentenceStart`, `prevToken`, `nextToken`, gaps), the form's `case` flag
(`any` | `lower` | `exact` | `proper`, default `any`; set by [09](../09-shared-word-spec-and-prompt/SPEC.md)
and editable in [21](../21-dashboard/SPEC.md)), page evidence (below), and the conventions of
the base the text was scanned in, `C` = that base's entry in the shared
`spec/lang/_generic/casing.json` (50 §5; its `default` when the base has no entry).

```
filter(m):
  f = m.form.case
  if neverSwap has m.key: drop                                  // user list, below
  if f == "exact": keep only if m.surface == form text exactly (case-sensitive)
  if f == "proper": keep only if m.shape is title or upper; done (17 never copies its capital)
  if m.tokens == 1 and m.surface has one letter: return singleLetter(m)
  switch m.shape:
    caseless: keep                                              // Han, kana, Thai, Arabic: no case evidence exists
    lower: keep
    mixed: drop                                                 // iPhone, eBay, McDonald
    upper:
      if shouting(m): keep                                      // see below
      if letters(m.surface) <= 5: drop                          // US, IT, WHO, NASA, AM, OR
      keep                                                      // long all-caps words in a mixed line are usually emphasis
    title: return titleCase(m)                                  // may defer, see evidence

titleCase(m):
  if f == "lower": keep only if m.sentenceStart and not nameLike(m)
  if numberNext(m): drop                                        // May 2026, March 3, Chapter 2
  if nameLike(m): drop                                          // Will Smith, Bill Gates, New York
  if C.nouns_capitalized: keep                                  // German "der Hund": a capital is ordinary
  if m.sentenceStart: defer(m, "start")
  if C.title_case_headlines and inTitleRun(m): defer(m, "title")
  drop, and record proper evidence for m.key                    // mid-sentence capital: Rose, Apple, Turkey; Rosa, Apple

nameLike(m): an adjacent token (single space gap, same sentence) is in C.honorifics
             (en: Mr, Mrs, Ms, Dr, St, Prof, Sir, Lady, Lord, King, Queen, President;
             es: Sr., Sra., Srta., Dr., Dra., Don, Doña, San, Santa, Rey, Reina, Presidente;
             de: Herr, Frau, Dr., Prof., Sankt), or, when C.nouns_capitalized is false, is
             title-shaped, not sentence-initial and not in C.capitalized_pronouns (en: "I")
numberNext(m): next token starts with a digit, is a roman numeral of two or more letters
             (II, IV), or is a single uppercase letter other than "I" (Type A, Plan B)

singleLetter(m):
  in C.single_letter_words (en: a; es: a, e, o, u, y; fr: a, à, y; it: a, e, è, o; pt: a, e, o):
       keep only if the surface is lowercase, prevToken isn't a mid-sentence title-shaped
       token, nextGap isn't "." or ")" and the match isn't inside "(a)"
  lone capital next to a code (implemented early as skipLetter(), any uppercase letter):
       drop, see "Lone capitals next to codes" below
  in C.capitalized_pronouns (en: I):
       keep only if the surface is exactly that letter, next gap is a space followed by a
       lowercase letter, and prevToken isn't a mid-sentence title-shaped token (World War I,
       Henry I; but "Can I go" keeps it, because "Can" starts the sentence)
  caseless single characters (犬, 猫, 狗 in ja and zh): keep; a one-character word is normal there
  anything else: drop

  "mid-sentence title-shaped" = prevToken.shape is title and prevToken.sentenceStart is false
```

**Lone capitals next to codes** (implemented early, `skipLetter()` in
`extension/lib/matcher.js`, before the rest of the token rules). A one-letter match that is
an uppercase letter is dropped when:

- it is joined to a letter or digit by a hyphen (`-`, U+2010, U+2011) or a slash: "I-95",
  "95-I", "A-1", "I/O" (dashes are prose punctuation and don't count);
- the next token (after whitespace only) is all-caps with 2+ letters, an uppercase Roman
  numeral, or contains a digit: "I AM", "I II III", "I 95";
- the previous token (whitespace only) is all-caps with 2+ letters or an uppercase Roman
  numeral: "AOI I", "Henry VIII I", "World War II I", and accepted as a loss, "OK I think";
- the previous token contains a digit, unless a lowercase word follows: "Model 3 I" is
  dropped, "In 2020 I moved" keeps its pronoun;
- the previous token is title-shaped ("War", "Type", "Vitamin") and either is mid-sentence
  (the character before it is a letter, digit, comma or semicolon) or no lowercase word
  follows the letter: "World War I began", "Type I", "Vitamin A.", "Plan B". "Can I go" and
  "Then I said" keep the pronoun, because the title-shaped word starts the sentence and a
  lowercase word follows.

Lowercase letters are never dropped by this rule ("a NASA report", "a 2020 study"). Context
is the text node plus up to 40 characters of the neighbouring text in the same line: a
sibling, or the parent's sibling when the parent is an inline element (two levels at most),
never across a block element, with element boundaries read as a space (`<b>AOI</b> I`,
`<span>AOI</span><span>I</span>`). Contractions ("I'm") are left to slice 14. Known gaps that
the full rules close: "Type I diabetes" at a sentence start, "Can I?".

**Shouting context**: the text node (plus `ctx`) has at least four letter tokens and at least
70 % of its cased letters are uppercase ("THANK YOU FOR READING").

**Title Case run**: at least three tokens of four or more letters in the text node, and at
least 60 % of them title-shaped (headlines, menu labels). Only bases whose `casing.json` sets
`title_case_headlines` (English) treat this as headline style; Spanish, French and Italian
headlines use sentence case, so a capital there is real evidence.

**Per-base conventions** (entries in the shared `_generic/casing.json`, schema in
`spec/lang/schema/casing.schema.json`, shared with slice 17; a language without an entry
uses `default`, the column a caseless or unlisted base gets):

| Key | en | es | de | ja, zh, th |
|---|---|---|---|---|
| `nouns_capitalized` | false | false | true | n/a (caseless) |
| `title_case_headlines` | true | false | false | n/a |
| `capitalized_pronouns` | ["I"] | [] | [] (Sie is a pronoun but not single-letter) | [] |
| `lowercase_classes` | [] | months, days, languages, nationalities | [] | n/a |
| `honorifics` | Mr, Mrs, … | Sr., Sra., … | Herr, Frau, … | (none; 16 relies on form flags) |
| `single_letter_words` | a | a, e, o, u, y | (none) | n/a |

`lowercase_classes` only documents why a mid-sentence capital in that class is evidence of a
name ("vi a Mayo" is a person, "en mayo" is the month); the rule itself is the generic one.
Caseless bases have no case evidence at all: proper nouns there are protected only by a form's
`case: "proper"` or `exact` flag, the never-swap list, and 36's senses.

**Page evidence and deferral.** Capitalized matches at a sentence start or in a headline are
ambiguous: "Apple is a company" and "Dog bites man". Kotiko decides them with what the rest of
the page shows:

- `lowerSeen: Set<key>`: keys that appeared lowercase anywhere in scanned text (including
  tokens that weren't swapped).
- `properSeen: Set<key>`: keys that appeared title-shaped mid-sentence outside a Title Case run.

Deferred matches are held in a list and resolved at the end of each processing slice of
slice 15's scheduler (and at the end of the initial pass): a `"start"` deferral is kept unless
`properSeen` has the key; a `"title"` deferral is kept only if `lowerSeen` has the key and
`properSeen` doesn't. Resolved matches go through the rest of the pipeline and are swapped
then; at most one slice (8 ms) later than immediate matches. Decisions, once made, are never
revisited on that page view, so a page never flickers when evidence arrives later.

### Worked examples

Known words: it, us, a, I, may, will, bill, apple, dog, rose, thank you, team, army.

| Text | Swapped | Not swapped, and the rule |
|---|---|---|
| `the IT team` | team | IT: upper, 2 letters |
| `the US army` | army | US: upper, 2 letters |
| `Vitamin A is good` | (none of a) | A: single letter after a title-shaped word |
| `I think a cat is a pet` | I, a, a | |
| `World War I began` | | I: after a mid-sentence title-shaped word |
| `Can I go?` | I | |
| `Plan B`, `Type A` | | single uppercase letter |
| `May 2026`, `on May 3` | | number next |
| `In May we left` | | mid-sentence capital (proper evidence) |
| `You may go. May I?` | may (first); May (sentence start, deferred, kept unless "May" appears mid-sentence capitalized elsewhere) | |
| `Will Smith said` | | name pair |
| `Will you come?` | Will (sentence start) | |
| `Bill Gates`, `a bill` | bill (lowercase) | Bill: name pair |
| `She grew a Rose` | | Rose: mid-sentence capital |
| `Apple announced` with "apple" lowercase nowhere else and "Apple" mid-sentence elsewhere | | Apple: proper evidence |
| `Man Bites Dog` (headline) with "dog" lowercase in the article | Dog | |
| `Man Bites Dog` with no lowercase "dog" on the page | | Dog: title run without evidence |
| `THANK YOU FOR READING` | THANK YOU | |
| `Read the WHO report` | | WHO: upper, 3 letters |
| `Monday` with form case `proper` | Monday (17 shows "lunes", not "Lunes", mid-sentence) | |
| `iPhone`, `eBay` | | mixed shape |

Spanish base (`es`). Known words (all `base_lang: "es"`): a (en "to"), y (en "and"), mayo (en
"May"), rosa (en "rose"), perro (en "dog"), equipo (en "team"), ejército (en "army"),
español (en "Spanish").

| Text | Swapped | Not swapped, and the rule |
|---|---|---|
| `el equipo de TI` | equipo | TI: upper, 2 letters |
| `el ejército de EE. UU.` | ejército | EE, UU: upper, 2 letters |
| `Vitamina A` | | A: single letter after a title-shaped word |
| `Voy a casa y como` | a, y | |
| `Plan B` | | single uppercase letter |
| `el 3 de mayo`, `Mayo 2026` | mayo (lowercase) | Mayo: number next |
| `Ayer vi a Rosa` | a | Rosa: mid-sentence capital (proper evidence; Spanish doesn't capitalise flowers) |
| `Rosa dijo que sí` with "Rosa" mid-sentence elsewhere | | Rosa: sentence start, deferred, proper evidence |
| `El Perro Andaluz` (film title) | | Perro: mid-sentence capital; Spanish has no Title Case headlines |
| `la Sra. Rosa` | | Rosa: honorific |
| `¿Hablas español?` | español | |

German base (`de`). Known words: Hund (en "dog"), Wolf (en "wolf").

| Text | Swapped | Not swapped, and the rule |
|---|---|---|
| `Der Hund bellt laut` | Hund | (German nouns are capitalised; not a name) |
| `Herr Wolf kommt` | | Wolf: honorific |

Japanese base (`ja`). Known words: 犬 (en "dog"), 猫 (en "cat").

| Text | Swapped | Not swapped, and the rule |
|---|---|---|
| `犬と猫が好き` | 犬, 猫 | (caseless; one-character words are normal) |

### 4. Sensitive sites

Two protections:

- **Sensitive forms**, the element rule above: always on, on every site, with no setting.
- **Sensitive sites**: hostnames in `extension/data/sensitive-sites.json`, paused by default.
  Each entry is `{ pattern, category }`, with `category` one of `banking`, `payments`, `health`,
  `government`, `email`, so slice 38's popup can say "Paused here by default (banking)".
  Patterns: `*.bank`, hostname labels equal to or starting with `bank`, `banking` or
  `onlinebanking`, a few dozen widely used banks and payment providers, tax portals, patient
  portals (`mychart.*`) and webmail compose URLs. The file is public in the repository, changed
  by pull request, versioned with the extension, and never fetched remotely.

The global setting "Leave sensitive sites alone" (**on** by default, slice 39's `s:display`
group) turns the second protection off entirely; slice 38 lets the user override it per site
with one click. The setting "Swap words in buttons and menus" (off) lives in the same group.

### 5. Never-swap list

`neverSwap: string[]` of form keys, global, stored in a new `s:matching` group in
[39](../39-multi-device-sync/SPEC.md)'s synced settings (shared with slice 36's `formSense` and
`variants`). Filled from the popover's "Don't swap
this word" action ([19](../19-word-popover/SPEC.md)) and editable in the dashboard (21).
Applied in the token filter so the word itself stays in the list. Per-site never-swap lists
are 38's.

### Performance

The page gate's detection runs once per document (and once more for short shells), on at most
2,000 characters; `i18n.detectLanguage` is asynchronous and takes a few milliseconds. The
initial pass waits for it: total added latency under 20 ms on the reference page. Element
rules are cached per element. Token rules are O(1) per match. Evidence sets hold only keys
present in the index, so they stay small.

## Acceptance criteria

- [ ] With bases `["en"]`, fixtures in German, French and Spanish (declared and undeclared)
      are untouched; on an English page with `<i lang="de">` quotes, the quotes are untouched.
- [ ] **Puerto Rico**: with bases `["es"]`, Spanish fixture pages (declared and undeclared) are
      swapped and English, German and Japanese pages are untouched.
- [ ] With bases `["es", "en"]`, a Spanish page with an `<blockquote lang="en">` swaps the
      Spanish text from `es` records and the quote from `en` records.
- [ ] A page declaring `lang="en"` whose text is reliably German is skipped; a page with no
      `lang` whose text is in a base is swapped; a page declaring `lang="en"` that is reliably
      Spanish runs with base `es` for a learner who reads Spanish.
- [ ] The function-word heuristic picks the right base for short English, Spanish and Japanese
      samples with detection stubbed out.
- [ ] Every row of the worked-examples tables (English, Spanish, German, Japanese) passes as a
      unit test of `rules.js`.
- [ ] Monaco, CodeMirror 6, Ace and a GitHub code-view snapshot are untouched.
- [ ] `translate="no"` on `<html>` does not stop Kotiko; on a `div`, it does.
- [ ] With the default settings, `button`, `nav` and `[role=menuitem]` text is untouched;
      with "Swap words in buttons and menus" on, it is swapped.
- [ ] Focusing an element that became `contenteditable` after swapping restores the original
      text in it before the first keystroke.
- [ ] Password and payment forms are untouched on every site.
- [ ] The popup can show why Kotiko isn't running on the current page.

## Test plan

- **Unit (slice 02):** `rules.js` against the worked-examples tables and the English boundary
  table rows 21-28 in slice 14; evidence and deferral ordering; the language decision table
  with stubbed `detectLanguage` results for base sets `["en"]`, `["es"]`, `["es", "en"]` and
  `["ja"]`; `baseFor` over nested `lang` attributes; the shared `casing.json` and
  `stopwords.json` against their schemas.
- **jsdom:** element rules over a fixture with each selector; `focusin` restore; legacy
  `data-slovo-skip`. Done early for controls: "AOI I / AOI II" toggles as `role=radio`
  divs, as `<label>`s and as `cursor: pointer` divs (inline style and a `<style>` rule); a
  `<button>`; `role=option` lists; menus, tabs, `nav`, `summary` and `aria-haspopup` links;
  a `<form>`, and a form that wraps `<main>` (swapped); a `tabindex=0` chip; `<main
  tabindex="-1">` and `<article tabindex="0">` around paragraphs and a long `tabindex=0`
  scroll area (swapped); an `<a href>` in a paragraph and a long clickable card (swapped);
  text added later inside a control; `getComputedStyle` read only for elements around
  matches, once each. Lone capitals: "World War I", "Type I", "I-95", "AOI I" (in one text
  node, in a sibling element and in the parent's sibling) stay; "I think" swaps; a block
  boundary doesn't carry context over.
- **Unit (done early):** `controls.js` (`isControlElement`, `isPointerControl`,
  `createControlCheck` caching and style-read order) and `skipLetter()` (the cases in "Lone
  capitals next to codes", lowercase letters, and two F13 rows: "Vitamin A.", "Plan B and
  Plan A").
- **Playwright, slice 02's corpus:** `other-lang.html`, `editors.html`, `controls.html` (done
  early: nav, button, label, form, styled and ARIA toggles, a tab, a `tabindex` chip stay
  English; prose in `<main tabindex="-1">`, a link, a long clickable card and "I think" swap;
  "World War I", "Type I", "I-95" and "AOI I" stay),
  `boundaries.html`. Added by this slice: `other-lang-undeclared-fr.html`,
  `mislabelled-lang.html`, `es-news.html`, `es-quoting-en.html`, `es-undeclared.html`,
  `ja-news.html`, `wikipedia-like.html`, `code-editors-real.html` (vendored Monaco and
  CodeMirror 6 bundles), `bank-login.html`, `late-editable.html`.
- **Manual:** GitHub, Wikipedia (en, es and de), El Nuevo Día and BBC Mundo with base `es`, Gmail, a bank's public site, Google Docs (canvas,
  nothing happens), Notion.

## Rollout and migration

Ships with 14, 15 and 17. Defaults: controls off, sensitive sites on. Users who relied on
swaps in buttons get the setting. Changelog: "Kotiko now swaps words only on pages in the languages you
read, and leaves other languages, names and acronyms, code, buttons and menus, and banking and payment pages. You can change the
last two in settings."

## Open questions

1. **Swap inside buttons and menus by default?** Decided by the maintainer: no. Buttons,
   menus and labels stay in the learner's own language (the page's base language,
   [50](../50-ui-localization-and-base-language/SPEC.md)). The setting stays available for
   learners who want it.
2. **Names in German and other noun-capitalising bases.** Without case evidence, a person
   called "Wolf" mid-sentence is swapped unless an honorific is next to it. Recommendation:
   accept for launch; the popover's "Don't swap this word" covers it, and 36's senses can help
   later.
3. **Sensitive-sites list contents.** Recommendation: start small (patterns above plus a few
   dozen widely used banks and payment providers), keep it in the repository, and accept
   additions by pull request; never fetch it remotely.
4. **Pause webmail by default?** (03 B3.) Recommendation: no; compose areas are already
   skipped as editables. Revisit if quoting swapped words into replies is reproduced.

## Future work

- The setting "Swap words in buttons and menus" (off by default, slice 39's `s:display`
  group). The control rules shipped early without it, always on.
- Re-checking a cached control decision when an element's `role`, `tabindex` or class
  changes (today it waits for the next full re-apply); slice 15's attribute observer is the
  place for it.
- A part-of-speech context check for homographs: [36](../36-grammar-and-senses/SPEC.md).
- Learning per-site skip selectors from user "Don't swap here" actions.
- "Reverse mode" for target-language pages, glossing instead of skipping (02 open question 6).
