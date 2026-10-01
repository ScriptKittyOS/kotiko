# 37 · Language colors and reading aids

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | M (about a week) |
| **Depends on** | [06-design-system](../06-design-system/SPEC.md), [19-word-popover](../19-word-popover/SPEC.md); uses [15](../15-framework-safe-swapping/SPEC.md)'s element and classes, [17](../17-casing-and-script-display/SPEC.md)'s display function, [36](../36-grammar-and-senses/SPEC.md)'s `reading`, `native_vocalized` and `gender` |
| **Unblocks** | None |
| **Sources** | [05 S31, S37, §3.5](../../docs/research/05-learner-ux.md); [02 F1, F3, F4](../../docs/research/02-linguistics.md); [01 S1, S5](../../docs/research/01-language-mixing.md) |

## Problem

Every swapped word looks the same: one dotted underline in the text color
(`extension/content.css:1-8`). A learner reading Spanish and Mandarin on one page can't tell
at a glance which language a word belongs to; with closely related languages (Spanish and
Portuguese, Russian and Ukrainian) that is part of the learning task
([05 S31](../../docs/research/05-learner-ux.md), [01 S5](../../docs/research/01-language-mixing.md)).
Beginners in non-Latin scripts see 谢谢 or شكرا with no reading in place: the romanization is
only in the tooltip (`content.js:60-63`), so every unknown word needs a hover. Arabic and
Hebrew words appear without vowel marks, and Japanese learners who don't know a kanji yet have
no kana option ([02 F1, F4](../../docs/research/02-linguistics.md)).

## Goals

- Optional per-language colors on pages, from [06 §4.5](../06-design-system/SPEC.md)'s
  validated palette, readable on light and dark sites and never the only cue.
- Optional readings above words with `<ruby>`: romanization, or kana for Japanese, per
  language; never for right-to-left scripts.
- Optional vowel-mark and stress display (Arabic, Hebrew, Persian, Urdu, Russian, Ukrainian)
  and a kana-only mode for Japanese, per language.
- An optional grammatical-gender cue, as an alternative color mode.
- All of it off by default, set per language, and consistent across page, popover, popup and
  dashboard.

## Non-goals

- The data: `reading`, `native_vocalized`, `gender` and romanization come from
  [36](../36-grammar-and-senses/SPEC.md) and [09](../09-shared-word-spec-and-prompt/SPEC.md).
- Missing-glyph detection and fonts: [17](../17-casing-and-script-display/SPEC.md).
- Underline changes for learning state (`mira-missed`, `mira-known`):
  [35](../35-reveal-mode-and-review/SPEC.md); this slice composes with them.

## User stories

- As a learner of Spanish and Portuguese, I want each language's words underlined in its
  own color and style, so that I notice which one I'm reading.
- As a Mandarin beginner, I want pinyin above 谢谢 on the page, so that I can read it without
  hovering.
- As a Japanese learner, I want kana instead of kanji I haven't learned yet.
- As an Arabic learner, I want words with their short vowels.
- As a learner with deuteranopia, I want languages told apart by more than color.

## Specification

### 1. Settings

In dashboard Settings → Reading ([21 §9](../21-dashboard/SPEC.md)), a "Reading aids" table
with one row per language; also reachable from each language card's menu on the dashboard
shelf.

```
Reading aids
  Color languages on pages                        [ ○ ]   (off)
  Also vary the underline style (recommended)     [◉  ]

  Language        Color        Above the word      Spelling
  Español         ● Ember ▾    —                   —
  中文            ● Lapis ▾    [ Pinyin ▾ ]         —
  日本語          ● Lilac ▾    [ Kana ▾ ]           [ Kanji ▾ ]   (Kanji · Kana)
  العربية         ● Plum ▾     not available (RTL) [ Vowel marks ◉ ]
  Русский         ● Rose ▾     [ None ▾ ]           [ Stress marks ○ ]
```

Stored in `prefs.readingAids` (synced settings, [39](../39-multi-device-sync/SPEC.md)):

```js
{ colors: false, varyStyle: true, colorBy: "language",      // or "gender"
  langs: { es: { color: 1 }, zh: { color: 2, above: "romanization" },
           ja: { color: 3, above: "reading", spelling: "native" },
           ar: { color: 4, spelling: "vocalized" }, ru: { color: 5, spelling: "native" } } }
```

