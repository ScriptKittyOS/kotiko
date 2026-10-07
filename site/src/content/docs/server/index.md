---
title: Your own Kotiko server
description: Why you might run a Kotiko server, and how to start one.
---

You don't need a server: Kotiko keeps your words in your browser and looks them up with your
own AI key. A server is for people who want more:

- **A Telegram bot** of your own, to add words from your phone, by text or voice;
- **one place for your words**, shared by every browser you connect;
- **lookups without a key in the browser**: the server holds the AI key.

The server is small: Elixir and SQLite, running on your own computer or a machine at home. You
run it, so you decide what it keeps. There is no shared Kotiko server and no account.

A Docker image is planned. Today the server runs from the source code.

## Start the server

You need [Elixir](https://elixir-lang.org/install.html) 1.15 or newer, and the source code:

```bash
git clone https://github.com/ScriptKittyOS/kotiko.git
cd kotiko/server
cp .env.example .env && chmod 600 .env
```

Edit `.env` and fill in the key for word lookups, for example a free
[OpenRouter key](/providers/openrouter/#get-a-key):

```
LLM_API_KEY=<your OpenRouter key>
```

Then start it:

```bash
./run.sh
```

The first run fetches dependencies and compiles, then prints a short summary: version, data
folder, who can reach the server, model and Telegram. Check it with
`curl localhost:4747/health`, which prints `{"ok":true,...}` with the version. A mistake in
`.env` stops the server with a message naming each setting to fix.

The first start also makes an **access key** (the API token), saves it in the data folder and
prints it. `mix kotiko.token` (in `server/`) prints it again, with a pairing string. To choose
your own, set `API_TOKEN` in `.env` (at least 24 characters, for example from
`openssl rand -hex 24`).

Only your account can read what the server keeps in the data folder: your words, their
backups and the access key. If something there is readable by others, the server makes it
private at start, or tells you the command that does. See
[files in the data folder](/server/configuration/#files-in-the-data-folder).

Your keys don't have to be in `.env`: each one can live in its own file, with
`LLM_API_KEY_FILE=/path/to/file` instead of `LLM_API_KEY=...` (and the same for the other
keys). Replacing a key is then replacing its file and restarting. See
[secrets in files](/server/configuration/#secrets-in-files).

## Connect Kotiko to it

1. In Kotiko, open **Settings**, then **Your Kotiko server**.
2. Enter the server address, `http://127.0.0.1:4747` on the same computer. (Kotiko uses
   127.0.0.1 even if you type `localhost`: browsers try `[::1]` first for that name, where
   another account on the computer could be listening.)
3. Paste the access key and select **Save and connect**.

Settings then say "Connected. Your server has 0 words." If your words were in the browser,
**Where your words live** in Settings moves them to the server, counted and confirmed first.

## Next

- [Keep it running](/server/service/) as a service that starts at boot.
- [Set up your Telegram bot](/server/telegram/).
- [Use it from other machines](/server/remote-access/).
- Every setting: the [configuration reference](/server/configuration/). Every route: the
  [API reference](/server/api/).
