# Kotiko privacy policy

Version 2 · 6 October 2026

Kotiko is a browser extension that swaps words on the web pages you read for words you're
learning in other languages. This page says exactly what it keeps, what it sends, and to
whom. It takes about two minutes to read.

## The short version

- The text of the pages you read never leaves your browser.
- When you add a word that needs looking up, the text you typed goes to the AI service you
  chose (OpenRouter unless you pick another), or to your own Kotiko server.
- Kotiko has no servers of its own and collects nothing: no analytics, no tracking, no ads.
- Your words stay in your browser unless you connect your own Kotiko server.
- You can delete everything at any time.

## Who makes Kotiko

Kotiko is a free, open-source project from ScriptKittyOS. Its code is public at
<https://github.com/ScriptKittyOS/kotiko>, so anyone can check what this page says.
ScriptKittyOS receives no data from Kotiko and holds none about you.

## What stays on your device

These never leave your browser:

- **The pages you read.** Kotiko reads their text in your browser to find words to swap.
  It doesn't save the text or the addresses of the pages you visit.
- **Your words**, unless you connect your own server (below). They are kept in your
  browser's storage for Kotiko: each word, its meaning in the languages you read, its
  pronunciation, your note, and the text you typed to add it.
- **Your settings**: whether Kotiko is on, the sites you paused it on, words you chose
  never to swap, the languages you show, and the like.
- **Recent adds**: the text you typed for your last adds, kept for 7 days so you can see
  the result and undo it, and a cache of lookup results kept for 30 days so the same word
  isn't looked up twice.
- **Your browser's languages**, read once to suggest the languages you read in.

## What leaves your device, and only when you act

**Looking up a word.** When you add a word that needs a lookup (for example "how do you say
cat in Japanese"), Kotiko sends the text you typed, the languages you read in, and the
names of up to five languages you recently added words in, to the AI service you set up.
It doesn't send the page you were on, its address, or anything about you. Lines typed as
"word = meaning" are never looked up. When your words live in your browser, Kotiko may
also ask the same service, in the background, for the pronunciation of words you saved
without one: it sends the word, its meaning and its language.

You choose the service, and you give Kotiko your own key for it. That service's own
privacy policy applies to what it receives:

- **OpenRouter** (the default): <https://openrouter.ai/privacy>. OpenRouter passes your
  text to the company that runs the model. Some free models are run by companies that may
  keep or train on what you send. In Kotiko's settings, "Only use services that don't keep
  my text" asks OpenRouter to use only those that don't (fewer free models may be
  available). Your OpenRouter account's own privacy settings apply too. Kotiko tells
  OpenRouter its name and project address with each request, so the request shows up as
  Kotiko's; this says nothing about you.
- **OpenAI**: <https://openai.com/policies/privacy-policy>
- **Anthropic**: <https://www.anthropic.com/legal/privacy>
- **Google Gemini**: <https://ai.google.dev/gemini-api/terms>. On Google's free tier,
  Google may use what you send to improve its products, and people may read it.
- **Groq**: <https://groq.com/privacy-policy>
- **Ollama or LM Studio**: these run on your own computer; nothing leaves it.
- **Another address you enter**: whoever runs it.

Kotiko also asks the service for its list of models (with OpenRouter, its free models),
and OpenRouter for how many free lookups you have left today. "Test" in the settings
sends the word "hello".

**Connecting OpenRouter.** If you choose "Connect OpenRouter", Kotiko opens OpenRouter's
sign-in page, where you sign in to OpenRouter directly; Kotiko never sees your OpenRouter
password. OpenRouter then sends your browser to <https://kotiko.org/connect/> with a
one-time code in the page address. That page is part of Kotiko's website: it sets no
cookies, loads nothing from other sites, and only shows the sign-in's progress. Kotiko
reads the code there and trades it with OpenRouter for your key, which it keeps as
described below. The code works only once, expires after ten minutes, and is useless
without a second secret that never leaves your browser. Like any website, kotiko.org's
hosts (GitHub Pages and Cloudflare) see each visit, including that address.

