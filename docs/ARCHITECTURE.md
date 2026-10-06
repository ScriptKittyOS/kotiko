# Kotiko architecture

Last reviewed: 2026-10-05.

This page says what runs where, what each part does, where words are kept, what leaves
your machine, and where to look next. It describes the code on `main`. Plans for later
work live in [`slices/`](../slices/README.md); where this page mentions one, it names the
slice.

## 1. Overview

Kotiko has two parts:

- **The browser extension** (`extension/`, Manifest V3). It swaps words on the pages you
  read, and it has its own pages: the toolbar popup, the dashboard (your word list and
  settings) and the welcome tab.
- **The server** (`server/`, Elixir and SQLite). It is optional. It keeps your words,
  looks new words up with a model, and runs the Telegram bot.

The extension works in one of two modes, chosen in its settings (`wordsHome` in
[`extension/lib/local-mode.js`](../extension/lib/local-mode.js)).

**Server mode**: your words live on a Kotiko server you run yourself.

```
 web page ── content script ◀── storage.local (the words pages need)
                                     ▲
 popup, dashboard, welcome ──▶ background ──HTTP + token──▶ Kotiko server ──▶ model API
                                                              │  (Elixir,  ──▶ en.wiktionary.org
 Telegram (your phone) ◀──── long polling ────────────────────┤   SQLite)  ──▶ transcription
                                                              ▼                (optional)
                                                        <data dir>/kotiko.db
```

**Local mode**: your words live in the browser, and the extension looks new words up
itself, with your own key for a model service or a model on your machine. No server is
needed.

```
 web page ── content script ◀── storage.local (the words pages need)
                                     ▲
 popup, dashboard, welcome ──▶ background ──▶ IndexedDB "kotiko" (words, keys)
                                     │
                                     ├──HTTPS + your key──▶ model API (OpenRouter, OpenAI,
                                     │                       Anthropic, Gemini, Groq, or a
                                     │                       local Ollama or LM Studio)
                                     └──HTTPS──▶ en.wiktionary.org (the word only)
```

