---
title: Messages and what to do
description: Every message Kotiko can show when something goes wrong, what it means and what to do.
---

When something goes wrong, Kotiko says what happened in one line. This page has one entry per
message: what happened, what still works, and what to do. Each entry has its own address,
such as `kotiko.org/help/errors/#offline`, so a link can open it directly.

Your words keep working on pages in almost every case below. Most problems only stop
**new** words from being looked up.

**Details** under a message shows technical facts (an HTTP status, a reason) and never your
words. **Copy details** copies them, ready to paste into a [bug report](https://github.com/ScriptKittyOS/kotiko/issues).

## Connecting to your Kotiko server

Apart from "You're offline", these only appear if you connected your own
[Kotiko server](/server/).

<h3 id="offline">You're offline</h3>

"You're offline. Your words still work on pages; new words will be looked up when you're back."

- **What happened:** your computer has no internet connection.
- **What still works:** every word you have, on every page.
- **What to do:** nothing. Words you add now wait, and Kotiko looks them up when you're back
  online.

<h3 id="server_unreachable">Can't reach your Kotiko server</h3>

"Can't reach your Kotiko server. Your words still work on pages; adding new ones will work
once it's back."

- **What happened:** the server didn't answer. It may be stopped, or your computer may not
  be on the same network as it.
- **What still works:** the words Kotiko already has.
- **What to do:** start the server, or reconnect to the network it's on. Kotiko tries again
  by itself; **Try again** checks now.

<details>
<summary>For self-hosters</summary>

Check that the server runs: `curl http://127.0.0.1:4747/health` on its machine should print
`{"ok":true,...}`. Check that the address in Kotiko's settings matches `PORT` and `BIND`. A
proxy in front of the server that answers 502, 503 or 504 shows this message too. See
[Using the server from another machine](/server/remote-access/).

</details>

<h3 id="server_address_invalid">That server address doesn't look right</h3>

"That server address doesn't look right. Try one like http://127.0.0.1:4747."

- **What happened:** the address in Kotiko's settings isn't a web address Kotiko can use, or
  the server refused the name you reached it by.
- **What still works:** your words.
- **What to do:** open **Settings**, then **Your Kotiko server**, and correct the address. It
  starts with `http://` or `https://`.

<details>
<summary>For self-hosters</summary>

"Your Kotiko server doesn't answer to the name in this address" means the server answered
`421`: it only answers to `localhost`, IP addresses and its own machine's name, so a website
can't reach it through DNS rebinding. Use its IP address, or add the name to `ALLOWED_HOSTS`
in `server/.env` and restart. See the [configuration reference](/server/configuration/#allowed_hosts).

</details>

<h3 id="not_kotiko_server">It isn't a Kotiko server</h3>

"Something answered at that address, but it isn't a Kotiko server. Check the address."

- **What happened:** another program answered at that address.
- **What to do:** check the port number. Kotiko's server uses 4747 unless you changed `PORT`.

<h3 id="server_key_rejected">Your server didn't accept the access key</h3>

"Your Kotiko server didn't accept the access key. Paste it again in Connection settings."

- **What happened:** the access key saved in Kotiko isn't the one your server uses.
- **What still works:** the words Kotiko already has.
- **What to do:** paste the access key again in **Settings**, **Your Kotiko server**.

<details>
<summary>For self-hosters</summary>

The access key is the server's API token. In the `server` folder, `mix kotiko.token` prints
it. If you set `API_TOKEN` in `.env`, it's that value (or, with `API_TOKEN_FILE`, the
contents of that file).

</details>

<h3 id="server_outdated">Your server needs an update</h3>

"Your Kotiko server needs an update for this. Everything else still works."

- **What happened:** the extension asked for something your server's version doesn't have
  yet.
- **What to do:** [update the server](/server/updates/).

<h3 id="address_changed">Where Kotiko sends your words was changed</h3>

"Where Kotiko sends your words was changed outside its settings, so it sent nothing there.
Open Settings, check your word lookups and server address, and save them again."

- **What happened:** the address of your word lookup service or your server was changed
  without going through Kotiko's settings. To keep your words and keys safe, Kotiko sent
  nothing there.
- **What to do:** open **Settings**, check **Word lookups** and **Your Kotiko server**, and save
  them again. If you didn't change anything, tell us: [report it as a security
  problem](https://github.com/ScriptKittyOS/kotiko/security/policy).

## Pages and permissions

<h3 id="permission_missing">Kotiko needs permission to read pages</h3>

"Kotiko needs permission to read pages to swap words."

- **What happened:** your browser hasn't given Kotiko access to websites. Firefox asks for
  this separately.
- **What to do:** select **Allow**. Kotiko reads page text only inside your browser and never
  sends it anywhere.

<h3 id="unsupported_page">Kotiko can't run on this page</h3>

"Kotiko can't run on browser pages like this one."

- **What happened:** browsers don't let extensions change their own pages, such as settings,
  the new tab page and extension stores.
- **What to do:** nothing; open any website and Kotiko works there.

## Word lookups

<h3 id="lookup_not_set_up">Word lookup isn't set up</h3>

"To look up new words, set up word lookup. Your words, and words you type as “word =
meaning”, work without it."

- **What happened:** Kotiko has no AI service to look words up with yet.
- **What still works:** all your words, and adding words with their meaning, like
  `gato = cat`.
- **What to do:** open **Settings**, **Word lookups**, and [choose a service](/providers/). A
  free [OpenRouter](/providers/openrouter/) key is the easiest.

<details>
<summary>For self-hosters</summary>

"Word lookup isn't set up on your Kotiko server yet" means the server has no `LLM_API_KEY`.
Set it in `server/.env` and restart the server: it reads `.env` only when it starts.

</details>

<h3 id="key_rejected">The service didn't accept your key</h3>

"OpenRouter didn't accept your key. Check it in Settings." (with the name of your service)

- **What happened:** the AI service refused the key: it was mistyped, deleted, or has run
  out of credit.
- **What still works:** your words, and adding words with their meaning.
- **What to do:** open **Settings**, **Word lookups**, select **Replace** and paste the key
  again. If you deleted it on the service's site, make a new one. A sign-in with **Connect
  OpenRouter** that took more than 10 minutes also ends here: start it again.

<details>
<summary>For self-hosters</summary>

"…didn't accept your Kotiko server's key" is about `LLM_API_KEY` in `server/.env`. Fix it,
then restart the server.

</details>

<h3 id="quota_exhausted">You've used today's free lookups</h3>

"You've used today's free lookups. Add words yourself, or try again after …"

- **What happened:** free AI keys allow a number of lookups a day. On OpenRouter's free
  models that is 50 a day, or 1,000 a day once you have bought $10 of credit (checked on
  6 October 2026; [OpenRouter's limits](https://openrouter.ai/docs/api-reference/limits)).
- **What still works:** all your words; adding words with their meaning; the lookups come
  back the next day.
- **What to do:** wait, or add words as `word = meaning`. Words you add now wait and are
  looked up when the limit resets. The toolbar popup shows how many lookups are left once
  20 or fewer remain.

If the message says the service **needs credit on your account**, the service wants a
payment method or credit before it will answer, even for free models. Add credit on its
site, or choose another service.

<h3 id="rate_limited">Word lookup is busy</h3>

"Word lookup is busy. Try again in a minute, or add the word yourself."

- **What happened:** too many lookups in a short time. Free OpenRouter keys allow 20 a
  minute.
- **What to do:** wait a minute, then **Try again**.

<h3 id="model_unavailable">Word lookup isn't answering</h3>

"Word lookup isn't answering right now. Try again in a little while, or add the word
yourself."

- **What happened:** the AI models were busy or down. Free models are shared and get busy.
- **What to do:** **Try again** later. Kotiko tries the next free model by itself.

<h3 id="lookup_timeout">That lookup took too long</h3>

"That lookup took too long. Try again, or add the word yourself."

- **What happened:** the service didn't answer in time.
- **What to do:** **Try again**. A model running on your own computer can be slow the first
  time it loads.

<h3 id="bad_lookup_result">The lookup came back garbled</h3>

"The lookup came back garbled. Try again, or add the word yourself."

- **What happened:** the AI answered with something Kotiko couldn't read as a word.
- **What to do:** **Try again**. If it keeps happening with one model, choose another in
  **Settings**, **Word lookups**.

## Adding words

<h3 id="no_word_found">Couldn't find a word</h3>

"Couldn't find a word in “…”. Try the word on its own, or add it yourself."

- **What happened:** the AI couldn't tell which word you meant.
- **What to do:** type just the word, or ask in your own words: "how do you say dog in
  Japanese". Or add it with its meaning: `perro = dog`.

<h3 id="rejected_same_as_gloss">That's already a word in your language</h3>

"“…” is already a word in English. Try naming the language you want it in." (with your
language)

- **What happened:** what you typed is a word in a language you read, so there is nothing
  to learn yet.
- **What to do:** name the language: "dog in Japanese".

<h3 id="input_too_long">That's a lot of text for one word</h3>

"That's a lot of text for one word. To add a list of words, use bulk add."

- **What to do:** to add many words at once, use [Add a list of words](/use/bulk-add/).

<h3 id="empty_input">Type a word to add</h3>

"Type a word to add."

- **What to do:** type a word, a question, or `word = meaning`.

<h3 id="invalid_word">That isn't a valid word</h3>

"That isn’t a valid word. Check what you typed, then try again."

- **What happened:** the word, its language or its writing system didn't pass Kotiko's
  checks, for example Latin letters for a language written in another script.
- **What to do:** check the spelling and the language, then try again.

<h3 id="word_conflict">This word changed since you opened it</h3>

"This word changed since you opened it. Open it again to fix." Or: "Another word is
already spelled like that, with the same meaning."

- **What happened:** the word was changed somewhere else (another tab, your server), or you
  already have this word.
- **What to do:** open the word again and make your change, or keep the one you have.

<h3 id="word_gone">That word was already removed</h3>

"That word was already removed."

- **What to do:** nothing. To get it back, add it again.

<h3 id="vocabulary_full">You have 20,000 words</h3>

"You have 20,000 words, the most Kotiko keeps. Delete some to add more."

- **What to do:** delete words you know well in the word list (open your words from the
  toolbar popup), then add more.

## Storage

<h3 id="storage_full">Kotiko couldn't save in this browser</h3>

"Kotiko couldn't save in this browser because the disk is full. Your words still work on
pages; free some disk space, then try again."

- **What happened:** the browser couldn't save. Usually the disk is full.
- **What to do:** free some disk space, then try again.

The same entry covers three related messages:

- **"Kotiko is still open in a tab from before an update."** Close Kotiko's other tabs, then
  try again.
- **"This browser won't let Kotiko keep words here."** Private windows, and some privacy
  settings, block storage. Open Kotiko in a normal window.
- **"Everything Kotiko kept in this browser was just deleted."** Open Kotiko again to start
  fresh, and [restore a backup](/use/your-data/) if you have one.

## Something else

<h3 id="internal">Something went wrong in Kotiko</h3>

"Something went wrong in Kotiko. Try again; if it keeps happening, please report it."

- **What happened:** a mistake in Kotiko itself.
- **What to do:** **Try again**. If it keeps happening, select **Copy details** and [open an
  issue](https://github.com/ScriptKittyOS/kotiko/issues) with what you were doing. The details
  never contain your words.
