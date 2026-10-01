# 05 · Learner experience: onboarding, daily use, motivation, mistakes

Scope: what a learner sees and does, from installing Slovo to using it for months. Backend
choices are covered elsewhere; here they matter only for what the learner has to understand
or type. File references are to the repository as of 2026-10-01.

## 1. Summary

- **The first run is a dead end for anyone who is not running the server themselves.** A
  fresh install syncs with no token, shows "Paste your API token to connect." and opens the
  Connection panel pointing at `http://localhost:4747` (`background.js:5, 10`, `popup.js:123-133`).
  No welcome page, no explanation, and nothing on a web page changes. The first swapped word
  ("aha") can't arrive until setup is finished, which the README estimates at about 10 minutes
  with Elixir installed (`README.md:21`).
- **Bundled starter packs plus a welcome tab would bring the aha down to seconds**, with no
  backend and no model calls. They also protect the free model quota: the README puts the free
  tier at about 50 requests a day (`README.md:27`), so building a 50-word pack through the
  model would use up a whole day.
- **Adding a word works, but the edge cases lose data or hide what happened.** Re-adding a word
  you already have says "Added", and Undo then deletes the original (`router.ex:39`,
  `words.ex:60-68`, `popup.js:169-172`). If the model returns several words, they are all
  saved and share one Undo. If you close the popup mid-add, the word is saved but you never see
  which word it was (`background.js:64-66`).
- **The extension has no way to see or fix your words.** There is no list, search or edit, and
  the API has no update route (`router.ex:17-67`). Telegram `/list` shows the 15 newest
  (`bot.ex:130`), and `/remove thanks` deletes every word whose English is "thanks", in every
  language, without asking (`words.ex:92-99`, `bot.ex:159-167`).
- **The core learning surface is a native `title` tooltip** (`content.js:65-71, 96`). It
  appears after a delay, can't be styled, can't play audio, and doesn't work with touch or the
  keyboard. Replacing it with a real popover makes room for speak, "I knew it", edit and pause.
- **Nothing on the page tells languages apart.** They all get the same dotted underline
  (`content.css:1-8`), and a repeated English word rotates through languages
  (`content.js:87-89`). A learner strong in Spanish and new to Mandarin can't tell at a glance
  which one they are looking at.
- **Errors come straight from server internals**, for example "no model could answer
  (qwen/...: returned 500: ...)" (`llm.ex:95-101`) or "Check LLM_API_KEY in .env"
  (`llm.ex:137-142`). That makes no sense to someone on a hosted server. Words you already
  have keep working offline, but the popup never says so.
- **Motivation features (stats, reveal mode, review, celebrations) should be local, opt-in,
  quiet, and respect reduced motion.** Avoid streak guilt. Mobile is limited by the platforms:
  Firefox for Android is the realistic target, and Telegram stays the mobile way to add words.

## 2. Journeys and scenarios

Format: **Scenario**: today (code) → why it matters → recommendation.

### First run

**S1. Install from a store, click the icon.** The service worker syncs on install
(`background.js:52-55`) and fails with "Paste your API token to connect." (`background.js:10`).
The popup shows that in red and opens Connection with a placeholder telling you to copy
"API_TOKEN from your .env" (`popup.html:146`). → Someone who installed from a store has no
`.env`. The first thing they see is an error about a file they've never heard of. →
Open a welcome tab on install (`runtime.onInstalled`, reason `install`). Make the popup's
not-connected state a friendly card ("Finish setting up") instead of a red error.

**S2. Choosing a backend.** Today the only path is self-hosting (`README.md:21-69`). → The
owner's top value is "easy regardless of the backend". The learner should choose by what they
want ("try it now", "use my own server"), not by infrastructure terms. → The welcome tab
offers: (a) start with a starter pack, no account (local-only); (b) connect to a server, with
a "Test connection" button that confirms URL, token and model in one go. Show any hosted option
here only if the org runs one.

