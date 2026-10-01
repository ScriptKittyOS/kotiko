# 26 · Background sync correctness

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | S (a day or two) |
| **Depends on** | None (uses slice [02](../02-test-harness-and-ci/SPEC.md)'s harness for tests) |
| **Unblocks** | [11](../11-local-first-mode/SPEC.md) (server pull and the generic sender check), [39](../39-multi-device-sync/SPEC.md) |
| **Sources** | [06 F10, F11, F31, F32, F39, section 4 item 6](../../docs/research/06-adversarial-qa.md); [03 C2, E2, E3](../../docs/research/03-browser-extension.md); [05 S34](../../docs/research/05-learner-ux.md) |

## Problem

`extension/background.js` is 99 lines that keep the word cache in step with the server.
Research 06 reproduced five ways it ends up wrong, all in a Node harness running the
real file:

- **Stale cache after add or undo (F10).** `sync()` returns the in-flight promise if one is
  running (`background.js:28-29`). An add that finishes during a slow sync calls `sync()`
  (`background.js:80`) and gets that older response, snapshotted before the insert. The
  new word doesn't appear for up to a minute; after Undo, the removed word keeps showing.
- **New credentials ignored (F11).** Saving a corrected token while a request with the
  bad one is in flight: `storage.onChanged` calls `sync()` (`background.js:96-99`), which
  returns the old promise, whose 401 then writes "The server rejected that API token."
  The popup shows that error after the fix, until the next alarm. An unreachable
  Tailscale address can keep the stale request alive for over a minute.
- **A wrong service counts as success (F31).** A captive portal or another app answering
  200 with HTML: `res.json()` fails, `.catch(() => ({}))` gives `{}` (`background.js:23`),
  `words` is `undefined`, and `syncError: null` plus `lastSync` are written. The popup
  says "synced just now".
- **Server address without a scheme (F32).** `localhost:4747` parses with `localhost:` as
  the scheme; `192.168.1.5:4747` resolves relative to the extension's own origin
  (`background.js:11-20`). Both report "Can't reach ... Is the server running?".
- **No sync after re-enabling (F39).** `ensureAlarm()` runs only in `onInstalled` and
  `onStartup` (`background.js:52-59`). Re-enabling a disabled extension fires neither, so
  syncs then depend only on page loads.

Two more from research 03, read from the code:

- **Any extension context can add and delete words (E3).** `onMessage` runs `add` and
  `remove` for any sender (`background.js:67-93`), including content scripts running in
  every web page's renderer.
- **No response validation (E2).** Whatever the server returns is written to storage and
  inserted into every page. A buggy or hostile server could send a form "a" or 100,000 words.

## Goals

- A sync requested at any moment produces a cache that reflects the server at or after
  that moment.
- Changing the server address or token cancels the old request and shows the result of
  the new credentials only.
- Only a response that is a valid Mira word list is accepted; everything else is a
  specific, honest error.
- Server addresses are normalised and validated in one place.
- The periodic sync always exists while the extension is enabled.
- Only extension pages can trigger writes.
- The logic is a pure, tested module that slice 11 reuses for its server pull.

## Non-goals

- Delta sync, ETags and two-way merge: slice [39](../39-multi-device-sync/SPEC.md).
- The persistent add queue and local store: slice [11](../11-local-first-mode/SPEC.md).
- Error wording: slice [25](../25-plain-language-errors/SPEC.md). This slice defines the codes.
- The popup's connection form (dirty fields, F16): slice [20](../20-popup-redesign/SPEC.md),
  which calls this slice's URL normaliser.
- Moving the token out of `storage.local`: slices [11](../11-local-first-mode/SPEC.md) and [28](../28-privacy-and-store-readiness/SPEC.md).

## User stories

- As a learner who just added a word, I want it on the page I open next, not a minute later.
- As a learner who pasted the wrong token and then the right one, I want "connected", not
  a stale error.
- As a learner on hotel Wi-Fi with a login page, I want "that address isn't a Mira server",
  not "synced just now".
- As a learner who typed `192.168.1.5:4747`, I want it to just work.

## Specification

### 1. Sync controller (`extension/lib/sync-controller.js`)

A pure module (slice 02's pattern) with injected `fetch`, `storage` and `now`:

```
createSyncController({fetchWords, readCreds, writeResult, now}) -> {
  request({reason, force}) -> Promise<Result>   // never rejects
  credentialsChanged() -> void
}
```

State: `generation` (integer), `running` (`{gen, controller: AbortController, promise}`
or null), `pending` (`{promise, resolve}` or null), `lastStartedAt`.

**`request()`**:

1. If nothing is running: start a run (below) and return its promise.
2. If a run is in progress: don't reuse its result. Create (or reuse) one `pending`
   follow-up and return its promise. When the current run ends, the follow-up starts
   immediately. Any number of requests during one run collapse into a single follow-up.
   This is the F10 fix: a sync requested after an add always starts after the add finished.

**A run**:

1. Capture `gen = generation` and read credentials.
2. No token: write `{code: "server_key_rejected", details: {reason: "no_token"}}` and stop
   (no request). (In local mode, slice 11, there is no server sync at all, so this never shows.)
3. `fetchWords(creds, signal)` with an `AbortController` combined with
   `AbortSignal.timeout(20_000)`.
4. When it settles, **if `gen !== generation`, discard the result** (write nothing).
5. Otherwise validate (section 3) and write.

**`credentialsChanged()`** (called from `storage.onChanged` when the server address or
token changes, and from slice 11's secrets store): `generation++`, abort the running
request, drop it, and start a fresh run. Its abort is not an error and is never written
(F11 fix).

**Throttle.** Page-load requests from content scripts (`reason: "page"`) are skipped if a
run started less than 5 s ago (today's rule, `background.js:69-72`) and nothing is
pending. `force` (popup "Sync now", after an add or remove) bypasses the throttle.

### 2. After add and remove

`add` and `remove` (today `background.js:74-87`) apply their result to the cache
immediately, then request a sync:

- add: merge each returned word into `words` by id (v1: slice 07's `results[].word`;
  legacy: `words[]`), newest first, before `request({reason: "add", force: true})`.
- remove: drop the id from `words`, then request a sync.
- Both writes go through the same serialised writer as sync results, so a sync landing
  between the two can't reorder them; the follow-up sync is authoritative.

### 3. Response validation (`extension/lib/validate-words.js`)

A sync result is accepted only if all of these hold:

1. Status 200 and `Content-Type` contains `application/json`; otherwise
   `not_mira_server` (F31), unless status is 401 (`server_key_rejected`), 404 on
   `/api/v1/words` (fall back to legacy `/api/words` once, slice 07), 421
   (`server_address_invalid`, the server's Host check from slice 01), 5xx (`internal`
   with the status in `details`).
2. Body parses as JSON and `Array.isArray(body.words)`; else `not_mira_server`.
3. At most 20,000 entries (slice 09's `max_vocabulary`); beyond that, keep the first
   20,000 and record `{dropped: n, reason: "too_many_words"}`.
4. Each word passes the client checks from slice 09's `rules.json` (via `MIRA_SPEC` once
   slice 09 lands; until then, these constants): `id` is a string or integer; `lang` is a
   non-empty string up to 35 characters; `native` 1-64 characters with no newline;
   `forms` (strings, or slice 07 Form objects with `text`) each 2-40 characters, at most
   10. Invalid words are dropped and counted, never inserted into pages ([03 E2](../../docs/research/03-browser-extension.md)).

The written result is `{words, lastSync, syncError: null, syncWarnings: {dropped} | null}`
on success, or `{syncError: {code, message, at}}` on failure. `words` and `lastSync` are
left as they were on failure, so pages keep working from the cache ([05 S34](../../docs/research/05-learner-ux.md)).
`syncError` changes from a string to an object; the popup reads `syncError.message`
(slice 25 owns the text) and treats an old string value as a message for one release.

Words are written only when they changed, compared by a cheap fingerprint (count plus a
hash of ids and `updated_at`, or the JSON string for legacy responses), as today
(`background.js:34-38`).

**Error codes** are slice 25's: `server_address_invalid` (bad URL, or a 421),
`server_unreachable` (network error or timeout; `details.reason` says which),
`local_network_blocked` (when slice 25's detection applies), `server_key_rejected`,
`not_mira_server`, `internal` (5xx). An abort after a credential change is internal
to the controller and never written.

### 4. Server address normalisation (`extension/lib/url.js`)

`normalizeServerUrl(input) -> {ok: true, url} | {ok: false, code: "server_address_invalid", hint}`:

1. Trim. Empty is invalid.
2. If there is no `scheme://` prefix, add one: `http://` when the host is `localhost`, an
   IPv4 or IPv6 literal, ends in `.local`, or is in 100.64.0.0/10 (Tailscale);
   `https://` otherwise (a MagicDNS name or a domain behind a proxy). (F32)
3. Parse with `new URL()`. Only `http:` and `https:`. Reject user info
   (`user:pass@host`) with a hint to use the token field. Reject query and fragment.
4. Keep an explicit port and any path (reverse proxies may mount Mira under `/mira`);
   strip trailing slashes.
5. Return the canonical string.

The popup (slice 20) calls it on save and shows the normalised value; the background
calls it again before every request and reports `server_address_invalid` instead of
"Can't reach".

### 5. Alarms (F39)

At the top level of the worker script (runs on every worker start, including after
re-enabling):

```js
ext.alarms.get("mira-sync").then((a) => a || ext.alarms.create("mira-sync", { periodInMinutes: 1 }));
```

`onInstalled` and `onStartup` keep calling the same function (cheap and idempotent) and
request a sync. On update, the legacy `slovo-sync` alarm is cleared (slice 04).

### 6. Message sender checks (E3)

`extension/lib/messages.js` wraps `runtime.onMessage`. Each handler declares who may call it:

```js
handlers = {
  sync:   { from: ["page", "content"], run: ... },
  add:    { from: ["page"], run: ... },
  remove: { from: ["page"], run: ... },
  stats:  { from: ["content"], run: ... },          // slice 46 page counts, no URLs
  "oauth.code":   { from: ["docs"], run: ... },     // slice 11 Connect OpenRouter
}
```

- `"page"` (an extension page: popup, dashboard, welcome, options) means
  `sender.id === runtime.id` and `sender.url` starts with `runtime.getURL("")`. In
  Firefox and Chrome, extension pages opened in a tab do have `sender.tab`; the URL check
  is what decides.
- `"content"` means `sender.id === runtime.id` and `sender.tab` is set and `sender.url` is
  `http(s):`.
- `"docs"` means `"content"` and, in addition, `sender.url`'s origin is exactly the docs
  site's origin (slice 44); nothing else may send these.
- Anything else (other extensions, unknown types, a disallowed sender) gets
  `{error: {code: "forbidden"}}` for known types and no response for unknown ones.
- Payloads are checked: `add.text` is a string of 1-200 characters; `remove.id` is a
  string or integer.

Slice 11 adds its privileged types (`secrets.*`, `words.*`, `migrate.*`) to this table
with `from: ["page"]`; slices 19 and 33 add their content-script types explicitly.

### 7. Wiring in `background.js`

`background.js` shrinks to: build the controller with real `fetch` and `storage`; register
the alarm, `onInstalled`, `onStartup`, `onAlarm` and `storage.onChanged` (which calls
`credentialsChanged()` for `token` or `serverUrl` changes only); register the message
handlers. The `api()` helper (`background.js:8-26`) uses `normalizeServerUrl` and returns
coded errors. Add requests get `AbortSignal.timeout(28_000)`, inside Chrome's 30 s limit
and above slice 10's 25 s server deadline.

When slice 11 lands, its server-pull job uses the same controller with a `writeResult`
that writes to IndexedDB instead of `storage.local`.

## Acceptance criteria

- [ ] F10: with a slow sync in flight, an add followed by reading `words` after both
      settle includes the new word; an undo removes it. (Harness test.)
- [ ] F11: a 401 in flight, then a token change: the final state has `syncError: null`
      and words from the new token; the first request was aborted.
- [ ] Five sync requests during one run cause exactly one follow-up request.
- [ ] F31: a 200 `text/html` response yields `not_mira_server`, leaves `words` and
      `lastSync` unchanged.
- [ ] A response with a word whose form is "a" or whose `native` is 10 KB drops that word,
      keeps the rest, and records `syncWarnings.dropped`.
- [ ] F32: `localhost:4747` → `http://localhost:4747`; `192.168.1.5:4747` →
      `http://192.168.1.5:4747`; `mira.tail1234.ts.net` → `https://mira.tail1234.ts.net`;
      `http://user:pw@host` is rejected.
- [ ] F39: after disable and enable (Playwright: `chrome://extensions` toggle, or the
      harness restarting the worker with alarms cleared), the `mira-sync` alarm exists.
- [ ] A content-script `add` or `remove` message gets `forbidden` and the server receives
      no request; the popup's add works.
- [ ] No sync request takes longer than 20 s before it is reported as `server_unreachable`
      with `details.reason: "timeout"`.

## Test plan

- **Unit** (`test/unit/sync-controller.test.mjs`): controller with a fake `fetchWords`
  whose promises the test resolves by hand: follow-up collapse, generation discard,
  abort on credential change, throttle, `force`.
- **Unit**: `validate-words` table (good list, HTML, `{}`, wrong types, oversize, bad
  forms, legacy string forms, v1 Form objects); `normalizeServerUrl` table.
- **Background harness** (`test/bg/background.test.mjs`, slice 02's fake chrome and the
  fixture server's `/mira` API with `__control` delays): the F10, F11, F31, F32 and F39
  repros from research 06 turned into passing tests; sender checks with fake `sender`
  objects for popup, content script and another extension.
- **E2E**: Playwright smoke where the fake server is slowed to 3 s, a word is added in the
  popup, and a fixture page opened right after shows it.

## Rollout and migration

- Ships in the next extension release; no server change needed.
- `syncError` becomes an object; the popup handles both shapes for one release.
- The alarm name changes to `mira-sync` together with slice 04; the old alarm is cleared.
- Changelog: "Sync is more reliable: a word you add shows up on the next page right away,
  fixing the server address or token takes effect immediately, and Mira tells you when an
  address isn't a Mira server."

## Open questions

1. **Default scheme for names without one.** `https://` for anything that isn't local
   or Tailscale-range could surprise someone with a plain-HTTP server on a LAN name.
   Recommendation: keep `https://`; the error for a failed HTTPS connection (slice 25)
   suggests trying `http://`.
2. **20 s sync timeout.** Recommendation: keep; a slow server shows "timeout" and the
   cache keeps pages working.

## Future work

- `ETag`/`If-None-Match` and `?since=`: slice 39.
- Visible-tab-only re-reads with a `wordsVersion` key: slice [15](../15-framework-safe-swapping/SPEC.md) and slice 11's projection.
