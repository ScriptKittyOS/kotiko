# 29 · Server ops hardening

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | S (a day or two) |
| **Depends on** | None (tests use slice [02](../02-test-harness-and-ci/SPEC.md)) |
| **Unblocks** | [40-server-packaging-docker](../40-server-packaging-docker/SPEC.md); boot ordering used by [01](../01-api-auth-hardening/SPEC.md), [04](../04-rename-to-kotiko/SPEC.md), [07](../07-word-model-v2/SPEC.md) |
| **Sources** | [06 F19, F20, F34, F35, F40](../../docs/research/06-adversarial-qa.md); [04 S15, S28](../../docs/research/04-architecture-release.md) |

## Problem

The server is small, but the way it starts, stops and logs makes it fragile for anyone
who isn't watching journald. All read from the code; F40 was reproduced.

- **Zombie process (F19).** `start_permanent: Mix.env() == :prod` (`server/mix.exs:9`)
  is false under `run.sh`, which runs `mix run --no-halt` in dev (`server/run.sh:16`). If
  the supervisor exceeds its restart intensity (3 restarts in 5 s), the application stops
  but the VM keeps running. systemd sees a live process and never restarts it; the API
  stays dead. A Telegram response of an unexpected shape crashing `Slovo.Bot` repeatedly
  is a realistic trigger.
- **Stale dependencies (F20).** `[ -d deps ] || mix deps.get` (`run.sh:15`) fetches only
  when `deps/` is missing. After a `git pull` that changes `mix.lock`, `mix run` exits
  with "dependencies are out of date", and under `Restart=on-failure` with `RestartSec=5`
  (`server/install-service.sh:22-23`) that is an endless restart loop visible only in journald.
- **Raw crashes on config typos (F34).** `BIND=localhost` or a MagicDNS name crashes on
  `{:ok, ip} = :inet.parse_address(...)` (`server/lib/slovo/application.ex:17`).
  `ALLOWED_TELEGRAM_IDS=123,abc` crashes inside `String.to_integer` in
  `server/config/runtime.exs:24`, and `PORT=abc` at `runtime.exs:27`, before the app
  starts, with an Elixir stack trace. `API_TOKEN="   "` is treated as set (slice 01).
- **Unit file quoting and secrets on disk (F35).** `ExecStart=$dir/run.sh` and
  `Environment=PATH=$PATH` are written unquoted (`install-service.sh:19-21`). systemd
  splits on spaces and treats `%` as a specifier, so a folder like `~/My Projects`
  breaks. `cp .env.example .env` (README step 2) creates a 0644 file holding the API keys.
- **Alarming first boot and chatty logs (F40).** A fresh data directory logs
  `Exqlite.Connection ... failed to connect: database is locked` from pool connections
  racing on WAL setup while `Ecto.Migrator` runs as a child next to them
  (`application.ex:21-22`). Ecto query logs are on by default. User text is logged
  (slice 10 fixes the LLM lines; this slice adds a safety net for secrets).
- **`/health` says only `ok`** (`server/lib/slovo/router.ex:12-14`), so neither the
  extension nor Docker can tell which version is running or whether the database works
  ([04 S15](../../docs/research/04-architecture-release.md)).

## Goals

- The server process exits whenever the application stops, so the supervisor (systemd,
  Docker, launchd) restarts it.
- Updating with `git pull` and restarting always works.
- Every configuration mistake produces one readable message naming the variable, the bad
  value and the fix, and a clean exit.
- Generated unit files work in any folder; secrets files are private.
- First boot is quiet; normal logs contain no secrets and no SQL.
- `/health` reports version, API versions and database status.
- A single, documented boot order that slices 01, 04 and 07 plug into.

## Non-goals

- Releases, Docker and non-Linux service files: slice [40](../40-server-packaging-docker/SPEC.md).
- Token generation and exposure warnings: slice [01](../01-api-auth-hardening/SPEC.md)
  (this slice reports its errors).
- LLM log content: slice [10](../10-llm-client-resilience/SPEC.md).
- Telegram error handling: slice [41](../41-telegram-improvements/SPEC.md).

## User stories

