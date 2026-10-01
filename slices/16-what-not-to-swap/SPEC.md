# 16 · What not to swap

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [14-matcher-engine](../14-matcher-engine/SPEC.md) |
| **Unblocks** | [38-per-site-rules](../38-per-site-rules/SPEC.md), [32](../32-page-coverage-and-celebrations/SPEC.md) (coverage counts only text Mira would consider) |
| **Sources** | [06 F13](../../docs/research/06-adversarial-qa.md), [02 B1-B3, C4, E6](../../docs/research/02-linguistics.md), [03 B1, B2, B5, B6, D5, E4](../../docs/research/03-browser-extension.md), [01 S10, S14](../../docs/research/01-language-mixing.md), [05 S23](../../docs/research/05-learner-ux.md) |

## Problem

Mira swaps nearly everything it can see. Read from the code, and reproduced where noted:

- **Other languages get "translated".** Nothing checks `<html lang>` or element `lang`
  (`extension/content.js:115-132`). On a German page "Hand", "Kind", "also" and "will" are
  swapped; on French pages "on" and "pain"; on Spanish pages "come", "no" and "a". Wikipedia's
  `<i lang="de">` quotes and IPA spans are treated as English (02 E6, 03 B5, B6).
- **Names and acronyms are swapped as words.** The regex is case-insensitive
  (`content.js:51`). "the IT team" becomes "ЭТО team", "Vitamin A." becomes "Vitamin Ein.",
  every "a" in "I think a cat is a pet" becomes "ein" (06 F13, reproduced). "Will Smith",
  "May 2026", "Bill Gates" and "the US army" match too (02 B1, B2).
- **Code editors and controls are swapped.** Only a short tag list is skipped
  (`content.js:7-10`). GitHub's code view, Monaco, CodeMirror and Ace render code in plain
  `div`s and `span`s, and Monaco then misplaces the cursor (03 B1). Buttons, menus and labels
  change under the user's mouse, and voice-control users ("click Delete") no longer match the
  label (03 D5, 05 S23).
- **Editors can capture foreign words.** An element that becomes editable after Mira swapped
  it lets the user type around foreign words that then get saved into their document (03 B2).
- **There is no notion of a sensitive site.** Banking and health pages get swapped like any
  other (03 E4, open question 2).

## Goals

- Mira only swaps English text: the page and each element are judged by declared language,
  with detection as a fallback and a per-site override.
- Precision over coverage for capitalized and short words (02 open question 1): names,
  acronyms and initials are left alone, with every example in this spec passing.
- Code, editors, explicit opt-outs and Mira's own UI are never touched.
- Controls are left in English by default, with a setting to include them.
- A built-in, transparent "sensitive sites" rule that the user can turn off.

## Non-goals

- Boundary rules inside words (contractions, hyphens, URLs): [14](../14-matcher-engine/SPEC.md).
- Per-site language and amount settings and their UI: [38](../38-per-site-rules/SPEC.md);
  this slice defines the signals 38 overrides.
- Wrong-sense swaps ("like" in "looks like rain"): [36](../36-grammar-and-senses/SPEC.md).
- Function-word frequency limits: [31](../31-density-and-amount/SPEC.md).
- Iframes and shadow roots: [42](../42-frames-and-shadow-dom/SPEC.md); the same rules apply there.

## User stories

- As a reader of a German news site who is learning Russian, Mira leaves the German alone.
- As a reader of "the IT team met at the US embassy in May", nothing in that sentence is swapped
  unless I know "team", "met" or "embassy".
- As a developer reading code on GitHub, the code is untouched.
- As someone paying a bill online, the payment form says exactly what the bank wrote.

## Specification

Three layers, cheapest first: page gate, element rules (during the walk), token rules (on each
match). Files: `extension/content/skip.js` (page and element) and `extension/lib/rules.js`
(token, pure and unit-tested).

### 1. Page gate

Mira runs on a document only if all of these pass:

1. URL is `http:`, `https:` or `file:`.
2. Slice 38's `effective()` returns `swap: true`. It already folds in the global switch, the
   tab's "show originals" state (33), the site's own rule and this slice's sensitive-site list
   (section 4), in that order.
3. **Page language** is English or unknown-but-detected-English:

