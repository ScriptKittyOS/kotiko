# 49 · Dictionary verification

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P2 (later) |
| **Size** | L (several weeks) |
| **Depends on** | [09-shared-word-spec-and-prompt](../09-shared-word-spec-and-prompt/SPEC.md); uses [11-local-first-mode](../11-local-first-mode/SPEC.md)'s job pipeline and database, [10-llm-client-resilience](../10-llm-client-resilience/SPEC.md)'s error classes |
| **Unblocks** | Better "did you mean" in [36-grammar-and-senses](../36-grammar-and-senses/SPEC.md) |
| **Sources** | [02 summary, G1, G2, G3, section 3 "Verification UX", open question 5](../../docs/research/02-linguistics.md); [04 S20, S23](../../docs/research/04-architecture-release.md) |

## Problem

Mira saves whatever the model returns once `lang`, `native` and `english` are non-blank
(`server/lib/slovo/llm.ex:189-201`); slice 09 adds shape and length checks but can't tell
whether a word is real or means what the model says.

- Free models invent words, especially in low-resource languages, and pick the wrong
  language for phonetic input like "da", "ni" or "sol" ([02 G1, G2](../../docs/research/02-linguistics.md)).
- "kot" can come back as кот (cat) when the learner meant код (code)
  ([02 G3](../../docs/research/02-linguistics.md)).
- When the free quota is used up or the network is down, adding fails entirely; the
  learner can only type every field by hand ([04 S23](../../docs/research/04-architecture-release.md)).

Open dictionaries exist for many languages: CC-CEDICT for Chinese, JMdict for Japanese,
and Wiktionary extracts from kaikki.org for most others.

## Goals

- Optional per-language dictionaries, downloaded on demand, that check every new word and
  mark it verified, different in meaning, or not found.
- When no model is reachable, exact lookups still work from the dictionary.
- Dictionary data stays out of the code repository and is attributed as its licence
  requires.
- No dictionary is ever required; Mira behaves as today without one.
- A check takes under 5 ms and never delays the add flow.

## Non-goals

- Replacing the model for free-text requests ("how do you say dog in japanese").
- Grammar fields and senses: slice [36](../36-grammar-and-senses/SPEC.md); this slice
  feeds it candidates.
- Bundling dictionaries in the extension package.
- Server-side verification at first (future work; the same files can be loaded there).

## User stories

- As a learner adding Mandarin words, I want to know the word Mira saved is a real word
  with that meaning.
- As a learner whose free lookups ran out, I want "perro" to still be added from the
  dictionary.
- As a learner who typed "kot", I want Mira to tell me it read it as кот (cat) and show
  that код means code.

## Specification

### 1. Sources and licences

| Language | Source | Licence | Confidence |
|---|---|---|---|
| Chinese (`zh`, `zh-Hant`) | CC-CEDICT | CC BY-SA 4.0 | High |
| Japanese (`ja`) | JMdict (EDRDG), common entries | EDRDG licence (CC BY-SA 4.0) | High |
| Others | Wiktionary via kaikki.org (Wiktextract), English glosses | CC BY-SA 4.0 and GFDL | High |
| Russian (alternative) | OpenRussian | Unverified; don't use until confirmed | Low |

Share-alike data is kept in a separate repository, `ScriptKittyOS/mira-dictionaries`,
whose build scripts are Apache-2.0 and whose output files carry their source licence.
The code repository never contains dictionary data, so share-alike terms never touch
the code licence ([04 S23](../../docs/research/04-architecture-release.md)).

### 2. Dictionary files

Built by scripts in `mira-dictionaries`, published as GitHub Release assets (which allow
large files; GitHub Pages limits files to 100 MB and sites to about 1 GB):

```json
{
  "format": "mira.dict", "version": 3, "lang": "zh",
  "source": "CC-CEDICT", "sourceDate": "2026-09-15",
  "license": "CC BY-SA 4.0", "attribution": "CC-CEDICT, MDBG, https://…",
  "entries": [["狗", "gǒu", ["dog"], "n"], ["谢谢", "xièxie", ["thanks", "thank you"], "v"]]
}
```

- Gzipped; decompressed in the extension with `DecompressionStream("gzip")` (Chrome 80,
  Firefox 113, Safari 16.4).
