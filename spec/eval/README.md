# The golden evaluation

`golden.jsonl` holds the cases (slice 09 section 6): a learner's message, its mode and
bases, and what a good answer contains. `run-eval.mjs` sends them to any OpenAI-compatible
model with the prompt of `spec/prompt.md`, checks each answer with the extension's
pipeline (`extension/lib/wordspec.js`, the same checks the server runs) and scores it.
Node 22, no dependencies.

## Re-scoring recorded answers (free, no network)

```
node spec/eval/run-eval.mjs --replay --set all
```

Every answer a live run gets is recorded in `recorded/<model>.jsonl`, keyed by case, model
and a hash of the exact request. `--replay` scores the recordings that match the current
prompt with the current validator and sends nothing; it rewrites `RESULTS.md` (newest run
on top). CI runs `--replay --set all --check`, which fails when `RESULTS.md` doesn't hold
the numbers the recordings give.

The committed recordings are two hand-written references, not model answers:
`reference/hand-written` (an answer that passes every case, which proves the cases and the
checks agree) and `reference/old-prompt-shape` (the same words in the 0.2 prompt's shape:
`english`, no `base_lang`, no pronunciation), which shows what the scores catch. Real
models' recordings are added by the maintainer's first live run, below.

## A live run

```
OPENROUTER_API_KEY=<your key> node spec/eval/run-eval.mjs \
  --models apodex/apodex-1.1-mini:free,google/gemma-4-31b-it:free \
  --set core --budget 40 --rpm 15
```

To use the key the server already has without printing it:

```
OPENROUTER_API_KEY="$(sed -n "s/^LLM_API_KEY=//p" server/.env | tr -d "'\"")" \
  node spec/eval/run-eval.mjs --models apodex/apodex-1.1-mini:free,google/gemma-4-31b-it:free --set core
```

Options: `--set core | all | tag:<tag>` (for example `tag:base:es`, `tag:pron`,
`tag:respell`), `--base-url` (default OpenRouter; `http://localhost:11434/v1` for Ollama or
LM Studio, no key needed), `--key-env` (the variable holding the key, default
`OPENROUTER_API_KEY`), `--rpm`, `--budget`, `--out` (default `spec/eval/recorded`).

What it costs, on OpenRouter's free tier (20 requests a minute; 50 free requests a day, or
1,000 after a one-time $10 credit; checked 2026-10-01):

- One request per case and model. `core` is 29 cases, so two models are 58 requests;
  `all` is 133 cases (266 for two models). Retries after a 429 are extra requests that
  OpenRouter didn't appear to count against the daily quota (unverified: the runner prints
  the quota before and after so this can be checked).
- **Plan first.** Before any model call it reads `GET /api/v1/key`
  (`data.free_model_daily_requests.remaining`), prints the plan, and refuses to start if
  this run's requests (at most `--budget`, default 40, core cases first) are more than the
  free requests left. Keep the budget at 40 or less on the 50-a-day tier, so the server
  keeps some lookups for the day. If the provider reports no daily quota, only `--budget`
  limits the run.
- **Pacing.** At most `--rpm` requests a minute (default 15, under the limit of 20): 40
  requests take about 3 minutes. On a 429 it waits for `Retry-After` or
  `X-RateLimit-Reset` and tries the same case again, up to 3 times.
- **Resume.** Recorded cases are never asked again, so with the default budget the core
  set for two models finishes in two daily runs: run the same command again tomorrow.
- Then commit `recorded/*.jsonl` and `RESULTS.md` (`--replay` rewrites it from everything
  recorded), so CI replays them.

## Scores

Per model: pass rate overall, for `core` and per base; valid JSON; intent; language;
base completeness (every requested base has an entry); forms precision (no form that is
another word); median and p95 latency; requests used. Per model, prompt (lookup or
respell), target and base, three pronunciation scores: **letters** (`pronunciation_any`,
`careful_any`), **stress** (`stress_syllable`, `no_capitals`; no pronunciation scores no
stress) and **vowel reduction** (`pronunciation_any` on cases tagged `reduction`), plus
tone digits for Mandarin and the share of pronunciations the checks dropped.

## Case format

One JSON object per line:

```json
{"id": "en-ru-kak-bare", "input": "как", "mode": "add", "base_langs": ["en"], "recent": ["ru"],
 "tags": ["core", "lesson"],
 "expect": {"intent": "add", "count": [1, 1],
   "words": [{"lang": "ru", "base_lang": "en", "native_any": ["как"], "gloss_any": ["how"],
              "forms_include": ["how"], "forms_exclude": ["what", "as", "like"]}]}}
```

Per case: `intent`, `count` (distinct words, not entries), `no_reply`, `bases_complete`,
`code`. Per expected word, matched order-insensitively: `lang`, `base_lang`, `native_any`,
`gloss_any`, `forms_include`, `forms_exclude`, `romanization_re`, `romanization_any`,
`pronunciation_any`, `careful_any`, `stress_syllable`, `no_capitals`, `tones`,
`native_vocalized_any`, `reading_any` (skipped until slice 36). A list may contain `null`
to allow a null field; the bare value `null` means the field must be null. A pronunciation
the checks dropped counts as null. Respell cases have `"mode": "respell"`, `items` (what
the refresh job sends) and `expect.items`. Every case is tagged `base:<tag>` for each of
its bases.
