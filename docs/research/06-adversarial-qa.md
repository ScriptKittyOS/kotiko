# 06 - Adversarial QA / red-team review of Slovo

Scope: every file in `extension/` and `server/` as of 2026-10-01. Method: line-by-line reading, then probes. The probes were jsdom runs of the real `content.js`, a Node VM harness for the real `background.js`, `mix run` scripts against a throwaway SQLite database, and HTTP probes against a scratch server on port 4811. That server pointed at a local fake OpenAI-compatible LLM on port 4812. No probe touched the owner's server on 4747, `server/.env`, or OpenRouter. Probe scripts are in the session scratchpad (`qa/`). Every finding says **[ran]** (reproduced) or **[reasoned]** (derived from the code), and gives a confidence.

## 1. Summary

- **Critical auth bypass.** A percent-encoded path such as `GET /%61pi/words` skips the Bearer check, but the router still serves it. Unauthenticated callers can then list, add (which spends LLM quota) and delete words. The README tells people to bind to `0.0.0.0` or a Tailscale IP, so on those setups anyone on the network has full access. DNS rebinding can also reach a localhost-only install.
- **The content script can break React/Vue pages.** It swaps site-owned text nodes for new nodes, and on every settings change it calls `normalize()` on site elements. Framework references go stale (the UI stops updating), and `removeChild` throws `NotFoundError`. That is the same class of bug that crashes React apps under Google Translate.
- **Word matching is wrong in common text.** ASCII `\b` treats apostrophes, hyphens, accented letters and inline-element boundaries as word edges. "can't" becomes "можно't", "passé" becomes "проходé", "résumé" becomes "réсуммаé", and "hot<wbr>dog" becomes "hotсобака". Acronyms (IT, US, WHO) and single-letter forms ("a") get replaced too.
- **Data integrity on add.** Adding a word you already have overwrites it: the note and romanization are wiped and the English forms are replaced. The popup still reports "Added", and Undo then deletes the old word. Two concurrent adds of the same word raise `Ecto.ConstraintError` and return HTTP 500.
- **Adds can hang for minutes.** Every model gets a 60 s timeout and there is no overall deadline, so one add can take 300 s with the default 5-model list (measured: 180 s with 3 models). A MV3 service worker may be killed during that wait. Every failed add also uses one free-quota request per model.
- **Sync races in background.js.** A word added or undone while a sync is in flight is cached stale until the next sync. A fixed token or URL saved during an in-flight sync is overwritten by the old error.
- **No guardrails on model output.** One answer was accepted with 500 words whose forms included "the", "a", "and" and "is". Request text has no length limit (220 KB was forwarded to the model).
- **Ops fragility.** `run.sh` never refetches deps after an update. A typo in `BIND` or `ALLOWED_TELEGRAM_IDS` crashes the server at boot with a raw error. `start_permanent` is false and the server runs with `--no-halt`, so if the supervisor dies the process stays up with the API dead and systemd never restarts it.

Verified safe (no finding): there is no XSS path. Every word field reaches the page through `textContent`, `title` or `dataset`, and Telegram messages use no `parse_mode`. `//api`, `/API`, `/api/../api`, a lowercase `bearer` and duplicate Authorization headers are all handled correctly. `secure_compare` is used. Invalid UTF-8, JSON arrays, deeply nested JSON and non-string `text` all get a 400. Unwrapping restores the original case and whitespace exactly. Pages with no `document.body` (SVG/XML) are skipped.

## 2. Findings table

