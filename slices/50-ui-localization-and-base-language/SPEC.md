# 50 · Base languages and UI localization

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | L (several weeks) |
| **Depends on** | [02-test-harness-and-ci](../02-test-harness-and-ci/SPEC.md), [08-language-tags](../08-language-tags/SPEC.md) (and so [07](../07-word-model-v2/SPEC.md), which builds the record shape in section 3) |
| **Unblocks** | Every slice with user-facing text or base-side language rules, first of all [09](../09-shared-word-spec-and-prompt/SPEC.md), [13](../13-bulk-add/SPEC.md), [14](../14-matcher-engine/SPEC.md), [16](../16-what-not-to-swap/SPEC.md), [17](../17-casing-and-script-display/SPEC.md), [20](../20-popup-redesign/SPEC.md), [21](../21-dashboard/SPEC.md), [22](../22-first-run-onboarding/SPEC.md), [25](../25-plain-language-errors/SPEC.md), [28](../28-privacy-and-store-readiness/SPEC.md), [32](../32-page-coverage-and-celebrations/SPEC.md), [41](../41-telegram-improvements/SPEC.md) (its section 9, localized bot and bases, ships with this slice), [44](../44-docs-site/SPEC.md) |
| **Sources** | [DECISIONS 2026-10-01, "English is not the base language"](../DECISIONS.md); [05 S38, open question 8](../../docs/research/05-learner-ux.md); [02 summary, B3](../../docs/research/02-linguistics.md); [03 B6](../../docs/research/03-browser-extension.md) |

## Problem

Kotiko assumes the person using it reads English, twice over: in its interface, and in the
pages it changes. The maintainer's example: someone in Puerto Rico with an all-Spanish
browser installs Kotiko, asks for their first word, and nothing ever happens on the pages
they read, because Kotiko is waiting for English text that never comes. Their confetti never
fires. Read from the code (not yet reproduced in a browser):

- **The words are English-shaped.** The word record has `english` and `english_forms`
  fields (`server/lib/slovo/word.ex:13-14`), and `Word.forms/1` says "All English strings
  this word should replace on a page" (`word.ex:34-35`).
- **The model is told the learner speaks English.** "You are a vocabulary assistant for an
  English speaker learning many languages at once" (`server/lib/slovo/llm.ex:13`); it is
  asked for "the single most common English equivalent" and `english_forms`
  (`llm.ex:28-29`), and "How do you say X" is defined as "the foreign word for English X"
  (`llm.ex:42`). A learner who types "¿cómo se dice perro en japonés?" gets an English
  gloss, which can never match their Spanish pages.
- **The matcher only finds forms with an English idea of a word.** A regex with ASCII `\b`
  (`extension/content.js`, see [14](../14-matcher-engine/SPEC.md)'s problem section) can't
  split Japanese, Chinese or Thai, where words have no spaces, and knows nothing of
  French elisions (l'eau) or Spanish inverted punctuation (¿perro?).
- **The skip rules planned so far protect English pages only.** Slice 16 skipped every page
  that isn't English, which is exactly the Puerto Rico failure.
- **Every string in the interface is hard-coded English**: the popup
  (`extension/popup.html`, `extension/popup.js`), background errors
  (`extension/background.js`), and the bot's help text (`server/lib/slovo/bot.ex:28`:
  "that word starts replacing its English on web pages").
- **Language names are always English**: `new Intl.DisplayNames(["en"], …)`
  (`extension/popup.js:32`), and the model's English `language` name is stored
  (`llm.ex:25`).

## Goals

- A learner's **base languages** (the languages they read in) are detected from the
  browser at install, confirmed on the welcome tab, editable in settings, and can be more
  than one.
- **English is just another language.** It can be a base, a target, both for different
  learners, or neither. No code path, field name, default or copy treats it as special,
  except where this spec names the exception and why (the manifest's source locale,
  section 8).
- Every slice follows the cross-cutting rules in section 7, and CI checks the ones a
  machine can check.
- **Every user-facing string comes from a translation file** from the first public
  release, in the extension (`_locales`) and the server (the Telegram bot). English and
  Spanish ship at launch, complete and reviewed by a native speaker; other languages
  arrive through community translation.
- Kotiko's interface follows the browser's language, with an override in settings.
- The Puerto Rico case works end to end: Spanish browser, Spanish interface, the first word
  asked in Spanish, Spanish pages swapped, confetti on a Spanish page.

## Non-goals

- Glossing target-language pages in the base language ("reverse mode",
  [02 open question 6](../../docs/research/02-linguistics.md)): future work.
- Translating the docs site's content: [44](../44-docs-site/SPEC.md) follows the plan in
  section 9 here and ships English and Spanish pages for install and privacy at launch.
- Field-level details of the word record: [07](../07-word-model-v2/SPEC.md) implements the
  shape decided in section 3; this slice only fixes the shape.
- Per-language boundary tables themselves: [14](../14-matcher-engine/SPEC.md) owns the
  tokenizer and the tables; this slice owns where base-language data lives (section 5).

## User stories

- As a learner in Puerto Rico whose browser is all Spanish, I want Kotiko in Spanish, my
  first word asked in Spanish, and Japanese words appearing in my Spanish news, so that
  nothing about Kotiko waits on English.
- As a Spanish speaker learning English, I want "dog" to appear where my Spanish pages say
  "perro", the way an English speaker gets "perro" in English pages.
- As a bilingual reader of Spanish and English learning Japanese, I want 犬 to appear in
  both my Spanish pages ("perro") and my English pages ("dog") from a single add.
- As a reader of Japanese learning Korean, I want 개 to appear where my Japanese pages say
  犬, even though Japanese has no spaces between words.
- As a learner whose browser lists a language I'm learning, I want to untick it so Kotiko
  doesn't treat it as one I read.
- As a translator, I want to translate Kotiko in a web tool without learning Git, and see
  where each string appears.
- As a contributor, I want one checklist that tells me what "works in any base language"
  means for the slice I'm building.

## Specification

### 1. Three languages, kept apart

| Term | Meaning | Where it lives |
|---|---|---|
| **Base languages** | The languages the learner reads in. Kotiko swaps words on pages (and `lang` subtrees) in these languages, and stores each word's meaning in one of them. Ordered; the first is the **primary base**. | `s:ui.baseLangs` (section 2) |
| **Target language** | A language the learner is learning. Each word has one (`lang`). | The word record (07) |
| **Interface language** | The language of Kotiko's buttons, messages and listing. Follows the browser unless overridden. | `s:ui.uiLang` (section 8) |

They are independent: a Polish reader with an English interface (because Polish isn't
translated yet) still has base `pl`, gets Polish glosses and Polish pages swapped. A
word's target language never equals its own base language; it may equal another of the
learner's bases (a learner reading Spanish and English can learn English words for their
Spanish pages; see section 3).

