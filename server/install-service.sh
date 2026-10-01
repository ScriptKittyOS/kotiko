#!/usr/bin/env bash
# Installs Slovo as a systemd user service that starts at boot, wherever this folder lives.
# Uses the PATH of the shell you run it from, so asdf/mise installs of Elixir just work.
set -euo pipefail
cd "$(dirname "$0")"
dir="$(pwd)"
unit="$HOME/.config/systemd/user/slovo.service"

[ -f .env ] || { echo "No .env yet. Run: cp .env.example .env  and fill it in." >&2; exit 1; }
command -v mix >/dev/null || { echo "mix not found on PATH. Install Elixir first." >&2; exit 1; }

mkdir -p "$(dirname "$unit")"
cat > "$unit" <<EOF
[Unit]
Description=Slovo vocabulary bot and API
After=network-online.target

[Service]
WorkingDirectory=$dir
ExecStart=$dir/run.sh
Environment=PATH=$PATH
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now slovo
systemctl --user restart slovo
loginctl enable-linger "$USER" 2>/dev/null || true

echo "Installed $unit"
echo "Logs:     journalctl --user -u slovo -f"
echo "Restart:  systemctl --user restart slovo   (after editing .env)"
