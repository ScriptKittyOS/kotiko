# 11 · Local-first mode

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | L (several weeks) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md), [09-shared-word-spec-and-prompt](../09-shared-word-spec-and-prompt/SPEC.md), [10-llm-client-resilience](../10-llm-client-resilience/SPEC.md) |
| **Unblocks** | [22-first-run-onboarding](../22-first-run-onboarding/SPEC.md), [28-privacy-and-store-readiness](../28-privacy-and-store-readiness/SPEC.md), [39-multi-device-sync](../39-multi-device-sync/SPEC.md), [45-firefox-android](../45-firefox-android/SPEC.md); soft for [13](../13-bulk-add/SPEC.md), [21](../21-dashboard/SPEC.md), [33](../33-context-menu-and-shortcuts/SPEC.md) |
| **Sources** | [04 summary, S1-S5, S16-S19, S22, S24, section 3](../../docs/research/04-architecture-release.md); [03 C2, C4-C7, E3](../../docs/research/03-browser-extension.md); [05 S1-S3, S13, S19, S34](../../docs/research/05-learner-ux.md); [06 F09, F10, F11, F14, F36](../../docs/research/06-adversarial-qa.md); [DECISIONS: Local first; the server becomes optional](../DECISIONS.md) |

## Problem

Today Mira only works for people who can run an Elixir server. The extension is a thin
client: every word lives on the server, every lookup goes through it, and the extension
only holds a cache.

- A fresh install has nothing to talk to. The background worker defaults to
  `http://localhost:4747` with an empty token (`extension/background.js:5`), fails the
  first sync with "Paste your API token to connect." (`background.js:10`), and the popup
  shows that in red (`extension/popup.js:123-126`). Read from the code; the README's
  setup takes about ten minutes with Elixir installed (`README.md:21-63`).
- Words are fetched in full from `GET /api/words` (`server/lib/slovo/router.ex:17-28`)
  and mirrored into `storage.local.words` (`background.js:28-38`). There is no way to
  keep a word without the server.
- Adding a word blocks the popup on the model. The Add button is disabled and shows "…"
  while the request runs (`popup.js:189-201`); the background awaits a fetch with no
  deadline (`background.js:74-79`), and the server tries up to five models with a 60 s
  timeout each (`server/lib/slovo/llm.ex:124`, `server/config/runtime.exs:35-42`). The
  worst case is about 300 s ([06 F09](../../docs/research/06-adversarial-qa.md)),
  longer than Chrome lets an MV3 worker wait on a fetch.
- The server token is stored in plaintext in `storage.local` (`popup.js:215-219`), which
  Chrome and Firefox expose to content scripts by default, and content scripts run on
  every page (`extension/manifest.json:12-19`) ([06 F36](../../docs/research/06-adversarial-qa.md)).
- The model logic (prompt, JSON extraction, normalisation) exists only in Elixir
  (`llm.ex:9-56`, `llm.ex:176-224`, `server/lib/slovo/word.ex:43-55`).

The decision to go local first is made ([DECISIONS](../DECISIONS.md)). This slice is how.

## Goals

- A new install works with no server: words are stored in the extension, and lookups go
  straight from the extension to any OpenAI-compatible API with the user's own key.
- Seven provider presets (OpenRouter as the default, OpenAI, Anthropic, Google Gemini,
  Groq, Ollama, LM Studio) plus "Custom", each needing at most one pasted value.
- The API key and the server token are never readable from a content script, in any
  supported browser.
- Nothing in the UI waits on the model. Typing a word and pressing Enter returns
  control at once; the lookup runs in slice 24's persistent add queue, which survives the
  popup closing and the worker restarting, against whichever backend is configured.
- The server becomes an optional add-on that the extension can connect to and
  disconnect from at any time without losing words, in either direction.
- Every existing server user upgrades with no data loss and no action required.
- The extension and the server use the same prompt, schema and validation rules from
  slice 09's `spec/` folder.

## Non-goals

- Which models to try, retries, deadlines, quota display and the lookup cache: slice
  [10](../10-llm-client-resilience/SPEC.md). This slice calls slice 10's client.