### 2. The base-language setting

**Storage.** `s:ui` in `storage.sync` (slice [39](../39-multi-device-sync/SPEC.md)):

```json
{ "uiLang": "auto", "baseLangs": ["es"], "baseLangsConfirmed": true, "baseLangsDetected": ["es"] }
```

The background mirrors `baseLangs` into `storage.local.baseLangs` so content scripts read
it without a sync round trip (slice 11's projection pattern). At most **4** base languages:
each one is an index the content script builds and a gloss the model writes on every add,
and four covers every multilingual reader in the research.

**Base tags.** A base tag is slice [08](../08-language-tags/SPEC.md)'s canonical tag
reduced by `baseTagOf(tag)`:

1. Canonicalise (08): `iw` → `he`, `cmn` → `zh`.
2. Map Chinese regions to scripts: `zh-TW`, `zh-HK`, `zh-MO` → `zh-Hant`; `zh-CN`, `zh-SG`,
   bare `zh` → `zh-Hans`.
3. Keep a region only for the varieties `spec/languages.json` lists under `base_regions`
   (at launch `pt-BR` and `pt-PT`, whose everyday words differ: ônibus / autocarro). Drop
   it otherwise: `es-PR`, `es-419` and `es-ES` all become `es`; `en-US` and `en-GB` become
   `en` (spelling variants are forms of one word, slice 09).
4. Keep a script subtag where the language uses more than one (`sr-Latn`, `sr-Cyrl`).

Two base tags are **the same base** when their primary language subtags match and their
script subtags (if any) match; `pt-BR` and `pt-PT` are the same base for page matching and
differ only in which spelling the model prefers.

**Detection at install** (`runtime.onInstalled` with `reason: "install"`, in the background):

```
candidates = [i18n.getUILanguage(), ...await i18n.getAcceptLanguages()]
             (navigator.languages if getAcceptLanguages is empty or throws)
baseLangsDetected = unique(candidates.map(baseTagOf)).filter(supportedBySegmenter).slice(0, 3)
if empty: [baseTagOf(i18n.getUILanguage())]
s:ui.baseLangs = baseLangsDetected; baseLangsConfirmed = false
```

`supportedBySegmenter(t)` is `Intl.Segmenter.supportedLocalesOf([t]).length > 0`.
Detection preselects at most three so the welcome tab never opens with a long list.
Examples: an all-Spanish browser in Puerto Rico (`es-PR`, `es`) gives `["es"]`; a
Brazilian browser (`pt-BR`, `pt`, `en-US`, `en`) gives `["pt-BR", "en"]`; a Japanese
browser (`ja`, `ja-JP`) gives `["ja"]`; a Taiwanese browser gives `["zh-Hant"]`.

**Confirmation and editing.**

- The welcome tab ([22](../22-first-run-onboarding/SPEC.md)) shows the detected list as
  checked chips before the first word ("Las páginas que lees están en: [✓ español]
  [+ otro]") and sets `baseLangsConfirmed: true` when the learner continues. It never
  asks in a language other than the interface language.
- Dashboard settings ([21](../21-dashboard/SPEC.md)) has "Languages you read in" with the
  same chips, drag to reorder (primary first), add from a searchable list of language
  names in the interface language, remove.
- The popup ([20](../20-popup-redesign/SPEC.md)) never edits base languages; it shows the
  page's state ("This page is in German, which isn't one of your languages. Kotiko leaves it
  alone.") with a link to settings.

**A target that is also a base.** When a learner saves a word whose `lang` is one of their
bases (an es+en reader adding English "dog"), no record is made for that base (section 3)
and a one-time inline note says, in the interface language: "You're learning English, so
Kotiko swaps English words into your Spanish pages. Do you also read English pages?"
[Yes, keep English] [No, stop swapping on English pages]. Nothing blocks the add.

**Adding a base later.** Existing words have no gloss in the new base, so nothing swaps
on those pages yet. Settings offers "Add meanings in Français for your 214 words", which
runs [13](../13-bulk-add/SPEC.md)'s batched lookup under the quota ([10](../10-llm-client-resilience/SPEC.md))
with a review step, and saves nothing until the learner accepts (DECISIONS: full control).
Learners without a model can type meanings by hand in the dashboard.

**Removing a base.** Words with that `base_lang` are kept and stop swapping; the dashboard
groups them under "For pages in Deutsch (not one of your languages now)" with a restore
action. Nothing is deleted.

**Upgrades from a version with English-only words.** On `reason: "update"` from a version
before this slice, run detection, then add `en` to `baseLangs` if any stored word has
`base_lang: "en"` (every pre-v2 word does, slice 07's migration) and it isn't there, so an
existing learner's swaps never silently stop. The dashboard shows a one-time note naming
the detected languages with a link to settings.

### 3. The word record for base languages (decided here, built in 07)

**Shape: one record per (target word, base language).** A word record carries:

| Field | Meaning |
|---|---|
| `lang` | Target language (unchanged). |
| `native` | The target word (unchanged). |
| `base_lang` | Base tag (section 2) of the reader this record is for. |
| `gloss` | The meaning in `base_lang`, replacing `english`. Lowercase unless that base language capitalises it (German nouns: `Hund`; English proper nouns: `Monday`). |
| `forms` | Form objects whose `text` is a surface form **in `base_lang`** that gets swapped (perro, perros; dog, dogs; 犬). Replaces the English-forms meaning. |
| `sense`, `note` | Written in `base_lang`. |
| `pronunciation`, `pronunciation_careful` | How to say `native`, respelled with `base_lang`'s respelling key (07 section 7; null for a base without a key). Base side, like the gloss: a bilingual reader's records each carry their own. |

The natural key becomes `(lang, native_key, sense, base_lang)`. A bilingual es+en reader
who adds 犬 gets two records, `(ja, 犬, "", es)` with gloss "perro" and `(ja, 犬, "", en)`
with gloss "dog", from one model call (section 4).

**Why this shape and not `glosses: {es: {…}, en: {…}}` on one record:**

- **Almost every field on the base side is in the base language.** Gloss, forms, sense and
  note, and the pronunciation respelling, are all written for a reader of one language;
  only `lang`, `native`, `romanization`, `native_vocalized` and target-side grammar (36)
  aren't. A nested map would nest six
  fields, and `sense` (part of the key) would have no single language.
- **It changes nothing structural for the common case.** Most learners have one base. With
  one record per base, slice 07's merge rules, PATCH, tombstones, `seq`, slice 39's sync
  and slice 12's CSV and Anki rows keep their flat shape; `english` is renamed `gloss` and
  one column is added. Nested maps would make every merge, patch and export row nested
  for everyone, to serve the minority.
- **The model already returns a list of word records.** Asking for several bases is just
  more entries in `words`, each validated by the same pipeline with that base's rules.
- **Matching wants it.** The content script builds one index per base from the records
  with that `base_lang`, without reaching into maps.
- **The cost is small and contained.** Target-side fields (`romanization`,
  `native_vocalized`, slice 36's target grammar) are duplicated across a bilingual learner's records, and actions the
  learner thinks of as "on 犬" (pause, delete, review in 35) must apply to the group. The
  dashboard (21) and popover (19) group records by `(lang, native_key)` and act on the
  group by default; the target-side fields are copied on save so the group stays
  consistent.

**Adding with several bases.** By default an add looks up meanings for **all** the
learner's bases except the word's own target language, in one model call (09's request
carries `base_langs`). The add box ([24](../24-add-flow-safety/SPEC.md)) shows "For pages
in: español, English" as chips the learner can narrow before saving.

**English as a target.** Base `es`, typing "dog" or "¿cómo se dice perro en inglés?" saves
`{lang: "en", native: "dog", base_lang: "es", gloss: "perro", forms: ["perro", "perros"]}`.
Kotiko then swaps "dog" into Spanish pages wherever they say "perro".

### 4. The model speaks the learner's language

- The learner's text is passed to the model verbatim, in whatever language they typed
  ("¿cómo se dice perro en japonés?", "犬は韓国語で?", "add sobaka").
- The request names the bases (`base_langs: ["es", "en"]`, with names from
  `Intl.DisplayNames` in each base itself: "español", "English") and asks for one entry
  per base with gloss, forms, sense and note written in that base.
- Free-text replies (Telegram chat, 41) are in the language the learner wrote in, falling
  back to the primary base.
- The instructions in `spec/prompt.md` (09) stay written in English, the language
  instruction-following models are most reliable in; this is invisible to learners, and
  the few-shot examples are chosen per base (`examples.es`, `examples.en`, …). The golden
  set (09) measures every base it covers, so a per-base prompt can replace this if the
  numbers say so (open question 2).
- Validation (stopwords, related forms, "native equals gloss") uses the record's
  `base_lang` data (section 5). The old "reject English translations" rule becomes "reject
  a word whose `native` equals its gloss or one of its forms in that base".

### 5. Base-language data (`spec/lang/`)

Kotiko works in every base language `Intl.Segmenter` supports from the first release,
without a hand-written data pack for each one ([DECISIONS 2026-10-02, "Every language works
without its own pack"](../DECISIONS.md)). What makes that possible is shared, not per
language:

- **The browser**: `Intl.Segmenter` splits words in every language, including Japanese,
  Chinese and Thai, which have no spaces; `toLocaleLowerCase(base)` handles casing such as
  Turkish İ/ı; `Intl.DisplayNames` names languages; `i18n.detectLanguage` detects pages.
- **The model** answers in the learner's base language and writes the forms (09).
- **Shared tables, keyed by language**, for the few rules a generic default gets wrong:
  word boundaries (French l'eau, Spanish ¿perro?, English don't; `_generic/boundaries.json`,
  section 6) and what a capital on the page means (German nouns, English title-case
  headlines; `_generic/casing.json`, 16 and 17). A language needs a line in a shared
  table only when the default visibly fails for it, and a few lines are enough.
- **Bulk open data**: stopword lists for about 60 languages imported in one step from
  [stopwords-iso](https://github.com/stopwords-iso/stopwords-iso) (MIT; recorded in
  `REUSE.toml` and `LICENSES/`) by `spec/tools/import-stopwords.mjs` into one file,
  `_generic/stopwords.json` (`{ "<lang>": [...] }`). Nobody writes these lists by hand.
  They are broad (the Russian list includes белый, "white"), so they only tell languages
  apart (13 and 16 detection, 32 coverage); 09's check that rejects a function word as a
  form uses a base's own hand-reviewed `stopwords.txt` and nothing for other bases.

Read by both runtimes through slice 09's `sync-extension.mjs`:

```
spec/lang/
  README.md            how the data works; how to improve a language; review rules
  _generic/            used for every base, and as the fallback for a missing file
    stopwords.json       stopwords-iso, one list per language (13 and 16 detection,
                         32 coverage; never 09's form check)
    boundaries.json      {"default": {...}, "<lang>": {...}}: tokenizer adjustments for
                         every language, en and es included (14)
    casing.json          {"default": {...}, "<lang>": {...}}: capital conventions for
                         every language, en and es included (16, 17)
    stem.json            "shares its first 3 graphemes with the gloss, or equals it" (09)
    variants.json        none
  en/  es/             the two Full bases, written for launch (and already built)
    stopwords.txt        function words, one per line (09's form check; detection
                         prefers it to the imported list)
    stem.json            suffix rules and irregulars for the related-form check (09)
    variants.json        spelling variants (en: colour/color)
    respelling.json      the pronunciation respelling key: alphabet, how each sound is
                         written with an example word, notes per target language (07 §7;
                         09 validation and prompt, 19 popover, 44 "How to read pronunciations")
    welcome.json         the welcome tab's suggested word ("hola") and example (22)
    sentences.json       preview sentences for the welcome tab and dashboard (22)
    common.txt           about 3,000 common words the preview sentences must cover (22)
```

Each file has a JSON Schema in `spec/lang/schema/`, and `langData(base)` (09) resolves a
file by the full tag's folder, then the primary language's folder, then `_generic`. A keyed
`_generic` file (`stopwords.json`, `boundaries.json`, `casing.json`) answers with its entry
for the full tag, then the primary language, then its `default`, so every consumer still
asks for "the boundaries of base `fr`" and never knows where the answer came from.

Withdrawn from the earlier plan: `detect.json` (16 detects undeclared pages with
`i18n.detectLanguage` plus the stopword share from `stopwords.json`, which covers far more
languages than 40-word lists written by hand), and per-base `no-standalone.json` and
`grammar.json` for bases other than `en` and `es` (P1 slices 32 and 36 use their generic
behavior elsewhere).

A folder for another base is optional. Contributors may add one, with any of the files
above, when a generic rule visibly fails for their language and a native speaker reviews
it; nothing in the release waits on one. Rules that are about the **target** word rather
than the base (German nouns keep their capital, 17) live in the slice that owns them as one
shared table, not in base folders.

`respelling.json` is the one file with no `_generic` fallback: a respelling key only works
in the conventions of one language, so a base without its own key gets no `pronunciation`
(the word still shows its stress mark, romanization and audio; [07](../07-word-model-v2/SPEC.md)
section 7). `en` and `es` have keys at launch, written in 07 section 7; the `es` key is
reviewed by native speakers before release (open question 5). Other bases get keys only
when native speakers of that base contribute and review one (07 open question 7).

**Support levels**, shown in settings next to each base so nobody is surprised:

| Level | Has | Launch bases |
|---|---|---|
| **Full** | its own folder with every per-base file above (including `respelling.json`), at least 15 golden cases (09), a reviewed fixture page (02) | `en`, `es` |
| **Basic** | the shared `_generic` data: Segmenter tokens with the shared boundary and casing tables, the imported stopwords, the 3-grapheme stem rule; no respelling key, no preview sentences | every other language `Intl.Segmenter` supports |

There is no level in between: the planned "Good" level (nine hand-written bases) is
withdrawn. A Basic base still gets its words looked up in its own language, swapped on its
pages (Japanese and Chinese included), detected, and counted for coverage; what it lacks is
the learner respelling and the stricter related-form check. Settings says so plainly:
"Kotiko works in Polski. Its word checks are simpler than for español; help improve them"
(link to `spec/lang/README.md`). The golden set (09) keeps a few cases in Basic bases
(`fr`, `ja` today) so a model change that breaks them is caught.

### 6. Matching in any base language (built in 14 and 16)

- **Tokenizer**: `Intl.Segmenter(base, {granularity: "word"})` for every base, one cached
  instance per base, followed by an adjustment pass from the shared
  `_generic/boundaries.json`, whose entries are keyed by language (join hyphenated
  compounds and English contractions; split French, Italian and Catalan elisions such as
  l'/d'/dell'; strip Spanish ¿ ¡). One table, a few lines per language that needs one, and
  every other language uses the Segmenter's tokens as they are. Slice 14 may keep its regex
  tokenizer as a fast path for a base only if it produces identical tokens on that base's
  fixture corpus.
- **Indexes**: one per base, built from the records with that `base_lang`.
- **Which index applies**: the language of each text subtree (nearest `lang` attribute,
  else the page's declared or detected language, 16). Text in one of the bases uses that
  base's index; text in any other language is left alone.
- **Casing**: `toLocaleLowerCase(base)` for keys where the base needs it (Turkish İ/ı),
  and 17's shared casing table (written once, keyed by language).

### 7. Cross-cutting rules every slice follows

A slice's spec and its code must satisfy these. Reviewers check them; CI checks the
starred ones.

1. **No English-named base concepts.** Code, fields, settings, CSS classes and test names
   use `gloss`, `forms`, `base`, `baseLang`, `base_lang`, never `english`, `en`, `english_forms`
   or "the English" for the base side. ★ `scripts/check-base-neutral.mjs` greps
   `extension/`, `server/lib/` and `spec/` for `english` identifiers, with an allow-list
   for code that reads old data only: the legacy API adapter (07), 09's legacy-key
   repair, 12's version-1 import, 11's upgrade of cached words, and language data under
   `spec/lang/en/`.
2. **Every user-facing string goes through `t()`** (extension) or `Kotiko.I18n.t/3`
   (server). ★ The literal-string check (section 8).
3. **Language names come from `Intl.DisplayNames([uiLocale], {type: "language"})`** on the
   canonical tag, never from the model and never from a hard-coded English list. In the
   prompt and on the server, the base-language name is its endonym.
4. **Never assume spaces between words.** Splitting text into words anywhere (bulk add,
   coverage, density, captions, search) uses slice 14's tokenizer for the text's language.
5. **Per-language rules are data in `spec/lang/`**, never inline lists in code: an entry
   in a shared `_generic` file first, a base's own folder only for what can't be shared
   (section 5).
6. **Base-side behavior keys off the text's language and the word's `base_lang`**: which
   pages are swapped, which index applies, which stopwords, casing and grammar rules run.
7. **Counts are per base.** Coverage, density, stats and celebrations count tokens and
   words per base language and never add a Spanish page's tokens to an English total.
8. **Model output is in the base; model input is the learner's own words.** Replies follow
   the language the learner wrote in.
9. **Errors travel as codes** (25) and become words only at the edge, in the interface
   language.
10. **Locale-aware text handling**: casing with the base's locale, `Intl.Collator` for
    sorting word lists, `Intl.NumberFormat`, `Intl.DateTimeFormat`,
    `Intl.RelativeTimeFormat` and `Intl.PluralRules` in the interface locale. No
    hand-built plurals ("1 words").
11. **Direction**: learner- and model-supplied text is isolated (`dir="auto"`, `<bdi>`);
    layouts use logical CSS properties (06).
12. **Examples come in pairs.** Specs, fixtures and golden cases that show a base-side
    example give at least two bases, English and Spanish by default, plus a base without
    spaces where tokenizing is involved.
13. **Public text ships in English and Spanish**: interface, store listing (28), privacy
    policy (28), error messages (25), the install and privacy docs pages (44), and the
    Telegram bot (41).

### 8. Interface localization

**Files.** `extension/_locales/<locale>/messages.json`, with `__MSG_extName__` and
`__MSG_extDescription__` in the manifest. Keys are descriptive (`popup_add_placeholder`,
`error_quota_daily_title`), and every key has a `description` for translators that says
where it appears and what the placeholders hold. Launch locales: `en` and `es`.

**`default_locale`.** The manifest requires one, used when the browser's language has no
translation. It is `"en"` because English is the source language the strings are written
in and the one most volunteer translators read, not because learners are assumed to read
it. This is the one place English is special, and it only decides the interface language
of an untranslated browser; that browser's base language is still detected and used
(section 1).

**Spanish locale.** `es` is neutral Latin American Spanish (computadora, celular,
ustedes), informal `tú`, matching the voice in [05](../05-brand-identity/SPEC.md); it covers
`es-PR`, `es-419`, `es-MX` and `es-ES` browsers. A Spain-specific `es_ES` can be added by
the community; Chrome and Firefox fall back from `es_ES` to `es` per key. Gender-neutral
wording where Spanish allows it ("Te damos la bienvenida", not "Bienvenido").

**Lookup.** `extension/lib/i18n.js`, a classic script exposing `KotikoI18n.t(key, params)`
in every extension page and the content script (for the popover, 19):

- Uses `i18n.getMessage` by default, so the browser's interface language applies.
- Override: settings "Kotiko's language" (`s:ui.uiLang`, `"auto"` or a shipped locale).
  When set, the helper fetches `_locales/<chosen>/messages.json` once with
  `fetch(runtime.getURL(…))` and looks keys up itself, because `i18n.getMessage` can't
  switch at runtime. Missing keys fall back to `default_locale`.
- **Placeholders** are named (`$COUNT$`), declared in the message's `placeholders`.
- **Plurals**: `chrome.i18n` has none. Keys take CLDR plural suffixes (`words_count_one`,
  `words_count_other`, plus `_zero`, `_two`, `_few`, `_many` where a locale needs them),
  chosen with `Intl.PluralRules(uiLocale).select(n)`.
- **Direction**: `<html dir>` from the predefined `@@bidi_dir` message.
- **Fonts**: slice 06's stacks cover the scripts of every shipped locale.

**Server.** `server/priv/locales/<locale>/messages.json` in the same format (so the same
translation tool handles both), read at compile time by `Kotiko.I18n`, with
`t(key, params, locale)`. Used only by the Telegram bot (41); every HTTP response carries
codes and lets the client choose words.

**CI checks** (slice 02's `i18n` job):

- Every locale file is valid JSON; every key in a locale exists in `en`; placeholders
  match `en` per key; plural keys have every category `Intl.PluralRules` gives for that
  locale.
- ★ `scripts/check-i18n-literals.mjs` fails on user-facing string literals outside `t()` in
  extension HTML (text nodes, `placeholder`, `title`, `aria-label`, `alt`) and JS
  (`textContent`, `innerText`, template literals assigned to those), with an allow-list
  for technical strings.
- **Launch locales complete**: `en` and `es` have 100% of keys; other locales may be
  partial.
- A pseudo-locale `en-XA` (accented, 40% longer, wrapped in brackets) generated at test
  time runs through the Playwright screenshots to catch truncation and hard-coded text.
- An RTL pseudo-locale (`ar-XB` style) checks mirroring.

### 9. Translation workflow

- **Platform**: Hosted Weblate's free plan for open-source projects (it reads WebExtension
  JSON directly). Components: `extension`, `server-bot`, `store-listing` (28's copy as a
  JSON file), and later `docs` (44). Crowdin's open-source plan is the fallback.
- **Source**: `en` strings are edited in the repo by contributors; Weblate opens PRs with
  translations; the `es` locale is maintained in the repo by the team until Weblate is
  set up, then moves to Weblate like the rest.
- **Context**: every key's `description`, plus screenshots from the Playwright run attached
  to Weblate keys (slice 44's screenshot script).
- **Shipping a new locale**: at least 90% translated and reviewed by a second speaker;
  missing keys fall back per key. Launch locales need 100% and a native-speaker review in
  context before the release.
- **String freeze**: one week before a release tag, new `en` keys need a maintainer's
  label so translators can catch up; a release never blocks on non-launch locales.
- **Glossary**: `docs/i18n/glossary.md` fixes Kotiko's core terms per locale (swap, word,
  base language, celebration, Focus, Amount) so the interface, store listing and docs
  agree. Spanish: intercambiar → "cambiar" (not "traducir"), "idiomas que lees", "palabra".
- **Docs site** (44): Starlight's i18n with `en` and `es` for install, privacy and
  troubleshooting at launch; other pages and locales as translators arrive.

### 10. Copy (English and Spanish)

| Key | en | es |
|---|---|---|
| `base_title` | Languages you read in | Idiomas en los que lees |
| `base_help` | Kotiko swaps words on pages in these languages. | Kotiko cambia palabras en páginas escritas en estos idiomas. |
| `base_detected` | From your browser: $LANGS$ | Según tu navegador: $LANGS$ |
| `base_add` | Add a language | Agregar un idioma |
| `base_page_other` | This page is in $LANG$, which isn't one of your languages. Kotiko leaves it alone. | Esta página está en $LANG$, que no es uno de tus idiomas. Kotiko no la toca. |
| `base_target_overlap` | You're learning $LANG$, so Kotiko swaps $LANG$ words into your other pages. Do you also read pages in $LANG$? | Estás aprendiendo $LANG$, así que Kotiko pone palabras en $LANG$ en tus otras páginas. ¿También lees páginas en $LANG$? |
| `base_add_meanings` | Add meanings in $LANG$ for your $COUNT$ words | Agregar significados en $LANG$ para tus $COUNT$ palabras |
| `base_level_basic` | Kotiko works in $LANG$. Its word checks are simpler than for other languages; help improve them. | Kotiko funciona en $LANG$. Sus comprobaciones son más sencillas que en otros idiomas; ayúdanos a mejorarlas. |

## Acceptance criteria

- [ ] **Puerto Rico**: in a browser profile whose UI and accept languages are `es-PR, es`,
      a fresh install opens a Spanish welcome tab with "español" preselected; typing "¿cómo
      se dice perro en japonés?" with a fake model yields a card with gloss "perro"; after
      confirming, the welcome tab celebrates the first word, a Spanish fixture page shows 犬
      in place of "perro", and 32's first-swap celebration (`page:first-swap`) fires on
      that page. No English string appears anywhere in the flow.
- [ ] Detection gives `["es"]` for `es-PR, es`; `["pt-BR", "en"]` for `pt-BR, pt, en-US,
      en`; `["ja"]` for `ja, ja-JP`; `["zh-Hant"]` for `zh-TW`; never more than three.
- [ ] With bases `es` and `en`, one add of 犬 makes two records with glosses "perro" and
      "dog" from one model call; a Spanish page swaps "perro" and an English page swaps
      "dog"; a German page is untouched.
- [ ] With base `es`, adding "dog" saves `lang: "en"`, `base_lang: "es"`, gloss "perro",
      and a Spanish page shows "dog" for "perro"; no record has `lang` equal to its own
      `base_lang`.
- [ ] With base `ja`, a Japanese page "犬が好きです" swaps 犬 for 개 (Korean word with
      gloss 犬), using `Intl.Segmenter`.
- [ ] Removing a base keeps its words and stops their swaps; re-adding it restores them.
- [ ] An upgraded install whose words all have `base_lang: "en"` keeps swapping on English
      pages even when the browser is in Spanish, and shows the one-time note.
- [ ] With the browser in Spanish, every string in the popup, dashboard, welcome tab,
      popover, errors and the Telegram bot (for a Spanish Telegram user) is Spanish;
      the literal-string check passes.
- [ ] The interface-language override switches language without a browser restart.
- [ ] Plural forms are correct in Spanish (1, 2 palabras) and in a pseudo-locale with
      Russian and Arabic plural categories (1, 2, 5, 21; 0, 1, 2, 3, 11, 100).
- [ ] The `en-XA` and RTL pseudo-locale runs show no truncated or unmirrored controls.
- [ ] Language names in every surface appear in the interface language ("japonés").
- [ ] `check-base-neutral.mjs` passes: no `english` identifiers outside the allow-list.
- [ ] Settings shows each base's support level (Full or Basic), and Basic-level bases swap
      their fixture pages with no folder of their own: Polish (`pl`), Japanese (`ja`, no
      spaces) and French (`fr`, elisions from the shared boundary table).
- [ ] `spec/lang/_generic/stopwords.json` is generated by `import-stopwords.mjs` from a
      pinned stopwords-iso release, and its license is recorded in `REUSE.toml`.
- [ ] `spec/lang/en/respelling.json` and `spec/lang/es/respelling.json` validate against
      their schema, the `es` key's review is signed off on the release checklist (30), and
      a base without a key (`fr`) resolves no respelling file from `_generic`.

## Test plan

- **Unit** (slice 02): `baseTagOf` table (every row in section 2 plus `iw`, `cmn`,
  `sr-Latn`, `zh-SG`); detection with stubbed `i18n` APIs; `t()` with fallback, override,
  placeholders and plurals; key, placeholder and plural-category parity across locales.
- **Data**: every `spec/lang/*/` folder validates against `spec/lang/schema/*.json`;
  stopword lists are NFC with no duplicates.
- **End-to-end** (Playwright, slice 02's corpus): browser launched with `--lang=es-PR` and
  `intl.accept_languages` set; fixture pages `es-news.html`, `en-news.html`,
  `ja-news.html`, `de-news.html`, `mixed-lang-subtrees.html`; the Puerto Rico journey above
  with slice 02's fake model; pseudo-locales.
- **Golden set** (09): at least 15 cases per Full base, including Spanish-language
  questions, and the existing Basic-base cases (`fr`, `ja`).
- **Manual**: a native Spanish speaker reviews the `es` locale, store listing and the
  welcome flow in context before release. Native speakers from Spain, Mexico, the
  Caribbean and the Southern Cone review `spec/lang/es/respelling.json` by reading ten
  respellings aloud against the audio (07 open question 5).

## Rollout and migration

- Ships before the first public release, in the same release as slice 07's v2 model.
- Fresh installs: detection, then confirmation on the welcome tab.
- Existing installs (the maintainer's): every existing word gets `base_lang: "en"` in
  slice 07's migration (true: they were all looked up for English pages), and `en` is
  added to `baseLangs` on update (section 2) so nothing stops working.
- Changelog: "Kotiko now works in the language you read. It picks up your browser's
  languages, swaps words on pages in those languages, and speaks to you in English or
  Spanish, with more translations coming from the community." Spanish changelog entries
  ship alongside (30).

## Open questions

1. **Add for all bases by default?** One add for a bilingual reader looks up every base
   (one model call, a few more tokens). Recommendation: yes, all bases, with chips to
   narrow before saving; that is what "a bilingual reader gets swaps on pages in each"
   needs.
2. **Prompt instructions in English, examples per base?** Recommendation: yes for launch;
   the golden set includes Spanish-base questions and decides whether a fully Spanish
   system prompt does better.
3. **Preselect every browser language (up to three) or only the interface language?**
   Recommendation: preselect up to three; browsers list the languages a person reads, and
   the target-overlap note (section 2) handles a learned language in the list.
4. **Spanish register and variety.** Recommendation: neutral Latin American, informal
   `tú`, gender-neutral where possible; welcome an `es_ES` from the community.
5. **Who reviews Spanish before release?** Recommendation: a named native speaker
   (maintainer or contributor) signs off the locale, store listing and welcome flow; the
   release checklist (30) has a box for it. The Spanish respelling key needs more: readers
   from Spain, Mexico, the Caribbean and the Southern Cone, because its letters are read
   differently across them (z, th; [07](../07-word-model-v2/SPEC.md) open question 5);
   until they sign off, the docs (44) mark the key "beta".
6. **Translation platform.** Recommendation: Hosted Weblate (open-source plan), owned by
   the ScriptKittyOS organization.

## Future work

- Reverse mode: gloss target-language words on target-language pages.
- More Full-level bases, only as native speakers contribute and review `spec/lang/` data
  and golden cases; never a launch requirement.
- Respelling keys for more bases (`pt`, `fr`, `de`, then `ja` in katakana), each reviewed
  by native speakers (07 open question 7).
- A fully localized system prompt per base, if the golden set shows it helps.
- Region-aware base varieties beyond Portuguese (es-ES vs es-419 everyday words).
