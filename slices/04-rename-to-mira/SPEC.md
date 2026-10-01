# 04 · Rename to Mira

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [02-test-harness-and-ci](../02-test-harness-and-ci/SPEC.md) |
| **Unblocks** | [05](../05-brand-identity/SPEC.md) (store artwork names), [28](../28-privacy-and-store-readiness/SPEC.md), [30](../30-release-pipeline/SPEC.md), [40](../40-server-packaging-docker/SPEC.md), [44](../44-docs-site/SPEC.md) |
| **Sources** | [04 summary (naming), section 4 Q2, slice naming-decision](../../docs/research/04-architecture-release.md); [DECISIONS: The name is Mira](../DECISIONS.md) |

## Problem

The maintainer chose the name Mira ([DECISIONS](../DECISIONS.md)): "look!" in Spanish,
Italian and Portuguese, "world" and "peace" in Russian (мир, мира), "wonderful" in Latin.
It replaces "Slovo", which is Russian for "word", ties the tool to one language, and
collides with slovolearn.com, a language-learning app with the same "слово / word"
framing ([04 summary](../../docs/research/04-architecture-release.md)).

The old name is in code, data paths, service names, the extension's identity and the
repository. A careless rename can lose real data: the maintainer's words live in
`~/.local/share/slovo/slovo.db` (with `slovo.db-wal` and `slovo.db-shm` beside it, the
database runs in WAL mode), and the default path is built from the name
(`server/config/runtime.exs:12-16`).

Every occurrence, from `grep -rniI "slovo\|слово"` outside `docs/` and `slices/`
(2026-10-01):

| Where | Lines | What |
|---|---|---|
| `server/mix.exs` | 1, 6, 15 | `Slovo.MixProject`, `app: :slovo`, `Slovo.Application` |
| `server/config/config.exs` | 3 | `config :slovo, ecto_repos: [Slovo.Repo]` |
| `server/config/runtime.exs` | 12, 15-16, 26 | `SLOVO_DATA_DIR`, `~/.local/share/slovo`, `slovo.db`, `config :slovo` |
| `server/lib/slovo/*.ex` | all 10 files | directory name; modules `Slovo.*`; `:slovo` app env reads; `Slovo.TaskSup`, `Slovo.Supervisor` |
| `server/lib/slovo/application.ex` | 27 | log line "Slovo API on ..." |
| `server/lib/slovo/llm.ex` | 121 | `x-title: Slovo` header sent to OpenRouter |
| `server/priv/repo/migrations/20261001000000_create_words.exs` | 1 | `Slovo.Repo.Migrations.CreateWords` |
| `server/.env.example` | 32-33 | `SLOVO_DATA_DIR` and its comment |
| `server/install-service.sh` | 2, 7, 15, 30-31, 35-36 | `slovo.service`, description, `systemctl` and `journalctl` commands |
| `extension/manifest.json` | 3, 20, 22 | `name`, `default_title`, gecko id `slovo@scriptkittyos.com` |
| `extension/popup.html` | 5, 109 | `<title>Slovo</title>`, heading `<h1>Слово</h1>` |
| `extension/content.js` | 6 | class `slovo-w` on swapped spans |
| `extension/content.css` | 1 | `span.slovo-w` |
| `extension/background.js` | 1, 49, 61 | comment; alarm name `slovo-sync` |
| `README.md` | 1, 26, 53, 61, 84, 160, 184, 204, 221-225 | title, copy, commands, paths |
| git remote | | `https://github.com/ScriptKittyOS/slovo.git` |

Bot replies contain no product name today (`server/lib/slovo/bot.ex:15-32`), and no
`storage` key in the extension contains it (keys: `serverUrl`, `token`, `enabled`,
`pausedHosts`, `hiddenLangs`, `words`, `lastSync`, `syncError`; `extension/popup.js:4-13`).

## Goals

- No user-visible "Slovo" or "Слово" anywhere except the changelog and a migration note.
- Existing data moves to the new location automatically, safely, once, with the old file
  left untouched as a backup.
