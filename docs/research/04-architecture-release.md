# 04: Architecture, deployment, data, security, privacy, and open-source release

Scope: how Slovo is built and shipped, where data lives and travels, how it is secured, and what it takes to run it as a free public open-source project. All code citations refer to the tree at commit `091c05b`. Facts about third parties were checked on 2026-10-01 unless marked "unverified".

## 1. Summary

- **Today, only developers can use Slovo.** Setup needs Elixir, a terminal, `openssl`, an OpenRouter key, a server process that is always running, and an unpacked extension (README.md:21-63). Nothing a non-developer can install from a store exists yet. The repo has no LICENSE, no tests and no CI, so it is not yet open source in the legal sense.
- **Recommended architecture: extension-first with an optional server (option c).** The extension gets a "Local" mode that keeps words in `chrome.storage` and calls any OpenAI-compatible API directly with the user's own key (BYOK). The current Elixir server stays as an optional add-on for Telegram, voice notes, multi-device sync and families. Migrating existing users is cheap, because the extension already caches every active word in `storage.local` (background.js:32-38).
- **Data portability is the biggest gap in Local mode.** Uninstalling an extension deletes its `storage.local`, and `storage.sync` holds only about 100 KB (512 items, 8 KB per item), which is roughly 400-600 words. Export/import (JSON, CSV, Anki TSV) and stable word IDs therefore have to ship before Local mode does.
- **Model churn is a real risk, and it can be fixed.** The five default model IDs are hardcoded (config/runtime.exs:36-40). As of today all five still exist, but `qwen/qwen3.8-27b:free` does not advertise `response_format`, which Slovo always sends (llm.ex:112). The live `/api/v1/models` list returns 17 `:free` models with `supported_parameters` and `expiration_date`, and it answered without authentication when tested. Slovo should build its fallback chain from that list.
- **Security is reasonable for one user on localhost.** The token is compared in constant time (router.ex:91), CSRF is blocked by the Authorization-header preflight, and LLM output is always rendered as text. Some edges are not: the token sits in plaintext in `storage.local`, which content scripts can read by default; nothing enforces a minimum token length; `BIND=0.0.0.0` sends the token over plain HTTP; and every lookup logs the user's text (llm.ex:80-81).
- **Privacy is good.** Page content never leaves the browser: content.js only sends `{type: "sync"}` (content.js:191), and background.js only fetches the configured server. What does leave is what the user types (plus a hint naming their recent languages), which goes to OpenRouter and then to an upstream provider whose retention and training policy depends on the user's OpenRouter privacy settings. This needs a written privacy policy and store disclosures. Firefox now blocks new add-ons that lack `data_collection_permissions` in the manifest, which is currently missing (manifest.json:22).
- **The name needs a decision before public launch.** "Slovo" is already used by a language-learning web app (slovolearn.com, which uses the same "слово / word" framing), by an iOS book-journal app, and by a word game. The popup heading is Cyrillic (popup.html:109) even though the tool now covers every language.
- **Do not run a free shared hosted instance.** One OpenRouter key allows at most 1000 free requests a day in total, and a hosted instance brings accounts, abuse and GDPR obligations. What the org can host cheaply and safely is static content: docs, a privacy policy, and curated word packs on GitHub Pages.

## 2. Scenarios

Each scenario gives: what happens today (with code citations), why it matters, and the recommendation.

**S1. A non-developer finds Slovo in the Chrome Web Store.**
Today: there is no store listing. Setup requires Elixir 1.15+, `openssl rand`, editing `.env`, `./run.sh`, and loading an unpacked extension (README.md:30-63).
Why it matters: almost none of the target audience gets past step 2.
Recommendation: ship Local mode, where the extension needs nothing else, as the default store experience. First run should show: pick a provider, paste a key (or click "Connect OpenRouter", see S16), add your first word.

**S2. An existing user upgrades to an extension that has Local mode.**
Today: the extension holds a full mirror of active words in `storage.local.words` (background.js:32-38), keyed by server integer IDs (word.ex:57-67).
Why it matters: the upgrade must not lose words or force a re-import.
Recommendation: add a `mode` setting with values `server` and `local`. Existing installs default to `server`, so nothing changes. "Switch to Local" copies the cached words into the local store with new UUIDs and keeps `serverId` as an alias. A server export endpoint covers fields the cache lacks: `status`, `source_text` and timestamps are not in `to_json` (word.ex:57-67).

