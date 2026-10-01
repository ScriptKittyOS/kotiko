# 10 · LLM client resilience

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [09-shared-word-spec-and-prompt](../09-shared-word-spec-and-prompt/SPEC.md), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (base languages in each request) |
| **Unblocks** | [11](../11-local-first-mode/SPEC.md), [13](../13-bulk-add/SPEC.md), [20](../20-popup-redesign/SPEC.md) (quota display), [22](../22-first-run-onboarding/SPEC.md) |
| **Sources** | [06 F09, F14, F40](../../docs/research/06-adversarial-qa.md); [04 S17, S18, S19, S28](../../docs/research/04-architecture-release.md); [05 S19, S34](../../docs/research/05-learner-ux.md) |

## Problem

Every word Kotiko learns goes through a model, and by default that is a free OpenRouter
model: shared, often busy, rate limited, and renamed or retired every few weeks. The
client treats it as if it were reliable.

- **Adds can hang for minutes.** Each model gets `receive_timeout: 60_000`
  (`server/lib/slovo/llm.ex:124`) and there is no overall deadline, so the five default
  models make a 300 s worst case. Measured: 180 s with three stalled models ([06 F09](../../docs/research/06-adversarial-qa.md),
  reproduced). Chrome stops an MV3 service worker whose `fetch()` waits more than 30 s,
  so the popup reports a failure while the word may still be saved.
- **One typo spends five requests.** `try_models/5` walks the whole list on errors, 429s
  and "found no word" (`llm.ex:71-93`). With 50 free requests a day, that is about ten bad
  adds ([06 F14](../../docs/research/06-adversarial-qa.md), reproduced).
- **The model list is frozen.** Five ids are hardcoded (`server/config/runtime.exs:35-42`):
  `apodex/apodex-1.1-mini:free`, `qwen/qwen3.8-27b:free`, `google/gemma-4-31b-it:free`,
  `dots-studio/dots-3-note-preview:free`, `nvidia/nemotron-3-super-120b-a12b:free`. All
  five exist today, but `qwen/qwen3.8-27b:free` doesn't list `response_format`, which Kotiko
  always sends (`llm.ex:112`) ([04 S17](../../docs/research/04-architecture-release.md)).
  A store-installed extension can't be hot-fixed in a day when an id disappears.
- **No sense of quota.** The learner sees "all the free models are busy" (`llm.ex:95-98`)
  whether the per-minute or the daily limit was hit, and has no idea how many lookups are left.
- **No cache.** Looking up the same word twice costs two requests ([04 S18](../../docs/research/04-architecture-release.md)).
- **User text in logs.** Every lookup logs the input and the answer at info level
  (`llm.ex:76`, `llm.ex:80-82`, `llm.ex:130`), which systemd keeps in journald ([04 S28](../../docs/research/04-architecture-release.md), [06 F40](../../docs/research/06-adversarial-qa.md)).

Facts checked on 2026-10-01: `GET https://openrouter.ai/api/v1/models` answered without
a key and listed 464 models, 17 with ids ending in `:free`, each with
`supported_parameters`, `expiration_date`, `architecture.output_modalities` and a
`reasoning` object (`mandatory`, `default_enabled`). Of the 17, six list
`response_format`; one (`liquid/lfm-2.5-2.6b:free`) has mandatory reasoning; one is a
content-safety classifier. `GET /api/v1/key` needs the key and returns
`data.free_model_daily_requests: {used, limit, remaining}` per UTC day. Free limits: 20
requests a minute; 50 a day, or 1,000 a day once $10 of credit has ever been bought.
Platform 429s carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
and sometimes `Retry-After`.

## Goals

- An add never takes longer than 25 s end to end on the server, and never more than 3
  model requests.
- The free-model chain is built from OpenRouter's live list, filtered for what Kotiko needs,
  with a cached and a shipped fallback, and `LLM_MODEL` always wins.
- Failures are classified so callers (popup, job queue in slice 11, Telegram) can say
  something true and know when to retry.