```
declared = primaryTag(html[lang] || html[xml:lang] || meta[http-equiv=content-language])
sample   = up to 2,000 characters of visible text, from main/article if present, else body,
           skipping elements this slice skips; collected with the walker, no layout reads
detected = await i18n.detectLanguage(sample)       // chrome.i18n / browser.i18n, content-script safe
           -> { isReliable, languages: [{ language, percentage }] }

if the site's rule (38) has swap: "on" -> run   // set by "Run here anyway"; skips detection
if declared == "en":
    stop only if detected.isReliable and top language != en and its percentage >= 80
    (templates often leave lang="en" on non-English pages)
    otherwise run
if declared is another language:
    run only if detected.isReliable and en percentage >= 80
    otherwise mixed mode: run only inside elements whose lang starts with "en"
if nothing declared:
    run if en is the top detected language with percentage >= 50
    otherwise mixed mode as above
if detection is unavailable or the sample is under 200 characters:
    stopword heuristic: run if at least 12 % of word tokens are among the 40 most common
    English words (the, and, of, to, a, in, is, it, you, that, ...); recheck once after 5 s
    if the sample was short (single-page app shells)
```

The decision is re-evaluated when the attribute observer from slice 15 sees `lang` change on
`<html>`, and by slice 43 when the page is machine-translated. The gate result and reason are
exposed to the popup ("This page looks German, so Mira is leaving it alone. [Run here
anyway]"), whose UI is slice 20's.

### 2. Element rules

Applied in the walker's `acceptNode`: a match rejects the whole subtree. Each element's result
is cached in a `WeakMap<Element, boolean>` so the check is O(1) after the first visit.

| Rule | Selector or test | Why |
|---|---|---|
| Non-text tags | `script, style, noscript, template, textarea, input, select, option, code, pre, kbd, samp, var, svg, math, canvas, iframe, object, embed, video, audio, title, head` | Existing list (`content.js:7-10`) plus template, var, object, embed and media |
| Editable | `el.isContentEditable`, `[role=textbox]`, `[role=searchbox]`, `[role=combobox]` | Never type around foreign words (03 B2) |
| Code editors and code views | `.monaco-editor, .cm-editor, .CodeMirror, .ace_editor, .react-code-lines, .blob-code, .highlight, [class*="language-"], [role=code]`, plus per-host extras in `extension/data/skip-selectors.json` | Code and editors that measure text (03 B1) |
| Explicit opt-out | `[translate=no]`, `.notranslate`, `[data-mira-skip]`, `[data-slovo-skip]` (legacy) on any element **below** `body` | The site says this text isn't to be translated. Ignored on `html` and `body`, because many React sites set `translate="no"` there only to stop Google Translate crashing them; `<meta name="google" content="notranslate">` is ignored for the same reason |
| Other language | Nearest `[lang]` or `[xml:lang]` ancestor whose primary subtag isn't `en` (empty `lang=""` inherits the page decision) | Quotes, names and IPA in other languages (03 B5) |
| Controls (setting "Swap words in buttons and menus", **off** by default) | `button, summary, label, legend, select, nav, menu, [role=button], [role=link][aria-haspopup], [role=menu], [role=menubar], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], [role=tablist], [role=option], [role=listbox], [role=switch], [role=checkbox], [role=radio], [role=toolbar], [role=navigation]` | Misclicks, voice control and WCAG 2.5.3 Label in Name (03 D5) |
| Sensitive forms | `form` elements containing `input[type=password]` or `[autocomplete^="cc-"]`, `[autocomplete=one-time-code]` | Logins and payments anywhere |
| Mira's own UI | the popover host (19), celebration overlay (32), `mira-w` | Never process ourselves |
| Volatile | elements slice 15 marked volatile | Rewrite budget exceeded |

Links in running text (`a` without a control role) are swapped; links inside `nav` are not,
because `nav` is a control region.

**Editables that appear later.** A capture-phase `focusin` listener on `document` checks the
target: if it is editable or matches the editable row above, call
`MiraEngine.restoreWithin(target)` and add it to the skip cache. The `contenteditable`
attribute isn't observed globally, because observing attributes on the whole subtree is too
costly; focus is the moment that matters.

### 3. Token rules

Applied to each match from slice 14 before precedence (18). Inputs: the match (`surface`,
`shape`, `sentenceStart`, `prevToken`, `nextToken`, gaps), the form's `case` flag
(`any` | `lower` | `exact` | `proper`, default `any`; set by [09](../09-shared-word-spec-and-prompt/SPEC.md)
and editable in [21](../21-dashboard/SPEC.md)), and page evidence (below).