**Pronunciations from Wiktionary.** For a word in a language with word stress (such as
Russian, Ukrainian or Spanish), Kotiko asks English Wiktionary, run by the Wikimedia
Foundation, for that word's page, to get its pronunciation right. Only the word is sent,
never the page you were reading or your other words. This happens when you add the word,
and once in the background for words saved earlier. Wikimedia's privacy policy:
<https://foundation.wikimedia.org/wiki/Policy:Privacy_policy>.

**Your key and your server's access key** are kept in a part of the extension's storage
that web pages and Kotiko's own page scripts can't read. Each is sent only to the service
it belongs to, at the address you chose in Kotiko's settings.

**Listening to a word.** Kotiko uses the voices on your computer. If you turn on "Allow
online voices" in Settings (it's off by default), your browser may send the word you play
to its own voice service (for example Google, Microsoft or Apple).

**Links you click.** "Try it on a page" on the welcome page opens a Wikipedia search for
your word, and other links open the sites they name. These are ordinary visits to those
sites.

Any request to another computer also tells it your IP address, as every web request does.

## What websites can see

The words Kotiko swaps in are part of the page, so the website's own scripts, including
any session-recording tools it uses, can see them, and can tell that you use Kotiko and
which language each swapped word is in. They can't see the original words, their
meanings or your word list. To stop this on a site, pause Kotiko there from its toolbar
button, or turn it off.

## Your own server (optional)

You can run a Kotiko server yourself, for example to use Kotiko from Telegram or to share
words between computers. If you connect one, your words, and the text you type to add
them, go to that server, and it looks words up with the AI service you configure on it.
You run it, so you decide what it keeps; it keeps your words, the results of recent
lookups for 30 days, and for a day the answers to recent adds, so a retried add isn't
saved twice. Kotiko also sends it the languages you read in, and Kotiko's interface
language if you chose one, so its Telegram bot gives meanings in your languages. It asks Wiktionary for pronunciations the same way the extension does. It doesn't write the text you send to
its logs unless you turn on `LOG_LOOKUPS`.

If you use its Telegram bot, your messages to the bot pass through Telegram
(<https://telegram.org/privacy>), and voice notes go to the speech-to-text service you
configure, which can run on your own computer. The server remembers, for each Telegram
account, the language you asked the bot to write in.

## Browser sync

If your browser syncs extension data, the languages you read in, Kotiko's interface
language, and a random value that keeps word choices the same on all your devices are
stored in your browser account by Google or Mozilla, under their terms. Your words and
keys are not synced this way.

## Keeping and deleting your data

- **Delete one word** from your word list or from the result line after adding it.
- **Export** your words at any time from Settings, as a backup or a spreadsheet.
- **Delete everything** in Settings removes your words, settings, keys and caches from
  this browser. It can also delete the words on your Kotiko server, and the settings in
  your browser account, if you tick those boxes.
- **Uninstalling** Kotiko removes everything it keeps in this browser, except settings
  stored in your browser account by sync (above).

Kotiko can't delete what an AI service, Wikimedia or Telegram already received; their own
policies apply.

## Security

Your key and access key are kept away from web pages and from Kotiko's page scripts, and
are never shown again in full. Kotiko loads no code from the internet. To report a
security problem, see <https://github.com/ScriptKittyOS/kotiko/security/policy> or write
to security@scriptkittyos.com.

## Children

Kotiko is not directed at children under 13, and it collects nothing from anyone.

## Changes to this policy

Changes are listed at the bottom of this page and in Kotiko's changelog before they take
effect. If Kotiko ever needs to send something new, it will ask you first.

## Contact

Questions about this policy: hello@scriptkittyos.com. ScriptKittyOS holds no data about
you, so there is nothing for it to look up or delete; to remove your data, use Delete
everything in Kotiko's Settings.

## Changelog

- **Version 2, 6 October 2026.** Added "Connecting OpenRouter": the one-time sign-in code
  passes through kotiko.org.
- **Version 1, 5 October 2026.** First version.
