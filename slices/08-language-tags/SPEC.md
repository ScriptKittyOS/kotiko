# 08 · Language tags

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | S (a day or two) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md) |
| **Unblocks** | [50](../50-ui-localization-and-base-language/SPEC.md) (base tags), [09](../09-shared-word-spec-and-prompt/SPEC.md), [17](../17-casing-and-script-display/SPEC.md), [18](../18-language-precedence-and-mixing/SPEC.md), [36](../36-grammar-and-senses/SPEC.md) |
| **Sources** | [02 E1-E5, section 3 "Language tags"](../../docs/research/02-linguistics.md); [06 F17, F29](../../docs/research/06-adversarial-qa.md); [01 language grouping](../../docs/research/01-language-mixing.md) |

## Problem

The language tag decides which group a word lands in: which checkbox in the popup,
which colour (slice 37), which casing rules (slice 17). Today the tag is whatever the
model said, lightly cleaned.

- `Word.normalize_lang/1` (`server/lib/slovo/word.ex:43-53`) lowercases the language,
  keeps a script subtag and **drops every region**. "zh-TW" becomes Simplified "zh",
  although Taiwan writes Traditional characters; pt-BR and pt-PT merge, so ônibus and
  autocarro end up in one group ([02 E1, E2](../../docs/research/02-linguistics.md)).
- Codes that mean the same language are not unified: "cmn", "rus", "iw", "tl" and "no"
  each start a new group next to "zh", "ru", "he", "fil" ([02 E2](../../docs/research/02-linguistics.md)).
- Legacy tags break: "i-klingon" becomes "i" and "zh-min-nan" becomes "zh". "i" fails the
  format check (`word.ex:21`), and in the bot that crashes with a MatchError and drops
  the rest of the message ([06 F17](../../docs/research/06-adversarial-qa.md), reproduced).
- Nothing checks the tag against the word. A model can return Latin "hvala" tagged `sr`,
  or a romanization in `native` for Russian, and both are saved ([02 E4](../../docs/research/02-linguistics.md)).
- The display name is the first name the model ever gave (`server/lib/slovo/words.ex:70-82`):
  a Cantonese word can be labelled "Mandarin" forever, and an empty name sticks
  ([02 E3](../../docs/research/02-linguistics.md), [06 F29](../../docs/research/06-adversarial-qa.md)).

## Goals

- One canonicalisation function, implemented in Elixir and JavaScript, that produces the
  same tag for the same input, proven by shared fixtures.
- Equivalent codes collapse to one canonical tag; distinct varieties the learner asked for
  stay distinct.
- A word's script is checked against its language; a mismatch is fixed when the script is
  legitimate and rejected when it is not.
- Display names come from the tag, never from the model, in the interface language.
- One function turns any browser or page language tag into a **base tag** (the languages
  the learner reads in, [50](../50-ui-localization-and-base-language/SPEC.md)), in both
  runtimes, with the same fixtures.
- English is an ordinary language: a valid target and a valid base.

## Non-goals

- Per-language variant preferences in settings (always pt-BR for me): slice [36](../36-grammar-and-senses/SPEC.md).
  This slice keeps a region when the model returns one, and provides the hook.
- Casing rules per script: slice [17](../17-casing-and-script-display/SPEC.md), which reads
  the `caseful` flag defined here.
- Interface translation, and choosing and storing base languages: slice
  [50](../50-ui-localization-and-base-language/SPEC.md). This slice provides the tag
  functions and the names data 50 uses.
- Whether a word's target equals its own base language: slice
  [09](../09-shared-word-spec-and-prompt/SPEC.md)'s validator, which knows `base_lang`.

## User stories

- As a learner of Brazilian Portuguese, I want "ônibus" kept apart from European
  Portuguese words, because I asked for Brazilian.
- As a learner of Cantonese, I want my words labelled Cantonese, not Mandarin.
- As a learner of Serbian in both scripts, I want хвала and hvala in clearly named groups.
- As a learner who typed "spasibo", I want Mira to save спасибо, not the Latin spelling.
- As a Spanish reader learning English, I want "dog" accepted as an English word, not
  rejected because English is assumed to be my language.
