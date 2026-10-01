# 50 · UI localization and base language

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P2 (later) |
| **Size** | L (several weeks) |
| **Depends on** | [25-plain-language-errors](../25-plain-language-errors/SPEC.md); part B also builds on [08](../08-language-tags/SPEC.md), [09](../09-shared-word-spec-and-prompt/SPEC.md), [14](../14-matcher-engine/SPEC.md), [16](../16-what-not-to-swap/SPEC.md), [17](../17-casing-and-script-display/SPEC.md) |
| **Unblocks** | Localized docs ([44](../44-docs-site/SPEC.md)) and store listings ([28](../28-privacy-and-store-readiness/SPEC.md)) |
| **Sources** | [05 S38, open question 8](../../docs/research/05-learner-ux.md); [02 summary, B3](../../docs/research/02-linguistics.md); [03 B6](../../docs/research/03-browser-extension.md) |

## Problem

Mira assumes its user reads English twice over: in its interface, and in the pages it
changes.

- Every string is hard-coded English: the popup (`extension/popup.html`, `extension/popup.js`),
  background errors (`extension/background.js:10-24`), server errors and the bot's help
  text (`server/lib/slovo/bot.ex:15-32`).
- Language names are always English: `Intl.DisplayNames(["en"], …)` (`extension/popup.js:29`,
  `extension/content.js:26`).
- The prompt is written for "an English speaker" (`server/lib/slovo/llm.ex:10`), the word
  has an `english` field (`server/lib/slovo/word.ex:10`), and the matcher only finds English
  forms (`content.js:34-52`). A Spanish speaker learning English, or learning Japanese
  while reading Spanish news, can't use Mira at all ([05 S38](../../docs/research/05-learner-ux.md)).

## Goals

- **Part A, interface**: every user-facing string in the extension comes from
  `_locales`, language names follow the interface language, a community can translate
  through a web tool, and missing or broken translations are caught in CI.
- **Part B, base language**: a learner can choose the language of the pages they read
  (the base), and Mira swaps words from that language, with English as a possible target.
- English-reading users see no change.

## Non-goals

