# 49 · Dictionary verification

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P2 (later) |
| **Size** | L (several weeks) |
| **Depends on** | [09-shared-word-spec-and-prompt](../09-shared-word-spec-and-prompt/SPEC.md), [50](../50-ui-localization-and-base-language/SPEC.md) (base languages and per-base stem rules); uses [11-local-first-mode](../11-local-first-mode/SPEC.md)'s job pipeline and database, [10-llm-client-resilience](../10-llm-client-resilience/SPEC.md)'s error classes |
| **Unblocks** | Better "did you mean" in [36-grammar-and-senses](../36-grammar-and-senses/SPEC.md) |
| **Sources** | [02 summary, G1, G2, G3, section 3 "Verification UX", open question 5](../../docs/research/02-linguistics.md); [04 S20, S23](../../docs/research/04-architecture-release.md) |

## Problem

Kotiko saves whatever the model returns once `lang`, `native` and `english` are non-blank
(`server/lib/slovo/llm.ex:206`; slice 07 renames `english` to `gloss`, in the learner's base
language); slice 09 adds shape and length checks but can't tell
whether a word is real or means what the model says.

- Free models invent words, especially in low-resource languages, and pick the wrong
  language for phonetic input like "da", "ni" or "sol" ([02 G1, G2](../../docs/research/02-linguistics.md)).
- "kot" can come back as кот (cat) when the learner meant код (code)
  ([02 G3](../../docs/research/02-linguistics.md)).
- When the free quota is used up or the network is down, adding fails entirely; the
  learner can only type every field by hand ([04 S23](../../docs/research/04-architecture-release.md)).

Open dictionaries exist for many languages: CC-CEDICT for Chinese, JMdict for Japanese,
and Wiktionary extracts from kaikki.org for most others. But a dictionary is a **pair**: a
target language and the language its meanings are written in. CC-CEDICT gives Chinese
words English meanings only, so it can confirm that 谢谢 means "thanks" for an English
reader, but not that it means "gracias" for a Spanish reader
([50](../50-ui-localization-and-base-language/SPEC.md)).

## Goals

- Optional dictionaries per (target language, meaning language) pair, downloaded on demand,
  that check every new word and mark it verified, different in meaning, found (when the
  dictionary's meanings are in another language than the word's base), or not found.
- Meanings are only ever compared within one language: a Spanish gloss is checked against
  Spanish dictionary meanings, never against English ones.
- When no model is reachable, exact lookups still work from the dictionary.
- Dictionary data stays out of the code repository and is attributed as its licence
  requires.
- No dictionary is ever required; Kotiko behaves as today without one.
- A check takes under 5 ms and never delays the add flow.

## Non-goals

- Replacing the model for free-text requests ("how do you say dog in japanese").
- Grammar fields and senses: slice [36](../36-grammar-and-senses/SPEC.md); this slice
  feeds it candidates.
- Bundling dictionaries in the extension package.
- Server-side verification at first (future work; the same files can be loaded there).

## User stories

- As a learner adding Mandarin words, I want to know the word Kotiko saved is a real word
  with that meaning.
- As a learner whose free lookups ran out, I want "perro" to still be added from the
  dictionary.
- As a Spanish reader learning Japanese, I want 犬 checked against Spanish meanings where a
  dictionary has them, and at least confirmed as a real word where it only has English ones.
- As a learner who typed "kot", I want Kotiko to tell me it read it as кот (cat) and show
  that код means code.

## Specification

### 1. Sources and licences

| Target language | Meanings in | Source | Licence | Confidence |
|---|---|---|---|---|
| Chinese (`zh`, `zh-Hant`) | `en` only | CC-CEDICT | CC BY-SA 4.0 | High |
| Chinese | `de` | HanDeDict (Chinese-German) | CC BY-SA 2.0 DE | Medium; no longer actively maintained |
| Japanese (`ja`) | `en`, plus `de`, `fr`, `ru`, `nl`, `hu`, `sv`, `es` and others for part of the entries | JMdict (EDRDG), common entries | EDRDG licence (CC BY-SA 4.0) | High for `en`; coverage of other languages varies, medium |
| Most languages | `en` | English Wiktionary via kaikki.org (Wiktextract) | CC BY-SA 4.0 and GFDL | High |
| Many languages | the edition's language (`es`, `fr`, `de`, `ru`, `pt`, …) | Other Wiktionary editions via Wiktextract (for example Spanish Wiktionary for Spanish meanings) | CC BY-SA 4.0 and GFDL | Medium; coverage of foreign headwords is much smaller than in English Wiktionary |
| Various pairs | either side | FreeDict bilingual dictionaries | Varies per dictionary (GPL, CC) | Medium; check each licence |
| Russian (alternative) | `en`, `de` | OpenRussian | Unverified; don't use until confirmed | Low |

Every pair's meaning language is a base tag ([08](../08-language-tags/SPEC.md)'s
`baseTagOf`). The catalogue lists what exists; which pairs are built is decided by who
uses Kotiko (Rollout).