**S3. Time to aha.** After connecting, the README tells you to type `shukran` and then find a
page containing "thanks" (`README.md:65-68`). → The learner has to go looking for proof that it
works. → Show the result right away. The welcome tab renders a sample paragraph with the
learner's chosen words already swapped, using the same matcher. The content script doesn't run
on extension pages, so the tab does this itself. Then offer "Open a page to try it" with a
suggested article.

**S4. Starter packs.** None exist. Empty state: "No words yet. Add one above, in any language."
(`popup.js:62`). → A blank list on day one gives the learner nothing to see. Packs built through
the model would use up the free quota (`README.md:27`). → Ship curated static JSON packs
(language, native, romanization, english, forms, note), reviewed by humans. Start with 20-50
high-frequency, low-ambiguity words per language (avoid "like", "right", "fine"). Show a
preview so the learner can untick words before importing. Packs work with no server at all.

**S5. Wording of the status line.** It reads "12 words known, synced 3 min ago"
(`popup.js:129`). → "Known" is wrong for words you've just started, and "synced" is jargon. →
"12 words · Spanish 9, Arabic 3". Sync details move into Connection.

### Adding words

**S6. Add box, happy path.** Free text goes to the background and on to `POST /api/words`.
The model is always told this is an "add" (`llm.ex:52-56`, `router.ex:34`). The result shows
"Added شكرا (shukran) = thanks · Arabic undo" (`popup.js:137-175`). RTL is isolated with
`<bdi>` (`popup.js:156`). → This is good and should be kept. → Add a speak button and an
"Edit" link to the result line.

**S7. Re-adding a word you already have.** The server upserts by (lang, native)
(`words.ex:60-68`) and returns it, and the popup says "Added". Undo calls DELETE
(`popup.js:171`), which removes the word you had before. The bot handles this correctly with
"Already in your list." (`bot.ex:226-229`). → This loses data quietly. → The server should
return `created | updated | unchanged` per word. The popup then says "Already in your list",
and Undo restores the previous version or is hidden.

**S8. The model returns several words** (for example "thank you and goodbye in arabic"). All
are saved as active (`router.ex:39`) and share one Undo (`popup.js:171`). → The learner can't
keep one and drop another. → Show one row per word, each with its own remove button. When the
input is longer than a few words, show a confirm step ("Add 3 words?").

**S9. Pasting a phrase or sentence.** The add box forces intent "add" (`llm.ex:52-56`), so a
pasted sentence can save many words with no confirm. Multi-word English forms do match on pages
(`content.js:49` turns spaces into `\s+`). → The learner may have wanted the phrase as a single
item, or just one word from it. → If the input is more than about 4 words, show a choice: "Save
as a phrase" or "Pick words from it" (checkbox list).

**S10. Typing an English word by mistake** ("dog"). The prompt makes the model guess the
language from your recent ones (`llm.ex:165-173`), so "dog" becomes the word in whatever
language you used last. → This is sometimes what you wanted, sometimes not. → Always show the
language as a chip that can be changed in place ("Spanish ▾"). For an English-only input, also
offer the other languages ("perro · Spanish. Also: собака, 犬").

**S11. Typo or ambiguous transliteration** ("spaseeba", "da"). The model handles misspellings
and uses recent languages to break ties (`llm.ex:10-14, 165-173`). The README's advice is
"undo the wrong one" (`README.md:199`). → Undo-and-retype is two steps and depends on the
learner noticing. → Put a "Wrong? Try: Serbian · Croatian · other..." line under the result.
The model can return alternatives cheaply in the same call.

**S12. Wrong language picked, noticed a week later.** No way to change a word's language, or
anything else about it: there is no update route (`router.ex`). → The learner has to delete,
re-add, and hope the model gets it right this time. → Add `PATCH /api/words/:id` and an edit
form in the word manager (S17).