```
filter(m):
  f = m.form.case
  if neverSwap has m.key: drop                                  // user list, below
  if f == "exact": keep only if m.surface == form text exactly (case-sensitive)
  if f == "proper": keep only if m.shape is title or upper; done (17 never copies its capital)
  if m.tokens == 1 and m.surface has one letter: return singleLetter(m)
  switch m.shape:
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
  if m.sentenceStart: defer(m, "start")
  if inTitleRun(m): defer(m, "title")
  drop, and record proper evidence for m.key                    // mid-sentence capital: Rose, Apple, Turkey

nameLike(m): the token right before or after (single space gap, same sentence) is
             title-shaped, not sentence-initial and not the pronoun "I", or is an honorific
             (Mr, Mrs, Ms, Dr, St, Prof, Sir, Lady, Lord, King, Queen, President)
numberNext(m): next token starts with a digit, is a roman numeral of two or more letters
             (II, IV), or is a single uppercase letter other than "I" (Type A, Plan B)

singleLetter(m):
  "a": keep only if surface is lowercase "a", prevToken isn't a mid-sentence title-shaped
       token, nextGap isn't "." or ")" and the match isn't inside "(a)"
  "I": keep only if surface is "I", next gap is a space followed by a lowercase letter, and
       prevToken isn't a mid-sentence title-shaped token (World War I, Henry I; but
       "Can I go" keeps it, because "Can" starts the sentence)
  anything else: drop

  "mid-sentence title-shaped" = prevToken.shape is title and prevToken.sentenceStart is false
```

**Shouting context**: the text node (plus `ctx`) has at least four letter tokens and at least
70 % of its cased letters are uppercase ("THANK YOU FOR READING").

**Title Case run**: at least three tokens of four or more letters in the text node, and at
least 60 % of them title-shaped (headlines, menu labels).

**Page evidence and deferral.** Capitalized matches at a sentence start or in a headline are
ambiguous: "Apple is a company" and "Dog bites man". Mira decides them with what the rest of
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

- [ ] On fixtures in German, French and Spanish (declared and undeclared), nothing is swapped;
      on an English page with `<i lang="de">` quotes, the quotes are untouched.
- [ ] A page declaring `lang="en"` whose text is reliably German is skipped; a page with no
      `lang` whose text is English is swapped.
- [ ] Every row of the worked-examples table passes as a unit test of `rules.js`.
- [ ] Monaco, CodeMirror 6, Ace and a GitHub code-view snapshot are untouched.
- [ ] `translate="no"` on `<html>` does not stop Mira; on a `div`, it does.
- [ ] With the default settings, `button`, `nav` and `[role=menuitem]` text is untouched;
      with "Swap words in buttons and menus" on, it is swapped.
- [ ] Focusing an element that became `contenteditable` after swapping restores English in it
      before the first keystroke.
- [ ] Password and payment forms are untouched on every site.
- [ ] The popup can show why Mira isn't running on the current page.

## Test plan

- **Unit (slice 02):** `rules.js` against the worked-examples table and the boundary table rows
  21-28 in slice 14; evidence and deferral ordering; the language decision table with stubbed
  `detectLanguage` results.
- **jsdom:** element rules over a fixture with each selector; `focusin` restore; legacy
  `data-slovo-skip`.
- **Playwright, slice 02's corpus:** `non-english.html`, `editors.html`, `controls.html`,
  `boundaries.html`. Added by this slice: `non-english-undeclared-fr.html`,
  `mislabelled-lang.html`, `wikipedia-like.html`, `code-editors-real.html` (vendored Monaco and
  CodeMirror 6 bundles), `bank-login.html`, `late-editable.html`.
- **Manual:** GitHub, Wikipedia (en and de), Gmail, a bank's public site, Google Docs (canvas,
  nothing happens), Notion.

## Rollout and migration

Ships with 14, 15 and 17. Defaults: controls off, sensitive sites on. Users who relied on
swaps in buttons get the setting. Changelog: "Mira now leaves alone pages in other languages,
names and acronyms, code, buttons and menus, and banking and payment pages. You can change the
last two in settings."

## Open questions

1. **Swap inside buttons and menus by default?** (README question 5.) Recommendation: off.
   Learning value is small compared with misclicks, voice-control breakage and Label in Name
   failures; the setting is one click away.
2. **Sensitive-sites list contents.** Recommendation: start small (patterns above plus a few
   dozen widely used banks and payment providers), keep it in the repository, and accept
   additions by pull request; never fetch it remotely.
3. **Pause webmail by default?** (03 B3.) Recommendation: no; compose areas are already
   skipped as editables. Revisit if quoting swapped words into replies is reproduced.

## Future work

- A part-of-speech context check for homographs: [36](../36-grammar-and-senses/SPEC.md).
- Learning per-site skip selectors from user "Don't swap here" actions.
- "Reverse mode" for target-language pages, glossing instead of skipping (02 open question 6).