Rows appear only for languages the learner has. "Above the word" offers None, Romanization
(any language with romanizations), and Reading (where 36 provides one: kana for Japanese,
Jyutping for Cantonese). "Spelling" appears only for languages where some saved word has
`native_vocalized` (Vowel marks or Stress marks) or `reading` for Japanese (Kanji or Kana).

### 2. Language colors

- Slots come from [06 §4.5](../06-design-system/SPEC.md): 1 Ember #C8641E, 2 Lapis #0E66C8,
  3 Lilac #AF71F2, 4 Plum #904E81, 5 Rose #ED5790, 6 Lagoon #009EAF. Each keeps at least 3:1
  against white and against #121212, because Mira can't control a site's background, and the
  set passes the all-pairs color-vision check.
- **Assignment:** in the order languages were first added (the oldest word's `created_at`),
  stable as new languages arrive. Languages beyond the sixth get no color (the default
  `currentColor` underline) until the learner gives them one. Two languages may share a slot
  only by explicit choice, with the note "Español and Português will look the same."
- **Style variation** (on by default when colors are on): slot 1, 4 dotted; 2, 5 dashed; 3, 6
  double. The pairs that are closest for color-blind readers in 06's check (Rose and Lagoon;
  Lilac and Lapis) always differ in style. Solid is reserved for
  [35](../35-reveal-mode-and-review/SPEC.md)'s `mira-missed`.
- **On pages:** [15](../15-framework-safe-swapping/SPEC.md) adds a class to `mira-w`,
  `mira-c1` … `mira-c6` (classes never carry word data). `content.css`:

```css
mira-w.mira-c1 { text-decoration-color: #C8641E; text-decoration-style: dotted; }
mira-w.mira-c2 { text-decoration-color: #0E66C8; text-decoration-style: dashed; }
mira-w.mira-c3 { text-decoration-color: #AF71F2; text-decoration-style: double; }
/* … c4-c6 … */
mira-w[class*="mira-c"] { text-decoration-thickness: max(1.5px, 0.08em); }
mira-w.mira-flat { text-decoration-style: dotted; }       /* varyStyle off */
mira-w.mira-missed { text-decoration-style: solid; }       /* 35 wins on style, keeps color */
mira-w.mira-known { text-decoration-line: none; }          /* 35 */
@media (forced-colors: active) { mira-w { text-decoration-color: CanvasText; } }
```

- **Elsewhere:** the same color shows as a dot beside the language in the popover
  ([19](../19-word-popover/SPEC.md)), the popup chips ([20](../20-popup-redesign/SPEC.md)), the
  dashboard shelf and rows ([21](../21-dashboard/SPEC.md)), and the coverage line
  ([32](../32-page-coverage-and-celebrations/SPEC.md)). Text stays in text colors; the dot
  carries identity, the name always appears beside it.