- The word record itself (UUIDv7, timestamps, tombstones, merge rules): slice
  [07](../07-word-model-v2/SPEC.md).
- Two-way sync between several devices and a server: slice
  [39](../39-multi-device-sync/SPEC.md). In this slice a connected server owns the words
  and the extension mirrors them, as today.
- The add job itself (record, states, retries, idempotency) and what the learner sees
  about it: slice [24](../24-add-flow-safety/SPEC.md). Bulk add: slice [13](../13-bulk-add/SPEC.md).
- The welcome flow: slice [22](../22-first-run-onboarding/SPEC.md). This slice provides
  the settings and APIs it calls.
- Export, import and delete-all: slice [12](../12-export-import-and-delete/SPEC.md),
  which this slice uses for the mode switches.

## User stories

- As someone who found Mira in a store, I want to add my first word without installing
  anything else, so that I see it working in a minute.
- As a learner who doesn't know what an API key is, I want one obvious default and a
  "Connect OpenRouter" button, so that I'm not choosing between seven companies.
- As a learner on the free tier, I want my add to be accepted instantly even when the
  free models are busy, so that I can keep reading and trust it will land.
- As the current maintainer with a Telegram workflow, I want my server to keep working
  after the update exactly as before.
- As a learner who later wants Telegram, I want to connect a server and bring my
  browser's words with me.
- As a privacy-minded user, I want my key unreadable by anything that runs on web pages.
- As someone running Ollama at home, I want a preset that tells me the one setting I need.

## Specification

### 1. Architecture

```
popup / dashboard / welcome / context menu
        |  runtime messages (privileged types only from extension pages, slice 26)
        v
+---------------- background (service worker; event page in Firefox) ----------------+
|  store/      IndexedDB "mira": words, outbox, secrets, meta (canonical)            |
|  projector   writes the content-script view to storage.local                        |
|  lookup/     per-backend lookup for slice 24's add jobs                            |
|  llm/        slice 10 client + provider presets + spec/ prompt and validator        |
|  server/     optional connection: pull, push, server-side lookups                   |
+-------------------------------------------------------------------------------------+
        |  storage.local: words (projection), wordsVersion; addJobs (slice 24)
        v
content scripts (read only; never see secrets)
```

Two settings replace today's single "server" assumption:

- **Where words live** (`wordsHome`): `"local"` (the extension owns them) or `"server"`
  (a connected Mira server owns them; the extension mirrors them).
- **Who looks words up** (`lookup.kind`): `"provider"` (the extension calls a model
  directly), `"server"` (the server looks up with its own key), or `"none"` (packs,
  manual add and bulk add with translations only).

The UI presents these as two choices, not as infrastructure: "Keep my words in this
browser" or "Use my Mira server", and "Look words up with: OpenRouter (free) ▾". The
valid combinations are local/provider (the store default), local/none, server/server
(today's setup) and server/provider (the extension looks up, then saves to the
server).

### 2. Storage: IndexedDB for the canonical store

**Decision: the canonical word store, the server outbox and the secrets live in one
IndexedDB database, `mira`, opened only from extension-origin contexts. The words that
content scripts need are projected into `storage.local`. The manifest adds
`unlimitedStorage`.**

Why, with the numbers:

| Need | `storage.local` | IndexedDB (extension origin) |
|---|---|---|
| Quota | 10 MB without `unlimitedStorage` (Chrome 114+); unlimited with it | Shared origin quota; with `unlimitedStorage`, unlimited and exempt from eviction (Chrome); persistent without a prompt (Firefox, per MDN) |
| Readable by content scripts | Yes by default. `setAccessLevel` can restrict it in Chrome 102+ and Safari 17.1+, but **Firefox does not implement `setAccessLevel`** (MDN browser-compat-data, checked 2026-10-01) | No. Content scripts use the page's origin for IndexedDB in all three engines |
| Atomic "find by (lang, native), merge, write" | No transactions; a read-modify-write across keys can interleave | Yes, one `readwrite` transaction over a unique index |
| Query by `updated_at` (delta sync), by language, by text | Load everything, filter in JS | Indexes and cursors |
| Change notification to every tab | `storage.onChanged` built in | None; needs a signal |

