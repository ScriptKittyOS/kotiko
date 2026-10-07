# Changelog

All notable changes to Kotiko. From the next release on, this file is generated from
Conventional Commits by release-please.

## Unreleased

- Security: a web page that managed to run code inside Kotiko's page script could change
  Kotiko's settings, because browsers let that script write Kotiko's storage. It could turn
  Kotiko off, pause sites, hide languages, change the words pages show, queue a word to be
  looked up with your own AI key and saved, pick another model, or change the languages
  your server's Telegram bot answers in. Kotiko now keeps the real copy of all of these
  where page scripts can't reach, puts back anything changed elsewhere, and only its own
  pages change settings. Nothing to do on your side; your settings move over on update.
  In Firefox (and Chrome before 140), the languages you read no longer follow from
  Kotiko in your other browsers: set them in each one.

- Connect OpenRouter with one click, without copying a key: "Connect OpenRouter (free)" is
  now the first choice on the welcome page, and Settings, Word lookups has a "Connect
  OpenRouter" button. OpenRouter's sign-in opens in a new tab; when you're done, it sends
  you back to kotiko.org/connect/, Kotiko gets your key, and the page you started from
  says you're connected. Pasting a key still works ("Paste a key instead").

- Self-hosted server: other accounts on the same computer can no longer read your words.
  The database (with the `-wal` and `-shm` files next to it), the model list cache and a
  new data folder are now readable only by you, like the API token and the backups
  already were. At start, the server makes these files private again if an older version
  left them readable, and logs what it changed. It leaves a data folder that also holds
  other files as it is and warns with the command to fix it. `run.sh` and the service
  from `install-service.sh` now start the server with umask `077`; run
  `install-service.sh` again to update the service.

- Self-hosted server: your keys can now live in their own files instead of `.env`. Set
  `LLM_API_KEY_FILE=/path/to/file` in place of `LLM_API_KEY=...`, and the same for
  `API_TOKEN`, `TELEGRAM_BOT_TOKEN` and `TRANSCRIBE_API_KEY`; this is how Docker secrets
  and systemd credentials hand keys to a program. To replace a key, replace its file and
  restart. The server stops with a clear message if both forms are set or the file is
  missing, empty or unreadable, and never prints what's in it. Existing `.env` files work
  as before.

- The server follows the XDG Base Directory rules: with `XDG_DATA_HOME` set, new installs
  keep their words in `$XDG_DATA_HOME/kotiko`, and `install-service.sh` puts the service in
  `$XDG_CONFIG_HOME/systemd/user`. Nothing moves for existing installs: words already in
  `~/.local/share/kotiko` and a service already in `~/.config/systemd/user` stay where
  they are.

- `server/install-service.sh --uninstall` removes the service it installed (stops it,
  turns off its start at boot, deletes `kotiko.service`) and says what it did. Your words
  and `.env` are kept unless you add `--delete-data`, which deletes only the files Kotiko
  made in its data folder.

- New documentation site, ready to publish at kotiko.org: install guides for Chrome, Edge,
  Brave and Firefox (with "coming soon" in place of the store links until the listings are
  live), how to start with or without an AI key, one guide per word lookup service, help
  for every message Kotiko can show, the guide to running your own server, and the privacy
  policy, published from the same file the extension shows so the two can't differ. The
  site sets no cookies, has no analytics and loads nothing from any other site. It also
  has the page OpenRouter returns to after "Connect OpenRouter"; Kotiko reads the sign-in
  code there and nowhere else.
  The README is now a short introduction that points to the site.

- The Telegram bot no longer assumes you read English. It gives meanings in the languages
  you read: the extension now tells your connected server which ones (and Kotiko's
  interface language, if you chose one), and until it does, the bot uses your Telegram
  app's language and says so on the first card. `/bases es en` sets them from Telegram.
  A word you read in two languages gets one card with both meanings, and Add saves both.
  Cards show the pronunciation written for your language, the slow form and where the
  pronunciation came from, like the word card on pages. Everything the bot says now comes
  from the server's message file, ready for translations; `/language` picks the bot's
  language, and it tells you once when yours isn't translated yet. When something breaks,
  the chat gets a short reference to look up in the server log instead of the error's
  text, and buttons carry the word's public id instead of an internal number. New routes:
  `GET` and `PUT /api/v1/profile`.

