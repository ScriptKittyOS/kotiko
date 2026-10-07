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
| Only `/health` answers without the token | One plug runs before routing and allows exactly `GET` and `HEAD` `/health` (and the proof, which reveals nothing); everything else needs `Bearer <token>` or a request signed with it (`Kotiko-HMAC`), each compared in constant time. It matches on the raw path, so encoded spellings can't slip past; every route, v1 and 0.2, goes through it | [`router.ex`](../../server/lib/kotiko/router.ex) `authorize/2`; [`router_auth_test.exs`](../../server/test/kotiko/router_auth_test.exs) "every method and path spelling is 401", "only GET and HEAD /health are open"; [`router_socket_test.exs`](../../server/test/kotiko/router_socket_test.exs) "encoded and dotted paths need the token" (through a real socket); [`router_signed_test.exs`](../../server/test/kotiko/router_signed_test.exs) "every route" |
| `/health` says nothing else | It returns name, version, API versions and database state only | [`health.ex`](../../server/lib/kotiko/health.ex) `report/1` |
| A strong token, kept private | 32 bytes from `:crypto.strong_rand_bytes`, written to a file made 0600 before the token goes in, then renamed into place; a chosen `API_TOKEN` under 24 characters stops the boot | [`token.ex`](../../server/lib/kotiko/token.ex) `generate/1`, `save/2`, `check/3`; [`token_test.exs`](../../server/test/kotiko/token_test.exs) "first boot makes a 43-character token in a 0600 file", "short or whitespace-only tokens are refused"; [`config.ex`](../../server/lib/kotiko/config.ex) `api_token/1` |
| Other accounts on the computer can't read the words | The BEAM can't set a mode on create, so files are created empty, made 0600, then filled: the database before SQLite opens it (SQLite gives `-wal`, `-shm` and `-journal` the database's mode, checked by a test), each backup before `VACUUM INTO`, the token and model cache through a private temporary file. A data folder the server makes is 0700. At every boot, before the Repo opens, `make_private/1` tightens any of Kotiko's files others can open and the folder when it holds only Kotiko's files, and warns otherwise. Before that, `check_safe/2` refuses to start when someone else could have planted a file Kotiko would trust: the folder or a Kotiko file owned by another uid, a Kotiko file that is a symlink, or a folder others can write in that also holds other files (B-02); `api-token` is read with `lstat`, open, `fstat` and compare, never through a link. `run.sh` sets umask 077 and the unit `UMask=0077` | [`private.ex`](../../server/lib/kotiko/private.ex) `read_own/3`; [`data_dir.ex`](../../server/lib/kotiko/data_dir.ex) `check_safe/2`, `make_private/1`; [`private_test.exs`](../../server/test/kotiko/private_test.exs); [`data_dir_test.exs`](../../server/test/kotiko/data_dir_test.exs); [`boot_test.exs`](../../server/test/kotiko/boot_test.exs) (boots with umask 022 and checks the modes); [`scripts_test.exs`](../../server/test/kotiko/scripts_test.exs) |
| Listens on this computer unless told otherwise; warns when it doesn't | `BIND` defaults to `127.0.0.1`, and a loopback `BIND` holds the port on `::1` too, so no other account can listen where a browser sends `localhost` (B-01); at boot the address is classified (loopback, Tailscale, LAN, all interfaces, public) and the last three log a warning; a public address repeats it daily | [`config.ex`](../../server/lib/kotiko/config.ex) `@default_bind`; [`exposure.ex`](../../server/lib/kotiko/exposure.ex) `classify/2`; [`application.ex`](../../server/lib/kotiko/application.ex) `repeat_public_warning/2`; [`listener.ex`](../../server/lib/kotiko/listener.ex) `addresses/1`; [`exposure_test.exs`](../../server/test/kotiko/exposure_test.exs) |
| Answers only to names it knows | A plug before routing allows `localhost`, IP literals, this machine's own name and `ALLOWED_HOSTS`; others get 421, with or without a token | [`host_check.ex`](../../server/lib/kotiko/plug/host_check.ex); [`host_check_test.exs`](../../server/test/kotiko/plug/host_check_test.exs); [`router_auth_test.exs`](../../server/test/kotiko/router_auth_test.exs) "an unknown name gets 421 with or without a token, on every route" |
| Strangers can't make it do work | Body parsing is a plug after `authorize`; 64 KB cap, 1 MB for the batch route | [`router.ex`](../../server/lib/kotiko/router.ex) `parse_body/2`; [`router_auth_test.exs`](../../server/test/kotiko/router_auth_test.exs) "are parsed only after auth", "over 64 KB are refused with 413"; [`router_v1_test.exs`](../../server/test/kotiko/router_v1_test.exs) "takes at most 500 words, and bodies up to 1 MB" |
| Words go only where the user sent them | The only outbound hosts are `LLM_URL`, `TRANSCRIBE_URL` (both set by the owner), `api.telegram.org` when a bot token is set, and the Wiktionary endpoint with the word percent-encoded in the path; tests can't reach the network at all | [`llm/client.ex`](../../server/lib/kotiko/llm/client.ex); [`transcriber.ex`](../../server/lib/kotiko/transcriber.ex); [`telegram.ex`](../../server/lib/kotiko/telegram.ex); [`pronounce.ex`](../../server/lib/kotiko/pronounce.ex) `fetch_page`; [`spec/wiktionary.json`](../../spec/wiktionary.json) `endpoint`; [`no_network_test.exs`](../../server/test/kotiko/no_network_test.exs) |
| The bot obeys only listed IDs | Every update's sender ID is checked against `ALLOWED_TELEGRAM_IDS` before dispatch; with no list, the bot only replies with the sender's ID | [`bot.ex`](../../server/lib/kotiko/bot.ex) `handle/1`; [`bot_test.exs`](../../server/test/kotiko/bot_test.exs) "messages from people not in ALLOWED_TELEGRAM_IDS are ignored" |
| Keys and tokens stay out of logs | A primary `:logger` filter rewrites every event that contains a configured secret (the four secret settings and the values in `LLM_URL`'s and `TRANSCRIBE_URL`'s queries, E-03) or a key-shaped string; an event it can't read is dropped. Service addresses are logged without user name, password or query (`?…`) | [`log/redact.ex`](../../server/lib/kotiko/log/redact.ex); [`config.ex`](../../server/lib/kotiko/config.ex) `loggable_url/1`, `url_secrets/1`; [`redact_test.exs`](../../server/test/kotiko/log/redact_test.exs); [`startup_summary_test.exs`](../../server/test/kotiko/startup_summary_test.exs) "a key in LLM_URL's or TRANSCRIBE_URL's query (E-03)" |
| Words stay out of logs at the default level | Lookup input and model answers are logged only with `LOG_LOOKUPS=true`, at debug; save failures log the field names, not the values | [`llm.ex`](../../server/lib/kotiko/llm.ex) `log_lookups?/0`; [`router_v1.ex`](../../server/lib/kotiko/router_v1.ex) `result_json/1`; [`llm_test.exs`](../../server/test/kotiko/llm_test.exs) "no path logs the input or a returned word at the default level" |
| Bad settings stop the server; secrets aren't echoed | Every variable is parsed by one function that returns a problem; any problem halts with status 78 and one message; secret problems are labelled "(value hidden)" | [`config.ex`](../../server/lib/kotiko/config.ex) `parse/2`, `secret_error/2`; [`config_test.exs`](../../server/test/kotiko/config_test.exs) "a short API_TOKEN is refused without echoing it" |
| Text never becomes HTML in the extension | ESLint bans `innerHTML`, `outerHTML` and `insertAdjacentHTML` in `extension/` and runs `eslint-plugin-no-unsanitized`; CI fails on any finding | [`eslint.config.js`](../../eslint.config.js); [`ci.yml`](../../.github/workflows/ci.yml) `npm run lint` |
| Pages can't use the extension to change words | One message router checks each sender's kind (extension page or content script) against the handler's allowed list; content scripts may only `sync`, read `sensitiveSites` and mark one word never to swap (`neverSwap`); `oauth.code` is accepted only from the docs site's callback page (`https://kotiko.org/connect/` with a code; the site's own test checks that page has no script), and only with the random `state` of the sign-in waiting, so a page that opens the callback with a code of its own neither reaches OpenRouter nor uses up the sign-in | [`lib/messages.js`](../../extension/lib/messages.js) `senderKinds`, `createMessageRouter`; [`background.js`](../../extension/background.js) handler table; [`sync-libs.test.mjs`](../../test/unit/sync-libs.test.mjs) "disallowed senders get forbidden"; [`local-mode.test.mjs`](../../test/bg/local-mode.test.mjs) "content scripts can't set, describe or remove secrets, change modes, write words or move them" |
| Pages can't change your settings, word list or add queue | Content scripts can write `storage.local` and `storage.sync` (Firefox can't stop them). The background keeps the real copy of every setting, of the pages' word list and of the add jobs in its IndexedDB, reads only that, and mirrors it to `storage.local`; a change it didn't make there is put back and an unknown key removed. Pages change settings with `settings.set` (pages only), checked against an allowlist of keys and shapes; content scripts may only add or remove one never-swap word. Chrome 140+ closes `storage.sync` to content scripts (`setAccessLevel`), and only then are changes there taken | [`lib/settings.js`](../../extension/lib/settings.js) `createArea`, `edit`; [`background.js`](../../extension/background.js) `area`, `adoptOnce`, `adoptSync`, `saveSettings`; [`settings.test.mjs`](../../test/bg/settings.test.mjs) (one test per attack); [`settings.test.mjs`](../../test/unit/settings.test.mjs); [`privacy.spec.mjs`](../../test/e2e/privacy.spec.mjs) "settings, the add queue and the bases written from a content script are put back and never used" |
| The token never leaves the browser, and a server that doesn't hold it gets nothing it can use | The extension never sends the token (slice 54, D-01). It signs each request with it: HMAC-SHA256 over the method, the path and query, a timestamp, a random nonce, the server's boot id and the body's SHA-256 (`Authorization: Kotiko-HMAC v2 ...`). The server checks the MAC in constant time, refuses a request signed for another boot id (a new random one at each start, given with the proof and MAC'd for its nonce; security review E-01), a timestamp more than 120 s off either way and a nonce it has seen, and checks the body it reads against the signed hash; a failed signature counts like a wrong token (a `stale_boot` one, whose MAC matched, doesn't; the extension proves again and resends it once). It signs every answer to an accepted request (`X-Kotiko-Server`, HMAC over the nonce and status), and the extension uses no answer without that signature: it forgets the server's proof and sends nothing more until a new one. Before the first request to an address, and before any request that carries the learner's words or settings (anything but `GET`) when the last proof is over 30 s old, the server proves it holds the token (`POST /api/v1/proof`, HMAC of a fresh nonce, checked with WebCrypto); a missing or wrong proof means nothing is sent. The proof is also forgotten on `server.connect`, an address or token change and any connection error. The extension uses `127.0.0.1` for a typed `localhost` (B-01) | [`lib/server-auth.js`](../../extension/lib/server-auth.js); [`background.js`](../../extension/background.js) `request`, `proveServer`, `askProof`; [`request_auth.ex`](../../server/lib/kotiko/request_auth.ex); [`router.ex`](../../server/lib/kotiko/router.ex) `check_signed/3`, `parse_body/2`; [`router_signed_test.exs`](../../server/test/kotiko/router_signed_test.exs) (the vectors, wrong MAC, stale time, replay, a request signed before a restart, tampered body, every route); [`server-auth.test.mjs`](../../test/unit/server-auth.test.mjs) (the same vectors); [`background.test.mjs`](../../test/bg/background.test.mjs) "signed requests: the token never leaves the browser (D-01)" (with the `stale_boot` retry), "the server proves it holds the token before it gets it"; [`fullstack.spec.mjs`](../../test/e2e/fullstack.spec.mjs) "a request caught while the server was stopped" (reviewer E's replay after a restart, on the real server); [`loopback.spec.mjs`](../../test/e2e/loopback.spec.mjs) "after the server stops and a listener takes its port, the listener gets no token and no word" |
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
| A script injected into a page | The same as the page; it can see swapped words | Same; nothing secret is put in the page; only text the learner sees is swapped, at most 500 concepts a page view; page-made events can't open the word card or switch Kotiko off |
| Someone on the same network | Plain-HTTP traffic when the server listens beyond loopback | Loopback by default; startup warnings; Tailscale or HTTPS advice |
| A malicious or broken model answer | The word pipeline on the server or in the extension | Schema and rule checks, length caps, script checks, text-only rendering |
| A Telegram user who isn't allowed | The bot's chat | Sender allowlist |
| Another user on the server machine | Files in the data folder, depending on permissions | Every file the server keeps there is 0600 (the database is created private before SQLite opens it, so `-wal` and `-shm` are too) and a folder it makes 0700; each start re-checks them; `run.sh` and the systemd unit use umask 077 |
| A compromised dependency or GitHub Action | The build, CI, and later the release | Lockfiles, actions pinned by commit SHA, Dependabot, OSV-Scanner over every lockfile in CI and before each release, `mix hex.audit` and `mix deps.audit` in CI, no runtime npm code in the extension |
| A malicious pull request | The code base | Required CI checks before merging (the `main` ruleset), with a read-only token; on a pull request the secret and dependency scans take their allowlists and check scripts from the base commit, so it can't switch them off ([`base-file.sh`](../../scripts/base-file.sh)). Review by a maintainer who isn't the author is the aim but not enforced (section 7) |

