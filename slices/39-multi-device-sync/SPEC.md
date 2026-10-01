# 39 · Multi-device sync

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | M (about a week) |
| **Depends on** | [11-local-first-mode](../11-local-first-mode/SPEC.md); uses [07-word-model-v2](../07-word-model-v2/SPEC.md) (ids, timestamps, tombstones, merge), [12-export-import-and-delete](../12-export-import-and-delete/SPEC.md) (`reset_epoch`), [26-background-sync-correctness](../26-background-sync-correctness/SPEC.md) (generations, abort) |
| **Unblocks** | Settings sync for [38](../38-per-site-rules/SPEC.md); a sync base for [48-multi-user-and-classroom](../48-multi-user-and-classroom/SPEC.md) |
| **Sources** | [04 S3, S4, S8, section 3, P1 list](../../docs/research/04-architecture-release.md); [03 C2, C3, C7](../../docs/research/03-browser-extension.md); [01 open question 4](../../docs/research/01-language-mixing.md); [06 F10, F11](../../docs/research/06-adversarial-qa.md) |

## Problem

A learner with two laptops gets two different Mira setups.

- Settings live per device: `enabled`, `pausedHosts` and `hiddenLangs` are in
  `storage.local` (`extension/popup.js:4-13`, `popup.js:49-51`, `popup.js:208-213`)
  ([04 S3](../../docs/research/04-architecture-release.md)).
- Words sync only through a server, and only one way: the extension downloads the whole
  active list every minute (`extension/background.js:28-38`, `background.js:48-59`) from
  `GET /api/words`, which has no cursor, ETag or tombstones (`server/lib/slovo/router.ex:17-28`).
  At 3,000 words that is about 1 MB per poll per device ([04 S4](../../docs/research/04-architecture-release.md)).
- After slice 11, words live in the extension. Without this slice, two browsers on one
  server can't both edit words offline, and a local-mode user has no way to share words
  between devices except export and import.

## Goals

- Non-secret settings follow the learner between signed-in browsers through `storage.sync`,
  within its limits.
- Words sync both ways between any number of browsers and a Mira server, with deltas,
  tombstones and conditional requests, and converge to the same list.
- Each conflict case has one written rule, and none loses a word silently.
- An unchanged poll costs one small `304` response.
- Telegram adds still reach the browser within about a minute.

## Non-goals

- Words in `storage.sync`. At about 100 KB total, 8 KB per item and 512 items (Chrome
  docs, checked 2026-10-01), it holds roughly 400-600 compact words without notes, it
  doesn't sync at all on Safari or Firefox for Android (MDN browser-compat-data), and
  write limits (120 a minute, 1,800 an hour) make bulk adds fail. Settings only.
- Cloud-drive sync without a server (WebDAV, Gist, Drive): future work.
- Syncing learning signals and stats (slices 35 and 46): future work, local only for now.
- Several users on one server: slice [48](../48-multi-user-and-classroom/SPEC.md).
- Secrets: API keys and server tokens never sync (slice 11).

## User stories

- As a learner with a work and a home laptop, I want my languages, Focus and site rules
  to match on both without setting them twice.
- As a learner with a server, I want to edit a word on the train offline and have both
  laptops agree once I'm back online.
- As the maintainer, I want a word added by Telegram on my phone to swap on my laptop on
  the next page.
- As a learner who deleted a word on one laptop, I want it to stay deleted on the other.

## Specification

### 1. Settings in `storage.sync`

**What syncs** (grouped so a change rewrites one small item):

| Key | Contents | Owner slice |
|---|---|---|
| `s:display` | `enabled`, celebrations, reveal mode and its settings, well-known underline, colors, reading aids, swap controls, sensitive-sites default, copy as English, print in English, speech (voice per language, online voices) | 16, 32, 34, 35, 37, 43 |
| `s:langs` | hidden languages, Focus, weights, mix within page, `seedSalt` (so a page looks the same on every device) | 18 |
| `s:matching` | `neverSwap` forms, `formSense` choices, `variants` (pt-BR, sr-Latn, yue) | 14, 16, 36 |
| `s:amount` | Amount, captions amount | 31, 52 |
| `s:lookup` | provider id, base URL, model (never the key) | 11 |
| `s:server` | server URL (never the token) | 11 |
| `s:ui` | interface language, base languages | 50 |
| `s:sites:0` … `s:sites:N` | site rules, chunked | 38 |

**Never synced**: secrets, words, jobs, stats, the "show originals" tab state, last-backup
date, `wordsHome`, and anything describing this device.

**Item format**: `{v: 1, updatedAt, deviceId, data}`. `deviceId` is a random UUID made on
first run and kept in `storage.local`.

