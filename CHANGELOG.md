# Changelog

All notable changes to Kotiko. From the next release on, this file is generated from
Conventional Commits by release-please.

## Unreleased

- The Chrome Web Store accepts the package: the Spanish translation now has the extension's
  full name, which the store requires for every language a package includes.

## [1.0.1](https://github.com/ScriptKittyOS/kotiko/compare/v1.0.0...v1.0.1) (2026-10-08)


### Bug fixes

* **extension:** the Spanish translation has the store name Chrome requires ([6730d6b](https://github.com/ScriptKittyOS/kotiko/commit/6730d6bff6cdeb3cdb6a6da042a77d3c3052e97f))
* **extension:** the Spanish translation has the store name Chrome requires ([23a2512](https://github.com/ScriptKittyOS/kotiko/commit/23a2512c924d42af3a0a15057b8a963980cce296))

## [1.0.0](https://github.com/ScriptKittyOS/kotiko/compare/v0.2.0...v1.0.0) (2026-10-08)

Kotiko's first public release, for the Chrome Web Store and Firefox Add-ons. Learn a word in
any language and Kotiko slips it into the pages you already read, in whatever language you
read them; point at it to see what it means and how it's said. Your words stay in your
browser, lookups use your own AI key (a free OpenRouter key works) or a model on your own
computer, and an optional server of your own keeps your words in one place.

### Upgrade notes

For anyone updating from Slovo 0.2, or running their own server:

- **Slovo is now Kotiko.** The data folder, service name, environment variables
  (`KOTIKO_DATA_DIR`, `KOTIKO_LOG_SQL`) and pairing prefix are renamed. The server moves
  your words and access key across on its first start; see the README's "Updating from
  Slovo".
- **Update the server and the extension together.** The extension no longer sends your
  server's access key: it signs each request (`Kotiko-HMAC v2`) and checks the server's
  signed answers. An older server turns signed requests away, and Kotiko asks you to update
  it. Tools such as `curl` can still send the key as a `Bearer` token.
- **The server's address is `http://127.0.0.1:4747`.** A saved `http://localhost:…` address
  moves to `127.0.0.1` on its own. The server now listens on both `127.0.0.1` and `::1`, and
  won't start if another program already holds either.
- **The words table is rebuilt** on the server's first start. Going back to 0.2 needs the
  automatic backup the server makes first.
- **The server refuses to start on an unsafe data folder**: one owned by another account,
  holding links where Kotiko's files go, or writable by others while holding other files. It
  says what it found and how to fix it.
- **`LLM_URL`, `TRANSCRIBE_URL` and `PUBLIC_URL` can't hold a user name or password**; put
  keys in `LLM_API_KEY` or `TRANSCRIBE_API_KEY` (or their `_FILE` forms).
- **Behind a reverse proxy**, set `TRUSTED_PROXY_HEADER` so each client gets its own limit
  on wrong keys; otherwise all proxied clients share one.
- **`/health` answers JSON** (still 200 when healthy, 503 when the database fails), every
  other path needs the access key however it's spelled, and `run.sh` runs in production
  unless `MIX_ENV` is set.

### Security

Before this release, six independent reviewers attacked four release candidates. Every
finding at medium or above, and almost every lower one, was fixed with a regression test;
what remains is listed as accepted risks in the report,
[docs/security/review-v1.0.0.md](docs/security/review-v1.0.0.md). No published version was
affected, so there are no advisories.

- Security: a web page could restyle a swapped word (it sits in the page) so that it
  covered the page invisibly; then your pointer resting anywhere, or your click on one of
  the page's own buttons, opened the word's card, and the page could search the card's
  text for guesses. The card now opens only on a swapped word you can see, and from the
  mouse or a tap only when you point at the word itself. Enter on a focused word still
  opens it. The privacy policy (version 5) says so.

- Security: Kotiko swapped words in text a page had hidden with a see-through filter, a
  clipping shape or a mask, so the page could read those swaps and learn your words. Text
  like that, and text faded to under 10 % opacity, is no longer swapped. Kotiko also
  leaves text under any clipping shape or mask alone, even where you can see it, since it
  can't tell how much of it shows.

- Security: Kotiko no longer sends your server's access key; it signs each request. Your
  server signs each answer too, and Kotiko uses an answer only when it carries that
  signature, so if another program takes your server's place (say, while the server
  restarts) it gets neither your key nor your words. Update the server and extension
  together: an older server turns signed requests away, and Kotiko asks you to update it.
  Tools such as `curl` can still send the key as before. The privacy policy (version 4)
  says so.

- Security: a web page, or any program on your computer, could lock Kotiko out of your
  server for a minute by sending it a burst of wrong keys or malformed checks. Requests
  from your own computer are no longer locked out; requests from other computers still
  are, including those a reverse proxy on your computer passes on.

- Security: the server warns when it would send an API key over plain HTTP to another
  machine, but missed an address written in capitals, such as `HTTP://203.0.113.7/v1`. It
  now warns however the address is written. An OpenRouter address in capitals is also
  recognised as OpenRouter.

- Security: a program that took your server's place while it was stopped could keep a
  request Kotiko sent it and play it to your server once it was back, and get your word
  list, when the clock of the computer Kotiko runs on was ahead of the server's. Your
  server now makes a new random id each time it starts, gives it with its proof, and
  accepts only requests signed with the current one; after a restart Kotiko asks for a
  new proof and sends the request again by itself. Update the server and the extension
  together: each turns the other's older version away and says so.

- Security: a Kotiko server set to a model of its own (`LLM_MODEL`), for example on a paid
  provider, sent no limit on how long an answer may be, so a model that kept writing could
  cost you up to the provider's own limit for one word. Every lookup now asks for at most
  1,200 tokens of answer (4,000 for refreshing pronunciations), like the extension does,
  in the field OpenAI expects when `LLM_URL` is OpenAI's.

- Security: a web page could read your word list. It could hide a long list of words on
  the page, where you'd never see them, and read back which ones Kotiko swapped. Kotiko
  now swaps only words you can see: text a page hides isn't touched, and text below the
  screen is swapped as you scroll to it, which also makes very long pages faster. One
  visit to a page swaps at most 500 different words, each in at most 3 of your languages,
  so no page can read your whole list at once. The privacy policy (version 3) says what
  sites can and can't see.

- Security: any web page could switch Kotiko off on itself, and could tell that you use
  Kotiko even on sites you paused, on sites Kotiko leaves alone such as banks, or with
  Kotiko turned off. Where Kotiko doesn't swap, it now adds nothing to the page.

- Security: a web page could open a word's card with a fake click and search the card's
  text. The card now opens only when you point at, click, tap or press a key on a word.

- Security: the popup's "This page is in …" line showed the page's own language label as
  written, so a page could put any sentence it liked in Kotiko's popup. Kotiko now shows
  only a language name your browser knows, and nothing otherwise.

- Security: before Kotiko sends your server's access key, the server must now show it holds
  the same key, without either side sending it. Another program listening at the address
  (for example while your server is stopped) never gets the key. Update your Kotiko server
  along with the extension: an older server can't show it, and Kotiko says so in Settings.

- Security: after "Delete everything", Kotiko starts afresh and no longer takes an old-style
  server address and token that a page's script left in the browser's storage meanwhile.

- Security: Kotiko's default server address is now `http://127.0.0.1:4747`, and an address
  you type as `http://localhost:…` is used as `127.0.0.1`, for your server and for Ollama
  and LM Studio. Browsers try `localhost` at the IPv6 address `[::1]` first, where another
  account on the same computer could listen and receive your server's access token. An
  address saved as `localhost` moves to `127.0.0.1` on update; nothing to do on your side.

- Security: a web page that managed to run code inside Kotiko's page script could change
  Kotiko's settings, because browsers let that script write Kotiko's storage. It could turn
  Kotiko off, pause sites, hide languages, change the words pages show, queue a word to be
  looked up with your own AI key and saved, pick another model, or change the languages
  your server's Telegram bot answers in. Kotiko now keeps the real copy of all of these
  where page scripts can't reach, puts back anything changed elsewhere, and only its own
  pages change settings. Nothing to do on your side; your settings move over on update.
  In Firefox (and Chrome before 140), the languages you read no longer follow from
  Kotiko in your other browsers: set them in each one.

### Your own server

- Self-hosted server: the two addresses that answer without your access key, `/health` and
  `/api/v1/proof`, also answered when written another way, such as `/health/` or
  `//api/v1/proof`. Now only the exact addresses do; any other spelling needs the key.

- Self-hosted server: a key written in the query of `LLM_URL` or `TRANSCRIBE_URL` (some
  providers take `?key=...`) was written to the log at start. The log now shows the address
  without its query (`https://host/v1?…`), and the query's values are taken out of every
  log line. A query such as `?api-version=...` now also reaches the provider on every
  request, after the path.

- Self-hosted server behind a reverse proxy: everyone the proxy passes on was counted as
  one, so a stranger sending ten wrong keys a minute could keep your other devices out
  for as long as they kept at it. Set the new `TRUSTED_PROXY_HEADER` to the header your
  proxy puts each visitor's address in (`x-forwarded-for`, `x-real-ip`,
  `cf-connecting-ip` or `forwarded`), and each visitor is counted on their own. The server
  also recognises more of the headers proxies add (`Via`, `X-Client-IP`,
  `Fastly-Client-IP` and others), so visitors through such a proxy are no longer taken for
  your own computer, which is never limited.

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

- Turning off Wiktionary pronunciations with `KOTIKO_WIKTIONARY=false` no longer makes the
  server warn at start that the setting is unknown and ignored. It always worked; only
  the warning was wrong.

### Changes

- **Slovo is now Kotiko.** Your words move automatically from `~/.local/share/slovo` to
  `~/.local/share/kotiko` on first start; the old file is kept as a backup. The service is
  now called `kotiko` (`install-service.sh` replaces the old one). Rename `SLOVO_DATA_DIR`
  to `KOTIKO_DATA_DIR` in `.env` if you set it (and `SLOVO_LOG_SQL` to `KOTIKO_LOG_SQL`);
  the old names still work for now, with a warning. Stop the old server before the first
  start; keep the extension's folder where it is and reload it. See "Updating from Slovo"
  in the README.

- Fixing a word's language no longer makes the word disappear when the model answers with the
  same word in the same language ("Already in your list"): the word stays in your list. Before,
  it went to Recently deleted.

- Privacy policy version 6: "What websites can see" now names every way a page can hide
  text that Kotiko still swaps (a transparent text colour, text turned away), and says a
  disguised word's card can open on a click as well as a resting pointer.

- Release process: the check that holds store uploads until the security review is closed
  could miss a "Gate: open" line written with a lookalike letter from another alphabet, an
  invisible character or a fullwidth colon, and read the review as closed. It now reads
  each line as a person would, keeps the gate open for any such line, and says which line.

- Release process: the check that holds store uploads until the security review is closed
  still missed "Gate: open" written as a list item, a table row, code, HTML, an entity or
  math, a fake "Appendix" heading inside a comment or code block, a closing line hidden in
  a comment, and "the review is still open" written as prose. It now reads all of these as
  open, counts the closing line and the heading only where a reader sees them, and says
  which line keeps the gate open.

- Settings and the welcome page now warn when the address of your lookup service starts
  with `http://` and isn't on your computer: your key and the words you look up would
  travel unencrypted. The server address already warned.

- Connect OpenRouter: a web page you have open can no longer spoil a sign-in in progress.
  Before, any page could open Kotiko's return page with a made-up code while you were
  signing in, and your real sign-in then said "This sign-in has expired". Kotiko now
  takes a code only from the sign-in it started, and a code that doesn't work no longer
  ends the sign-in.

- Connect OpenRouter with one click, without copying a key: "Connect OpenRouter (free)" is
  now the first choice on the welcome page, and Settings, Word lookups has a "Connect
  OpenRouter" button. OpenRouter's sign-in opens in a new tab; when you're done, it sends
  you back to kotiko.org/connect/, Kotiko gets your key, and the page you started from
  says you're connected. Pasting a key still works ("Paste a key instead").

- New documentation site, ready to publish at kotiko.org: install guides for Chrome, Edge,
  Brave and Firefox (with "coming soon" in place of the store links until the listings are
  live), how to start with or without an AI key, one guide per word lookup service, help
  for every message Kotiko can show, the guide to running your own server, and the privacy
  policy, published from the same file the extension shows so the two can't differ. The
  site sets no cookies, has no analytics and loads nothing from any other site. It also
  has the page OpenRouter returns to after "Connect OpenRouter"; Kotiko reads the sign-in
  code there and nowhere else.
  The README is now a short introduction that points to the site.

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
* **extension:** the server proves it holds the token before it gets it ([cc15012](https://github.com/ScriptKittyOS/kotiko/commit/cc15012ce7f04770df6d6109165c2ebc96c5557c))
* **extension:** the welcome flow, your first word celebrated (slice 22) ([72547e2](https://github.com/ScriptKittyOS/kotiko/commit/72547e25756a3d5abd4758a7374da1e58a365725))
* **extension:** the welcome flow, your first word, celebrated ([8d871a2](https://github.com/ScriptKittyOS/kotiko/commit/8d871a268a7c6e0f5b150393256d2932c4608c76))
* **extension:** warn when a lookup service's address sends the key in clear ([eb72445](https://github.com/ScriptKittyOS/kotiko/commit/eb724457e1d94551393b78d7c05030e3385c76b8))
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

* **auth:** sign the server's boot id, so a restart can't let a request replay ([f5e08bc](https://github.com/ScriptKittyOS/kotiko/commit/f5e08bc27bef1ed909e2ec02ee6b9fcca431a96b))
* boot-bound request signatures, per-client limits behind a proxy, and a stricter gate (review E-01, E-02, E-03, E-06, E-07) ([1eb692a](https://github.com/ScriptKittyOS/kotiko/commit/1eb692a0bef021f8965a059ed39d12ed60b5231a))
* **content:** don't swap text a filter, clip-path or mask hides ([a660336](https://github.com/ScriptKittyOS/kotiko/commit/a66033619aaf62b2dbf538f4f23e38bb28bfcd97))
* **content:** open the word card only on a word the learner sees ([fbd2704](https://github.com/ScriptKittyOS/kotiko/commit/fbd27048d24b35e634f20dadcae3848e596ea991))
* **content:** the word card opens only for the learner; filter, clip-path and mask count as hidden (review E-04, E-05) ([2304bd6](https://github.com/ScriptKittyOS/kotiko/commit/2304bd64f88435079cb50832ccd8099756713827))
* **extension:** a browser update after an update from 0.2 no longer drops the learner's words ([608a549](https://github.com/ScriptKittyOS/kotiko/commit/608a54974b80d694f64eea4e5a37b701c0ced507))
* **extension:** a content type that isn't a string, and a test that depended on the date ([8a08928](https://github.com/ScriptKittyOS/kotiko/commit/8a08928d410725b8ebc1310e2d6f2be75acc02fd))
* **extension:** a page can't spoil a Connect OpenRouter sign-in ([aead17d](https://github.com/ScriptKittyOS/kotiko/commit/aead17d69f551f114cb4c64b191f683b3e117706))
* **extension:** a store born from Delete everything takes nothing planted ([645df43](https://github.com/ScriptKittyOS/kotiko/commit/645df431acc5260a7e6b1800a4a62bfb75df6fd9))
* **extension:** an add refused for a rewritten address retries by itself ([b1c3470](https://github.com/ScriptKittyOS/kotiko/commit/b1c3470869e8c394eae64273c3a85087f26ec8c1))
* **extension:** benchmark uses casing.js; make casing about 10 times faster ([287f70e](https://github.com/ScriptKittyOS/kotiko/commit/287f70e6a5efef8181ad6516dbe647be7cd13d56))
* **extension:** bind where requests go, not only the secrets (slice 28) ([b855ac3](https://github.com/ScriptKittyOS/kotiko/commit/b855ac3e83439c3734ce06062e869dd3a72a2973))
* **extension:** content scripts can't change settings or queue adds (SCR-448) ([471ee18](https://github.com/ScriptKittyOS/kotiko/commit/471ee18c4d6e25efad48e2315d2a3c67125fe4be))
* **extension:** content scripts can't change settings or queue adds (SCR-448) ([a164d23](https://github.com/ScriptKittyOS/kotiko/commit/a164d23494a473d09fd8e0ddc563d7f69cb91a5f))
* **extension:** engine slices stay bounded on big pages; steadier tests ([2bde8c8](https://github.com/ScriptKittyOS/kotiko/commit/2bde8c80dabb654a90a2181fa4b55427213f84ca))
* **extension:** every lookup asks for at most the spec's number of tokens ([f026ee3](https://github.com/ScriptKittyOS/kotiko/commit/f026ee3ee6f2bae88abea57082fa248193bbae8c))
* **extension:** fixing a word's language no longer deletes it when the answer is the same word ([54b280c](https://github.com/ScriptKittyOS/kotiko/commit/54b280cfd8482dba31163be038f89bfed8186af4))
* **extension:** localhost addresses are used as 127.0.0.1 ([5fbaa00](https://github.com/ScriptKittyOS/kotiko/commit/5fbaa009471a5dcd2c7fe6117b4ccbe1ec4d2367))
* **extension:** never send the server's token; sign each request (D-01) ([f2e87d8](https://github.com/ScriptKittyOS/kotiko/commit/f2e87d82915799ee574f9b39f935ca3a0b7fed42))
* **extension:** never show a page's own lang text in the popup ([2eceb7c](https://github.com/ScriptKittyOS/kotiko/commit/2eceb7c48482d87bd6f538c4003a9fa1bfa66987))
* **extension:** never swap inside controls or numeral-like capitals ([3b3fee4](https://github.com/ScriptKittyOS/kotiko/commit/3b3fee491f51ed88658c20440de33b6aa218b482))
* **extension:** never swap inside controls or numeral-like capitals ([c40fc88](https://github.com/ScriptKittyOS/kotiko/commit/c40fc8826d586504060be4fd9f515bf98eda0d55))
* **extension:** only Kotiko's pages may skip the wait between syncs ([e5aa393](https://github.com/ScriptKittyOS/kotiko/commit/e5aa39350e4cc27328fcec9e207ccd2413153f3b))
* **extension:** open the languages you read in at #settings/languages ([95d1a6d](https://github.com/ScriptKittyOS/kotiko/commit/95d1a6d00ce7a43b89d45f07aea1e4431a06ec03))
* **extension:** open the word card only for the learner's own input ([1fffd51](https://github.com/ScriptKittyOS/kotiko/commit/1fffd51cd683237a2ddd441a4e303061dcd6c67d))
* **extension:** security review fixes for the background and settings ([cf42809](https://github.com/ScriptKittyOS/kotiko/commit/cf428096ae9c522b2f6e2c677c81f2a74d4d6c63))
* **extension:** security review fixes for what web pages can see ([7045c01](https://github.com/ScriptKittyOS/kotiko/commit/7045c018cf610506618327a657b168ee04982035))
* **extension:** show pages nothing of Kotiko where it doesn't swap ([4b17f9f](https://github.com/ScriptKittyOS/kotiko/commit/4b17f9f5bccc58c029c28da9a688ab8afc9fa1f8))
* **extension:** swap only text the learner sees, at most 500 words a page ([a29ef3e](https://github.com/ScriptKittyOS/kotiko/commit/a29ef3eb3c999e00ae36b62bf137012d4050d7c5))
* **extension:** sync that never shows stale results or errors ([5293305](https://github.com/ScriptKittyOS/kotiko/commit/52933053cdbffda0ebca2e65569faa120364755a))
* **extension:** the browser's languages stay on the device ([abcd363](https://github.com/ScriptKittyOS/kotiko/commit/abcd363aedcc1de281a6ff22ccbeba009f13e34a))
* **extension:** the content scripts' live-copy name passes the build's test-hook guard ([5f4a05c](https://github.com/ScriptKittyOS/kotiko/commit/5f4a05c417aa117199d1e384ea980066880a1b3d))
* **extension:** the pages' base languages never go back to an older list ([7ca742b](https://github.com/ScriptKittyOS/kotiko/commit/7ca742ba7621970623c6822d472c2166d26e58ad))
* fixing a word's language no longer deletes it; docs say typed words reach Wiktionary (launch checks F1, F5) ([719f26c](https://github.com/ScriptKittyOS/kotiko/commit/719f26c52be5a6a6076175b8b986fd2db1d94373))
* keep a function-word meaning when the learner typed the word ([6aae1f0](https://github.com/ScriptKittyOS/kotiko/commit/6aae1f099623db512102da6a6e98d9c57f509408))
* keep a function-word meaning when the learner typed the word ([ea7603f](https://github.com/ScriptKittyOS/kotiko/commit/ea7603f9146d77263403b3a172ea6ec3bfa4ecf8))
* **merge:** the same gloss on a re-add is not a new form ([519b8f6](https://github.com/ScriptKittyOS/kotiko/commit/519b8f6fd7dee0c99ba009d1e57ab65b3bfcf32f))
* output cap on the server, HTTP warning case, and a stricter store gate (review D-03, D-04, D-05) ([3f966df](https://github.com/ScriptKittyOS/kotiko/commit/3f966dfc5c854656ed403c95fa712e47aa74a02d))
* **release:** open the store gate only on the lead's exact closing line ([582fcd5](https://github.com/ScriptKittyOS/kotiko/commit/582fcd5165410a8b467c01acc8f928214d8ccaa4))
* **release:** read the security gate's lines as a reader sees them ([a9e5db9](https://github.com/ScriptKittyOS/kotiko/commit/a9e5db901aafcbd774cc81128f6c2df3bb122c9c))
* **release:** refuse a signed tag pushed under another tag's name ([0876dbe](https://github.com/ScriptKittyOS/kotiko/commit/0876dbe5da512adc7723bbb5b6a20d1917801e1a))
* **release:** security review fixes for the release pipeline and CI ([cf02268](https://github.com/ScriptKittyOS/kotiko/commit/cf022682b4326276c16f4d7c5f75a4c8d87f4790))
* **release:** send Firefox Add-ons the release's own zip ([1f064cd](https://github.com/ScriptKittyOS/kotiko/commit/1f064cdd290d4a83e2fa0908c09d6bdc9768d482))
* **release:** store screenshots show the popup over a real article ([6fb7cf9](https://github.com/ScriptKittyOS/kotiko/commit/6fb7cf9c0b060d499215b89ce7a96fbba23a9660))
* **release:** the gate check strips tags until none is left ([d7896c3](https://github.com/ScriptKittyOS/kotiko/commit/d7896c3be2c5ae0baaea6c313997a6a2f2544fd2))
* **release:** the security gate reads lines as a reader sees them ([34177fc](https://github.com/ScriptKittyOS/kotiko/commit/34177fcb5f3ac572c1e68f880e1114ce54c3bbda))
* **release:** the store zips leave out the tests' hook ([c0c4c02](https://github.com/ScriptKittyOS/kotiko/commit/c0c4c029ceeb66b7f931322c4c20a80a65fb1699))
* **scripts:** read the live entry from a fixed id, not one taken from the document ([1d21b42](https://github.com/ScriptKittyOS/kotiko/commit/1d21b4217b0edf6e70a41fa93f8b0bb2b16fccb9))
* **scripts:** the badge page lists only what differs from the live entry ([6a708c9](https://github.com/ScriptKittyOS/kotiko/commit/6a708c95f0569ad951c55252484575c697579cda))
* **server:** a repeated query parameter is a 400, not a 500 ([eba1343](https://github.com/ScriptKittyOS/kotiko/commit/eba134380bbe07cddadf42f4147d5958a6a2e114))
* **server:** count clients behind a proxy apart, and know more proxy headers ([74d4fbf](https://github.com/ScriptKittyOS/kotiko/commit/74d4fbfce0a957165ddb6e7f5ac9934ea7134773))
* **server:** deny by default so encoded paths can't skip the token ([2693809](https://github.com/ScriptKittyOS/kotiko/commit/2693809fbf39486804629938968374f9f21e62e1))
* **server:** every lookup request carries the output cap ([11139a8](https://github.com/ScriptKittyOS/kotiko/commit/11139a80aa7b7aaf156bec93e480e7c88ccacdab))
* **server:** fall back across free models and stop losing words ([eec998d](https://github.com/ScriptKittyOS/kotiko/commit/eec998dada882a8c9cb072df315671126202af3b))
* **server:** keep a key in LLM_URL's query out of the log ([c67ea02](https://github.com/ScriptKittyOS/kotiko/commit/c67ea029afd5516cdfc1389435184352582fbb94))
* **server:** keep refused words out of the debug log without LOG_LOOKUPS ([c6a1317](https://github.com/ScriptKittyOS/kotiko/commit/c6a13171a123102ef03891bc101c1fdf44cb383b))
* **server:** keep the word list private from other accounts ([137cc8f](https://github.com/ScriptKittyOS/kotiko/commit/137cc8f737ac2d026159e500c0d27da2778dd40d))
* **server:** keep the word list private from other accounts ([6688f25](https://github.com/ScriptKittyOS/kotiko/commit/6688f2533fb5e94c46ceacbcbea20b4a25b43ec8))
* **server:** limit what a reverse proxy on this computer forwards (D-02) ([3300a87](https://github.com/ScriptKittyOS/kotiko/commit/3300a87500c2b5bbdfcee016460f346c0769843f))
* **server:** listen on both loopback addresses by default ([269a648](https://github.com/ScriptKittyOS/kotiko/commit/269a648ecd66083e5375e2c0cdcab48282cc9614))
* **server:** make the old copy of the words private, and delete it with the data ([713cb45](https://github.com/ScriptKittyOS/kotiko/commit/713cb45f531f766d73be137331e1e578a48584fe))
* **server:** no local program or web page can lock the extension out (D-02) ([0048fe8](https://github.com/ScriptKittyOS/kotiko/commit/0048fe850bf51cbadf8e1e55b96d994945e85347))
* **server:** open routes answer only their exact spelling ([7d175d3](https://github.com/ScriptKittyOS/kotiko/commit/7d175d3e1bc0f9f829d492e3da1ccfbc80b05c55))
* **server:** read the lookup cache without executable terms ([0288dd8](https://github.com/ScriptKittyOS/kotiko/commit/0288dd8b015cd507e4fcc03000d1ec65fc285d19))
* **server:** refuse a data folder someone else could have planted files in ([b1b75a1](https://github.com/ScriptKittyOS/kotiko/commit/b1b75a1e2d1144ab0df1219e6dd7e4019633b569))
* **server:** refuse a password inside LLM_URL, TRANSCRIBE_URL or PUBLIC_URL ([5e49cfe](https://github.com/ScriptKittyOS/kotiko/commit/5e49cfe6be213926c976222752cc9bf74c60deb5))
* **server:** say when LLM_API_KEY is missing or needs a restart ([161bcaf](https://github.com/ScriptKittyOS/kotiko/commit/161bcaf79207f36fad187a8beb8a021627c0a160))
* **server:** security review fixes for the self-hosted server ([5308e05](https://github.com/ScriptKittyOS/kotiko/commit/5308e05d093ef4de4a434f6a51ce5cd1b46b35c4))
* **server:** skip script names the bundled PCRE doesn't know ([d94561e](https://github.com/ScriptKittyOS/kotiko/commit/d94561ea82ce21e7da407e4f82f2df7fe9270482))
* **server:** stop calling KOTIKO_WIKTIONARY an unknown setting ([c772a01](https://github.com/ScriptKittyOS/kotiko/commit/c772a017ff754824188a5fa927e0614606d55d78))
* **server:** stop refused host names flooding the log ([e223a21](https://github.com/ScriptKittyOS/kotiko/commit/e223a2161a9c115578c7a329a482f4fa816d8e6a))
* **server:** throttle wrong tokens and add a token proof route ([eda0e3e](https://github.com/ScriptKittyOS/kotiko/commit/eda0e3e43c4c2bba4ea88da8c9e83caf5662de87))
* **server:** warn about an API token that is easy to guess ([a2fb973](https://github.com/ScriptKittyOS/kotiko/commit/a2fb97377342e84d331562d25e5be7f7ee3e4245))
* **server:** warn about plain HTTP however the address is written ([2e8bc14](https://github.com/ScriptKittyOS/kotiko/commit/2e8bc14417502f64dacbe9bdf714a0896bd067f2))
* **server:** warn when a provider key goes over plain HTTP ([0a1806e](https://github.com/ScriptKittyOS/kotiko/commit/0a1806eaf8c8facbd76ded2e28d0e4b71348c728))
* **server:** words with Å or Ņ no longer break a lookup ([0f4bb9c](https://github.com/ScriptKittyOS/kotiko/commit/0f4bb9c432f47e77f497ceb472f80260a7bb032e))
* show words already in the list instead of 'couldn't find a word' ([5fced3a](https://github.com/ScriptKittyOS/kotiko/commit/5fced3a52e5d165a9d4516912d69b9ead8841650))
* sign every request instead of sending the server token; no local lockout (review D-01, D-02) ([a981bc2](https://github.com/ScriptKittyOS/kotiko/commit/a981bc2074e467a407038fdeba80c407d3c651f7))
* **site:** build once for the site's tests instead of once per file ([f6b9a20](https://github.com/ScriptKittyOS/kotiko/commit/f6b9a203238061add81b9693bc1c834406c0693c))
* **site:** build once for the site's tests instead of once per file ([273e45b](https://github.com/ScriptKittyOS/kotiko/commit/273e45bfd6d01c59e0eff815a6cb600354968a20))
* **store:** declare the learner's own key as authentication info on Firefox ([573d33a](https://github.com/ScriptKittyOS/kotiko/commit/573d33ad668b4ddbca48c4b489797affb8460d11))
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
