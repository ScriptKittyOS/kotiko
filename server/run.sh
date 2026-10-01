#!/usr/bin/env bash
# Loads .env and starts the server (API + Telegram bot).
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "No .env yet. Run: cp .env.example .env  and fill it in." >&2
  exit 1
fi

set -a
. ./.env
set +a

[ -d deps ] || mix deps.get
exec mix run --no-halt
