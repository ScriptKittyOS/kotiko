# 17 · Casing and script display

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | S (a day or two) |
| **Depends on** | [14-matcher-engine](../14-matcher-engine/SPEC.md), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (`spec/lang/<base>/casing.json`) |
| **Unblocks** | [37-language-colors-and-reading-aids](../37-language-colors-and-reading-aids/SPEC.md) (ruby and vowel marks build on the same display function) |
| **Sources** | [DECISIONS 2026-10-01, "English is not the base language"](../DECISIONS.md); [06 F23](../../docs/research/06-adversarial-qa.md), [02 B3, B4, B5, D6, F3, F4](../../docs/research/02-linguistics.md), [03 D4](../../docs/research/03-browser-extension.md) |

## Problem

`matchCase` copies the page word's capitalization onto every language with locale-blind
`toUpperCase()` (`extension/content.js:54-58`), and assumes the page is English. Tested in
research 02 and 06:

- **Wrong capitals.** Turkish "işçi" becomes "Işçi" and "IŞÇI" instead of "İşçi" and
  "İŞÇİ". Dutch "ijs" becomes "Ijs" instead of "IJs". Greek all caps keeps the tonos
  ("ΛΌΓΟΣ"), which Greek typography drops. German "straße" becomes "STRASSE" (02 B5).
- **Capitals in scripts that don't use them.** Georgian "მადლობა" becomes "Მადლობა" and
  "ᲛᲐᲓᲚᲝᲑᲐ" in Mtavruli, which Georgian prose doesn't use and many fonts lack (06 F23,
  reproduced).
- **Capitals that only the base language uses leak.** On English pages, days, months,
  nationalities, the pronoun "I" and Title Case headlines pass their capitals on: "Monday"
  becomes "Lunes", "I think" becomes "Yo think", "English" becomes "Inglés". On German pages
  every noun is capitalized, so "Der Hund bellt" would become "Der Perro bellt". That teaches
  wrong spelling (02 B3). The reverse matters too: a Spanish reader learning English must see
  "Monday" and "I" with their English capitals on a page that writes "lunes" and "yo".
- **Tall scripts push lines apart.** Swapped CJK, Devanagari or Thai words fall back to fonts
  with larger ascent and descent, so the line grows and the paragraph jumps (02 F3).
  `content.css` sets nothing to prevent it.

Right-to-left isolation already works through `dir="auto"` (`content.js:95`) and stays.

## Goals

- Display text never gains a capital the target language wouldn't write, and never loses one
  it would (German nouns stay capitalized; English "Monday" and "I" stay capitalized on a
  Spanish page), whatever the base language of the page.
- What a capital on the page means is read from the base's `spec/lang/<base>/casing.json`
  (50), never from English assumptions.
- Casing is locale-correct for Turkish, Azerbaijani, Lithuanian, Dutch, Greek and Serbo-Croatian
  digraphs, and a no-op for every caseless script, including Georgian.
- Swapped words never change a line's height, in any script.
- RTL words are isolated from surrounding punctuation in every case.

## Non-goals

- Deciding whether a capitalized match is swapped at all (names, acronyms):
  [16](../16-what-not-to-swap/SPEC.md).
- Lowercasing page text into match keys with the base's locale (Turkish I/ı): [14](../14-matcher-engine/SPEC.md).
- Ruby, romanization above words, vowel marks and per-language colors:
  [37](../37-language-colors-and-reading-aids/SPEC.md).
- Bundling fonts or detecting missing glyphs: Future work.
- Unicode normalization and Romanian comma-below fixes at save time:
  [07](../07-word-model-v2/SPEC.md).

## User stories

- As a Turkish learner, a sentence-initial "Worker" shows "İşçi", with the dotted capital.
- As a Spanish learner reading English, "on Monday" shows "on lunes" in lowercase, and "and I
  think" shows "and yo think".
- As an English learner reading Spanish, "el lunes" shows "el Monday" and "yo creo" shows "I
  creo", with English's own capitals.
- As a German reader learning Spanish, "Der Hund bellt" shows "Der perro bellt", not "Perro".
- As a Georgian learner, words always appear in Mkhedruli, as Georgian is written.
- As a Mandarin learner, a paragraph with 谢谢 keeps exactly the same line spacing.

## Specification

File: `extension/lib/casing.js`, pure. One entry point, called by slice 15 for each planned swap:

```js
MiraCasing.display({
  base,           // base the text was scanned in (50), e.g. "en", "es", "de", "ja"
  surface,        // the page's text, from 14
  shape,          // "lower" | "title" | "upper" | "mixed" | "caseless", from 14
  sentenceStart,  // from 14
  inTitleRun,     // from 16
  shouting,       // from 16
  formCase,       // "any" | "lower" | "exact" | "proper", from the form (09)
  native,         // stored text, NFC (07), possibly replaced by a display variant from 37
  lang,           // canonical tag, e.g. "tr", "sr-Latn", "zh-Hant" (08)
}) -> string
```

### Step 1: what capitalization to carry over

