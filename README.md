# Slovo

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
[openrouter.ai/keys](https://openrouter.ai/keys). Slovo uses free models by default, so it
costs nothing. Free models allow about 50 requests a day; adding $10 of credit once raises
that to 1000 a day and the free models stay free.

### 2. Start the server

You need Elixir 1.15+.

```bash
cd server
cp .env.example .env
openssl rand -hex 24   # copy this; it's your API_TOKEN
```

Edit `.env` and fill in two things:

```
API_TOKEN=<the openssl output>
LLM_API_KEY=<your OpenRouter key>
```

Then:

```bash
./run.sh
```

First run fetches dependencies and compiles, then you should see `Slovo API on http://127.0.0.1:4747`.
Check it with `curl localhost:4747/health` (prints `ok`).

### 3. Load the extension

1. Open `chrome://extensions` (Brave: `brave://extensions`, Edge: `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin Slovo, click its icon, open **Connection**, paste your `API_TOKEN`, click **Save connection**.

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
don't name a language and a word is ambiguous, Slovo assumes the one you've been adding lately.

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

1. In Telegram, open a chat with **@BotFather** and send `/newbot`. Pick a name and a
   username ending in `bot`, and copy the token.
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

That installs a systemd user service that starts at boot and restarts on failure. Run it from
the shell where `mix` works; it copies that shell's PATH, so asdf and mise installs are fine.
Logs: `journalctl --user -u slovo -f`. After editing `.env`: `systemctl --user restart slovo`.

### A different model

`LLM_URL` takes any OpenAI-compatible API. `LLM_MODEL` is a comma-separated list; on
OpenRouter the later ones are fallbacks when the first is busy. For a local Ollama:

```
LLM_URL=http://localhost:11434/v1
LLM_MODEL=<a model from `ollama list`>
LLM_API_KEY=
```

### Browse on another machine

The server only listens on localhost by default. To use the extension on a laptop, set
`BIND` in `.env` to the server's Tailscale IP (or `0.0.0.0` on a trusted network), restart,
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
- **"the API key was rejected"**: check `LLM_API_KEY` in `.env`, then restart.
- **"the free model is rate limited"**: free models allow 20 requests a minute and
  50 a day. Wait a minute, or add $10 of OpenRouter credit for 1000 a day.
- **Wrong language picked**: say which, e.g. `da in serbian`, and undo the wrong one.
- **The bot doesn't answer at all**: check the server log. A `409` means another copy is
  already polling with the same token; stop it.
- **A site acts strangely**: some apps don't like their text being rewritten. Use
  "Pause on this site" in the popup.
- **Start over**: stop the server and delete `~/.local/share/slovo/slovo.db`.

## API

All `/api` routes need `Authorization: Bearer <API_TOKEN>`.

| Route | Does |
|---|---|
| `GET /api/words` | Active words in every language; `?lang=ru,ar` for some |
| `POST /api/words` `{"text": "shukran"}` | Works out the word(s) and saves them |
| `DELETE /api/words/:id` | Removes a word |
| `GET /health` | `ok`, no token needed |

## Layout

```
server/
  lib/slovo/llm.ex          prompt that turns a message into word entries (any language)
  lib/slovo/router.ex       the API above
  lib/slovo/bot.ex          Telegram long polling, commands, Add/Skip buttons
  lib/slovo/transcriber.ex  voice note → text
  lib/slovo/words.ex        database functions
  install-service.sh        systemd user service
extension/
  background.js             syncs words from the server, relays adds from the popup
  content.js                swaps words on the page, watches for new content
  popup.html / popup.js     add a word, choose languages, on/off, per-site pause, connection
```
