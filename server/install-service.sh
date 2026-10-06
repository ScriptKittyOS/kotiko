#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0
# Installs the server as a systemd user service that starts at boot, wherever this folder
# lives (spaces and % in the path are fine). Uses the PATH of the shell you run it from,
# so asdf/mise installs of Elixir just work.
#
#   ./install-service.sh                             install or update the service
#   ./install-service.sh --uninstall                 remove the service; keep your words
#   ./install-service.sh --uninstall --delete-data   ...and delete the data folder too
#
# The one file it installs, kotiko.service, goes in $XDG_CONFIG_HOME/systemd/user
# (~/.config/systemd/user when XDG_CONFIG_HOME isn't set). Nothing goes outside your home.
set -euo pipefail
# Everything this script writes (the unit file) is private.
umask 077
cd "$(dirname "$0")"
dir="$(pwd)"
wait_seconds="${INSTALL_WAIT_SECONDS:-20}"

usage() {
  cat <<'USAGE'
Usage: install-service.sh [--uninstall [--delete-data]]

  (no option)     Install or update the kotiko systemd user service, start it, and
                  wait until it answers.
  --uninstall     Stop and remove the service. Your words, the data folder and .env
                  are kept.
  --delete-data   With --uninstall: also delete the files Kotiko keeps in its data
                  folder (your words, the saved API token, the backups).
  -h, --help      Show this help.
USAGE
}

action=install
delete_data=false
for arg in "$@"; do
  case "$arg" in
    --uninstall) action=uninstall ;;
    --delete-data) delete_data=true ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 64
      ;;
  esac
done
if [ "$delete_data" = true ] && [ "$action" != uninstall ]; then
  echo "--delete-data only works with --uninstall." >&2
  exit 64
fi