**S3. A user with two laptops (work and home), no server.**
Today: impossible without a server. Settings such as `hiddenLangs` and `pausedHosts` are stored per device (popup.js:49-50, 208-213).
Why it matters: this is the most common reason anyone would need a server.
Recommendation: put settings in `storage.sync` (they are small). Words go in `storage.sync` too while they fit: about 102,400 bytes in total, 8,192 per item, at most 512 items, and 120 writes per minute (Chrome storage docs). Chunk words into roughly 30-word items, use a compact array encoding, and leave notes out (they can be regenerated). Show a meter such as "Syncing 312 of about 500 words". Past the limit, offer the server or export/import. Note that sync only works when the user is signed in to the browser, and that Brave's support for extension sync is unverified.

**S4. A user with 3,000 words.**
Today: `GET /api/words` returns every word on every sync, with no ETag and no delta (router.ex:17-27). Sync runs every minute and on page loads at most every 5 s (background.js:49, 71), and every word change makes each open tab rebuild one large regex (content.js:34-52).
Why it matters: about 1 MB per sync per device, more server and battery load, and slower page matching.
Recommendation: add `GET /api/words?since=<cursor>` that returns changes plus tombstones, with `ETag`/`304`. This needs `updated_at`, `deleted_at` and UUIDs on words (S8). Performance of the matcher itself belongs to another researcher's area.

**S5. Uninstalling or resetting the browser in Local mode.**
Today: not applicable, since the server holds the data.
Why it matters: when an extension is uninstalled, its `storage.local` is deleted silently. In Local mode that means losing everything.
Recommendation: warn about this before switching to Local. Add a one-click JSON export, an optional "remind me to back up monthly", and the `storage.sync` copy (S3) as a safety net.

**S6. Exporting to Anki or a spreadsheet.**
Today: no export exists. Data is reachable only through `sqlite3` or `GET /api/words`.
Why it matters: portability builds trust, and Anki is where serious learners already are.
Recommendation: export JSON as the canonical format (with `schemaVersion`). Export CSV as UTF-8 with a BOM so Excel shows Cyrillic and CJK correctly. Export Anki as TSV with a header and tags, which Anki's text import handles. A real `.apkg` file means building SQLite inside a zip (for example with sql.js), so treat it as P2. Memrise and Duolingo have no supported import or export APIs (unverified for 2026), so a generic CSV import with column mapping covers them.

**S7. "Delete all my data".**
Today: the only route is the README advice to "delete `~/.local/share/slovo/slovo.db`" (README.md:204). The extension keeps its cache after you disconnect, and nothing clears it. Telegram chat history stays on Telegram.
Why it matters: store policies and user trust both expect this.
Recommendation: add a "Delete everything" button in the extension (clears local, sync and session storage) and `DELETE /api/words` (all words) plus a `slovo reset` CLI on the server. Document that Telegram messages and OpenRouter logs are outside Slovo's control.

**S8. Merging duplicates across devices.**
Today: IDs are SQLite autoincrement integers. Uniqueness is on `(lang, native)` (migration :21), and upsert overwrites (words.ex:61-68).
Why it matters: Local mode, imports and packs all create words outside the server, so integer IDs collide.
Recommendation: use UUIDv7 IDs created by the client, keep `(lang, native)` as the natural key for deduplication, resolve conflicts last-writer-wins on `updated_at`, and use tombstones for deletions. Write a migration that adds a `uuid` column and backfills it.

**S9. A family sharing one server.**
Today: there is one global word list. Every allowed Telegram ID writes to the same table (bot.ex:83-95, words.ex has no user column), and `recent_languages` mixes everyone's hints (words.ex:35-43).
Why it matters: one parent's Japanese words show up on a child's pages.
Recommendation (P2): add a `users` table, hashed per-user tokens, `words.user_id`, a unique index on `(user_id, lang, native)`, and a mapping from Telegram ID to user. Add an admin CLI, for example `slovo user add Ana`, that prints a pairing code. Keep the single-user path working with no configuration.

**S10. A teacher assigns words to a class.**
Today: not possible.
Why it matters: classrooms are an obvious channel for a free tool.
Recommendation: don't build classroom accounts at first. Use word packs (S11): the teacher publishes a pack (a JSON file or a URL) and students import or subscribe to it. Assignments that are tracked per student need multi-user (S9) and are P2.

