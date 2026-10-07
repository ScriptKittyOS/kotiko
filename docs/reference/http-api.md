# HTTP API reference

Last reviewed: 2026-10-07.

The Kotiko server answers HTTP on `http://127.0.0.1:4747` by default, and on
`http://[::1]:4747` too (`BIND` and `PORT` in [configuration.md](configuration.md#bind)). The browser extension and `curl` use this API. This
page lists every route the server has. A test (`server/test/kotiko/docs_test.exs`) fails when
a route is added or removed without updating this page.

- [Requests](#requests)
- [Signed requests](#signed-requests)
- [Errors](#errors)
- [Versions](#versions)
- [Routes](#routes): [health](#get-health), [words](#get-apiv1words), [the lookup
  service](#get-apiv1llmstatus), [the pronunciation job](#get-apiv1jobspronunciation-refresh),
  [the 0.2 routes](#get-apiwords)
- [See also](#see-also)

## Requests

**Authentication.** Every route except `GET /health`, `HEAD /health` and
[`POST /api/v1/proof`](#post-apiv1proof) needs the API token, in one of two ways:

- `Authorization: Bearer <API token>`, for `curl` and other tools you run yourself;
- a [signed request](#signed-requests), `Authorization: Kotiko-HMAC v1 ...`, which proves
  the sender holds the token without sending it. The browser extension uses only this, so
  the token never leaves the browser.

```
Authorization: Bearer <API token>
```

The scheme is case-sensitive (`Bearer`, not `bearer`) and only one `Authorization` header
is accepted. The token is compared in constant time. Without the right token, every method
and path answers `401` with `www-authenticate: Bearer, Kotiko-HMAC` and the error
`server_key_rejected`, before the server reads the body or looks at the route. A signed
request that fails says why: `www-authenticate: Bearer, Kotiko-HMAC error="<reason>"` and
`details.reason` (see [Signed requests](#signed-requests)). `mix kotiko.token` (in
`server/`) prints the token; [configuration.md](configuration.md#api_token) says where it
comes from.

**Wrong tokens are throttled.** After 10 wrong `Bearer` tokens or failed signatures from
one address within a minute, every request from that address that needs the token gets
`429` with `Retry-After` and the error `rate_limited` (`details.reason`: `auth_failures`)
until the minute is over, even with the right token, so guessing learns nothing while it
waits. Other addresses are not affected. A request with no token, another scheme or a
malformed signature doesn't count. An IPv6 address counts by its /64 network. The server
logs the lockout once an hour per address.

A request from this computer (127.0.0.0/8, `::1` or IPv4-mapped 127.x) with no forwarding
header is never locked out: every program on the computer, and any web page open in a
browser there, reaches the server from those addresses, so any of them could otherwise
lock the extension out. A request from this computer that carries a forwarding header
(`Forwarded`, `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Host`, `CF-Connecting-IP` or `True-Client-IP`, any value) is what a reverse proxy on the same machine sends
for each remote client: those are counted, all together under one key per proxy address,
whatever client address the header claims (it can be forged). A stranger's lockout there
refuses everyone who comes through the proxy for the rest of that minute, but never the
extension, which sends no forwarding header; a local program that adds one locks out only
the proxied requests. A token the server made (256 random bits) can't be guessed in any
case; a weak token you chose can, and the server warns about it at start
([`API_TOKEN`](configuration.md#api_token)).

**Host names.** Before anything else, the server checks the `Host` header, to stop web pages
reaching it through DNS rebinding. It answers to `localhost`, IP addresses, this machine's
own name (and `<name>.local`), and the names in `ALLOWED_HOSTS`. Any other name gets `421`
with the error `server_address_invalid` (`details.reason`: `host_not_allowed`). A request
with no `Host` header is accepted only from this machine. `ALLOWED_HOSTS=*` turns the check
off.

**Bodies.** Send JSON with `Content-Type: application/json`, UTF-8. A body may be at most
64,000 bytes, except `POST /api/v1/words/batch`, which takes up to 1,000,000 bytes. A larger
body gets `413`; JSON that can't be parsed gets `400`. A body sent as another type (`curl -d`
alone sends `application/x-www-form-urlencoded`) gets `415` with the error
`invalid_request` (`details.reason`: `content_type`); add `-H 'Content-Type: application/json'`.

**No browser access from web pages.** The server sends no CORS headers, so a script on a
web page can't read its answers. The extension calls it from its own background page.

**Times** are RFC 3339 in UTC with milliseconds, for example `2026-10-01T21:23:47.123Z`.

**Idempotent adds.** The add routes take an optional `client_request_id` (a UUID). The
answer to a request with that id is kept for 24 hours; sending the same id again returns
the same answer without asking the model or saving again. An id that isn't a UUID is a
`400` (`details.field`: `client_request_id`).

## Signed requests

Slice 54, D-01. A signed request proves that its sender holds the API token without
sending it, and the answer proves that the server holds it too. Another program that
listens at the server's address (say, one that took the port while the server was
stopped) gets neither the token nor a request it could play to the server later, and the
client can tell its answers aren't the server's. The extension signs every request; tools
may keep using `Bearer`.

```
Authorization: Kotiko-HMAC v1 ts=<ts>, nonce=<nonce>, body=<body>, mac=<mac>
```

Exactly this form: one space after `Kotiko-HMAC`, `v1`, and after each comma; the four
fields in this order.

| Field | Value |
|---|---|
| `ts` | The client's time, whole seconds since 1970-01-01 UTC (1 to 12 digits) |
| `nonce` | 22 to 128 base64url characters (`A-Z a-z 0-9 - _`), new for every request; the extension sends 16 random bytes (22 characters) |
| `body` | SHA-256 of the request body's bytes, 64 lowercase hex digits; of the empty string when there is no body |
| `mac` | base64url, without padding (43 characters), of HMAC-SHA256 with the token's UTF-8 bytes as the key, over the canonical request below |

The canonical request is six lines joined by `\n` (LF), with no newline at the end:

```
kotiko-req-v1
<METHOD>
<path>
<ts>
<nonce>
<body>
```

- `METHOD` in capitals (`GET`, `PUT`).
- `path` is the request target as the server receives it: the path, raw (as sent, not
  percent-decoded), then `?` and the query string if there is one (`/api/v1/words?status=active,paused`).
  An address with a path prefix (a reverse proxy that mounts the server under `/kotiko`
  and strips it) signs the path the server sees, without the prefix.
- `ts`, `nonce` and `body` exactly as in the header.

The server accepts the request when the MAC matches (compared in constant time), `ts` is
within 120 seconds of its own clock and not earlier than the second it started, it hasn't
seen the nonce before, and the body it reads has the signed hash. It remembers each nonce
for the 120 seconds, once the MAC has matched (so only a token holder can fill that
memory), for at most 50,000 requests at once; beyond that it refuses signed requests with
`429 rate_limited` (`details.reason`: `too_many_requests`, with `Retry-After`) rather
than forget a nonce that could then be replayed. Refusing a `ts` from before the server
started covers the nonces a restart forgot: a request someone else received while the
server was stopped can't be played to it once it is back.

Every answer to an accepted request, errors included, carries the server's signature:

```
X-Kotiko-Server: v1 mac=<base64url(HMAC-SHA256(token, "kotiko-resp-v1\n" + nonce + "\n" + status))>
```

where `nonce` is the request's and `status` the answer's HTTP status in decimal (`200`).
It covers the status, not the body. A client checks it before it reads anything else from
the answer. The extension treats an answer without it, or with a wrong one, as not from
its server (`not_kotiko_server`): it uses nothing from it, forgets the server's
[proof](#post-apiv1proof), and sends nothing more until the server proves itself again.

A signed request that is refused gets `401 server_key_rejected` without `X-Kotiko-Server`;
`details.reason` and the challenge's `error` say why: `malformed` (not the form above;
doesn't count towards the [lockout](#requests)), `bad_mac`, `stale` (outside the 120
seconds: check both clocks), `replayed` or `body_mismatch`. A server from before signed
requests answers them `401` with `www-authenticate: Bearer` alone; the extension then asks
you to update the server.

Before a request that carries your words or settings (anything but `GET`), the extension
also asks for a [proof](#post-apiv1proof) when its last one is more than 30 seconds old.

**Test vectors**, with the token `example-token-0123456789abcdef`:

`PUT /api/v1/profile` with the body `{"base_langs":["es","en"],"ui_lang":null}` (those
exact bytes), `ts` 1791331200, nonce `q1aP3n0ZKcB1x5mW0u7S9b`:

```
kotiko-req-v1
PUT
/api/v1/profile
1791331200
q1aP3n0ZKcB1x5mW0u7S9b
40921055f301e073c3aa377b5ac7d8827ce72c5443e994014c2087b2895f51ff
```

```
Authorization: Kotiko-HMAC v1 ts=1791331200, nonce=q1aP3n0ZKcB1x5mW0u7S9b, body=40921055f301e073c3aa377b5ac7d8827ce72c5443e994014c2087b2895f51ff, mac=osa_O2pBaygJz8c64WTOrTLSiY_6vV70NHtPyZ2CZpA
```

and the server's `200` answer to it:

```
X-Kotiko-Server: v1 mac=CAmhh5A5suXJTIJNSarztt97Q-RO5eA9K0baiuiw1u0
```

`GET /api/v1/words?status=active,paused`, no body, `ts` 1791331200, nonce
`dE8gH0iL2nO4pQ6rS8tU0v`:

```
Authorization: Kotiko-HMAC v1 ts=1791331200, nonce=dE8gH0iL2nO4pQ6rS8tU0v, body=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855, mac=uHVRpP6SeDO3nxpRjs_zp8V9NYSCV2XP15w9BtwCdPg
```

(`ts` this old is refused by a live server; the vectors are for checking an
implementation. Both the server's and the extension's tests check them.)

## Errors

Routes under `/api/v1` answer errors in one shape:

```json
{"error": {"code": "word_conflict", "message": "This word changed since.", "details": {}}}
```

- `code` is stable and meant for programs. `message` is a short plain sentence for people;
  it can change. `details` is an object, often empty.
- `message` comes from the server's catalog (`server/priv/locales/<locale>/messages.json`,
  the key `error_<code>`, or `error_<code>_<reason>` and `error_<code>_<field>` where those
  say more). Its language follows the request's `Accept-Language` among the shipped locales,
  else English. Only English ships today; a translator adds a folder. The extension doesn't
  show `message`: it words each code itself, in the learner's interface language.
- The codes and what they mean to the learner are slice 25's
  ([plain-language errors](../../slices/25-plain-language-errors/SPEC.md)).

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | A parameter or body field is missing or wrong; `details.field` names it (and `details.max` for a limit) |
| 400 | `invalid_word` | An edit doesn't make a valid word; `details.field` and `details.reason` |
| 400 | `empty_input`, `input_too_long` | The add text is empty, or longer than 200 characters |
| 401 | `server_key_rejected` | Missing or wrong token, or a signed request that failed (`details.reason`); every route but `/health` and the proof |
| 404 | `word_gone` | No word with that id, or it was deleted |
| 404 | `not_found` | No such route under `/api/v1` |
| 409 | `word_conflict` | `details.reason`: `stale` (changed since `if_updated_at`, with the current `details.word`) or `duplicate` (another word has the same language, text and meaning, `details.other_id`) |
| 410 | `word_gone` | A restore after the 30 days (`details.reason`: `scrubbed`) |
| 413 | `request_too_large` | The body is over the limit |
| 415 | `invalid_request` | The body isn't JSON (`details.reason`: `content_type`) |
| 421 | `server_address_invalid` | The `Host` header names a host the server doesn't answer to |
| 429 | `rate_limited`, `quota_exhausted` | The model provider is busy, or today's free lookups are used up; `Retry-After` (seconds) and `details.retry_at` when known; `details.reason` is `payment_required` when the provider wants credit |
| 429 | `rate_limited` | Too many wrong tokens from this address (`details.reason`: `auth_failures`), too many proofs (`too_many_proofs`), or too many signed requests at once (`too_many_requests`); `Retry-After` (seconds) |
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
curl -s http://127.0.0.1:4747/health
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

### POST /api/v1/proof

Proves that this server holds your API token, without sending it. No token needed. The
extension calls it before its first request to an address, and again before a request
that carries your words or settings when its last proof is more than 30 seconds old, so
another program listening at that address (say, one that took the port while the server
was stopped) gets nothing it can use.

Send a fresh random nonce: 32 to 128 base64url characters (`A-Z`, `a-z`, `0-9`, `-`, `_`,
no `=` padding), for example 32 random bytes encoded as base64url.

```bash
curl -s -H 'Content-Type: application/json' -d '{"nonce": "q1aP3n0ZKcB1x5mW0u7S9bJ2rV4yT6dE8gH0iL2nO4p"}' \
  http://127.0.0.1:4747/api/v1/proof
```

```json
{"proof": "E5CHaF60VqTTPPduGD1yAlfWMF5xf9_hmV2qCufV-ek"}
```

That is the answer of a server whose token is `example-token-0123456789abcdef`; use it to
check your own implementation.

`proof` is `base64url(HMAC-SHA256(key = the API token, message = "kotiko-proof-v1:" + nonce))`,
without padding (43 characters). The key is the token's UTF-8 bytes as you'd send them
in `Authorization`; the message is the ASCII prefix followed by the nonce exactly as sent.
Compute the same value with the token you have and compare in constant time; send
requests only if they match. Use a new nonce each time.

- `415 invalid_request` (`details.reason`: `content_type`): the request has no
  `Content-Type: application/json`. A web page can't send that type to another site
  without the server's consent (CORS), so it can't use up the limit below.
- `400 invalid_request` (`details.field`: `nonce`): the nonce is missing or not 32 to 128
  base64url characters. The body may be at most 1,000 bytes (`413`).
- `429 rate_limited` (`details.reason`: `too_many_proofs`): more than 30 proofs with a
  well-formed nonce from one address within a minute; `Retry-After` says when to try
  again. Refused requests (`415`, `400`) don't count, and neither do requests from this
  computer (127.0.0.0/8, `::1`, IPv4-mapped 127.x) without a forwarding header, which every
  local program and web page shares. Requests from this computer with a forwarding header
  (a reverse proxy's) are limited all together, as for wrong tokens ([Requests](#requests)).
- The answer never contains the token and is sent with `cache-control: no-store`. Like
  `/health`, it is checked against the `Host` names the server answers to.
- Only this exact path and `POST` are open: any other method or spelling
  (`/%61pi/v1/proof`) needs the token.
- Someone who gets a proof can test guesses at the token offline. A token the server made
  (256 random bits) can't be guessed; a weak one you chose can, and the server warns about
  those at start ([`API_TOKEN`](configuration.md#api_token)).

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
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:4747/api/v1/words?lang=ru&limit=10"
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
  -d '{"text": "shukran", "base_langs": ["en"]}' http://127.0.0.1:4747/api/v1/words
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
- `code`: present when no word was saved: `no_word_found` (nothing found),
  `rejected_same_as_gloss` (every word was already a word in that base language, or its
  meaning was the word itself) or `bad_lookup_result` (the answer couldn't be used).
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

Errors: `400 invalid_request` with `details.field` `words` (not a list, or more than 500;
`details.max` is 500) or `client_request_id`; `413 request_too_large`.

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

### GET /api/v1/profile

The learner's languages, which the Telegram bot uses (slice 41 section 9): the base
languages it looks meanings up in, primary first, and the interface language the learner
chose in the extension.

`200`: `{"base_langs": ["es", "en"], "ui_lang": null, "updated_at": "2026-10-05T21:23:47.123Z"}`.
`ui_lang` is `null` when the learner left the interface language on automatic. A server
that was never told answers `{"base_langs": [], "ui_lang": null, "updated_at": null}`; its
bot then uses the language of the learner's Telegram app.

### PUT /api/v1/profile

Sets the learner's languages. The extension sends this whenever the languages you read in
or Kotiko's interface language change while a server is connected; the bot's `/bases`
command sets `base_langs` too.

Body: `{"base_langs": ["es-PR", "en"], "ui_lang": "es"}`.

- `base_langs` (required): 1 to 4 language tags, primary first. Each is stored as its base
  tag (`es-PR` → `es`, `zh-TW` → `zh-Hant`, `pt-BR` stays); duplicates are dropped.
- `ui_lang` (optional): a language tag, or `"auto"`, `null` or nothing for none chosen.

`200`: the profile, as `GET` returns it. Errors: `400 invalid_request` (`details.field`:
`base_langs`, with `details.max`, or `ui_lang`). The profile is kept as it was.

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