- Trimmed to headword, romanization or reading, English glosses (at most 6, each at most
  40 characters) and part of speech. Wiktionary extracts keep the most frequent 50,000
  headwords per language where a frequency list with a compatible licence exists,
  otherwise all headwords with English glosses.
- Target size: at most 5 MB compressed per language. `manifest.json` in the release
  lists each file's language, size, version and SHA-256.

### 3. Download and storage

- Settings, "Offline dictionaries": one row per language the learner has, with size and
  a Download or Remove button. When a language reaches 20 words and has a dictionary, the
  popup offers once: "Download the free Japanese dictionary (4 MB) to check new words and
  add words offline? Download · No thanks".
- The background downloads, checks the SHA-256, decompresses, and writes entries to a
  `dict` store in slice 11's database in chunks of 5,000 per transaction, with progress.
  Key `[lang, native_key]` (slice 07's key function); a second store `dictGloss` maps `[lang, gloss token]` to native
  keys for English-to-native lookups.
- A weekly check of the release manifest offers updates; nothing updates without the
  learner having downloaded that language before.

### 4. Verification

Runs in slice 11's job pipeline right after slice 09's validator, for every word from a
model, bulk add or import, when a dictionary for its language is installed:

| Result | Rule | Shown |
|---|---|---|
| `verified` | `native` found, and `english` or any form matches a gloss after lowercasing and removing simple English inflections (-s, -es, -ed, -ing) | A small check mark with "In CC-CEDICT" in the popover and dashboard |
| `meaning_differs` | `native` found, no gloss matches | The add result says "The dictionary lists замок as: castle; lock. Keep 'lock'?" with Keep and Edit |
| `not_found` | `native` not found | "Not in the dictionary" in the dashboard; no interruption |
| `no_dictionary` | No dictionary for the language | Nothing |

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

- **Native word found** (exactly one entry across installed languages): offer it at once,
  "Found in your offline dictionary: perro = dog · Spanish. Add it?" One tap saves a word
  with `english` = the first gloss, forms = the glosses that are single words or two-word
  phrases, romanization from the dictionary, and `verification.status = "verified"`.
- **English word with a language named** ("dog in japanese"): list up to 5 candidates
  from `dictGloss`; the learner picks one.
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
- [ ] With the mock provider returning quota errors, typing "perro" with the Spanish
      dictionary installed offers the dictionary word, and one tap saves it.
- [ ] A corrupted download (bad SHA-256) is rejected and nothing is written.
- [ ] Removing a dictionary deletes its stores and leaves words and their stored
      verification untouched.
- [ ] The code repository contains no dictionary data (CI check for `mira.dict` files).
- [ ] With no dictionary installed, the add flow is byte-for-byte as without this slice.

## Test plan

- **mira-dictionaries CI**: builds each source, validates the output schema, checks sizes,
  and runs a sample of known entries per language.
- **Unit** (slice 02): verification rules and inflection stripping; the phonetic
  near-match rule; fallback candidate selection; chunked import with a small fixture
  dictionary.
- **Golden set**: slice 09's evaluation set gains expected verification results per
  entry, run against the fixture dictionaries.
- **End-to-end** (Playwright): download from a local server, add with the mock provider in
  normal and quota-exhausted modes.

## Rollout and migration

- Off until the learner downloads a dictionary. Start with Chinese, Japanese, Spanish,
  Russian and Arabic, then add languages as Wiktionary extracts are trimmed and checked.
- Changelog: "Download a free dictionary for a language to check new words and add words
  when you're offline."

## Open questions

1. **Third-party dictionary data at all?** ([02 open question 5](../../docs/research/02-linguistics.md))
   Recommendation: yes, as specified: optional downloads from a separate repository with
   clear attribution.
2. **Dictionary-filled words and share-alike.** A word filled from CC BY-SA glosses may
   carry that licence; does that matter for learners' exports? Recommendation: attribute
   in exports as specified.

## Future work

- Server-side verification for Telegram adds, loading the same files (`DICT_DIR`).
- Example sentences from Tatoeba (CC BY 2.0 FR) in the popover.
- Frequency data to show how common a word is, never to pick words for the learner
  ([DECISIONS](../DECISIONS.md)).