Share-alike data is kept in a separate repository, `ScriptKittyOS/kotiko-dictionaries`,
whose build scripts are Apache-2.0 and whose output files carry their source licence.
The code repository never contains dictionary data, so share-alike terms never touch
the code licence ([04 S23](../../docs/research/04-architecture-release.md)).

### 2. Dictionary files

Built by scripts in `kotiko-dictionaries`, published as GitHub Release assets (which allow
large files; GitHub Pages limits files to 100 MB and sites to about 1 GB):

```json
{
  "format": "kotiko.dict", "version": 4, "lang": "zh", "gloss_lang": "en",
  "source": "CC-CEDICT", "sourceDate": "2026-09-15",
  "license": "CC BY-SA 4.0", "attribution": "CC-CEDICT, MDBG, https://…",
  "entries": [["狗", "gǒu", ["dog"], "n"], ["谢谢", "xièxie", ["thanks", "thank you"], "v"]]
}
```

- Gzipped; decompressed in the extension with `DecompressionStream("gzip")` (Chrome 80,
  Firefox 113, Safari 16.4).
- One file per pair, named `<lang>.<gloss_lang>.kotiko.dict.gz` (`zh.en`, `ja.es`).
- Trimmed to headword, romanization or reading, glosses in `gloss_lang` (at most 6, each
  at most 40 characters) and part of speech. Wiktionary extracts keep the most frequent
  50,000 headwords per language where a frequency list with a compatible licence exists,
  otherwise all headwords with glosses in that language. A multilingual source (JMdict) is
  split into one file per meaning language, keeping only entries that have glosses in it.
- Target size: at most 5 MB compressed per pair. `manifest.json` in the release lists
  each file's language, meaning language, size, version, SHA-256 and entry count.

### 3. Download and storage

- Settings, "Offline dictionaries": one row per language the learner has, listing the pairs
  available for it. Pairs whose meaning language is one of the learner's base languages
  come first; others are marked "Checks that words exist; meanings in English" (in the
  interface language). Each has size and a Download or Remove button. When a language
  reaches 20 words and has a dictionary with meanings in one of the learner's base
  languages, the popup offers once: "Download the free Japanese dictionary (4 MB) to check
  new words and add words offline? Download · No thanks" (Spanish: "¿Descargar el
  diccionario gratuito de japonés (4 MB) para revisar palabras nuevas y agregar palabras
  sin conexión?"). No offer is made for a pair the learner couldn't use for meanings.