- Kotiko's pages and word card work with keyboards and screen readers, and respect reduced
  motion. Every control in the popup, the dashboard, the welcome tab and the word card can
  be reached with Tab and shows a focus ring that nothing covers; dialogs keep Tab inside
  and Esc closes them, putting you back where you were; buttons and links are at least
  24 × 24 pixels; and with "reduce motion" on (your system's setting or Kotiko's own) nothing
  slides or grows, the word card included. New in Settings, "Reading": choose what screen
  readers hear on a swapped word (the word you're learning, the original word, or both),
  and "Let me Tab to swapped words". Turning on swaps in buttons and menus now warns that
  voice control commands may stop working. Fixed on the way: the restore preview showed
  the word "null", the "Kotiko is off" state made text too faint to read, and long language
  names on the dashboard's shelf were cut off. `docs/accessibility.md` lists the automated
  checks and the screen-reader pass done before each release.

- Clearer messages that tell you what still works and what to do next. When your server is
  down or you're offline, Kotiko says your words still work on pages. When word lookup is
  busy, out of free lookups or not set up, it says you can add the word yourself. A text too
  long for one word points you to bulk add. The popup, the dashboard and the welcome page
  now word every problem the same way, and "Details" has a "Copy details" button for bug
  reports (it never copies your words). A lookup service that wants payment no longer
  retries for days; it says so once. On the server, error messages come from one file
  (`server/priv/locales/en/messages.json`), ready for translations, and a request body sent
  as something other than JSON gets a clear `415` instead of `500`.

- Kotiko has a privacy policy: Settings → About → Privacy policy, or the link at the bottom
  of the welcome page. It says, in plain words, what stays in your browser (the pages you
  read, always), what leaves it and to whom (the text you type to add a word, to the AI
  service you chose; the word alone to Wiktionary for its pronunciation), and how to
  delete it. A list of everything Kotiko keeps and sends, with the code that does it, is in
  `docs/privacy/inventory.md`.

- Kotiko now sends your words and keys only to the server and AI service you chose in its
  own settings. If a website manages to change those settings behind your back, Kotiko
  sends nothing there and puts your choice back.

- Typing a server address that starts with `http://` and isn't on this computer or a
  Tailscale address now shows a note under the field: your access key would travel
  unencrypted, so use `https://` if others share the network. It still connects.

- Firefox: Kotiko's pages now say they don't want Firefox's default switch from `http://`
  to `https://`, which could stop a Kotiko server at an `http://` address on your home
  network or Tailscale from connecting. Kotiko now needs Firefox 140 or later, and tells
  Firefox it collects no data. The full name in the extensions list is
  "Kotiko: learn languages while you browse".

- Back up your words to a file and restore them, export to a spreadsheet or Anki, and
  delete everything with one button. In Settings, "Your data": a backup file holds every
  word (and your settings, never your keys); restoring one shows what it will add or merge
  first, never duplicates a word or undoes an edit you made since, and can be undone for a
  day. The spreadsheet opens with every script intact, and Kotiko's bulk add reads it
  back. The Anki file gives each language its own deck, and importing a newer one updates
  the same cards. "Delete everything…" clears all Kotiko keeps in this browser (open pages
  get their own words back), and can empty your Kotiko server too. On the server:
  `mix kotiko.export`, `mix kotiko.import` and `mix kotiko.reset`. When your words are only
  in this browser, the popup reminds you to back up once a month.

- Kotiko is ready to ship to the Chrome Web Store and Firefox Add-ons. Each release on
  GitHub carries both store packages, a checksum list, a list of the server's dependencies,
  and a signed record of how each file was built. Anyone can rebuild the packages from the
  release's tag and get the same bytes; docs/verify.md shows how to check a download.

- Turning off Wiktionary pronunciations with `KOTIKO_WIKTIONARY=false` no longer makes the
  server warn at start that the setting is unknown and ignored. It always worked; only
  the warning was wrong.

- Add a whole list at once: paste it into "Add words" in your word list, or drop a .txt,
  .csv, .tsv, .json or Anki text export on it. Lines that already have a meaning are saved
  with no lookup ("gato = cat", "dog - perro", "고양이：猫"), and Kotiko works out which side
  is the word you're learning from the languages you read, not by assuming English. Check
  every row first; words you have are marked, words without a meaning can be looked up,
  and one Undo takes the whole list back. Pasting a list into the popup opens it there.

- Got the wrong language? Click the language on the result and pick another: Kotiko adds
  it again in that language and removes the first. Lookups not working? "Add it yourself"
  saves a word from a small form, with a meaning in each language you read. A language
  chip beside the add box says which language the next word is in, "For pages in" picks
  which of your languages it gets meanings for, a half-typed word survives closing the
  popup, and a saved word has a speak button when your device has a voice for it.

- Adding words is safer. With a Kotiko server, adds now finish even if you close the
  popup, and a retry never saves twice. Re-adding a word you have says "Already in your
  list" with Open; adding forms says "Updated … new forms: …", and its Undo puts the word
  back as it was. Undo now works for words added with your own AI key on a server, where
  it always failed. A pasted sentence asks which words to keep before saving. Offline, an
  add waits and finishes when you're back online.

- Each word on a page now shows one of your languages, the same everywhere on that page,
  and stays put while you read; another page or another day may pick a different one.
  New words show up first for a week. Focus on a language from the popup (a language you
  add meanwhile waits until you stop), give one language more or less weight, put them in
  an order, or turn on "Mix within the page" for the old rotation (Settings, Your
  languages on a page). A word that is the page's own ("no" for "no") is no longer
  swapped.

- Swapped words now follow each language's own capitals: no more "Lunes" for Monday
  mid-sentence, and English "Monday" and "I" keep their capitals on a Spanish page. Turkish
  gets its dotted İ, Greek capitals drop their accents, and Georgian always stays in its
  everyday letters. Swapped Chinese, Japanese, Hindi, Thai or Burmese words no longer
  change a paragraph's line spacing.

- Kotiko leaves alone what isn't an ordinary word: acronyms (the IT team), names (Will
  Smith, Sr. Rosa), dates and codes (May 2026, Plan B), code editors, and login and payment
  forms. Banks, payment, health, government and tax sites, and email you're writing, are
  left alone by default (Settings, Pages), with "Swap words here anyway" in the popup. A
  word's card has "Don't swap this word". An English quote on a page in another language
  is now swapped.