- As a learner with a Spanish interface, I want my languages called "japonés" and
  "cantonés", not "Japanese" and "Cantonese".
- As a learner in Taiwan, I want my browser's `zh-TW` read as Traditional Chinese, the
  language I read in.

## Specification

### 1. Data files (in `spec/`, slice 09's folder)

- `spec/lang-aliases.json`: generated from CLDR's `supplementalMetadata` aliases
  (language, script, territory) plus IANA's irregular grandfathered tags. Committed, with
  a generator script `spec/tools/gen-lang-data.mjs` that reads the `cldr-core` npm package
  (dev dependency only) so updates are reproducible.
- `spec/languages.json`: one entry per supported primary language. Generated the same
  way, then hand-curated fields:

```json
{
  "sr": { "endonym": "српски", "names": {"en": "Serbian", "es": "serbio"},
          "script": "Cyrl", "scripts": ["Cyrl", "Latn"],
          "caseful": true, "rtl": false, "regions": [], "base_regions": [], "sign": false },
  "pt": { "endonym": "português", "names": {"en": "Portuguese", "es": "portugués"},
          "script": "Latn", "scripts": ["Latn"],
          "caseful": true, "rtl": false, "regions": ["BR", "PT"], "base_regions": ["BR", "PT"], "sign": false },
  "es": { "endonym": "español", "names": {"en": "Spanish", "es": "español"},
          "script": "Latn", "scripts": ["Latn"], "regions": ["ES", "MX", "419"], "base_regions": [], ... },
  "en": { "endonym": "English", "names": {"en": "English", "es": "inglés"},
          "script": "Latn", "scripts": ["Latn"], "regions": ["GB", "US"], "base_regions": [], ... },
  "zh": { "endonym": "中文", "names": {"en": "Chinese", "es": "chino"},
          "script": "Hans", "scripts": ["Hans", "Hant"], ... },
  "ja": { "endonym": "日本語", "names": {"en": "Japanese", "es": "japonés"},
          "script": "Jpan", "scripts": ["Jpan"], "caseful": false, ... }
}
```

`endonym` is the language's name in itself (CLDR), used by the server and in the prompt.
`names` holds the CLDR name in every shipped interface locale ([50](../50-ui-localization-and-base-language/SPEC.md);
`en` and `es` at launch), used by the server, by the bot's `/list <language>` search, and
as the extension's fallback when `Intl.DisplayNames` has no answer. The generator adds a
locale to `names` whenever a new interface locale ships. `regions` are the regions kept
for target words; `base_regions` are the regions kept in base tags (section 6).

`script` is the default (CLDR likely subtags). `scripts` lists the scripts that are
normal for the language. `regions` lists regions kept as distinct groups. Coverage: all
ISO 639-1 languages plus every ISO 639-3 code CLDR has a name for (about 600 entries,
about 80 KB with two name locales, gzip about 16 KB). Both runtimes load the same file: the server at compile
time, the extension from its copy (slice 09).

### 2. Canonicalisation algorithm

`canonical_lang(input) -> {:ok, tag} | {:error, code}`. Steps, in order:

1. Trim; replace `_` with `-`; reject empty, longer than 35 characters, or anything but
   ASCII letters, digits and hyphens: `invalid_lang`.
2. Whole-tag legacy map (grandfathered and common model mistakes): `i-klingon` → `tlh`,
   `zh-min-nan` → `nan`, `zh-yue` → `yue`, `zh-hakka` → `hak`, `art-lojban` → `jbo`,
   `i-navajo` → `nv`, `sgn-*` → the sign language code (then step 9 rejects it),
   `zh-cmn-*` → `zh-*`, `zh-guoyu` → `zh`.
3. Split into subtags; case them: language lowercase, script Title case, region
   uppercase. Drop variants and extensions (`-u-`, `-t-`), keep private use only as below.
