#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0
# Loads .env and starts the Kotiko server (API + Telegram bot).
#
#   ./run.sh            fetch dependencies if mix.lock changed, compile, run
#   ./run.sh --compile  the same without running (install-service.sh uses it)
#
# Runs with MIX_ENV=prod unless MIX_ENV is set (in your shell or in .env). Prod builds
# into _build/prod, so the first start after switching compiles everything once.
set -euo pipefail
# Everything the server writes (your words, their backups, the token) is readable by you
# only. The server makes its own files private too; this covers the moment each one is
# made, and anything else it writes.
umask 077
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "No .env yet. Run: cp .env.example .env && chmod 600 .env, then fill it in." >&2
  exit 78
fi

# .env holds your keys: readable by you only.
if [ -n "$(find .env \( -perm -040 -o -perm -020 -o -perm -010 -o -perm -004 -o -perm -002 -o -perm -001 \))" ]; then
  echo "Making .env private (it holds your keys): chmod 600 .env" >&2
  chmod 600 .env || echo "Couldn't chmod .env; run chmod 600 .env yourself." >&2
fi

set -a
# shellcheck source=/dev/null
. ./.env
set +a

export MIX_ENV="${MIX_ENV:-prod}"
# A crash dump holds the server's memory, keys included; don't leave one in this folder.
export ERL_CRASH_DUMP_SECONDS="${ERL_CRASH_DUMP_SECONDS:-0}"

# After a git pull that changed mix.lock, fetch the new versions. The check is local and
# quick; deps.get (which asks hex.pm) only runs when something is missing or out of date.
if ! mix deps.loadpaths --no-compile >/dev/null 2>&1; then
  echo "Fetching dependencies..." >&2
  if ! mix deps.get --only "$MIX_ENV"; then
    echo "Couldn't fetch dependencies (offline?). Trying with what's installed." >&2
  fi
fi

if [ "${1:-}" = "--compile" ]; then
  exec mix compile
fi
exec mix run --no-halt