**S11. The org publishes "Top 100 Spanish words".**
Today: not possible.
Why it matters: packs need no LLM calls (so no rate limits), they make a great first-run experience, and the org can serve them for free as static files.
Recommendation: put a `packs/` repo on GitHub Pages with versioned JSON (lang, native, romanization, english, forms, note) and run schema validation in CI. The extension can import from an https URL, and pack words are tagged with the pack ID so a pack can be removed as a unit. License org-authored packs CC BY 4.0 or CC0. Data derived from Wiktionary is CC BY-SA and needs attribution.

**S12. Windows or macOS user who wants Telegram.**
Today: the only option is `mix run` in dev mode (run.sh:16), installed as a service only through systemd (install-service.sh).
Why it matters: the server is closed to most desktop users.
Recommendation: build a `mix release` with `MIX_ENV=prod`. Then add Burrito single-file binaries, which support Windows x86_64, Linux x86_64/arm64 and macOS Intel/Apple Silicon. The exqlite NIF has to be cross-compiled, which Burrito does with Zig; reports on Windows plus SQLite suggest friction, so test it early. Add a launchd plist for macOS and a Task Scheduler "at logon" entry for Windows, which is simpler than a Windows service.

**S13. Home server, NAS or Raspberry Pi.**
Today: you need Elixir on the Pi.
Why it matters: these users are the natural audience for the server and expect Docker.
Recommendation: publish a multi-arch (amd64/arm64) image to GHCR with a `/data` volume, a `HEALTHCHECK` against `/health`, and `BIND=0.0.0.0` inside the container but mapped to `127.0.0.1:4747` in the shipped `docker-compose.yml`. Add a Tailscale sidecar example for remote access.

**S14. Fly.io or Railway one-click deploy.**
Today: none.
Why it matters: it gives people with no home server a way to run Telegram.
Recommendation: P2 templates only. SQLite needs a persistent volume. Telegram long polling needs a machine that is always on, so scale-to-zero breaks the bot. Free allowances on these platforms change often (unverified), so tell users it may cost a few dollars a month.

**S15. Upgrading the server across a schema change.**
Today: migrations run automatically at boot (application.ex:22). There is no backup first, no version endpoint, and `/health` returns plain `ok` (router.ex:11-13).
Why it matters: a failed migration with no backup loses a learner's history.
Recommendation: run `VACUUM INTO 'slovo-<version>-<ts>.db'` before pending migrations and keep the last 5. Make `/health` return `{"ok":true,"version":"0.3.0","api":1}` so the extension can warn when it is newer than the server. Version the API under `/api/v1`. Unify versions, which currently differ: the manifest says 0.2.0 and mix.exs says 0.1.0.

**S16. The user has no idea what an API key is.**
Today: README step 1 sends them to openrouter.ai/keys.
Why it matters: this is the biggest drop-off point in Local mode.
Recommendation: implement OpenRouter's OAuth PKCE flow (`openrouter.ai/auth` followed by `POST /api/v1/auth/keys`). The docs confirm localhost callbacks and a "show the code on screen" fallback. Whether a `chromiumapp.org` callback from `chrome.identity.launchWebAuthFlow` works is unverified and needs a spike. Keep pasting a key as the fallback.

**S17. Free model IDs disappear.**
Today: five IDs are hardcoded (runtime.exs:38-39). If every one is gone, users get "no model could answer" (llm.ex:99-100). The live list today has 17 `:free` models, and all five defaults are present.
Why it matters: free models churn every few weeks, and an extension in the store can't be hot-fixed in a day (review delays).
Recommendation: at startup, and then once a day, fetch `https://openrouter.ai/api/v1/models` (it answered without a key when tested; the docs say a bearer token is expected, so send one when available). Filter on `:free`, `response_format` or `structured_outputs` in `supported_parameters`, and no past `expiration_date`. Order the result with a small curated preference list shipped with each release, and cache the last good list. Remember which models succeed per user and promote them. An explicit `LLM_MODEL` always wins.

**S18. Rate limits (20 per minute, 50 per day without $10 of credit).**
Today: on 429, Slovo moves to the next model (llm.ex:142-143). Every model counts against the same per-key daily limit, so falling through five models after a "found no word" can burn five requests on one word (llm.ex:75-77). There is no cache.
Why it matters: 50 requests a day is easy to hit while importing a list.
Recommendation: cap fallback attempts per add (for example 3) and the total time (the worst case today is 5 × 60 s; llm.ex:124). Cache normalized input to result for 30 days. Show the remaining quota, which OpenRouter's `GET /api/v1/key` reports (field names unverified). Packs and imports should bypass the LLM entirely.