- Kotiko no longer interferes with web apps built with React, Vue and the like: it changes
  words without taking the page's own text away from it. It keeps working after a site
  navigates without reloading, swaps new posts in a feed before you see them, stops if a
  page keeps undoing its changes (the popup says so), no longer freezes very large pages,
  and starts on tabs that were already open when you install or update it. Adding a word
  only changes the text that has it.

- Pronunciations are now right. For languages with word stress, Kotiko takes how a word is
  said from Wiktionary instead of trusting the AI, which got Russian stress wrong on about a
  quarter of everyday words (это is EH-ta, not eh-TO). Words you already saved are checked
  once in the background, and the word card says "Checked in Wiktionary". Only the word is
  sent to Wiktionary, never the page you're reading. A pronunciation you typed yourself is
  never changed.

- You can now add little words like "it", "the" or "el" by typing the word in the language
  you're learning: "оно" or "это" for "it", "der" for "el". Before, Kotiko threw the answer
  away unless you also typed the English (or Spanish) word.

- Kotiko now reads pages in the languages you read, whatever they are, including
  languages written without spaces like Japanese, Chinese and Thai. It swaps words only
  on pages (and parts of pages) in one of your languages and leaves the rest alone; the
  popup says when a page is in a language you don't read. Contractions like "can't",
  hyphenated words, accented words, web addresses and French "l'eau" stay intact, phrases
  like "thank you" and "por favor" swap as one, and large word lists no longer slow pages
  down (a 10,000-word list on a long article went from about 7 seconds to under a tenth
  of one).

- Choose the languages you read in from the dashboard: Settings, Languages you read in.
  Add any language your browser can read, drag them into order (the first is your main
  one), or remove one; its meanings are kept and simply stop swapping. Each language says
  how well Kotiko knows it, and how many of your words have no meaning in it yet, with a
  link to type them. Updating from an older version keeps your words swapping: Kotiko adds
  the languages your words already use to the ones your browser lists.