**S13. Closing the popup mid-add.** The background finishes the request (comment at
`background.js:64-66`), but the result lives only in the popup's DOM (`popup.js:195-197`).
Reopening shows nothing. The typed text is gone too. → The learner thinks it failed and adds
again (see S7). → Save the last add result and any unsent draft to `storage.local` and show
them on reopen. Optionally show a system notification "Added perro (Spanish)" (needs the
`notifications` permission, so it should be opt-in).

**S14. Right-click a selected English word → "Learn this in Spanish".** Not possible: there
is no `contextMenus` permission (`manifest.json:6`). → Adding a word at the moment you read it
is the most natural flow. → Context menu "Learn “dog” in" with one submenu item per language you
already have, plus "Another language...". Send only the selection, not the URL.

**S15. Right-click a foreign word on a foreign page → "Add to Slovo".** Not possible. → Learners
browse sites in their target language too. → Same menu, shown when the selection isn't English.
Pass the page's `<html lang>` as a hint so the model doesn't have to guess.

**S16. Keyboard shortcut and quick add.** There is no `commands` key in the manifest. →
Keyboard users and frequent adders have to click the icon every time. → Use `_execute_action`
to open the popup (the add field is already focused, `popup.js:237`). Add "toggle swaps" and
"cycle languages: all → each language". Chrome caps suggested shortcuts per extension, so
choose a few defaults and let the rest be set at `chrome://extensions/shortcuts`.

**S17. Bulk paste or import** (a list from a textbook, or an Anki deck). Not supported. One
model call per add. → A learner who arrives with existing vocabulary can't bring it in, and
looking up one item at a time would use up a free quota quickly. → Bulk add: a textarea, one
item per line, with a "native = english" format that skips the model entirely. Lines without
an English meaning go to the model in batches, and everything is reviewed in a table before
saving. Import CSV/TSV, which Anki can export as plain text. Duolingo has no official
vocabulary export that we can rely on, so accept pasted lists rather than promise an
integration.

**S18. Adding from Telegram on the phone.** Lookup shows a card with Add/Skip
(`bot.ex:238-243`). The extension syncs every minute and on page load (`background.js:48-50`,
`content.js:191`), so the word is live on the next page. → This is the best mobile story Slovo
has today. → Keep it. Note that an ignored card leaves a hidden "pending" row
(`bot.ex:239`), so pending rows should expire.

**S19. Offline or model failure while adding.** The learner sees "Can't reach
http://localhost:4747. Is the server running?" (`background.js:20`), or a raw model error
(`router.ex:52`). → The learner has no next step. → Plain messages (section 3.5) plus "Add
it yourself": fields for native, English and language that save without the model. When
offline, queue the add and retry later.

### Managing words

**S20. "What have I added?"** No list in the extension. The status line shows only a count
(`popup.js:128-129`). Telegram `/list` shows 15 (`bot.ex:130`). → Browsing your own words is
basic to feeling progress and to fixing mistakes. → A word manager on a full extension page
(S21).

**S21. Edit, delete, pause one word, retire, move language, see source.** Delete exists only
as Undo or `/remove`. `source_text` is stored (`word.ex:14`) but not sent to the extension
(`word.ex:57-68`), and neither are timestamps. → Learners need to fix romanization, add a note,
remove a form that swaps wrongly, or pause a word. → Add the word manager (wireframe 3.3) and
send `status`, `source_text`, `inserted_at` and `updated_at`. Add a status per word: active,
paused, and "well known" (keeps swapping but without the underline; see S28).

**S22. Telegram `/remove thanks`.** It matches native, romanization or English, then deletes
every match (`words.ex:92-99`, `bot.ex:165`). → One command can wipe a word in all your
languages. → When there is more than one match, list them with buttons and confirm before
deleting.

### Daily use and the learning loop