**S19. BYOK for other providers.**
Today: any OpenAI-compatible URL works on the server (llm.ex:104-121). `reasoning: {enabled: false}` is OpenRouter-only (llm.ex:116-118).
Recommendation: ship provider presets in both the extension and the server: OpenRouter, OpenAI, Gemini (OpenAI-compatible endpoint), Groq, Anthropic (OpenAI-compatibility endpoint; unverified for structured JSON), Ollama (`localhost:11434/v1`) and LM Studio (`localhost:1234/v1`). Ollama checks the request origin. Whether it allows `chrome-extension://` origins by default is unverified, so document `OLLAMA_ORIGINS` as the fix.

**S20. The LLM returns malformed or harmful JSON.**
Today: `extract_json` takes the span from the first `{` to the last `}` (llm.ex:176-187). Normalization requires lang, native and english (llm.ex:196), and lang must match a BCP 47 regex (word.ex:21). Nothing limits lengths or the number of forms, and nothing stops `english_forms: ["the", "a"]`.
Why it matters: a single bad form can rewrite every "the" on every page. In shared setups (S9, S11), one user's output affects others.
Recommendation: validate in one place and share the rules between the extension and the server (S22). Allow at most 8 forms, each at most 40 characters. Reject an English stopword list unless the user explicitly asked for that word. Limit native to 64 characters and note to 200. Reject when no form shares a stem with `english`.

**S21. Prompt injection through the add box.**
Today: user text goes in the `user` role (llm.ex:113). In single-user mode the only person who can attack the list is its owner. The add box also returns the model's `reply` (router.ex:36), so anyone holding the token can use the server as a small general-purpose LLM proxy. All rendering uses `textContent` and `title` (popup.js:153-163, content.js:91-97), and Telegram messages are sent without `parse_mode` (telegram.ex:22), so there is no XSS or markup injection.
Recommendation: limit input to 200 characters, which also covers Plug.Parsers' default 8 MB body. Drop `reply` from the add-box path, or cap it at 200 characters. Keep text-only rendering as a rule in CONTRIBUTING.

**S22. One prompt, two runtimes.**
Why it matters: in option (c) both the extension (JS) and the server (Elixir) call the LLM, and the prompt (llm.ex:9-56) and normalization (llm.ex:189-224, word.ex:43-55) would drift apart.
Recommendation: move the prompt text, the JSON schema and the validation rules into `spec/` as plain files that both sides read. Add a shared fixture set of model outputs paired with expected normalized words, run against both implementations in CI.

**S23. Offline, or every model is down.**
Today: adding words fails. Already-known words keep working, because the extension cache serves them.
Recommendation (P2): optional per-language dictionary packs downloaded on demand. Sources: Wiktionary extracts from kaikki.org (CC BY-SA), CC-CEDICT (CC BY-SA 4.0) and OpenRussian (license unverified). Use them for exact native-script lookups and to cross-check LLM output. Keep the data out of the code repo so share-alike terms do not touch the code license.

**S24. Where the API token lives.**
Today: the token is stored in plaintext in `storage.local` (popup.js:215-219). Chrome exposes `storage.local` to content scripts by default (Chrome storage docs), and content.js runs on every page (manifest.json:12-19). The page itself can't read it, because content scripts run in an isolated world, but a compromised renderer could.
Recommendation: call `storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})`, keep secrets and the canonical word store in `local`, and mirror the words content scripts need into `storage.session`, which is not exposed by default and must be opened explicitly for content scripts. Firefox support for `setAccessLevel` is unverified; there, fall back to sending words to content scripts by message. The BYOK LLM key gets the same treatment. Recommend an OpenRouter key with a credit limit.

