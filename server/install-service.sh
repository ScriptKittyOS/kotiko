#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0
# Installs the server as a systemd user service that starts at boot, wherever this folder
# lives (spaces and % in the path are fine). Uses the PATH of the shell you run it from,
# so asdf/mise installs of Elixir just work.
set -euo pipefail
# Everything this script writes (the unit file) is private.
umask 077
cd "$(dirname "$0")"
dir="$(pwd)"
unit="$HOME/.config/systemd/user/slovo.service"
wait_seconds="${INSTALL_WAIT_SECONDS:-20}"

if [ ! -f .env ]; then
  echo "No .env yet. Run: cp .env.example .env && chmod 600 .env, then fill it in." >&2
  exit 78
fi
command -v mix >/dev/null || { echo "mix not found on PATH. Install Elixir first." >&2; exit 1; }

# .env holds your keys: readable by you only.
if [ -n "$(find .env \( -perm -040 -o -perm -020 -o -perm -010 -o -perm -004 -o -perm -002 -o -perm -001 \))" ]; then
  echo "Making .env private (it holds your keys): chmod 600 .env" >&2
  chmod 600 .env
fi

# systemd reads % as a specifier and \ and " as escapes inside quotes; ExecStart also
# expands $. Quoting keeps a path with spaces in one piece.
systemd_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//%/%%}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}
exec_escape() {
  local s
  s=$(systemd_escape "$1")
  printf '%s' "${s//\$/\$\$}"
}

# Compile now, so the service is answering within seconds of starting.
echo "Fetching dependencies and compiling (the first time takes a minute or two)..."
./run.sh --compile

mkdir -p "$(dirname "$unit")"
cat > "$unit" <<EOF
[Unit]
Description=Vocabulary server and Telegram bot
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
WorkingDirectory=${dir//%/%%}
ExecStart="$(exec_escape "$dir")/run.sh"
Environment="PATH=$(systemd_escape "$PATH")"
Restart=on-failure
RestartSec=5
# 78 is a mistake in .env: retrying won't fix it. Fix .env, then restart by hand.
RestartPreventExitStatus=78

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable slovo
systemctl --user restart slovo
loginctl enable-linger "$USER" 2>/dev/null || true
echo "Installed $unit"

# Where the server listens, from .env as run.sh reads it.
settings=$(
  set -a
  # shellcheck source=/dev/null
  . ./.env >/dev/null 2>&1 || true
  printf '%s %s' "${PORT:-4747}" "${BIND:-127.0.0.1}"
)
port=${settings%% *}
bind=${settings#* }
case "$bind" in
  0.0.0.0 | "") host=127.0.0.1 ;;
  ::) host="[::1]" ;;
  *:*) host="[$bind]" ;;
  *) host=$bind ;;
esac
url="http://$host:$port/health"

if command -v curl >/dev/null; then
  echo "Waiting for $url ..."
  for _ in $(seq "$wait_seconds"); do
    if body=$(curl -fsS --max-time 2 "$url" 2>/dev/null); then
      echo "Running: $body"
      echo "Logs:     journalctl --user -u slovo -f"
      echo "Restart:  systemctl --user restart slovo   (after editing .env)"
      exit 0
    fi
    sleep 1
  done
  echo "The server didn't answer $url within $wait_seconds s. Its last log lines:" >&2
  journalctl --user -u slovo -n 20 --no-pager >&2 || true
  status=$(systemctl --user show -p ExecMainStatus --value slovo 2>/dev/null || echo "unknown")
  echo "Exit status: $status (78 means a mistake in .env; the lines above say which)." >&2
  exit 1
fi

echo "Logs:     journalctl --user -u slovo -f"
echo "Restart:  systemctl --user restart slovo   (after editing .env)"
