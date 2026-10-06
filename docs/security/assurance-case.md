# Assurance case

Last reviewed: 2026-10-05.

Why we believe Kotiko meets its [security requirements](requirements.md), written as claims,
the arguments for them, and the evidence (code and tests) behind each argument. It is for
reviewers and future maintainers: read this before changing anything that takes input or
crosses a trust boundary.

Paths are relative to this file. "In place" means the code on `main` does it today;
"planned (slice NN)" means a slice spec in [`slices/`](../../slices/README.md) will build
it and it is not true yet.

## 1. Top claim

**Kotiko meets [requirements.md](requirements.md) in its supported configurations**: the
extension in a current Chrome, Edge, Brave or Firefox, and optionally the server run from
source under the user's own account, listening on loopback or on a Tailscale address, or
on another network the user chose after the startup warning.

Each "You can expect" line in the requirements is a sub-claim. The table maps each one to
its argument and evidence.

| Sub-claim | Argument | Evidence |
|---|---|---|
| Only `/health` answers without the token | One plug runs before routing and allows exactly `GET` and `HEAD` `/health`; everything else needs `Bearer <token>`, compared in constant time. It matches on the raw path, so encoded spellings can't slip past | [`router.ex`](../../server/lib/kotiko/router.ex) `authorize/2`; [`router_auth_test.exs`](../../server/test/kotiko/router_auth_test.exs) "every method and path spelling is 401", "only GET and HEAD /health are open"; [`router_socket_test.exs`](../../server/test/kotiko/router_socket_test.exs) "encoded and dotted paths need the token" (through a real socket) |
| `/health` says nothing else | It returns name, version, API versions and database state only | [`health.ex`](../../server/lib/kotiko/health.ex) `report/1` |
| A strong token, kept private | 32 bytes from `:crypto.strong_rand_bytes`, written to a file made 0600 before the token goes in, then renamed into place; a chosen `API_TOKEN` under 24 characters stops the boot | [`token.ex`](../../server/lib/kotiko/token.ex) `generate/1`, `save/2`, `check/3`; [`token_test.exs`](../../server/test/kotiko/token_test.exs) "first boot makes a 43-character token in a 0600 file", "short or whitespace-only tokens are refused"; [`config.ex`](../../server/lib/kotiko/config.ex) `api_token/1` |
| Other accounts on the computer can't read the words | The BEAM can't set a mode on create, so files are created empty, made 0600, then filled: the database before SQLite opens it (SQLite gives `-wal`, `-shm` and `-journal` the database's mode, checked by a test), each backup before `VACUUM INTO`, the token and model cache through a private temporary file. A data folder the server makes is 0700. At every boot, before the Repo opens, `make_private/1` tightens any of Kotiko's files others can open and the folder when it holds only Kotiko's files, and warns otherwise. `run.sh` sets umask 077 and the unit `UMask=0077` | [`private.ex`](../../server/lib/kotiko/private.ex); [`data_dir.ex`](../../server/lib/kotiko/data_dir.ex) `make_private/1`; [`private_test.exs`](../../server/test/kotiko/private_test.exs); [`data_dir_test.exs`](../../server/test/kotiko/data_dir_test.exs); [`boot_test.exs`](../../server/test/kotiko/boot_test.exs) (boots with umask 022 and checks the modes); [`scripts_test.exs`](../../server/test/kotiko/scripts_test.exs) |
| Listens on this computer unless told otherwise; warns when it doesn't | `BIND` defaults to `127.0.0.1`; at boot the address is classified (loopback, Tailscale, LAN, all interfaces, public) and the last three log a warning; a public address repeats it daily | [`config.ex`](../../server/lib/kotiko/config.ex) `@default_bind`; [`exposure.ex`](../../server/lib/kotiko/exposure.ex) `classify/2`; [`application.ex`](../../server/lib/kotiko/application.ex) `repeat_public_warning/2`; [`exposure_test.exs`](../../server/test/kotiko/exposure_test.exs) |
| Answers only to names it knows | A plug before routing allows `localhost`, IP literals, this machine's own name and `ALLOWED_HOSTS`; others get 421, with or without a token | [`host_check.ex`](../../server/lib/kotiko/plug/host_check.ex); [`host_check_test.exs`](../../server/test/kotiko/plug/host_check_test.exs); [`router_auth_test.exs`](../../server/test/kotiko/router_auth_test.exs) "an unknown name gets 421 with or without a token, on every route" |
| Strangers can't make it do work | Body parsing is a plug after `authorize`; 64 KB cap, 1 MB for the batch route | [`router.ex`](../../server/lib/kotiko/router.ex) `parse_body/2`; [`router_auth_test.exs`](../../server/test/kotiko/router_auth_test.exs) "are parsed only after auth", "over 64 KB are refused with 413"; [`router_v1_test.exs`](../../server/test/kotiko/router_v1_test.exs) "takes at most 500 words, and bodies up to 1 MB" |
| Words go only where the user sent them | The only outbound hosts are `LLM_URL`, `TRANSCRIBE_URL` (both set by the owner), `api.telegram.org` when a bot token is set, and the Wiktionary endpoint with the word percent-encoded in the path; tests can't reach the network at all | [`llm/client.ex`](../../server/lib/kotiko/llm/client.ex); [`transcriber.ex`](../../server/lib/kotiko/transcriber.ex); [`telegram.ex`](../../server/lib/kotiko/telegram.ex); [`pronounce.ex`](../../server/lib/kotiko/pronounce.ex) `fetch_page`; [`spec/wiktionary.json`](../../spec/wiktionary.json) `endpoint`; [`no_network_test.exs`](../../server/test/kotiko/no_network_test.exs) |
| The bot obeys only listed IDs | Every update's sender ID is checked against `ALLOWED_TELEGRAM_IDS` before dispatch; with no list, the bot only replies with the sender's ID | [`bot.ex`](../../server/lib/kotiko/bot.ex) `handle/1`; [`bot_test.exs`](../../server/test/kotiko/bot_test.exs) "messages from people not in ALLOWED_TELEGRAM_IDS are ignored" |
| Keys and tokens stay out of logs | A primary `:logger` filter rewrites every event that contains a configured secret or a key-shaped string; an event it can't read is dropped | [`log/redact.ex`](../../server/lib/kotiko/log/redact.ex); [`redact_test.exs`](../../server/test/kotiko/log/redact_test.exs) |
| Words stay out of logs at the default level | Lookup input and model answers are logged only with `LOG_LOOKUPS=true`, at debug; save failures log the field names, not the values | [`llm.ex`](../../server/lib/kotiko/llm.ex) `log_lookups?/0`; [`router_v1.ex`](../../server/lib/kotiko/router_v1.ex) `result_json/1`; [`llm_test.exs`](../../server/test/kotiko/llm_test.exs) "no path logs the input or a returned word at the default level" |
| Bad settings stop the server; secrets aren't echoed | Every variable is parsed by one function that returns a problem; any problem halts with status 78 and one message; secret problems are labelled "(value hidden)" | [`config.ex`](../../server/lib/kotiko/config.ex) `parse/2`, `secret_error/2`; [`config_test.exs`](../../server/test/kotiko/config_test.exs) "a short API_TOKEN is refused without echoing it" |
| Text never becomes HTML in the extension | ESLint bans `innerHTML`, `outerHTML` and `insertAdjacentHTML` in `extension/` and runs `eslint-plugin-no-unsanitized`; CI fails on any finding | [`eslint.config.js`](../../eslint.config.js); [`ci.yml`](../../.github/workflows/ci.yml) `npm run lint` |
| Pages can't use the extension to change words | One message router checks each sender's kind (extension page or content script) against the handler's allowed list; content scripts may only `sync` and read `sensitiveSites`; `oauth.code` is accepted only from the docs site's callback page (`https://kotiko.org/connect/` with a code; the site's own test checks that page has no script) | [`lib/messages.js`](../../extension/lib/messages.js) `senderKinds`, `createMessageRouter`; [`background.js`](../../extension/background.js) handler table; [`sync-libs.test.mjs`](../../test/unit/sync-libs.test.mjs) "disallowed senders get forbidden"; [`local-mode.test.mjs`](../../test/bg/local-mode.test.mjs) "content scripts can't set, describe or remove secrets, change modes, write words or move them" |
| Key and token out of content scripts' reach | Secrets live in the extension origin's IndexedDB, which content scripts can't open; the upgrade moves an old token out of `storage.local` | [`lib/store.js`](../../extension/lib/store.js) `secrets`; [`lib/local-mode.js`](../../extension/lib/local-mode.js) migration step 6; [`local-mode.test.mjs`](../../test/bg/local-mode.test.mjs) "the key and the server token are in no storage area a content script can read" |
| Answers are checked before use | Server word lists pass `validateWordsResponse` (shape, types, lengths, counts); model answers pass the shared word spec in both runtimes, against the same fixtures | [`lib/validate-words.js`](../../extension/lib/validate-words.js); [`lib/wordspec.js`](../../extension/lib/wordspec.js); [`word_spec.ex`](../../server/lib/kotiko/word_spec.ex) `process/2`; [`sync-libs.test.mjs`](../../test/unit/sync-libs.test.mjs) "validateWordsResponse"; [`wordspec.test.mjs`](../../test/unit/wordspec.test.mjs), [`word_spec_test.exs`](../../server/test/kotiko/word_spec_test.exs) |
| No telemetry | The only network calls are to the user's server, the model provider, OpenRouter's key exchange (when the user signs in there), Telegram and Wiktionary, as listed above and in [`background.js`](../../extension/background.js) and [`lib/llm/client.js`](../../extension/lib/llm/client.js) | Code reading; slice 28 writes the full data inventory (planned) |

## 2. Threat model

### Assets

- The learner's word list: it reveals which languages they study and, through the words,
  something about their life.
- Model API keys (`LLM_API_KEY` on the server, provider keys in the extension): they cost
  money or quota.
- The server token: it gives full control of the word list.
- The Telegram bot token: it lets someone act as the bot.
- Which pages a learner reads: the content script sees every page.

### Attackers and what each can reach

| Attacker | Can reach | Main defences |
|---|---|---|
| A malicious web page | Its own DOM, which the content script reads and changes; HTTP requests from the browser to any address, including the server | Text-only DOM; no CORS headers, so it can't read server answers or send the `Authorization` header; Host check against DNS rebinding; the content script can't add or delete words |
| A script injected into a page | The same as the page; it can see swapped words | Same; nothing secret is put in the page |
| Someone on the same network | Plain-HTTP traffic when the server listens beyond loopback | Loopback by default; startup warnings; Tailscale or HTTPS advice |
| A malicious or broken model answer | The word pipeline on the server or in the extension | Schema and rule checks, length caps, script checks, text-only rendering |
| A Telegram user who isn't allowed | The bot's chat | Sender allowlist |
| Another user on the server machine | Files in the data folder, depending on permissions | Every file the server keeps there is 0600 (the database is created private before SQLite opens it, so `-wal` and `-shm` are too) and a folder it makes 0700; each start re-checks them; `run.sh` and the systemd unit use umask 077 |
| A compromised dependency or GitHub Action | The build, CI, and later the release | Lockfiles, actions pinned by commit SHA, Dependabot, OSV-Scanner over every lockfile in CI and before each release, `mix hex.audit` and `mix deps.audit` in CI, no runtime npm code in the extension |
| A malicious pull request | The code base | Review by a maintainer; CI with read-only token; branch protection on going public ([PUBLIC_CHECKLIST.md](../PUBLIC_CHECKLIST.md)) |

## 3. Trust boundaries

```
 web page (untrusted DOM)
   │  DOM reads and text-node writes only
   ▼
 content script ──runtime messages (sender checked)──▶ background ◀── extension pages
   │  reads words from storage.local                     │            (popup, dashboard,
   │                                                     │             welcome)
   │                          ┌──────────────────────────┤
   │                          │ HTTPS                    │ HTTP(S) + Bearer token
   │                          ▼                          ▼
   │                model provider (answers        your Kotiko server ── Host check,
   │                untrusted), Wiktionary         token check, body cap
   │                                                     │
   │                          ┌──────────────────────────┼─────────────────┐
   │                          ▼ HTTPS                    ▼ HTTPS           ▼ file system
   │                model provider, Wiktionary   Telegram (allowlisted   data folder
   │                (answers untrusted)          sender IDs)             (kotiko.db,
   │                                                                     api-token: 0600)
 CI (GitHub Actions, read-only token) ──▶ stores, after a maintainer approves (slice 30)
```

| Boundary | What crosses | Control | Evidence |
|---|---|---|---|
| Web page to content script | Page text and DOM events | Text nodes only, never HTML; pages in languages the learner doesn't read are left alone | [`eslint.config.js`](../../eslint.config.js); [`content.js`](../../extension/content.js) |
| Content script to background | Runtime messages | Sender kind per handler | [`lib/messages.js`](../../extension/lib/messages.js) |
| Extension pages to background | Runtime messages, including secrets | Allowed only from the extension's own URL; payload checks before handlers run | [`lib/messages.js`](../../extension/lib/messages.js) `checks`; [`background.js`](../../extension/background.js) |
| Extension to server | HTTP with `Authorization: Bearer` | Token check, Host check, body cap; the extension validates the address and every response | [`router.ex`](../../server/lib/kotiko/router.ex); [`lib/url.js`](../../extension/lib/url.js); [`lib/validate-words.js`](../../extension/lib/validate-words.js) |
| Server or extension to model provider | The learner's typed text, the key | HTTPS to an address the owner set; answers parsed as JSON and checked by the word spec; deadline and attempt cap per lookup | [`llm.ex`](../../server/lib/kotiko/llm.ex) `interpret/3`; [`spec/models.json`](../../spec/models.json) budgets; [`lib/llm/client.js`](../../extension/lib/llm/client.js) |
| Server to Telegram | Updates in, messages out | HTTPS; sender allowlist | [`bot.ex`](../../server/lib/kotiko/bot.ex); [`telegram.ex`](../../server/lib/kotiko/telegram.ex) |
| Server to file system | The database, token, backups | `kotiko.db` and its `-wal`/`-shm`, `api-token`, `models-cache.json` 0600; `backups/` 0700 with 0600 files; a data folder the server makes 0700, one that holds only Kotiko's files made 0700 at start (otherwise a warning); umask 077 in `run.sh` and the unit (`UMask=0077`) | [`private.ex`](../../server/lib/kotiko/private.ex); [`data_dir.ex`](../../server/lib/kotiko/data_dir.ex) `make_private/1`; [`migrations.ex`](../../server/lib/kotiko/migrations.ex) `backup!/2`; [`data_dir_test.exs`](../../server/test/kotiko/data_dir_test.exs); [`boot_test.exs`](../../server/test/kotiko/boot_test.exs) |
| CI to stores | Release packages | The store jobs run in the `release` environment: a maintainer approves each run, and only `v*` tags (signed, verified against `.github/allowed_signers`) may deploy. The maintainer creates the environment before the first release | [slice 30](../../slices/30-release-pipeline/SPEC.md) |

## 4. Secure design principles

The eight principles of Saltzer and Schroeder, plus two the badge criteria add.

| Principle | How Kotiko applies it | Evidence |
|---|---|---|
| Economy of mechanism | One auth plug and one Host plug in front of every route; one message router in the extension; one place that parses settings; no bundler or runtime npm code in the extension, so what ships is what reviewers read | [`router.ex`](../../server/lib/kotiko/router.ex); [`lib/messages.js`](../../extension/lib/messages.js); [`config.ex`](../../server/lib/kotiko/config.ex); [CONTRIBUTING.md](../../CONTRIBUTING.md) "Rules that protect users" |
| Fail-safe defaults | Deny by default (only `/health` is open); loopback bind; a token is generated if none is set; a setting the server can't parse stops it; unknown message senders are refused | `authorize/2`; `@default_bind`; [`token.ex`](../../server/lib/kotiko/token.ex) `resolve/2`; `Config.load!/0` |
| Complete mediation | The token check runs on every request before routing, on the raw path, and is tested over encoded and dotted spellings and through a real socket | [`router_auth_test.exs`](../../server/test/kotiko/router_auth_test.exs); [`router_socket_test.exs`](../../server/test/kotiko/router_socket_test.exs) |
| Open design | The code is public; the token and keys are the only secrets | [LICENSE](../../LICENSE) |
| Separation of privilege | Weakly applied. One bearer token grants everything on the server; there is no second factor. The bot needs both the bot token and an allowlisted sender ID. Per-user tokens are planned (slice 48) | [`bot.ex`](../../server/lib/kotiko/bot.ex) `handle/1` |
| Least privilege | Content scripts may only ask for a sync and the sensitive-site list; secrets sit where content scripts can't read them; CI jobs get a read-only token. The extension asks for `<all_urls>` because it works on any page; a permission review is planned (slice 28 section 6); a sandboxed service unit is planned (slice 40) | [`background.js`](../../extension/background.js); [`ci.yml`](../../.github/workflows/ci.yml) `permissions: contents: read`; [`manifest.json`](../../extension/manifest.json) |
| Least common mechanism | Each person runs their own server with their own data folder and bot; there is no shared service run by the project | [DECISIONS.md](../../slices/DECISIONS.md) 2026-10-02 (own bot, no hosted service) |
| Psychological acceptability | Plain-language startup warnings and error messages that name the fix; a pairing string so the token is pasted, not retyped; settings errors list every problem at once | [`exposure.ex`](../../server/lib/kotiko/exposure.ex); [`config.ex`](../../server/lib/kotiko/config.ex) `format_problems/3`; [`mix kotiko.token`](../../server/lib/mix/tasks/kotiko.token.ex) |
| Limited attack surface | One port, loopback by default; a small route list; no CORS; the Telegram bot long-polls, so it needs no public URL or webhook | [`router.ex`](../../server/lib/kotiko/router.ex), [`router_v1.ex`](../../server/lib/kotiko/router_v1.ex); [`bot.ex`](../../server/lib/kotiko/bot.ex) |
| Input validation with allowlists | Settings are checked against allowed forms (port range, host-name pattern, http(s) URLs, log levels, booleans); statuses, origins and pronunciation sources are checked against fixed lists; language tags are canonicalised against CLDR data; request ids must be UUIDs | [`config.ex`](../../server/lib/kotiko/config.ex); [`word_spec.ex`](../../server/lib/kotiko/word_spec.ex) `validate_word/2`, `patch/1`; [`router_v1.ex`](../../server/lib/kotiko/router_v1.ex) `statuses/1`, `limit/1`; [`add_requests.ex`](../../server/lib/kotiko/add_requests.ex) `valid_id?/1` |

## 5. Common weaknesses countered

From the CWE Top 25 and the OWASP Top 10, the entries that apply to a browser extension and
a small JSON API.

| Weakness | Countermeasure | Status | Evidence |
|---|---|---|---|
| CWE-79 Cross-site scripting | The extension never parses strings as HTML; ESLint enforces it. The server returns JSON only | In place | [`eslint.config.js`](../../eslint.config.js) |
| CWE-89 SQL injection | Queries go through Ecto with bound parameters. The few raw statements use fixed table names or `?` parameters; the one built string (`VACUUM INTO` a backup path the server chose) is quoted | In place | [`words.ex`](../../server/lib/kotiko/words.ex); [`data_dir.ex`](../../server/lib/kotiko/data_dir.ex) `sql_string/1` |
| CWE-78 OS command injection | The server runs no external commands (no `System.cmd`, `Port.open` or `:os.cmd` in `server/lib`). The shell scripts read only the owner's `.env` | In place | `server/lib/`; ShellCheck in [`ci.yml`](../../.github/workflows/ci.yml) |
| CWE-22 Path traversal | No file path comes from a request. The data folder comes from the owner's settings; backup names are built from the version and the time. Sobelow fails CI on any new file call with a path it can't rule out; each accepted one says why | In place | [`config.ex`](../../server/lib/kotiko/config.ex) `data_dir/4`; [`migrations.ex`](../../server/lib/kotiko/migrations.ex); [`.sobelow-conf`](../../server/.sobelow-conf) |
| CWE-306, CWE-862 Missing authentication or authorization | Deny by default; one token for everything (no roles yet, so no authorization levels to get wrong) | In place; per-user authorization planned (slice 48) | `authorize/2`; [`router_auth_test.exs`](../../server/test/kotiko/router_auth_test.exs) |
| CWE-352 Cross-site request forgery | The token travels in a header, never a cookie; the server sends no CORS headers, so a page can't attach the header (that needs a preflight the server doesn't answer) | In place | [`router_auth_test.exs`](../../server/test/kotiko/router_auth_test.exs) "a CORS preflight gets no CORS headers" |
| CWE-918 Server-side request forgery | The server fetches only URLs the owner set (`LLM_URL`, `TRANSCRIBE_URL`) and fixed hosts (Telegram, Wiktionary with the word percent-encoded in the path). No request can choose a URL | In place | [`config.ex`](../../server/lib/kotiko/config.ex); [`pronounce.ex`](../../server/lib/kotiko/pronounce.ex) |
| CWE-502 Unsafe deserialization | Nothing from the network becomes an Erlang term: requests and API answers are parsed as JSON, Wiktionary pages are read as text. One call reads back the lookup cache the server itself wrote to its own database, with `Plug.Crypto.non_executable_binary_to_term/2` and `:safe`, so a changed row can neither create atoms nor carry a function; Sobelow checks for any other | In place | [`llm/cache.ex`](../../server/lib/kotiko/llm/cache.ex) `decode/1`; `llm_test.exs` ("a stored entry holding a function is a miss") |
| CWE-400 Resource exhaustion | Body caps (64 KB, 1 MB batch); at most 500 words per batch and 20,000 per list request; each lookup has a deadline and an attempt cap; refused Host names are logged at most once an hour per name. There is no request rate limit for token holders | In place, partly | [`router.ex`](../../server/lib/kotiko/router.ex); [`router_v1.ex`](../../server/lib/kotiko/router_v1.ex) `@max_batch`, `@max_limit`; [`spec/models.json`](../../spec/models.json); [`host_check.ex`](../../server/lib/kotiko/plug/host_check.ex) |
| CWE-20 Improper input validation | Settings validation; the shared word spec and its rules; response validation in the extension; server address validation | In place | Section 6 |
| CWE-798 Hard-coded credentials | No credentials in the code. CI's required `secrets` job runs gitleaks over the full history on every pull request and every push to `main`, and fails a pull request that adds a `.env`, key or token file; GitHub secret scanning and push protection are on | In place | [`ci.yml`](../../.github/workflows/ci.yml) job `secrets`; [`.gitleaks.toml`](../../.gitleaks.toml); [`check-forbidden-files.mjs`](../../scripts/check-forbidden-files.mjs) |
| CWE-532 Secrets in logs | The redaction filter; words only with `LOG_LOOKUPS=true` at debug | In place | [`log/redact.ex`](../../server/lib/kotiko/log/redact.ex); [`llm_test.exs`](../../server/test/kotiko/llm_test.exs) |
| DNS rebinding | Host allowlist before routing | In place | [`host_check.ex`](../../server/lib/kotiko/plug/host_check.ex) |
| Supply chain | Lockfiles (`mix.lock`, `package-lock.json`); every GitHub Action pinned by commit SHA; Dependabot for mix, both npm lockfiles and Actions; OSV-Scanner over all three lockfiles on every pull request, weekly and before each release build; `mix hex.audit` and `mix deps.audit` in CI; no runtime npm code in the extension; review on every pull request ([policy](dependency-and-static-analysis-policy.md)). Not yet: release attestations (slice 30) | In place, partly | [`dependency-scan.yml`](../../.github/workflows/dependency-scan.yml); [`ci.yml`](../../.github/workflows/ci.yml); [`dependabot.yml`](../../.github/dependabot.yml); [`package.json`](../../package.json) |

## 6. Inputs and how each is validated

| Input | Where it enters | Rule | Location |
|---|---|---|---|
| HTTP method, path, headers | Every request | Host allowlist; exactly one `Authorization: Bearer` header compared in constant time; unknown routes 404 | [`host_check.ex`](../../server/lib/kotiko/plug/host_check.ex); [`router.ex`](../../server/lib/kotiko/router.ex) |
| HTTP body | `POST` and `PATCH` routes | JSON only, size cap, parsed after auth; then per-field checks: text 1 to 200 characters after normalisation, base languages (at most 4, canonical tags), `client_request_id` a UUID, word fields against the word spec and its caps, `limit` 1 to 20,000, `status` from a fixed list, `if_updated_at` an ISO 8601 time | [`router_v1.ex`](../../server/lib/kotiko/router_v1.ex); [`word_spec.ex`](../../server/lib/kotiko/word_spec.ex) `prepare_input/1`, `validate_word/2`, `patch/1`; [`spec/rules.json`](../../spec/rules.json) |
| Legacy `POST /api/words` body | 0.2 extensions | Text must be a non-empty string; not run through the 200-character input check (the 64 KB body cap applies) | [`router.ex`](../../server/lib/kotiko/router.ex) |
| Environment (`.env`) | Server start | One parser per variable; any problem stops the server | [`config.ex`](../../server/lib/kotiko/config.ex) `parse/2` |
| Data files | Server start | The token file must hold at least 24 characters; migrations back up before changing the database | [`token.ex`](../../server/lib/kotiko/token.ex); [`migrations.ex`](../../server/lib/kotiko/migrations.ex) |
| Model answers | Server and extension lookups | JSON extracted, then the word spec: required fields, canonical language tags, script check against the text, length caps, at most 5 distinct words, forms checked against the meaning, stopwords | [`word_spec.ex`](../../server/lib/kotiko/word_spec.ex) `process/2`; [`lib/wordspec.js`](../../extension/lib/wordspec.js); [`spec/model-output.schema.json`](../../spec/model-output.schema.json) |
| Wiktionary pages | Pronunciation lookups | Only the IPA spans of the language's section are read, as text; the respelling written from them is checked like any pronunciation | [`pronounce.ex`](../../server/lib/kotiko/pronounce.ex); [`lib/pronounce.js`](../../extension/lib/pronounce.js) |
| Telegram updates | The bot | Sender ID against the allowlist; then the same lookup pipeline as the popup. Bot text is not run through the 200-character input check | [`bot.ex`](../../server/lib/kotiko/bot.ex) |
| Extension messages | The background | Sender kind, then the handler's payload `check` | [`lib/messages.js`](../../extension/lib/messages.js); [`background.js`](../../extension/background.js) |
| Server responses in the extension | Sync | Status, content type, JSON shape, word fields and counts | [`lib/validate-words.js`](../../extension/lib/validate-words.js) |
| The server address the learner types | Extension settings | http(s) only, no user info in the URL, https assumed for non-local names | [`lib/url.js`](../../extension/lib/url.js) |
| Pasted lists and dropped files | Bulk add | Parsed as text in the extension; each row then saved through the word checks | [`bulk/parse.js`](../../extension/bulk/parse.js); a backup file is read by [`lib/backup.js`](../../extension/lib/backup.js) `read`, which checks every word against the word spec before anything is restored |
| The page DOM | Content script | Read as text; only text nodes in languages the learner reads are changed | [`content.js`](../../extension/content.js), [`lib/matcher.js`](../../extension/lib/matcher.js) |

## 7. Residual risks and assumptions

These match "What you can't expect" in the [requirements](requirements.md).

- **Data at rest is not encrypted.** Anyone who can read the browser profile or the data
  folder gets the words, keys and token. Assumption: the user's account and disk are theirs.
- **A shared data folder stays shared.** When `KOTIKO_DATA_DIR` points at a folder that
  also holds other files, the server makes its own files private but leaves the folder's
  permissions alone and warns at every start; other accounts can then see the files' names
  and sizes, not their contents. On a disk that keeps no POSIX permissions (a Windows drive
  in WSL) nothing can be made private; the server warns.
- **Plain HTTP beyond loopback** exposes the token and words to the network. The server
  warns; it does not refuse.
- **The model provider sees every lookup**, under its own terms.
- **Pages can see swapped words** in their own DOM.
- **One token, full access.** Anyone with it can read, change and delete every word.
- **Model answers are checked, not verified**; a plausible wrong meaning can be saved.
- **No rate limit** for requests that carry the token.
- **Response hardening headers** (`X-Content-Type-Options` and similar) are not sent yet;
  only `/health` sends `cache-control: no-store`. Planned (slice 01 section 7).
- **No releases yet**, so there are no signatures or attestations to verify; users run
  from source. The release pipeline that signs, attests and builds reproducibly is in place
  (slice 30); the first release is v1.0.0.

## 8. Maintenance

- **Same pull request.** Any change that adds an input, adds an outbound destination, or
  crosses a trust boundary updates this file and [requirements.md](requirements.md) in the
  same pull request.
- **Full review** at each minor release and after every security report, by the security
  response lead; the "Last reviewed" date at the top changes then.
- **After a vulnerability** that crossed a trust boundary, the fix adds a regression test
  and a row or a correction here.
- A line moves from "planned" to "in place" only when the code is on `main`, with its
  evidence linked.