- The background downloads, checks the SHA-256, decompresses, and writes entries to a
  `dict` store in slice 11's database in chunks of 5,000 per transaction, with progress.
  Key `[lang, gloss_lang, native_key]` (slice 07's key function); a second store
  `dictGloss` maps `[lang, gloss_lang, gloss token]` to native keys for base-to-target
  lookups ("perro" → 犬). Gloss tokens come from slice 14's tokenizer for `gloss_lang`, so
  Japanese or Chinese meanings without spaces are split correctly.
- A weekly check of the release manifest offers updates; nothing updates without the
  learner having downloaded that language before.

### 4. Verification

Runs in slice 11's job pipeline right after slice 09's validator, for every word record
from a model, bulk add or import, when any dictionary for its `lang` is installed. The
dictionary used is the pair `(lang, base_lang)` if installed, else any installed pair for
`lang` (for the existence check only):

| Result | Rule | Shown |
|---|---|---|
| `verified` | Pair `(lang, base_lang)` installed; `native` found, and `gloss` or any form matches a dictionary gloss after lowercasing with the base's locale and stripping inflections with `spec/lang/<base_lang>/stem.json` (50; English -s/-ed/-ing, Spanish -s/-es, -o/-a, …) | A small check mark with "In CC-CEDICT" ("En CC-CEDICT") in the popover and dashboard |
| `meaning_differs` | Same pair installed; `native` found, no gloss matches | The add result says "The dictionary lists замок as: castle; lock. Keep 'lock'?" (Spanish base: "El diccionario da para замок: castillo; cerradura. ¿Mantener 'cerradura'?") with Keep and Edit |
| `exists` | Only another meaning language installed; `native` found | "In the dictionary (meanings in English)" in the dashboard; the meaning isn't judged |
| `not_found` | `native` not found in any installed pair for `lang` | "Not in the dictionary" in the dashboard; no interruption |
| `no_dictionary` | No dictionary for the language | Nothing |

A bilingual learner's two records for one target word (slice 50) are verified separately,
each against its own base.

The result is stored on the word as `verification: {status, source, version, checkedAt}`,
a field this slice adds to slice 09's schema (optional, so older clients ignore it).
Verification never blocks or reverts a save: the word is saved first, then marked, in
line with slice 11's optimistic flow. Words added before the download are checked in the
background once, at low priority.

**Reading the input.** When the input was Latin-letter phonetic text and the dictionary
holds a close native match with a different meaning (romanization edit distance 1, for
example "kot" → кот/код), the result line adds "I read 'kot' as кот (cat). Did you mean
код (code)?" ([02 G3](../../docs/research/02-linguistics.md)), feeding slice 36's
"did you mean".

### 5. Offline and quota fallback

When slice 10 reports that no model can be reached (offline, daily quota, key rejected),
a queued add whose text is a single word or short phrase is tried against installed
dictionaries before the job waits:

- **Native word found** (exactly one entry across installed pairs whose meaning language
  is one of the learner's bases): offer it at once, "Found in your offline dictionary:
  perro = dog · Spanish. Add it?" for an English reader, or "Encontrado en tu diccionario
  sin conexión: 犬 = perro · japonés. ¿Agregarlo?" for a Spanish reader with the `ja.es`
  pair. One tap saves a record with `base_lang` = the pair's meaning language, `gloss` =
  the first gloss, forms = the glosses that are one or two tokens in that language,
  romanization from the dictionary, and `verification.status = "verified"`. A pair whose
  meanings aren't in a base language the learner reads is never used to fill a word.
- **A base-language word with a language named** ("dog in japanese", "perro en japonés"):
  list up to 5 candidates from `dictGloss` for that base; the learner picks one.
- **Several matches or no match**: the job keeps waiting for the model as today.

Nothing from the dictionary is added without the learner's tap, because glosses are
broader than the curated forms the model produces.

### 6. Attribution

The settings page lists each installed dictionary with its source, date, licence and a
link. Words filled from a dictionary carry `source: "dictionary:<source>"`, and slice
12's exports include an `attributions` list when any exported word has such a source.

## Acceptance criteria

- [ ] Downloading the Chinese dictionary verifies 谢谢 = thanks as `verified` within 5 ms
      of the save, measured in the job log.
- [ ] A fixture word 狗 = "cat" is marked `meaning_differs` and the result line offers the
      dictionary's meaning; the word stays saved until the learner acts.
- [ ] With the mock provider returning quota errors, typing "perro" with the `es.en`
      dictionary installed (English reader) offers the dictionary word, and one tap saves it.
- [ ] A Spanish reader with only `zh.en` (CC-CEDICT) installed adds 谢谢 = "gracias": the
      word is marked `exists`, never `meaning_differs`, and no English meaning is offered
      to fill a Spanish-base word.
- [ ] A Spanish reader with a fixture `ja.es` pair gets 犬 = "perro" marked `verified`, and
      "perro en japonés" offline lists 犬 as a candidate.
- [ ] A corrupted download (bad SHA-256) is rejected and nothing is written.
- [ ] Removing a dictionary deletes its stores and leaves words and their stored
      verification untouched.
- [ ] The code repository contains no dictionary data (CI check for `kotiko.dict` files).
- [ ] With no dictionary installed, the add flow is byte-for-byte as without this slice.

## Test plan

- **kotiko-dictionaries CI**: builds each source, validates the output schema, checks sizes,
  and runs a sample of known entries per language.
- **Unit** (slice 02): verification rules and per-base inflection stripping (English and
  Spanish stem files); the phonetic
  near-match rule; fallback candidate selection; chunked import with a small fixture
  dictionary.
- **Golden set**: slice 09's evaluation set gains expected verification results per
  entry, run against the fixture dictionaries.
- **End-to-end** (Playwright): download from a local server, add with the mock provider in
  normal and quota-exhausted modes.

## Rollout and migration

- Off until the learner downloads a dictionary. Start with the pairs the launch base
  languages need: `zh.en`, `ja.en`, `ja.es` (JMdict's Spanish glosses), `es.en`, `ru.en`,
  `ar.en`, and `en.es` and `fr.es` from Spanish Wiktionary if their trimmed size and
  quality pass review; add pairs as Wiktionary extracts are trimmed and checked.
- Changelog: "Download a free dictionary for a language to check new words and add words
  when you're offline."

## Open questions

1. **Third-party dictionary data at all?** ([02 open question 5](../../docs/research/02-linguistics.md))
   Recommendation: yes, as specified: optional downloads from a separate repository with
   clear attribution.
2. **Spanish-meaning dictionaries are thin.** Outside JMdict and Spanish Wiktionary, few open
   dictionaries give meanings in Spanish, so Spanish readers will mostly get `exists`.
   Recommendation: ship what exists, label it honestly, and accept FreeDict pairs case by
   case after a licence check; never pivot through English to invent Spanish meanings.
3. **Dictionary-filled words and share-alike.** A word filled from CC BY-SA glosses may
   carry that licence; does that matter for learners' exports? Recommendation: attribute
   in exports as specified.

## Future work

- Server-side verification for Telegram adds, loading the same files (`DICT_DIR`).
- Example sentences from Tatoeba (CC BY 2.0 FR) in the popover.
- Frequency data to show how common a word is, never to pick words for the learner
  ([DECISIONS](../DECISIONS.md)).
