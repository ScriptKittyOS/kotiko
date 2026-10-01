# 40 · Server packaging and Docker

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | M (about a week) |
| **Depends on** | [04-rename-to-mira](../04-rename-to-mira/SPEC.md), [29-server-ops-hardening](../29-server-ops-hardening/SPEC.md) |
| **Unblocks** | [48-multi-user-and-classroom](../48-multi-user-and-classroom/SPEC.md); hosting templates (Future work) |
| **Sources** | [04 S12, S13, S14, S15, section 3 "Release plan"](../../docs/research/04-architecture-release.md); [06 F19, F20](../../docs/research/06-adversarial-qa.md) |

## Problem

The server only runs as `mix run --no-halt` from a source checkout (`server/run.sh:16`),
which needs Elixir and Erlang installed, and only installs as a service through systemd
(`server/install-service.sh`). Home-server, NAS and Raspberry Pi users expect a Docker
image; macOS and Windows users have no service option at all ([04 S12, S13](../../docs/research/04-architecture-release.md)).
Upgrades run migrations at boot with no copy of the database first ([04 S15](../../docs/research/04-architecture-release.md));
slice 07 adds a pre-migration backup, but there is no command to make one on demand or
documented way to restore.

## Goals

- A multi-arch (amd64, arm64) image on GHCR with a `/data` volume, a healthcheck, a
  non-root user, and a compose file that is safe by default.
- A `mix release` build usable without Elixir installed, attached to each GitHub release
  for Linux (x86_64, arm64).
- Service definitions for Linux (user and system), macOS (launchd) and Windows (Task
  Scheduler). Docker, Linux, macOS and Windows are all officially supported (maintainer
  decision): each is tested in CI or before every release.
- Backups on demand, before migrations, and a documented restore.

## Non-goals

- Single-file binaries (Burrito): Future work.
- Fly.io or Railway templates: Future work.
- The versioned `/health` endpoint: delivered in slice [29](../29-server-ops-hardening/SPEC.md)
  because slice 11 needs it at launch; this slice relies on it.
- HTTPS termination: the Tailscale example covers remote access.

## User stories

- As a Raspberry Pi owner, I want `docker compose up -d` and nothing else.
- As a macOS user who wants Telegram, I want the server to start at login.
- As anyone upgrading, I want a copy of my words taken before the database changes.

## Specification

### 1. Release build

