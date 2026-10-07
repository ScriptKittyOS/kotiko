# Changelog

All notable changes to Kotiko. From the next release on, this file is generated from
Conventional Commits by release-please.

## Unreleased

- Self-hosted server: after moving your words from the folder used before the rename to
  Kotiko, the old copy (`~/.local/share/slovo/slovo.db`) and the old access key could stay
  readable by other accounts. The server now makes them private after the move, and at
  every start for installs moved earlier. `install-service.sh --uninstall --delete-data`
  now deletes that old copy too.

- Self-hosted server: someone who could write in your data folder could choose your access
  key (by leaving an `api-token` there) or send your words to a file of theirs (by putting
  a link where `kotiko.db` goes). The server now refuses to start, saying what it found
  and how to fix it, when the data folder or one of Kotiko's files belongs to another
  account, when one of Kotiko's files is a link, or when others can write in a data folder
  that also holds other files. A folder others can write in that holds only Kotiko's files
  is made private first, with a warning. To keep your words on another disk, point
  `KOTIKO_DATA_DIR` there instead of linking `kotiko.db`.

- Self-hosted server: with `LOG_LEVEL=debug`, words the model suggested and the server
  refused were written to the log even with `LOG_LOOKUPS=false`. Now only the reasons are,
  unless you turn `LOG_LOOKUPS` on.

- Self-hosted server: when your model or transcription key would go over plain `http://`
  to another machine (not this computer, not Tailscale), the server now warns at start,
  because anyone on the network in between could read it.

- Self-hosted server: a user name and password written inside `LLM_URL` or
  `TRANSCRIBE_URL` (`https://user:password@host/...`) went into the log at start. The
  server now refuses to start with such an address, without showing it; put the key in
  `LLM_API_KEY` or `TRANSCRIBE_API_KEY` instead. The same goes for `PUBLIC_URL`.

- Self-hosted server: an access key you chose yourself that looks easy to guess (few
  different characters, a repeated piece, mostly one character) now gets a warning at
  every start. Delete `API_TOKEN` to let the server make a random one.

- Self-hosted server: after 10 wrong access keys from one address within a minute, the
  server refuses that address for the rest of the minute (`429`) and logs it once. Other
  addresses, including yours, keep working. New route `POST /api/v1/proof`: Kotiko can
  check that an address really is your server, which proves it holds your access key
  without sending it, before Kotiko sends the key there.

- Self-hosted server: another account on the same computer could receive your access key
  by listening on `[::1]:4747`, the address browsers try first for `localhost`. The server
  now listens on both `127.0.0.1` and `::1` by default (and with `BIND=localhost`), so
  nobody else can take either; it refuses to start, saying which address, if another
  program already holds one. In Kotiko, enter `http://127.0.0.1:4747` as your server's
  address.

- Self-hosted server: requests for many different host names can no longer fill the log.
  The server logs each refused name at most once an hour, and at most 1,000 names an hour;
  past that it logs one line saying so, and how many it left out.

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

## 0.2.0 (2026-10-01)

- Any language, mixed however you like: choose which languages show from the popup.
- Add words straight from the popup; the Telegram bot is optional.
- Word lookups use free OpenRouter models, falling back across several when one is busy.
- Security: the server's API denies by default, so encoded paths can no longer skip the
  token check.

## 0.1.0

- First version: Russian and Mandarin, words added through a Telegram bot.