- Remaining free quota is known before a request and shown to the learner.
- Repeated lookups are free.
- No user text in logs by default.
- The same policy in the server (Elixir) and the extension (JavaScript, slice 11).

## Non-goals

- The prompt, extraction and validation: slice [09](../09-shared-word-spec-and-prompt/SPEC.md).
- The persistent job queue, waiting and resuming: slice [11](../11-local-first-mode/SPEC.md).
- Error wording: slice [25](../25-plain-language-errors/SPEC.md). This slice defines codes.
- Provider presets other than OpenRouter: slice [11](../11-local-first-mode/SPEC.md).
- Global log redaction and log level: slice [29](../29-server-ops-hardening/SPEC.md).

## User stories

- As a learner pressing Add, I want an answer or a clear "try again at 14:32" within
  seconds, not a spinner for five minutes.
- As a free-tier learner, I want to see "38 free lookups left today" so I can plan a bulk add.
- As a self-hoster, I want Kotiko to keep working when OpenRouter retires a model, without
  editing `.env`.
- As a privacy-minded user, I want the words I look up kept out of system logs.

## Specification

### 1. Model catalog

`Kotiko.LLM.Catalog` (GenServer; JavaScript twin `extension/lib/llm/catalog.js`).

- **When**: 10 s after boot (never blocking startup), then every 24 h, and on demand when
  every model in the chain failed with "not found". Only when the LLM host is
  `openrouter.ai`.
- **Request**: `GET {LLM_URL}/models`, with `Authorization: Bearer` when a key is set
  (the docs expect one; it works without), 10 s timeout.