- As a self-hoster, I want a typo in `.env` to tell me exactly which line is wrong.
- As a self-hoster who runs `git pull` to update, I want the service to come back by itself.
- As someone whose project folder has a space in its name, I want the installer to work.
- As anyone sharing logs in an issue, I want them free of my keys.

## Specification

### 1. Boot order (`Kotiko.Application.start/2`)

```
1. Kotiko.Config.load!()            parse and validate env (section 3); exit 78 on error
2. Kotiko.DataDir.resolve_and_migrate!()   slice 04
3. Kotiko.Token.ensure!()           slice 01
4. Kotiko.Migrations.run!()         backup if pending (slice 07), then migrate, pool_size 1
5. log startup summary            version, data dir, bind exposure (slice 01), bot on/off
6. Supervisor.start_link(children)  Repo, TaskSup, LLM processes, Janitor, Bandit, Bot
```

Step 4 uses `Ecto.Migrator.with_repo(Kotiko.Repo, fn repo -> ... end, pool_size: 1)`, so
migrations finish on one connection before the real pool opens. This removes the
`database is locked` noise (F40) and lets slice 07's backup run before anything else
touches the file. `Ecto.Migrator` is removed from the children list.

The Repo is configured with `journal_mode: :wal`, `busy_timeout: 5_000`,
`default_transaction_mode: :immediate` (slice 07) and `log: false`.

### 2. Start permanent and process exit (F19)

- `mix.exs`: `start_permanent: true` unconditionally. With `mix run --no-halt`, a
  permanent application that stops brings the VM down with a non-zero status.
- `run.sh` runs with `MIX_ENV=${MIX_ENV:-prod}`. Prod compiles to `_build/prod`, skips
  dev-only dependencies, and matches what releases (slice 40) do. `config/prod.exs` isn't
  needed; runtime configuration stays in `runtime.exs`.
- The bot's poll loop must not be the thing that takes the app down on a bad Telegram
  response: slice 41 makes it tolerate unexpected shapes. With permanence, a genuine
  crash loop now restarts the whole process (systemd) instead of leaving a zombie.

### 3. Configuration validation (F34)