## 3. Trust boundaries

```
 web page (untrusted DOM)
   │  DOM reads and text-node writes only
   ▼
 content script ──runtime messages (sender checked)──▶ background ◀── extension pages
   │  reads words from storage.local                     │            (popup, dashboard,
   │                                                     │             welcome)
   │                          ┌──────────────────────────┤
   │                          │ HTTPS                    │ HTTP(S), each request and
   │                          │                          │ answer signed with the token
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
| Content script to `storage.local` and `storage.sync` | Writes the browser allows (Firefox can't forbid them) | Not trusted: the background acts only on its IndexedDB copy and puts the mirror back; `storage.sync` closed to content scripts where the browser can (Chrome 140+) | [`lib/settings.js`](../../extension/lib/settings.js); [`background.js`](../../extension/background.js) `storage.onChanged` listener |
| Extension pages to background | Runtime messages, including secrets | Allowed only from the extension's own URL; payload checks before handlers run | [`lib/messages.js`](../../extension/lib/messages.js) `checks`; [`background.js`](../../extension/background.js) |
| Extension to server | HTTP, each request signed with the token (never the token itself), each answer signed by the server | Signature check (MAC, time, nonce, body hash), Host check, body cap; the extension checks the server's proof and the signature on every answer, then the address and every response | [`router.ex`](../../server/lib/kotiko/router.ex); [`request_auth.ex`](../../server/lib/kotiko/request_auth.ex); [`lib/server-auth.js`](../../extension/lib/server-auth.js); [`lib/url.js`](../../extension/lib/url.js); [`lib/validate-words.js`](../../extension/lib/validate-words.js) |
| Server or extension to model provider | The learner's typed text, the key | HTTPS to an address the owner set; answers parsed as JSON and checked by the word spec; deadline and attempt cap per lookup | [`llm.ex`](../../server/lib/kotiko/llm.ex) `interpret/3`; [`spec/models.json`](../../spec/models.json) budgets; [`lib/llm/client.js`](../../extension/lib/llm/client.js) |
| Server to Telegram | Updates in, messages out | HTTPS; sender allowlist | [`bot.ex`](../../server/lib/kotiko/bot.ex); [`telegram.ex`](../../server/lib/kotiko/telegram.ex) |
| Server to file system | The database, token, backups | `kotiko.db` and its `-wal`/`-shm`, `api-token`, `models-cache.json` 0600; `backups/` 0700 with 0600 files; a data folder the server makes 0700, one that holds only Kotiko's files made 0700 at start (otherwise a warning); umask 077 in `run.sh` and the unit (`UMask=0077`) | [`private.ex`](../../server/lib/kotiko/private.ex); [`data_dir.ex`](../../server/lib/kotiko/data_dir.ex) `make_private/1`; [`migrations.ex`](../../server/lib/kotiko/migrations.ex) `backup!/2`; [`data_dir_test.exs`](../../server/test/kotiko/data_dir_test.exs); [`boot_test.exs`](../../server/test/kotiko/boot_test.exs) |
| CI to stores | Release packages | The store jobs run in the `release` environment (created 2026-10-06): its required reviewer, the maintainer, approves each run, and only `v*` tags may deploy. A tag is built only if it is signed by a key in `.github/allowed_signers` on `main`, under its own name, and only the release manager can create one. The stores get the release's own zips, checked against `SHA256SUMS` | [slice 30](../../slices/30-release-pipeline/SPEC.md); [`release.yml`](../../.github/workflows/release.yml); [`verify-tag.sh`](../../scripts/verify-tag.sh) |

## 4. Secure design principles

The eight principles of Saltzer and Schroeder, plus two the badge criteria add.

| Principle | How Kotiko applies it | Evidence |
|---|---|---|
| Economy of mechanism | One auth plug and one Host plug in front of every route; one message router in the extension; one place that parses settings; no bundler or runtime npm code in the extension, so what ships is what reviewers read | [`router.ex`](../../server/lib/kotiko/router.ex); [`lib/messages.js`](../../extension/lib/messages.js); [`config.ex`](../../server/lib/kotiko/config.ex); [CONTRIBUTING.md](../../CONTRIBUTING.md) "Rules that protect users" |
| Fail-safe defaults | Deny by default (only `/health` is open); loopback bind; a token is generated if none is set; a setting the server can't parse stops it; unknown message senders are refused | `authorize/2`; `@default_bind`; [`token.ex`](../../server/lib/kotiko/token.ex) `resolve/2`; `Config.load!/0` |
| Complete mediation | The token check runs on every request before routing, on the raw path, and is tested over encoded and dotted spellings and through a real socket | [`router_auth_test.exs`](../../server/test/kotiko/router_auth_test.exs); [`router_socket_test.exs`](../../server/test/kotiko/router_socket_test.exs) |
| Open design | The code is public; the token and keys are the only secrets | [LICENSE](../../LICENSE) |
| Separation of privilege | Weakly applied. One token grants everything on the server; there is no second factor. The bot needs both the bot token and an allowlisted sender ID. Per-user tokens are planned (slice 48) | [`bot.ex`](../../server/lib/kotiko/bot.ex) `handle/1` |
| Least privilege | Content scripts may only ask for a sync and the sensitive-site list (and mark one word never to swap), and change no setting; secrets sit where content scripts can't read them; CI jobs get a read-only token. The extension asks for `<all_urls>` because it works on any page; a permission review is planned (slice 28 section 6); a sandboxed service unit is planned (slice 40) | [`background.js`](../../extension/background.js); [`ci.yml`](../../.github/workflows/ci.yml) `permissions: contents: read`; [`manifest.json`](../../extension/manifest.json) |
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
| CWE-306, CWE-862 Missing authentication or authorization | Deny by default; one token for everything (no roles yet, so no authorization levels to get wrong). The only open routes are `/health` and `POST /api/v1/proof`, which proves the server holds the token (HMAC of a client nonce) without revealing it | In place; per-user authorization planned (slice 48) | `authorize/2`; [`token.ex`](../../server/lib/kotiko/token.ex) `proof/2`; [`router_auth_test.exs`](../../server/test/kotiko/router_auth_test.exs); [`router_proof_test.exs`](../../server/test/kotiko/router_proof_test.exs) |
| CWE-307 Excessive authentication attempts | After 10 wrong tokens or failed signatures from one address (an IPv6 /64) within a minute, that address gets 429 on every authenticated route until the minute ends; other addresses are unaffected; the lockout is logged once an hour per address. Proofs with a well-formed nonce and `Content-Type: application/json` are limited to 30 a minute per address; malformed ones are refused before they are counted, so a web page (which can't send JSON cross-site without CORS) can't use them up. Requests from this computer's own addresses (127.0.0.0/8, `::1`, IPv4-mapped 127.x) without a forwarding header are exempt from both (slice 54, D-02): every local program and web page shares them, so a limit there would let any of them lock the extension out. Loopback requests with a forwarding header (`Forwarded`, `Forwarded-For`, `X-Forwarded`, any `X-Forwarded-*`, `X-Original-Forwarded-For`, `X-Real-IP`, `X-Client-IP`, `X-Cluster-Client-IP`, `CF-Connecting-IP`, `True-Client-IP`, `Fastly-Client-IP`, `Via`, `Tailscale-User-*`; security review E-02), which is how a reverse proxy on the same machine forwards remote clients, keep both limits, counted together per proxy address whatever client the header claims (it can be forged); the extension on this computer sends no such header, so a local program that adds one locks out only the proxied requests (the owner's other devices behind the proxy among them). With `TRUSTED_PROXY_HEADER` (validated at start) naming the header the proxy sets, each proxied client is counted by that header's address (rightmost `X-Forwarded-For`, last `Forwarded` `for=`, or the one `X-Real-IP`/`CF-Connecting-IP`), normalised like a peer, so a stranger locks out only themselves. A proxy that adds none of the listed headers makes its clients look local (unlimited); the reference says so. A generated token (256 random bits) can't be guessed; a proof lets someone test guesses offline, so a weak chosen token gets a warning at start | In place | [`auth_throttle.ex`](../../server/lib/kotiko/auth_throttle.ex); [`rate_limit.ex`](../../server/lib/kotiko/rate_limit.ex) `peer/1`; [`router_throttle_test.exs`](../../server/test/kotiko/router_throttle_test.exs) "this computer's addresses are never locked out", "loopback requests with a forwarding header are limited together", "every forwarding header a proxy may add keeps the limit", "with TRUSTED_PROXY_HEADER, each proxied client is counted on its own"; [`rate_limit_test.exs`](../../server/test/kotiko/rate_limit_test.exs) "TRUSTED_PROXY_HEADER (E-02)"; [`router_proof_test.exs`](../../server/test/kotiko/router_proof_test.exs) "31 malformed proofs", "this computer's addresses aren't limited", "proofs through a reverse proxy on this computer are limited together" |
| CWE-352 Cross-site request forgery | The credential (a `Bearer` token or a request signature) travels in a header, never a cookie; the server sends no CORS headers, so a page can't attach the header (that needs a preflight the server doesn't answer) | In place | [`router_auth_test.exs`](../../server/test/kotiko/router_auth_test.exs) "a CORS preflight gets no CORS headers" |
| CWE-918 Server-side request forgery | The server fetches only URLs the owner set (`LLM_URL`, `TRANSCRIBE_URL`) and fixed hosts (Telegram, Wiktionary with the word percent-encoded in the path). No request can choose a URL | In place | [`config.ex`](../../server/lib/kotiko/config.ex); [`pronounce.ex`](../../server/lib/kotiko/pronounce.ex) |
| CWE-502 Unsafe deserialization | Nothing from the network becomes an Erlang term: requests and API answers are parsed as JSON, Wiktionary pages are read as text. One call reads back the lookup cache the server itself wrote to its own database, with `Plug.Crypto.non_executable_binary_to_term/2` and `:safe`, so a changed row can neither create atoms nor carry a function; Sobelow checks for any other | In place | [`llm/cache.ex`](../../server/lib/kotiko/llm/cache.ex) `decode/1`; `llm_test.exs` ("a stored entry holding a function is a miss") |
| CWE-400 Resource exhaustion | Body caps (64 KB, 1 MB batch); at most 500 words per batch and 20,000 per list request; each lookup has a deadline and an attempt cap; refused Host names are logged at most once an hour per name, for at most 1,000 names an hour, then one summary line (`log/limiter.ex`). Wrong tokens and proofs are limited per address (CWE-307). There is no request rate limit for token holders | In place, partly | [`router.ex`](../../server/lib/kotiko/router.ex); [`router_v1.ex`](../../server/lib/kotiko/router_v1.ex) `@max_batch`, `@max_limit`; [`spec/models.json`](../../spec/models.json); [`host_check.ex`](../../server/lib/kotiko/plug/host_check.ex) |
| CWE-20 Improper input validation | Settings validation; the shared word spec and its rules; response validation in the extension; server address validation | In place | Section 6 |
| CWE-798 Hard-coded credentials | No credentials in the code. CI's required `secrets` job runs gitleaks over the full history on every pull request and every push to `main`, and fails a pull request that adds a `.env`, key or token file; GitHub secret scanning and push protection are on | In place | [`ci.yml`](../../.github/workflows/ci.yml) job `secrets`; [`.gitleaks.toml`](../../.gitleaks.toml); [`check-forbidden-files.mjs`](../../scripts/check-forbidden-files.mjs) |
| CWE-532 Secrets in logs | The redaction filter; words only with `LOG_LOOKUPS=true` at debug | In place | [`log/redact.ex`](../../server/lib/kotiko/log/redact.ex); [`llm_test.exs`](../../server/test/kotiko/llm_test.exs) |
| DNS rebinding | Host allowlist before routing | In place | [`host_check.ex`](../../server/lib/kotiko/plug/host_check.ex) |
| Supply chain | Lockfiles (`mix.lock`, `package-lock.json`); every GitHub Action pinned by commit SHA; Dependabot for mix, both npm lockfiles and Actions; OSV-Scanner over all three lockfiles on every pull request, weekly and before each release build; `mix hex.audit` and `mix deps.audit` in CI; no runtime npm code in the extension; required CI checks on every pull request, though not a second person's review ([policy](dependency-and-static-analysis-policy.md)). Not yet: release attestations (slice 30) | In place, partly | [`dependency-scan.yml`](../../.github/workflows/dependency-scan.yml); [`ci.yml`](../../.github/workflows/ci.yml); [`dependabot.yml`](../../.github/dependabot.yml); [`package.json`](../../package.json) |

## 6. Inputs and how each is validated

| Input | Where it enters | Rule | Location |
|---|---|---|---|
| HTTP method, path, headers | Every request | Host allowlist; exactly one `Authorization` header: `Bearer` compared in constant time, or `Kotiko-HMAC v2` in exactly one form (time 1 to 12 digits, nonce 22 to 128 base64url, boot id 22 to 64 base64url, body hash 64 hex, MAC 43 base64url), its MAC compared in constant time, its boot id this start's, its time within 120 s either way, its nonce unseen; unknown routes 404 | [`host_check.ex`](../../server/lib/kotiko/plug/host_check.ex); [`router.ex`](../../server/lib/kotiko/router.ex) |
| HTTP body | `POST` and `PATCH` routes | JSON only, size cap, parsed after auth (a signed request's body read first, within the cap, and checked against its signed hash); then per-field checks: text 1 to 200 characters after normalisation, base languages (at most 4, canonical tags), `client_request_id` a UUID, word fields against the word spec and its caps, `limit` 1 to 20,000, `status` from a fixed list, `if_updated_at` an ISO 8601 time | [`router_v1.ex`](../../server/lib/kotiko/router_v1.ex); [`word_spec.ex`](../../server/lib/kotiko/word_spec.ex) `prepare_input/1`, `validate_word/2`, `patch/1`; [`spec/rules.json`](../../spec/rules.json) |
| Legacy `POST /api/words` body | 0.2 extensions | Text must be a non-empty string; not run through the 200-character input check (the 64 KB body cap applies) | [`router.ex`](../../server/lib/kotiko/router.ex) |
| Environment (`.env`) | Server start | One parser per variable; any problem stops the server | [`config.ex`](../../server/lib/kotiko/config.ex) `parse/2` |
| Data files | Server start | The token file must hold at least 24 characters; migrations back up before changing the database | [`token.ex`](../../server/lib/kotiko/token.ex); [`migrations.ex`](../../server/lib/kotiko/migrations.ex) |
| Model answers | Server and extension lookups | JSON extracted, then the word spec: required fields, canonical language tags, script check against the text, length caps, at most 5 distinct words, forms checked against the meaning, stopwords | [`word_spec.ex`](../../server/lib/kotiko/word_spec.ex) `process/2`; [`lib/wordspec.js`](../../extension/lib/wordspec.js); [`spec/model-output.schema.json`](../../spec/model-output.schema.json) |
| Wiktionary pages | Pronunciation lookups | Only the IPA spans of the language's section are read, as text; the respelling written from them is checked like any pronunciation | [`pronounce.ex`](../../server/lib/kotiko/pronounce.ex); [`lib/pronounce.js`](../../extension/lib/pronounce.js) |
| Telegram updates | The bot | Sender ID against the allowlist; then the same lookup pipeline as the popup. Bot text is not run through the 200-character input check | [`bot.ex`](../../server/lib/kotiko/bot.ex) |
| Extension messages | The background | Sender kind, then the handler's payload `check` | [`lib/messages.js`](../../extension/lib/messages.js); [`background.js`](../../extension/background.js) |
| Settings a page changes (`settings.set`, `settings.restore`) | The background | Allowlist of keys; per-key shape and size (booleans, host and language-tag lists with caps, objects up to a byte cap, the four `ui` fields); a restore takes only what `settingsPatch` allows, never addresses or the service | [`lib/settings.js`](../../extension/lib/settings.js) `edit`; [`lib/backup.js`](../../extension/lib/backup.js) `settingsPatch` |
| `storage.local` and `storage.sync` as read back | The background | Never trusted after the one-time adoption: compared with the IndexedDB copy and put back; `storage.sync` changes taken only where content scripts can't write there | [`background.js`](../../extension/background.js) `adoptOnce`, `adoptSync` |
| Server responses in the extension | Every request to the server | The server's signature on the status (`X-Kotiko-Server`) before anything else is read; then status, content type, JSON shape, word fields and counts | [`lib/validate-words.js`](../../extension/lib/validate-words.js) |
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
  and sizes, not their contents. A folder others can write in stops the start, since they
  could plant a token or a database link. On a disk that keeps no POSIX permissions (a
  Windows drive in WSL) nothing can be made private; the server warns about the files and
  refuses a folder that others can write in.
- **Plain HTTP beyond loopback** exposes the words to the network, and a lookup service's
  key and the words looked up. The server's token isn't sent (requests are signed), and a
  request seen on the network can't be sent again. The server warns, and so do the
  extension's address fields for the server and for a lookup service; neither refuses.
- **Someone at the server's address after it stops** (slice 54, B-01 and D-01). If the
  server stops (a crash, a restart, an update) and another account starts listening at its
  port, that program never gets the token and can't answer for the server: its first
  answer has no server signature, so the extension uses nothing from it, forgets the
  proof, and sends nothing more until a proof it can't give. What it can get: the signed
  requests already sent before that first answer came back. A `GET` (a sync, a status
  read) shows it only which route was asked. A request that carries the learner's words
  or settings (an add, an edit, an import batch, a delete, the languages sent after a
  sync) goes out only within 30 s of a successful proof, so it gets such a body only if
  it took the port within 30 s of the last proof and before any other request found it
  out; then it reads that request's body (and each other one already in flight at that
  moment), never the token. It can't play any request to the server later: a nonce is
  accepted once while the server runs, a request's time must be within 120 s of the
  server's clock, and every request signs the boot id the server gave with its last proof,
  which each start replaces with a new random one, so a request caught while the server
  was stopped is refused (`stale_boot`) once it is back, whatever its time (security
  review E-01; before, a request stamped up to 120 s ahead of the server's clock was
  accepted after a restart, since the nonces it had seen were gone).
- **What a signature doesn't do.** It authenticates; it doesn't encrypt. The server's
  signature covers the answer's status, not its body, so a program that sits between the
  extension and a running server (on a network without HTTPS, or a local listener that
  forwards to the server at an address the extension doesn't use) can read and change
  bodies; HTTPS (or Tailscale) is the answer there. A clock more than two minutes off the
  server's makes every request fail, with a message that says so.
- **Weak chosen tokens on this computer.** Requests from this computer without a
  forwarding header are exempt from the wrong-token lockout and the proof limit (D-02), so
  a program on the computer can try tokens without limit. Remote clients behind a reverse
  proxy on the computer are still limited (the proxy adds a forwarding header), but all
  together: one stranger's lockout refuses every proxied client, the owner's other
  devices included, for the rest of that minute. A proxy that forwards without any of
  those headers makes its clients look local and unlimited. A generated token (256
  random bits) can't be guessed; a chosen one gets a warning at start
  ([configuration.md](../reference/configuration.md#api_token)).
- **The model provider sees every lookup**, under its own terms.
- **Pages can see swapped words** in their own DOM, and, since they know their own text,
  which of their words the learner has a word for (security review A-01). Kotiko swaps
  only text the learner can see (rendered; at least 10 % opaque counting every
  ancestor's `opacity` and `filter: opacity()`; under no `clip-path`, mask or `url()`
  filter, E-04; on screen or within a screen of it; not clipped away by an ancestor's
  overflow) and at most 500 distinct concepts, each in at most 3 languages, per page
  view (`spec/rules.json` `max_page_*`). What's left: a page that shows text the learner
  can't make out (tiny, the color of the background, blurred or otherwise filtered
  without `opacity()`, under something else, or shown for one frame) still gets swaps
  within that cap; the cap is per page view, so a page that reloads itself or a site
  visited often can learn more of a long list over time. The word card opens only from
  the learner's own input on a swap drawn at least 10 % opaque, under no clip-path or
  mask, whose box isn't stretched far past its text, and from a pointer only within 4 px
  of that text (E-05), so a page can't stretch an invisible swap under the learner's
  pointer or click; one that keeps a swap under the pointer disguised another way (the
  background's color, under an element with `pointer-events: none`) can still have its
  card opened while the pointer rests there, and while a card is open, `window.find()`
  can match its text. Where
  Kotiko is paused, off or stepping back from a sensitive site it adds nothing to the page
  (A-03, C-04); where it swaps, the swaps and their stylesheet show it's installed.
- **A subverted content script** (code running in Kotiko's content-script world) can't
  change settings, the word list or the add queue (SCR-448), but it can still: add words
  to the never-swap list one at a time (the word card's action lives in the page; the list
  is in Settings); make other open pages act briefly on a value it wrote, until the
  background puts it back, and keep doing so by writing in a loop (nothing is saved or
  sent); in Firefox, write `storage.sync`, which Kotiko then doesn't take, so base
  languages changed on another device don't follow there. It can read what content
  scripts read: words, settings and the add jobs' typed text.
- **One-time trust at upgrade.** An install updating from a build before SCR-448 takes its
  `storage.local` as it is, once; one from before slice 28 also takes its server address
  and the address of a local or "custom" lookup service. These were writable by content
  scripts then and can't be checked. An address for a hosted service, which no page shows
  a field for, is dropped. A store set up from `storage.local` is kept only on an update
  from 0.1 or 0.2 (`onInstalled`'s `previousVersion`); on any other start it is dropped
  like a new install's, and a store born from "Delete everything" never reads
  `storage.local` at all, even after the worker restarts (slice 54, A-06). There have been
  no releases, so only builds from source are affected.
- **One token, full access.** Anyone with it can read, change and delete every word.
- **Model answers are checked, not verified**; a plausible wrong meaning can be saved.
- **No rate limit** for requests that carry the token or are signed with it (beyond the
  50,000 signed requests the server remembers at once).
- **Response hardening headers** (`X-Content-Type-Options` and similar) are not sent yet;
  only `/health` sends `cache-control: no-store`. Planned (slice 01 section 7).
- **No enforced second review.** The `main` ruleset requires the CI checks but no
  approving review, so one maintainer account (or a stolen token with write access) can
  merge its own pull request, including changes to `.github/allowed_signers` and the
  workflows. Accepted while one maintainer does nearly all the work
  ([CODE_REVIEW.md](../CODE_REVIEW.md), step 2). The release tag and the store upload still
  need the release manager: only they can create a `v*` tag, and the `release`
  environment's reviewer approves each upload. A pull request can also change a workflow
  itself, and that change runs on the pull request; only review catches it.
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