4. Language aliases from CLDR: deprecated codes (`iw` → `he`, `in` → `id`, `ji` → `yi`,
   `jw` → `jv`, `mo` → `ro`, `tl` → `fil`, `sh` → `sr-Latn`), three-letter codes with a
   two-letter equivalent (`rus` → `ru`, `deu`/`ger` → `de`, `zho`/`chi` → `zh`), and
   macrolanguage members that mean the standard language (`cmn` → `zh`, `arb` → `ar`,
   `pes` → `fa`, `zsm` → `ms`, `ekk` → `et`, `lvs` → `lv`, `swh` → `sw`). Distinct
   varieties stay: `yue`, `nan`, `wuu`, `hak`, `arz`, `ary`, `apc`, `gsw`.
5. **Chinese regions to scripts**: `zh-TW`, `zh-HK`, `zh-MO` → `zh-Hant`; `zh-CN`,
   `zh-SG` → `zh`. `yue` defaults to Traditional (`yue`, script Hant in `languages.json`);
   `yue-Hans` is kept.
6. **Arabic dialect regions to dialect codes**: `ar-EG` → `arz`, `ar-MA` → `ary`,
   `ar-DZ` → `arq`, `ar-TN` → `aeb`, `ar-LB`/`ar-SY`/`ar-JO`/`ar-PS` → `apc`,
   `ar-IQ` → `acm`, `ar-SA`/`ar-AE`/`ar-KW`/`ar-QA`/`ar-BH` → `afb`. Other regions are dropped (`ar`).
7. **Other regions**: kept only if listed in the language's `regions` (initially `pt`:
   BR, PT; `es`: ES, MX, 419; `fr`: CA; `en`: GB, US). Otherwise dropped. English is a
   target like any other; a Spanish reader learning British English gets `en-GB`.
   `es-AR` and other Latin American regions map to `es-419`.
8. **Default script dropped**: `ru-Cyrl` → `ru`, `ja-Jpan` → `ja`, `zh-Hans` → `zh`,
   `sr-Cyrl` → `sr`. Non-default scripts listed in `scripts` are kept (`sr-Latn`,
   `zh-Hant`, `pa-Arab`, `uz-Cyrl`, `az-Arab`, `ku-Arab` is mapped to `ckb`).
   A script not in `scripts` is dropped and step 10 decides.
9. **Rejections**: sign languages (`sign: true`, e.g. `ase`, `bfi`):
   `sign_language_unsupported`. No spoken language is rejected here; a word whose target
   equals its own `base_lang` is rejected by slice 09, which knows the base.
10. **Unknown languages**: a well-formed two- or three-letter code that isn't in
    `languages.json` is accepted as is, flagged `known: false`, name = the code.
    Private-use tags of the form `x-<2-8 letters>` are accepted for conlangs without a
    code; their name is the subtag capitalised ("x-dothraki" → "Dothraki").

The output is the **group key**: words with the same tag form one language in the popup,
the dashboard and precedence (slice 18). `pt-BR`, `pt-PT` and `pt` are three groups; the
popup shows their names, so this is visible and fixable by editing the word's language
(slice 21).

### 3. Script check against `native`

`check_script(tag, native) -> {:ok, tag} | {:error, :script_mismatch}`.

1. Detect the dominant script of `native`: count code points by Unicode Script property,
   ignoring Common and Inherited (digits, punctuation, combining marks). JavaScript uses
   `\p{Script=...}` with the `u` flag; Elixir uses PCRE script properties (`~r/\p{Cyrillic}/u`,
   verified on Elixir 1.19). Map to ISO 15924: Hiragana, Katakana and Han all count as
   `Jpan` for `ja`; Hangul and Han count as `Kore` for `ko`; Han counts as `Hans` or `Hant`
   per the tag (telling them apart needs a character table; out of scope, the model's
   choice stands).
2. If the dominant script is the tag's script (explicit or default): ok.
3. If it is another script in the language's `scripts`: rewrite the tag to carry it
   (`sr` + Latin "hvala" → `sr-Latn`). Ok.