- **Gender mode** (`colorBy: "gender"`, offered only when any shown language has words with
  36's `gender`): masculine Ember dotted, feminine Lagoon double, neuter Lilac dashed, common
  Plum dotted (deliberately not the blue-for-male, pink-for-female convention); words without gender keep the default underline. The popover shows the gender
  in words ("masculine"). A learner chooses language colors or gender colors, never both, so
  each color has one meaning.

### 3. Readings above words

- Rendered with `<ruby>` inside the swap element, built by 15 from
  [17](../17-casing-and-script-display/SPEC.md)'s display output:

```html
<mira-w lang="zh-Hans" dir="auto" translate="no" class="notranslate mira-c2 mira-ruby"><ruby>谢谢<rt>xièxie</rt></ruby></mira-w>
```

- `rt` gets `lang` of the romanization (`zh-Latn-pinyin`, `ja-Latn`, or `ja` for kana) so
  screen readers don't read pinyin with a Chinese voice; `rt` is `aria-hidden="true"` unless
  [27](../27-accessibility-baseline/SPEC.md)'s screen-reader mode asks for "Both".
- **Never for right-to-left scripts** (Arabic, Hebrew, Persian, Urdu, Syriac, Thaana): ruby
  over RTL text renders unevenly across browsers and fights bidi isolation
  ([02 F4](../../docs/research/02-linguistics.md)); the option shows "not available".
- Ruby styling: `ruby-position: over`; `rt { font-size: 0.5em; line-height: 1; }`.
  Unlike plain swaps, ruby needs room above the word, so lines containing a reading may grow
  by about half an em. This is the one place Mira accepts a change to the page's line height,
  only while the learner has turned the aid on, and the setting says so: "Lines with a
  reading get a little taller."
- Copy and print: [43](../43-copy-print-translate-coexistence/SPEC.md)'s copy-as-English
  replaces the whole element, ruby included; with copy-as-English off, `rt` text is excluded
  from copied text by 43's copy handler so "谢谢" doesn't paste as "谢谢xièxie".
- Words without the requested reading show without ruby.

### 4. Spelling variants

- **Vowel and stress marks:** when on for a language, [17](../17-casing-and-script-display/SPEC.md)'s
  `display()` receives `native_vocalized` instead of `native` where the word has one
  ("كَتَبَ", "за́мок", "שָׁלוֹם"); words without it show `native`. Matching is on the English
  side, so nothing else changes. Casing still applies after (17).
- **Kana for Japanese:** "Spelling: Kana" displays 36's `reading` instead of `native` (ねこ for
  猫); "Above the word: Reading" with "Spelling: Kanji" gives furigana. Both options together
  (kana above kana) are prevented in the settings.
- The popover always shows the plain `native`, the variant, and the reading together, so the
  learner sees every form.

### 5. Privacy

Colors and classes carry no word data. Ruby puts the romanization or reading into the page's
DOM, next to the native word that is already visible; the privacy policy
([28](../28-privacy-and-store-readiness/SPEC.md)) mentions that reading aids add this text to
pages.

### 6. Performance

Class and ruby decisions are made once per planned swap from a per-language lookup prepared
when settings or words change. Ruby adds two elements per swap; with the aid on, the
per-node budget in 15 rises by under 10 % on a page of 2,000 swaps (measured in CI).

## Acceptance criteria

- [ ] With colors on, a page with Spanish and Mandarin swaps shows Ember dotted and Lapis
      dashed underlines; with style variation off, both are dotted.
- [ ] Each slot color measures at least 3:1 against #FFFFFF and #121212 (CI, 06's script).
- [ ] A `mira-missed` word in a colored language shows a solid underline in its language
      color; a `mira-known` word shows none.
- [ ] With pinyin on, 谢谢 renders with "xièxie" above it; an Arabic word never gets ruby.
- [ ] A Japanese word shows ねこ with "Spelling: Kana" and 猫 with furigana ねこ with
      "Reading above / Kanji".
- [ ] An Arabic word with `native_vocalized` shows the vocalized form when vowel marks are on;
      one without shows the plain form.
- [ ] Copying a sentence with ruby (copy-as-English off) pastes without the `rt` text.
- [ ] The popover, popup chips and dashboard show the same color dot plus the language name.
- [ ] In forced colors, underlines use `CanvasText` and stay visible.

## Test plan

- **Unit:** slot assignment order and stability; settings validation (no kana-above-kana, no
  ruby for RTL); class selection including 35's classes.
- **End-to-end (Playwright):** fixtures with es, pt, zh, ja, ar, ru words on light and dark
  pages; screenshots per mode; copy test; forced-colors emulation; line-height measurement
  with ruby on and off.
- **Manual:** a deuteranope or a simulator check of the six styles side by side; NVDA reading a
  ruby swap in default and "Both" modes.

## Rollout and migration

Off by default; nothing changes for existing learners until they turn an aid on. Slots are
assigned the first time colors are enabled. Changelog: "Optional colors per language, readings
above words, vowel marks and kana."

## Open questions

1. **Colors on by default for learners with two or more languages?** Recommendation: no;
   offer it once in the popup when a second language is added ("Tell your languages apart with
   colors? Turn on"), since colored underlines change how every page looks.
2. **Gender colors.** Recommendation: ship as an alternative mode as specified, behind the
   same switch; drop it if early users find it confusing.

## Future work

- Per-site reading-aid overrides with [38](../38-per-site-rules/SPEC.md).
- Tone colors for Mandarin pinyin (a common learner aid), once tones are reliable in 36's data.
