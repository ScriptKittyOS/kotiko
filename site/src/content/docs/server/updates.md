---
title: Updates and backups
description: Update the Kotiko server, back up its words, and go back to an earlier version.
---

## Updating

```bash
git pull
```

Then restart the server (`systemctl --user restart kotiko`, or stop `./run.sh` and start it
again). It fetches changed dependencies and updates the database by itself. Run
`server/install-service.sh` again if the release notes say the service file changed.

If you load Kotiko from the repository's `extension` folder, keep that folder where it is and
select the reload button on Kotiko's card in `chrome://extensions`. Chrome ties an unpacked
extension's settings to its folder: moved or renamed, it starts with empty settings.

## Backups

When an update changes the database, the server first copies it to
`backups/kotiko-pre-<version>-<time>.db` in the data folder (usually `~/.local/share/kotiko`)
and names the file in the log
("Backed up the database to ..."). The newest five copies are kept.

To go back: stop the server, delete `kotiko.db-wal` and `kotiko.db-shm` if they're there,
copy the backup over `kotiko.db`, and start the version you had before.

In `server/`:

- `mix kotiko.export --output backup.json` writes every word to a Kotiko backup file;
- `mix kotiko.import backup.json` reads one back;
- `mix kotiko.reset` deletes every word, after asking and after copying the database to
  `backups/` (`--yes` doesn't ask, `--no-backup` skips the copy). Settings, the access key and
  the Telegram pairing stay.

Kotiko in the browser can export and restore too: see [Your data](/use/your-data/).

<!-- legacy-name-ok-start -->
<h2 id="updating-from-slovo">Updating from Slovo</h2>

Kotiko used to be called Slovo. The first start after the update moves everything over:

1. **Stop the old server**: `systemctl --user stop slovo`, or press Ctrl+C in the terminal
   running `./run.sh`. (`install-service.sh` stops the old service for you.)
2. **Back up your words** (optional; the update never changes the old files):
   `cp -a ~/.local/share/slovo ~/slovo-backup`.
3. **Update and start**: `git pull`, then `server/install-service.sh` (it replaces the
   `slovo` service with `kotiko` and keeps the old unit file as `slovo.service.bak`), or
   `./run.sh`.
4. **Check the log**: the first start copies `~/.local/share/slovo/slovo.db` to
   `~/.local/share/kotiko/kotiko.db` and says "Moved your words from ... (N words)". Your
   access key is copied too, so the extension stays connected. The old folder is left as a
   backup with a `MOVED-TO-KOTIKO.txt` note in it; delete it once you've checked your words.
5. **If you set `SLOVO_DATA_DIR`** in `.env`, rename it to `KOTIKO_DATA_DIR` (and
   `SLOVO_LOG_SQL` to `KOTIKO_LOG_SQL`). The old names still work for now, with a warning.
   The words in that folder are copied to `kotiko.db` next to the old `slovo.db`.
6. **Reload the extension** in place, as above. Its settings and words carry over.

If the server stops with "Your old Slovo server is still running", stop it (step 1) and
start Kotiko again.
<!-- legacy-name-ok-end -->