Size: a slice 07 word is about 400-800 bytes of JSON, and the vocabulary cap is 20,000
words ([03 E2](../../docs/research/03-browser-extension.md)), so the store tops out near
16 MB plus cache and stats. `storage.local` would need `unlimitedStorage` anyway and
still can't hide the key in Firefox. IndexedDB gives the transactions slices 07 and 39
need and keeps secrets out of content-script reach everywhere; its missing change events
are covered by the projection below.

`unlimitedStorage` shows no install warning in Chrome. In Firefox it adds the line
"Store unlimited amount of client-side data" to the install prompt (high confidence),
which sits below the `<all_urls>` warning Mira already carries.

**Object stores** (database version 1):

| Store | Key | Indexes | Contents |
|---|---|---|---|
| `words` | `id` (UUIDv7, slice 07) | `natural` = `[lang, native_key, sense]` unique where `deleted_at` is null (enforced in code, see below); `updated_at`; `lang` | The slice 07 word record exactly as `spec/word.schema.json` defines it, plus `serverId` (legacy integer alias, optional) |
| `outbox` | auto-increment | none | Edits and deletes waiting for a server (section 5) |
| `secrets` | `id` | none | `{id: "provider:openrouter", key}`, `{id: "server", token}` |
| `meta` | `key` | none | `schema`, `migratedFrom`, `lastExportAt`, `projectionVersion` |

IndexedDB unique indexes can't be partial, so tombstoned rows would collide with a word
re-added later. The store therefore keeps the unique constraint in code: every write of
a word runs inside one `readwrite` transaction that reads the `natural` index, skips
rows with `deleted_at`, and applies slice 07's merge rules. `native_key` is computed with
slice 07's function (shared through `spec/fixtures/native-key.json`) and stored on the
local record only for indexing; it is not part of the exported word.

**Contingency.** Whether Firefox's "Delete cookies and site data when Firefox is
closed" clears an extension origin's IndexedDB is unverified (low confidence either
way). The store sits behind a small interface (`get`, `put`, `upsertByNatural`,
`query`, `changesSince`, `tx`), and the test plan includes this check as a release
gate. If it fails, Firefox builds use a second backend on `storage.local` with one key
per word (`w:<id>`) and keep secrets in IndexedDB, which that setting would then also
clear (the user re-enters a key, and words survive).

**Projection for content scripts.** After any committed write, the background
debounces for 100 ms, then writes two `storage.local` keys in one `set` call:

- `words`: an array of non-deleted words whose status is `active` or `well_known`
  (slice 35 keeps swapping well-known words, without the underline), in the compact shape
  the matcher needs (slices 14, 18 and 19 define the fields; at minimum `id`, `lang`,
  `language`, `native`, `sense`, `status`, `romanization`, `forms` with their flags,
  `note`, `created_at`).
- `wordsVersion`: an increasing integer, so tabs that adopt slice 15's visible-only
  re-read can check a small key first ([03 C3](../../docs/research/03-browser-extension.md)).

Keeping the key name `words` means today's content script (`content.js:173`,
`content.js:178-188`) keeps working unchanged during the transition. Words are not
secret from content scripts: they are what the content script writes into the page.
Budget: building the projection for 5,000 words takes under 30 ms and writing it under
50 ms on a mid-range laptop. A bulk add (slice 13) or an import (slice 12) commits in one
transaction and causes one projection write.

**Settings** that are not secret (`wordsHome`, `lookup.kind`, `lookup.provider`,
`lookup.baseUrl`, `lookup.model`, `server.url`) live in `storage.sync` under slice 39's
scheme, falling back to `storage.local` where sync is unavailable. Display settings
already in `storage.local` (`enabled`, `pausedHosts`, `hiddenLangs`; `popup.js:4-13`)
move with slice 39, not here.

### 3. Secrets: where the key lives