- Kotiko now works without a server. Your words live in your browser and Kotiko looks new
  words up with your own free OpenRouter key, or any provider you like (OpenAI, Anthropic,
  Google Gemini, Groq, Ollama, LM Studio or another address), set up in the dashboard's
  Settings, Word lookups. Or type a word with its meaning, like "gato = cat", with no AI
  at all. Adds never wait: they finish with the popup closed, and wait for busy or used-up
  free lookups instead of failing. Your key and your server's access key are kept where web
  pages can't read them. Already running a Kotiko server? Nothing changes; you can keep
  using it, or move your words into the browser from Settings, Your Kotiko server. Back up
  regularly: uninstalling an extension deletes its data.

- Adding a word now answers within 25 seconds, uses at most 3 requests, and remembers
  words it already looked up for 30 days. Kotiko follows OpenRouter's current free models
  automatically (best first, from our evaluation) and shows how many free lookups you have
  left today. When lookups stop working, the popup says why in plain words (busy, used up
  until a given time, or a key problem) instead of "the language model failed". The words
  you look up no longer appear in the server's log. The server adds a table for the lookup
  cache, so it backs up your database once more on first start.

- **Slovo is now Kotiko.** Your words move automatically from `~/.local/share/slovo` to
  `~/.local/share/kotiko` on first start; the old file is kept as a backup. The service is
  now called `kotiko` (`install-service.sh` replaces the old one). Rename `SLOVO_DATA_DIR`
  to `KOTIKO_DATA_DIR` in `.env` if you set it (and `SLOVO_LOG_SQL` to `KOTIKO_LOG_SQL`);
  the old names still work for now, with a warning. Stop the old server before the first
  start; keep the extension's folder where it is and reload it. See "Updating from Slovo"
  in the README.
- Buttons, toggles, menus, tabs and forms keep the site's own words, including clickable
  labels built from plain `div`s. A lone capital next to a code or numeral ("AOI I",
  "World War I", "I-95") is no longer swapped as the word "I".

- Language names now come from the language code, so Cantonese is always Cantonese. Words
  saved under old codes such as cmn or iw were merged into their languages; the server
  backs up your database before it does this.
- Kotiko now checks every word the model suggests: it won't swap unrelated words like
  "what" for как, never adds more than 5 words at once, and explains anything it rejects.
  Ask in your own language, and meanings come back in the languages you read. Every new
  word comes with how to say it, written for readers of your language, with the stressed
  syllable in capitals.

## [1.0.0](https://github.com/ScriptKittyOS/kotiko/compare/v0.2.0...v1.0.0) (2026-10-07)


### ⚠ BREAKING CHANGES

* **server:** the words table is rebuilt; downgrading needs the automatic backup.
* the data folder, service name, environment variables (KOTIKO_DATA_DIR, KOTIKO_LOG_SQL) and pairing prefix are renamed; see the README's 'Updating from Slovo'.
* **server:** /health returns JSON instead of "ok" (still 200 when healthy, 503 when the database fails), and run.sh runs in prod unless MIX_ENV is set.
* **server:** deny by default so encoded paths can't skip the token

### Features

