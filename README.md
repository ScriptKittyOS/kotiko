# Kotiko

<!-- legacy-name-ok-start -->
> Formerly Slovo. Updating from it? See [Updating from Slovo](#updating-from-slovo).
<!-- legacy-name-ok-end -->

[![CI](https://github.com/ScriptKittyOS/kotiko/actions/workflows/ci.yml/badge.svg)](https://github.com/ScriptKittyOS/kotiko/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Learn a word in any language and from then on it replaces its English on every web page
you read. Russian, Mandarin, Arabic, Japanese, all of them at once or just the ones you pick.
Hover a swapped word to see the English and how it's said in your other languages.

```
extension popup ─┐
                 ├──▶ server (Elixir + SQLite) ──▶ OpenRouter (free model works out the word)
Telegram (phone) ┘          ▲
                            └── browser extension syncs your words every minute
```

- `server/` is a small Elixir app: a JSON API for the extension, an optional Telegram bot
  (long polling, so no public URL or webhook), and a SQLite file for your words.
- `extension/` is a Chrome/Brave/Edge extension (Manifest V3). It syncs every minute and on
  every page load, so a word you add from your phone is live on the next page you open.

---

## Setup (about 10 minutes)

### 1. Get a free OpenRouter key

Sign in at [openrouter.ai](https://openrouter.ai) and create a key at
[openrouter.ai/keys](https://openrouter.ai/keys). Kotiko uses free models by default, so it
costs nothing. Free models allow about 50 requests a day; adding $10 of credit once raises
that to 1000 a day and the free models stay free.

### 2. Start the server

You need Elixir 1.15+.

```bash
cd server
cp .env.example .env && chmod 600 .env
```

Edit `.env` and fill in your OpenRouter key:

```
LLM_API_KEY=<your OpenRouter key>
```

Then:

```bash
./run.sh
```

First run fetches dependencies and compiles (in `MIX_ENV=prod` unless you set `MIX_ENV`), then
prints a short summary: version, data folder, who can reach the server, model and Telegram.
Check it with `curl localhost:4747/health` (prints `{"ok":true,...}` with the version). A
mistake in `.env` stops the server with a message naming each setting to fix. After a
`git pull`, `./run.sh` fetches changed dependencies itself. The first start also makes an API
token, saves it in the data folder and prints it. `mix kotiko.token` (in `server/`) prints it
again, with a pairing string. To pick your own instead, set `API_TOKEN` in `.env` (at least
24 characters, e.g. `openssl rand -hex 24`).

### 3. Load the extension

1. Open `chrome://extensions` (Brave: `brave://extensions`, Edge: `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin Kotiko, click its icon, open **Connection**, paste your API token, click **Save connection**.

The popup should say "0 words known, synced just now".

### 4. Try it

Type `shukran` in the popup's box and press **Add**. It answers
"Added شكرا (shukran) = thanks · Arabic". Open any page with the word "thanks" in it.

---

## Adding words

Type into the popup box, or send it to the Telegram bot. Both understand the same things:

| You type | What happens |
|---|---|
| `shukran`, `xie xie`, `sobaka` | Phonetic spelling is fine; the model works out the word and language |
| `how do you say dog in japanese` | Finds 犬 (inu) |
| `da in serbian` | Name the language when a word could be several |
| `what does дом mean` | Bot shows a card with Add / Skip (the popup always adds) |

Any language works, and a new language starts the moment you add its first word. When you
don't name a language and a word is ambiguous, Kotiko assumes the one you've been adding lately.

Words are saved in dictionary form, so "houses" becomes "дом", not "дома". That's deliberate:
you're learning to recognize the word, not the grammar, yet. Arabic and Hebrew are written
without vowel marks, the way you'll see them in real text; the romanization tells you how to
say them.

## Choosing languages

The popup lists every language you have words in. Tick any combination:

- **All of them**: when several languages know the same English word, the page rotates between
  them ("thanks" becomes спасибо, then 谢谢, then شكرا). Hover any of them to see all three.
- **Just one**: hover a language and click **only**.
- **Some**: untick the ones you want to rest. **show all** brings everything back.

A language you've hidden stays hidden until you tick it again; a language you've just started
always shows up. **Swap words on pages** turns everything off, and **Pause on this site** turns
it off for one site.

---

## Optional extras

### Telegram bot

Lets you add words from your phone, including by voice.

1. In Telegram, open a chat with **@BotFather** and send `/newbot`. Pick a name (Kotiko,
   say) and a username ending in `bot` (like `yourname_kotiko_bot`), and copy the token.
2. Put it in `server/.env` as `TELEGRAM_BOT_TOKEN=` and restart the server.
3. Message your bot anything. It replies with your Telegram ID. Put it in `.env` as
   `ALLOWED_TELEGRAM_IDS=123456789` and restart. From now on the bot ignores everyone else.

| Command | What it does |
|---|---|
| `add sobaka` or `/add sobaka` | Saved immediately, card with Undo |
| `/list` | Your 15 newest words and the total |
| `/list arabic` | Newest words in one language |
| `/languages` | How many words you know in each language |
| `/remove да` | Stops replacing that word |

### Voice notes

Telegram sends bots the raw audio, not a transcript, so the server needs a speech-to-text
endpoint. Without one, typing works, and so does your phone keyboard's mic button
(that sends a normal text message).

To run Whisper locally (needs `cmake`, `git` and `ffmpeg` from your package manager):

```bash
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
sh ./models/download-ggml-model.sh large-v3
cmake -B build && cmake --build build -j --config Release
./build/bin/whisper-server -m models/ggml-large-v3.bin \
  --host 127.0.0.1 --port 8178 -l auto --convert
```

Then in `server/.env`:

```
TRANSCRIBE_URL=http://localhost:8178/inference
```

and restart. Any OpenAI-compatible `/v1/audio/transcriptions` URL also works; set
`TRANSCRIBE_API_KEY` and `TRANSCRIBE_MODEL` for those.

### Keep it running

```bash
server/install-service.sh
```

That compiles, installs a systemd user service that starts at boot and restarts on failure,
and waits until `/health` answers. Run it from the shell where `mix` works; it copies that
shell's PATH, so asdf and mise installs are fine. Re-run it after updating to get the newest
unit file. Logs: `journalctl --user -u kotiko -f`. After editing `.env`:
`systemctl --user restart kotiko` (a mistake in `.env` stops the service until you do).

### Updating

```bash
git pull
```

Then restart the server (`systemctl --user restart kotiko`, or stop `./run.sh` and start it
again); it fetches changed dependencies and migrates the database itself. Re-run
`server/install-service.sh` if the release notes say the unit file changed.

For the extension, keep the `extension` folder where it is and click the reload icon on its
card in `chrome://extensions`. Chrome ties an unpacked extension's identity to its folder:
moved or renamed, it starts with empty settings, so you'd paste the server address and token
again (your words come back on the next sync; hidden languages and paused sites would need
setting again).

When an update changes the database, the server first copies it to
`~/.local/share/kotiko/backups/kotiko-pre-<version>-<time>.db` and names the file in the
log ("Backed up the database to ..."); the newest five copies are kept. To go back, stop the
server, delete `kotiko.db-wal` and `kotiko.db-shm` if they're there, copy that file over
`kotiko.db`, and start the version you had before.

<!-- legacy-name-ok-start -->
#### Updating from Slovo

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
   API token is copied too, so the extension stays connected. The old folder is left as a
   backup with a `MOVED-TO-KOTIKO.txt` note in it; delete it once you've checked your words.
5. **If you set `SLOVO_DATA_DIR`** in `.env`, rename it to `KOTIKO_DATA_DIR` (and
   `SLOVO_LOG_SQL` to `KOTIKO_LOG_SQL`). The old names still work for now, with a warning.
   The words in that folder are copied to `kotiko.db` next to the old `slovo.db`.
6. **Reload the extension** in place, as above. Its settings and words carry over.

If the server stops with "Your old Slovo server is still running", stop it (step 1) and
start Kotiko again.
<!-- legacy-name-ok-end -->

### A different model

`LLM_URL` takes any OpenAI-compatible API. `LLM_MODEL` is a comma-separated list tried in
order: when one is busy or finds nothing, the next one gets the word. The built-in list is
several free OpenRouter models, because free models are often rate limited. Each lookup is
logged with the model that answered. For a local Ollama:

```
LLM_URL=http://localhost:11434/v1
LLM_MODEL=<a model from `ollama list`>
LLM_API_KEY=
```

### Browse on another machine

The server only listens on localhost by default. To use the extension on a laptop, set
`BIND` in `.env` to the server's Tailscale IP (or `0.0.0.0` on a trusted network), restart,
and put `http://<that-ip>:4747` in the extension's Server address. Tailscale encrypts the
traffic; on a plain local network the token travels unencrypted, and the server warns about
that when it starts.

The server only answers to `localhost`, IP addresses and this machine's own name, so a
website can't reach it through DNS rebinding. To reach it by another name (a Tailscale
MagicDNS name, a reverse proxy), add that name to `ALLOWED_HOSTS` in `.env`, comma-separated.
Behind a proxy, set `PUBLIC_URL` to the address the extension should use.

### Firefox

Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and pick
`extension/manifest.json`. Then in `about:addons`, open Kotiko's Permissions tab and allow
access to all websites. Temporary add-ons are removed when Firefox restarts.

---

## Troubleshooting

- **Popup says it can't reach the server**: is `./run.sh` running? Does the address in
  Connection match `PORT`/`BIND`?
- **"The server rejected that API token"**: the token in the popup must match the server's
  exactly. `mix kotiko.token` in `server/` prints it.
- **The server answers `421`**: you reached it by a name it doesn't know. Add the name to
  `ALLOWED_HOSTS` in `.env` and restart.
- **"the API key was rejected"** or **"LLM_API_KEY isn't set"**: check `LLM_API_KEY` in `.env`, then restart
  the server. It only reads `.env` when it starts.
- **"all the free models are busy right now"**: everyone shares the free models' capacity,
  and your key allows 20 requests a minute and 50 a day. Wait a minute, or add $10 of
  OpenRouter credit for 1000 a day.
- **Wrong language picked**: say which, e.g. `da in serbian`, and undo the wrong one.
- **The bot doesn't answer at all**: check the server log. A `409` means another copy is
  already polling with the same token; stop it.
- **A site acts strangely**: some apps don't like their text being rewritten. Use
  "Pause on this site" in the popup.
- **Start over**: stop the server and delete `~/.local/share/kotiko/kotiko.db`.

## API

Every route except `GET /health` needs `Authorization: Bearer <API token>`.

| Route | Does |
|---|---|
| `GET /api/v1/words` | Your words with every field; `?lang=ru,ar`, `?base=es`, `?status=active,paused`, `?limit=` |
| `GET /api/v1/words/:id` | One word by its id (a UUID), deleted ones included |
| `POST /api/v1/words` `{"text": "shukran", "base_langs": ["en"]}` | Works out the word(s) and saves them, merging into words you have; `"preview": true` saves nothing and returns candidates; `{"word": {...}}` saves a word without the model |
| `POST /api/v1/words/batch` `{"words": [...]}` | Saves up to 500 words at once, without the model |
| `PATCH /api/v1/words/:id` | Edits the fields you send; `if_updated_at` (or `If-Match`) refuses a stale edit |
| `DELETE /api/v1/words/:id`, `POST /api/v1/words/:id/restore` | Deletes a word, and undoes that for 30 days |
| `GET`/`POST /api/v1/jobs/pronunciation-refresh` | The one-time job adding pronunciations to saved words; `{"action": "pause"}` or `"resume"` |
| `GET /api/words`, `POST /api/words`, `DELETE /api/words/:id` | The routes the 0.2 extension uses (words for English pages only); removed one minor version after `/api/v1` ships |
| `GET /health` | `{"ok", "name", "version", "api", "db"}`, no token needed; 503 when the database fails |

Errors from `/api/v1` look like `{"error": {"code": "word_conflict", "message": "...", "details": {...}}}`.

## Layout

```
server/
  lib/kotiko/llm.ex          prompt that turns a message into word entries (any language)
  lib/kotiko/router.ex       the API above (router_v1.ex: the /api/v1 routes)
  lib/kotiko/bot.ex          Telegram long polling, commands, Add/Skip buttons
  lib/kotiko/transcriber.ex  voice note → text
  lib/kotiko/words.ex        database functions
  lib/kotiko/data_dir.ex     where the words live; the one-time move from before the rename
  install-service.sh         systemd user service
extension/
  background.js              syncs words from the server, relays adds from the popup
  content.js                 swaps words on the page, watches for new content
  popup.html / popup.js      add a word, choose languages, on/off, per-site pause, connection
```

## License

The code is licensed under [Apache-2.0](LICENSE). The name, logo and illustrations in
`brand/` are trademarks of ScriptKittyOS and aren't covered by that license. See
[CONTRIBUTING.md](CONTRIBUTING.md) to get involved and [SECURITY.md](SECURITY.md) to report
a security problem.