**S23. Reading a page.** Every occurrence of every active form is swapped (`content.js:84-100`).
Buttons, links, labels and `aria-label`s are not skipped (`content.js:7-10` skips only
code-like and form elements). → A swapped "Delete" or "Send" button turns an interface into a
puzzle at the worst moment. A beginner with many words on one dense page can lose the thread. →
By default, skip `button`, `[role=button]`, `nav` and `label`. Add an optional density setting:
"Swap every time / about half / first per paragraph".

**S24. Hover to check a word.** The tooltip is the `title` attribute (`content.js:96`) with
`cursor: help` (`content.css:7`). → It appears late, looks different in every browser, has
no audio, and does nothing on touch or for keyboard users. → A custom popover (wireframe 3.2),
opened on hover-intent, click or tap, and keyboard focus. It goes in a closed shadow root so
page CSS doesn't leak in.

**S25. Wrong sense in context.** Forms are limited to the main meaning (`llm.ex:47-49`), but
the matcher has no context: if "like" (to like) is saved, "looks like rain" still gets swapped.
→ This teaches a wrong mapping. → Popover action "Wrong meaning here": remove that form, or
skip the word on this sentence pattern. For packs, prefer words with low ambiguity.

**S26. Test-yourself mode.** Not present. → Hovering shows the answer straight away, so the
learner never has to recall it. → Reveal mode: the popover shows only native and romanization,
with "Show English" behind a click. The learner answers "I knew it" or "Didn't know". It's a
global toggle, off by default.

**S27. Hearing the word.** No audio. → Pronunciation matters, and romanization alone is lossy.
→ A speak button using `speechSynthesis` with a voice that matches `lang`. Which voices exist
depends on the OS and browser, so hide the button when no voice matches rather than mumbling
in English. Chrome's `chrome.tts` is an alternative, but it's Chrome-only.

**S28. Spaced repetition, light.** Not present. → "Didn't know" should mean you see the word
more; "knew it" several times should mean you're done drilling it. → Keep counters per word,
locally first. Words you got wrong get a stronger underline and swap every time. "Well known"
words keep swapping (immersion is the point) but lose the underline, so they read like ordinary
text. Don't schedule reviews and don't send notifications.

**S29. Stats, streaks and recap.** Not present. → Seeing progress keeps people going, but
streak counters punish missed days. → Count locally, with no URLs stored: swaps seen today per
language, words added this week, and "words you checked most". A weekly recap card in the
popup, not a notification. No streak counter by default. If the owner wants one, show "days
active this month" so a missed day doesn't reset anything.