* a sturdier AI client that protects your free quota ([b5a2d56](https://github.com/ScriptKittyOS/kotiko/commit/b5a2d56a3cbf21d4c14e9ee56a66891d230c4e05))
* a sturdier AI client that protects your free quota (slice 10) ([a23108c](https://github.com/ScriptKittyOS/kotiko/commit/a23108c782a16bdca61b148e5f1128a54c9ebb85))
* accessibility baseline, audited with axe and kept by CI (slice 27) ([4acaade](https://github.com/ScriptKittyOS/kotiko/commit/4acaade9293d4429ad10a80c43aa0b5e3ff78b8c))
* accessibility baseline, audited with axe and kept by CI (slice 27) ([59af37e](https://github.com/ScriptKittyOS/kotiko/commit/59af37e7c25b05de875809f03ae54fd3e82c5603))
* **brand:** Mira logo, a black kitten head on purple ([5d4e8d6](https://github.com/ScriptKittyOS/kotiko/commit/5d4e8d631ee59e672eb8669004f3f4bb080fa6ff))
* **brand:** new kitten logo and placeholder illustrations ([b379c90](https://github.com/ScriptKittyOS/kotiko/commit/b379c90ac7cc76ef62ca5b1023f00cd8e9cf63fd))
* **brand:** use the maintainer's kitten logo everywhere ([4325812](https://github.com/ScriptKittyOS/kotiko/commit/432581263a714414eb167c16a5acf8174fa3c6dc))
* canonical language tags, shared word spec and the real prompt ([35d0685](https://github.com/ScriptKittyOS/kotiko/commit/35d06858396cc95f62e41cf96861691f0c62c772))
* **extension:** back up, restore, export and delete everything (slice 12) ([b25a852](https://github.com/ScriptKittyOS/kotiko/commit/b25a8528e7bb186202b3d9147e0241106487c4d1))
* **extension:** back up, restore, export and delete everything (slice 12) ([c5144de](https://github.com/ScriptKittyOS/kotiko/commit/c5144de12025e668a0b20393976c0b74bfac9c0f))
* **extension:** bulk add, paste a list or drop a file (slice 13) ([e404a18](https://github.com/ScriptKittyOS/kotiko/commit/e404a18bb5e0a39c80803b2785f32bc68c314e8b))
* **extension:** choose the languages you read in (slice 50) ([d7314d9](https://github.com/ScriptKittyOS/kotiko/commit/d7314d9e42b9088c02718ed39685fc19d5d1bfa9))
* **extension:** choose the languages you read in (slice 50) ([4f1361c](https://github.com/ScriptKittyOS/kotiko/commit/4f1361c6e2349503daa029fdc306b97414e9d638))
* **extension:** Connect OpenRouter, store screenshots over a real page, privacy policy v2 ([ffc185a](https://github.com/ScriptKittyOS/kotiko/commit/ffc185a1519b1d2837ee9c7a98f38b98c62ee33a))
* **extension:** design system and redesigned popup ([0393dec](https://github.com/ScriptKittyOS/kotiko/commit/0393dec064de4403becfe36d7d0541eed6950230))
* **extension:** design system and redesigned popup (slices 06 and 20) ([7570d7e](https://github.com/ScriptKittyOS/kotiko/commit/7570d7e040b09b5a6212bb5c5afe2bbca401d47c))
* **extension:** every add is a safe background job; results, Undo, choosing (slice 24 §§1-5) ([d38c2fd](https://github.com/ScriptKittyOS/kotiko/commit/d38c2fdcbf400453150f9273edf8bf585214801f))
* **extension:** language controls for adds; popup loads only its first view (slice 24 §§6-9) ([4e7517a](https://github.com/ScriptKittyOS/kotiko/commit/4e7517a1b01dc8d3c47f93f777ed200d417952b6))
* **extension:** leave names, acronyms and code alone (slice 16 §§1-3) ([6d562c7](https://github.com/ScriptKittyOS/kotiko/commit/6d562c7fa1177dbc1a7b767dda74b209ec6ae3a1))
* **extension:** local-first mode, no server needed ([59ac833](https://github.com/ScriptKittyOS/kotiko/commit/59ac83365194729f274c4025165f9011a7373ca6))
* **extension:** local-first mode, no server needed (slice 11) ([6639c87](https://github.com/ScriptKittyOS/kotiko/commit/6639c87d8386e39f7fb8e5697bf803b44a51329c))
* **extension:** one language per word per page; Focus, weights, order, mix (slice 18) ([92e7a07](https://github.com/ScriptKittyOS/kotiko/commit/92e7a073e6c1a9f77d9475d485ce62da23c5bcb1))
* **extension:** privacy policy, store forms and secrets bound to their address (slice 28) ([3f7a426](https://github.com/ScriptKittyOS/kotiko/commit/3f7a426b64f6f755c562e9f077b53444396231a4))
* **extension:** privacy policy, store forms, and requests only to addresses you chose (slice 28) ([79d0809](https://github.com/ScriptKittyOS/kotiko/commit/79d08093b3c9743896a810cc0bda5040a2e0e964))
* **extension:** read the OpenRouter sign-in code on kotiko.org/connect/ ([ebab977](https://github.com/ScriptKittyOS/kotiko/commit/ebab9775b565bd4569b7a0c5cbd349acd87aa05b))
* **extension:** sensitive sites, button and menu setting, never-swap list (slice 16 §§4-5) ([04ea3da](https://github.com/ScriptKittyOS/kotiko/commit/04ea3da25a22df6ab8ef28f44b8aaf832c18e758))
* **extension:** show Connect OpenRouter on the welcome tab and in settings ([3f56738](https://github.com/ScriptKittyOS/kotiko/commit/3f567387a357f3f4ef893feab0c73951f3f3fe8e))
* **extension:** swap words without taking the page's text away (slice 15) ([0e984b2](https://github.com/ScriptKittyOS/kotiko/commit/0e984b2cc587f79a3102f4cced69cdadf4d5dbfa))
* **extension:** swap words without taking the page's text away (slice 15) ([3a7800c](https://github.com/ScriptKittyOS/kotiko/commit/3a7800c2051b89c1413f4c3f92030f4fbb3bf134))
* **extension:** swapped words in their own language's capitals (slice 17) ([61fdc53](https://github.com/ScriptKittyOS/kotiko/commit/61fdc53e15f4ecf7d5f169219c126d5fb9460fa9))
* **extension:** the dashboard, a live view of every word ([87e3c79](https://github.com/ScriptKittyOS/kotiko/commit/87e3c790125111bdde9863d74659e5f62c6c8969))
* **extension:** the dashboard, a live view of every word (slice 21) ([b867a92](https://github.com/ScriptKittyOS/kotiko/commit/b867a92eb175f603d94aa08a7db2a38f4e68702a))
* **extension:** the welcome flow, your first word celebrated (slice 22) ([72547e2](https://github.com/ScriptKittyOS/kotiko/commit/72547e25756a3d5abd4758a7374da1e58a365725))
* **extension:** the welcome flow, your first word, celebrated ([8d871a2](https://github.com/ScriptKittyOS/kotiko/commit/8d871a268a7c6e0f5b150393256d2932c4608c76))
* **extension:** word popover with pronunciation and audio ([8263611](https://github.com/ScriptKittyOS/kotiko/commit/8263611a9525665fde377b9aed3e590260aa7039))
* **extension:** word popover with pronunciation and audio (slices 19, 34) ([ab5b4d0](https://github.com/ScriptKittyOS/kotiko/commit/ab5b4d08e1560a66008b831fee09f134adefef81))
* **extension:** words found in any language you read (slices 14, 16, 50) ([4c8a46b](https://github.com/ScriptKittyOS/kotiko/commit/4c8a46b2c2f4009a64228b19b6a0a045a9a177c9))
* **extension:** words found in any language you read (slices 14, 16, 50) ([429579d](https://github.com/ScriptKittyOS/kotiko/commit/429579d731b621e52e15d8cf040415757c171c64))
* language tags, shared word spec and the real prompt (slices 08, 09) ([605162f](https://github.com/ScriptKittyOS/kotiko/commit/605162f029b25e53d857dd66fab39dd79391d840))
* plain-language errors from one catalog (slice 25) ([d60ac55](https://github.com/ScriptKittyOS/kotiko/commit/d60ac55e99dbfef56cb9775f2e965ca1247cf525))
* plain-language errors from one catalog (slice 25) ([85940b5](https://github.com/ScriptKittyOS/kotiko/commit/85940b5998f128b214a838a0371a2ab0b295fe25))
* pronunciations from Wiktionary, written by rule (slice 49 §4b) ([19551c5](https://github.com/ScriptKittyOS/kotiko/commit/19551c517fa1eeef76a2fdd727c972db83928fd7))
* pronunciations from Wiktionary, written by rule (slice 49 §4b) ([c6829bc](https://github.com/ScriptKittyOS/kotiko/commit/c6829bc1db9523baba82dfd9c9114c9d87e310d8))
* **server:** harden API auth and add the server test suite ([07d5ec9](https://github.com/ScriptKittyOS/kotiko/commit/07d5ec929d5823899b20af17bfa25432a97dd263))
* **server:** secrets from files, XDG folders and an uninstall ([83ce39a](https://github.com/ScriptKittyOS/kotiko/commit/83ce39ad2a6c0d8ff2c88cab5b67ed58324245ff))
* **server:** secrets from files, XDG folders and an uninstall ([4afdf6b](https://github.com/ScriptKittyOS/kotiko/commit/4afdf6b492accfad3baa1bf47343085f26fff799))
* **server:** the Telegram bot speaks the learner's language ([622d156](https://github.com/ScriptKittyOS/kotiko/commit/622d1568fbca0fb804d96e8c2b2d998e79040b7b))
* **server:** the Telegram bot speaks the learner's language (slice 41 §9) ([5e7832a](https://github.com/ScriptKittyOS/kotiko/commit/5e7832aaec9ac95e89448e72cd10270ca6fd2713))
* **server:** validated config, safe boot, redacted logs and JSON health ([265ebb6](https://github.com/ScriptKittyOS/kotiko/commit/265ebb6a1d7e99da404a6b67de6c807260de643c))
* **server:** word model v2 with stable ids, safe merges and undo ([102ca7e](https://github.com/ScriptKittyOS/kotiko/commit/102ca7e869fe3b44ccd172aca5ebe721638541e5))
* **site:** the docs site for kotiko.org and a public-ready README (slice 44) ([320c948](https://github.com/ScriptKittyOS/kotiko/commit/320c9485ace2a60f9a0a226cf47e4d9b8ac30df3))
* **site:** the docs site for kotiko.org, and a README that points to it ([97e2943](https://github.com/ScriptKittyOS/kotiko/commit/97e294303ba5cddf460afd0376907239481ac889))
* **site:** the OpenSSF Best Practices badge in the footer ([5d3bbcd](https://github.com/ScriptKittyOS/kotiko/commit/5d3bbcd478e77fdeade579dc10898c2576a58740))
* **site:** the OpenSSF Best Practices badge in the footer ([3f04e66](https://github.com/ScriptKittyOS/kotiko/commit/3f04e6611551681fe084cacb1a3b06b3d5e99335))


### Bug fixes

* **extension:** an add refused for a rewritten address retries by itself ([b1c3470](https://github.com/ScriptKittyOS/kotiko/commit/b1c3470869e8c394eae64273c3a85087f26ec8c1))
* **extension:** benchmark uses casing.js; make casing about 10 times faster ([287f70e](https://github.com/ScriptKittyOS/kotiko/commit/287f70e6a5efef8181ad6516dbe647be7cd13d56))
* **extension:** bind where requests go, not only the secrets (slice 28) ([b855ac3](https://github.com/ScriptKittyOS/kotiko/commit/b855ac3e83439c3734ce06062e869dd3a72a2973))
* **extension:** content scripts can't change settings or queue adds (SCR-448) ([471ee18](https://github.com/ScriptKittyOS/kotiko/commit/471ee18c4d6e25efad48e2315d2a3c67125fe4be))
* **extension:** content scripts can't change settings or queue adds (SCR-448) ([a164d23](https://github.com/ScriptKittyOS/kotiko/commit/a164d23494a473d09fd8e0ddc563d7f69cb91a5f))
* **extension:** engine slices stay bounded on big pages; steadier tests ([2bde8c8](https://github.com/ScriptKittyOS/kotiko/commit/2bde8c80dabb654a90a2181fa4b55427213f84ca))
* **extension:** never swap inside controls or numeral-like capitals ([3b3fee4](https://github.com/ScriptKittyOS/kotiko/commit/3b3fee491f51ed88658c20440de33b6aa218b482))
* **extension:** never swap inside controls or numeral-like capitals ([c40fc88](https://github.com/ScriptKittyOS/kotiko/commit/c40fc8826d586504060be4fd9f515bf98eda0d55))
* **extension:** open the languages you read in at #settings/languages ([95d1a6d](https://github.com/ScriptKittyOS/kotiko/commit/95d1a6d00ce7a43b89d45f07aea1e4431a06ec03))
* **extension:** sync that never shows stale results or errors ([5293305](https://github.com/ScriptKittyOS/kotiko/commit/52933053cdbffda0ebca2e65569faa120364755a))
* keep a function-word meaning when the learner typed the word ([6aae1f0](https://github.com/ScriptKittyOS/kotiko/commit/6aae1f099623db512102da6a6e98d9c57f509408))
* keep a function-word meaning when the learner typed the word ([ea7603f](https://github.com/ScriptKittyOS/kotiko/commit/ea7603f9146d77263403b3a172ea6ec3bfa4ecf8))
* **merge:** the same gloss on a re-add is not a new form ([519b8f6](https://github.com/ScriptKittyOS/kotiko/commit/519b8f6fd7dee0c99ba009d1e57ab65b3bfcf32f))
* **release:** store screenshots show the popup over a real article ([6fb7cf9](https://github.com/ScriptKittyOS/kotiko/commit/6fb7cf9c0b060d499215b89ce7a96fbba23a9660))
* **scripts:** read the live entry from a fixed id, not one taken from the document ([1d21b42](https://github.com/ScriptKittyOS/kotiko/commit/1d21b4217b0edf6e70a41fa93f8b0bb2b16fccb9))
* **scripts:** the badge page lists only what differs from the live entry ([6a708c9](https://github.com/ScriptKittyOS/kotiko/commit/6a708c95f0569ad951c55252484575c697579cda))
* **server:** a repeated query parameter is a 400, not a 500 ([eba1343](https://github.com/ScriptKittyOS/kotiko/commit/eba134380bbe07cddadf42f4147d5958a6a2e114))
* **server:** deny by default so encoded paths can't skip the token ([2693809](https://github.com/ScriptKittyOS/kotiko/commit/2693809fbf39486804629938968374f9f21e62e1))
* **server:** fall back across free models and stop losing words ([eec998d](https://github.com/ScriptKittyOS/kotiko/commit/eec998dada882a8c9cb072df315671126202af3b))
* **server:** keep the word list private from other accounts ([137cc8f](https://github.com/ScriptKittyOS/kotiko/commit/137cc8f737ac2d026159e500c0d27da2778dd40d))
* **server:** keep the word list private from other accounts ([6688f25](https://github.com/ScriptKittyOS/kotiko/commit/6688f2533fb5e94c46ceacbcbea20b4a25b43ec8))
* **server:** read the lookup cache without executable terms ([0288dd8](https://github.com/ScriptKittyOS/kotiko/commit/0288dd8b015cd507e4fcc03000d1ec65fc285d19))
* **server:** say when LLM_API_KEY is missing or needs a restart ([161bcaf](https://github.com/ScriptKittyOS/kotiko/commit/161bcaf79207f36fad187a8beb8a021627c0a160))
* **server:** skip script names the bundled PCRE doesn't know ([d94561e](https://github.com/ScriptKittyOS/kotiko/commit/d94561ea82ce21e7da407e4f82f2df7fe9270482))
* **server:** stop calling KOTIKO_WIKTIONARY an unknown setting ([c772a01](https://github.com/ScriptKittyOS/kotiko/commit/c772a017ff754824188a5fa927e0614606d55d78))
* **server:** words with Å or Ņ no longer break a lookup ([0f4bb9c](https://github.com/ScriptKittyOS/kotiko/commit/0f4bb9c432f47e77f497ceb472f80260a7bb032e))
* show words already in the list instead of 'couldn't find a word' ([5fced3a](https://github.com/ScriptKittyOS/kotiko/commit/5fced3a52e5d165a9d4516912d69b9ead8841650))
* **site:** build once for the site's tests instead of once per file ([f6b9a20](https://github.com/ScriptKittyOS/kotiko/commit/f6b9a203238061add81b9693bc1c834406c0693c))
* **site:** build once for the site's tests instead of once per file ([273e45b](https://github.com/ScriptKittyOS/kotiko/commit/273e45bfd6d01c59e0eff815a6cb600354968a20))
* tests never reach Wiktionary; KOTIKO_WIKTIONARY turns it off ([19bd8e1](https://github.com/ScriptKittyOS/kotiko/commit/19bd8e1e41c2174c6b5c06a8531d4a86d8081f30))


### Refactoring

* rename Slovo to Kotiko ([b762d9e](https://github.com/ScriptKittyOS/kotiko/commit/b762d9ec31bf3782fd674c48d5a2eec197152b41))

## 0.2.0 (2026-10-01)

- Any language, mixed however you like: choose which languages show from the popup.
- Add words straight from the popup; the Telegram bot is optional.
- Word lookups use free OpenRouter models, falling back across several when one is busy.
- Security: the server's API denies by default, so encoded paths can no longer skip the
  token check.

## 0.1.0

- First version: Russian and Mandarin, words added through a Telegram bot.