**S25. Weak or missing token, LAN exposure.**
Today: the server refuses to start without `API_TOKEN` (application.ex:7-8) but accepts any length. `BIND=0.0.0.0` is documented for "a trusted network" (README.md:177-179), over plain HTTP. There is no rate limiting, though brute-forcing a 192-bit token is infeasible.
Recommendation: on first run, generate a 32-byte token in the data directory, so the `openssl` step disappears, and print a pairing code that contains both the URL and the token. Refuse to start with a token shorter than 24 characters. Warn at startup when the bind address is not loopback and not a Tailscale range (100.64.0.0/10). Document Tailscale or Caddy with HTTPS for remote access. The Chrome Web Store policy expects data in transit to use HTTPS, and loopback is the defensible exception. Chrome's rollout of Local Network Access prompts may affect requests to LAN IPs (unverified for extensions), so test it.

**S26. CORS and drive-by requests from web pages.**
Today: no CORS headers are sent. Because the `Authorization` header forces a preflight, a malicious page can't make authenticated calls. `/health` is open and confirms that Slovo runs on `localhost:4747`, which is fingerprinting but low risk.
Recommendation: keep it that way. Add a regression test so nobody adds `Access-Control-Allow-Origin: *`.

**S27. Bootstrapping the Telegram allow-list.**
Today: with `ALLOWED_TELEGRAM_IDS` empty, the bot tells anyone their ID (bot.ex:83-91) and requires an `.env` edit plus a restart. A non-numeric ID crashes the boot (runtime.exs:24).
Recommendation: print a one-time code in the server log, have the owner send `/start <code>`, and store the owner in the database with no restart. While unclaimed, ignore everyone else silently. Parse IDs leniently and log errors instead of crashing.

**S28. Secrets and personal text in logs.**
Today: every lookup logs the user's text and the result at info level (llm.ex:76, 80-81, 90, 130; router.ex:44). Systemd keeps this in journald (README.md:160). Bot errors are echoed to the chat (bot.ex:75). The Telegram bot token is part of request URLs (telegram.ex:9, 38). Current Req errors don't appear to include URLs, but that is unverified across versions.
Recommendation: set `LOG_LOOKUPS=false` by default and log only the model, latency and status. Redact anything matching `bot\d+:[A-Za-z0-9_-]+`. Send a generic error message to Telegram.

**S29. What leaves the machine (privacy policy content).**
Verified flows:
- Typed or dictated text goes to the LLM provider, along with the user's five most recent language names (llm.ex:167-172). With OpenRouter, the request is routed to an upstream provider. Whether that provider may retain or train on prompts depends on the user's OpenRouter settings, which are separate for paid and free models (OpenRouter docs).
- Telegram messages and voice notes pass through Telegram. Audio goes to `TRANSCRIBE_URL`, which may be OpenAI.
- Page text, URLs and browsing history are never transmitted. content.js reads them locally only, and background.js talks only to the configured server.

Recommendation: publish a privacy page (on GitHub Pages) that states exactly this. Have Slovo send OpenRouter's per-request "deny data collection" provider preference when the user ticks "only use providers that don't train" (parameter name unverified). In the Chrome Web Store privacy tab, disclose "website content" (processed locally) and "user-provided content" (sent to the user's chosen LLM). In Firefox, add `browser_specific_settings.gecko.data_collection_permissions`; new add-ons without it can't be submitted to AMO. "none" is probably wrong here, because typed text goes to a third party, so pick the matching category.

**S30. Store review and permissions.**
Today: `<all_urls>` is used for both host permissions and content scripts (manifest.json:7, 13), which triggers in-depth review and the "read and change all your data on all websites" warning. The background block lists both `service_worker` and `scripts` for cross-browser use (manifest.json:8-11).
Recommendation: keep `<all_urls>`, since the feature needs it, but explain it in the listing. Run `web-ext lint` in CI and confirm Chrome accepts the dual background key without errors in packed builds.

**S31. A free shared hosted instance (option d).**
Why it fails: one key gets at most 1000 free requests a day across all users, roughly 10-20 active learners. Paid models cost money with no revenue. Accounts bring password resets, GDPR access and deletion requests, and abuse: the add box returns `reply` text, so the instance would become a free LLM proxy. And someone has to be on call for uptime.
Recommendation: don't offer one. Host only static content: docs, the privacy policy and packs.

**S32. Dependency and supply-chain hygiene.**
Today: the mix.lock pins Bandit 1.12.5, Req 0.7.4, ecto_sqlite3 0.25.0 and exqlite 0.41.0 (which compiles bundled SQLite C code). There is no Dependabot or audit setup. The extension has no npm dependencies, which is good.
Recommendation: enable Dependabot for `mix` and `github-actions`, and run `mix hex.audit` and `mix_audit` in CI. Keep the extension free of dependencies at runtime. Build tooling such as web-ext and eslint should stay dev-only.