- **Filter**, all must hold:
  1. id ends with `:free`, or both `pricing.prompt` and `pricing.completion` are `"0"`.
  2. `"text"` in `architecture.output_modalities`.
  3. `"response_format"` or `"structured_outputs"` in `supported_parameters`.
  4. `expiration_date` is null or more than 24 h away.
  5. `reasoning.mandatory` is not true (mandatory reasoning adds 5-20 s and doesn't help
     lookups; today's code disables reasoning for the same reason, `llm.ex:115-118`).
  6. `context_length` ≥ 8,000.
  7. id not matched by `spec/models.json` `deny` (e.g. `*content-safety*`, `*-code*`).
- **Order**: ids in `spec/models.json` `prefer` (maintained from slice 09's eval results)
  in that order, then the rest by `created` descending.
- **Per-model capabilities** stored with each entry: `json_mode` (`response_format`
  supported), `reasoning_toggle` (`reasoning` supported), `max_tokens` supported.
- **Cache**: the filtered list is written to `<data_dir>/models-cache.json` with
  `fetched_at` (extension: IndexedDB `meta`). On boot, a cache younger than 7 days is used
  until the fetch succeeds.
- **Fallback**: if there is no fetch and no usable cache, use `spec/models.json`
  `fallback`, initially today's five ids (`runtime.exs:38-39`), ordered by today's check:
  `apodex/apodex-1.1-mini:free`, `google/gemma-4-31b-it:free`,
  `nvidia/nemotron-3-super-120b-a12b:free`, `dots-studio/dots-3-note-preview:free`,
  `qwen/qwen3.8-27b:free`.
- **`LLM_MODEL` wins**: an explicit list is used as given, in order, never filtered. The
  catalog still supplies capabilities for ids it knows. For any `LLM_URL` that isn't
  OpenRouter, `LLM_MODEL` is required (slice 29's config validation says so at boot).

### 2. One lookup: attempts, deadline, classification

`Kotiko.LLM.interpret(text, context, opts)` where `context` is slice 09's request context.

**Budgets** (`spec/models.json` `policy`, so both runtimes share them):

| Caller | Overall deadline | Per-attempt timeout | Max attempts |
|---|---|---|---|
| Add box via server (`POST /api/v1/words`) | 25 s | min(15 s, remaining) | 3 |
| Extension direct (slice 11 job attempt) | 25 s | min(15 s, remaining) | 3 |
| Telegram | 40 s | min(20 s, remaining) | 3 |
| Bulk add batch (slice 13) | 45 s | 30 s | 2 |

25 s keeps the server's answer inside Chrome's 30 s fetch limit with margin. The deadline
is enforced with a monotonic clock; an attempt is not started with less than 4 s left.

**Request per attempt**: slice 09's messages; `temperature: 0.2`; `response_format:
{type: "json_object"}` only if the model's `json_mode`; `reasoning: {enabled: false}`
only on OpenRouter and if `reasoning_toggle`; `max_tokens: 1200` if supported; headers
`X-Title: Kotiko` and `HTTP-Referer: https://github.com/ScriptKittyOS/kotiko` on OpenRouter
(app attribution, as slice 11 specifies); `Req` with `retry: false`.

**Outcome of an attempt → next step** (`Kotiko.LLM.Policy.next/2`, a pure function, table
tested):

| Outcome | Next step | Model health |
|---|---|---|
| 200, slice 09 yields words | done: `ok` (words missing for some requested bases are listed in `missing_bases`; see "Missing bases" below) | success |
| 200, slice 09 finds no word | next model **once** per lookup (F14); then slice 09's code (`no_word_found` or `rejected_same_as_gloss`) | none |
| 200, unparseable | next model; if it was the last attempt, `bad_lookup_result` | failure |
| 400 naming `response_format` | retry the same model once without it; mark `json_mode: false` | none |
| 400/404 model not found or unavailable | next model | skip model 1 h |
| 401 | stop: `key_rejected`, or `lookup_not_set_up` when no key is set (today's distinction, `llm.ex:135-140`) | none |
| 402 | stop: `quota_exhausted` with `details.reason: "payment_required"` and no `retry_at` (a negative balance blocks free models too; adding credit fixes it) | none |
| 403 | stop: `key_rejected` with `details.reason: "forbidden"` (key restrictions, moderation or a guardrail; the details say which when the body does) | none |
| 429 **with** `X-RateLimit-*` headers (OpenRouter's own limit, shared by every free model) | if the daily counter is exhausted (`X-RateLimit-Remaining: 0` with a reset more than 2 min away, or quota says 0): stop `quota_exhausted` with `retry_at` = reset. Otherwise wait `Retry-After` (or until reset) if that fits the deadline minus 4 s and retry the **same** model; else stop `rate_limited` with `retry_at`. Never walk the list: other free models share the limit. | none |
| 429 **without** those headers (upstream provider busy) | next model | failure |
| 5xx, timeout, connection error | next model | failure |
| deadline reached | stop: `lookup_timeout` (or `model_unavailable` if every attempt failed before it) | |

**Model health**: three consecutive failures skip a model for 10 minutes. A success moves
that model to the front of the chain for one hour (the "what worked last" heuristic from
[04 S17](../../docs/research/04-architecture-release.md)).

**Result codes** returned to callers are slice 25's: `ok`, `no_word_found`,
`rejected_same_as_gloss`, `bad_lookup_result`, `lookup_not_set_up`, `key_rejected`,
`quota_exhausted`, `rate_limited`, `model_unavailable`, `lookup_timeout`. Each non-ok
result carries `details` (`reason`, HTTP status) and `retry_at` (UTC, when known) and
`attempts` (model ids and outcomes, for the debug log only). The router maps them to HTTP
502/503/429 with slice 25's error shape and `Retry-After`. Slice 11's job runner maps
`rate_limited` and `quota_exhausted` to `waiting` until `retry_at`.

The distinction between the two kinds of 429 is from OpenRouter's documentation and
needs a recorded example of each (test plan); until confirmed, an unknown 429 is treated
as the platform kind, which wastes nothing.

### 3. Quota awareness

`Kotiko.LLM.Quota` (OpenRouter only):

- `GET {LLM_URL}/key` at boot, then at most once every 5 minutes when lookups happen, and
  immediately after any 429. Stores `free_model_daily_requests` and `is_free_tier`.
- Between refreshes, keeps a local estimate: decrement `remaining` on every attempt that
  got a non-429 response. (Rate-limited attempts did not appear to count in practice;
  unverified, so the refresh after each 429 corrects the estimate either way.)
- `resets_at` is the next UTC midnight.
- Before a lookup: if `remaining` is 0 and `resets_at` is in the future, return
  `quota_exhausted` immediately with no model call.
- **API**: `GET /api/v1/llm/status` → `{"provider": "openrouter", "models": ["..."],
  "quota": {"used": 12, "limit": 50, "remaining": 38, "resets_at": "...", "estimated": true},
  "last_result": "ok"}`. `quota` is null for other providers. The popup (slice 20) shows
  "38 free lookups left today" when the server or the extension's own client reports it;
  bulk add (slice 13) uses it to size batches.

### 4. Lookup cache

- **Key**: SHA-256 of `spec VERSION`, prompt hash, mode, `hint_lang`, the recent-language
  list, the requested `base_langs` **in order** (slice 09; the primary base picks the
  few-shot examples, so order changes the prompt), and the input text after NFC, trim,
  whitespace collapse and lowercase with the primary base's locale
  (`toLocaleLowerCase(base_langs[0])`). "perro" asked with bases `["es"]` and with
  `["es", "en"]` are two entries; a Spanish reader and an English reader asking "dog"
  never share an answer, since the glosses differ.
- **Value**: slice 09's processed result (words and rejections), never the raw answer.
  Only `ok` results are cached; never no-word results, errors or chat replies.
- **Storage**: server table `lookup_cache (key TEXT PRIMARY KEY, result TEXT, model TEXT,
  inserted_at, last_hit_at, hits)`; extension: IndexedDB store `lookupCache` (slice 11).
  TTL 30 days; at most 5,000 entries, least recently hit evicted by the daily
  `Kotiko.Janitor` job (slice 07).
- **Bypass**: `opts[:fresh]` (the popover's "wrong meaning", slice 19, and "try again").
- **Missing bases**: an `ok` result with a non-empty `missing_bases` is cached with them,
  and the caller may ask again for just those bases (`base_langs` narrowed), which is a
  different key. Kotiko never makes that follow-up call by itself unless slice 09's eval
  shows free models routinely skip bases (09 open question 5); then one follow-up call
  per lookup, counted against the same 3-request cap and deadline.
- Cleared by delete-all (slice 12).
- **Single flight**: identical concurrent lookups (same key) share one model call.

### 5. Concurrency

At most 2 model calls in flight per server process (a semaphore around attempts), so a
burst of Telegram messages and popup adds doesn't trip 20 requests a minute. Waiters
count against their own deadlines.

### 6. Logging policy

- **Info**, one line per lookup: `llm lookup result=ok model=<id> attempts=2 ms=3412
  words=1 bases=2 cache=miss`. No input text, no output words, no prompt. Base tags
  are logged as a count only.
- **Warning**: catalog fetch failure (once per hour), quota exhausted (once per day),
  every model unavailable.
- **Debug**, only with `LOG_LOOKUPS=true` (default false, documented in `.env.example`):
  input text, raw answer truncated to 2,000 characters, rejected words.
- Response bodies from errors are logged at debug only, truncated to 300 characters,
  after slice 29's redaction filter (keys, tokens).
- Removes today's `Logger.info` and `Logger.warning` calls with text (`llm.ex:76`,
  `llm.ex:80-82`, `llm.ex:130`) and the raw changeset log (`server/lib/slovo/router.ex:45`).
- Telemetry events `[:kotiko, :llm, :attempt, :stop]` and `[:kotiko, :llm, :lookup, :stop]`
  with the same metadata, for tests and anyone who wants metrics.

### 7. Module layout

```
Kotiko.LLM            interpret/3: cache -> quota gate -> chain -> attempts -> WordSpec
Kotiko.LLM.Catalog    GenServer: models, capabilities, health
Kotiko.LLM.Quota      GenServer: key info, estimate
Kotiko.LLM.Cache      Ecto-backed cache, single flight
Kotiko.LLM.Policy     pure: next(outcome, state) -> action
Kotiko.LLM.Client     one HTTP attempt -> outcome
```

The extension mirrors `Policy` and `Client` in `extension/lib/llm/` with the same
`spec/models.json` policy numbers and a shared table of outcome fixtures
(`spec/fixtures/llm-policy.json`) run against both.

## Acceptance criteria

- [ ] With every model stalling, `POST /api/v1/words` returns `lookup_timeout` in at most 26 s
      (today: 180-300 s).
- [ ] A lookup makes at most 3 model requests; a no-word input makes at most 2.
- [ ] A platform 429 never moves to another model; an upstream 429 does.
- [ ] With quota `remaining: 0`, an add returns `quota_exhausted` with `retry_at` and makes
      no model request.
- [ ] Given the recorded 2026-10-01 `/models` response, the catalog chain contains only
      models with JSON support, excludes `liquid/lfm-2.5-2.6b:free` and the safety model,
      and puts `prefer` ids first.
- [ ] With the network down at boot and no cache, the shipped fallback list is used; with
      a cache, the cache is used.
- [ ] `LLM_MODEL=a,b` is used verbatim, even if `a` is not in the catalog.
- [ ] A second identical lookup within 30 days makes no model request; the same text
      with different `base_langs` (`["es"]` vs `["en"]`, or `["es","en"]` vs
      `["en","es"]`) does.
- [ ] At the default log level, no log line contains the input text or a returned word.
- [ ] `GET /api/v1/llm/status` reports used, limit and remaining matching a stubbed `/key`.
- [ ] `spec/fixtures/llm-policy.json` passes in Elixir and JavaScript.

## Test plan

- **ExUnit with `Req.Test` stubs** (slice 02): table-driven outcomes (200 ok, no word,
  unparseable, 400 `response_format`, 404, 401 with and without key, 402, 403, 429 with
  and without rate-limit headers, 500, slow response); assert request count, elapsed time
  with a fake clock, final code and `retry_at`. Deadline tests use a 50 ms scale factor
  so the suite stays fast.
- Catalog: filter and order against `test/fixtures/openrouter/models-2026-10-01.json`
  (the real response, trimmed); cache and fallback paths.
- Quota: estimate decrement, refresh after 429, gate at zero.
- Cache: key composition (including base order and the Turkish-locale lowercase of
  "IRAK" with base `tr`), TTL, eviction, single flight with 10 concurrent callers.
- Log capture: run the full suite with `capture_log` and assert no fixture input text appears.
- **Recorded examples**: capture one real platform 429 and one upstream 429 (headers and
  body) once with a throwaway key, commit them as fixtures, and confirm the
  classification. Manual, before release.

## Rollout and migration

- Server: one release. `LLM_MODEL` users see no change except the deadline. Users on the
  default list switch to the live catalog automatically. `.env.example` drops the
  commented list (`server/.env.example:20-24`) in favour of "leave LLM_MODEL empty to
  use OpenRouter's current free models".
- New table `lookup_cache` via migration. Entries from before slice 50 can't exist (the
  table is new), so no cache entry lacks base languages.
- Extension: slice 11 uses the JavaScript twin from its first release.
- Changelog: "Adding a word now answers within 25 seconds, uses at most 3 requests, and
  remembers words it already looked up. Kotiko follows OpenRouter's current free models
  automatically and shows how many free lookups you have left today."

## Open questions

1. **`openrouter/free` as a last resort.** OpenRouter lists a free router model
   (`openrouter/free`) that picks a free model itself. It may route to models without JSON
   mode. Recommendation: don't add it to the default chain; revisit after slice 09's eval
   includes it.
2. **Deadline of 25 s for adds.** Recommendation: keep; slice 11's queue retries later
   anyway, so a shorter deadline costs nothing.
3. **Data-collection preference.** Slice 11 asks whether to send OpenRouter's "deny data
   collection" preference. Recommendation: implement the option here (one request field,
   off by default) and let slice 11 own the setting.

## Future work

- Per-user quota on a shared server: slice [48](../48-multi-user-and-classroom/SPEC.md).
- Batch lookups (several words in one request) for bulk add, if the eval shows models
  handle it: slice 13.
- Persisting model health across restarts.