`config/runtime.exs` stops parsing: it only copies raw strings into the app env (trimmed,
blank as nil), so it can never crash. `Kotiko.Config.load!/0` parses and validates
everything, collects **all** problems, and if there are any prints one block to stderr
and exits with status 78 (`EX_CONFIG`; systemd unit sets `RestartPreventExitStatus=78`
so it doesn't loop on a config error):

```
Kotiko can't start: 2 problems in your settings (server/.env)

  BIND=kotiko.local
    Couldn't find an address for "kotiko.local". Use an IP address such as 127.0.0.1,
    100.101.102.103 (Tailscale) or 0.0.0.0.

  ALLOWED_TELEGRAM_IDS=123,abc
    "abc" isn't a Telegram ID. IDs are numbers; the bot tells you yours.

Fix these and start Kotiko again.
```

Rules:

| Variable | Rule |
|---|---|
| `PORT` | Integer 1-65535. Default 4747. |
| `BIND` | IP literal, or a name resolved with `:inet.getaddr/2` (IPv4, then IPv6). `localhost` works. Default 127.0.0.1. |
| `API_TOKEN` | Slice 01's rules (blank means generate; at least 24 characters). |
| `ALLOWED_HOSTS` | Comma list of host names or `*` (slice 01). |
| `PUBLIC_URL` | Optional `http(s)` URL (slice 01's pairing string). |
| `ALLOWED_TELEGRAM_IDS` | Comma list; each entry trimmed; each an integer. Entries that aren't are errors, listed individually. Slice 41 adds pairing so this becomes optional. |
| `TELEGRAM_BOT_TOKEN` | If set, matches `^\d+:[A-Za-z0-9_-]{30,}$`. |
| `LLM_URL` | `http(s)` URL. Default OpenRouter. |
| `LLM_MODEL` | Required when `LLM_URL` isn't OpenRouter (slice 10). |
| `LLM_API_KEY` | Warning (not error) when missing and `LLM_URL` is OpenRouter: "adding words won't work until you set LLM_API_KEY". |
| `TRANSCRIBE_URL` | If set, `http(s)` URL. |
| `KOTIKO_DATA_DIR` | Writable directory (created if missing; error if it can't be). |
| `LOG_LEVEL` | `debug`, `info`, `warning`, `error`. Default `info`. |
| `LOG_LOOKUPS` | `true`/`false` (slice 10). |
| Unknown `KOTIKO_*` variables | Warning with the closest known name ("KOTIKO_DATADIR: did you mean KOTIKO_DATA_DIR?"). |

`Kotiko.Config.load!/0` is a pure function of a map of variables plus the resolver, so it
is table-tested without touching the environment.

### 4. `run.sh` (F20)

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 077   # what the server writes is private (SCR-450)
cd "$(dirname "$0")"
[ -f .env ] || { echo "No .env yet. Run: cp .env.example .env && chmod 600 .env, then fill it in." >&2; exit 78; }
if [ -n "$(find .env -perm /077)" ]; then
  echo "Making .env private (it holds your keys): chmod 600 .env" >&2
  chmod 600 .env || true
fi
set -a; . ./.env; set +a
export MIX_ENV="${MIX_ENV:-prod}"
if ! mix deps.get --only "$MIX_ENV"; then
  echo "Couldn't fetch dependencies (offline?). Trying with what's installed." >&2
fi
mix compile
exec mix run --no-halt
```

`mix deps.get` is a no-op when everything matches `mix.lock` and costs about a second.
If it fails offline but the installed deps match, `mix compile` succeeds; if they don't
match, the error is Mix's own clear message. `.env` sourcing keeps today's behaviour;
CONTRIBUTING and `.env.example` say to single-quote values containing `$`, spaces or `#`.

### 5. `install-service.sh` (F35)

- `umask 077` at the top; `chmod 600 .env` with a message if it was readable by others.
- Values in the unit are escaped for systemd: `%` → `%%`, `\` → `\\`, `"` → `\"`, and
  written double-quoted where systemd accepts quotes:

  ```
  [Unit]
  Description=Kotiko vocabulary server and Telegram bot
  After=network-online.target
  Wants=network-online.target
  StartLimitIntervalSec=300
  StartLimitBurst=5

  [Service]
  WorkingDirectory=<escaped dir>
  ExecStart="<escaped dir>/run.sh"
  Environment="PATH=<escaped PATH>"
  UMask=0077
  Restart=on-failure
  RestartSec=5
  RestartPreventExitStatus=78
  ```

  (`WorkingDirectory=` takes the rest of the line as one path, so spaces need no quotes
  there, only `%` escaping. `UMask=0077`, like `umask 077` in `run.sh`, keeps every file
  the server makes private from the moment it exists; the server also makes its own files
  0600 itself, see `Kotiko.DataDir.make_private/1` and the
  [configuration reference](../../docs/reference/configuration.md#files-in-the-data-folder).
  Added for Linear SCR-450.)
- After installing, wait up to 20 s for `GET /health` to return 200 and print the result;
  on failure print the last 20 journal lines and the exit status.
- Slice 04 adds the old-unit cleanup; slice 40 adds release support.

### 6. Logging (F40, [04 S28](../../docs/research/04-architecture-release.md))

- Level from `LOG_LEVEL` (default info). `config :logger` sets
  `level: :info` today (`server/config/config.exs:5-6`); that moves to runtime.
- Repo `log: false` (no SQL at any level; a `KOTIKO_LOG_SQL=true` escape hatch for debugging).
- A primary `:logger` filter, `Kotiko.Log.Redact`, rewrites every message and report before
  any handler sees it:
  - `Bearer <anything>` → `Bearer [redacted]`
  - `sk-or-v1-[A-Za-z0-9]+`, `sk-[A-Za-z0-9_-]{20,}` → `[redacted-key]`
  - `bot\d+:[A-Za-z0-9_-]+` → `bot[redacted]` (the Telegram token sits in request URLs,
    `server/lib/slovo/telegram.ex:9`, `telegram.ex:38`)
  - the literal values of `API_TOKEN`, `LLM_API_KEY`, `TELEGRAM_BOT_TOKEN`,
    `TRANSCRIBE_API_KEY` if present.
- Startup summary at info, one block: version, data directory, database file and word
  count, bind and exposure line (slice 01), LLM provider and model source (catalog,
  cache, fallback, or `LLM_MODEL`), Telegram on/off, voice notes on/off.

### 7. `/health`

`GET /health` (open, slice 01) returns JSON:

```json
{"ok": true, "name": "kotiko", "version": "0.3.0", "api": [1], "db": "ok"}
```

- `version` from `Application.spec(:kotiko, :vsn)` (slice 03's single version).
- `api` lists supported API versions; legacy routes are implied while they exist.
- `db` runs `SELECT 1` with a 1 s timeout; on failure `"db": "error"`, `ok: false`,
  HTTP 503.
- `HEAD /health` returns the status only.
- Nothing else (no word counts, no config): the route is unauthenticated.

The extension (slice 11's "Test connection") uses it to check that an address is a Kotiko
server and to warn when the server is older than the extension expects. Docker's
healthcheck (slice 40) uses the status code.

## Acceptance criteria

- [ ] Killing `Kotiko.Supervisor` with `Process.exit(pid, :kill)` makes the OS process exit
      non-zero within 2 s (F19).
- [ ] After changing `mix.lock` to a newer compatible version, `./run.sh` fetches and
      starts without manual steps (F20).
- [ ] `BIND=localhost` starts and listens on 127.0.0.1; `BIND=nonexistent.invalid`,
      `PORT=abc`, `ALLOWED_TELEGRAM_IDS=1,x` each print the block above, naming every
      problem, and exit 78 without a stack trace (F34).
- [ ] `install-service.sh` from a folder named `My %Projects` produces a unit that starts;
      `systemd-analyze verify` passes on it; `.env` ends up mode 0600 (F35).
- [ ] First boot on an empty data directory logs no `database is locked` line (F40).
- [ ] With `LOG_LEVEL=debug`, a log line containing a test API key, a Telegram bot token
      URL and a `Bearer` header shows only redacted forms.
- [ ] `GET /health` returns the JSON above; with the database file made unreadable it
      returns 503 and `"db": "error"`.
- [ ] `shellcheck` passes on both scripts.

## Test plan

- ExUnit: `Kotiko.ConfigTest` (table of variable maps → parsed config or the exact error
  lines); `Kotiko.Log.RedactTest` (table of messages, plus `capture_log` around a forced
  Req error carrying a Telegram URL); `/health` with the sandbox and with a stopped Repo.
- A boot test that starts the app in a subprocess (`System.cmd("mix", ["run", ...])` in
  a temp copy) with a bad `.env` and asserts exit status 78 and stderr text.
- Shell: `shellcheck`; `install-service.sh` against a stubbed `systemctl` on `PATH` that
  records arguments, and `systemd-analyze verify` on the generated unit in CI.
- Manual: on the maintainer's machine, `git pull` across a `mix.lock` change with the
  service installed; confirm automatic recovery.

## Rollout and migration

- Ships in the next server release. Existing `.env` files keep working; anything that
  used to crash now gives a readable error instead.
- People running `./run.sh` will see a one-time recompile into `_build/prod`.
- Re-run `install-service.sh` to get the new unit (the release notes say so).
- Changelog: "The server now explains configuration mistakes instead of crashing, updates
  its dependencies on start, restarts reliably under systemd, keeps keys out of logs, and
  /health reports its version."

## Open questions

1. **`MIX_ENV=prod` in `run.sh`.** It means a separate `_build/prod` and no dev tools at
   runtime. Recommendation: yes; it matches releases and is what users should run.
2. **Exit status 78 and `RestartPreventExitStatus`.** It stops systemd from retrying a
   config error forever, but also means a fixed `.env` needs a manual restart.
   Recommendation: keep; the message says to restart.

## Future work

- Read `.env` in Elixir instead of shell sourcing (exact parsing, works on Windows):
  slice 40.
- `mix kotiko.doctor`: config, paths, service, health in one report.
- Structured (JSON) log output option for Docker users.
