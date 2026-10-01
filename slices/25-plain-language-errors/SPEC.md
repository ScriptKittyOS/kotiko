# 25 · Plain-language errors

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | S (a day or two, plus server changes) |
| **Depends on** | [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (`_locales`, `t()`, `Kotiko.I18n`) |
| **Unblocks** | [13-bulk-add](../13-bulk-add/SPEC.md), [20-popup-redesign](../20-popup-redesign/SPEC.md), [21-dashboard](../21-dashboard/SPEC.md), [22-first-run-onboarding](../22-first-run-onboarding/SPEC.md), [24-add-flow-safety](../24-add-flow-safety/SPEC.md), [41-telegram-improvements](../41-telegram-improvements/SPEC.md) |
| **Sources** | [DECISIONS 2026-10-01, base language and localized interface](../DECISIONS.md); [05 §1, S1, S19, S34, S35, §3.5](../../docs/research/05-learner-ux.md); [06 F09, F14, F30, F31, F32](../../docs/research/06-adversarial-qa.md); [03 C4, C6](../../docs/research/03-browser-extension.md) |

## Problem

Errors reach the learner straight from internals, in red, with no next step:

- A fresh install shows "Paste your API token to connect." (`extension/background.js:10`),
  in red (`popup.js:123-126`), and auto-opens a Connection panel whose placeholder mentions
  "API_TOKEN from your .env" (`popup.html:146`, `popup.js:126, 133`). Someone who installed
  from a store has no `.env`.
- Network failures say "Can't reach http://localhost:4747. Is the server running?"
  (`background.js:20`) even when the real cause is a missing scheme
  ([06 F32](../../docs/research/06-adversarial-qa.md)), a revoked Firefox permission
  ([03 C4](../../docs/research/03-browser-extension.md)) or a Local Network Access block
  ([03 C6](../../docs/research/03-browser-extension.md)).
- Server and model failures pass through verbatim: "The server answered 500."
  (`background.js:24`), "The language model failed: {reason}" (`server/lib/slovo/router.ex:53`),
  which includes model ids and HTTP bodies.
- An HTML page answering 200 counts as a successful sync ([06 F31](../../docs/research/06-adversarial-qa.md)).
- No message says what still works. Swapping keeps working from cached words in
  `storage.local` (`content.js:173`), but the popup's red status line suggests everything is
  broken ([05 S34](../../docs/research/05-learner-ux.md)).
- Strings are hard-coded English in three places (popup, background, server), so a learner
  whose browser is in Spanish gets English errors ([05 S38](../../docs/research/05-learner-ux.md)).
  The maintainer decided Kotiko's interface follows the browser's language, with error
  messages localized from the first release ([DECISIONS](../DECISIONS.md),
  [50](../50-ui-localization-and-base-language/SPEC.md)).
- Some messages assume the learner reads English: "That looks like English" for a word in
  the learner's own language, and "This page isn't in English" for any other page
  ([16](../16-what-not-to-swap/SPEC.md) as first written). For a Spanish reader both are
  wrong.

## Goals

- Every failure, from either backend, is reduced to a stable **error code** before it reaches
  the UI.
- Every code has one message that says what happened, what still works, and the next step,
  in the voice of [05 §3](../05-brand-identity/SPEC.md).
- Technical detail is available behind "Details" for self-hosters, never in the main line.
- Offline and backend outages are shown as calm states, not red errors, and always say that
  existing words keep working.
- Every message is a key in `_locales` (extension) or `server/priv/locales` (Telegram bot),
  keyed by code, complete in English and Spanish at launch
  ([50 §8](../50-ui-localization-and-base-language/SPEC.md)). Codes travel on the wire;
  words are chosen at the edge, in the learner's interface language.
- No message assumes which language the learner reads; messages about languages name them
  with `Intl.DisplayNames` in the interface language.

## Non-goals

- Retrying, deadlines and quota tracking: [10](../10-llm-client-resilience/SPEC.md).
- Response validation and credential-change races: [26](../26-background-sync-correctness/SPEC.md).
  This slice gives their failures a code and a message.
- Locales beyond English and Spanish: community translation through
  [50 §9](../50-ui-localization-and-base-language/SPEC.md)'s workflow; missing keys fall
  back per key.

## User stories

- As a learner whose server is down, I want to be told my words still work on pages, so that
  I don't think Kotiko is broken.
- As a learner who has used today's free lookups, I want to know I can still add words myself
  and when lookups come back.
- As a self-hoster, I want the technical cause one click away, so that I can fix my setup.
- As a learner in Puerto Rico with a Spanish browser, I want "Estás sin conexión. Tus 42
  palabras siguen funcionando en las páginas.", not an English sentence.

## Specification

### 1. Error shape

**In the extension**, every failure is an object:

```js
{ code: "server_unreachable",
  details: { reason: "network", status: null, retry_at: null,
             text: "GET http://10.0.0.5:4747/api/v1/words: TypeError: Failed to fetch" } }
```

`details.retry_at` (UTC, when known) and `details.reason` follow
[10](../10-llm-client-resilience/SPEC.md)'s lookup results, so a code from the model client
passes through unchanged. `extension/errors.js` exports `CODES` (the catalog below, the single
list [44](../44-docs-site/SPEC.md) checks its `/help/errors/#<code>` anchors against),
`toError(anything)` (normalizes exceptions, HTTP responses and provider bodies),
`message(code, vars)` (looks up `error_<code>`, `error_<code>_action` and, for reasons,
`error_<code>_<reason>` with `KotikoI18n.t()`, so it returns text in the interface language)
and `isTransient(code)`. Background handlers only
ever store or return this shape; `syncError` becomes `{code, details, at}` instead of a
string (`background.js:40` today).

**From the server**, `/api/v1` error responses use [07 §5](../07-word-model-v2/SPEC.md)'s
shape:

```json
{ "error": { "code": "quota_exhausted", "message": "Plain message for clients that show text",
             "details": { "reason": "daily_limit", "retry_at": "2026-10-02T00:00:00.000Z" } } }
```

The extension ignores `message` and renders `code` with its own catalog. `message` exists
for other clients (curl, scripts): the server picks its locale from the request's
`Accept-Language` among the shipped server locales (`en`, `es` at launch) with
`Kotiko.I18n.t/3` ([50 §8](../50-ui-localization-and-base-language/SPEC.md)), and uses the
server's `default_locale` when nothing matches.

The legacy routes kept for 0.2 extensions (`/api/words`) keep `{"error": "<string>"}`, so those
extensions still show something sensible (`background.js:24` reads `body.error`). Upstream
text (provider bodies, model ids) goes into `details.text` only when the server runs with
`KOTIKO_ERROR_DETAILS=true` (the default for local binds), because it may contain more than
the user should share. The Telegram bot ([41](../41-telegram-improvements/SPEC.md)) uses the same
codes, with messages from `server/priv/locales/<locale>/messages.json` (the same `error_<code>`
keys) in the learner's language as 41 chooses it.

### 2. Catalog

Each code's main line is the key `error_<code>` and its action label `error_<code>_action`.
`{n}` is the learner's active word count (plural keys, `Intl.NumberFormat`); `{provider}` the
configured lookup service name; `{time}` a local time from `Intl.DateTimeFormat(uiLocale,
{timeStyle: "short"})` ("after 2:00 pm" / "después de las 14:00"); `{lang}` and `{base}`
language names in the interface language. The table gives the English source; the Spanish
launch copy for the most-seen codes follows it. Severity decides the presentation (§3).

| Code | Severity | Main line | Next step (action) | Detected when |
|---|---|---|---|---|
| `offline` | state | "You're offline. Your {n} words still work on pages. New words will be looked up when you're back." | none | `navigator.onLine === false`, or fetch fails while offline |
| `server_unreachable` | state | "Can't reach your Kotiko server. Your {n} words still work on pages; adding new ones will work once it's back." | "Try again", "Connection settings" | network error to the configured server |
| `server_address_invalid` | blocking | "That server address doesn't look right. Try one like http://localhost:4747." | focus the field | no `http(s)://` scheme, or unparsable ([06 F32](../../docs/research/06-adversarial-qa.md)) |
| `not_kotiko_server` | blocking | "Something answered at that address, but it isn't a Kotiko server. Check the address." | "Connection settings" | non-JSON, or JSON without `words` array ([06 F31](../../docs/research/06-adversarial-qa.md)) |
| `server_key_rejected` | blocking | "Your Kotiko server didn't accept the access key. Paste it again in Connection settings." | "Connection settings" | 401 |
| `server_outdated` | state | "Your Kotiko server needs an update for this. Everything else still works." | "How to update" (docs) | missing endpoint or field, version below minimum |
| `local_network_blocked` | blocking | "Your browser blocked Kotiko from reaching a server on your network. Allow it, then try again." | "How to allow" (docs) | Chrome Local Network Access failure ([03 C6](../../docs/research/03-browser-extension.md)) |
| `permission_missing` | blocking | "Kotiko needs permission to read pages to swap words." | "Allow" (calls `permissions.request`) | `permissions.contains` false ([03 C4](../../docs/research/03-browser-extension.md)) |
| `lookup_not_set_up` | info | "To look up new words, set up word lookup. Your words, and words you type as “word = meaning”, work without it." | "Set up lookups" | local mode, no provider ([11](../11-local-first-mode/SPEC.md)) |
| `key_rejected` | blocking | "{provider} didn't accept your key. Check it in settings." | "Lookup settings" | provider 401/403 |
| `quota_exhausted` | waiting | "You've used today's free lookups. Add words yourself, or Kotiko will try again {time}." | "Add it yourself" | provider 429 with daily-limit marker, or [10](../10-llm-client-resilience/SPEC.md) quota at 0 |
| `quota_exhausted` with `details.reason: "payment_required"` | failed | "{provider} needs credit on your account before it will look up words, even free ones. Add credit there, or add words yourself." | "Add it yourself", "Open {provider}" | provider 402 ([10](../10-llm-client-resilience/SPEC.md)); no `retry_at` |
| `user_quota_exhausted` | waiting | "You've used today's lookups on this Kotiko server. Add words yourself, or Kotiko will try again {time}." | "Add it yourself" | per-user server limit ([48](../48-multi-user-and-classroom/SPEC.md)) |
| `rate_limited` | waiting | "Word lookup is busy. Kotiko will try again in a minute." | "Add it yourself" | 429 without daily marker |
| `model_unavailable` | waiting | "Word lookup isn't answering right now. Kotiko will keep trying." | "Add it yourself" | all models failed with 5xx or network errors |
| `lookup_timeout` | waiting | "That lookup took too long. Kotiko will try again." | "Add it yourself" | [10](../10-llm-client-resilience/SPEC.md) deadline exceeded |
| `bad_lookup_result` | failed | "The lookup came back garbled. Try again, or add it yourself." | "Try again", "Add it yourself" | output fails [09](../09-shared-word-spec-and-prompt/SPEC.md) validation |
| `no_word_found` | failed | "Couldn't find a word in “{text}”. Try the word on its own, or add it yourself." | "Add it yourself" | lookup returned no words |
| `rejected_same_as_gloss` | failed | "“{text}” is already a word in {base}. Which language do you want it in?" | language picker | every word was rejected by [09](../09-shared-word-spec-and-prompt/SPEC.md) as `same_as_gloss` (its native equals its meaning in that base) or `target_is_base` (its language is that base); `{base}` is the base it matched |
| `input_too_long` | failed | "That's a lot of text for one word. To add a list, use bulk add." | "Bulk add" ([13](../13-bulk-add/SPEC.md)) | over [09](../09-shared-word-spec-and-prompt/SPEC.md)'s `rules.max_input_chars` (200), checked before any model call |
| `word_conflict` (`details.reason: "stale"`) | failed | "This word changed since. Open it to fix." | "Open" | 409 from PATCH with `if_updated_at` ([07](../07-word-model-v2/SPEC.md)) |
| `word_conflict` (`details.reason: "duplicate"`) | failed | "You already have {native} in {Language}. Merge them?" | "Merge", "Cancel" | 409 on edit or restore when another live word holds the natural key |
| `word_gone` | info | "That word was already removed." | none | 404 on a word id, or 410 when restoring a word deleted more than 30 days ago |
| `storage_full` | blocking | "Kotiko's storage in this browser is full. Export your words, then remove ones you don't need." | "Export" | quota error from IndexedDB or `storage.local` ([11](../11-local-first-mode/SPEC.md)) |
| `vocabulary_full` | failed | "You have 20,000 words, the most Kotiko keeps. Remove some you know well to add more." | "Open your words" | [11](../11-local-first-mode/SPEC.md)'s vocabulary cap |
| `resync_required` | state | "Kotiko is catching up with your server. Your words still work on pages." | none (automatic full resync) | 410 from [39](../39-multi-device-sync/SPEC.md)'s delta sync |
| `server_reset` | blocking | "All words on your Kotiko server were deleted from another device. Keep the words in this browser, or match the server?" | "Keep mine", "Match the server" | 409 `server_reset` from [39](../39-multi-device-sync/SPEC.md) |
| `import_unreadable` | failed | "Couldn't read that file. Kotiko reads .txt, .csv, .tsv and .json files." | "Choose another file" | [13](../13-bulk-add/SPEC.md) parser |
| `unsupported_page` | state | "Kotiko can't run on browser pages like this one." | none | `chrome://`, `about:`, `edge://`, store pages, PDF viewer, `view-source:` |
| `page_not_in_base` | state | "This page is in {lang}, which isn't one of your languages. Kotiko leaves it alone." | "I read {lang} too" (settings, [21](../21-dashboard/SPEC.md)), "Swap here anyway" | the page language isn't one of `s:ui.baseLangs` ([16](../16-what-not-to-swap/SPEC.md), [50 §2](../50-ui-localization-and-base-language/SPEC.md)) |
| `base_no_words` | info | "No words have meanings in {base} yet." | "Add meanings" ([21](../21-dashboard/SPEC.md)) | the page is in a base no record has a gloss in |
| `internal` | failed | "Something went wrong in Kotiko. Try again; if it keeps happening, please report it." | "Copy details" | anything unmapped |

**Spanish launch copy** (`es`, informal `tú`, gender-neutral per
[50 §8](../50-ui-localization-and-base-language/SPEC.md)); every other key also ships in
`es` at launch, reviewed with the rest of the locale:

| Key | es |
|---|---|
| `error_offline` | Estás sin conexión. Tus {n} palabras siguen funcionando en las páginas. Las nuevas se buscarán cuando vuelvas. |
| `error_server_unreachable` | No se puede contactar tu servidor de Kotiko. Tus {n} palabras siguen funcionando en las páginas; podrás agregar nuevas cuando vuelva. |
| `error_server_address_invalid` | Esa dirección de servidor no parece correcta. Prueba una como http://localhost:4747. |
| `error_permission_missing` | Kotiko necesita permiso para leer las páginas y cambiar palabras. |
| `error_lookup_not_set_up` | Para buscar palabras nuevas, configura la búsqueda. Tus palabras, y las que escribas como “palabra = significado”, funcionan sin ella. |
| `error_key_rejected` | {provider} no aceptó tu clave. Revísala en los ajustes. |
| `error_quota_exhausted` | Ya usaste las búsquedas gratis de hoy. Agrega palabras tú, o Kotiko lo intentará de nuevo {time}. |
| `error_rate_limited` | La búsqueda de palabras está ocupada. Kotiko lo intentará de nuevo en un minuto. |
| `error_model_unavailable` | La búsqueda de palabras no responde ahora. Kotiko seguirá intentando. |
| `error_lookup_timeout` | Esa búsqueda tardó demasiado. Kotiko lo intentará de nuevo. |
| `error_bad_lookup_result` | La búsqueda volvió con algo ilegible. Inténtalo de nuevo, o agrégala tú. |
| `error_no_word_found` | No encontré ninguna palabra en “{text}”. Prueba con la palabra sola, o agrégala tú. |
| `error_rejected_same_as_gloss` | “{text}” ya es una palabra en {base}. ¿En qué idioma la quieres? |
| `error_input_too_long` | Es mucho texto para una palabra. Para agregar una lista, usa agregar en bloque. |
| `error_storage_full` | El almacenamiento de Kotiko en este navegador está lleno. Exporta tus palabras y quita las que no necesites. |
| `error_unsupported_page` | Kotiko no puede funcionar en páginas del navegador como esta. |
| `error_page_not_in_base` (an alias of 50's `base_page_other`, one translation) | Esta página está en {lang}, que no es uno de tus idiomas. Kotiko no la toca. |
| `error_internal` | Algo salió mal en Kotiko. Inténtalo de nuevo; si sigue pasando, avísanos. |
| `error_add_yourself_action` | Agrégala tú |
| `error_try_again_action` | Reintentar |
| `error_details` | Detalles |

Rules for the catalog:

- No main line contains "token", "API", "LLM", "model", ".env", an HTTP status, a model id or
  a stack trace, in any locale (the lint runs on every `_locales` file, with each locale's
  translations of those words listed in `scripts/i18n-banned-terms.json`). "Access key"
  ("clave de acceso") is the user-facing term for the server's `API_TOKEN`; "key" ("clave")
  alone for a provider key, named after the provider ("your OpenRouter key").
- No main line assumes the learner reads a particular language ("looks like English",
  "isn't in English"); languages are always placeholders filled from the learner's settings.
- Lines are whole sentences with named placeholders, never concatenated; translators can
  reorder placeholders freely.
- "Details" content (request lines, exception text) is technical and never translated.
- `{n}` is omitted gracefully when 0: "Your words still work on pages" becomes "Words you
  type as “word = meaning” still work" when the list is empty.

### 3. Presentation by severity

| Severity | Where | Look | Behavior |
|---|---|---|---|
| state | Popup status area; dashboard top banner | `--warning-soft` with warning icon for outages; `--blue-soft` with info icon for offline and unsupported page | Stays while true; clears itself when resolved; never red |
| waiting | The add job's line ([24](../24-add-flow-safety/SPEC.md)) | `--ink-2` text with a clock icon | Retries on its own; shows the next step inline |
| failed | The add job's line, or the field that caused it | `--danger` icon and text | Stays until dismissed or retried |
| blocking | Popup status area and the relevant settings field | `--danger-soft` banner with error icon and one button | Stays until fixed |
| info | Inline, near the action | `--ink-2` with info icon | Dismissible |

Icons and colors are from [06 §4.2](../06-design-system/SPEC.md); status is never color
alone. The popup never auto-opens settings or a Connection panel; it offers a button.

```
Popup status area, server down (state):

  ┌────────────────────────────────────────────┐
  │ (!) Can't reach your Kotiko server. Your 42  │
  │     words still work on pages; adding new  │
  │     ones will work once it's back.         │
  │     [Try again]  Connection settings       │
  │     Details ▸                              │
  └────────────────────────────────────────────┘

Details expanded:

  │     Details ▾                              │
  │     GET http://10.0.0.5:4747/api/words     │
  │     TypeError: Failed to fetch             │
  │     Last worked 14 min ago        [Copy]   │
```

"Details" is a `<details>` element; its content is `--font-mono`, `--t-small`, selectable,
with a "Copy" button that copies code, details, extension version and browser version (no
word data, no URLs other than the server's).

### 4. Offline and degraded behavior

- Swapping never depends on the network: content scripts read cached words from
  `storage.local`. This slice adds an end-to-end test that keeps it so.
- When `offline` or `server_unreachable` is active, adds still queue
  ([24](../24-add-flow-safety/SPEC.md)), manual adds save locally (in server mode they are
  kept in the queue and sent when the server returns), and the dashboard stays fully usable
  for browsing and editing local data; edits made while the server is unreachable queue the
  same way.
- When the condition clears, state banners disappear without a "back online" toast; waiting
  jobs complete and show their normal results.

### 5. Migration of existing strings

| Today | Becomes |
|---|---|
| "Paste your API token to connect." (`background.js:10`) | Not an error: in local mode no server is needed; in server mode `server_key_rejected` with "Connection settings" |
| "Can't reach {url}. Is the server running?" (`background.js:20`) | `server_address_invalid`, `local_network_blocked`, `permission_missing` or `server_unreachable` |
| "The server rejected that API token." (`background.js:22`) | `server_key_rejected` |
| "The server answered {status}." (`background.js:24`) | mapped code, status in details |
| "The language model failed: …" (`router.ex:53`) | `model_unavailable` / `rate_limited` / `quota_exhausted`, text in details |
| "Removed." regardless of outcome (`popup.js:172`) | [24](../24-add-flow-safety/SPEC.md) undo results |
| "No answer from the extension. Try again." (`popup.js:196`) | Not needed: adds reply immediately once queued |

## Acceptance criteria

- [ ] Every `throw` and error response in `extension/` and `server/` produces a code from the
      catalog; a test fails on an unmapped code.
- [ ] A string lint finds no "token", "API", "LLM", "model", ".env" or digits-followed-by-HTTP
      status patterns in catalog main lines, in `en` and `es`.
- [ ] Every code in `CODES` has `error_<code>` in `en` and `es`; slice 50's parity check
      fails the build otherwise.
- [ ] With the browser in Spanish and the server stopped, the popup shows
      `error_server_unreachable` in Spanish with the correct word count.
- [ ] A Spanish-base learner adding "perro" gets `rejected_same_as_gloss` naming "español"
      (in Spanish: "“perro” ya es una palabra en español…"); no message contains "English"
      unless English is one of the learner's languages.
- [ ] `POST /api/v1/words` with `Accept-Language: es` returns a Spanish `message`; with no
      header, the server's default; the extension shows its own catalog text either way.
- [ ] With the server stopped, the popup shows the `server_unreachable` state with the
      correct word count, and a test page still has its swaps.
- [ ] A server address of `localhost:4747` shows `server_address_invalid`, not "Can't reach".
- [ ] A captive-portal style HTML 200 response shows `not_kotiko_server` and does not change
      cached words.
- [ ] A provider 429 with a daily-limit marker shows `quota_exhausted` with a local time; the
      job retries after that time.
- [ ] The popup never opens a settings panel on its own.
- [ ] Old extension versions talking to the new server show the plain `error` string.
- [ ] "Copy details" output contains no word data.
- [ ] A provider 402 shows the `payment_required` message and does not schedule a retry.
- [ ] Every code in `errors.js` `CODES` has an anchor on the docs error page
      ([44](../44-docs-site/SPEC.md) CI).

## Test plan

- **Unit:** `toError` with fixtures: fetch `TypeError` online and offline, 401, 402, 404, 409,
  429 with and without daily markers (OpenRouter, OpenAI, Anthropic, Gemini, Groq body
  shapes), 500, 502, HTML 200, invalid JSON, `storage.local` quota error. `message()` for every
  code with and without placeholders, in `en` and `es`, including plural `{n}` and a
  locale-formatted `{time}`.
- **Server (ExUnit):** each `/api/v1` error path returns `{error: {code, message, details}}` with `details.retry_at` where
  relevant; `details` omitted when disabled; `message` follows `Accept-Language` (`en`, `es`,
  fallback); `Kotiko.I18n` has every `error_<code>` key in both server locales.
- **End-to-end:** server stopped, wrong key, wrong address, offline emulation, mock provider
  returning 429; screenshots of each popup state in light and dark, with the browser in
  English and in Spanish.

## Rollout and migration

Ships with the popup rewrite. `syncError` strings already in storage are converted to
`{code: "internal", details: <old string>}` on first run. `page_not_english` and
`rejected_english` don't ship; nothing stored refers to them. Changelog: "Clearer messages,
in your language, that tell you what still works and what to do next."

## Open questions

1. **Show details by default for self-hosters?** Recommendation: no; always collapsed, but
   remember the expanded state per browser so people who want it keep it open.
2. **Should the server's `message` follow `Accept-Language`?** Recommendation: yes; it costs
   one lookup and makes curl and third-party clients friendly in Spanish too, while the
   extension keeps using codes.

## Future work

- A diagnostics page in the dashboard that runs connection, key and lookup checks in one go
  (shares the key check from [22](../22-first-run-onboarding/SPEC.md)).
