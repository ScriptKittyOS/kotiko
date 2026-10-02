# Base-language data

One folder per base tag (slice 50 section 5): the languages learners read in. The word
checks of slice 09 read a word's base from here; the other files slice 50 lists
(`boundaries.json`, `casing.json`, `detect.json`, …) arrive with slices 14, 16, 17 and 22.

| File | Used for | Fallback |
|---|---|---|
| `stopwords.txt` | Function words a model may not use as forms (the, el): one per line, NFC, lowercase in the language's locale, no duplicates. A stopword is allowed only when the learner typed it and it is the gloss ("el en alemán"). | `_generic` (empty) |
| `stem.json` | Is a form related to the gloss? `kind: "suffix"`: irregulars, then the first matching suffix rule; `strip_accents` for stems only. `kind: "prefix"` (`_generic`): equal to the gloss or sharing its first 3 graphemes. | `_generic` |
| `variants.json` | Spellings of one word (colour, color). | `_generic` (none) |
| `respelling.json` | The pronunciation key (slice 07 section 7): `alphabet`, `sounds`, `targets` notes, `examples`, `prompt_summary` (at most 800 characters). | **none**: a base without its own key gets no pronunciation |

A base tag resolves to its own folder (`pt-BR`), then its language (`pt`), then `_generic`,
file by file (`spec/fixtures/lang-data.json`). Schemas for each file are in `schema/`.

At launch `en` and `es` are Full bases (every file, a respelling key, at least 15 golden
cases each). Every other base works with the `_generic` rules, which check less.

## Adding or improving a base

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
