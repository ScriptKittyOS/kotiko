# Slovo

Learn a Russian (or Mandarin) word, tell a Telegram bot, and from then on that word
replaces its English on every web page you read. Hover a swapped word to see the English.

```
phone (Telegram) ──▶ server on hacktuah (Elixir + SQLite + Ollama) ◀── browser extension
```

- `server/` is a small Elixir app: Telegram bot (long polling, so no public URL or webhook),
  a JSON endpoint for the extension, and a SQLite file for your words.
- `extension/` is a Chrome/Brave/Edge extension (Manifest V3). It syncs every minute and on
  every page load, so a word you add from the car is live on the next page you open.

---

## Setup (about 15 minutes)

### 1. Make the Telegram bot

1. In Telegram, open a chat with **@BotFather** and send `/newbot`.
2. Pick a name and a username ending in `bot`.
3. Copy the token it gives you (looks like `123456:ABC-...`).

### 2. Start the server on hacktuah

You need Elixir 1.15+ and Ollama running.

```bash
cd ~/Projects
unzip slovo.zip        # gives you ~/Projects/slovo
cd slovo/server
cp .env.example .env
openssl rand -hex 24   # copy this; it's your API_TOKEN
```

Edit `.env` and fill in three things:

```
TELEGRAM_BOT_TOKEN=<from BotFather>
API_TOKEN=<the openssl output>
OLLAMA_MODEL=<a model from `ollama list`>
```

Then:

```bash
./run.sh
```

First run fetches dependencies and compiles, then you should see `Slovo API on http://127.0.0.1:4747`.
Check it with `curl localhost:4747/health` (prints `ok`).

### 3. Lock the bot to you

Message your bot anything. It replies with your Telegram ID. Put it in `.env`:

```
ALLOWED_TELEGRAM_IDS=123456789
```

Stop the server (Ctrl-C twice) and run `./run.sh` again. From now on the bot ignores
everyone else.

### 4. Load the extension

1. Open `chrome://extensions` (Brave: `brave://extensions`, Edge: `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `~/Projects/slovo/extension`.
4. Pin Slovo, click its icon, open **Connection**, paste your `API_TOKEN`, click **Save connection**.

The popup should say "0 words known, synced just now".

### 5. Try it

Send the bot: `what's da`. You get a card:

```
🇷🇺 да  (da)
= yes
Particle used to agree or confirm.
[✅ Add] [Skip]
```

Tap **Add**, then open any page with the word "yes" in it. It now reads "да".

---

## Using the bot

| You send | What happens |
|---|---|
| `what's spasibo` / `what does дом mean` | Card with Add / Skip |
| `how do you say dog` | Card with Add / Skip |
| `add sobaka` or `/add sobaka` | Saved immediately, card with Undo |
| a voice note | Transcribed, then handled like text (needs step below) |
| `/list` | Your 15 newest words and the total |
| `/remove да` | Stops replacing that word |

Phonetic spelling is fine; the model works out the real word. Mandarin works the same way
("what's xie xie"); switch the extension's language to Mandarin to see those words instead.

Swapped words are always shown in dictionary form, so "houses" becomes "дом", not "дома".
That's deliberate: you're learning to recognize the word, not the grammar, yet.

---

## Optional extras

### Voice notes

Telegram sends bots the raw audio, not a transcript, so the server needs a speech-to-text
endpoint. Without one, typing works, and so does your phone keyboard's mic button
(that sends a normal text message).

To run Whisper locally on hacktuah (needs `cmake`, `git` and `ffmpeg` from your package manager):

```bash
cd ~/Projects
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
mkdir -p ~/.config/systemd/user
cp ~/Projects/slovo/server/slovo.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now slovo
loginctl enable-linger "$USER"
journalctl --user -u slovo -f      # logs
```

If you installed Elixir with asdf or mise, uncomment the `Environment=PATH=` line in
`slovo.service` first; systemd doesn't load your shell's PATH.

### Browse on another machine

The server only listens on localhost by default. To use the extension on a laptop, set
`BIND` in `.env` to hacktuah's Tailscale IP (or `0.0.0.0` on a trusted network), restart,
and put `http://<that-ip>:4747` in the extension's Server address.

### Firefox

Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and pick
`extension/manifest.json`. Then in `about:addons`, open Slovo's Permissions tab and allow
access to all websites. Temporary add-ons are removed when Firefox restarts.

---

## Troubleshooting

- **Popup says it can't reach the server**: is `./run.sh` running? Does the address in
  Connection match `PORT`/`BIND`?
- **"The server rejected that API token"**: the token in the popup must match `API_TOKEN` exactly.
- **The bot doesn't answer at all**: check the server log. A `409` means another copy is
  already polling with the same token; stop it.
- **First reply is slow**: Ollama is loading the model into memory. Later replies are fast
  until it unloads after a few idle minutes.
- **A site acts strangely**: some apps don't like their text being rewritten. Use
  "Pause on this site" in the popup.
- **Start over**: stop the server and delete `~/.local/share/slovo/slovo.db`.

## Layout

```
server/
  lib/slovo/bot.ex          Telegram long polling, commands, Add/Skip buttons
  lib/slovo/llm.ex          Ollama prompt that turns a message into word entries
  lib/slovo/transcriber.ex  voice note → text
  lib/slovo/router.ex       GET /api/words?lang=ru (Bearer token), GET /health
  lib/slovo/words.ex        database functions
extension/
  background.js             syncs words from the server into extension storage
  content.js                swaps words on the page, watches for new content
  popup.html / popup.js     language, on/off, per-site pause, connection
```