- The API key for each provider and the server token are stored only in the `secrets`
  store. Each provider keeps its own key, so switching providers and back doesn't lose one.
- Only the background reads secrets. It caches them in a module variable for the life of
  the worker; nothing writes them to `storage.session` or any other `storage` area.
- Extension pages send a key to the background with `{type: "secrets.set", id, value}`
  and never read it back. The UI shows `sk-or-…a1b2` (the first 6 and last 4 characters)
  from `{type: "secrets.describe"}`, plus "Replace" and "Remove".
- The background accepts `secrets.*`, `backend.*`, `words.*` writes and `migrate.*` only
  from extension pages: `sender.id === runtime.id` and `sender.url` starts with the
  extension's own origin, and `sender.tab` is either absent or the tab is an extension
  page. Content scripts may only send `sync`, `stats` (slice 46), `oauth.code` (section 4)
  and `pack.preview` (slice 47), the last two accepted only from the docs-site origin,
  and the in-page messages slices 19 and 33 define. Slice [26](../26-background-sync-correctness/SPEC.md) owns
  the generic sender check; this slice lists the privileged types.
- On upgrade, the old `token` key is copied from `storage.local` into `secrets` and then
  removed from `storage.local` in the same migration step (section 8).
- Keys are not encrypted at rest. Anything with access to the browser profile on disk
  can read them, as with every browser-stored credential; encrypting with a key stored
  next to it would add nothing. The provider screen recommends an OpenRouter key with a
  credit limit ([04 S24](../../docs/research/04-architecture-release.md)).
- Keys never go into `storage.sync`, exports (slice 12) or logs.
- **Where the key is typed (maintainer decision):** only on full extension pages, the
  welcome tab ([22](../22-first-run-onboarding/SPEC.md)) and the dashboard's settings
  ([21](../21-dashboard/SPEC.md)), never in the popup. Both pages have the same isolation
  as the popup, but a full page doesn't close when the learner switches tabs to copy the
  key, and it has room for the provider choice, the masked key, "Test" and the privacy note.
  The popup only links there. Any provider in section 4 works, including a model running
  on the learner's own machine.

### 4. Provider presets