A capital on the page is a signal only when the base language uses it for position or
emphasis, not when the base language capitalizes the word itself. `C` is the base's
`casing.json` (shared with 16; `_generic` when missing: no noun capitals, no capitalized
pronouns, no Title Case headlines).

```
baseOwnsCapital = formCase == "proper"                           // Monday (en), Japan
               or C.capitalized_pronouns has surface             // I (en)
               or (C.nouns_capitalized and not sentenceStart)    // Hund (de), mid-sentence
if shape == "caseless":                                target = "none"   // ja, zh, th, ar pages: no signal
else if shape == "upper" and shouting:                 target = "upper"
else if shape == "upper":                              target = "none"   // 16 lets few through
else if shape == "title" and sentenceStart:            target = "title"
else if shape == "title" and C.title_case_headlines and inTitleRun:
                                                       target = "none"   // English headline style
else if shape == "title" and baseOwnsCapital:          target = "none"   // Monday, I, Hund
else:                                                  target = "none"
```

Spanish, French, Italian and Portuguese write months, days, languages and nationalities in
lowercase, so on those pages a mid-sentence "lunes" is lowercase and gives no capital; the
stored target ("Monday" for an English target) keeps its own capital because of the rule
below.

`"none"` means: show `native` exactly as stored. Mira never lowercases a stored word, so German
"Hund" stays "Hund" mid-sentence and a proper noun stored with a capital keeps it (02 B4).

### Step 2: does the script have case in practice

Determine the script of the first letter of `native` with `\p{Script=…}`, not from the language
tag (a Serbian word may be Latin or Cyrillic).

| Script | Casing applied |
|---|---|
| Latin, Cyrillic, Greek, Armenian, Adlam | Yes |
| Georgian | **No.** Mkhedruli has Mtavruli mappings since Unicode 11, but prose doesn't use them |
| Cherokee, Osage, Deseret, Glagolitic, other historic or rarely-cased scripts | No |
| Every caseless script (Arabic, Hebrew, Han, Kana, Hangul, Devanagari and other Indic, Thai, Lao, Khmer, Myanmar, Ethiopic, Tibetan, and so on) | No: return `native` unchanged |

If the script has no case, return `native` immediately. This explicit early return replaces the
accidental safety of today's code.

### Step 3: locale-correct transforms

```
upper(s, lang):
  if primary(lang) == "el": return greekUpper(s)
  return s.toLocaleUpperCase(localeFor(lang))

title(s, lang):
  g = first grapheme cluster of s (Intl.Segmenter "grapheme"; regex /^\P{M}\p{M}*/u fallback)
  if primary(lang) == "nl" and s starts with "ij": return "IJ" + s.slice(2)
  if g is one of ǆ ǅ Ǆ ǉ ǈ Ǉ ǌ ǋ Ǌ ǳ ǲ Ǳ: return titlecaseDigraph(g) + rest   // ǅ, ǈ, ǋ, ǲ
  return g.toLocaleUpperCase(localeFor(lang)) + s.slice(g.length)

localeFor(lang): the primary subtag for tr, az, lt (their casing differs from root);
                 "und" otherwise, to avoid surprises from other locale data
```

Greek uppercase (`greekUpper`) follows Greek typographic practice:

1. NFD the string.
2. Remove the accents U+0301 (tonos), U+0300 and U+0342 and the breathings U+0313 and U+0314.
   Keep U+0308 (dialytika). U+0345 (ypogegrammeni) is left for `toUpperCase()`, which maps it
   to capital iota.
3. If an accent was removed from a vowel immediately followed by ι or υ, add U+0308 to that ι
   or υ (άι becomes ΑΪ), so the letters aren't read as a diphthong.
4. `toUpperCase()`, then NFC.

Title case in Greek keeps the tonos on the initial capital ("Όμορφος"), which plain
`toLocaleUpperCase` on the first grapheme already does.

German "ß" uppercases to "SS" (the standard default; capital ẞ is allowed but missing from many
fonts). This only happens in shouting context, which is rare.

### Examples

| Page surface (base) | Context | Native (lang) | Display |
|---|---|---|---|
| worker | mid-sentence | işçi (tr) | işçi |
| Worker | sentence start | işçi (tr) | İşçi |
| WORKERS | shouting | işçi (tr) | İŞÇİ |
| Ice | sentence start | ijs (nl) | IJs |
| Thanks | sentence start | მადლობა (ka) | მადლობა |
| THANKS | shouting | მადლობა (ka) | მადლობა |
| WORD | shouting | λόγος (el) | ΛΟΓΟΣ |
| Word | sentence start | λόγος (el) | Λόγος |
| Monday | mid-sentence, form `proper` | lunes (es) | lunes |
| Monday | sentence start, form `proper` | lunes (es) | Lunes |
| I | mid-sentence ("and I think") | yo (es) | yo |
| I | sentence start ("I think") | yo (es) | Yo |
| Dog | headline Title Case run, not first word | perro (es) | perro |
| dog | mid-sentence | Hund (de) | Hund |
| Thanks | sentence start | 谢谢 (zh-Hans) | 谢谢 |
| Thanks | sentence start | شكرا (ar) | شكرا |
| Jungle | sentence start | ǆungla (hr, stored with the single code point U+01C6) | ǅungla |
| STREET | shouting | straße (de) | STRASSE |
| lunes (es) | mid-sentence ("el lunes") | Monday (en) | Monday |
| yo (es) | mid-sentence ("y yo creo") | I (en) | I |
| Perro (es) | sentence start | dog (en) | Dog |
| Inglés (es, sentence start) | sentence start | English (en) | English |
| Hund (de) | mid-sentence ("Der Hund bellt") | perro (es) | perro |
| Hund (de) | sentence start ("Hund und Katze") | perro (es) | Perro |
| İşçi (tr base) | sentence start | worker (en) | Worker |
| 犬 (ja) | start of a Japanese sentence | dog (en) | dog |
| 狗 (zh-Hans) | any | 犬 (ja) | 犬 |

