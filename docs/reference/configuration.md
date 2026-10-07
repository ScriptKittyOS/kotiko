# Server configuration reference

Last reviewed: 2026-10-06.

Every setting the Kotiko server reads, the files it keeps, and the commands that manage
them. The server is configured only through environment variables; `run.sh` reads them
from `server/.env`. A test (`server/test/kotiko/docs_test.exs`) fails when the server
learns a setting this page doesn't describe.

- [How settings are read](#how-settings-are-read)
- [Settings](#settings): [network](#port), [API token](#api_token), [model](#llm_api_key),
  [Telegram](#telegram_bot_token), [voice notes](#transcribe_url), [data and
  logs](#kotiko_data_dir)
- [Secrets in files](#secrets-in-files)
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
  `TRANSCRIBE_API_KEY`) never repeats its value, whether it came from `.env` or from a
  file.
- **Secrets can live in their own files** instead of `.env`: set `LLM_API_KEY_FILE` to a
  file's path, and so on for each secret. See [Secrets in files](#secrets-in-files).
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
- Allowed: an IPv4 or IPv6 address (`100.101.102.103`, `0.0.0.0`, `::`, `::1`) or a host
  name that resolves to one. `localhost` is always `127.0.0.1`, whatever the hosts file says.
- Browsers look up `localhost` themselves and try the IPv6 address `::1` first. So that no
  other program or account on this computer can listen on the address the browser tries
  and receive the token, the server listens on both loopback addresses: with `127.0.0.1`
  (the default) or `localhost` it also listens on `::1`, with `::1` also on `127.0.0.1`,
  and with `0.0.0.0` also on `::1`. `::` covers IPv4 too (dual-stack). On a computer
  without IPv6 the server starts on `127.0.0.1` alone and logs a line saying so. If another
  program already listens on one of these addresses at `PORT`, the server doesn't start
  (status 1) and says which address; stop that program or choose another `PORT`.
- In the extension, use `http://127.0.0.1:4747` (not `localhost`) for a server on the same
  computer.
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
- Wrong: anything else stops the server ("isn't a web address"), and so does a user name
  or password in the address (`https://user:password@...`).

### `TRUSTED_PROXY_HEADER`

Behind a reverse proxy on this computer (Caddy, nginx, `tailscale serve`, a Cloudflare
tunnel): the header that proxy sets to the address of the client it forwards. The
wrong-token lockout and the proof limit then count each client on its own, so a stranger
who sends wrong tokens locks out only themselves, not your other devices.

- Default: none. Every request a proxy on this computer forwards is then counted together
  under the proxy's address (see [`API_TOKEN`](#api_token)): ten wrong tokens a minute
  from anyone keep everyone who comes through the proxy out, your other devices included.
- Allowed: `x-forwarded-for` (the rightmost address in the header, the one the proxy
  added), `x-real-ip`, `cf-connecting-ip` (its one address), or `forwarded` (the last
  element's `for=`), in any case. Wrong: anything else stops the server.
- It is read only for requests from this computer that carry a forwarding header. The
  address is counted like any other: an IPv6 address by its /64, an IPv4-mapped one as
  IPv4. A request without a usable address in that header (none, two `X-Real-IP` lines,
  `unknown`, an obfuscated name) is counted with the proxy's shared count.
- Set it only when the proxy sets or overwrites that header on every request. Otherwise a
  client can write any address there and gets a new count with each one. Caddy sets
  `X-Forwarded-For`, and nginx appends to it with
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`: either way its rightmost
  address is the client the proxy saw. Behind Cloudflare, use `cf-connecting-ip`, since
  the rightmost `X-Forwarded-For` address is then Cloudflare's.

### `API_TOKEN`

The token that opens the server. A secret. The extension never sends it: it signs each
request with it ([signed requests](http-api.md#signed-requests)); `curl` and other tools
send it as `Authorization: Bearer <token>` (see the [HTTP API](http-api.md#requests)).

- Default: none. Then the server uses the token saved in `<data folder>/api-token`, and on
  the first start makes one there: 32 random bytes from the operating system's secure
  random source, written as 43 URL-safe characters, in a file only you can read (mode 0600).
- Allowed: at least 24 characters. Example: the output of `openssl rand -hex 24`.
- Wrong: a shorter token stops the server (the message gives its length, not its value).
- A token that looks easy to guess gets a warning at every start (never showing the
  token): one with fewer than 10 different characters, one that repeats a shorter piece
  (`passwordpasswordpassword`), or one with under 64 bits by its characters' frequencies
  (its length times the Shannon entropy of the character counts, low when most characters
  are the same). This is a simple check that catches typed tokens, not a guarantee. The
  same check runs on a token you put in `api-token` yourself. Ten wrong tokens or failed
  signatures from one address within a minute lock that address out for the rest of the
  minute ([HTTP API](http-api.md#requests)), except requests from this computer
  (127.0.0.0/8 and `::1`) without a forwarding header, which every local program and web
  page shares, so none of them can lock the extension out;
  [`POST /api/v1/proof`](http-api.md#post-apiv1proof) isn't limited for them either.
  Requests a reverse proxy on this computer forwards (they carry a header such as
  `X-Forwarded-For`, `Forwarded` or `Via`; the [HTTP API](http-api.md#requests) lists them)
  are limited, all together: a stranger's lockout refuses everyone coming through the
  proxy for the rest of that minute, including the extension on your other devices that
  reach the server through it. Only the extension on this computer, which sends no
  forwarding header, is never locked out. Set
  [`TRUSTED_PROXY_HEADER`](#trusted_proxy_header) to count each client behind the proxy
  on its own. A proxy that adds none of the listed headers makes its clients look like
  this computer's own: they are never limited. A token the server made (256 random bits) can't be guessed, so this costs
  nothing; a weak token you chose can be guessed by any program on this computer without
  limit, and the proof lets anyone who can reach the server test guesses offline. Keep
  the generated token.
- To replace the saved token: `mix kotiko.token --rotate`, then restart. With
  `API_TOKEN` set, edit `.env` instead; with [`API_TOKEN_FILE`](#api_token_file), replace
  the file's contents.
- Or from a file: [`API_TOKEN_FILE`](#api_token_file).

### `LLM_API_KEY`

The key for the model API that works out which word you mean. A secret.

- Default: none. With OpenRouter (the default `LLM_URL`), the server starts with a warning
  and adds answer `503 lookup_not_set_up` until you set it. A local model such as Ollama
  needs no key.
- Example: a key from <https://openrouter.ai/keys>.
- Sent only to `LLM_URL`. When `LLM_URL` is a plain `http://` address on another machine
  (not this computer, not a Tailscale address or `*.ts.net` name), the server warns at
  start: anyone on the network in between can read the key.
- Or from a file: [`LLM_API_KEY_FILE`](#llm_api_key_file).

### `LLM_URL`

The model API: any OpenAI-compatible API's base URL.

- Default: `https://openrouter.ai/api/v1`.
- Example: `http://localhost:11434/v1` for a local Ollama.
- Allowed: an `http://` or `https://` address. Wrong: anything else stops the server.
- A user name or password in the address (`https://user:password@host/v1`) stops the
  server too, without showing it: the address is written to the log at start. Put the key
  in [`LLM_API_KEY`](#llm_api_key) (or [`LLM_API_KEY_FILE`](#llm_api_key_file)) instead.
- A query (`?api-version=2024-10-21`, or `?key=...` for a provider that takes its key
  there) is kept on every request, after the path (`/chat/completions?api-version=...`).
  It is never logged: the start-up summary shows the address as `https://host/v1?…`, and
  the query's values are taken out of every log line like the other secrets. A key that
  the provider accepts in a header still belongs in `LLM_API_KEY`.
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
- Or from a file: [`TELEGRAM_BOT_TOKEN_FILE`](#telegram_bot_token_file).

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
- Allowed: an `http://` or `https://` address. Wrong: anything else stops the server, and
  so does a user name or password in the address: put the key in
  [`TRANSCRIBE_API_KEY`](#transcribe_api_key) instead.
- A query is kept on the request and never logged, as for [`LLM_URL`](#llm_url).

### `TRANSCRIBE_MODEL`

The model name sent with each voice note.

- Default: `whisper-1`. Example: `large-v3`.

### `TRANSCRIBE_API_KEY`

Sent as `Authorization: Bearer <key>` to `TRANSCRIBE_URL`, for hosted services. A secret.

- Default: none (a local whisper.cpp server needs none).
- With a plain `http://` `TRANSCRIBE_URL` on another machine (not this computer or
  Tailscale), the server warns at start, as for `LLM_API_KEY`.
- Or from a file: [`TRANSCRIBE_API_KEY_FILE`](#transcribe_api_key_file).

### `KOTIKO_DATA_DIR`

The folder that holds your words and the server's files (see
[Files in the data folder](#files-in-the-data-folder)).

- Default: `$XDG_DATA_HOME/kotiko`, or `~/.local/share/kotiko` when `XDG_DATA_HOME` isn't
  set (or isn't an absolute path, which the XDG Base Directory spec says to ignore). The
  server creates it if it's missing, readable only by you (`0700`).
- Words already in `~/.local/share/kotiko` stay there: while `$XDG_DATA_HOME/kotiko` has no
  `kotiko.db` and `~/.local/share/kotiko` has one, the server keeps using
  `~/.local/share/kotiko`. To move them, stop the server and move the folder.
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
`LOG_LEVEL=debug`). For troubleshooting a model. Without it, even `LOG_LEVEL=debug` logs
no words: not what you typed, not the words the model answered or the server refused
(only the reasons), not the words a database upgrade flags.

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

## Secrets in files

Each secret can be given as the path of a file that holds it, instead of the value itself:
`NAME_FILE=/path/to/file` in place of `NAME=value`. This is the convention Docker secrets
use, and it works with systemd credentials too. Your keys then stay out of `.env`, and
replacing one means replacing its file and restarting the server; nothing is rebuilt and
`.env` doesn't change.

```bash
install -m 600 /dev/null ~/.config/kotiko-llm-key   # an empty file only you can read
$EDITOR ~/.config/kotiko-llm-key                    # paste the key
echo "LLM_API_KEY_FILE=$HOME/.config/kotiko-llm-key" >> server/.env
```

- The file holds only the value. One line ending at its end is dropped; anything else is
  kept as written, so don't add spaces or quotes.
- The value is then checked like one set directly (an `API_TOKEN` of at least 24
  characters, a bot token's shape).
- The server stops with a message (status 78) when both `NAME` and `NAME_FILE` are set, or
  the file is missing, unreadable, not a regular file, empty, longer than one line or over
  64 KiB. The message names the setting and the path, never the contents.
- A file that other users of the computer can read or change gets a warning at start:
  `chmod 600` it.
- The file is read once, when the server starts. A relative path is relative to `server/`.
- `mix kotiko.token` reads `API_TOKEN_FILE` too.

With systemd credentials, for example, a drop-in for the service
(`systemctl --user edit kotiko`) can hand the server a key without it ever being in `.env`:

```ini
[Service]
LoadCredential=llm_api_key:/home/you/.config/kotiko-llm-key
Environment=LLM_API_KEY_FILE=%d/llm_api_key
```

### `API_TOKEN_FILE`

A file holding [`API_TOKEN`](#api_token).

### `LLM_API_KEY_FILE`

A file holding [`LLM_API_KEY`](#llm_api_key). Example: `/run/secrets/llm_api_key` with
Docker secrets.

### `TELEGRAM_BOT_TOKEN_FILE`

A file holding [`TELEGRAM_BOT_TOKEN`](#telegram_bot_token).

### `TRANSCRIBE_API_KEY_FILE`

A file holding [`TRANSCRIBE_API_KEY`](#transcribe_api_key).

## Other variables

These are read by the scripts and for the default folders, not by the server's settings
check.

| Variable | Read by | Meaning |
|---|---|---|
| `XDG_DATA_HOME` | the server, `install-service.sh` | Where the default [data folder](#kotiko_data_dir) goes: `$XDG_DATA_HOME/kotiko`. `install-service.sh` passes the value it sees to the service, so the service and `./run.sh` use the same folder |
| `XDG_CONFIG_HOME` | `install-service.sh` | Where the service file goes: `$XDG_CONFIG_HOME/systemd/user/kotiko.service`; default `~/.config`. A service file already in `~/.config/systemd/user` stays there |
| `MIX_ENV` | `run.sh` | Build environment; default `prod`. Set it in your shell or `.env` |
| `ERL_CRASH_DUMP_SECONDS` | `run.sh` | Default `0`: no crash dump file, because one would hold the server's memory, keys included |
| `INSTALL_WAIT_SECONDS` | `install-service.sh` | How long to wait for `/health` after installing; default 20 |

## Files in the data folder

| File | What it is | Permissions |
|---|---|---|
| `kotiko.db` (with `kotiko.db-wal` and `kotiko.db-shm` while running) | Your words, kept responses for repeated adds (24 hours), cached lookups (30 days), and the background jobs' state. SQLite | `0600`. The server creates it empty and private before SQLite opens it, and SQLite gives `-wal` and `-shm` the database's permissions |
| `api-token` | The generated API token, when `API_TOKEN` isn't set | `0600`, written so no other user can read it at any moment |
| `models-cache.json` | OpenRouter's model list as last read, used when the server starts offline | `0600` |
| `backups/kotiko-pre-<version>-<time>.db` | A copy of the database made before an update changes it; the newest five are kept | Folder `0700`, files `0600` |

Only your account can open these files. At every start, before it reads or writes any of
them, the server checks that nobody else could have put a file there that it would trust
(the token in `api-token` opens the server, and your words are written to `kotiko.db`). It
doesn't start (status 78) and names each problem, with how to fix it, when:

- the data folder, or one of the files above, belongs to another account;
- one of the files above (or `backups/` or a backup in it) is a symbolic link. Kotiko
  never makes links, and a link would send your words, or read a token, wherever it
  points. To keep your words on another disk, point `KOTIKO_DATA_DIR` there instead (the
  data folder itself may be a link);
- other users can write in the data folder and it holds other files too. A folder others
  can write in that holds only Kotiko's files is made `0700` first, with a warning.

The server reads `api-token` the same careful way: never through a link, and only if it
belongs to your account. Then it checks the permissions:

- Any of the files above that other users can open (say, from an install before this
  check) is made `0600` again, and `backups/` `0700`. The server logs one warning that
  names what it changed.
- The data folder is made `0700` when it holds nothing but Kotiko's files. A folder with
  anything else in it may be shared on purpose (`KOTIKO_DATA_DIR=~`, say), so the server
  leaves it as it is and warns at every start, with the command that makes it private
  (`chmod 700 <folder>`). Giving Kotiko a folder of its own stops the warning too.
- A file it can't change gets a warning with the `chmod` that fixes it. The server starts
  either way.

`run.sh` and the systemd service from `install-service.sh` also start the server with
umask `077`, so a file it makes is private from the moment it exists. These are POSIX
permissions (Linux, macOS, WSL). On Windows, keep the data folder on WSL's own disk, not
on a Windows drive such as `/mnt/c`, which doesn't keep them; the server warns if it can't.

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
