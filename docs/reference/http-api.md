# HTTP API reference

Last reviewed: 2026-10-05.

The Kotiko server answers HTTP on `http://127.0.0.1:4747` by default (`BIND` and `PORT` in
[configuration.md](configuration.md)). The browser extension and `curl` use this API. This
page lists every route the server has. A test (`server/test/kotiko/docs_test.exs`) fails when
a route is added or removed without updating this page.

- [Requests](#requests)
- [Errors](#errors)
- [Versions](#versions)
- [Routes](#routes): [health](#get-health), [words](#get-apiv1words), [the lookup
  service](#get-apiv1llmstatus), [the pronunciation job](#get-apiv1jobspronunciation-refresh),
  [the 0.2 routes](#get-apiwords)
- [See also](#see-also)

## Requests

**Authentication.** Every route except `GET /health` and `HEAD /health` needs the API token:

```
Authorization: Bearer <API token>
```

The scheme is case-sensitive (`Bearer`, not `bearer`) and only one `Authorization` header
is accepted. The token is compared in constant time. Without the right token, every method
and path answers `401` with `www-authenticate: Bearer` and the error `server_key_rejected`,
before the server reads the body or looks at the route. `mix kotiko.token` (in `server/`)
prints the token; [configuration.md](configuration.md#api_token) says where it comes from.

**Host names.** Before anything else, the server checks the `Host` header, to stop web pages
reaching it through DNS rebinding. It answers to `localhost`, IP addresses, this machine's
own name (and `<name>.local`), and the names in `ALLOWED_HOSTS`. Any other name gets `421`
with the error `server_address_invalid` (`details.reason`: `host_not_allowed`). A request
with no `Host` header is accepted only from this machine. `ALLOWED_HOSTS=*` turns the check
off.

**Bodies.** Send JSON with `Content-Type: application/json`, UTF-8. A body may be at most
64,000 bytes, except `POST /api/v1/words/batch`, which takes up to 1,000,000 bytes. A larger
body gets `413`; JSON that can't be parsed gets `400`. Always send the JSON content type: a
body sent as another type (`curl -d` alone sends `application/x-www-form-urlencoded`) isn't
read, and today the body routes then fail with `500 internal` instead of a clear `400`
(a known bug).

**No browser access from web pages.** The server sends no CORS headers, so a script on a
web page can't read its answers. The extension calls it from its own background page.

**Times** are RFC 3339 in UTC with milliseconds, for example `2026-10-01T21:23:47.123Z`.

**Idempotent adds.** The add routes take an optional `client_request_id` (a UUID). The
answer to a request with that id is kept for 24 hours; sending the same id again returns
the same answer without asking the model or saving again. An id that isn't a UUID is a
`400` (`details.field`: `client_request_id`).

## Errors

Routes under `/api/v1` answer errors in one shape:

```json
{"error": {"code": "word_conflict", "message": "This word changed since.", "details": {}}}
```

- `code` is stable and meant for programs. `message` is a short plain-English sentence for
  people; it can change. `details` is an object, often empty.
- The codes and what they mean to the learner are slice 25's
  ([plain-language errors](../../slices/25-plain-language-errors/SPEC.md)).

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | A parameter or body field is missing or wrong; `details.field` names it (and `details.max` for a limit) |
| 400 | `invalid_word` | An edit doesn't make a valid word; `details.field` and `details.reason` |
| 400 | `empty_input`, `input_too_long` | The add text is empty, or longer than 200 characters |
| 401 | `server_key_rejected` | Missing or wrong token (every route but `/health`) |
| 404 | `word_gone` | No word with that id, or it was deleted |
| 404 | `not_found` | No such route under `/api/v1` |
| 409 | `word_conflict` | `details.reason`: `stale` (changed since `if_updated_at`, with the current `details.word`) or `duplicate` (another word has the same language, text and meaning, `details.other_id`) |
| 410 | `word_gone` | A restore after the 30 days (`details.reason`: `scrubbed`) |
| 413 | `request_too_large` | The body is over the limit |
| 421 | `server_address_invalid` | The `Host` header names a host the server doesn't answer to |
| 429 | `rate_limited`, `quota_exhausted` | The model provider is busy, or today's free lookups are used up; `Retry-After` (seconds) and `details.retry_at` when known; `details.reason` is `payment_required` when the provider wants credit |
| 502 | `key_rejected`, `model_unavailable`, `bad_lookup_result` | The provider refused the server's key, no model could answer, or the answer wasn't usable |
| 503 | `lookup_timeout`, `lookup_not_set_up` | No answer within the add's deadline, or no model key is set |
| 500 | `internal` | A bug; `details.ref` is a reference to find in the server log. No stack trace is sent |

Lookup errors may carry `details.provider` and `details.status` (the provider's HTTP
status). Their messages never contain the text you sent.

The [0.2 routes](#get-apiwords) answer errors as `{"error": "<message>"}` instead, because
0.2 extensions read that shape. Failed lookups there also carry `code` and `details`.

## Versions

- `/api/v1/...` is the current API (slice 07's word model: words have UUIDs, edits, and
  deletes that can be undone).
- `/api/words` is the API the 0.2 extension used. Today's extension still reads
  `GET /api/words` to sync the words it swaps on pages (and deletes such a word with
  `DELETE /api/words/:id`), so it can't go yet. Once nothing
  current uses it, it stays for one more minor version and is then removed, following the
  rule in
  [CONTRIBUTING.md](../../CONTRIBUTING.md#commits-and-pull-requests): before 1.0, a minor
  release may change the HTTP API only if the old route keeps working for one more minor
  version.
- `GET /health` reports the server version. Its `api` list is meant to name the versioned
  APIs the server speaks; it is empty in this release.

## Routes

### GET /health

Which server this is and whether its database works. No token needed. Answers nothing else
(no word counts, no settings).

```bash
curl -s http://localhost:4747/health
```

`200` when the database works, `503` when it doesn't (the file is missing or not writable,
or `SELECT 1` takes over a second):

```json
{"ok": true, "name": "kotiko", "version": "0.2.0", "api": [], "db": "ok"}
```

| Field | Type | Meaning |
|---|---|---|
| `ok` | boolean | `true` when `db` is `"ok"` |
| `name` | string | Always `"kotiko"` |
| `version` | string | The server's version |
| `api` | array of strings | See [Versions](#versions) |
| `db` | string | `"ok"` or `"error"` |

Sent with `cache-control: no-store`.

### HEAD /health

The same check as `GET /health`, with the same status (`200` or `503`) and no body.

### GET /api/v1/words

Your words, newest first, with every field. Deleted words and pending ones (Telegram
lookups you haven't added) are left out.

| Query parameter | Meaning |
|---|---|
| `lang` | Only these target languages, comma-separated BCP 47 tags (`ru,ar`); tags are normalised (`iw` is `he`) |
| `base` | Only meanings in these base languages, comma-separated (`es,en`) |
| `status` | `active`, `paused` or both, comma-separated; default both |
| `limit` | 1 to 20,000; default 20,000 |

```bash
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:4747/api/v1/words?lang=ru&limit=10"
```

`200`:

```json
{"words": [{"id": "0199a1b2-...", "lang": "ru", "native": "да", "base_lang": "en",
            "gloss": "yes", "forms": [{"text": "yes", "enabled": true, "case": "any",
            "ambiguous": false}], "status": "active", "...": "..."}],
 "cursor": "42"}
```

Each word has every field of the word record in
[`spec/word.schema.json`](../../spec/word.schema.json): `id` (a UUID), `lang`, `native`,
`base_lang`, `sense`, `romanization`, `native_vocalized`, `gloss`, `forms`,
`pronunciation`, `pronunciation_careful`, `pronunciation_source`, `note`, `status`,
`origin`, `source_text`, `created_at`, `updated_at`, `deleted_at`, `merged_into`, and
`language` (the language's own name for itself, output only). `cursor` is the server's last
change number, as a string.

Errors: `400 invalid_request` with `details.field` set to `lang`, `base`, `status` or
`limit`.

### GET /api/v1/words/:id

One word by its id, including a deleted one (its `deleted_at` is set).

`200`: `{"word": {...}}`. Errors: `404 word_gone` for an id that isn't a UUID, is unknown, or
belongs to a pending word.

### POST /api/v1/words

Adds words. Three forms of body:

**1. Text for the model** (what the add box sends). The server asks the model which word or
words you mean, checks the answer, and saves the words, merging into words you have.

| Field | Type | Meaning |
|---|---|---|
| `text` | string, required | What you typed: `shukran`, `how do you say dog in japanese`. At most 200 characters after trimming |
| `base_langs` | array of strings, required | The languages you read, for the meanings (1 to 4 tags) |
| `hint_lang` | string | A target language to prefer (a BCP 47 tag) |
| `preview` | boolean | `true`: look up and check, but save nothing |
| `client_request_id` | string | See [Idempotent adds](#requests) |

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text": "shukran", "base_langs": ["en"]}' http://localhost:4747/api/v1/words
```

`200`:

```json
{"results": [{"result": "created", "word": {"id": "...", "lang": "ar", "native": "شكرا",
              "gloss": "thanks", "...": "..."}}],
 "rejected": [], "dropped_forms": [], "dropped_fields": [], "missing_bases": []}
```

- `results`: one entry per saved word. `result` is `created`, `updated` (with `previous`,
  the word before the merge) or `unchanged`.
- `rejected`: words the checks refused, each with its `reason`.
- `dropped_forms`, `dropped_fields`: parts of an answer that were left out, with reasons.
- `missing_bases`: base languages the model gave no meaning for.
- `code`: present when no word was saved (for example `no_word_found`).
- `reply`: present when the model answered with a message instead of a word.

With `"preview": true`, the answer has `candidates` (the words that would be saved, each with
`status` and `origin`) instead of `results`, and nothing is written.

Errors: `400 empty_input`, `400 input_too_long`, `400 invalid_request` (`details.field`:
`base_langs`, `hint_lang`, `client_request_id` or `text`), and every lookup error in
[Errors](#errors) (`429`, `502`, `503`).

**2. A word you write yourself** (no model call): `{"word": {...}, "client_request_id": ...}`.
The word has the record's fields. `lang`, `native`, `base_lang` and `gloss` are required;
`native` and `gloss` are at most 64 characters; `forms` (strings or form objects, at most 10
of at most 40 characters) get the gloss added when it's missing; `note` is cut to 200
characters; `status` is `active` (default) or `paused`; `origin` defaults to `add`. The
pronunciation fields are checked, and an invalid one is dropped and listed.

`200`: `{"results": [...], "rejected": [...], "dropped_fields": [...]}`. A word that can't be
saved is in `rejected` with its `reason`, for example `missing_field`, `invalid_lang`,
`script_mismatch` (the text isn't in the language's script), `target_is_base`, `too_long`
or `no_usable_forms`.

**3. Neither**: `400 invalid_request` with `details.field` `text`.

### POST /api/v1/words/batch

Saves up to 500 words you wrote yourself in one call, without the model (bulk add and
import). Body up to 1,000,000 bytes.

| Field | Type | Meaning |
|---|---|---|
| `words` | array, required | Up to 500 word objects, as in form 2 above; `origin` defaults to `bulk` |
| `client_request_id` | string | See [Idempotent adds](#requests) |

`200`: `{"results": [...], "rejected": [...], "dropped_fields": [...]}`, in input order. Each
entry has `index`, its position in `words`.

Errors: `400 invalid_request` with `details.field` `words` (not a list, or more than 500, with
`details.max`) or `client_request_id`; `413 request_too_large`.

### GET /api/v1/export

The whole word list as a backup file: the JSON document of
[`spec/export.schema.json`](../../spec/export.schema.json), the same one the extension writes,
with `app.source` `server`. Streamed in id order, 500 words at a time; deleted words are left
out. Sent with `Cache-Control: no-store`.

| Query | Meaning |
|---|---|
| `include=pending` | Also include Telegram lookups that were never added (status `pending`) |
| `download=1` | Send it as a file download, `kotiko-backup-YYYY-MM-DD.json` |

`200`: the backup document. `mix kotiko.export` writes the same file from the server's
computer.

### DELETE /api/v1/words

Deletes every word: live words, pending Telegram lookups and deleted words kept for undo,
plus the saved add answers and the lookup cache. Other devices start their sync over
(`reset_epoch` goes up by one). It can't be undone; export first.

| Field | Meaning |
|---|---|
| `confirm` | Required: the string `delete-all-words` |

`200`: `{"deleted": n, "reset_epoch": e}`; `deleted` counts the words that weren't already
deleted or pending. Errors: `400 invalid_request` (`details.field`: `confirm`) without the
confirmation, and nothing is deleted. `mix kotiko.reset` does the same from the server's
computer.

### PATCH /api/v1/words/:id

Changes the fields you send and nothing else.

| Field | Meaning |
|---|---|
| `lang`, `native`, `sense`, `gloss`, `forms`, `romanization`, `native_vocalized`, `pronunciation`, `pronunciation_careful`, `pronunciation_source`, `note`, `status` | The new values. `null` clears a field that may be empty. `status` is `active` or `paused`; `pronunciation_source` is `model`, `user`, `wiktionary` or `null` |
| `if_updated_at` | Optional: the `updated_at` you last saw. The edit is refused if the word changed since. An `If-Match: "<updated_at>"` header does the same |

`200`: `{"word": {...}}`, the word after the edit.

Errors: `400 invalid_word` (`details.field` and `details.reason`, such as `too_long`,
`bad_romanization` or `bad_value`); `400 invalid_request` (`details.field`:
`if_updated_at`, not an RFC 3339 time); `404 word_gone`; `409 word_conflict` (`stale` or
`duplicate`).

### DELETE /api/v1/words/:id

Deletes a word. It can be restored for 30 days; after that its content is cleared.

`200`: `{"word": {...}}`, the deleted word with `deleted_at` set. Errors: `404 word_gone`.

### POST /api/v1/words/:id/restore

Undoes a delete, keeping the same id and content. No body.

`200`: `{"word": {...}}`. Errors: `404 word_gone`; `409 word_conflict` (`duplicate`:
another word took its place meanwhile); `410 word_gone` (`scrubbed`: deleted more than 30
days ago).

### GET /api/v1/llm/status

The lookup service, answered from memory (no model call).

```json
{"provider": "openrouter", "models": ["..."], "models_source": "...", "skipped": [],
 "quota": {"used": 3, "limit": 50, "remaining": 47, "resets_at": "2026-10-06T00:00:00.000Z",
           "estimated": false},
 "last_result": null}
```

- `provider`: `openrouter`, or the host name of `LLM_URL`.
- `models`: the models an add would ask now, in order. `models_source` says where the list
  came from: `env` (`LLM_MODEL`), `live` (OpenRouter's model list, read today), `cache`
  (the last list read, from disk) or `fallback` (the list shipped in `spec/models.json`).
  `skipped`: models resting after errors, each `{"id", "for_s"}` (seconds left).
- `quota`: today's free lookups on OpenRouter; `null` for other providers or before the
  first check.
- `last_result`: how the last lookup ended: `ok`, an error code from [Errors](#errors), or
  another outcome code such as `no_word_found`; `null` before the first lookup.

### GET /api/v1/jobs/pronunciation-refresh

The one-time background job that adds pronunciations to words saved before they existed.

`200`: `{"state": "running", "done": 12, "total": 40}`. `state` is `running`, `waiting`
(with `retry_at`), `paused` or `done`.

### POST /api/v1/jobs/pronunciation-refresh

Pauses or resumes that job. Body: `{"action": "pause"}` or `{"action": "resume"}`.

`200`: the job's status, as above. Errors: `400 invalid_request` (`details.field`: `action`).

### GET /api/words

Active words for English pages, in the 0.2 shape. The current extension still uses it to
sync the words it swaps (see [Versions](#versions)). `?lang=ru,ar` limits the languages.

`200`: `{"words": [{"id": 17, "lang": "ru", "language": "Russian", "native": "да", ...}]}`.
`id` is an integer. Each word also has `romanization`, its meaning as `english`, the
enabled `forms` as strings, `note`, `base_lang`, `native_vocalized` and the pronunciation
fields.

### POST /api/words

For 0.2 extensions: adds words from text, with English meanings. Body:
`{"text": "shukran", "client_request_id": "<optional UUID>"}`.

`200`: `{"words": [...]}` with the new words in the 0.2 shape. Words you already had are
named in `reply` ("Already in your list: ...") and `known`. Errors: `400`
`{"error": "Send {\"text\": \"...\"}"}`; `422` when every word was refused; lookup errors
with their status and `{"error": "<message>", "code", "details"}`.

### DELETE /api/words/:id

Deletes a word by its integer id (Undo in the 0.2 popup; today's extension still uses it
for a word it knows only from `GET /api/words`). The word can still be restored through
`/api/v1` for 30 days.

`200`: `{"ok": true}`. Errors: `404` `{"error": "No such word."}`.

## See also

- [`spec/word.schema.json`](../../spec/word.schema.json): the word record, with every field's
  type and limit; [`spec/rules.json`](../../spec/rules.json): the limits themselves.
- [configuration.md](configuration.md): the server's settings and files.
- [`spec/README.md`](../../spec/README.md): the shared word spec both the server and the
  extension use.
- Export and import file formats: slice
  [12](../../slices/12-export-import-and-delete/SPEC.md) (`spec/export.schema.json`, when it
  lands).
- [SECURITY.md](../../SECURITY.md): how to report a security problem.
