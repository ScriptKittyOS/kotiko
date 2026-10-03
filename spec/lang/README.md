# Base-language data

The languages learners read in (slice 50 section 5). Kotiko works in every language the
browser can split into words, without a folder per language: `_generic/` holds shared data
for all of them, keyed by language where a rule varies, and only the two Full bases (`en`,
`es`) have folders of their own. The word checks of slice 09 read a word's base from here;
the shared `stopwords.json` (imported from stopwords-iso), `boundaries.json` and
`casing.json`, and `en`/`es` `common.txt`, arrive with slices 50, 14, 16, 17 and 22.

| File | Used for | Fallback |
|---|---|---|
| `stopwords.txt` | Function words a model may not use as forms (the, el): one per line, NFC, lowercase in the language's locale, no duplicates. A stopword is allowed only when the learner typed it and it is the gloss ("el en alemán"). | `_generic` (empty) |
| `stem.json` | Is a form related to the gloss? `kind: "suffix"`: irregulars, then the first matching suffix rule; `strip_accents` for stems only. `kind: "prefix"` (`_generic`): equal to the gloss or sharing its first 3 graphemes. | `_generic` |
| `variants.json` | Spellings of one word (colour, color). | `_generic` (none) |
| `respelling.json` | The pronunciation key (slice 07 section 7): `alphabet`, `sounds`, `targets` notes, `examples`, `prompt_summary` (at most 800 characters). | **none**: a base without its own key gets no pronunciation |
| `welcome.json` | The welcome tab's words in this base (slice 22): `hello` for the "Try hello" chip, the `ask_prefix` it puts in the box, `no_ai_example` ("hola = hello" for `en`), and the two examples in its hints. Never words to learn. | the interface locale's `welcome_*` strings |
| `sentences.json` | Short plain sentences in this base (6 to 12 words) in which the welcome tab previews the learner's word, plus a `fallback` template with `{gloss}`. Text for the preview only, written by speakers. | the word alone, "{gloss} → {native}" |

A base tag resolves to its own folder (`pt-BR`), then its language (`pt`), then `_generic`,
file by file (`spec/fixtures/lang-data.json`). Schemas for each file are in `schema/`.

At launch `en` and `es` are Full bases (every file, a respelling key, at least 15 golden
cases each). Every other base is Basic: it works with the shared `_generic` data, which
checks less and has no respelling key. There is no third level, and no language needs a
folder for the release.

## Improving a language

Most improvements are a few lines in a shared file, not a new folder: an entry in
`_generic/boundaries.json` or `_generic/casing.json` when the default gets a language
wrong, with a test row in slice 14's or 16's tables. Open a folder only for what can't be
shared (a respelling key, welcome words, preview sentences).

## Adding a Full base

1. Create `spec/lang/<base>/` with any of the files above. A native speaker writes or
   reviews every list; say who reviewed it in the pull request.
2. `stem.json`: add a table of form/gloss pairs to `spec/fixtures/stem/<base>.json`
   (related and unrelated, irregular forms included). Both runtimes run it.
3. `respelling.json`: only with a review by native speakers of the base; every example
   must pass the pronunciation checks with the key itself (the tests check this).
4. Add golden cases for the base to `spec/eval/golden.jsonl` (tagged by `base_langs`).
5. `node spec/tools/sync-extension.mjs`, then `npm test` and `cd server && mix test`.

The Spanish key is a proposal until native speakers from Spain, Mexico, the Caribbean and
the Southern Cone have reviewed it (slice 07, open question 5).
