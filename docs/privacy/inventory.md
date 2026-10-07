# What Kotiko keeps and sends: the data inventory

This is the single source for Kotiko's privacy policy ([`en.md`](en.md)), the Chrome Web
Store privacy form and the Firefox data declaration
([`store/chrome-web-store.md`](../../store/chrome-web-store.md),
[`store/firefox-amo.md`](../../store/firefox-amo.md)). It was written from the code, not
from the plan: every row names the code that does it.

**A change that makes Kotiko keep or send something new updates this file, the policy
and the store forms in the same pull request.** `test/unit/store-readiness.test.mjs`
fails when a network call, a host name or a permission appears in the extension without
a line here or in the store form.

Last checked against the code: 2026-10-06 (extension 0.2.0, spec 2.0.0).

## 1. Data, where it's kept, and where it goes

| Data | Kept where | Leaves the device? | To whom, when | Code |
|---|---|---|---|---|
| Text of the pages you read, and their addresses | Not kept. Read in memory to find words to swap; the address seeds which language a word shows in (slice 18) and is checked against your paused sites | Never | Nobody | `content.js`, `content/engine.js`, `lib/precedence.js` |
| Your words (the word, its meaning in your languages, pronunciation, your note, the text you typed to add it, status) | In this browser: IndexedDB (`kotiko` database) and a copy in `storage.local` that Kotiko's page scripts read. Or on your own Kotiko server, if you connect one | Only if you connect a server | Your own Kotiko server (sync every minute, and every add, edit and delete) | `lib/store.js`, `lib/projection.js`, `background.js` `request()` |
| Text you type or paste to add words (the popup, the dashboard, the welcome page, bulk add), plus your base languages, up to five of your recent target languages and a language hint | Add jobs in IndexedDB (`meta`), with a copy in `storage.local` for the popup (kept 7 days after they finish, at most 20); the checked result in a lookup cache in IndexedDB (30 days, at most 5,000) | Yes, when you add a word that needs a lookup. Never for "word = meaning" lines | The provider you chose (OpenRouter by default; OpenAI, Anthropic, Google Gemini, Groq, a local Ollama or LM Studio, or any address you enter), or your Kotiko server, which asks its own provider | `lib/llm/client.js` `call()`, `background.js` `lookupJob()` |
| Your saved words (word, meaning, sense, base language), to write their pronunciations | Nothing new | Yes, for words saved without a pronunciation (added by hand, imported, or from an older version), at most twice per word, in the background, when words live in this browser and a provider is set up | The provider you chose | `lib/refresh-job.js` → `client.respell()` |
| A word you add in a language with word stress (Russian, Ukrainian, Spanish and others in `spec/pronunciation.json`): the word only | The Wiktionary page's pronunciation section, 30 days, in the lookup cache | Yes, when you add the word with a lookup or as "word = meaning", and once in the background for words saved earlier | The Wikimedia Foundation (en.wiktionary.org), with a `Api-User-Agent` header naming Kotiko and `hello@scriptkittyos.com` | `background.js` `wiktionaryPage()`, `lib/wiktionary-pass.js` |
| Your provider key and your server's access token | IndexedDB (`secrets`), which only the background reads. Never in `storage.local`, `storage.sync` or `storage.session`; never shown again in full (the settings show the first six and last four characters) | Only to the service it belongs to, and only at an address chosen on one of Kotiko's own pages (slice 28 §7) | Your provider; your Kotiko server | `background.js` `secret()`, `secretFor()`, `routeAllows()` |
| Which provider, model and server address you use; whether a key is saved (yes or no, never the key) | IndexedDB (`meta`), with a copy in `storage.local` that pages read | Each request goes to that address | Your provider or your server | `lib/local-mode.js` `readSettings()` |
| The model list (any provider whose models Kotiko lists) and your remaining free lookups (OpenRouter only) | IndexedDB `meta`; the list refreshed at most daily, the count at most every 5 minutes while lookups run | The request itself, with your key | Your provider (`/models`); OpenRouter (`/key`) | `lib/llm/client.js`, `lib/llm/catalog.js` |
| The Test button's lookup | Nothing | The word "hello" and your base languages | Your provider | `lib/llm/client.js` `test()` |
| Settings: Kotiko on or off, paused sites (host names you paused), words you chose never to swap, languages hidden, amount, speech, celebrations, add jobs | IndexedDB (`meta`), with a copy in `storage.local` that content scripts and pages read | Never | Nobody | `lib/settings.js`, `background.js` `saveSettings()` |
| Your base languages, Kotiko's interface language, and a random 32-character value that keeps word choices the same across your devices (`seedSalt`) | IndexedDB (`meta`) with a copy in `storage.local`; the languages also in `storage.sync` once you confirm them (your first word, Skip on the welcome page, or a change in Settings), the random value from the start | Through your browser's own sync, if you turned it on | Google or Mozilla, under their sync terms. Stays in your browser account after an uninstall | `background.js` `saveUi()`, `ensureSeedSalt()`, `welcome.js`, `dashboard.js` |
| The browser's languages (to suggest your base languages) | IndexedDB (`meta`) with a copy in `storage.local` (`ui.baseLangsDetected`); never in `storage.sync` | Never | Nobody | `background.js` `detectBrowserBases()`, `saveUi()` |
| A word you ask to hear | Not kept | Only if you turn on "Online voices" in Settings (off by default); then your browser may send it to its speech service | Your browser's or operating system's speech service (for example Google, Microsoft or Apple) | `lib/speak.js` (`localService`) |
| "Try it on a page" on the welcome page | Nothing | Only if you click it: it opens a Wikipedia search for your word in a new tab | Wikipedia (the Wikimedia Foundation), as any link you open | `lib/welcome-model.js` `wikipediaUrl()` |
| Your base languages and the interface language you chose (none when automatic), for your server's Telegram bot (slice 41 §9) | Your Kotiko server's database (`profile`), if you connect one | Only if you connect a server | Your own Kotiko server, when you change them in the dashboard or the welcome page, after connecting, and after a sync when the server has an older copy | `background.js` `sendProfile()`; `server/lib/kotiko/profile.ex` |
| Words in Telegram messages and voice notes (server add-on) | Your server's database (words, and a pending lookup until you tap Add; per Telegram account, the language you chose with `/language` and which one-time notes the bot showed, in `telegram_prefs`) | Yes | Telegram (the bot's messages); your transcription service for voice notes (`TRANSCRIBE_URL`, which can be a local whisper.cpp); your server's provider for lookups; Wiktionary for pronunciations | `server/lib/kotiko/bot.ex`, `bot/prefs.ex`, `telegram.ex`, `transcriber.ex`, `llm/client.ex`, `pronounce.ex` |
| Your server's logs | Your server | No | Nobody. Typed text is logged only with `LOG_LOOKUPS=true`, and then only at debug level | `server/lib/kotiko/llm.ex` |

