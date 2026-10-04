# 49 · Dictionary verification

| | |
|---|---|
| **Status** | Proposed; pronunciations from Wiktionary (section 4b) built early, 2026-10-04 |
| **Priority** | P2 (later) |
| **Size** | L (several weeks) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md) (pronunciation fields and the `respell` request of its section 8), [09-shared-word-spec-and-prompt](../09-shared-word-spec-and-prompt/SPEC.md), [50](../50-ui-localization-and-base-language/SPEC.md) (base languages and per-base stem rules); uses [11-local-first-mode](../11-local-first-mode/SPEC.md)'s job pipeline and database, [10-llm-client-resilience](../10-llm-client-resilience/SPEC.md)'s error classes |
| **Unblocks** | Better "did you mean" in [36-grammar-and-senses](../36-grammar-and-senses/SPEC.md); the "Checked" pronunciation label in [19-word-popover](../19-word-popover/SPEC.md) |
| **Sources** | [DECISIONS 2026-10-02, pronunciation](../DECISIONS.md); [02 summary, G1, G2, G3, section 3 "Verification UX", open question 5](../../docs/research/02-linguistics.md); [04 S20, S23](../../docs/research/04-architecture-release.md) |

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
- Pronunciation is written by the model too. Slice 07 gives each word a learner respelling
  with the stress in capitals ("pa-ZHAL-sta"), but a model can put the stress on the wrong
  syllable, and the popover can only say "AI-generated" ([DECISIONS 2026-10-02](../DECISIONS.md)).
  Wiktionary records stress for Russian, Ukrainian and Belarusian headwords and IPA for
  most languages; CC-CEDICT has pinyin with tones; JMdict has kana readings.

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
- Where a dictionary has stress, tone or reading data, the word's pronunciation is checked
  against it, whatever the meaning language, and a model respelling that puts the stress
  elsewhere is regenerated from the dictionary's stress. The popover (19) says which
  pronunciations were checked.
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
- As a learner of Russian, I want the stress Kotiko shows me checked against a dictionary,
  and fixed when the AI got it wrong, and I want to see which words were checked.

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
  "format": "kotiko.dict", "version": 5, "lang": "zh", "gloss_lang": "en",
  "source": "CC-CEDICT", "sourceDate": "2026-09-15",
  "license": "CC BY-SA 4.0", "attribution": "CC-CEDICT, MDBG, https://…",
  "entries": [["狗", "gǒu", ["dog"], "n", null], ["谢谢", "xièxie", ["thanks", "thank you"], "v", null]]
}
```

A Russian file (`ru.en`, from English Wiktionary) carries pronunciation in the fifth slot:

```json
["пожалуйста", null, ["please"], "adv", {"stressed": "пожа́луйста", "ipa": "pɐˈʐaɫəstə"}]
```

- Gzipped; decompressed in the extension with `DecompressionStream("gzip")` (Chrome 80,
  Firefox 113, Safari 16.4).
- One file per pair, named `<lang>.<gloss_lang>.kotiko.dict.gz` (`zh.en`, `ja.es`).
- Trimmed to headword, romanization or reading, glosses in `gloss_lang` (at most 6, each
  at most 40 characters), part of speech, and pronunciation data or null: `stressed` (the
  headword with U+0301, for ru, uk and be) and `ipa` (the first IPA transcription of the
  standard variety). Format version 5 adds this slot; a version 4 file is read with
  pronunciation null. Wiktionary extracts keep the most frequent
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

### 4a. Pronunciation check

Runs in the same job, right after the meaning check, for every record whose `pronunciation`
or `native_vocalized` is set. Stress, tones and readings belong to the target word, so **any
installed pair for `lang`** is used, whatever its meaning language: a Spanish reader with only
`ru.en` still gets Russian stress checked.

What "verified" means depends on the data a dictionary has. Kotiko checks the stress (or
tones, or reading), never the exact letters of the respelling: no dictionary writes
respellings in the learner's conventions.

| Target | Dictionary data | Verified when |
|---|---|---|
| ru, uk, be | `stressed` headword | The stressed vowel of `stressed` is the same vowel, counted in vowel letters, as the U+0301 in `native_vocalized` and as the capitalised syllable of `pronunciation_careful` (or `pronunciation` when there is no careful form), following 07 section 7. |
| Other targets with word stress (es, it, pt, de, en, el, ar, …) | `ipa` with a primary stress mark | The capitalised syllable is at the same position as the IPA's stressed syllable. When the two have different syllable counts, the result is `no_data` rather than a guess. |
| Mandarin | CC-CEDICT pinyin | `romanization` has the dictionary's syllables and tones, and the respelling's tone digits equal them after the standard sandhi rules (third tone before third tone, 不 and 一). |
| Japanese | JMdict reading | `reading` (or the kana `native`) equals a JMdict reading of the headword. Pitch accent is not checked. |

Results, stored as `verification.pronunciation: {status, source, version, checkedAt, stressed}`
(`stressed` is the dictionary's stressed form or pinyin, kept for display):

| Result | Rule | Shown (19) |
|---|---|---|
| `verified` | The data agrees | "Checked in Wiktionary" ("Revisado en Wiktionary"), with the source's name |
| `corrected` | The data disagreed and the regenerated respelling (below) agrees | Same as `verified` |
| `differs` | The data disagrees and no agreeing respelling has been written yet | "AI-generated. Wiktionary stresses it differently." The popover's first line shows the dictionary's stressed form. |
| `no_data` | The word is in no installed dictionary, the entry has no pronunciation data, or the syllable counts can't be compared | "AI-generated", as with no dictionary |

**Regenerating the respelling.** On disagreement, when `pronunciation_source` is `model`,
Kotiko queues one `respell` request (09's prompt, the one 07 section 8 uses) for this word
and base, with the dictionary's stressed form (or pinyin, or reading) in the item's `known`
field, a fixed fact the answer must follow. It runs in the same low-priority, quota-aware queue as 07's refresh job. An answer
that passes 09's validation and agrees with the dictionary is written with
`pronunciation_source: "model"`, and `native_vocalized` is set to the dictionary's stressed
form for every record of the group; the result becomes `corrected`. An answer that still
disagrees, or no model, leaves `differs`; it is retried at most once a day, three times in all.
The learner's own pronunciation (`pronunciation_source: "user"`) is never regenerated or
changed: a disagreement is shown in the dashboard only ("Wiktionary stresses this word on
ЖА"; "Wiktionary marca el acento en ЖА"), and the popover shows no label for it.

Words filled from a dictionary when no model is reachable (section 5) have no respelling
yet; they get one through the same `respell` request when a model is back.

### 4b. Pronunciations from Wiktionary at add time (built early)

Built ahead of the rest of this slice ([DECISIONS 2026-10-04](../DECISIONS.md)) after the
free models were measured getting Russian stress wrong on a quarter of everyday words, and
writing wrong respellings even when given the stress. It replaces section 4a's "regenerating the
respelling" for targets with lexical stress:

- **When**: on every add (the extension for the learner's own AI and "native = meaning", the
  server for its lookups and Telegram), and once in the background for saved words
  (`extension/lib/wiktionary-pass.js`, `Kotiko.WiktionaryPass`: one word every few seconds,
  ten minutes' wait when Wiktionary can't be reached, three tries at most).
- **Which words**: targets whose `stress` is `lexical` in `spec/pronunciation.json`, bases whose
  respelling key has an `ipa` table (`en`, `es`), never a pronunciation the learner wrote.
- **Source**: the word's page from MediaWiki's REST API (`spec/wiktionary.json`), only the
  word sent, `Api-User-Agent`/`User-Agent` naming Kotiko and its contact, one wait when
  Wikimedia asks for a short one. Sections found by the language's CLDR English name (or
  `headings`); one block per Pronunciation heading.
- **Which transcription**: in each block, the first whose stress can be read, passing over
  regional variants `variants` names (Spain's [θ]); the first block's when every block agrees
  on the stress, else the one the model's respelling agrees with, else none.
- **Writing it**: the base's `ipa` table maps sounds to letters (longest match), syllables
  break at IPA's marks or before one consonant (two for an obstruent with a liquid or glide,
  or s with a stop), the stressed syllable in capitals, soft consonants and open-syllable
  vowels as the key says. A transcription with a sound the table doesn't know, or no
  readable stress in a word of two or more syllables, writes nothing.
- **Result**: `pronunciation` from Wiktionary, `pronunciation_careful` null,
  `pronunciation_source: "wiktionary"` (the card says "Checked in Wiktionary"), and for ru,
  uk and be `native_vocalized` with the stress mark. Otherwise the model's stays, labelled
  AI-generated.
- **Both runtimes**: `extension/lib/pronounce.js` and `Kotiko.Pronounce` pass the same cases
  in `spec/fixtures/pronounce/`.

Measured on 40 everyday Russian words: Wiktionary gave a pronunciation for 39, with the stress
right on all 39 (the best free model: 30 of 40).

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
- [ ] With a fixture `ru.en` file, пожалуйста saved with `native_vocalized` пожа́луйста and
      `pronunciation` "pa-ZHAL-sta" (careful "pa-ZHA-lu-sta") is `verified`; the popover
      shows "Checked in Wiktionary".
- [ ] A mock answer "PA-zhal-sta" for the same word is `differs`, shows the dictionary's
      пожа́луйста on the popover's first line, queues one `respell` request, and after the
      mock's agreeing answer is `corrected` with the new respelling and `native_vocalized`
      written to every record of the group.
- [ ] A Spanish reader with only `ru.en` installed gets the same stress check on a base-`es`
      record (meaning `exists`, pronunciation `verified`).
- [ ] A pronunciation the learner edited is never rewritten, even when it `differs`.
- [ ] 你好 with `romanization` "nǐ hǎo" and pronunciation "nee2-how3" is `verified` against
      CC-CEDICT's "ni3 hao3" (third-tone sandhi applied).
- [ ] A word whose IPA syllable count differs from its respelling's is `no_data`, never
      `differs`.

## Test plan

- **kotiko-dictionaries CI**: builds each source, validates the output schema, checks sizes,
  and runs a sample of known entries per language.
- **Unit** (slice 02): verification rules and per-base inflection stripping (English and
  Spanish stem files); pronunciation checks per row of section 4a's table (vowel counting
  for ru, uk, be; IPA syllables; Mandarin sandhi; JMdict readings) and the regeneration
  queue with the mock provider; the phonetic
  near-match rule; fallback candidate selection; chunked import with a small fixture
  dictionary.
- **Golden set**: slice 09's evaluation set gains expected verification results per
  entry, run against the fixture dictionaries, including the pronunciation results for
  09 section 6's Russian, Mandarin and Japanese pronunciation cases.
- **End-to-end** (Playwright): download from a local server, add with the mock provider in
  normal and quota-exhausted modes.

## Rollout and migration

- Off until the learner downloads a dictionary. Start with the pairs the launch base
  languages need: `zh.en`, `ja.en`, `ja.es` (JMdict's Spanish glosses), `es.en`, `ru.en`,
  `ar.en`, and `en.es` and `fr.es` from Spanish Wiktionary if their trimmed size and
  quality pass review; add pairs as Wiktionary extracts are trimmed and checked.
- Version 5 files with pronunciation data are built for `ru.en` first (Wiktionary's Russian
  stress data is the most complete), then `uk.en`, `zh.en` (tones are already in the pinyin)
  and `ja.en`.
- Changelog: "Download a free dictionary for a language to check new words, check where the
  stress falls, and add words when you're offline."

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

4. **Check Russian stress before this slice ships?** Stress is the error learners noticed
   first, and this slice is P2. Recommendation: keep the slice at P2 and the "AI-generated"
   label honest until then, but build the `ru.en` file and the section 4a check for Russian
   first when work starts, since it is the smallest piece that removes the most visible
   errors.

## Future work

- Server-side verification for Telegram adds, loading the same files (`DICT_DIR`).
- Example sentences from Tatoeba (CC BY 2.0 FR) in the popover.
- Frequency data to show how common a word is, never to pick words for the learner
  ([DECISIONS](../DECISIONS.md)).