| id | severity | component | title |
|---|---|---|---|
| F01 | critical | server/router | Percent-encoded path (`/%61pi/...`) bypasses Bearer auth for GET/POST/DELETE |
| F02 | high | content.js | Replacing site-owned text nodes breaks React/Vue (stale UI, `removeChild` NotFoundError) |
| F03 | high | content.js | `unwrapAll()` + `normalize()` merges site text nodes on every word/setting change |
| F04 | high | content.js | ASCII `\b`: replaces inside contractions, hyphenated and accented words |
| F05 | high | server/words | Re-adding a known word overwrites note/romanization/forms, and Undo deletes the original |
| F06 | high | server/words | Concurrent upsert of the same word: `Ecto.ConstraintError`, HTTP 500 / bot error |
| F07 | medium | content.js | Text-node edges treated as word edges ("hot<wbr>dog" becomes "hotсобака") |
| F08 | medium | content.js | Endless rewrite loop with sites that re-render text they own |
| F09 | medium | server/llm + background | Add can block for 60 s x models (300 s default); MV3 worker may die; no deadline |
| F10 | medium | background.js | Add/undo during an in-flight sync caches a stale word list |
| F11 | medium | background.js | New token/URL saved during an in-flight sync is ignored and old error shown |
| F12 | medium | server/llm | No cap on words per add or sanity check on forms (500 words, "the"/"a" accepted) |
| F13 | medium | content.js | Case-insensitive match hits acronyms (IT, US, WHO) and single-letter forms |
| F14 | medium | server/llm | Every failed/no-word add uses one request per model (5x quota burn) |
| F15 | medium | content.js | Orphaned content script keeps swapping after extension disable/update (Chrome) |
| F16 | medium | popup.js | A sync landing while you edit Connection resets the other field, so the old URL gets saved |
| F17 | medium | server/bot | Invalid `lang` from model: bot MatchError dumps a changeset and drops remaining words |
| F18 | medium | server/bot | `/remove thanks` deletes every language's word, with no confirmation or undo |
| F19 | medium | ops | `start_permanent: false` + `--no-halt`: supervisor exit leaves a zombie process |
| F20 | medium | run.sh | Deps fetched only if `deps/` is missing, so an update crash-loops the service |
| F21 | medium | server/router | No length limit on `text`; JSON parsed (up to 8 MB) before auth |
| F22 | low | content.js | Forms with non-word edges never match (C++, C#, .NET, U.S., "thank you!") |
| F23 | low | content.js | `matchCase` capitalizes Georgian into Mtavruli |
| F24 | low | content.js | Regex scaling: 15k forms takes 435 ms, 30k takes 4 s, per 240 KB page per tab per change |
| F25 | low | content.js | Observer bound to the original `document.body`; body swap or `document.open` stops swapping |
| F26 | low | content.js | Shadow DOM and iframes never processed |
| F27 | low | server/router | `DELETE /api/words/99999999999999999999999` returns 500 (Exqlite argument error) |
| F28 | low | server/llm | `extract_json` fails on trailing prose with `}` or two JSON objects; object-shaped `words` dropped |
| F29 | low | server/words | Empty-string language name becomes the sticky canonical name |
| F30 | low | popup.js | Undo shows "Removed." even when the delete failed |
| F31 | low | background.js | HTTP 200 with a non-JSON body counts as a successful sync |
| F32 | low | background.js | Server address without a scheme gives a misleading "Can't reach" error |
| F33 | low | server/bot | Telegram 4096-char limit: long cards/transcripts fail silently (no Undo button) |
| F34 | low | config | `BIND=localhost`, a bad ID list, or a whitespace-only `API_TOKEN` fail badly at boot |
| F35 | low | install-service.sh | Unquoted `PATH`/dir in unit file; `.env` world-readable |
| F36 | low | security | README suggests plain HTTP on LAN; token readable by every content script |
| F37 | low | popup.js | Quick successive language toggles lose a change (stale `s.hiddenLangs`) |
| F38 | low | server/bot | Pending words from lookups are never cleaned up |
| F39 | low | background.js | Alarm only created on install/startup, not on re-enable |
| F40 | low | server | "database is locked" errors from the pool on first boot; user text logged at info |

## 3. Findings detail

### F01 critical: auth bypass via percent-encoded path [ran, confidence high]
Repro (scratch server): `curl http://127.0.0.1:4811/%61pi/words` returns `200 {"words":[...]}` with no header. `curl -H 'Content-Type: application/json' -d '{"text":"hello"}' .../%61pi/words` returns 200, saves the word and calls the LLM. `curl -X DELETE .../%61pi/words/1` returns `{"ok":true}`. `/ap%69/words` works too.
Cause: `authorize/2` (`router.ex:86`) pattern-matches the raw `conn.path_info` (`["%61pi", "words"]`). `Plug.Router` matches routes on `Plug.Router.Utils.decode_path_info!/1` (`deps/plug/lib/plug/router.ex:251`), which decodes to `["api","words"]`. So the plug sees no `/api` prefix and the router serves the protected route.
Impact: with `BIND=0.0.0.0` or a Tailscale IP, as the README suggests, anyone who can reach the port can read, add or delete words and drain the owner's LLM quota. On localhost, a DNS-rebinding page (Bandit does not check `Host`) gets same-origin access without needing the token.
Fix: default-deny. Require the token for every path except an exact `["health"]` match, decode before comparing, or move the API into a `forward "/api"` sub-router whose own pipeline authenticates. Add a `Host` allowlist. Add regression tests for encoded, double-slash and case variants.

### F02 high: in-place text-node replacement breaks frameworks [ran in jsdom, confidence high]
Repro: build `<div>` children `"You have "`, `"3"`, `" new messages from your friends"` (React's output for `You have {n} new messages…`), then add the words "messages" and "friends". `processText` replaces the third node with a fragment (`content.js:103`). Afterwards `t3.isConnected === false`. Setting `t3.nodeValue = " new alerts"` leaves the page unchanged, and `div.removeChild(t3)` throws `NotFoundError: The node to be removed is not a child of this node`.
Impact: React, Preact, Vue and Svelte keep references to their text nodes. Updates go to detached nodes, so the page shows stale text, and unmounting throws. Without an error boundary that blanks the whole app. This is the well-known Google Translate crash (facebook/react#11538). It hits any SPA that re-renders text containing a known word.
Fix: never detach the site's node. Keep the original text node in place holding the text before the first match, and insert the spans and tail text as new siblings. Record node-to-spans in a WeakMap. When a `characterData` mutation hits an original node, remove its sibling spans and reprocess. On unwrap, merge back into the original node. Keep "Pause on this site" as the escape hatch, and consider a built-in skip list (`[data-reactroot]` subtrees are too broad; per-site defaults are better).

### F03 high: `normalize()` on site elements [ran, confidence high]
Repro: append the text nodes `"Hello "`, `"Bob"`, `", nice dog"` after load. The observer swaps "dog". Then make any storage change (a language toggle, a sync that changes words, enable/disable). `apply()` calls `unwrapAll()`, which runs `p.normalize()` on every parent (`content.js:140`). Child count goes from 4 to 2, and `a` and `b` are both disconnected. Setting `b.nodeValue = "Alice"` leaves the page reading "Hello Bob, nice собака".
Impact: the same framework breakage as F02, but it happens on every word or setting change in every open tab, including text nodes Slovo never matched.
Fix: drop `normalize()`. Restore the exact original nodes as in F02, or merge only the text nodes Slovo itself created.

### F04 high: ASCII word boundaries [ran, confidence high]
Repro text: `I can't go. Don't. It's a well-known passé résumé café. The cafés. A naïve sum.` with forms can, don, well, pass, sum, café, it.
Output: `I можно't go. Дон't. Это's a хорошо-known проходé réсуммаé café. The кафеs. A naïve сумма.`
Cause: `new RegExp("\\b(?:…)\\b","gi")` (`content.js:51`). Without lookarounds, `\b` only knows ASCII `[A-Za-z0-9_]`. An apostrophe, a hyphen or an accented letter counts as a boundary. A form that ends in a non-ASCII letter ("café") can only match when a word character follows it ("cafés").
Impact: ugly half-replacements on almost every English page (contractions are everywhere), and corrupted foreign words on multilingual pages.
Fix: use Unicode lookarounds with the `u` flag: `(?<![\p{L}\p{M}\p{N}_'’-])(?:…)(?![\p{L}\p{M}\p{N}_'’-])`. Decide case by case whether "can't" should match "can" (probably not). Add a fixture table to the tests.

### F05 high: re-add overwrites existing word; Undo deletes it [ran, confidence high]
Repro: an existing active word `спасибо` with note "My own mnemonic", romanization "spasibo" and forms thanks/thank you. Re-add it with a model answer that has `note: null, romanization: null, english: "thank you", english_forms: []`. Same row id, `note=nil`, `rom=nil`, `forms=["thank you"]`. The word no longer replaces "thanks". Over HTTP, POST returns it in `words`, the popup says "Added спасибо…", and clicking undo calls DELETE on the original id.
Cause: `Words.upsert` (`words.ex:61`) runs `Word.changeset/2` with `empty_values: [nil]` (`word.ex:25`), so nils overwrite. The router reports every upserted row as newly added (`router.ex:39`). The bot avoids this by checking `status: "active"` first; the API does not.
Impact: silent loss of the user's notes and forms, and a destructive Undo.
Fix: on update, merge only non-nil fields and union the forms. Return `created: true/false`. The popup should say "Already known" and hide Undo for existing words.

### F06 high: concurrent upsert race [ran, confidence high]
Repro: 8 parallel `Words.upsert` calls for (ja, 犬) gave `%{ok: 1, Ecto.ConstraintError: 7}`. Over HTTP, 6 parallel POSTs of the same text gave five 200s and one 500 with an empty body. The extension shows "The server answered 500."
Cause: read-then-insert with no transaction and no `unique_constraint` (`words.ex:61-68`). The unique index exists in the migration, so Ecto raises. Realistic triggers: popup add plus the Telegram bot at the same time, a popup retry after a long wait (F09), or two Telegram messages processed by concurrent Tasks.
Fix: `Repo.insert(on_conflict: {:replace, [...]}, conflict_target: [:lang, :native])` or add `unique_constraint`, retry as an update, and test it.

### F07 medium: text-node boundaries count as word boundaries [ran]
Repro: `<p>hot<wbr>dog, do<span>g</span>, ice <b>cream</b></p>` gives "hotсобака". Each text node is matched on its own (`processText`), so a word split by `<wbr>`, a search-highlight `<mark>`, or a syntax-highlighting span gets its tail replaced, while real phrases split across elements ("ice <b>cream</b>") never match.
Fix: before matching, check the neighbouring character in the adjacent text (previous/next text node within the same block) for a boundary. At minimum, skip a match at index 0 when the previous inline sibling ends with a letter.

### F08 medium: rewrite ping-pong with self-healing sites [ran]
Repro: a page whose own MutationObserver restores `p.textContent` whenever a `.slovo-w` span appears. Slovo re-swaps 250 ms later, the site restores it, and so on: 11 cycles in 3 s, never ending (the Node process never exited and had to be killed). `flush()` drops only Slovo's own records; nothing detects that the site keeps reverting the change.
Fix: count rewrites per element (WeakMap). After N reverts within T seconds, mark the element as skipped and log once.

### F09 medium: unbounded add latency; MV3 worker lifetime [ran timing, reasoned on the worker; confidence medium]
Repro: the fake LLM sleeps 65 s and `LLM_MODEL=m1,m2,m3`. POST returned `502 … m1: timeout; m2: timeout; m3: timeout` after **180.0 s**. The default list has 5 models, so the worst case is about 300 s plus connect time (`llm.ex:124`, `receive_timeout: 60_000`, applied per model). `background.js:74` awaits that `fetch` with no timeout. Chrome's documented MV3 rules terminate a worker whose `fetch()` response takes longer than 30 s, or whose single event runs longer than 5 min. The popup then gets "No answer from the extension", the word may still be saved on the server, and a retry hits F06 or burns quota again.
Fix: set an overall deadline (for example 45 s) and lower per-model timeouts (15 s). Alternatively return `202 {job}` and poll, or keep a `runtime.connect` port open. Make adds idempotent with a client request id.

### F10 medium: stale cache after add/undo during sync [ran harness]
Repro: a GET sync is in flight (slow server), then an add completes. `add()` calls `sync()`, which returns the in-flight promise (`background.js:29`) whose response was snapshotted before the insert. Result: add returned `["new"]`, cached words `["old"]`. Undo has the mirror effect: the removed word keeps showing. Either way it lasts up to 60 s or until the next page load more than 5 s later.
Fix: use a generation counter. If `sync()` is requested while one is running, chain one more sync after it.

### F11 medium: credential change ignored during in-flight sync [ran harness]
Repro: token "bad" with a slow 401 in flight. The user saves the correct token, `storage.onChanged` calls `sync()`, and that returns the old in-flight promise. Final state: `syncError = "The server rejected that API token."`, `lastSync` unset. The popup shows the error after the fix and stays wrong until the next alarm. An unreachable Tailscale IP can make the stale request hang for more than a minute.
Fix: abort the in-flight request (`AbortController`) when credentials change and start a fresh sync. Ignore results from a superseded generation.

### F12 medium: no output guardrails [ran]
Repro: the fake model returned 500 words, each with `english_forms: ["the","a","and","is"]`. POST answered 200 and `GET /api/words` then held 504 active words (93 KB). Every "the" on every page becomes a foreign word. Triggers: a confused free model, or prompt injection in the add box or a voice transcript ("ignore previous instructions…"). The input is the owner's own, so injection risk is low, but bad model output is not.
Fix: cap words per add (5), cap form length and count, reject forms in a stopword list unless the user explicitly typed that word, and require `english` to be one of the forms.

### F13 medium: acronyms and single letters [ran]
Repro: forms it, us and a. "the IT team" becomes "ЭТО team". `Vitamin A.` becomes `Vitamin Ein.` "I think a cat is a pet" puts "ein" in place of each "a". The `i` flag (`content.js:51`) makes "IT", "US" and "WHO" match "it", "us" and "who". German "ein" and French "un" are very common first words, so "a" is a realistic form.
Fix: do not match all-caps tokens of 2 to 4 letters unless the form itself is uppercase. Skip single-letter forms unless explicitly allowed. Never match a single uppercase letter after a noun ("Vitamin A", "Plan B").

### F14 medium: quota amplification [ran]
Repro: inputs that make the fake model return no word, HTTP 502, 429 or a 200-with-error each produced 3 calls with 3 models (`llm.ex:75-91`). With the 5 default models, one typo in the add box uses 5 of the 50 free daily requests the README quotes. That is about 10 bad adds per day.
Fix: retry on "found no word" at most once. Stop on 402/403. Back off on 429 instead of walking the whole list. Report remaining quota.

### F15 medium: orphaned content scripts [reasoned, confidence high for Chrome]
When the extension is disabled, reloaded or updated, Chrome leaves the old content-script world running. `storage.onChanged` stops firing, but the `MutationObserver` (`content.js:176`) keeps swapping new content (infinite scroll, chat) with the old matcher. The popup toggle can't turn it off in those tabs.
Fix: in `onMutations`, check `ext.runtime?.id`. If it is gone, `observer.disconnect()` and `unwrapAll()`.

### F16 medium: Connection form clobbered by syncs [reasoned, confidence high]
`render()` (`popup.js:104-108`) rewrites whichever Connection field is not focused, and it runs on every `storage.onChanged`. Each sync writes `lastSync` every minute and on page loads elsewhere. Typing a new server URL, tabbing to the token field, and then hitting a sync resets the URL. "Save connection" then stores the old URL with the new token.
Fix: track a dirty flag per input and stop overwriting dirty fields. Re-render only the parts the change touched.

### F17 medium: invalid language codes in the bot [ran on API, reasoned on bot]
`normalize_lang("i-klingon")` returns `"i"` and `"x-klingon"` returns `"x"`. Both fail `@lang_format`. Through the API with a mixed answer, the invalid word was silently dropped. With only invalid words, the response was 422 `lang has invalid format ("i")`. In the bot, `{:ok, w} = Words.upsert(...)` (`bot.ex:232,239`) raises MatchError. `safe_handle` then sends "Error: no match of right hand side value: {:error, #Ecto.Changeset<…>}" and the rest of the words in that message are skipped.
Fix: handle `{:error, cs}` with a friendly message per word. Map common legacy tags (`i-klingon` to `tlh`, `zh-TW` to `zh-Hant`).

### F18 medium: `/remove` is a bulk delete [ran on `Words.find`]
`Words.find("thanks")` matched 3 words (ru, ar, zh) and `find("да")` matched 2 (ru, sr). `/remove` deletes them all at once, including pending ones, with no confirmation (`bot.ex:159-168`). With several `ALLOWED_TELEGRAM_IDS`, which the README invites, any user can wipe shared words.
Fix: when more than one word matches, reply with one Remove button per word. Add an Undo.

### F19 medium: zombie VM [reasoned, confidence medium-high]
`mix.exs:9` sets `start_permanent: Mix.env() == :prod`. `run.sh` runs `mix run --no-halt` in the dev environment, so the app is temporary. If `Slovo.Supervisor` exceeds its default restart intensity (3 restarts in 5 s), the application stops but the VM stays alive. For example, the Bot crashes repeatedly if Telegram returns an unexpected `result` shape and `List.last/1` raises. Systemd sees a running process and never restarts it, and the API stays down.
Fix: `start_permanent: true` always, or run a release, or use `--no-halt` together with an `Application.stop` handler that halts.

### F20 medium: deps never refreshed [reasoned, confidence high]
`run.sh:15` runs `[ -d deps ] || mix deps.get`. After a `git pull` that changes `mix.lock`, `mix run` exits with "dependencies are out of date". Under the unit file (`Restart=on-failure`, `RestartSec=5`) that is an endless restart loop that only shows up in journald.
Fix: always run `mix deps.get` (it does nothing when deps are current), or compare `mix.lock` against a stamp file. Add `StartLimitBurst` to the unit.

### F21 medium: input size limits [ran]
A 220 KB `text` was forwarded to the model as is (fake LLM saw `len: 220000`). The log line is truncated by `inspect` at 4 KB. `Plug.Parsers` runs before `:authorize` (`router.ex:7-8`): an unauthenticated 3.8 MB JSON body was fully parsed (0.17 s) before the 401, and the default limit is 8 MB.
Fix: reject `text` longer than about 200 chars. Put auth before parsing. Set `length: 64_000` on `Plug.Parsers`.

### F22 low: forms with non-word edges never match [ran]
`C++`, `C#`, `.NET`, `U.S.`, `$5` and `thank you!` produced no matches (`\b` needs a word character on one side). `node.js` works. The model can emit such forms, which then fail silently.
Fix: covered by the F04 lookarounds. Also trim punctuation from forms on the server.

### F23 low: Georgian capitalization [ran]
"Thanks a lot. THANKS!" with ka მადლობა gives "Მადლობა … ᲛᲐᲓᲚᲝᲑᲐ". `toUpperCase()` maps Mkhedruli to Mtavruli, which Georgian prose doesn't use. The same applies to any script with Unicode case mappings that its orthography ignores.
Fix: apply `matchCase` only for scripts whose orthography uses case (Latin, Cyrillic, Greek, Armenian), keyed on the script.

### F24 low: matcher scaling [ran]
A 242 KB page with N alternatives scanned in 1 ms at N=1k, 117 ms at 5k, 435 ms at 15k and 3972 ms at 30k. The 30k jump suggests V8 fell back to the slower regex interpreter. The work is repeated in every tab on every word change (`apply()`). That is years away for most users, but it is a cliff.
Fix: tokenize words with `Intl.Segmenter` or a Unicode word regex, look up in a `Map`, and handle multi-word phrases with a small trie.

### F25 low: body replacement [ran]
After `document.documentElement.replaceChild(newBody, document.body)`, the new body's "another dog" was never swapped: the observer is attached to the old body (`content.js:176`). Some SPAs and `document.open()` do this.
Fix: observe `document.documentElement`, or re-attach when `document.body` changes.

### F26 low: shadow DOM and frames [reasoned]
The TreeWalker doesn't enter open shadow roots, and `manifest.json` has no `all_frames`. Text in web components (for example Reddit's new UI) and in same-origin iframes is never swapped.
Fix: walk `el.shadowRoot` when present and observe it. Consider `all_frames` plus `match_about_blank`.

### F27 low: 500 on huge DELETE id [ran]
`DELETE /api/words/99999999999999999999999` returns `500` with an empty body. The log shows `Exqlite.Error argument error`. `Integer.parse` accepts bignums (`router.ex:61`).
Fix: bound the id to 1..2^63-1, or validate it with `~r/^\d{1,18}$/`.

### F28 low: brittle JSON extraction [ran on two objects, reasoned on trailing brace]
Two JSON objects in one answer failed on all models with `unexpected byte at position 28`. Trailing prose such as `… (see {note})` would fail the same way, because `extract_json` slices from the first `{` to the last `}` (`llm.ex:176-187`). When `words` is an object keyed by word, it is wrapped as one malformed word and dropped. When `english_forms` is a string (`"five, fives"`), it is stored as a single form that never matches.
Fix: try `Jason.decode` on the content first, then on the first balanced object (a brace scanner that respects strings). Accept `words` as a map of values. Split string forms on commas.

### F29 low: sticky empty language name [ran]
The first word saved with `language: ""` makes `keep_language_name` (`words.ex:72`) return `""` for later words ("Arabic" became ""), and `langs_matching("arabic")` returns `[]`, so `/list arabic` says there are no words. The bot's `language_name` shows an empty label.
Fix: treat blank as nil in `clean/1` and in `keep_language_name`.

### F30 low: Undo hides failures [reasoned]
`popup.js:169-173` ignores the `{error}` that `background.js` returns and always prints "Removed.".
Fix: check each response, report partial failure, and keep the Undo button active.

### F31 low: non-JSON 200 treated as success [ran harness]
A captive portal or a wrong service answering 200 with HTML results in `syncError: null`, `lastSync` set, and `words` written as `undefined` (`background.js:23`). The popup claims "synced just now". How storage treats `undefined` differs between Chrome and Firefox; I didn't verify this in a browser.
Fix: validate `Array.isArray(body.words)` and otherwise report "That address isn't a Slovo server".

### F32 low: scheme-less server address [ran harness]
For `localhost:4747`, `new URL()` parses `localhost:` as a scheme. For `192.168.1.5:4747`, the address resolves relative to `chrome-extension://…`. Both report "Can't reach … Is the server running?" (`background.js:11-20`).
Fix: validate with `new URL()` on save and add `http://` when the scheme is missing.

### F33 low: Telegram length limit [reasoned, confidence high]
`sendMessage` rejects text over 4096 characters. A long `note` in `card/1`, a long transcript echoed back (`bot.ex:188`), or `/languages` with hundreds of languages fail. `Telegram.call` errors are ignored there, so the word is saved but the user never sees the card or the Undo button.
Fix: truncate notes to about 300 characters at save time, and split or truncate outgoing text.

### F34 low: config validation [reasoned, confidence high]
`BIND=localhost` or a MagicDNS name hits `{:ok, ip} = :inet.parse_address(...)` (`application.ex:17`), which crashes at boot with a MatchError. `ALLOWED_TELEGRAM_IDS=123,abc` crashes in `runtime.exs:24`. `API_TOKEN="   "` passes the empty check because it is trimmed after the check (`runtime.exs:8`), so the server starts with an empty token. HTTP header trimming makes this hard to exploit, but it is still wrong.
Fix: validate config with human-readable errors, resolve hostnames with `:inet.getaddr`, and trim before checking for an empty value.

### F35 low: install-service quoting and permissions [reasoned]
`Environment=PATH=$PATH` and `ExecStart=$dir/run.sh` (`install-service.sh:20-21`) are unquoted. Systemd splits on spaces and treats `%` as a specifier, so a path such as `~/My Projects` breaks. `cp .env.example .env` creates a 0644 file containing the API keys.
Fix: quote the values, escape `%`, and `chmod 600 .env` in both scripts and in the README.

### F36 low: transport and token storage [reasoned]
The README recommends `BIND=0.0.0.0` "on a trusted network" with `http://`, so the Bearer token crosses the LAN in cleartext. Combined with F01, no token is even needed. The token sits in `storage.local`, which every content script can read in every page's renderer.
Fix: recommend Tailscale or HTTPS only. Move the token to `storage.session` plus a copy in `local` accessed only from the worker, or call `setAccessLevel` where supported.

### F37 low: language toggle race [reasoned]
Checkbox handlers compute from the `s.hiddenLangs` captured at render time (`popup.js:74-76`). Two toggles before the re-render cause the second write to undo the first.
Fix: read the current value from storage inside the handler.

### F38 low: pending rows accumulate [reasoned]
Every bot lookup upserts a `pending` row that is never cleaned up unless Skip is tapped. `/remove` matches them as well (F18).
Fix: prune pending rows older than 7 days.

### F39 low: alarm on re-enable [reasoned, confidence medium]
`ensureAlarm()` runs only in `onInstalled` and `onStartup` (`background.js:52-59`). Re-enabling a disabled extension fires neither event. Syncs then rely only on page-load messages.
Fix: call `ensureAlarm()` at top level (`alarms.get` first).

### F40 low: first-boot lock errors; logging [ran]
On a fresh data directory, the log showed `Exqlite.Connection … failed to connect: database is locked` from pool connections racing on the WAL setup. They recover, but it alarms new users. Every lookup is logged at info with the user's text and the model's answer (`llm.ex:76,81`).
Fix: set `pool_size: 1` during migration or configure `journal_mode` explicitly. Log lookups at debug level.

## 4. Testing recommendations

None of these would have survived a modest test suite. Suggested CI (GitHub Actions; Elixir and Node jobs in parallel):

1. **Router auth matrix (ExUnit + `Plug.Test`)**: every route x {no header, bad token, good token} x path spellings (`/api`, `/%61pi`, `/ap%69`, `//api`, `/API`, `/api/../api`). Assert that nothing except `GET /health` returns non-401 without the token. Catches F01.
2. **LLM contract tests with `Req.Test` stubs**: table-driven fixtures (prose wrapper, two objects, `<think>`, words as object/string/null, numbers, 500 words, 429/401/402/5xx/200-error, slow response). Assert the number of model calls, the total elapsed-time budget and the stored rows. Catches F09, F12, F14, F17 and F28.
3. **Words integrity**: re-add preserves the note and unions forms; `created` flag; 20 concurrent upserts give 1 row and 0 exceptions. Catches F05 and F06. Add property tests for `normalize_lang` (StreamData) that check the output either passes `@lang_format` or is rejected with a message.
4. **Content-script unit tests (jsdom, `node --test`)**: a boundary fixture table (contractions, hyphens, accents, acronyms, single letters, punctuation forms, Georgian, `<wbr>`/`<mark>` splits) with expected output. Node-identity tests: after swap and unwrap, the original text node objects are still connected and `removeChild` works. A ping-pong page must stop after N cycles. Body replacement must keep working. Catches F02-F04, F07, F08, F13, F22, F23 and F25.
5. **Real-browser smoke (Puppeteer or Playwright with the unpacked extension in Chromium)**: a fixture React 18 app that toggles a list containing known words. It must not throw and must keep updating. Also cover a shadow DOM component, a same-origin iframe, and disable/re-enable of the extension. Catches F02, F15, F26 and F39.
6. **background.js harness** (as in `bg.mjs`): add or remove during an in-flight sync, credential change during sync, a 200 HTML body, and URLs without a scheme. Catches F10, F11, F31 and F32.
7. **Performance budget**: matcher build plus scan of a 250 KB fixture with 10k forms must take under 50 ms. Catches F24.
8. **Lint and static checks**: `mix format --check-formatted`, `mix compile --warnings-as-errors`, `credo`, `web-ext lint`, and `shellcheck run.sh install-service.sh` (shellcheck flags the unquoted unit values in F35).

## 5. Proposed slices

| short-kebab-name | goal | size | priority | dependencies |
|---|---|---|---|---|
| api-auth-default-deny | Authenticate on decoded paths with default deny; Host allowlist; parse body after auth with a 64 KB limit; regression tests (F01, F21, F27) | S | P0 | none |
| content-node-preserving-swap | Keep site text nodes attached, drop `normalize()`, restore original nodes on unwrap, handle `characterData` on originals (F02, F03, F25) | M | P0 | test-harness-ci |
| unicode-boundary-matcher | Unicode lookaround boundaries, punctuation-edge forms, acronym and single-letter policy, case rules per script, cross-node boundary check (F04, F07, F13, F22, F23) | M | P0 | test-harness-ci |
| word-upsert-integrity | Atomic `on_conflict` upsert, merge instead of overwrite, `created` flag, "Already known" in popup, safe Undo (F05, F06, F29, F30) | S | P0 | none |
| test-harness-ci | ExUnit + Req.Test, jsdom tests, Puppeteer smoke with a React fixture, GitHub Actions workflow | M | P0 | none |
| llm-guardrails | Text length cap, words-per-add cap, form validation/stopwords, robust JSON extraction, less retry fan-out, overall deadline (F09 server side, F12, F14, F28) | S | P1 | test-harness-ci |
| add-request-lifecycle | Idempotent add with client id; 202 + poll or port keepalive so worker death doesn't lose results (F09 client side) | M | P1 | llm-guardrails |
| background-sync-generations | Follow-up sync after an in-flight one, abort on credential change, validate response shape and URL (F10, F11, F31, F32, F39) | S | P1 | none |
| content-lifecycle-guards | Orphan detection, rewrite loop breaker, shadow roots and frames (F08, F15, F26) | S | P1 | content-node-preserving-swap |
| bot-hardening | Handle upsert errors, message length limits, `/remove` disambiguation + undo, pending cleanup (F17, F18, F33, F38) | S | P1 | word-upsert-integrity |
| ops-hardening | `start_permanent`, always `deps.get`, config validation with clear errors, unit file quoting, `chmod 600 .env`, quieter logs (F19, F20, F34, F35, F40) | S | P1 | none |
| popup-state-hygiene | Dirty-tracking for Connection inputs, read-modify-write for language toggles (F16, F37) | S | P2 | none |
| token-and-transport | Docs: Tailscale/HTTPS only; move token out of content-script-readable storage (F36) | S | P2 | api-auth-default-deny |
| matcher-performance | Map/trie tokenizer instead of one giant alternation; incremental rebuild (F24) | M | P2 | unicode-boundary-matcher |