Presets live in `spec/providers.json` (slice 09's folder), so the server can offer the
same list in its own config. Each preset has: `id`, `label`, `baseUrl`, `keyRequired`,
`keyUrl` (where to create one), `jsonMode` (`"json_object"`, `"none"`), `extraHeaders`,
`extraBody`, `modelSource` (`"openrouter-free"`, `"models-endpoint"`, `"manual"`),
`notes` (one plain sentence shown under the field).

| Preset | Base URL | Key | JSON mode | Notes and confidence |
|---|---|---|---|---|
| OpenRouter (default) | `https://openrouter.ai/api/v1` | Yes; "Connect OpenRouter" or paste | `json_object` when the model lists it in `supported_parameters` (slice 10 filters) | Sends `HTTP-Referer: https://github.com/ScriptKittyOS/mira` and `X-Title: Mira` for app attribution, and `reasoning: {enabled: false}` as today (`llm.ex:116-118`). Free tier: 20 requests a minute, 50 a day, 1,000 a day after a one-time $10 credit. High confidence. |
| OpenAI | `https://api.openai.com/v1` | Yes | `json_object` | High confidence. |
| Anthropic | `https://api.anthropic.com/v1` (OpenAI compatibility layer) | Yes | `none`: the layer ignores `response_format` (Anthropic docs, checked 2026-10-01) | Sends `anthropic-dangerous-direct-browser-access: true`, which the API requires for requests carrying a browser `Origin`. Anthropic describes the layer as for testing, not production. Medium confidence that the header is honoured on the compatibility endpoint; verify in the spike. |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | Yes | `json_object` | Medium confidence on JSON mode; verify. |
| Groq | `https://api.groq.com/openai/v1` | Yes | `json_object` | High confidence. |
| Ollama | `http://localhost:11434/v1` | No | `json_object` | Ollama rejects requests whose `Origin` is not on its allow-list, and the default list has no `chrome-extension://` or `moz-extension://` entry (read from `envconfig/config.go` on `main`, 2026-10-01). Note shown: "Start Ollama with `OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*`." |
| LM Studio | `http://localhost:1234/v1` | No | `none` until verified | LM Studio's support for `json_object` is unverified (it documents `json_schema`). Note: "Start the server in LM Studio's Developer tab." |
| Custom | user-entered | optional | `json_object` with automatic fallback to `none` on a 400 that names `response_format` | For any other OpenAI-compatible endpoint. |

Because the prompt (slice 09) already demands a bare JSON object and slice 09's
extractor tolerates prose around it, `jsonMode: "none"` is safe, just slightly less
reliable.

**CORS and network realities.** The background fetches with `<all_urls>` host
permission, which Chrome and Firefox treat as exempt from CORS for extension-origin
requests (high confidence). What still matters:

- Servers that check the `Origin` header themselves: Ollama (above) and Anthropic
  (header above). The browser sets `Origin` on these POSTs and the extension can't
  remove it.
- Firefox users can revoke host permissions; slice 28's permission check covers the
  provider origin as well as pages.
- Firefox's default MV3 CSP adds `upgrade-insecure-requests`; slice 28 sets an explicit
  CSP so `http://` LAN servers keep working. `http://localhost` already works.
- Chrome's Local Network Access prompt does not apply to extensions with matching host
  permissions from Chrome 144 (medium-high confidence, [03 C6](../../docs/research/03-browser-extension.md)).

**Models.** For OpenRouter, slice 10 builds the free-model list from
`GET /api/v1/models`. For presets with `modelSource: "models-endpoint"`, the settings
page lists `GET {baseUrl}/models` with a curated preference order from
`spec/providers.json`; "Automatic" picks the first available. The user can always type
a model id.

**Connect OpenRouter (PKCE).** A button that avoids copying a key:

1. The background makes a code verifier and S256 challenge and stores the verifier in
   `secrets` under `pkce:pending` with a 10-minute expiry.
2. It opens a tab at `https://openrouter.ai/auth?callback_url=<docs site>/connect/&code_challenge=…&code_challenge_method=S256&key_label=Mira`.
3. The docs site page (slice 44) needs no script of its own: Mira's content script,
   which runs on every page, recognises that exact origin and path, reads `?code=` and
   sends `{type: "oauth.code", code}` (the one extra content-script message type this
   slice allows). The code is useless without the verifier, which never leaves the
   background.
4. The background posts `{code, code_verifier, code_challenge_method: "S256"}` to
   `https://openrouter.ai/api/v1/auth/keys`, stores the returned key, and the tab shows
   "Connected. You can close this tab."

OpenRouter documents localhost callbacks and a "show the code on screen" mode; an
https callback on the docs site is undocumented but expected to work (medium
confidence). The spike also tries `identity.launchWebAuthFlow` (needs the `identity`
permission, no install warning in Chrome). If neither works, ship paste-a-key only and
keep the button for later. Pasting a key is always available.

### 5. Lookups that never block the UI

Slice [24](../24-add-flow-safety/SPEC.md) owns the add job: its record (`addJobs` in
`storage.local`), states, retry schedule, idempotency and everything the learner sees
about it. This slice supplies what 24 calls "the backend": one `lookup(job)` function per
`lookup.kind`, and the store that saves the result.

```
popup "shukran" + Enter
  -> slice 24 creates the job (returns at once; input clears, focus stays)
  -> background calls lookup(job) for the current lookup.kind:
       provider: slice 10 client -> preset request -> slice 09 validator
       server:   POST /api/v1/words {text, client_request_id: job.id, lang hint}
       none:     error lookup_not_set_up (slice 24 offers "Add it yourself" and the provider setup)
  -> store.upsertByNatural (slice 07 merge) -> results {created, updated, unchanged}
  -> projection -> every tab swaps the new word
```

What this slice adds to that flow:

- **Never wait on the model in the UI.** The popup's add button is never disabled; today's
  disabled button and "…" label (`popup.js:189-201`) go. A second word can be typed while
  the first is looking up.
- **No provider yet.** Slice 24 treats `key_missing` (slice 25's `lookup_not_set_up`) as failed. Recommendation to slice
  24: treat it as `waiting` instead, so that a learner who adds words before finishing
  setup has them looked up as soon as a key is saved (see Open questions).
- **Worker lifetime.** Each provider attempt is bounded by slice 10's deadline (under
  30 s, so Chrome never kills the worker mid-fetch, [06 F09](../../docs/research/06-adversarial-qa.md)).
  Saving a key, changing provider or coming back online wakes waiting jobs.
- **One store transaction per job.** Slice 24 describes the local save as one
  `storage.local.set`; with this slice it is one IndexedDB transaction keyed by the job id,
  which ignores a second application of the same job.

**Prompt and validation from `spec/`.** Slice 09's `spec/tools/sync-extension.mjs` copies
the runtime files into `extension/spec/` and generates `extension/spec/spec.js`
(`globalThis.MIRA_SPEC`), with a CI check that the copy is current. The background builds
the request exactly as the server does, including the recent-languages hint (today
`llm.ex:165-173` and `server/lib/slovo/words.ex:35-43`), computed locally from the
`updated_at` index: the five most recently touched languages. Slice 09's JS validator runs
on every model answer before anything is written; rejected words go into the job's
result with a reason.

**Server writes outbox.** In server mode (section 6), edits and deletes made in the
extension are applied locally at once and queued in the `outbox` store until the server
accepts them. The outbox drains on the sync schedule, oldest first, one request at a time;
an entry the server rejects is dropped, the local change is reverted at the next pull,
and slice 25 reports it.

### 6. The server as an add-on

Connecting is done from the settings page's "Server" section (slice 20/21 design):
URL, token (or slice 01's `mira-pair:1:` pairing string), "Test". Test calls `/health` (slice 29/40's JSON
form), then an authenticated `GET /api/v1/words?limit=1`, and reports server, token and
lookup status in one line.

| From → to | What happens | Data safety |
|---|---|---|
| Local → server, "Use my Mira server" | The user sees "Upload your 312 words to the server?" Mira posts them through slice 07's structured `POST /api/v1/words/batch` (no model calls) in batches of 500 and shows created, merged and unchanged counts. Then `wordsHome = "server"`, and the next pull replaces the local store with the server's view. | The local store is kept as is until the upload has fully succeeded. On any failure nothing switches. |
| Server → local, "Keep my words in this browser" | Mira pulls the full export (slice 12's `GET /api/v1/export`), imports it locally with ids preserved, then sets `wordsHome = "local"`. Asks whether to keep using the server for lookups. | The server's data is untouched. Telegram keeps writing to the server; the dialog says those words won't reach this browser unless the server is reconnected or slice 39 ships. |
| Disconnect | Same as server → local, with "Forget the server address and token" ticked. | As above. |

While `wordsHome = "server"`:

- The background pulls on the existing schedule (`background.js:48-59`, every minute,
  and on page load at most every 5 s, `background.js:67-73`), using slice 39's delta
  endpoint when the server supports it and the full list otherwise. Pulled words are
  written to the local store, so pages keep working offline ([05 S34](../../docs/research/05-learner-ux.md)).
- Adds are slice 24 jobs looked up by the server (`lookup.kind = "server"`) or, with
  `lookup.kind = "provider"`, looked up locally and then saved through slice 07's
  structured `POST /api/v1/words/batch`.
- Edits and deletes go through the outbox (section 5).

Slice 39 later replaces "server owns, extension mirrors" with true two-way sync. The
store's `changesSince` and the outbox are designed so that change is additive.

### 7. Content scripts

Content scripts keep reading `storage.local` (`words`, display settings) exactly as
today. They never read `serverUrl` or `token`; those keys disappear from `storage.local`
(section 8). The content script's `{type: "sync"}` message (`content.js:191`) stays and
is a no-op when `wordsHome = "local"`.

### 8. Upgrade and migration of existing installs

Runs once in `runtime.onInstalled` with `reason: "update"`, and again on worker start
if `meta.schema` is missing (so an interrupted migration resumes). Every step is idempotent.

1. Open `mira` and create the stores.
2. If `storage.local.token` is non-empty: copy it to `secrets["server"]`, copy
   `serverUrl` to settings, set `wordsHome = "server"` and `lookup.kind = "server"`.
   Otherwise set `wordsHome = "local"` and `lookup.kind = "none"` until the user picks a
   provider (slice 22 shows the welcome flow on install only; updated users with no
   token see a one-time "Finish setting up" card in the popup).
3. Seed the local store from the cached `storage.local.words` (`background.js:28-38`) so
   pages keep working immediately. Each cached word gets a new UUIDv7, `serverId` set to
   the old integer id, and `updated_at` set to now. Fields the cache lacks (`status`,
   `source_text`, timestamps; `word.ex:57-68`) stay empty until the first pull.
4. If the server answers slice 07's v1 API, do a full pull; server UUIDs replace the
   seeded ones, matched by `serverId`, then by the natural key. If the server is
   older, keep using `GET /api/words`, `POST /api/words` and `DELETE /api/words/:id`
   (`router.ex:17-68`) through a legacy adapter, and show "Update your Mira server to
   get editing and faster sync" once.
5. Remove `token` and `serverUrl` from `storage.local`. Write `meta.schema = 1`.

No step deletes a word. A failure in step 4 leaves the seeded store in place and retries
on the next alarm.

### 9. Edge cases

- **No key yet**: see section 5; the popup offers "Set up lookups", which opens the
  dashboard's settings (or the welcome tab during first run). The key is never typed in
  the popup.
- **Key replaced or provider switched mid-lookup**: the attempt is aborted
  (`AbortController`) and the job retried with the new settings ([06 F11](../../docs/research/06-adversarial-qa.md)).
- **Two windows add the same word**: the `natural` transaction merges them (slice 24
  says "Already in your list").
- **IndexedDB unavailable or full**: slice 25's `storage_full`; pages keep the
  last projection.
- **Vocabulary cap (20,000) reached**: adds fail with a `vocabulary_full` code, which slice 25 needs to add.

## Acceptance criteria

- [ ] A fresh profile with no server and no key can add a word manually, import a starter
      pack (slice 23) and see swaps on a page, with no network requests from the
      extension at all (verified in the network log).
- [ ] With an OpenRouter key and the mock provider, typing a word and pressing Enter
      clears the input and shows "looking up" within 100 ms, and the add button is never
      disabled.
- [ ] Closing the popup during a lookup still saves the word; reopening shows the result.
- [ ] Killing the service worker mid-lookup (Chrome `chrome://serviceworker-internals`
      stop, or the test harness) resumes the job and saves the word exactly once.
- [ ] A daily-quota response from the provider puts the job in `waiting` with a visible
      retry time; it completes after the mock quota resets without user action.
- [ ] Each of the eight presets completes an add against the mock server with the right
      URL, headers (including `anthropic-dangerous-direct-browser-access` for Anthropic
      and the OpenRouter attribution headers) and `response_format` presence.
- [ ] From a content script context, `storage.local.get(null)`, `storage.sync.get(null)`
      and `storage.session.get(null)` (where readable) contain no key or token string, in
      Chrome and Firefox.
- [ ] A content script sending `secrets.set`, `secrets.describe`, `words.delete` or
      `migrate.*` gets an error and nothing changes.
- [ ] Upgrading a profile with a token and 50 cached words keeps all 50 swapping on pages
      before and after the first pull, and `token` is gone from `storage.local`.
- [ ] Upgrading against a pre-07 server keeps add, undo and swapping working.
- [ ] Local → server with 300 words uploads them, reports counts, and on a forced failure
      halfway leaves `wordsHome = "local"` and all 300 words intact.
- [ ] Server → local keeps every word with its id, and pages swap identically before and after.
- [ ] The extension and the server produce the same normalised words for every fixture
      in `spec/fixtures/` (slice 09's shared CI job).
- [ ] Projection write for 5,000 words stays under 50 ms (median of 10 runs in CI).

## Test plan

Uses slice [02](../02-test-harness-and-ci/SPEC.md)'s harness.

- **Unit (Node, `node --test`, `fake-indexeddb` as a dev dependency only)**: store
  upsert and merge through the `natural` index including tombstones; projection shape;
  `lookup(job)` per backend against slice 24's job fixtures; outbox draining and
  rejection; preset request building per provider; migration steps 1-5 with interrupted
  runs at each step; sender checks for every privileged message type.
- **Shared spec tests**: the slice 09 fixtures run against the JS validator and
  `Mira.LLM` normalisation in the same CI job.
- **Mock provider**: extend slice 02's mock OpenAI-compatible server with switchable
  behaviours: 200 JSON, prose-wrapped JSON, 429 with `retry-after`, daily-quota 429,
  401, 400 on `response_format`, a 35 s stall, and an `Origin` check that mimics Ollama.
- **End-to-end (Playwright, unpacked extension, Chromium and Firefox)**: first-run local
  add; popup close mid-add; worker stop mid-add (Chromium); quota wait and resume (mock
  clock); upgrade from a fixture profile with a token and cached words; both mode switches
  with the Elixir server from slice 02's ExUnit fixture running.
- **Manual, release gate**: in Firefox with "Delete cookies and site data when Firefox is
  closed" on, restart and confirm words and key survive (section 2 contingency). Real
  keys against each preset once per release (a short checklist in `CONTRIBUTING`).
  Ollama with and without `OLLAMA_ORIGINS`.

## Rollout and migration

- Ships in the first release after slices 07, 09 and 10, no feature flag: new installs
  start local, existing installs with a token stay on their server (section 8).
- The legacy server adapter stays for two minor versions, then is removed with a
  changelog note.
- Server side: no change is required for existing users. Server-mode features beyond
  today's (structured save, export and import) need the server release that carries
  slices 07 and 12.
- Changelog: "Mira now works without a server. Your words live in your browser and
  Mira looks new words up with your own free OpenRouter key, or any provider you like.
  Already running a Mira server? Nothing changes; you can keep using it, or move your
  words into the browser from Settings, Server. Back up regularly with Export: uninstalling
  an extension deletes its data."

## Open questions

1. **Train-on-prompts default.** Many free OpenRouter models route to providers that may
   keep or train on prompts, and OpenRouter supports a per-request
   `provider.data_collection: "deny"` preference (medium confidence on the name). Sending
   it may leave few or no free models. Recommendation: don't send it by default, explain
   it in one sentence on the provider screen, and offer the toggle "Only use providers
   that don't keep my text", wired through slice 10.
2. **Anthropic: compatibility layer or native API?** The compatibility layer ignores JSON
   mode and is labelled for testing. Recommendation: ship the preset on the compatibility
   layer marked "beta"; add a small native Messages adapter only if users ask.
3. **Connect OpenRouter callback.** Docs-site callback (no new permission) or
   `identity.launchWebAuthFlow` (one more permission, no docs-site dependency)?
   Recommendation: the docs-site callback, decided by the spike.
4. **Server/provider combination at launch.** Supporting "server owns words, extension
   looks up" adds a path to test. Recommendation: include it; it is how a server user
   without a server-side key gets lookups, and it costs one extra save call.
5. **No key yet: waiting or failed?** Slice 24 fails a job with `key_missing` (`lookup_not_set_up` in slice 25).
   Recommendation: make it `waiting`, so words typed before setup is finished are looked
   up the moment a key is saved, with no retyping.

## Future work

- Two-way sync with a server and settings sync: slice 39.
- Cloud-drive sync (WebDAV, Gist) for large lists without a server ([04 section 3](../../docs/research/04-architecture-release.md)).
- On-device models (Chrome's built-in AI APIs, WebLLM) as a preset once they can produce
  the JSON reliably.
- Offline dictionary lookups when no model is reachable: slice 49.
