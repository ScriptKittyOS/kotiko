---
title: Keep the server running
description: Run the Kotiko server as a service that starts at boot and restarts on failure.
---

On Linux, one script sets up a systemd user service:

```bash
server/install-service.sh
```

It compiles, installs a service that starts at boot and restarts on failure, and waits until
`/health` answers. Run it from the shell where `mix` works; it copies that shell's `PATH`, so
asdf and mise installs are fine. Run it again after updating to get the newest service file.

- Logs: `journalctl --user -u kotiko -f`
- After editing `.env`: `systemctl --user restart kotiko` (a mistake in `.env` stops the
  service until you fix it)

The script installs one file, `kotiko.service`, in `~/.config/systemd/user` (or
`$XDG_CONFIG_HOME/systemd/user` if you set `XDG_CONFIG_HOME`), and nothing outside your home
folder. It also turns on "lingering" for your user, so the service runs while you're logged
out.

## Remove the service

```bash
server/install-service.sh --uninstall
```

It stops the service, turns off its start at boot, removes `kotiko.service` and says what it
removed. Your words, the data folder and `.env` stay where they are, and the script prints
where. Lingering stays on, because other services may need it; the script tells you how to
turn it off.

To delete your words too, add `--delete-data`:

```bash
server/install-service.sh --uninstall --delete-data
```

This deletes the files Kotiko keeps in its data folder: the database with your words, the
saved access key, the cached model list and the backups. Other files in that folder are left
alone, and the folder goes only if it's then empty. If you might want your words back,
[export them](/server/updates/#backups) first (`mix kotiko.export`). The `server` folder
itself (the code and `.env`) is yours to delete when you're done.

On macOS and Windows, run `./run.sh` in a terminal (on Windows, inside WSL), or use your
system's own way to start a program at login. A packaged server is planned.