- Existing installs (server service, extension settings) keep working through the update.
- The name has been checked for collisions, the result is recorded, and the public name
  is chosen to stay distinguishable.

## Non-goals

- Logo, wordmark and what the popup heading looks like: slice [05](../05-brand-identity/SPEC.md).
  This slice replaces the text "Слово" with "Mira" and nothing more.
- Store listings: slice [28](../28-privacy-and-store-readiness/SPEC.md) (copy) and slice
  [30](../30-release-pipeline/SPEC.md) (publishing).
- The DOM element name for swapped words (slice 19 replaces the span with a custom
  element); this slice renames the class only.
- Trademark registration.

## User stories

- As the maintainer with a year of words in `slovo.db`, I want to update and find every
  word still there, without copying files by hand.
- As a self-hoster who installed the systemd service, I want the update to leave me with
  one service, not two fighting over the port.
- As an extension user, I want my token, paused sites and hidden languages kept.
- As a newcomer, I want to search the stores for Mira and find this, not something else.

## Specification

### 1. Code

- `server/lib/slovo/` → `server/lib/mira/`; every `Slovo.` module → `Mira.`;
  `app: :mira`; every `Application.get_env(:slovo, ...)` and `config :slovo` → `:mira`;
  `Slovo.TaskSup` → `Mira.TaskSup`. The migration module becomes
  `Mira.Repo.Migrations.CreateWords`. Ecto identifies migrations by version number in
  `schema_migrations`, not by module name, so renaming the module doesn't re-run it.
- `mix.exs`: `Mira.MixProject`; `_build` is rebuilt (`_build/dev/lib/slovo` becomes
  stale; `run.sh` after slice 29 recompiles anyway).
- Log line: "Mira API on http://...". OpenRouter header `X-Title: Mira` (slice 10 adds
  `HTTP-Referer`).
- Extension: `manifest.json` `name: "Mira"`, `default_title: "Mira"`, `short_name: "Mira"`;
  `popup.html` title and heading "Mira"; class `mira-w` in `content.js` and
  `content.css`; alarm `mira-sync`; comments.
- One commit, `refactor!: rename Slovo to Mira`, generated by `git mv` plus a scripted
  replace, reviewed as a diff, then a `grep -rniI "slovo\|слово"` gate in CI (slice 02's
  `spec` job) with an allowlist: `CHANGELOG.md`, `docs/research/`, `slices/`, and the
  migration code in section 2 that must name the old paths.

### 2. Data directory and database migration

New defaults: directory `~/.local/share/mira`, file `mira.db`, environment variable
`MIRA_DATA_DIR`. (Platform-specific defaults for macOS and Windows are slice 40's; they
reuse this module.)

`Mira.DataDir.resolve_and_migrate!/0` runs at the very start of `Mira.Application.start/2`,
before the Repo or any migration starts (slice 29 orders boot so this comes first).

**Resolve the target.**

1. `MIRA_DATA_DIR` if set and non-blank.
2. Else `SLOVO_DATA_DIR` if set and non-blank: use it as the data directory (don't move a
   directory the user chose) and log a deprecation warning: "SLOVO_DATA_DIR is now
   MIRA_DATA_DIR. Rename it in .env; the old name stops working in a future release."
3. Else `~/.local/share/mira`.

**Find a legacy database** (only if `<target>/mira.db` does not exist):
`<target>/slovo.db` (case 2), else `~/.local/share/slovo/slovo.db`.

**Decide.**

| State | Action |
|---|---|
| `mira.db` exists | Use it. If a legacy file also exists and `<legacy dir>/MOVED-TO-MIRA.txt` doesn't, log a warning naming both paths: "Using mira.db; the old slovo.db was not touched." No copy. |
| No `mira.db`, no legacy | Fresh install: create the directory. |
| No `mira.db`, legacy found | Migrate, below. |

**Migrate (copy, never move).**

1. Open the legacy file with `Exqlite.Sqlite3` directly (not the Repo) with
   `busy_timeout = 0`.