**S33. Contributing on day one.**
Today: there is no LICENSE (so all rights are reserved by default), no tests directory, no CI, no CONTRIBUTING, and the repo is private. The commit history already follows Conventional Commits.
Recommendation: add the files in Section 5 before flipping the repo to public. Check the history for secrets: `server/.env` was never committed (verified with `git log --diff-filter=A`), so a history rewrite is not needed.

## 3. Recommended architecture and release plan

### Recommendation: option (c), extension-first with the server as an optional add-on

```
                      +-------------------- extension ---------------------+
 popup add box -----> | background: LLM client (BYOK) + validator (spec/)    | --HTTPS--> OpenRouter / OpenAI /
                      | store: storage.local (canonical, trusted-only)      |            Gemini / Groq / Ollama
                      |        storage.session (mirror for content scripts) |
                      |        storage.sync (settings + small word lists)   |
 content scripts <--- | export/import JSON/CSV/TSV, packs from https URLs   |
                      +-------------------------+--------------------------+
                                                | optional: mode = server
                                                v
                      server (Elixir release / Docker / Burrito binary)
                      words + users + tombstones, delta sync, Telegram, voice
```

- **Local mode** (store default): no server, no terminal. One key, or a "Connect OpenRouter" button.
- **Server mode**: today's behavior plus delta sync, for Telegram, voice, more than 500 words across devices, and families.
- **Shared contract**: `spec/prompt.md`, `spec/word.schema.json` and `spec/fixtures/*.json` drive both implementations, and CI runs the fixtures against each.

### Migration path for current users

1. Server 0.3: add UUIDs, `updated_at`/`deleted_at` and `GET /api/v1/export`. Back up before migrating. The old `/api/words` stays as an alias for one minor version.
2. Extension 0.3: the default mode for existing installs is `server` (detected by a non-empty token). New installs start in `local`.
3. "Move my words into the browser" imports the export, and "Push my local words to a server" does the reverse. Both deduplicate on `(lang, native)`.

### Rejected alternatives

- **(a) Server only.** It keeps the setup that blocks almost everyone.
- **(b) Extension only, dropping the server.** It loses Telegram and voice, which are the current owner's daily workflow, and it leaves no answer for large word lists across devices. The server costs little to keep as an add-on.
- **(d) Hosted service.** See S31.
- **Cloud-drive sync (Google Drive appdata, WebDAV, GitHub Gist).** Worth a later look as P2. Google OAuth verification and per-provider code are heavy work for a volunteer project.

### Release plan

1. **P0 hygiene:** LICENSE, community files, CI, privacy policy, Firefox data declaration, a decision on the name.
2. **P0 product:** Local mode, export/import, validation, a dynamic model list, token hardening, delete-all.
3. **Release pipeline:** release-please (Conventional Commits) produces the CHANGELOG and tags. The tag workflow builds the extension zip from a single version source, uploads to the Chrome Web Store through its API, signs and submits to AMO with `web-ext sign` (listed), pushes the Docker image to GHCR (amd64/arm64), attaches checksums and GitHub artifact attestations, and publishes the docs site. Make the repo public at that point.
4. **P1:** Docker and service files, delta sync, packs, OAuth connect, `storage.sync`.
5. **P2:** multi-user, classrooms, Burrito binaries, dictionaries, one-click hosting templates.

## 4. Open questions for the owner

1. **License.** I recommend Apache-2.0 for maximum reuse, an explicit patent grant and a clear contribution clause with no CLA. MIT is an equally fine, simpler choice. AGPL would stop closed hosted forks but discourages reuse, and you don't plan a hosted product. Separately, choose a license for org-authored word packs (CC BY 4.0 or CC0).
2. **Name.** Keep "Slovo" despite slovolearn.com (a language app in the same niche), or rename? Either way, run a USPTO/EUIPO search, which this research could not do. Also decide whether the Cyrillic popup heading stays as a brand mark or becomes the name in Latin script.
3. **Store presence.** Publish under the ScriptKittyOS developer account on both the Chrome Web Store and AMO? The account email becomes public.
4. **Default provider.** OpenRouter's free tier is the default today. Is the org comfortable recommending a third-party provider whose free upstreams may train on prompts? An alternative is to default to "ask the user" with a short comparison.
5. **Support scope.** Is the server officially supported on Windows and macOS (Burrito), or "Docker and Linux only, community-supported elsewhere"?
6. **Telegram.** Keep it as the flagship server feature, or move it behind a plugin boundary?