**Chunking**: an item may not exceed 8,192 bytes, counted as the key plus the
JSON-encoded value in UTF-8 (Chrome's rule). Site rules are serialised compactly
(`[host, swap, langs, amount, exact, updatedAt]` arrays) and split into chunks under
7,500 bytes. 500 site rules need about four chunks.

**Writes**: debounced 2 s and coalesced, then written through a token bucket that allows
at most one write every 2 seconds on average with bursts of 10, which stays under 120 a
minute and 1,800 an hour. A `QUOTA_BYTES` or rate error keeps the change in
`storage.local` and retries in 1 minute; the settings page shows "Settings sync is full"
with the usage from `getBytesInUse`.

**Reads and merge**: `storage.local` holds the working copy, so the extension works the
same with sync off. On `storage.onChanged` for area `sync`, each group is applied if its
`updatedAt` is newer than the local copy's. Site rules merge per rule by each rule's own
`updatedAt` across all chunks, so two devices editing different sites both keep their
changes.

**Availability**: Chrome syncs only when the user is signed in with extension sync on;
Firefox desktop syncs with a Mozilla account when add-on data sync is on (medium
confidence on the exact setting name); Safari and Firefox for Android store sync items
locally only. Brave's handling is unverified. In every case the code path is the same and
nothing errors. A second device whose welcome page (slice 22) finds synced settings says
"Found your Mira settings from another browser" and asks only for what's missing, usually
the key.

### 2. Words: two-way sync with a server

With this slice, slice 11's `wordsHome` gains a third value, `"synced"`: words live in
the extension and in the server, and either side can change them. It replaces
"server owns, extension mirrors" whenever the server supports the API below.

**Server API** (under `/api/v1`, bearer auth). Slice 07 already provides `seq` (a
per-database counter that never decreases, set on every insert, update, tombstone and
restore), tombstones, and `GET /api/v1/words` returning a `cursor`; it leaves `since` and
ETags on that route to this slice.

**Pull**: `GET /api/v1/words?since=<cursor>&limit=500`

```json
{ "words": [ { "...": "slice 07 word; with since, tombstones are included (deleted_at set)" } ],
  "cursor": "opaque", "more": false, "reset_epoch": 3 }
```

- Without `since`, the route behaves exactly as slice 07 defines (live words only).
- `ETag` is the cursor. With `If-None-Match` equal to the current cursor the server
  answers `304` with no body.
- `since=0` returns everything, including tombstones still kept.
- A cursor at or below slice 07's `purged_through_seq` (tombstones are removed after 180
  days), or from another `reset_epoch`, returns `410 Gone` with code `resync_required`.
- `pending` words (unsaved Telegram lookups) are never returned (slice 07).

**Push**: `POST /api/v1/words/sync`, at most 500 words per request:

```json
{ "device_id": "…", "reset_epoch": 3, "changes": [ { "...": "slice 07 word, possibly a tombstone" } ] }
```

Response: `{"results": [{"id", "status", "word", "into", "reason"}], "cursor"}`, where
`status` is `applied`, `stale` (the server has a newer version, returned in `word`),
`merged` (merged into another id, given in `into`) or `rejected` (failed slice 09
validation, with `reason`). Unlike slice 07's `batch` route, which merges adds, this route
applies whole records under the rules in section 3. A wrong `reset_epoch` returns `409`
with code `server_reset`.

**Cursor**: encodes slice 07's `seq` and the `reset_epoch` (slice 12). Telegram writes go
through slice 07's upsert, so they get a `seq` and appear in the next pull.

### 3. Conflict rules

Ordering uses slice 07's `updated_at`. The server clamps any incoming `updated_at` to at
most its own time plus 2 minutes, so a device with a fast clock can't win forever.

1. **Same id changed on two sides**: the newer `updated_at` wins the whole record; ties go
   to the lexicographically larger `device_id`. The loser receives `stale` with the
   winner and applies it.
2. **Delete against edit**: a tombstone is a change like any other (`updated_at =
   deleted_at`), so the later action wins. An edit made after a delete resurrects the
   word; a delete made after an edit removes it.
3. **Same word added independently** (two devices add "perro" offline, two ids, one
   natural key): the server keeps the word with the earliest `created_at`, merges the
   other into it with slice 07's merge rules (forms unioned, non-empty fields kept), and
   tombstones the other with `merged_into`. Clients that receive such a tombstone move
   any local references (learning signals) to the winner.
