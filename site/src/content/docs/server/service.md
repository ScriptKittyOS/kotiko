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

On macOS and Windows, run `./run.sh` in a terminal (on Windows, inside WSL), or use your
system's own way to start a program at login. A packaged server is planned.