- `mix.exs` `releases: [mira: [include_executables_for: [:unix, :windows], steps: [:assemble, :tar]]]`.
- `Mira.Release` module for operations without Mix: `migrate/0`, `backup/0`,
  `token/0`, `rotate_token/0` (slice 01's tasks), called as
  `bin/mira eval "Mira.Release.backup()"`. The mix tasks call the same functions.
- `.env` loading for releases: `Mira.Config` reads `MIRA_ENV_FILE` (default `./.env`
  next to the release, or none in Docker) with a strict `KEY=VALUE` parser (comments,
  blank lines, single and double quotes, no shell expansion), so behaviour doesn't depend
  on a shell. Real environment variables win over the file.
- Data directory defaults per platform: Linux `$XDG_DATA_HOME/mira` or
  `~/.local/share/mira`; macOS `~/Library/Application Support/Mira`; Windows
  `%LOCALAPPDATA%\Mira`. If `~/.local/share/mira` already exists on macOS (people who ran
  from source), it keeps being used. Slice 04's legacy migration runs on every platform.
- Release tarballs `mira-server-<version>-linux-x86_64.tar.gz` and `-linux-aarch64`,
  built on native GitHub runners (`ubuntu-24.04`, `ubuntu-24.04-arm`) in slice 30's
  release workflow, with checksums and attestations. They need the target's glibc and
  OpenSSL; the README says which distributions are tested (Debian 12+, Ubuntu 22.04+).

### 2. Docker image

`server/Dockerfile`, build context = repository root (slice 09's `spec/` is compiled in):

```dockerfile
FROM hexpm/elixir:1.19.2-erlang-28.1-debian-bookworm-<date>-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git
ENV MIX_ENV=prod
WORKDIR /src
COPY server/mix.exs server/mix.lock server/
COPY spec spec
RUN cd server && mix local.hex --force && mix local.rebar --force && mix deps.get --only prod && mix deps.compile
COPY server server
RUN cd server && mix release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 openssl ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --create-home mira
ENV LANG=C.UTF-8 MIRA_DATA_DIR=/data BIND=0.0.0.0 PORT=4747 MIRA_IN_CONTAINER=1
COPY --from=build --chown=mira /src/server/_build/prod/rel/mira /app
RUN mkdir /data && chown mira /data
USER mira
VOLUME /data
EXPOSE 4747
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD curl -fsS http://127.0.0.1:4747/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/bin/mira", "start"]
```

- Base images pinned by digest; Dependabot (`docker` ecosystem) updates them.
- `MIRA_IN_CONTAINER=1` turns slice 01's `0.0.0.0` warning into an explanation of port
  mapping. The healthcheck's `Host: 127.0.0.1` passes slice 01's Host check.
- Tags: `ghcr.io/scriptkittyos/mira:0.3.1`, `:0.3`, `:latest`. OCI labels for source,
  version, license (`Apache-2.0`). Built per architecture on native runners, then merged
  into one manifest list; `provenance: mode=max` and `sbom: true` in
  `docker/build-push-action`; `actions/attest-build-provenance` on the digest.
- Image size target: under 120 MB.

### 3. Compose

`deploy/docker-compose.yml`:

```yaml
services:
  mira:
    image: ghcr.io/scriptkittyos/mira:0.3
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:4747:4747"     # this machine only; see the Tailscale example
    volumes:
      - mira-data:/data
volumes:
  mira-data: {}
```

`deploy/docker-compose.tailscale.yml`: a `tailscale/tailscale` sidecar with
`TS_AUTHKEY`, `TS_SERVE_CONFIG` serving `https://mira.<tailnet>.ts.net` to `mira:4747`,
and `ALLOWED_HOSTS=mira.<tailnet>.ts.net` for slice 01. This is the recommended remote
setup: HTTPS, no open ports.

First run: the token is generated into `/data/api-token` (slice 01);
`docker compose exec mira /app/bin/mira eval "Mira.Release.token()"` prints it and the
pairing string.

### 4. Service files

- **Linux, user service** (today's path): `install-service.sh` gains `--release <dir>` to
  use `bin/mira start` instead of `run.sh`, with slice 29's quoting and slice 04's
  old-unit cleanup. Source installs keep working as before.
- **Linux, system service**: `deploy/systemd/mira.service` for servers:
  `DynamicUser=yes`, `StateDirectory=mira` (data in `/var/lib/mira`),
  `EnvironmentFile=/etc/mira/env`, `ProtectSystem=strict`, `ProtectHome=yes`,
  `NoNewPrivileges=yes`, `PrivateTmp=yes`, `RestartPreventExitStatus=78`.
- **macOS**: `deploy/macos/org.scriptkittyos.mira.plist`, a LaunchAgent with
  `RunAtLoad`, `KeepAlive` (`SuccessfulExit: false`), logs to `~/Library/Logs/Mira/`,
  plus `deploy/macos/install.sh` that fills in paths and runs `launchctl bootstrap gui/$UID`.
  Officially supported: CI runs the release build and a launchd smoke test on a macOS runner.
- **Windows**: `deploy/windows/install.ps1` registers a Task Scheduler task "at log on"
  running `bin\mira.bat start` with restart on failure (simpler than a Windows service,
  [04 S12](../../docs/research/04-architecture-release.md)). Officially supported: CI runs the
  install script and a health check on a Windows runner.
  The release tarball for Windows is Future work (exqlite needs a Windows build).

### 5. Backups

- **Automatic** (slice 07): before pending migrations, `VACUUM INTO
  <data>/backups/mira-pre-<version>-<timestamp>.db`; keep the newest five.
- **On demand**: `mix mira.backup` / `bin/mira eval "Mira.Release.backup()"` writes
  `<data>/backups/mira-manual-<timestamp>.db` and prints the path. Safe while the server
  runs (`VACUUM INTO` takes a consistent snapshot).
- **Restore** (documented, not automated): stop the server, copy a backup over
  `mira.db`, delete `mira.db-wal` and `mira.db-shm`, start. A newer schema than the code
  expects stops boot with a message naming the version.
- Docker: `docker compose exec mira /app/bin/mira eval "Mira.Release.backup()"`, then copy
  out of the volume with `docker compose cp`.

## Acceptance criteria

- [ ] `docker compose up -d` on amd64 and arm64 (Raspberry Pi 4/5, 64-bit OS) starts a
      healthy container; `curl localhost:4747/health` returns slice 29's JSON.
- [ ] The container runs as uid 10001, and data survives `docker compose down && up`.
- [ ] The default compose file is not reachable from another machine.
- [ ] The Tailscale example serves over HTTPS on the tailnet name with `ALLOWED_HOSTS` set.
- [ ] A release tarball runs on a clean Debian 12 machine with no Elixir installed.
- [ ] Upgrading the image across a migration leaves a `mira-pre-*.db` backup in `/data/backups`.
- [ ] `Mira.Release.backup()` works while the server is serving requests.
- [ ] macOS LaunchAgent starts at login and restarts after `kill`.

## Test plan

- CI (slice 02): build the image on PRs that touch `server/` or `spec/` (amd64 only, no
  push); run it and poll `/health`; run a `docker compose` smoke with a volume.
- Release workflow (slice 30): build both architectures natively, push, attest.
- `.env` parser unit tests (quotes, comments, `$` kept literally, CRLF).
- Manual per minor release: Raspberry Pi, macOS LaunchAgent, Windows task.

## Rollout and migration

- Source installs are unaffected; the README gains "Docker" as the first server option.
- Moving from source to Docker: copy `~/.local/share/mira/mira.db` into the volume
  (`docker compose cp mira.db mira:/data/mira.db` before first start) and the `.env`
  values; documented step by step.
- Changelog: "The server now ships as a Docker image for amd64 and arm64, and as a
  standalone release. Backups are taken before every database upgrade."

## Open questions

1. **Supported platforms.** Decided by the maintainer: all of them (Docker, Linux, macOS,
   Windows). Open: whether the Windows release tarball (blocked on an exqlite Windows build,
   Future work) is needed for launch or Docker Desktop covers Windows until then.
   Recommendation: Docker Desktop for launch.
2. **Publish `:latest`?** Recommendation: yes, but the compose file pins the minor (`:0.3`)
   so upgrades across minors are deliberate.

## Future work

- Burrito single-file binaries for Windows, macOS and Linux ([04 S12](../../docs/research/04-architecture-release.md)).
- Fly.io and Railway templates with a persistent volume and an always-on machine (Telegram
  long polling breaks with scale to zero; [04 S14](../../docs/research/04-architecture-release.md)).
- Scheduled backups and a restore command.