2. Probe for another writer: `BEGIN IMMEDIATE`, then `ROLLBACK` at once. If `BEGIN`
   fails with "database is locked", another process (an old Slovo server still running)
   holds it: stop boot with "Your old Slovo server is still running and using <path>.
   Stop it first: systemctl --user stop slovo (or close the terminal running run.sh),
   then start Mira again." The probe is a best-effort check; step 5's counts catch the
   rare writer that starts in between.
3. `PRAGMA integrity_check` must return `ok`, else stop with the result and don't copy.
4. `VACUUM INTO '<target>/mira.db.partial'`. This writes a consistent, compacted copy.
   It reads through the WAL like any SQLite reader, so writes that exist only in
   `slovo.db-wal` are included; no manual checkpoint is needed. (SQLite may fold the WAL
   into `slovo.db` when this connection closes; that changes the file's bytes, never its
   content.)
5. Open the copy; `PRAGMA integrity_check` = `ok`; `SELECT count(*) FROM words` and
   `SELECT count(*) FROM schema_migrations` equal the source's. On any mismatch, delete
   the partial file and stop with both counts.
6. `fsync` the partial file, then `File.rename/2` it to `mira.db` (atomic on one
   filesystem; the partial file is in the target directory for that reason). Set mode
   0600 on the file and 0700 on the directory.
7. Write `<legacy dir>/MOVED-TO-MIRA.txt`: "Mira copied this database to <target>/mira.db
   on <UTC time>. This copy is no longer used. You can delete this folder once you've
   checked your words in Mira." The legacy database is never deleted and its content is
   never changed.
8. Log at info: "Moved your words from <legacy> to <target>/mira.db (412 words). The old
   file is kept as a backup."

**Properties.** Idempotent: a second boot finds `mira.db` and does nothing. Crash-safe:
an interrupted run leaves at most a `.partial` file, which the next run deletes and
redoes. Never writes data to the source. Slice 07's pre-migration backup then runs on
`mira.db` as usual.

Other files in the data directory: the API token file and caches are created fresh
(slices 01 and 10) and not copied; `.env` lives in the server folder, not the data
directory, and is unaffected.

### 3. Environment and `.env`

- `.env.example`: `MIRA_DATA_DIR=` with the comment "(default ~/.local/share/mira)".
- No other variable contains the name. `SLOVO_DATA_DIR` keeps working for two minor
  versions with the warning above, then is removed with a changelog note.

### 4. systemd service