4. **Server reset** (slice 12's delete-all increments `reset_epoch`): clients never push
   into a new epoch automatically. The popup asks: "The words on your server were deleted.
   Delete them here too, or upload this browser's 312 words to the server?" Both buttons
   say exactly what happens.
5. **Invalid word from another device** (an older client, or a bad import): rejected by
   the server with a reason; the client keeps it locally, marks it, and the dashboard lists
   it under "Couldn't sync".

### 4. Client algorithm

Each word in the local store carries `syncState: "clean" | "dirty"`. Every local write
sets `dirty`.

```
sync():                           single-flight with generations (slice 26)
  push: while dirty words exist
          send up to 500 (oldest updated_at first)
          for each result:
            applied -> clean, unless the word changed again meanwhile
            stale   -> apply server word, clean
            merged  -> apply tombstone + move references
            rejected-> keep dirty, mark rejected
  pull: GET /api/v1/words?since=cursor (If-None-Match)
          304 -> done
          for each change: if local is dirty and newer, keep local (it pushes next round)
                           else write it
          repeat while more
          save cursor
  410 -> full resync: pull from 0, then push every local word the server lacks
  write projection once (slice 11)
```

**Triggers**: 3 s after a local write; the existing one-minute alarm; startup; a page
load at most every 5 s (today's rule, `background.js:67-73`); and opening the popup or
dashboard. A credential or URL change aborts the in-flight sync and starts a new
generation ([06 F11](../../docs/research/06-adversarial-qa.md)).

**Cost**: an unchanged poll is one `304` of a few hundred bytes instead of the whole list.
A change of one word is one word each way.

### 5. Turning it on

- **Server-mode users** (slice 11's mirror): when `/health` reports an API version with
  the sync route, the extension switches `wordsHome` from `"server"` to `"synced"` by itself,
  runs a full pull, and marks everything clean. Nothing visible changes except that edits
  now work offline.
- **Local users connecting a server**: slice 11's "Use my Mira server" becomes "Sync my
  words with my Mira server": every local word is pushed as a change, then a full pull.
  Natural-key duplicates merge by rule 3. The dialog shows counts first.
- **Turning sync off**: words stay in the browser (`wordsHome = "local"`); the server
  keeps its copy.

## Acceptance criteria

- [ ] Changing Focus on device A appears on device B (both Chrome profiles signed in to
      the same account) without a reload, within the browser's sync delay.
- [ ] 500 site rules sync without a quota error; the 8 KB item limit is never exceeded
      (unit-tested on worst-case hostnames).
- [ ] No synced item ever contains a key or token (test over every item after setup).
- [ ] Two clients and a server, given any interleaving of add, edit, delete and sync in a
      randomised test of 1,000 runs, end with identical word sets and no duplicates by
      natural key.
- [ ] An unchanged poll returns `304`.
- [ ] Offline edits on two devices to different words both survive; to the same word, the
      later edit wins on both devices.
- [ ] A word added by Telegram appears in a synced browser within 70 s with no user action.
- [ ] After a server delete-all, no client pushes words back without the user choosing to.
- [ ] A client whose cursor is 200 days old resyncs fully and loses no local-only words.

## Test plan

- **ExUnit** (slice 02): `since` paging, `304`, `410`, `409 server_reset`, clamping,
  rules 1-3 on the server, ordering under concurrent writes, Telegram writes appearing in
  the next pull.
- **Node**: the client algorithm against an in-memory fake of the server API, plus the
  randomised convergence test (seeded, so failures reproduce) with 2-3 clients and random
  network drops.
- **Settings**: chunking and merge with a fake `storage.sync` that enforces Chrome's
  quotas and write limits.
- **End-to-end** (Playwright): two persistent browser contexts and the real server;
  offline edit through `context.setOffline`; Telegram-style insert through the API.
- **Manual**: two real Chrome profiles signed in to one account; two Firefox profiles with
  one Mozilla account.

## Rollout and migration

- Server first: `since`, ETags and the sync route ship in a server release after slice
  07 (which already added `seq`); no migration is needed beyond a `reset_epoch` value in
  slice 07's `sync_state` row. Old extensions keep using `/api/words`.
- Extension: settings move from `storage.local` to the sync scheme on update (local copy
  kept). Word sync switches on automatically per section 5.
- Changelog: "Your settings now follow you between browsers. With a Mira server, words
  sync both ways and work offline on every device."

## Open questions

1. **Small word lists in `storage.sync` for people without a server?** Research 04 S3
   suggested it. Recommendation: no, for the limits listed in Non-goals; point those users
   to export and import now and to cloud-drive sync later.
2. **Sync the provider key through browser sync?** It would save one paste per device,
   but puts the key in Google's or Mozilla's sync store. Recommendation: no; ask once per
   device, and make that the only question the welcome page asks.
3. **Tombstone retention.** Slice 07 sets 180 days (content scrubbed after 30). Recommendation:
   keep it; a laptop unused for longer does a full resync, which is safe.

## Future work

- Cloud-drive sync (WebDAV, GitHub Gist) reusing the same change format ([04 section 3](../../docs/research/04-architecture-release.md)).
- Syncing learning signals and stats as counters that merge by addition.
- Server-sent events or long polling so Telegram adds arrive in seconds.
