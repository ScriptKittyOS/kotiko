---
title: Your Telegram bot
description: Add words from your phone through your own Telegram bot, by text or by voice.
---

Each server has its own bot, which you create; there is no shared Kotiko bot.

## Create the bot

1. In Telegram, open a chat with **@BotFather** and send `/newbot`. Pick a name (Kotiko, say)
   and a username ending in `bot` (like `yourname_kotiko_bot`), and copy the token.
2. Put it in `server/.env` as `TELEGRAM_BOT_TOKEN=` and restart the server.
3. Message your bot anything. It replies with your Telegram ID. Put it in `.env` as
   `ALLOWED_TELEGRAM_IDS=123456789` and restart. From then on the bot ignores everyone else.

## Using it

Send a word or a question, the same things the toolbar popup understands: `shukran`,
`how do you say dog in japanese`, `da in serbian`. `what does дом mean` shows a card with
**Add** and **Skip**.

| Command | What it does |
|---|---|
| `add sobaka` or `/add sobaka` | Saved at once, with a card to undo it |
| `/list` | Your 15 newest words and the total |
| `/list arabic` | The newest words in one language |
| `/languages` | How many words you have in each language |
| `/remove да` | Stops swapping that word |
| `/bases es en` | The languages meanings are in, the one you read most first (Kotiko sets them too) |
| `/language es` | The language the bot writes in; `/language auto` follows your Telegram app |

The bot gives meanings in the languages you read: the ones you chose in Kotiko, which it sends
to your connected server, or else your Telegram app's language.

## Voice notes

Telegram sends bots the recording, not a transcript, so the server needs a speech-to-text
service. Without one, typing works, and so does your phone keyboard's microphone button.

To run Whisper on your own computer (needs `cmake`, `git` and `ffmpeg`):

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

and restart. Any OpenAI-compatible `/v1/audio/transcriptions` address works too; set
`TRANSCRIBE_API_KEY` and `TRANSCRIBE_MODEL` for those.

Messages to the bot pass through Telegram, under [Telegram's privacy policy](https://telegram.org/privacy).