- Translating the docs site: [44](../44-docs-site/SPEC.md)'s Starlight i18n, after part A.
- Localized Telegram bot text: future work (it needs Gettext on the server and the
  user's Telegram language).
- Glossing target-language pages in the base language ("reverse mode", [02 open question 6](../../docs/research/02-linguistics.md)): future work.

## User stories

- As a Brazilian learner of Japanese, I want Mira's buttons and messages in Portuguese.
- As a Spanish speaker learning English, I want English words to appear in my Spanish
  news, the way an English speaker gets Spanish words in English news.
- As a translator, I want to translate Mira in a web tool without learning Git.

## Specification

### Part A: interface localization

**Files.** `extension/_locales/<locale>/messages.json`, with `"default_locale": "en"` in
the manifest, and `__MSG_extName__` and `__MSG_extDescription__` for the manifest's name
and description. Keys are descriptive (`popup_add_placeholder`, `error_quota_daily_title`),
each with a `description` for translators.

**Lookup.** A small `t(key, params)` helper in every extension page and the content
script:

- Uses `i18n.getMessage` by default, so the browser's UI language applies.
- Optional override, "Interface language" in settings: the helper then loads
  `_locales/<chosen>/messages.json` with `fetch(runtime.getURL(…))` once and looks keys up
  itself, because `i18n.getMessage` can't switch language at runtime. Stored in slice 39's
  `s:ui`.
- **Plurals**: `chrome.i18n` has none. Keys take a plural suffix (`words_count_one`,
  `words_count_other`, plus `_few`, `_many` where a locale needs them), chosen with
  `Intl.PluralRules(locale).select(n)`.
- **Numbers and dates**: `Intl.NumberFormat` and `Intl.DateTimeFormat` in the UI locale;
  no hand-built strings like `ago()` (`popup.js:18-24`); use `Intl.RelativeTimeFormat`.
- **Language names**: `Intl.DisplayNames([uiLocale], {type: "language"})` from the
  canonical code (slice 08), never the model's English name.
- **Direction**: `<html dir>` from the predefined `@@bidi_dir` message; layouts use
  logical CSS properties (`margin-inline-start`) as slice 06 requires.

**Error messages.** Slice 25 defines codes; the extension maps each code to keys here.
Server responses carry codes, so the server never needs the user's locale for the
extension's messages.

**Translation workflow.** Hosted Weblate on its free plan for open-source projects
(it reads the WebExtension JSON format directly; Crowdin's free open-source plan is the
alternative). English is edited in the repo; Weblate opens PRs with translations. A locale
ships once 90% of its strings are translated and reviewed by a second speaker; missing keys
fall back to English per key.

**CI checks** (slice 02):

- Every locale file is valid JSON with the same placeholders as English for each key.
- A script fails the build on user-facing string literals outside `t()` in extension
  HTML and JS (an allow-list for technical strings).
- A pseudo-locale `en-XA`, generated at test time with accented and 40% longer strings,
  runs through the Playwright screenshots (slice 44's script) to catch truncation and
  hard-coded text.
- An RTL run with a generated `ar-XB`-style pseudo-locale checks mirroring.

**First locales**: chosen by who volunteers; Spanish, Portuguese (Brazil), Russian and
Japanese are likely, given who learns languages with tools like this.

### Part B: base language

**Concept.** The base language is the language of the pages Mira changes and of each
word's gloss. Today it is always English. A learner can choose one or more bases
(`s:ui.baseLangs`, default `["en"]`); a word's target language must differ from its base.

**Data.** Slice 07's word gains `base_lang` (BCP 47 per slice 08, default `"en"`). The
existing `english` and forms fields keep their names in storage for compatibility and mean
"the gloss and forms in `base_lang`"; the UI labels them with the base language's name.
Slice 09's schema version increases; older words read as `base_lang: "en"`.

**Adding.** The prompt (slice 09) gains a `{base}` parameter: "an {base} speaker", forms
"in {base}", and the rule against English translations generalises to "reject words whose
language equals the base". With several bases, the add box shows a base chip next to the
language chip (slice 24), defaulting to the most recent. English becomes an ordinary
target: "dog" with base Spanish and target English saves `native: "dog"`,
`english: "perro"` (gloss), `base_lang: "es"`, `lang: "en"`.

**Matching.** Slice 16 skips text whose language isn't English; with this slice it skips
text whose language isn't one of the bases, and slice 14's matcher builds one index per
base and uses the one matching the text's detected or declared language. Tokenizing:

- spaced scripts (Latin, Cyrillic, Greek, Arabic, Hebrew, Devanagari): slice 14's Unicode
  tokenizer, unchanged;
- Chinese, Japanese, Thai, Khmer, Lao bases: `Intl.Segmenter(base, {granularity: "word"})`
  (Chrome 87, Firefox 125, Safari 14.1), with a per-node budget because segmentation is
  slower than the regex tokenizer.

**Casing and stopwords.** Slice 17's casing rules apply to the base side too: never copy
a capital that only the base language uses (German nouns, for example) into the target.
Slice 09 ships a stopword list per supported base (articles, pronouns, copulas), starting
with the bases offered in the UI.

**Packs and onboarding.** Starter packs (slice 23) carry `base_lang`; the welcome page
(slice 22) asks "Which language are the pages you read in?" only when the interface
language isn't English, defaulting to the interface language.

**Phasing.**

1. Part A.
2. Bases with spaced scripts: es, pt, fr, de, it, ru, uk, pl, tr, with prompts checked
   against slice 09's golden set per base.
3. Chinese, Japanese and Thai bases with segmentation, after a performance check on large
   pages.

## Acceptance criteria

- [ ] With the browser in Portuguese and a pt-BR locale shipped, every string in the
      popup, dashboard, welcome page, popover and errors is Portuguese (screenshot review
      plus the literal-string CI check).
- [ ] The interface-language override switches language without a browser restart.
- [ ] Plural forms are correct for Russian (1, 2, 5, 21 words) and Arabic (0, 1, 2, 3, 11, 100).
- [ ] The `en-XA` and RTL pseudo-locale runs show no truncated or unmirrored controls.
- [ ] Language names in the popup appear in the interface language.
- [ ] With base Spanish, a Spanish page swaps "perro" to "dog" and an English page is left
      alone.
- [ ] With bases English and Spanish, each page swaps from its own language.
- [ ] Adding "dog" with base Spanish never saves a word whose `lang` equals `es`.
- [ ] English-base users' words, matching and prompts are unchanged (golden set identical).

## Test plan

- **Unit** (slice 02): `t()` with fallback, override and plurals; key and placeholder
  parity across locales; base-aware validator rules; per-base matcher indexes; segmenter
  path with a time budget.
- **Golden set**: slice 09's evaluation extended with entries per base language.
- **End-to-end** (Playwright): pseudo-locales; fixture pages in Spanish and Japanese with
  `lang` attributes; mixed-base settings.
- **Manual**: native speakers review each shipped locale in context before release.

## Rollout and migration

- Part A ships when English strings are extracted, even with no other locale; translations
  arrive release by release.
- Part B: existing words get `base_lang: "en"` by default; no migration writes are needed.
- Changelog (part A): "Mira speaks your language: the interface follows your browser's
  language, with translations from the community." (part B): "Read in a language other
  than English? Choose it as your base, and Mira swaps words in those pages too."

## Open questions

1. **Is base language in scope this year?** ([05 open question 8](../../docs/research/05-learner-ux.md))
   Recommendation: part A this year; part B phase 2 once part A and slice 14 are stable.
2. **Translation platform.** Recommendation: Hosted Weblate (open-source plan); the
   maintainers need to own the project there.
3. **Rename `english` to `gloss` in storage?** Recommendation: not now; keep the field
   name for compatibility with exports, the server and sync, and rename only in the UI.

## Future work

- Localized Telegram bot with Gettext and Telegram's `language_code`.
- Reverse mode: gloss target-language words on target-language pages.
- Localized docs and store listings.
