# Security requirements

Last reviewed: 2026-10-05.

What Kotiko protects, and what it doesn't, in plain language. Each "You can expect" line is
a claim the [assurance case](assurance-case.md) argues with code and tests. A line appears
here only once the code on `main` does it; work that is planned but not built is listed
separately at the end, with the slice that will build it.

Kotiko has two parts: the browser extension, and an optional server you run yourself
(Elixir and SQLite). "The server" below means your own server, not one run by the project.

## What you can expect

### The server

- **Nothing but `/health` answers without your token.** Every other request, whatever its
  method or however its path is spelled (`/%61pi`, `/API`, `//api`), gets `401` unless it
  carries `Authorization: Bearer <your token>`. `/health` says only the server's name,
  version and whether its database works.
- **A strong token, kept private.** On first start the server makes a random 256-bit token
  and saves it in `api-token` in the data folder, readable only by you (mode 0600). If you
  pick your own with `API_TOKEN`, it must be at least 24 characters, or the server won't
  start.
- **It listens only on your computer** unless you change `BIND`. When you do, it says at
  startup who can now reach it, and warns when your token would cross a network in plain
  HTTP (repeating that warning daily when the address is reachable from the internet).
- **It answers only to names it knows**, so a web page can't reach it by pointing its own
  domain at your computer (DNS rebinding). Unknown names get `421`. You add names with
  `ALLOWED_HOSTS`.
- **Strangers can't make it do work.** Request bodies are read only after the token check,
  and are capped at 64 KB (1 MB for the batch add of up to 500 words).
- **Your words go only where you sent them**: to the model provider you configured, to
  Telegram if you turned the bot on, and, for languages with word stress, the single word
  (never page text) to en.wiktionary.org unless you set `KOTIKO_WIKTIONARY=false`.
- **The Telegram bot obeys only the IDs you list** in `ALLOWED_TELEGRAM_IDS`. Until you set
  it, the bot only tells whoever writes to it their own Telegram ID.
- **Keys and tokens stay out of the logs, at every level.** A log filter removes your
  token, your model and transcription keys, your bot token, and anything shaped like a
  bearer token or an OpenRouter or OpenAI key, before a log line is written.
- **Your words stay out of the logs** at the default level. What you look up and what the
  model answered go to the log only if you set `LOG_LOOKUPS=true`, and then only at debug
  level.
- **A mistake in your settings stops the server** with a message naming each setting to
  fix, instead of starting with a setting it didn't understand. Secret values are never
  echoed in that message.

### The extension

- **Page and word text is never turned into HTML.** The extension builds every element with
  `textContent` and DOM methods; the linter fails the build on `innerHTML` and similar.
- **Web pages can't use the extension to change your words.** Messages are checked by
  sender: content scripts running in web pages may only ask for a sync and for the list of
  sensitive sites (and, on Kotiko's own docs site only, hand over the "Connect OpenRouter"
  sign-in code); adding, editing and deleting words, and setting keys, are allowed only
  from the extension's own pages.
- **Your model key and server token are out of reach of content scripts.** They are kept in
  the extension's own database, which content scripts can't open. An older install that
  kept the token where content scripts could read it is moved on upgrade.
- **Answers are checked before they are used.** Word lists from your server and words from
  a model are validated (types, lengths, languages, counts) before they are saved or shown
  on a page.

### Both

- **No telemetry, analytics or ads.** Neither part reports what you do to the project or
  anyone else. Requests to OpenRouter carry Kotiko's name as the app making them, which
  OpenRouter uses for attribution.
- **Security fixes for the latest minor release**, as [SECURITY.md](../../SECURITY.md)
  says.

## What you can't expect

- **Protection from someone who can read your browser profile or the server's data
  folder.** Keys, the token and your words are not encrypted at rest.
- **That the word database is private to you by default.** The server makes `api-token`
  and its backups readable only by you, but it creates `kotiko.db` with your system's
  default file permissions (your umask), which on many systems lets other accounts on the
  same computer read it. Run the server under your own account on a computer you don't
  share, or tighten the folder yourself (`chmod 700 ~/.local/share/kotiko`).
- **Privacy on a network if you use plain HTTP** to a server on another machine. The token
  and your words travel unencrypted. Use Tailscale or HTTPS through a reverse proxy.
- **Privacy from the model provider you chose.** Lookups go to it under its terms.
- **That pages can't tell Kotiko changed their text.** A page's own scripts can see swapped
  words.
- **Separate accounts on one server.** Everyone with the token has full access to every
  word. Users and per-user tokens are planned in slice 48.
- **A correct answer from the model every time.** Answers are checked for shape and
  plausibility, not verified against a dictionary.
- **Availability.** Kotiko is a personal tool with no uptime guarantees, and the server has
  no rate limit for requests that carry the token.

## Planned, not yet true

These are goals in the plan. They move to "What you can expect" when the slice ships.

- Signed, attested release packages and store-reviewed builds: slice 30 (release
  pipeline). There are no releases yet; today you run Kotiko from source.
- An explicit content security policy for the extension's pages and hardening headers on
  every server response: slices 28 (section 5) and 01 (addition from slice 53).
- A permission review of the extension against the store's rules: slice 28.
- A sandboxed system service (`ProtectSystem`, `ProtectHome`): slice 40.
- The database and data folder created private by default: not yet in any slice's spec;
  recorded in the [assurance case](assurance-case.md) as a residual risk to assign.
- Users and tokens per person on one server: slice 48.