## 5. Proposed slices

| Slice | Goal | Size | Priority | Depends on |
|---|---|---|---|---|
| license-and-community-files | LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, issue/PR templates | S | P0 | owner license decision |
| naming-decision | Decide the name, fix the popup heading and store copy, trademark search | S | P0 | owner |
| ci-pipeline | GitHub Actions: mix compile --warnings-as-errors, format, credo, test, hex.audit; web-ext lint, eslint, node unit tests | M | P0 | - |
| dependency-automation | Dependabot for mix and Actions, mix_audit | S | P0 | ci-pipeline |
| privacy-policy-and-disclosures | Privacy page, CWS privacy answers, Firefox `data_collection_permissions` | S | P0 | - |
| shared-word-spec | `spec/` prompt, JSON schema, fixtures used by JS and Elixir | M | P0 | ci-pipeline |
| llm-output-validation | Form, length and stopword limits, input cap, drop `reply` from add path | S | P0 | shared-word-spec |
| stable-word-ids | UUIDs, updated_at/deleted_at, backfill migration, export endpoint | M | P0 | - |
| extension-local-mode | Words in extension storage, direct BYOK LLM calls, provider presets, mode switch | L | P0 | shared-word-spec, stable-word-ids |
| export-import | JSON (canonical), CSV with BOM, Anki TSV export; CSV import with column mapping | M | P0 | stable-word-ids |
| delete-all-data | Wipe in the extension, `DELETE /api/words`, `slovo reset` CLI | S | P0 | - |
| token-storage-hardening | setAccessLevel, session mirror for content scripts, auto-generated server token, min length, bind warning | S | P0 | - |
| dynamic-free-model-list | Fetch the /models list, filter by `:free`/JSON support/expiry, cache, curated order; cap fallback attempts and time | M | P0 | - |
| log-redaction | `LOG_LOOKUPS` off by default, redact bot token, generic bot errors | S | P0 | - |
| release-pipeline | release-please, single version source, CWS API upload, AMO `web-ext sign`, checksums, attestations | M | P0 | ci-pipeline |
| docker-image | Multi-arch GHCR image, compose file, healthcheck, /data volume, Tailscale example | M | P1 | release-pipeline |
| server-release-and-services | `mix release` in prod, systemd, launchd plist, Windows logon task | M | P1 | - |
| server-upgrade-safety | Pre-migration backup, `/health` version JSON, `/api/v1` | S | P1 | - |
| delta-sync | `?since=` with tombstones and ETag/304 | M | P1 | stable-word-ids |
| storage-sync-small-lists | Settings and chunked compact words in `storage.sync`, with a usage meter | M | P1 | extension-local-mode |
| word-packs | Static JSON packs on GitHub Pages, import/subscribe by URL, remove by pack | M | P1 | stable-word-ids, llm-output-validation |
| openrouter-oauth-connect | PKCE "Connect OpenRouter" button (spike the callback URL first) | M | P1 | extension-local-mode |
| telegram-pairing-code | `/start <code>` claims ownership, no restart, lenient ID parsing | S | P1 | - |
| docs-site | GitHub Pages: install guides per mode, privacy, troubleshooting | M | P1 | privacy-policy-and-disclosures |
| lookup-cache-and-quota | Cache input-to-result lookups, show remaining OpenRouter quota | S | P2 | dynamic-free-model-list |
| multi-user-server | Users, per-user tokens and lists, Telegram ID mapping, admin CLI | L | P2 | stable-word-ids |
| classroom-assignments | Teacher decks with per-student assignment | L | P2 | multi-user-server, word-packs |
| burrito-binaries | Single-file server for Windows/macOS/Linux/arm64 | M | P2 | server-release-and-services |
| anki-apkg-export | Native `.apkg` export | M | P2 | export-import |
| offline-dictionaries | Optional CC-CEDICT/Wiktionary packs for fallback and cross-checking | L | P2 | shared-word-spec |
| one-click-hosting | Fly.io/Railway templates with a volume and always-on machine | S | P2 | docker-image |
| cloud-drive-sync | WebDAV or Gist sync for large lists without a server | M | P2 | delta-sync |
