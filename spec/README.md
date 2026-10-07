# The shared word spec

Everything that decides what counts as a good word, as plain files both runtimes read:
the server (`Kotiko.Spec`, compiled into the release) and the extension (its copy in
`extension/spec/`). Slices [08](../slices/08-language-tags/SPEC.md) and
[09](../slices/09-shared-word-spec-and-prompt/SPEC.md) define it.

| File | What it is |
|---|---|
| `VERSION` | The spec version (SemVer). A prompt change bumps the minor version. |
| `word.schema.json` | JSON Schema of the word record (slice 07). |
| `export.schema.json` | Slice 12: JSON Schema of the backup file both runtimes write and read (its words are `word.schema.json` records). |
| `model-output.schema.json` | What the lookup prompt asks the model for. Lenient: the extractor repairs common deviations. |
| `respell-output.schema.json` | What the respell prompt asks the model for. |
| `prompt.md` | The prompt, in fenced `prompt <name>` sections, with `{{placeholders}}`. |
| `rules.json` | Every number the validator uses (caps, minimum lengths), and the content scripts' `max_page_*` caps (how many words one page view may show; security review A-01), which `sync-extension.mjs` also writes to `extension/spec/page.js`. |
| `pronunciation.json` | Per target language: romanization scheme, stress kind, tone range, vocalization marks. |
| `models.json` | Slice 10: the free models to prefer for lookups and respellings (from `eval/RESULTS.md`), the ones to deny, the shipped fallback list, and the lookup client's budgets (deadlines, attempts, health, quota reserve, cache). |
| `providers.json` | Slice 11: the lookup provider presets (OpenRouter by default, OpenAI, Anthropic, Google Gemini, Groq, Ollama, LM Studio, Custom): base URL, whether a key is needed, JSON mode, extra headers, where the model list comes from, and the field for the output cap (`maxTokensField`, which the server also uses when `LLM_URL` is on a preset's host). Never a key. |
| `languages.json`, `lang-aliases.json` | Language tags (slice 08), generated from Unicode CLDR. |
| `lang/` | Per base language: stopwords, stem rules, spelling variants, the respelling key. See `lang/README.md`. |
| `fixtures/` | Shared fixtures both runtimes must pass (below). |
| `eval/` | The golden evaluation set and its runner. See `eval/README.md`. |
| `tools/` | `gen-lang-data.mjs` (CLDR data), `sync-extension.mjs` (the extension's copy), `fixture-results.mjs` (the full-output snapshot). |

`fixtures/export/` (slice 12) holds backups both runtimes restore: every script with
pronunciations from both sources, a version 1 backup, a bilingual one, one from a newer
Kotiko and one with invalid words, plus the CSV and Anki files the extension writes from
the first. `fixtures/merge.json` (slice 07's merge rules) is checked by both runtimes: `Kotiko.WordMerge` and the
extension's `lib/word-merge.js`.

## How the runtimes use it

- **Server**: `Kotiko.Spec` reads the files at compile time; `Kotiko.Lang` (tags),
  `Kotiko.WordSpec` (input checks, extraction, validation), `Kotiko.WordSpec.Prompt` and
  `Kotiko.Pronunciation` use them. Nothing under `server/lib` hardcodes a number or a list
  that these files define.
- **Extension**: `extension/lib/lang.js` and `extension/lib/wordspec.js`, with the data
  from `extension/spec/spec.js` (`globalThis.KOTIKO_SPEC`). The background's own lookups
  (slice 11: `lib/llm/client.js`) build the prompt and check every answer with the whole
  pipeline.

## Changing it

1. Edit the files here, never `extension/spec/` (it is generated).
2. `node spec/tools/sync-extension.mjs` to refresh the extension's copy.
3. If the pipeline's output changes on purpose: `node spec/tools/fixture-results.mjs`, and
   review the diff of `fixtures/normalize-results.json`.
4. Run both test suites: `npm test` and `cd server && mix test` (the shared fixtures run
   in both; `mix test --only spec` and `node --test test/unit/lang.test.mjs
   test/unit/wordspec.test.mjs` run just them).
5. A change to `prompt.md` or the validator needs an evaluation summary for at least two
   models in the pull request (`eval/README.md`), and bumps `VERSION`'s minor version.

Language data comes from CLDR: edit `tools/lang-curation.json` (regions kept as groups,
extra scripts, names CLDR lacks), then `node spec/tools/gen-lang-data.mjs` (needs `npm ci`
for the pinned `cldr-core` and `cldr-localenames-full`). CI fails when the committed files
differ from what the pinned CLDR version produces.

## Fixtures

| Folder or file | Checked by |
|---|---|
| `fixtures/lang-tags.json`, `base-tags.json` | canonical tags, script checks, names, base tags |
| `fixtures/normalize/*.json` | model answer + request -> words, rejections, dropped forms and fields |
| `fixtures/normalize-results.json` | the full output of every normalize fixture, which both runtimes must match exactly |
| `fixtures/pronunciation/*.json` | one word's pronunciation fields -> kept or dropped, with the reason |
| `fixtures/stem/*.json` | is this form related to the gloss? (`en`, `es`, `_generic`) |
| `fixtures/input.json`, `lang-data.json`, `prompt.json` | input checks, which `lang/` folder a base reads, and the prompt text (by hash) |
| `fixtures/native-key.json` | the natural key's `native_key` (slice 07) |
| `fixtures/llm-policy.json` | an HTTP answer -> an outcome, and an outcome -> the lookup's next step (slice 10) |

Licensing: `languages.json` and `lang-aliases.json` (and their copies) contain data derived
from Unicode CLDR under the Unicode License v3 (`LICENSES/Unicode-3.0.txt`, `NOTICE`).