Kotiko has no analytics, telemetry, crash reporting, ads, remote configuration or update
checks of its own, and no servers of its own. It sets no uninstall address
(`runtime.setUninstallURL`). Nothing in the package is fetched and run from the network:
dictionaries, the model list and words are data, checked by the word spec before use.

## 2. What the web pages you visit can see

- The swapped words themselves: they are in the page, so the page's own scripts, and any
  session-recording tool it runs, can read them, and can tell from the `<kotiko-w>`
  element and its `lang` attribute that Kotiko is installed and which language each word
  is in.
- Not the original words, not the meanings, not word ids: the swaps carry only `lang`,
  `dir`, `translate="no"` and `class="notranslate"`; the word card is a
  `<kotiko-popover>` element with a closed shadow root (slice 19). Checked by
  `test/e2e/popover.spec.mjs` and `test/e2e/privacy.spec.mjs`.
- Pausing Kotiko on a site, or turning it off, stops the swaps there.

## 3. What Kotiko's own page scripts (content scripts) can reach

Content scripts run inside every page you open, so they are the part of Kotiko a hostile
page is closest to. Browsers let them read and write `storage.local` and `storage.sync`
(Chrome 140 and later can close an area to them with `setAccessLevel`; Firefox can't, see
[bug 1724754](https://bugzil.la/1724754)). They can send three messages to the background:
`sync`, `sensitiveSites` and `neverSwap` (the word card's "Don't swap this word", one word
at a time).

- They can read your words, your add jobs (the text you typed, for 7 days) and your
  settings, which they need to swap words.
- They can't read your key or your token: those are only in the background's IndexedDB,
  which content scripts can't open (they get the page's IndexedDB, not Kotiko's), and
  `storage.session` is not used for them.
- They can't change your settings, your word list or your add queue (SCR-448). The real
  copy of every setting, of the pages' word list and of the add jobs is in the
  background's IndexedDB (`meta`, `area:<name>` rows, `lib/settings.js`); `storage.local`
  holds only a copy of it for content scripts and Kotiko's pages to read. The background
  reads nothing it acts on from `storage.local`; Kotiko's pages change settings with the
  `settings.set` message, which only they may send. A value a content script writes to
  `storage.local` is put back as soon as the background sees the change (and at every
  start of the background, for changes made while it wasn't running), and a key it adds is
  removed. So a content script can't turn Kotiko off, pause sites, hide languages, change
  the list pages show, queue an add (which would spend the learner's lookups and change
  their list), or choose another model, data policy or words home
  (`test/bg/settings.test.mjs`, `test/e2e/privacy.spec.mjs`).
- Your base languages and interface language go to your server's Telegram bot only from
  the background's copy, which only Kotiko's pages change. In Chrome 140 and later Kotiko
  closes `storage.sync` to content scripts, so a change there came from Kotiko on this or
  another of your browsers and is taken. In Firefox, and older Chrome, a content script
  could write there, so this browser keeps its own copy: languages changed in Kotiko on
  another device don't follow until you change them here.
- They can't make Kotiko send anything somewhere new. Where requests go is kept in the
  background's IndexedDB (`meta`): the server's address, the lookup service the learner
  chose, and each service's address. Only Kotiko's own pages change them (by naming an
  address or choosing a service). Every request checks its address against them and sends
  nothing on a mismatch. 0.2-era `token`/`serverUrl` keys written later are removed
  unused, and ones found on a brand-new install are dropped with everything else found
  there (`test/bg/privacy.test.mjs`, `test/e2e/privacy.spec.mjs`).
- **Still open.**
  - "Don't swap this word" is a content-script message by design (the word card is on the
    page), so a subverted content script could add words to that list, one at a time. The
    list is in Settings, where each can be taken off.
  - Between a content script's write and the background putting it back, other open
    pages can briefly act on the written value (for example, take their swaps off and put
    them back). One that writes again and again keeps them doing so; nothing is saved or
    sent.
  - An install updating from a build before this one takes what its `storage.local` holds
    at that moment, once, as Kotiko's own (there is no way to tell what a content script
    wrote before). There have been no releases yet, so this concerns only builds run from
    source. Updating from before slice 28, an address saved for a hosted service, where no
    page shows an address field, is dropped; a server address and the address of a
    service on your computer or "custom" are visible in Settings and are kept.

## 4. Hosts in the code

Every host name that appears in the extension's files. `test/unit/store-readiness.test.mjs`
fails if a file names a host that isn't in this table. `*` stands for a part filled in
at run time.

| Host | Contacted by Kotiko? | Why it's in the code |
|---|---|---|
| `openrouter.ai` | Yes, when OpenRouter is your provider | Lookups, the free-model list and remaining free lookups; the key page link; the "Connect OpenRouter" sign-in (the sign-in page `openrouter.ai/auth` in a new tab, then the code traded for a key at `/api/v1/auth/keys`) |
| `api.openai.com` | Yes, when OpenAI is your provider | Lookups |
| `api.anthropic.com` | Yes, when Anthropic is your provider | Lookups |
| `generativelanguage.googleapis.com` | Yes, when Google Gemini is your provider | Lookups |
| `api.groq.com` | Yes, when Groq is your provider | Lookups |
| `127.0.0.1` | Yes, when a local provider (Ollama, LM Studio) or a server on this computer is chosen | Default addresses and examples. An `http://localhost` address you type is sent to 127.0.0.1 instead, because browsers try `[::1]` first for that name, where another account on the computer could listen |
| `localhost` | No | Code comments and the check that turns `http://localhost` into 127.0.0.1 |
| `en.wiktionary.org` | Yes, for words in languages with word stress | Pronunciations: the word only |
| `*.wikipedia.org` | Only when you click "Try it on a page" | A link the welcome page opens |
| `es.wikipedia.org` | No | An example in a code comment |
| `kotiko.org` | No request; a link, and the only site whose page may send the sign-in code (`oauth.code`) | The docs site and the privacy policy's public copy |
| `github.com` | No; links you can open | Source code, license, language data docs; also the `HTTP-Referer` Kotiko sends to OpenRouter to name itself |
| `platform.openai.com`, `console.anthropic.com`, `aistudio.google.com`, `console.groq.com` | No; links you can open | "Get a key" links for each provider |
| `openai.com`, `www.anthropic.com`, `ai.google.dev`, `groq.com`, `telegram.org`, `foundation.wikimedia.org` | No; links in the bundled privacy policy | Each service's own privacy policy |
| `docs.ankiweb.net` | No | Where the Anki note-type name in `data/anki-notetypes.json` comes from (a note in the file) |
| `192.168.1.5`, `user` | No | Examples in code comments |
| `www.w3.org` | No | The SVG namespace name, not an address |
| `.` | No | The "https://." in an error message's example |

## 5. Network call sites

Every place the extension's code can start a request, by file.
`test/unit/store-readiness.test.mjs` counts `fetch(`, `XMLHttpRequest`, `WebSocket`,
`sendBeacon(`, `EventSource` and `importScripts(` in each file and fails when the count
differs from this table.

| File | Count | What they fetch |
|---|---|---|
| `extension/background.js` | 7 | `importScripts` of Kotiko's own library files; Kotiko's own `stopwords.json` and `sensitive-sites.json` (from the package, no network); the server (`request()`); the provider client's `fetch`; Wiktionary (`wiktionaryPage()`); OpenRouter's key exchange for the sign-in |
| `extension/lib/llm/client.js` | 1 | The provider: `/chat/completions`, `/models`, `/key` (OpenRouter) |
| `extension/lib/pkce.js` | 1 | OpenRouter's `/api/v1/auth/keys` (the sign-in's code exchange) |
| `extension/lib/i18n.js` | 1 | Kotiko's own `_locales/*/messages.json` (from the package) |
| `extension/lib/story.js` | 1 | Kotiko's own `story/*.md` (from the package) |
| `extension/popup-more.js` | 2 | Kotiko's own `spec/languages.json` and `spec/lang/*/respelling.json` (from the package) |
| `extension/bulk/sheet.js` | 1 | Kotiko's own `stopwords.json` (from the package) |
| `extension/privacy.js` | 1 | Kotiko's own `privacy/en.md` (from the package) |
| `extension/data-tools.js` | 1 | Kotiko's own `data/anki-notetypes.json` (from the package), for the Anki export |

## 6. Permissions

The manifest's permissions and why each is needed are in
[`store/chrome-web-store.md`](../../store/chrome-web-store.md#permissions-and-justifications);
the test fails when the manifest and that table disagree.