`install-service.sh` installs `mira.service` (description "Mira vocabulary server and
Telegram bot") with slice 29's quoting rules, and before enabling it:

1. If `~/.config/systemd/user/slovo.service` exists: `systemctl --user disable --now slovo`
   (stops it, which releases the database and the port), then move the unit file to
   `~/.config/systemd/user/slovo.service.bak` (not deleted, so nothing is lost if the user
   customised it), and `systemctl --user daemon-reload`. Print what was done.
2. Install, enable and start `mira.service`; the first start performs section 2's migration.
3. Print `journalctl --user -u mira -f` and `systemctl --user restart mira`.

Running the script twice is safe: step 1 is skipped when no old unit exists. People who run
`./run.sh` by hand stop the old process themselves; section 2's lock check catches the
case where they forget.

### 5. Extension identity and storage continuity

- **Chrome.** The extension isn't in the Chrome Web Store yet; its id comes from the
  folder path when loaded unpacked, not from the name. Changing `name` keeps the id, so
  `storage.local` (token, server URL, settings, cached words) carries over. **Moving or
  renaming the folder** changes the id and starts with empty storage: the README's update
  instructions say to keep the folder where it is, or to re-enter the server address and
  token afterwards (words come back on the next sync; hidden languages and paused sites
  would need setting again). The store id assigned at first publication (slice 30) is
  permanent.
- **Firefox.** The gecko id becomes `mira@scriptkittyos.com`. It must be final before the
  first AMO submission, because AMO ties an add-on's identity and updates to the id
  forever. The add-on has only been loaded as a temporary add-on (`README.md:181-185`),
  which Firefox removes on restart, so no persistent user data depends on the old id.
- **Leftover DOM.** After an update, Chrome tabs may still contain spans from the old
  content script with class `slovo-w` (`content.js:91-97`). When the new content script
  starts (slice 15 re-injects into open tabs), it first replaces every `span.slovo-w`
  with a text node holding its `data-en` value, once. This code is removed one release later.
- **Alarm.** On `runtime.onInstalled` with reason `update`, `alarms.clear("slovo-sync")`;
  slice 26 creates `mira-sync`.
- **Storage keys** need no migration (none contain the name). Slice 11's IndexedDB
  database is named `mira` from the start.

### 6. Repository

- Rename `ScriptKittyOS/slovo` to **`ScriptKittyOS/mira`** in the repository settings.
  GitHub redirects web URLs, `git clone`, `git fetch` and `git push` from the old name
  for as long as no new repository takes the old name; don't create one. GitHub Pages
  and package URLs are not redirected, so do this before slice 44's docs site and slice
  40's GHCR image exist.
- Local clones: `git remote set-url origin https://github.com/ScriptKittyOS/mira.git`
  (works without this thanks to the redirect, but avoids surprises).
- The local working folder (today `language-reducer-ext`) can stay as is; see section 5
  before renaming it.
- Image name `ghcr.io/scriptkittyos/mira`, docs at `scriptkittyos.github.io/mira`,
  OpenRouter referer `https://github.com/ScriptKittyOS/mira`.

### 7. Copy

- README title "Mira", tagline from slice 05, all commands and paths updated, a short
  "Formerly Slovo" note under the title for one release, then in the changelog only.
- Telegram bot `/help` gains one first line: "Mira: send me a word and it starts
  replacing its English on your web pages." (Telegram's bot name and username are set in
  @BotFather by each self-hoster; the README suggests "Mira" and a username like
  `yourname_mira_bot`.)
- User-agent for outgoing HTTP from the server: `Mira/<version> (+https://github.com/ScriptKittyOS/mira)`.

### 8. Name-collision check

**How to check** (repeat right before the first store submission and record the date):

1. Chrome Web Store and Firefox Add-ons: search "Mira" and "Mira language", note every
   listing in education, translation or language learning.
2. Apple App Store and Google Play: "Mira" plus "language", "vocabulary", "English".
3. GitHub, npm and Hex: repositories and packages named `mira` in this space.
4. Trademark databases: USPTO (TESS successor search) and EUIPO eSearch for "MIRA" in
   Nice classes 9 (software) and 41 (education), status live.
5. A general web search for "Mira" + "language learning".

**What's acceptable.** The word "Mira" is common (a star, a name, many products), and a
common word can't be owned in general. Coexistence is acceptable when the other product
is in a different field, or in the same field but not using "Mira" alone as its name.
Not acceptable: a live trademark registration for "MIRA" covering language-learning
software in a market we publish to, or a browser extension in the same stores whose name
is "Mira" alone and does the same job.

**Findings on 2026-10-01** (web search; store searches by hand still to do):

- **Mira Translator** ("Mira Translator - Web Translation"): an open-source extension on
  both Chrome Web Store and AMO (about 79 users on AMO, "All Rights Reserved" there,
  source at github.com/os9sur/MiraTranslator). It does immersive page translation and
  YouTube dual subtitles, and also saves vocabulary and highlights saved words on pages.
  **Closest overlap**: same stores, same audience, the name starts with "Mira".
- **Mira - English On The Go**: an iOS app for learning English.
- **Miraa**: an Android app for transcription and language study.
- Several unrelated Chrome extensions named Mira (browser agents, job-application
  autofill, legal timekeeping, virtual try-on).
- Hex has no `mira` package; npm has an old, unrelated `mira` package. Mira doesn't
  publish to either, so neither matters.

**Recommendation.** The decision stands; make the public name distinguishable:

- Store listing name: **"Mira: learn words as you browse"** (the descriptor is part of
  the store name; under the stores' length limits). Never "Mira Translator" or anything
  with "translate" in the name, which is what the closest neighbour uses.
- Extension `name` stays "Mira" (it shows in the toolbar), with the descriptor in
  `description` and the listing.
- Keep "ScriptKittyOS" as the listed publisher (decided), which also helps users tell
  the two apart.
- Run step 4 (trademarks) before the first store submission; if a live "MIRA" mark in
  class 9 or 41 for language learning turns up, escalate to the maintainers before
  publishing.

## Acceptance criteria

- [ ] `grep -rniI "slovo\|слово"` outside the allowlist returns nothing (CI gate).
- [ ] All slice 02 test suites pass after the rename.
- [ ] With a copy of a real 0.2 data directory (including an uncheckpointed WAL holding
      recent writes), first boot creates `~/.local/share/mira/mira.db` with every word,
      including the ones only in the WAL; `sqlite3 slovo.db .dump` is identical before and
      after; `MOVED-TO-MIRA.txt` exists.
- [ ] A second boot does no copy and logs nothing about migration.
- [ ] With the legacy database locked by another process, boot stops with the "still
      running" message and `mira.db` does not exist.
- [ ] Killing the process during the copy, then booting again, ends with a complete
      `mira.db` and no `.partial` file.
- [ ] `SLOVO_DATA_DIR=/srv/words` uses `/srv/words`, migrates `slovo.db` to `mira.db`
      there, and warns about the variable name.
- [ ] `install-service.sh` on a machine with `slovo.service` running leaves exactly one
      running unit, `mira.service`, and `slovo.service.bak` on disk.
- [ ] Updating the unpacked extension in place keeps token, server URL, hidden languages
      and paused sites; old `slovo-w` spans in open tabs are restored to English.
- [ ] The manifest's gecko id is `mira@scriptkittyos.com` and `web-ext lint` passes.
- [ ] The collision check is recorded with its date in this slice before store submission.

## Test plan

- ExUnit `Mira.DataDirTest` with temp directories and `HOME` overridden: fresh install,
  legacy migration, WAL-only rows (a writer with `wal_autocheckpoint=0` inserts rows,
  and the `.db`, `-wal` and `-shm` files are copied while it is still open, which is the
  state a crashed or killed server leaves behind),
  both files present, locked source, interrupted copy (`.partial` left behind),
  `SLOVO_DATA_DIR`, integrity failure (a deliberately corrupted fixture).
- Shell test for `install-service.sh` in a container with a systemd user session (or with
  `systemctl` stubbed on `PATH` and asserting the calls), plus `shellcheck`.
- jsdom test: a page with `span.slovo-w` elements is restored to the original text.
- Manual, on the maintainer's machine, before merging: back up `~/.local/share/slovo`
  by hand, stop the server, update, start, compare `/list` and the extension's word count.

## Rollout and migration

- One release containing the rename and the migration; no flag.
- Order for the maintainer: stop the server (or let `install-service.sh` do it), pull,
  run `./run.sh` or `install-service.sh`, check the log line with the word count.
- Release notes, top of the list: "Slovo is now Mira. Your words move automatically from
  ~/.local/share/slovo to ~/.local/share/mira on first start; the old file is kept as a
  backup. The service is now called mira (install-service.sh replaces the old one).
  Rename SLOVO_DATA_DIR to MIRA_DATA_DIR in .env if you set it."
- The repository rename (section 6) happens the same day as the merge.

## Open questions

1. **Repository name.** Recommendation: `ScriptKittyOS/mira`. Alternative if the org
   prefers descriptive names: `mira-words`.
2. **Store name descriptor.** Recommendation: "Mira: learn words as you browse".
   Alternatives: "Mira: words you're learning, on every page", "Mira vocabulary".
3. **Mira Translator overlap.** It is small (about 79 users on AMO) but in the same niche
   and stores. Recommendation: proceed with the descriptor and publisher name; reconsider
   only if the trademark search finds a live mark.
4. **When to delete the legacy folder.** Recommendation: never automatically; the note
   file tells the user it's safe.

## Future work

- `mix mira.doctor` that reports data paths, legacy leftovers and service status.
- A one-time popup notice in the extension: "Slovo is now Mira."