4. If `native` is Latin and the language's scripts don't include Latin (Russian
   "spasibo"): `script_mismatch`. The model put the romanization in `native`; slice 09
   retries or rejects the word with a clear reason.
5. Any other mismatch: `script_mismatch`.
6. Unknown languages (`known: false`) skip the check.

### 4. Display names

- **Extension**: `new Intl.DisplayNames([uiLocale], {type: "language"}).of(tag)`, where
  `uiLocale` is the interface locale (slice 50's `MiraI18n.locale()`). In English that
  gives "Cantonese", "Traditional Chinese", "Brazilian Portuguese", "Serbian (Latin)"; in
  Spanish "cantonés", "chino tradicional", "portugués de Brasil", "serbio (latino)". On a
  `RangeError` or when it returns the code itself, fall back to `languages.json`'s
  `names[uiLocale]`, then `endonym`, then the code.
- **Server**: `Mira.Lang.name(tag, locale)` uses `names[locale]` (falling back to
  `endonym`), plus region and script names from small per-locale tables in the same file
  (`"regionNames": {"en": {"BR": "Brazil"}, "es": {"BR": "Brasil"}}`, `"scriptNames"`
  likewise), formatted as CLDR does: "Portuguese (Brazil)", "portugués (Brasil)". The bot
  (slice 41) passes the learner's locale. Exact string parity with `Intl` is not
  required; both must be correct.
- The `language` field in API output is the **endonym** ("español", "日本語", "粵語"),
  computed, never stored. It is a neutral label for clients that can't derive names;
  the extension never shows it and always uses `Intl.DisplayNames` in the interface
  language. Migration step 3 below
  drops the column; `Words.keep_language_name/1` and its sticky behaviour
  (`words.ex:70-82`) are deleted.
- The model's `language` field is ignored. The prompt (slice 09) may keep asking for it
  as a self-check: when the model's name disagrees with the tag's name, log it at debug
  level for prompt tuning.

### 5. Where it runs

- Server: `Mira.Lang` replaces `Word.normalize_lang/1` and the `@lang_format` regex
  (`word.ex:21`); the changeset calls `Mira.Lang.canonical/1` and `check_script/2`.
- Extension: `extension/lib/lang.js`, a pure module (slice 02's pattern) used by the
  validator (slice 09), local store (slice 11), import (slice 12) and bulk add (slice 13).
- Telegram `/list <language>` (`server/lib/slovo/bot.ex:127-128`) resolves names through
  `languages.json` names in every shipped locale, endonyms and codes, so "/list
  cantonese", "/list cantonés", "/list 粵語" and "/list yue" all work.

### 6. Base tags

Implements [50](../50-ui-localization-and-base-language/SPEC.md) section 2 in both
runtimes (`Mira.Lang.base_tag/1`, `MiraLang.baseTagOf()` in `extension/lib/lang.js`):

`baseTagOf(input) -> tag | null`:

1. `canonical_lang(input)` (section 2); `null` on error or for a sign language.
2. Chinese: `zh` → `zh-Hans`, `zh-Hant` stays. For every language whose `scripts` lists
   more than one script, a base tag always names its script (`sr` → `sr-Cyrl`,
   `sr-Latn` stays), so the two bases of one language are named symmetrically and
   `spec/lang/<base>/` folders are unambiguous. This is the only place a default script
   is kept.
3. Drop the region unless it is in the language's `base_regions` (at launch only `pt`:
   BR, PT). `es-PR`, `es-419` and `es-ES` give `es`; `en-US` and `en-GB` give `en`;
   `ar-EG` (canonical `arz`) gives `arz`, which is its own base, because a page in
   Egyptian Arabic is written in it.

`sameBase(a, b)`: true when the primary language subtags match and, if both name a
script, the scripts match; a page tagged `zh` (canonical, Simplified) matches base
`zh-Hans`; `pt-BR` and `pt-PT` are the same base. Slices 14, 16 and 32 use `sameBase` to
decide which base index applies to a text's declared or detected language.

`spec/fixtures/base-tags.json` (at least 30 cases) covers every row above plus the
detection examples in slice 50 (`es-PR` → `es`, `pt-BR` → `pt-BR`, `zh-TW` → `zh-Hant`,
`zh-SG` → `zh-Hans`, `iw` → `he`, `ja-JP` → `ja`).

### 7. Migration

A server migration after slice 07's:

1. Re-canonicalise every `lang`. Where two groups merge (`cmn` into `zh`), rows that now
   share a natural key are merged with slice 07's rules and the loser tombstoned.
2. Run the script check; rows that fail are left as they are and listed in the log
   ("3 words may have the wrong language; check them in the dashboard"), never deleted.
3. Drop the `language` column.

Extension: on update, map stored `hiddenLangs` entries through `canonical_lang`, so a
hidden "cmn" stays hidden as "zh". Words in the local cache are refreshed by the next
sync; in local mode (slice 11) the same migration runs over the local store.

## Acceptance criteria

- [ ] `spec/fixtures/lang-tags.json` (at least 80 cases: every alias family, Chinese and
      Arabic regions, kept and dropped regions, default and non-default scripts, legacy
      tags, private use, sign languages, garbage) passes in both Elixir and JavaScript.
- [ ] `zh-TW` → `zh-Hant`; `cmn` → `zh`; `iw` → `he`; `i-klingon` → `tlh`; `pt-BR` stays
      `pt-BR`; `de-AT` → `de`; `ar-EG` → `arz`; `en` and `en-GB` are accepted.
- [ ] `baseTagOf` gives `es` for `es-PR`, `zh-Hant` for `zh-TW`, `zh-Hans` for `zh-CN`,
      `pt-BR` for `pt-BR`, `en` for `en-US`, in both runtimes (`base-tags.json`).
- [ ] `sr` with native "hvala" becomes `sr-Latn`; `ru` with native "spasibo" is rejected
      with `script_mismatch`; `ja` with "ありがとう" passes.
- [ ] No API response or bot message shows a name the model invented; Cantonese words
      show "Cantonese" in an English interface, "cantonés" in a Spanish one, and the
      API's `language` field is "粵語".
- [ ] The bot never crashes on any tag in the fixtures (F17).
- [ ] The migration merges a `cmn` and a `zh` copy of the same word into one, keeps the
      user's note, and logs suspect rows without deleting them.
- [ ] A language hidden as "cmn" before the update is hidden as "zh" after.

## Test plan

- `base-tags.json` run the same way as `lang-tags.json`.
- Shared fixture file run by ExUnit (`Mira.LangTest`) and `node --test`
  (`test/unit/lang.test.mjs`) in slice 09's shared-spec CI job.
- Script detection table: one native word per script in `languages.json` with a non-Latin
  default, plus mixed strings ("COVID-19 вирус", "iPhone 手机").
- Migration test on a fixture database with `cmn`/`zh`, `zh-TW`, `iw` and blank names.
- Generator test: `gen-lang-data.mjs --check` fails CI if the committed files differ from
  what the pinned CLDR version produces.

## Rollout and migration

Ships with or right after slice 07, before slices 09 and 50. Server and extension changes go in
the same release. Changelog: "Language names now come from the language code, so
Cantonese is always Cantonese. Words saved under old codes such as cmn or iw were merged
into their languages."

## Open questions

1. **Which regions to keep at launch?** Recommendation: for targets pt-BR/pt-PT,
   es-ES/es-MX/es-419, fr-CA, en-GB/en-US; for bases only pt-BR/pt-PT (slice 50). Others
   on request, by adding to `regions` or `base_regions`.
2. **Private-use tags for conlangs.** Recommendation: allow `x-` tags; they are rare and
   harmless, and the alternative is a confusing rejection.
3. **Simplified vs Traditional detection.** A character table could catch a Traditional
   word tagged `zh`. Recommendation: defer to slice 49's dictionary data (CC-CEDICT knows
   both forms).

## Future work

- Per-language variant and script preferences passed to the prompt: slice 36.
- More `base_regions` (es-ES vs es-419 everyday words) if learners ask: slice 50's future work.