### Right-to-left isolation

The swap element carries `dir="auto"` and `unicode-bidi: isolate` (slice 15's CSS), so an Arabic
or Hebrew word next to the page's punctuation keeps the punctuation on the correct side: on an
English page "thanks!" becomes "شكرا!" with the "!" after the word in visual order, and
"(thanks)" keeps its parentheses. The same isolation keeps a left-to-right word in order on a
right-to-left base page: for a reader of Arabic learning Spanish, "(شكرا)" becomes "(gracias)"
with the parentheses mirrored as the Arabic text expects. Mira never inserts bidi control characters into the page. A possessive `'s` left
outside the swap (slice 14) stays outside the isolate. Persian zero-width non-joiners in
`native` are preserved: Mira applies no transform to caseless scripts and NFC keeps U+200C.

### Line height and fonts

- `mira-w { line-height: 1; }` (slice 15's stylesheet). An inline box whose `line-height` is a
  number is sized from its first available font, which is the page's inherited font, so glyphs
  drawn from a taller fallback font (Noto CJK, Devanagari, Thai, Myanmar, Tibetan) don't
  enlarge the line box. A value of 1 is never larger than the parent's line height, so it can't
  add space either; the parent's strut keeps the original spacing.
- Mira never sets `font-family`, `font-size` or `font-weight` on swaps; the site's typography
  stays and the browser's fallback chooses glyphs by `lang`.
- `lang` is the full canonical tag (`zh-Hant`, `ja`, `ko`, `sr-Latn`) so browsers pick the right
  Han glyph shapes and hyphenation (03 D4, 02 F3).
- Vertical alignment stays `baseline`; no padding or border on the element.

Missing fonts (tofu) are documented in the FAQ of [44](../44-docs-site/SPEC.md) with the Noto
font to install per script.

## Acceptance criteria

- [ ] Every row of the examples table passes as a unit test of `casing.js`, including the
      Spanish, German, Turkish and Japanese base rows.
- [ ] No code path in `casing.js` names a language other than through `casing.json`, Greek,
      Dutch and the digraphs (target-side transforms in step 3).
- [ ] No code path lowercases `native`.
- [ ] For every script listed as caseless, `display()` returns `native` unchanged for all shapes
      (property test over sample words in 30 scripts).
- [ ] Georgian never produces a code point in U+1C90-U+1CBF (Mtavruli).
- [ ] In Chromium and Firefox, a paragraph with swapped Chinese, Japanese, Devanagari, Thai and
      Myanmar words has the same height (within 1 px) as before swapping, with `line-height:
      normal` and with `line-height: 1.6` on the paragraph.
- [ ] An Arabic and a Hebrew swap followed by "!" or inside parentheses render with punctuation
      on the correct side (screenshot test).

## Test plan

- **Unit (slice 02):** examples table; every launch `casing.json` against its schema; caseless property test; Greek accent removal and
  dialytika insertion; Dutch IJ; Serbo-Croatian digraph code points; `localeFor` choices.
- **Playwright:** a new `scripts-line-height.html` with the CI image's Noto fonts installed,
  measuring `getBoundingClientRect().height` before and after; slice 02's `rtl.html` extended
  with punctuation cases and screenshots in Chromium and Firefox.
- **Manual:** a Georgian, Turkish and Greek word list on an English news page; an English word
  list on a Spanish and a German news page (Monday, I, nouns); macOS and Windows font
  fallback.

## Rollout and migration

No data changes. Ships with 14, 15 and 16. Changelog: "Swapped words now follow each language's
own capitalization: no more 'Lunes' for Monday or 'monday' for lunes, correct Turkish İ, and Georgian always in its
everyday letters. Swapped words no longer change line spacing."

## Open questions

1. **German shouting: "SS" or "ẞ"?** Recommendation: "SS", the standard default with universal
   font support.

## Future work

- Missing-glyph detection with a canvas width check and a one-time hint naming the Noto font.
- Optional bundled per-script Noto subsets as extension resources (02 open question 8).
- Title Case for headlines in languages that use it (rare outside English), if users ask.