**S30. Celebrations** (the owner's confetti idea). Not present. → Milestones feel good if
they're rare and easy to turn off. Drawing confetti over third-party pages is intrusive, and a
page that is "nearly all foreign" won't happen for most learners until very late. →
Celebrate in the popup or the word manager: the first swap ever, the first word in a new
language, 10/50/100/500 words. A page-level moment fires at most once a day when swaps on one
page pass a threshold the learner sets. Off when `prefers-reduced-motion` is set, with a setting
to turn it off everywhere.

### Mixing languages

**S31. Which language is this?** All swaps look the same (`content.css:1-8`), and repeated
words rotate (`content.js:87-89`). The rotation counter resets on every re-apply
(`content.js:143-149`), so a word can change language mid-read after a sync. → For a learner
with several languages, recognizing the language is part of the task. → Optional color per
language for the underline, using an accessible palette, with the name also shown in the
popover (never rely on color alone). Keep the rotation stable for each page view.

**S32. Strong in Spanish, new to Mandarin.** Each language is either on or off
(`popup.js:66-94`). → The learner may want lots of Spanish but just a little Mandarin. → An
intensity per language (off / some / all), applied through the density setting from S23.

**S33. Per-site preferences and quick switch.** Only pause per site (`popup.js:208-213`). The
"only" link appears on hover or focus (`popup.html:99-100`), so on touch it never shows. → A
learner may want Mandarin only on a news site, or a fast way to switch languages. → Per-site
language override (P2). Make "only" always visible. A shortcut to cycle languages (S16).

### Errors and states

**S34. Server down, token wrong, rate limited.** These replace the word count in red
(`popup.js:123-126`). Swapping keeps working from the cache in `storage.local`. → The learner
assumes everything is broken. → "Can't reach your Slovo server. Your 42 words still work on
pages; adding new ones will work once it's back." Rate limit: "The free word lookup is busy.
Try again in a minute, or add it yourself." The server should send error codes so the
extension can word (and later translate) its own messages.

**S35. Off, paused, or an unsupported page.** The global toggle and pause leave no visible
trace. On `chrome://` pages the pause checkbox is just disabled (`popup.js:116-119`). → The
learner forgets they paused a site and thinks Slovo stopped working. → Toolbar badge for off
or paused. In the popup: "Slovo can't run on browser pages" instead of a greyed-out checkbox.

### Accessibility, language of the interface, mobile

**S36. Keyboard and screen reader.** The popup's form labels and focus rings are good
(`popup.html:78, 113-116`). Swapped spans set `lang` (`content.js:94`), so screen readers can
switch voice. The tooltip can't be reached by keyboard. → A screen reader user hears a foreign
word with no way to get the English. → Make swapped words focusable only while reveal or
keyboard mode is on (focusing every swap would clutter the tab order). The popover opens with
a shortcut, and its text is linked to the word.

**S37. Contrast, motion, readability.** Text colors pass 4.5:1: about 5.0, 5.0 and 5.8 in
light mode, 6.0, 5.1 and 8.3 in dark (`popup.html:7-27`). But the input border
(`#dfe6ef` on `#fff`) is about 1.3:1, below the 3:1 that non-text UI needs. The graph-paper
background (`popup.html:36-40`) runs behind small 13px text in a fixed 300px popup. → This
hurts low-vision and dyslexic readers. → Darker borders, a plain background option (or none
when `prefers-contrast: more`), sizes in `rem`, base 14px. A "reading aid" option that shows
romanization above the word with `<ruby>`, which helps beginners with non-Latin scripts.

**S38. Language of the interface, and base languages other than English.** All strings are
hard-coded English: popup, background errors, server errors, the bot's help text
(`bot.ex:15-32`). Language names come from `Intl.DisplayNames(["en"])` (`popup.js:29`). The
matcher's `\b` works only with ASCII word characters (`content.js:51`), and the prompt is
written for English (`llm.ex:10`). → Many learners don't speak English as a first language.
A Spanish speaker learning English is a different product. → Next: move strings into
`_locales` and use `chrome.i18n` (and the browser locale for language names). Later: a "page
language" setting with Unicode-aware boundaries (`\p{L}`) and a prompt per base language.

**S39. Mobile.** Chrome on Android has no extensions. Firefox for Android supports them, and
the manifest has a Gecko id (`manifest.json:22`). iOS Safari extensions have to ship inside an
App Store app. On touch there is no hover, so tooltips never show. → Expectations need setting
on day one. → Supported: Firefox for Android, with the tap popover from S24. A tap inside a
link must not get in the way of following it (use long-press there). Telegram is the way to add
words on mobile. iOS is a later slice. The word manager should also work as a page served by
the server, so phones can manage words.

## 3. UX recommendations and wireframes

### 3.1 First run: welcome tab (opens on install)

```
+------------------------------------------------------------------+
|  Slovo                                                           |
|  Read the web in the words you're learning.                      |
|                                                                  |
|  Before:  "Thanks for the coffee, see you tomorrow."              |
|  After:   "Gracias for the café, see you mañana."                 |
|                                          (live, from your choice) |
|  1  What are you learning?                                       |
|     [Spanish v] [+ another]                                      |
|                                                                  |
|  2  Start with some common words?                                |
|     (o) 30 starter words  [preview list]                         |
|     ( ) I'll add my own                                          |
|                                                                  |
|  3  Where should new words be looked up?                         |
|     (o) Not yet, just the starter words (works offline)          |
|     ( ) My Slovo server   URL [______________]                   |
|                           Token [___________]  [Test]            |
|                           ok  Server  ok  Token  ok  Lookups     |
|                                                                  |
|  [ Start ]   Then open any English page. Tip: pin Slovo.          |
+------------------------------------------------------------------+
```

### 3.2 Word popover (replaces the `title` tooltip)

```
  ...see you soon, 谢谢 for reading.
                  ^ dotted underline, language color optional
  +-------------------------------------------+
  | 谢谢   xièxie                 [speaker]   |
  | Mandarin                                  |
  | thanks                       (hidden in   |
  |                               reveal mode)|
  | Verb. "谢谢你" = thank you.               |
  | Also: gracias · спасибо (spasibo)         |
  |-------------------------------------------|
  | [I knew it] [Didn't know]                 |
  | Wrong meaning here · Pause word · Edit    |
  +-------------------------------------------+
  Opens on hover-intent, click/tap, or a keyboard shortcut on focus.
  Esc closes it. Shadow DOM. Max width 280px.
```

### 3.3 Word manager (full extension page, also reachable from the popup)

```
+--------------------------------------------------------------------+
| Your words (42)     [Search......]  [All langs v] [Active v]  [+Add] |
|--------------------------------------------------------------------|
| [ ] Native     Say        English        Lang     Added    Status    |
| [ ] gracias    —          thanks         Spanish  Sep 30   active    |
| [ ] شكرا       shukran    thanks         Arabic   Sep 28   active    |
| [ ] 狗         gǒu        dog            Mandarin Sep 20   well known|
|--------------------------------------------------------------------|
| Selected: [Pause] [Move language] [Delete]   [Import] [Export CSV]   |
+--------------------------------------------------------------------+
  Row click -> edit drawer: native, romanization, English, forms
  (one per line), note, language, "Added from: 'how do you say dog'".
  Delete shows an Undo toast for 10 s.
```

### 3.4 Popup (300px, reorganized)

```
+------------------------------+
| Слово                 [gear] |
| 42 words · Spanish 30, ...   |
| [shukran, dog in japanese.][+]|
| Added gracias = thanks · Span|
|   [speak] [edit] [undo]      |
|------------------------------|
| Languages      [all] [cycle] |
| [x] Spanish  30   only       |
| [x] Arabic   12   only       |
|------------------------------|
| [x] Swap words on pages      |
| [ ] Pause on example.com     |
| This week: 214 swaps seen    |
| [Your words ->]              |
+------------------------------+
```

### 3.5 Settings page (gear) and error wording

```
Reading     Density [every time v]   Skip buttons and menus [x]
            Colors per language [ ]  Show pronunciation above words [ ]
Learning    Reveal mode [ ]   Celebrations [x] (off with reduced motion)
            Weekly recap [x]
Shortcuts   Open Slovo  Alt+Shift+S   Toggle swaps  Alt+Shift+X  [change]
Connection  Server [....]  Token [....]  [Test]   Status: ok
Data        [Export] [Import] [Delete everything]
```

Error copy: say what happened, what still works, and what to do next. Never name `.env`,
model ids or status codes in the main line. Put technical detail behind a "Details" toggle
for self-hosters.

## 4. Open questions for the owner

1. Will ScriptKittyOS run a shared server, or is the public story self-host plus local-only
   starter packs? This decides step 3 of the welcome tab.
2. Should "well known" words keep swapping without the underline (recommended), or stop
   swapping altogether?
3. Should the popup add box keep saving immediately, or show a card first like the bot's
   lookup (`bot.ex:238-243`)? Recommended: save immediately, but confirm when there is more
   than one word.
4. Gamification appetite: no streaks at all, or "days active this month"? Celebrations on or
   off by default?
5. Where do learning signals (knew it / didn't know, swaps seen) live: only in the browser,
   or synced to the server so Telegram and several devices can use them?
6. Who are starter packs for: complete beginners (mostly nouns) or people coming back to a
   language? Which languages first, and who reviews them?
7. How important is mobile: Firefox for Android at launch, or later?
8. Is "base language other than English" in scope this year?

## 5. Proposed slices

| Slice | Goal | Size | Priority | Depends on |
|---|---|---|---|---|
| welcome-tab | Open on install: pick a language, a starter pack or a server, Test connection, live preview | M | P0 | starter-packs, plain-errors |
| starter-packs | Curated static word packs bundled in the extension; preview and untick before import; no model calls | M | P0 | local-word-store |
| local-word-store | Words can live in the extension with no server; sync merges when a server is connected | M | P0 | (backend research) |
| plain-errors | Server returns error codes; the extension shows plain messages that say what still works and the next step | S | P0 | none |
| add-result-safety | Report created/updated/unchanged; Undo restores instead of deleting; Undo per word; last result kept if the popup closes | S | P0 | none |
| manual-add | Add a word yourself (native, English, language) with no model; also used when lookups fail or you're offline | S | P0 | local-word-store |
| word-api-edit | `PATCH /api/words/:id`; include status, source_text and timestamps in JSON | S | P0 | none |
| word-manager | Full extension page: list, search, filter, edit, delete with undo, pause, move language, export | M | P0 | word-api-edit |
| word-popover | Replace `title` with an accessible popover (hover, click, tap, keyboard) in shadow DOM | M | P0 | none |
| popup-a11y-pass | Border contrast, rem sizes, "only" always visible, plain background option, badge for off/paused | S | P0 | none |
| skip-ui-controls | Don't swap inside buttons, nav, labels, or links' accessible names | S | P1 | none |
| context-menu-add | Right-click "Learn this in..." and "Add to Slovo" with the page language as a hint | S | P1 | add-result-safety |
| shortcuts | Open popup, toggle swaps, cycle languages | S | P1 | none |
| speak-word | speechSynthesis button in the popover and popup; hidden when no voice matches | S | P1 | word-popover |
| language-colors | Optional accessible underline color per language, with a legend and the name in the popover | S | P1 | word-popover |
| reveal-mode | Test-yourself: show English only on demand; knew-it / didn't-know buttons | M | P1 | word-popover |
| bulk-add | Paste many lines; "native = english" skips the model; review table before saving | M | P1 | add-result-safety |
| reading-aid-ruby | Optional romanization above swapped words | S | P1 | none |
| telegram-safe-remove | `/remove` with several matches lists them and asks to confirm; pending cards expire | S | P1 | none |
| firefox-android | Verify on Firefox for Android; tap popover that doesn't break links; mobile popup layout | M | P1 | word-popover |
| density-and-intensity | Global swap density plus intensity per language (off/some/all) | S | P2 | none |
| review-light | Local counters; words you missed swap more and get a stronger underline; "well known" loses the underline | M | P2 | reveal-mode |
| local-stats-recap | Swaps seen and words added per language, weekly recap card; no URLs stored | M | P2 | none |
| milestones | Quiet celebrations in the popup or manager; optional page moment; reduced-motion aware | S | P2 | local-stats-recap |
| import-csv | CSV/TSV import (including Anki plain-text export) with column mapping | M | P2 | bulk-add |
| sense-feedback | "Wrong meaning here" removes a form or records a context to skip | M | P2 | word-popover, word-api-edit |
| ui-i18n | Move all strings to `_locales`; language names in the browser locale | M | P2 | plain-errors |
| per-site-languages | Choose which languages show on each site | S | P2 | none |
| base-language | Pages in languages other than English: Unicode boundaries, prompt per base language | L | P2 | ui-i18n |
| ios-safari | Package for Safari on iOS and macOS | L | P2 | firefox-android |