# An XDG base directory variable, or the default when it's unset, empty or relative (the
# XDG Base Directory spec says to ignore a relative path).
xdg_base() {
  case "${1:-}" in
    /*) printf '%s' "${1%/}" ;;
    *) printf '%s' "$2" ;;
  esac
}

# Where the unit goes: systemd reads user units from $XDG_CONFIG_HOME/systemd/user. A unit
# installed before this script read XDG_CONFIG_HOME is in ~/.config; it stays there.
default_unit_dir="$HOME/.config/systemd/user"
unit_dir="$(xdg_base "${XDG_CONFIG_HOME:-}" "$HOME/.config")/systemd/user"
if [ "$unit_dir" != "$default_unit_dir" ] && [ ! -f "$unit_dir/kotiko.service" ] &&
  [ -f "$default_unit_dir/kotiko.service" ]; then
  unit_dir=$default_unit_dir
fi
unit="$unit_dir/kotiko.service"
# Before the rename to Kotiko the service had the old name; it was always in ~/.config.
old_unit="$default_unit_dir/slovo.service" # legacy-name-ok

# The data folder, chosen as the server chooses it (Kotiko.Config, Kotiko.DataDir):
# KOTIKO_DATA_DIR (or its old name) from .env or the environment, else
# $XDG_DATA_HOME/kotiko, else ~/.local/share/kotiko. Words already in
# ~/.local/share/kotiko stay there while the XDG folder has none.
data_folder() {
  local chosen old new
  chosen=$(
    if [ -f .env ]; then
      set -a
      # shellcheck source=/dev/null
      . ./.env >/dev/null 2>&1 || true
    fi
    printf '%s' "${KOTIKO_DATA_DIR:-${SLOVO_DATA_DIR:-}}" # legacy-name-ok
  )
  if [ -n "$chosen" ]; then
    case "$chosen" in
      \~) chosen=$HOME ;;
      \~/*) chosen="$HOME/${chosen#\~/}" ;;
    esac
    case "$chosen" in
      /*) printf '%s' "$chosen" ;;
      *) printf '%s' "$dir/$chosen" ;;
    esac
    return
  fi
  old="$HOME/.local/share/kotiko"
  new="$(xdg_base "${XDG_DATA_HOME:-}" "$HOME/.local/share")/kotiko"
  if [ -f "$new/kotiko.db" ] || [ ! -f "$old/kotiko.db" ]; then
    printf '%s' "$new"
  else
    printf '%s' "$old"
  fi
}

# Deletes only the files the server makes, so a data folder set to a shared place (or
# your home) loses nothing else. The folder goes too if that leaves it empty.
delete_data_folder() {
  local data=$1 name path
  if [ ! -d "$data" ]; then
    echo "No data folder at $data; nothing to delete."
    return
  fi
  for name in kotiko.db kotiko.db-wal kotiko.db-shm kotiko.db-journal kotiko.db.partial \
    kotiko.db.partial-journal kotiko.db.partial-wal kotiko.db.partial-shm api-token \
    api-token.new models-cache.json models-cache.json.tmp; do
    path="$data/$name"
    if [ -e "$path" ] || [ -L "$path" ]; then
      rm -f -- "$path"
      echo "Deleted $path"
    fi
  done
  for path in "$data"/backups/kotiko-*.db; do
    [ -e "$path" ] || continue
    rm -f -- "$path"
    echo "Deleted $path"
  done
  rmdir "$data/backups" 2>/dev/null || true
  if rmdir "$data" 2>/dev/null; then
    echo "Deleted the folder $data"
  else
    echo "Kept the folder $data: it holds files Kotiko didn't make."
  fi
}

# Removes what installing added: the unit file and its start-at-boot link.
uninstall() {
  local data found=false d link
  local dirs=("$unit_dir")
  [ "$default_unit_dir" = "$unit_dir" ] || dirs+=("$default_unit_dir")
  data=$(data_folder)

  for d in "${dirs[@]}"; do
    if [ -f "$d/kotiko.service" ]; then found=true; fi
  done

  if [ "$found" = true ]; then
    if ! systemctl --user disable --now kotiko; then
      echo "Couldn't stop and turn off the kotiko service (the lines above say why)." \
        "Nothing was removed." >&2
      exit 1
    fi
    echo "Stopped kotiko and turned off its start at boot"
  fi

  for d in "${dirs[@]}"; do
    if [ -f "$d/kotiko.service" ]; then
      rm -f -- "$d/kotiko.service"
      echo "Removed $d/kotiko.service"
    fi
    # The start-at-boot link, if one is left (say, the unit file was deleted by hand).
    link="$d/default.target.wants/kotiko.service"
    if [ -L "$link" ]; then
      rm -f -- "$link"
      echo "Removed $link"
      found=true
    fi
  done

  if [ "$found" = true ]; then
    systemctl --user daemon-reload
    systemctl --user reset-failed kotiko >/dev/null 2>&1 || true
  else
    echo "No kotiko service is installed (looked in ${dirs[*]})."
  fi

  if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)" = yes ]; then
    echo "Left on: lingering (loginctl enable-linger), which lets your services run while" \
      "you're logged out; other services may need it. To turn it off:" \
      "loginctl disable-linger $USER"
  fi
  if [ -f "$old_unit.bak" ]; then
    echo "Kept $old_unit.bak, the service file from before the rename; delete it if you" \
      "don't need it."
  fi

  if [ "$delete_data" = true ]; then
    delete_data_folder "$data"
  else
    echo "Kept your words in $data"
    if [ -f .env ]; then echo "Kept your settings in $dir/.env"; fi
    echo "To delete the data folder too: $dir/install-service.sh --uninstall --delete-data"
  fi
}

if [ "$action" = uninstall ]; then
  uninstall
  exit 0
fi

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

# Before the rename to Kotiko the service had the old name. Stop it (that frees the
# database and the port), keep its unit file in case you customised it, and forget it.
if [ -f "$old_unit" ]; then
  echo "Replacing the old slovo service with kotiko..." # legacy-name-ok
  systemctl --user disable --now slovo # legacy-name-ok
  mv -f "$old_unit" "$old_unit.bak"
  systemctl --user daemon-reload
  echo "Stopped and disabled slovo.service; its unit file is kept as $old_unit.bak" # legacy-name-ok
fi

environment="Environment=\"PATH=$(systemd_escape "$PATH")\""
# The server picks its data folder from XDG_DATA_HOME too: give the service the one this
# shell has, so it uses the same folder as ./run.sh started from here.
case "${XDG_DATA_HOME:-}" in
  /*) environment+=$'\n'"Environment=\"XDG_DATA_HOME=$(systemd_escape "$XDG_DATA_HOME")\"" ;;
esac

mkdir -p "$unit_dir"
cat > "$unit" <<EOF
[Unit]
Description=Kotiko vocabulary server and Telegram bot
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
WorkingDirectory=${dir//%/%%}
ExecStart="$(exec_escape "$dir")/run.sh"
$environment
Restart=on-failure
RestartSec=5
# 78 is a mistake in .env: retrying won't fix it. Fix .env, then restart by hand.
RestartPreventExitStatus=78

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
if ! systemctl --user enable kotiko; then
  if [ "$unit_dir" != "$default_unit_dir" ]; then
    echo "systemd didn't find $unit. It reads XDG_CONFIG_HOME from its own environment," \
      "not your shell's: set it for systemd too, or run this again without" \
      "XDG_CONFIG_HOME to use ~/.config." >&2
  fi
  exit 1
fi
systemctl --user restart kotiko
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
      echo "Logs:     journalctl --user -u kotiko -f"
      echo "Restart:  systemctl --user restart kotiko   (after editing .env)"
      echo "Remove:   $dir/install-service.sh --uninstall"
      exit 0
    fi
    sleep 1
  done
  echo "The server didn't answer $url within $wait_seconds s. Its last log lines:" >&2
  journalctl --user -u kotiko -n 20 --no-pager >&2 || true
  status=$(systemctl --user show -p ExecMainStatus --value kotiko 2>/dev/null || echo "unknown")
  echo "Exit status: $status (78 means a mistake in .env; the lines above say which)." >&2
  exit 1
fi

echo "Logs:     journalctl --user -u kotiko -f"
echo "Restart:  systemctl --user restart kotiko   (after editing .env)"
echo "Remove:   $dir/install-service.sh --uninstall"