A browser in local mode can move its words to a server and back
([`extension/background.js`](../extension/background.js), "moving words between this
browser and a server"). Syncing several devices through the server in local mode is
planned in slice [39](../slices/39-multi-device-sync/SPEC.md).

## 2. Components

### The extension

The extension ships exactly the files in `extension/`. There is no bundler and no npm
code at runtime; every script is a classic script that attaches one namespace to
`globalThis`, so Node tests can load the same files.

- **Content scripts** run on every page the browser lets extensions into (`<all_urls>` in
  `content_scripts` in
  [`extension/manifest.json`](../extension/manifest.json)). The pure modules in
  `extension/lib/` do the thinking: the matcher (`matcher.js`), which parts of a page are
  in a language you read (`page-lang.js`), what not to swap (`rules.js`, `sensitive.js`,
  `controls.js`), capitals (`casing.js`) and which language wins (`precedence.js`).
  [`content/engine.js`](../extension/content/engine.js) changes the page without taking
  text nodes away from the site's framework.
  [`content/popover.js`](../extension/content/popover.js) shows the word card in a closed
  shadow root. [`content.js`](../extension/content.js) ties them together. Content
  scripts read only `storage.local`; keys and the server token live in the background's
  own store, out of their reach (an older install's token is moved there on upgrade).
- **The background** is [`background.js`](../extension/background.js): a service worker
  in Chrome, an event page in Firefox (the manifest lists both forms). It is the only part
  that opens the word store, reads secrets, calls the server or a model, and runs
  background jobs: add jobs that survive the popup closing
  ([`lib/add-queue.js`](../extension/lib/add-queue.js)), the pronunciation refresh
  ([`lib/refresh-job.js`](../extension/lib/refresh-job.js)) and the Wiktionary pass
  ([`lib/wiktionary-pass.js`](../extension/lib/wiktionary-pass.js)).
- **Extension pages**: the popup ([`popup.js`](../extension/popup.js), with
  `popup-more.js` loaded on first use), the dashboard
  ([`dashboard.html`](../extension/dashboard.html), also the options page, with bulk add
  in `extension/bulk/`) and the welcome tab ([`welcome.js`](../extension/welcome.js)).
  They talk to the background by messages. Every interface string is in
  `extension/_locales/`.
- **Messaging.** [`lib/messages.js`](../extension/lib/messages.js) routes each message
  type to a handler that names who may call it: `page` (an extension page) or `content`
  (a content script in a web page), plus `docs` (a content script on Kotiko's docs site,
  only for the "Connect OpenRouter" sign-in code). Content scripts may only ask for a sync
  and the sensitive-site list. Adding, editing and deleting words, and anything that
  touches keys, are for extension pages only; a content script asking gets `forbidden`.
- **Local mode** ([`lib/local-mode.js`](../extension/lib/local-mode.js)): settings, the
  one-time upgrade of older installs, and the word routes over the extension's own store
  ([`lib/store.js`](../extension/lib/store.js)). The lookup client
  ([`lib/llm/client.js`](../extension/lib/llm/client.js), with `policy.js` and
  `catalog.js`) calls any OpenAI-compatible API through the presets in
  [`spec/providers.json`](../spec/providers.json). [`lib/pkce.js`](../extension/lib/pkce.js)
  holds the "Connect OpenRouter" sign-in (the welcome tab's first choice and a button in
  the dashboard's Word lookups), which returns to the docs site's `/connect/` page (slice
  [44](../slices/44-docs-site/SPEC.md)); pasting a key works too.
- **Server mode**: [`lib/sync-controller.js`](../extension/lib/sync-controller.js) keeps
  one sync running at a time, and [`lib/validate-words.js`](../extension/lib/validate-words.js)
  checks the server's answer before it is stored. [`lib/words-v1.js`](../extension/lib/words-v1.js)
  serves the dashboard's reads and edits through `/api/v1`.
- **Design system**: `extension/ui/` (tokens, components, icons), from slice
  [06](../slices/06-design-system/SPEC.md).

### The server

[`server/lib/kotiko/application.ex`](../server/lib/kotiko/application.ex) starts in this
order: the log filter that hides secrets, settings, the data folder, the API token,
database migrations (with a backup first), a startup summary, then the supervision tree.

- **HTTP**: Bandit serves [`Kotiko.Router`](../server/lib/kotiko/router.ex), a Plug
  router. Every request passes `Kotiko.Plug.HostCheck`
  ([`plug/host_check.ex`](../server/lib/kotiko/plug/host_check.ex), refuses unknown host
  names against DNS rebinding), then the token check (deny by default; only `GET` and
  `HEAD /health` are open), then body parsing (64 KB, 1 MB for the batch route).
  `/api/v1` is forwarded to [`Kotiko.RouterV1`](../server/lib/kotiko/router_v1.ex). The
  routes are listed in [`reference/http-api.md`](reference/http-api.md).
- **Settings**: [`Kotiko.Config`](../server/lib/kotiko/config.ex) parses the environment
  (`.env`) once at boot and stops the server with one readable message (exit status 78)
  if anything is wrong. Every setting is in
  [`reference/configuration.md`](reference/configuration.md).
- **Token**: [`Kotiko.Token`](../server/lib/kotiko/token.ex) takes `API_TOKEN`, or the
  saved `<data dir>/api-token`, or makes a new 256-bit one and saves it with mode 0600.
  `mix kotiko.token` prints it or replaces it.
- **Lookups**: [`Kotiko.Lookup`](../server/lib/kotiko/lookup.ex) turns typed text into
  checked words. [`Kotiko.LLM`](../server/lib/kotiko/llm.ex) and `llm/` ask the model:
  which models and in what order (`catalog.ex`), the daily quota (`quota.ex`), a 30-day
  cache (`cache.ex`), what a failure means (`policy.ex`), one HTTP attempt (`client.ex`)
  and at most two calls in flight (`slots.ex`). [`Kotiko.WordSpec`](../server/lib/kotiko/word_spec.ex)
  checks every answer before anything is saved.
- **Pronunciations**: [`Kotiko.Pronounce`](../server/lib/kotiko/pronounce.ex) reads the
  IPA on a word's Wiktionary page for languages with word stress;
  [`Kotiko.WiktionaryPass`](../server/lib/kotiko/wiktionary_pass.ex) does this once for
  words saved earlier; [`Kotiko.PronunciationRefresh`](../server/lib/kotiko/pronunciation_refresh.ex)
  is the one-time job that asks the model for missing pronunciations.
- **Words and storage**: [`Kotiko.Words`](../server/lib/kotiko/words.ex) holds every
  database function; [`Kotiko.Repo`](../server/lib/kotiko/repo.ex) is Ecto over SQLite
  (`ecto_sqlite3`); [`Kotiko.WriteLock`](../server/lib/kotiko/write_lock.ex) queues
  writers. [`Kotiko.Migrations`](../server/lib/kotiko/migrations.ex) backs the database up
  before a pending migration. [`Kotiko.DataDir`](../server/lib/kotiko/data_dir.ex) finds
  the data folder and copies words over once from the folder used before the rename.
  [`Kotiko.Janitor`](../server/lib/kotiko/janitor.ex) cleans up daily.
- **Telegram**: [`Kotiko.Bot`](../server/lib/kotiko/bot.ex) long-polls Telegram (no
  public URL or webhook) through [`Kotiko.Telegram`](../server/lib/kotiko/telegram.ex),
  and answers only the IDs in `ALLOWED_TELEGRAM_IDS`. It starts only when
  `TELEGRAM_BOT_TOKEN` is set. [`Kotiko.Transcriber`](../server/lib/kotiko/transcriber.ex)
  turns voice notes into text when `TRANSCRIBE_URL` is set.
- **Logs**: [`Kotiko.Log.Redact`](../server/lib/kotiko/log/redact.ex) takes tokens and
  keys out of every log line at every level. Words reach the log only with
  `LOG_LOOKUPS=true`, and then only at debug level.

### The shared spec

[`spec/`](../spec/README.md) holds what both sides must agree on: the word record's
schema, the prompt, the validation rules (`rules.json`), language data, model and
provider presets, and test fixtures that both runtimes must pass. The server embeds the
files at compile time ([`Kotiko.Spec`](../server/lib/kotiko/spec.ex)). The extension
can't read files outside its folder and has no build step, so
[`spec/tools/sync-extension.mjs`](../spec/tools/sync-extension.mjs) copies them into
`extension/spec/` and writes `extension/spec/spec.js`; CI fails if the copy is stale.

## 3. Data

**The word record** is defined once in
[`spec/word.schema.json`](../spec/word.schema.json): a target word (`lang`, `native`) with
its meaning in one base language (`base_lang`, `gloss`, `forms`), pronunciation fields,
`status`, `origin` and timestamps. Someone who reads two languages has two records for
the same target word. Deleting leaves a tombstone that can be restored for 30 days.

Where it is kept:

| Mode | Words | Keys and tokens |
|---|---|---|
| Server | SQLite at `<data dir>/kotiko.db` (default `$XDG_DATA_HOME/kotiko`, else `~/.local/share/kotiko`); the extension keeps a copy of the words pages need in `storage.local` | The server's token in `<data dir>/api-token` or `.env`; model and Telegram keys in `.env`. Any of them can be in its own file instead (`NAME_FILE`, docs/reference/configuration.md). In the extension, the server token is in the IndexedDB store |
| Local | IndexedDB database `kotiko`, opened only by the background ([`lib/store.js`](../extension/lib/store.js)); a projection of the active words in `storage.local` for content scripts ([`lib/projection.js`](../extension/lib/projection.js)) | Model keys in the same IndexedDB store's `secrets`, which content scripts can't reach |

The server also keeps a lookup cache, kept add responses (24 hours) and background-job
state in the same SQLite file, backups in `<data dir>/backups/`, and the model list in
`<data dir>/models-cache.json`.

**What leaves your machine** (read from the code; slice
[28](../slices/28-privacy-and-store-readiness/SPEC.md) will publish the full inventory
and privacy policy):

- **The model API you chose** gets the text you type to add a word, your base languages,
  the languages you added lately (as a hint) and Kotiko's prompt. In server mode the
  server sends it; in local mode the extension does. Page text is never sent.
- **en.wiktionary.org** gets only the word, to read its pronunciation, for languages with
  word stress. `KOTIKO_WIKTIONARY=false` turns this off on the server.
- **Telegram**, only if you turned the bot on: your messages to the bot, and the bot's
  replies (word cards).
- **The transcription endpoint**, only if `TRANSCRIBE_URL` is set: the audio of voice
  notes sent to the bot.
- **OpenRouter's model list and key status** (`/models`, `/key`), when the model API is
  OpenRouter. These requests carry your key, never your words.

There is no telemetry or analytics.

## 4. Main flows

**Adding a word from the popup.** The popup sends `add` to the background, which makes an
add job and answers at once. The job looks the word up: with the server
(`POST /api/v1/words`) or with your own key (local mode). The answer is checked against
the spec, merged into an existing record if there is one, and saved; the result
("Added", "Already in your list", "Updated") comes back with Undo. A `client_request_id`
makes a retry save nothing twice. Text written as `native = meaning` is saved without
any model.

**Adding a word from Telegram.** The bot receives the message (or a voice note, which
the transcriber turns into text), runs the same lookup and checks on the server, and
answers with a card: `add …` saves at once with Undo; a question shows Add and Skip.

**Sync (server mode).** The background asks the server for the words every minute (a
browser alarm), on page loads and after a change, keeps one request running at a time,
checks the answer, and writes the words to `storage.local`. Content scripts pick up the
change. The page sync still reads the older `GET /api/words` route; the dashboard reads
and edits through `/api/v1`.

**Swapping words on a page.** The content script works out which parts of the page are
in a language you read, splits the text into words with the browser's own
`Intl.Segmenter`, looks them up in an index of your words, skips what shouldn't change
(code, inputs, controls, likely names, sensitive sites), picks one of your languages per
word, applies that language's capitals, and changes the text. It watches the page for new
content.

## 5. Trust boundaries

Kotiko treats these as untrusted and checks what crosses them:

- the web page and its scripts (the page DOM is read as text and never written as HTML);
- content scripts, which may only send the messages `messages.js` allows them;
- the network between the extension and the server (bearer token, Host check; plain
  HTTP only if you set `BIND` to a network address, with a warning at startup);
- the model's answers, which are checked against the spec before anything is saved;
- Telegram updates (allowlisted user IDs only);
- the files in the data folder, protected by your operating system's file permissions.

The full threat model, every input and how it is checked, and the evidence are in the
[assurance case](security/assurance-case.md).

## 6. External dependencies

**Services at runtime.** None is required by the extension in local mode except a model
you choose; all are optional for the server except a model API.

| Service | Used for | Receives |
|---|---|---|
| An OpenAI-compatible model API (OpenRouter by default; presets in [`spec/providers.json`](../spec/providers.json)) | Working out a word you typed | The typed text, base and recent languages, the prompt, your key |
| en.wiktionary.org (MediaWiki REST API, [`spec/wiktionary.json`](../spec/wiktionary.json)) | Pronunciations | One word per request |
| Telegram Bot API (optional) | The bot | Messages to and from the bot, the bot token |
| A transcription endpoint, such as a local whisper.cpp server (optional) | Voice notes | The audio |

**Platform.**

- Browsers: Chrome, Brave and Edge (Manifest V3, service worker), and Firefox (event page;
  add-on ID in the manifest). Firefox for Android and Safari are planned in slices
  [45](../slices/45-firefox-android/SPEC.md) and [51](../slices/51-safari-port/SPEC.md).
- Server: Elixir 1.15 or newer ([`server/mix.exs`](../server/mix.exs)). CI tests the
  oldest and newest supported pairs, Elixir 1.15.8 with OTP 26.2 and Elixir 1.19.2 with
  OTP 28.1 ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). SQLite comes with
  `ecto_sqlite3`. A systemd user service is installed (and removed, with `--uninstall`) by
  [`server/install-service.sh`](../server/install-service.sh); Docker and other service
  managers are planned in slice [40](../slices/40-server-packaging-docker/SPEC.md).
- Node 22 is for development only: tests, linting and tools
  ([`package.json`](../package.json)). The extension ships no npm code.

**Libraries.** The computer-readable lists are [`server/mix.exs`](../server/mix.exs) and
[`server/mix.lock`](../server/mix.lock) for the server (Bandit, Plug, Jason, Req, Ecto
SQL and `ecto_sqlite3` at runtime), and [`package.json`](../package.json) and
[`package-lock.json`](../package-lock.json) for development tools. Both lockfiles pin
exact versions and are committed.

**Keeping them current.** Dependabot opens weekly updates for Mix, npm and GitHub Actions
([`.github/dependabot.yml`](../.github/dependabot.yml)). CI runs `mix hex.audit` (retired
packages) and `mix deps.audit` (known vulnerabilities) on every pull request. GitHub
Actions are pinned by commit SHA. A software bill of materials attached to each release
is planned in slice [30](../slices/30-release-pipeline/SPEC.md).

## 7. Where decisions live

- [`slices/`](../slices/README.md): one spec per piece of work, with its status and, once
  built, implementation notes. This is the detailed plan.
- [`slices/DECISIONS.md`](../slices/DECISIONS.md): decisions already made, who made them
  and why.
- [`docs/research/`](research/): the six research reports the plan came from.
- [`spec/README.md`](../spec/README.md): the shared word spec.

This page is reviewed at each minor release, and updated in the same pull request as a
change that moves a component, adds a service or changes what leaves the machine.
