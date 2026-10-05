# Server configuration reference

Last reviewed: 2026-10-05.

Every setting the Kotiko server reads, the files it keeps, and the commands that manage
them. The server is configured only through environment variables; `run.sh` reads them
from `server/.env`. A test (`server/test/kotiko/docs_test.exs`) fails when the server
learns a setting this page doesn't describe.

- [How settings are read](#how-settings-are-read)
- [Settings](#settings): [network](#port), [API token](#api_token), [model](#llm_api_key),
  [Telegram](#telegram_bot_token), [voice notes](#transcribe_url), [data and
  logs](#kotiko_data_dir)
- [Other variables](#other-variables)
- [Files in the data folder](#files-in-the-data-folder)
- [`mix kotiko.token`](#mix-kotikotoken)

## How settings are read

- Copy the example and keep it private: `cp server/.env.example server/.env && chmod 600
  server/.env`. `run.sh` makes `.env` private itself if other users can read it.
- `run.sh` loads `.env` with the shell (`set -a; . ./.env`), so quote a value that holds
  `$`, spaces or `#` with single quotes: `LLM_API_KEY='abc$def'`. Variables already in the
  environment work too; `.env` wins when both set one.
- Values are trimmed. An empty value counts as not set.
- The server reads settings only when it starts. Restart it after a change
  (`systemctl --user restart kotiko`, or stop `./run.sh` and start it again).
- **When a setting is wrong**, the server doesn't start. It prints one message naming every
  setting to fix and how, and exits with status 78. The systemd unit from
  `install-service.sh` doesn't retry on status 78, so fix `.env` and restart by hand. A
  message about a secret (`API_TOKEN`, `LLM_API_KEY`, `TELEGRAM_BOT_TOKEN`,
  `TRANSCRIBE_API_KEY`) never repeats its value.
- **Warnings** don't stop the server: a missing OpenRouter key, an old setting name, and a
  `KOTIKO_` name the server doesn't know ("did you mean KOTIKO_DATA_DIR?").
- The source of truth is `Kotiko.Config` (`server/lib/kotiko/config.ex`);
  `server/config/runtime.exs` passes these variables to it.

## Settings

### `PORT`

The TCP port the server listens on.

- Default: `4747`. Allowed: a whole number from 1 to 65535.
- Wrong: `PORT=abc` stops the server ("isn't a port number").

### `BIND`

The address the server listens on.

- Default: `127.0.0.1`, this computer only.
- Allowed: an IPv4 or IPv6 address (`100.101.102.103`, `0.0.0.0`, `::1`) or a host name
  that resolves to one (`localhost`).
- Example: your Tailscale address, to use the extension on another computer.
- At start, the server logs who can reach it. For a local network address, `0.0.0.0` or a
  public address, that line is a warning: the server speaks plain HTTP, so anyone on the way
  can read the token. Use Tailscale or put HTTPS in front (README, "Browse on another
  machine"). Tailscale addresses (100.64.0.0/10) get an informational line.
- Wrong: a name that doesn't resolve stops the server.

### `ALLOWED_HOSTS`

Extra host names the server answers to, comma-separated, besides `localhost`, IP addresses
and this computer's own name (and `<name>.local`). Requests for any other name get `421`;
this stops web pages from reaching the server through DNS rebinding.

- Default: none.
- Example: `ALLOWED_HOSTS=laptop.tail1234.ts.net,words.example.com`.
- Names are lowercased and a trailing dot is dropped. Write just the name, without
  `http://` or a port.
- `*` turns the check off; use it only behind a proxy that checks host names itself.
- Wrong: an entry that isn't a host name stops the server.

### `PUBLIC_URL`

The address the extension should use, when it isn't `http://<BIND>:<PORT>` (for example
behind a reverse proxy). Used only in the pairing string from
[`mix kotiko.token`](#mix-kotikotoken).

- Default: none. Allowed: an `http://` or `https://` address; a trailing `/` is dropped.
- Wrong: anything else stops the server ("isn't a web address").

### `API_TOKEN`

The token the extension sends as `Authorization: Bearer <token>` (see the
[HTTP API](http-api.md#requests)). A secret.

- Default: none. Then the server uses the token saved in `<data folder>/api-token`, and on
  the first start makes one there: 32 random bytes from the operating system's secure
  random source, written as 43 URL-safe characters, in a file only you can read (mode 0600).
- Allowed: at least 24 characters. Example: the output of `openssl rand -hex 24`.
- Wrong: a shorter token stops the server (the message gives its length, not its value).
- To replace the saved token: `mix kotiko.token --rotate`, then restart. With
  `API_TOKEN` set, edit `.env` instead.

### `LLM_API_KEY`

The key for the model API that works out which word you mean. A secret.

- Default: none. With OpenRouter (the default `LLM_URL`), the server starts with a warning
  and adds answer `503 lookup_not_set_up` until you set it. A local model such as Ollama
  needs no key.
- Example: a key from <https://openrouter.ai/keys>.
- Sent only to `LLM_URL`.

### `LLM_URL`

The model API: any OpenAI-compatible API's base URL.

- Default: `https://openrouter.ai/api/v1`.
- Example: `http://localhost:11434/v1` for a local Ollama.
- Allowed: an `http://` or `https://` address. Wrong: anything else stops the server.
- Your typed text goes to this address (README, "A different model").

### `LLM_MODEL`

Which models to ask, comma-separated, in order: when one is busy or finds nothing, the next
one gets the word.

- Default: empty. With OpenRouter, the server then reads OpenRouter's list of free models
  once a day and asks the best ones first (`spec/models.json`); until the first read it
  uses the list shipped in `spec/models.json`.
- Example: `LLM_MODEL=llama3.2` for Ollama.
- Wrong: empty while `LLM_URL` isn't OpenRouter stops the server ("Set LLM_MODEL to a model
  it has").

### `TELEGRAM_BOT_TOKEN`

The token of your own Telegram bot, from @BotFather, to add words from your phone. A secret.

- Default: none; the bot is off.
- Allowed: the shape @BotFather gives, digits, a colon, then at least 30 letters, digits,
  `_` or `-`. Wrong: anything else stops the server.
- With a token and no [`ALLOWED_TELEGRAM_IDS`](#allowed_telegram_ids), the bot answers
  every message only with the sender's Telegram ID and how to allow it.

### `ALLOWED_TELEGRAM_IDS`

The Telegram user IDs the bot works for, comma-separated. Everyone else is ignored.

- Default: none (see above).
- Example: `ALLOWED_TELEGRAM_IDS=123456789,987654321`.
- Allowed: whole numbers (a leading `-` is accepted). Wrong: anything else stops the server.

### `TRANSCRIBE_URL`

A speech-to-text endpoint for Telegram voice notes: a local whisper.cpp server
(`http://localhost:8178/inference`) or any OpenAI-compatible
`/v1/audio/transcriptions` URL. The server sends the voice note there as a multipart
upload.

- Default: none; voice notes aren't transcribed (typing still works).
- Allowed: an `http://` or `https://` address. Wrong: anything else stops the server.

### `TRANSCRIBE_MODEL`

The model name sent with each voice note.

- Default: `whisper-1`. Example: `large-v3`.

### `TRANSCRIBE_API_KEY`

Sent as `Authorization: Bearer <key>` to `TRANSCRIBE_URL`, for hosted services. A secret.

- Default: none (a local whisper.cpp server needs none).

### `KOTIKO_DATA_DIR`

The folder that holds your words and the server's files (see
[Files in the data folder](#files-in-the-data-folder)).

- Default: `~/.local/share/kotiko`. The server creates it if it's missing.
- Wrong: a folder the server can't create or write to stops the server.
- The name it had before the rename still works for now, with a warning (see the README's
  section on updating from the old name).

### `LOG_LEVEL`

How much the server logs: `debug`, `info`, `warning` or `error` (`warn` works too).

- Default: `info`. Wrong: anything else stops the server.
- Keys and tokens are kept out of the logs at every level. The words you look up are not
  logged unless [`LOG_LOOKUPS`](#log_lookups) is on.

### `LOG_LOOKUPS`

`true` to log what you look up and the model's answer, at debug level (so also set
`LOG_LEVEL=debug`). For troubleshooting a model.

- Default: `false`. Allowed: `true`, `yes`, `on`, `1`, `false`, `no`, `off`, `0`.
- Wrong: anything else stops the server.

### `KOTIKO_LOG_SQL`

`true` to log every database query at info level. For development only: queries carry your
words.

- Default: `false`. Allowed: as for `LOG_LOOKUPS`.
- The name before the rename still works for now, with a warning.

### `KOTIKO_WIKTIONARY`

Pronunciations from Wiktionary. For a language with word stress, the server reads how a new
word is said from its English Wiktionary page, sending only the word to
`en.wiktionary.org`.

- Default: on. `false` (or `no`, `off`, `0`) sends nothing there and keeps the model's
  pronunciation.
- Wrong: a value that isn't true or false stops the server.

## Other variables

These are read by the scripts, not by the server's settings check.

| Variable | Read by | Meaning |
|---|---|---|
| `MIX_ENV` | `run.sh` | Build environment; default `prod`. Set it in your shell or `.env` |
| `ERL_CRASH_DUMP_SECONDS` | `run.sh` | Default `0`: no crash dump file, because one would hold the server's memory, keys included |
| `INSTALL_WAIT_SECONDS` | `install-service.sh` | How long to wait for `/health` after installing; default 20 |

## Files in the data folder

| File | What it is | Permissions |
|---|---|---|
| `kotiko.db` (with `kotiko.db-wal` and `kotiko.db-shm` while running) | Your words, kept responses for repeated adds (24 hours), cached lookups (30 days), and the background jobs' state. SQLite | Created with your umask: usually readable by other users of the computer unless your umask is `077`. The default folder is inside your home folder. To keep it private: `chmod 700 ~/.local/share/kotiko` |
| `api-token` | The generated API token, when `API_TOKEN` isn't set | `0600`, written so no other user can read it at any moment |
| `models-cache.json` | OpenRouter's model list as last read, used when the server starts offline | Your umask |
| `backups/kotiko-pre-<version>-<time>.db` | A copy of the database made before an update changes it; the newest five are kept | Folder `0700`, files `0600` |

To go back to a backup, see the README, "Updating". To start over, stop the server and
delete `kotiko.db`.

## `mix kotiko.token`

Run in `server/`. Reads the settings the way `run.sh` does (the environment, then `.env`
in the current folder).

```bash
mix kotiko.token                 # print the API token and a pairing string
mix kotiko.token --rotate        # make and save a new token (not when API_TOKEN is set)
mix kotiko.token --env-file PATH # read another .env file
```

The pairing string carries the server address and the token in one value for the
extension's connection screen: `kotiko-pair:1:` followed by base64url-encoded JSON
`{"url": ..., "token": ...}`. Treat it like the token. After `--rotate`, restart the server
and paste the new token or pairing string into the extension.
