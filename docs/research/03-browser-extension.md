# 03 - Browser, DOM, extension platform, performance, compatibility, accessibility

Scope: how Slovo's content script and background worker behave on real sites, in real browsers, under store review, and for users of assistive technology. Code references are to `extension/` as of version 0.2.0. Platform facts that change often carry a confidence note.

## 1. Summary

- **The biggest risk before a public release is breaking other sites.** `processText` replaces a site's text node with a fragment (`content.js:103`). React, Vue and similar frameworks keep references to those nodes. Later updates then either change a node that is no longer in the page (stale text) or throw `NotFoundError: Failed to execute 'removeChild'`, which can blank a whole app. Google Translate causes the same class of bug on React sites. Slovo needs a less destructive way to swap text, plus a cleanup path.
- **Matching is ASCII-only and ignores the page's language.** `\b` in a non-`u` regex (`content.js:51`) treats accented letters as word boundaries. In a local test, a pattern containing `sum` and `rich` matched inside "résumé" and "Zürich". Nothing checks `<html lang>` or element `lang`, so German, French or Spanish pages get English words swapped by mistake ("Hand", "also", "on", "come").
- **The single-regex approach does not scale to large vocabularies.** In a Node 22 benchmark over 100,000 short text nodes, matching alone took about 60 ms with 1,000 words, 430 ms with 5,000 and 880 ms with 20,000. A tokenizer plus a `Set` lookup stayed at 60-80 ms at every size. On top of that, all DOM work runs in a single synchronous task (`content.js:129-131`), which causes long main-thread stalls on big pages.
- **Coverage gaps:** only the top frame is processed, and the script never looks inside Shadow DOM. Because the observer watches `document.body` (`content.js:176`), it stops working when a site swaps out the body element (Turbo/Hotwire-style navigation). In Chrome, tabs that were open before install or update get nothing until they are reloaded.
- **The tooltip is a native `title` attribute** (`content.js:96`). Keyboard users can't reach it, touch screens never show it, it can't be styled, and screen readers handle it inconsistently. A single custom popover in its own shadow root is the right replacement, and it also opens the door to a mobile (Firefox Android) story.
- **Platform plumbing:** Firefox MV3 adds `upgrade-insecure-requests` to the extension page CSP by default. That probably breaks the README's "server on a Tailscale IP over http" setup (medium confidence). Firefox users can revoke host permissions at any time, and the server sends no CORS headers. In Chrome, extensions that hold host permissions are exempt from Local Network Access prompts, but that only works reliably from Chrome 144 (a bug was fixed in late 2025).
- **Privacy and fingerprinting:** every site can read `.slovo-w` spans, `data-en` and `title`, and so learn that the user runs Slovo and which words and languages they are studying. Session-replay tools record the same data. Slovo never sends page text anywhere (good, and worth saying in the store listing), but the DOM leak should be minimized and disclosed.
- **There are no tests.** A small refactor that turns the matcher into pure functions, plus jsdom unit tests, Playwright end-to-end runs with the unpacked extension against a fixture corpus, `web-ext lint`, and a performance budget in CI, would make every later change safe.

## 2. Scenarios

### A. Frameworks and dynamic pages

**A1. A React or Vue app updates a text node Slovo replaced.**
- Today: `processText` swaps the original node for a fragment (`content.js:103`). The framework still holds the old node. On the next update it sets `nodeValue` on a node that is no longer in the page (the visible text silently goes stale), or calls `parent.removeChild(oldNode)`, which throws. That is the same failure mode as React issue #11538 with Google Translate.
- Why it matters: crashes appear as "this site is broken", and users blame the site or uninstall Slovo. Single-page apps are where users spend most of their time.
- Recommendation: use `splitText` so the original node object stays in the DOM, holding the text before the first match, with the spans and remainder inserted after it. When the framework edits or removes that node, the observer sees it and removes the orphaned siblings that Slovo created (track them in a `WeakMap` keyed by the original node). Duplicated text for a moment is much better than an exception. Keep a per-site "safe mode" list for apps that still misbehave. Do not patch `Node.prototype.removeChild` in the page's main world: it is invasive and hard to justify in review.

**A2. Server-side rendering plus hydration (Next.js, Nuxt, SvelteKit).**
- Today: the script runs at `document_idle`, which can come before hydration finishes on slow pages. React then sees a DOM that differs from its server HTML. React 18 and 19 report a recoverable hydration error and re-render the subtree on the client, throwing away Slovo's spans. The observer then redoes the work.
- Why it matters: the work happens twice, words flicker, and in rare cases the app behaves badly.
- Recommendation: on pages that show framework markers (`#__next`, `[data-reactroot]`, `#__nuxt`, `data-sveltekit-*`), wait for a quiet period (no mutations for about 500 ms, or a `requestIdleCallback`) before the first pass. Measure whether this is worth the added complexity.

**A3. The site replaces `<body>` on navigation (Turbo Drive, some PJAX sites, parts of GitHub).**
- Today: `observer.observe(document.body, ...)` (`content.js:176`) stays attached to the old body. The new body is never processed.
- Why it matters: everything works on the first page and silently stops after the first click.
- Recommendation: observe `document.documentElement` and treat a new `BODY` as an added root.

**A4. Live tickers, timers and relative timestamps ("3 hours ago").**
- Today: every `characterData` change is queued and re-matched after 250 ms (`content.js:160-169`). If the text contains a known word, the node is replaced. The site's next `nodeValue` update then lands on the detached node and the timer freezes on screen. A clock that ticks every second also costs a regex run every 250 ms.
- Recommendation: the `splitText` approach from A1 fixes the freeze. Also add a per-node rewrite budget: after N rewrites in M seconds, mark the node's parent as "volatile" and leave it alone.

**A5. Infinite-scroll feeds (X, Reddit, Mastodon, LinkedIn).**
- Today: added subtrees are walked after a fixed 250 ms timer (`content.js:169`). The timer starts at the first mutation, so it acts as a throttle, not a trailing debounce. New posts appear in English and then switch about 250 ms later, which causes a visible flash and layout shift, because the words change width.
- Recommendation: process small batches (for example under 200 text nodes) right away inside the MutationObserver callback. Observer callbacks run as microtasks before the next paint, so the user never sees the English. Defer only large batches to idle chunks. Feeds that virtualize and recycle DOM nodes are covered by A1.

**A6. Language rotation flips on re-render.**
- Today: `turns` counts swaps per matcher in DOM order (`content.js:87-89`), and every re-render advances it. A React list that re-renders, or the timer case in A4, can change the language of the same word each time.
- Recommendation: pick the language deterministically, for example `hash(english + nearby text) % candidates`, so a given spot on the page keeps its language.

**A7. Extension update or reload while tabs are open.**
- Today: in Chrome, the old content script keeps running its DOM code, but extension API calls start throwing "Extension context invalidated". `storage.onChanged` no longer fires, so its spans go stale. Chrome does not inject the new script into open tabs. Firefox does re-inject (medium confidence), and then the new script skips the old spans because of the `MARK` check (`content.js:108`), so the stale spans stay for good.
- Recommendation: on startup, the content script fires a `slovo:hello` DOM event. Older instances listen for it, disconnect their observer and unwrap their spans. Wrap API calls in a check that `ext.runtime?.id` is still valid. In `onInstalled`, use `scripting.executeScript` and `insertCSS` to inject into existing tabs in Chrome (needs the `scripting` permission; host access is already granted).

**A8. First install: nothing happens on open tabs.**
- Today: there is no injection into existing tabs in Chrome. A new user installs, looks at the article they already had open, sees no change and assumes the extension is broken.
- Recommendation: same as A7. Also open a welcome or onboarding page after install that demonstrates the swap.

### B. Site types

**B1. Code views (GitHub's code viewer, Monaco, CodeMirror 5, Ace, diff views).**
- Today: only `CODE`, `PRE`, `KBD` and `SAMP` are skipped (`content.js:7-10`). GitHub's current code view renders lines in plain `div`s. Monaco and Ace render plain `div`/`span` text that is not contenteditable. Words inside source code get swapped. Editors that measure text width (Monaco) then put the cursor and selection in the wrong place.
- Recommendation: add a selector skip-list: `.monaco-editor, .cm-editor, .CodeMirror, .ace_editor, [role=textbox], [role=code], [translate=no], .notranslate, [data-slovo-skip]`, plus a small set of per-site rules. Respecting `translate="no"` and `.notranslate` is a cheap, widely used signal that a site considers its text untranslatable.

**B2. Rich editors (Gmail compose, Notion, Google Docs, Confluence).**
- Today: `isContentEditable` skips editing hosts (`content.js:108,123`). This is safe for Gmail compose and Notion. Google Docs renders to canvas, so nothing is swapped there (correct). One gap: editors with read-only previews that later become editable. If a span is created first and the element becomes editable afterwards, the user can end up editing foreign words that are then saved into their document.
- Recommendation: listen for `focusin` on elements that are or become editable and unwrap Slovo's spans inside them. Also skip the subtree of any element with `role="textbox"`.

**B3. Gmail and webmail message bodies.**
- Today: Gmail renders messages in the main document, so they get swapped. Fastmail, Proton Mail and Outlook on the web often render HTML mail inside iframes, which are not processed (`all_frames` is not set in `manifest.json`).
- Recommendation: see C1. Also decide whether webmail should be paused by default, since swapped words may get quoted into replies on clients that build the quote from the DOM (low confidence about which clients do this).

**B4. YouTube captions and comments.**
- Today: caption segments are DOM text that changes several times a second. They get swapped after 250 ms, which causes caption flicker. Comments work.
- Recommendation: captions are a strong learning feature. Treat them as a deliberate integration: swap synchronously in the observer callback (A5) and keep the 250 ms path for everything else. Give it its own setting.

**B5. Wikipedia and other pages with many `lang` attributes.**
- Today: element `lang` is ignored. Wikipedia's interlanguage links, quoted foreign phrases (`<i lang="de">`) and IPA spans are matched as if they were English.
- Recommendation: skip any subtree whose `lang` does not start with `en` (see B6).

**B6. Non-English pages.**
- Today: there is no language check at all. On a German page "Hand", "Arm", "Kind", "also" and "will" get swapped; on French pages "on" and "plus"; on Spanish pages "come", "no" and "a".
- Recommendation: read `document.documentElement.lang` first. If it is missing, or set to `en` on a page that looks otherwise, run `i18n.detectLanguage` on a sample of about 2 KB of body text (this API is available to content scripts in Chrome and Firefox). Only run on English, with a per-site override.

**B7. Shadow DOM (web components, Reddit's "shreddit" components, Salesforce Lightning).**
- Today: neither the `TreeWalker` nor the `MutationObserver` enters shadow roots, so that text is never swapped.
- Recommendation: during the walk, descend into `el.shadowRoot` for open roots, and observe each root you find. Closed roots are reachable with `chrome.dom.openOrClosedShadowRoot` in Chrome and `element.openOrClosedShadowRoot()` in Firefox. There is no event for "a shadow root was attached", so re-check custom elements (tag names containing `-`) when they are added. Treat this as P1 and measure it on Reddit first.

**B8. Iframes (Disqus, embedded posts, AMP viewer, webmail).**
- See C1.

**B9. PDFs, reader mode, browser-internal pages.**
- Today: Chrome's PDF viewer, Firefox's pdf.js viewer, Firefox Reader View (`about:reader`), the Chrome Web Store and `chrome://` pages do not allow content scripts. Nothing happens, and nothing breaks.
- Recommendation: document this in the FAQ. In the popup, show "Slovo can't run on this page" instead of a "Pause on this site" control that does nothing (`popup.js:180` already checks for http/https, but only hides the hostname).

**B10. Printing.**
- Today: swapped words are printed.
- Recommendation: listen for `beforeprint` to unwrap and `afterprint` to re-apply, and make it a setting ("print in English").

**B11. Very large pages (100k text nodes: long Wikipedia lists, logs, chat archives).**
- Today: `walk` collects every text node and then processes them all in one task (`content.js:129-131`). Every match creates a span with a fully built `title` string (`content.js:96`).
- Recommendation: process in time-sliced chunks of about 8 ms (`scheduler.yield()` where available, which is in Chromium and may not be in Firefox yet; fall back to `setTimeout(0)` or `requestIdleCallback`). Go in document order starting near the viewport. Build tooltip text lazily on hover. Cap swaps per page or paragraph; this is both a performance and a teaching decision (see the learner-UX report).

### C. Platform and coverage

**C1. `all_frames` is off.**
- Today: only the top frame runs the script (`manifest.json:12-19`).
- Recommendation: set `all_frames: true` and `match_origin_as_fallback: true` (Chrome) so `about:blank` and `srcdoc` frames are covered. In each frame, bail out early when `innerWidth * innerHeight` is tiny (ad and tracking frames). Coordinate per-frame storage reads so a page with 30 ad frames doesn't do 30 full setups. P1, because it multiplies the cost of every other performance problem.

**C2. Service worker lifecycle and polling.**
- Today: listeners are registered at the top level (good). The alarm repeats every minute (`background.js:49`). `onStartup` re-creates it (`background.js:56`), which is correct, since Chrome may clear alarms on browser restart. Each poll downloads the full word list and compares two `JSON.stringify` strings (`background.js:37`).
- Recommendation: add `ETag`/`If-None-Match` or `?since=` on the server so an unchanged poll costs almost nothing. Chrome's alarm minimum is 30 seconds for packed extensions since Chrome 120, so the one-minute period is fine there. Firefox's floor isn't documented on MDN (low confidence), but one minute is safe in both browsers.

**C3. A word change fans out to every tab.**
- Today: when `words` changes, `storage.onChanged` sends the old and new arrays to every tab, and every tab unwraps and re-walks its whole page (`content.js:178-188`, `143-149`). With 5,000 words (about 1.5 MB) and 40 tabs, adding one word causes a CPU spike across the whole browser.
- Recommendation: store a small `wordsVersion` key and have tabs re-read `words` only when they are visible (`visibilitychange`). For additions, walk only for the new forms instead of unwrapping everything first.

**C4. Firefox host permissions.**
- Today: the README tells Firefox users to grant "access to all websites" by hand. Since Firefox 127, host permissions are shown and granted at install time for MV3, but users can still revoke them at any time in `about:addons`. The server sets no CORS headers (`server/lib/slovo/router.ex`), so without host permission for the server's origin, background fetches fail with a confusing error.
- Recommendation: in the popup, call `permissions.contains({origins: ["<all_urls>"]})`. If it is false, show a "Grant access" button that calls `permissions.request`. Also add a narrow CORS allowance on the server for `moz-extension://` and `chrome-extension://` origins as a fallback.

**C5. Firefox MV3 CSP upgrades `http://` requests.**
- Firefox's default MV3 CSP for extension pages is `script-src 'self'; upgrade-insecure-requests;`. A recent bug report shows a `ws://127.0.0.1` connection being upgraded to `wss://` and failing. Loopback `http://localhost` evidently works (the README's Firefox instructions), but `http://100.x.y.z:4747` (the README's Tailscale setup) is likely upgraded and broken. Confidence: medium; needs a test.
- Recommendation: declare an explicit `content_security_policy.extension_pages` without `upgrade-insecure-requests` (keep `script-src 'self'`). Document HTTPS (for example Tailscale's `tailscale serve`) as the recommended remote setup. Whether Firefox's HTTPS-Only Mode affects extension background fetches is unverified (low confidence); test it.

**C6. Chrome Local Network Access.**
- Chrome 142 shipped a permission prompt for public sites that make requests to local or private network addresses. A Chrome extensions engineer stated that extensions with the right host permissions are not affected. A bug that broke this exemption was fixed for Chrome 144.0.7512+ (November 2025), and a related bug affecting policy-installed extensions was also fixed. Confidence: medium-high for Chrome 144 and later. Not verified: whether `100.64.0.0/10` (Tailscale) counts as "local".
- Recommendation: add an end-to-end test against a LAN IP. If a fetch fails, show the specific error in the popup instead of "Is the server running?" (`background.js:20`).

**C7. Storage limits.**
- `storage.local` allows 10 MB in Chrome 114+ without `unlimitedStorage`. 5,000 words with notes and forms is roughly 1.5-3 MB, so this is fine for now.
- Recommendation: put settings (`enabled`, `pausedHosts`, `hiddenLangs`, `serverUrl`, and any new display preferences) in `storage.sync` so they follow the user between browsers. Keep the token and words in `local`. The sync quota is about 100 KB total and 8 KB per item, which is too small for words.

**C8. Mobile.**
- Chrome for Android has no extension support, and nothing suggests that will change for phones (high confidence as of August 2026). Firefox for Android runs MV3 extensions and is the realistic first mobile target. Edge for Android supports a limited set of extensions (low confidence on the details). Kiwi Browser was discontinued (medium confidence). Safari on macOS and iOS can run this code after `safari-web-extension-converter`, but that needs Xcode, a paid Apple developer account and App Store review.
- On any phone, `localhost` is the phone itself, so mobile users need a server reachable over HTTPS.
- Recommendation: aim for Firefox Android after the tooltip rewrite (D2). Hover does not exist on touch screens, so tap-to-reveal is required there.

### D. User interaction and accessibility

**D1. Copy and paste.**
- Today: copied text includes the foreign words.
- Recommendation: add a `copy` listener. Clone the selection's range, replace every `.slovo-w` in the clone with its English text, and write both `text/plain` and `text/html` with `clipboardData.setData`. Make it a setting ("copy original English", on by default).

**D2. The tooltip (keyboard, touch, styling, dark mode).**
- Today: it uses the native `title` attribute (`content.js:96`). It appears after about a second, can't be styled, is invisible to keyboard and touch users, and is shown or read inconsistently by assistive technology.
- Recommendation: use one shared tooltip element attached to `documentElement`, with a closed shadow root and the `popover="manual"` attribute so it sits in the top layer above every z-index and overflow context (the Popover API is supported in Chrome 114+, Firefox 125+ and Safari 17+). Show it on hover after about 300 ms and on tap. Dismiss it with Esc or a tap elsewhere. Style it with `prefers-color-scheme`. Build its content on demand from a `WeakMap` instead of a `title` string per span.

**D3. Keyboard users.**
- Making every span focusable would add hundreds of tab stops. Instead, add `commands` shortcuts: "show originals while held" or "toggle swapping on this tab", and "reveal the word under the text cursor or selection". Pressing the shortcut with a swapped word selected opens the tooltip for that word.

**D4. Screen readers.**
- Today: `lang` on the span (`content.js:94`) makes NVDA, VoiceOver and JAWS switch voice. That is good for listening practice. `dir="auto"` (`content.js:95`) isolates right-to-left words; in HTML, any element with a `dir` attribute is bidi-isolated by default, which also contains RTL-override characters.
- Recommendation: make "read swapped words aloud in English" an option for screen-reader users who want it, and ask a screen-reader user which default they prefer (open question). Avoid `aria-label` on a generic span: ARIA prohibits naming generic elements, and most screen readers ignore it.

**D5. Links, buttons and voice control.**
- Today: visible button and link text changes, while `aria-label` values stay the same. Where the accessible name is computed from content, voice-control users ("click Delete") no longer match the label. Where it comes from `aria-label`, the visible label no longer matches the accessible name (WCAG 2.5.3, Label in Name). Some sites' delegated click handlers check `event.target.tagName === "A"` and fail when the target is Slovo's span.
- Recommendation: offer a "don't swap inside buttons, menus and form labels" setting (`button, [role=button], [role=menuitem], label, nav`). Whether it is on by default is an open question. Set `pointer-events` on spans only if it proves necessary.

**D6. Find in page (Ctrl+F).**
- Searching for "house" no longer finds the swapped word. This can't be fixed from inside the page. The "toggle on this tab" shortcut (D3) is the practical answer; mention it in onboarding.

**D7. Page translation (Chrome or Edge built-in translation, Google Translate).**
- Today: the translator wraps text in `<font>` elements and changes `<html lang>`. Slovo's observer then matches English words inside translated output, and the translator may translate Slovo's foreign words back.
- Recommendation: add `translate="no"` and the `notranslate` class to spans, so the learner's word survives inside the translated sentence. Stop processing when `<html>` has a `translated-ltr` or `translated-rtl` class or its `lang` changes away from English. To catch that, observe attributes on `documentElement`.

**D8. Other sites' text features (Hypothesis annotations, "share quote", reading-time counters, site search highlighting).**
- These read `textContent` and will see foreign words. Anchors based on quoted text can break. This is an acceptable cost, but list it in the FAQ and keep the per-site pause one click away.

### E. Security, privacy and store review

**E1. XSS through word fields.**
- Today: safe. The content script only uses `textContent`, `title` and `dataset` (`content.js:91-97`). The popup uses `textContent` and `bdi` and builds every element with `createElement` (`popup.js:59-174`). No `innerHTML` is used anywhere. `escapeRe` (`content.js:19`) keeps server strings from injecting regex syntax, so there is no ReDoS from the server.
- Recommendation: keep it that way; add an ESLint rule (`no-unsanitized`) in CI.

**E2. Malicious or buggy server responses.**
- A server (or a future hosted service) controls text inserted on every site, including banks. A form like `"a"` or `"e"`, a 10 KB `native` value or 100,000 words would cause damage or a denial of service.
- Recommendation: validate on the client. Cap `native` at about 64 characters with no newlines. Require English forms of at least 2 letters made of letters, spaces, apostrophes and hyphens. Cap the vocabulary at, say, 20,000 entries. Drop anything invalid and report it in the popup.

**E3. Message handler trusts any sender.**
- `onMessage` (`background.js:67`) accepts `add` and `remove` from any extension context, including content scripts in compromised renderers.
- Recommendation: allow `add` and `remove` only when `sender.id === runtime.id` and `!sender.tab` (that is, the popup or another extension page).

**E4. Fingerprinting and vocabulary leakage.**
- Any page script can run `document.querySelectorAll('.slovo-w')` and read `data-en`, `lang` and `title`, revealing the user's study languages and vocabulary. Session-replay tools (FullStory, Hotjar, LogRocket) record it on every site that uses them.
- Recommendation: use a custom element (`<slovo-w>`) instead of a class-tagged span, which also stops generic `span` selectors in site CSS from styling it (E5). Drop `data-en` and `title` from the DOM and keep the mapping in a content-script `WeakMap`. The visible words are still readable, so disclose this in the privacy policy. Consider default-pausing a short list of sensitive domains (banking, health); this is an owner decision.

**E5. Site CSS leaking into spans.**
- Rules like `span { display:block }`, `p > span:first-child`, or adjacency selectors (`span + span`) can restyle or reflow inserted spans. Content-script CSS has normal author origin, so the site can also override `content.css`.
- Recommendation: a custom element name avoids nearly all of this. Keep its style minimal and inherited (no `all: revert`, which would drop the site's font).

**E6. Chrome Web Store review.**
- `<all_urls>` with content scripts triggers in-depth review and the strongest install warning ("Read and change all your data on all websites"). The single purpose is easy to state ("replace English words on web pages with vocabulary the user is learning"). There is no remote code, since words are data. A privacy policy is needed, because the extension handles website content locally and sends the words the user types to a server the user configures. Since August 1, 2026, CWS policy requires collected data to be "strictly necessary" to the single purpose, and changes in data practice must be disclosed proactively.
- Recommendation: write the privacy policy now, stating that page content never leaves the device. Fill in the data-disclosure form accurately. Prepare listing screenshots on neutral sites.

**E7. AMO review.**
- Since November 3, 2025, new Firefox extensions must declare `browser_specific_settings.gecko.data_collection_permissions` in the manifest, and Mozilla planned to extend this to existing add-ons in 2026. The manifest has no such key yet.
- Which category applies is open: the words typed into the popup go to the user's own server, which then calls an LLM provider. If any bundler or minifier is used later, AMO requires source code submission. A no-build setup avoids that.

## 3. Architecture recommendations

**Matching engine.**
- Replace the giant alternation with a tokenizer: `/[\p{L}\p{M}\p{N}'’-]+/gu`.
- Look up each lowercased token in a `Map` of single-word forms. For multi-word forms ("ice cream"), keep a token trie keyed by first token and check the following tokens only when the first one hits.
- This fixes Unicode word boundaries and scales flatly with vocabulary size (benchmark in the Summary).
- Keep the matcher as a pure module (`matcher.js`: `build(words, opts) -> match(text) -> [{start, end, entry}]`) so it can be unit-tested in Node. Content scripts can't be ES modules, so list the files in the manifest's `js` array in order (they share the isolated world). That keeps the project free of a build step.

**DOM mutation strategy.**
- Use `splitText` in place, never `replaceChild` on site-owned nodes.
- Keep a `WeakMap<Text, Element[]>` of what Slovo inserted, so it can clean up when the site touches the original node.
- Use a custom `<slovo-w>` element with `translate="no"`, `lang` and `dir="auto"`, and no data attributes.
- Undo is the reverse walk, in place and without `normalize()` (`content.js:140` merges text nodes that the site may own, the same hazard as A1).

**Observer strategy.**
- Observe `documentElement`. Handle small batches synchronously in the observer callback, before paint. Send large batches to a time-sliced queue in document order, viewport first (use an `IntersectionObserver` on block containers for very long pages).
- Keep per-node rewrite budgets for volatile text, and use shadow-root discovery.
- Re-apply only in visible tabs, and incrementally for added words.
- Measure with `performance.mark` and `measure` behind a debug flag. Budget: no task over 50 ms; the first viewport swapped within 100 ms of idle.

**Tooltip.**
- One shared popover host in a closed shadow root, opened by hover, tap or keyboard command, theme-aware, with content built lazily.
- This later enables "mark as known" or "hide this word" actions from the page, without a second UI.

**Settings.**
- Use `storage.sync` for preferences, and `storage.local` for words, token and sync status.
- Add a settings or options page (`options_ui`) for the growing list of toggles: copy as English, print in English, skip controls, captions, per-site rules. The popup should stay small.

**Mobile.**
- First target: Firefox Android, which needs tap-to-reveal and an HTTPS server.
- Second: Safari (macOS and iOS) through Xcode conversion, if the owner accepts the Apple account cost.
- Chrome Android is not possible.
- Since mobile users can't run `localhost`, the hosted-server question (another report) decides how useful mobile is.

## 4. Open questions for the owner

1. Should controls (buttons, menus, form labels) be swapped by default? It is good for learning, but there is a risk of misclicks and voice-control breakage.
2. Should webmail, banking and health sites be paused by default?
3. Should screen readers hear the foreign word (current behavior) or the English word by default?
4. Is a per-page swap cap acceptable, both for performance and for teaching?
5. Is synchronous swapping of YouTube captions a feature you want (flicker-free), or out of scope?
6. Firefox `data_collection_permissions`: is user-typed text sent to a self-hosted server that forwards it to an LLM "collection"? This affects the AMO declaration and the CWS privacy form.
7. Is Safari worth the Apple developer fee? Is Firefox Android a release target?
8. Would you accept an "only on sites I enable" mode built on `optional_host_permissions`? It gives a much softer install warning, at the cost of setup friction.

## 5. Proposed slices

| Slice | Goal | Size | Priority | Depends on |
|---|---|---|---|---|
| matcher-module-tests | Extract the matcher into a pure module; add Node unit tests and jsdom DOM tests | S | P0 | none |
| unicode-tokenizer-matcher | Tokenizer plus Map/trie matching with Unicode boundaries; drop the giant regex | M | P0 | matcher-module-tests |
| page-language-detection | Skip non-English pages and `lang` subtrees; fall back to `i18n.detectLanguage` | S | P0 | matcher-module-tests |
| framework-safe-swapping | `splitText`-based in-place swapping, orphan cleanup, no `normalize`, per-node rewrite budget | M | P0 | matcher-module-tests |
| skip-rules | Skip code editors, `[role=textbox]`, `translate=no`/`.notranslate`, focus-to-unwrap for editables | S | P0 | none |
| observer-root-and-timing | Observe `documentElement`, sync small batches before paint, time-sliced large batches | M | P0 | framework-safe-swapping |
| context-invalidation-reinject | Hand off to newer script instances; inject into open tabs on install/update (Chrome) | S | P0 | none |
| custom-element-and-privacy | `<slovo-w>` element, no `data-en`/`title` in DOM, WeakMap state | S | P0 | framework-safe-swapping |
| popover-tooltip | Shared shadow-root popover; hover, tap, Esc; dark mode; lazy content | M | P0 | custom-element-and-privacy |
| server-response-validation | Client caps on word count, length and form shape; sender checks in background | S | P0 | none |
| firefox-permissions-csp | Permission check and request UI; explicit CSP without upgrade-insecure-requests; data_collection_permissions key | S | P0 | none |
| store-readiness | Privacy policy, CWS data disclosure, single-purpose text, screenshots, `web-ext lint` in CI | S | P0 | firefox-permissions-csp |
| e2e-fixture-corpus | Playwright with the unpacked extension on fixtures (React update, Turbo body swap, shadow DOM, iframe, RTL, non-English, 100k nodes) plus a mock server; CI | M | P0 | matcher-module-tests |
| perf-budget | Debug timing marks, long-task observer, CI benchmark with thresholds | S | P1 | e2e-fixture-corpus |
| copy-as-english | Copy listener restores English (setting) | S | P1 | custom-element-and-privacy |
| keyboard-commands | Commands to toggle the tab, hold to reveal, open tooltip for the selection | S | P1 | popover-tooltip |
| translate-coexistence | `translate="no"` on words; stop when the page is machine-translated | S | P1 | page-language-detection |
| incremental-reapply | Visible-tab-only re-apply, add-only walks, `wordsVersion` key, ETag polling | M | P1 | unicode-tokenizer-matcher |
| settings-sync-options-page | Preferences in `storage.sync`; options page for the growing toggles | M | P1 | none |
| iframes-support | `all_frames` with tiny-frame bailout and shared setup | M | P1 | perf-budget |
| shadow-dom-support | Walk and observe open and closed shadow roots | M | P1 | observer-root-and-timing |
| print-in-english | Unwrap on `beforeprint`, re-apply on `afterprint` | S | P2 | framework-safe-swapping |
| controls-skip-option | Setting to leave buttons, menus and labels in English | S | P2 | skip-rules |
| captions-integration | Flicker-free YouTube caption swapping, behind its own setting | M | P2 | observer-root-and-timing |
| firefox-android | Tap UX, popup layout, HTTPS-server onboarding, AMO Android flag | M | P2 | popover-tooltip |
| safari-port | Xcode conversion, test on macOS and iOS | L | P2 | firefox-android |

## Sources consulted for platform claims

- Chrome Local Network Access launch: https://developer.chrome.com/blog/local-network-access
- Chromium-extensions thread on LNA and extensions (exemption, crbug 435246545 fixed in 144.0.7512): https://groups.google.com/a/chromium.org/g/chromium-extensions/c/pUDh8RiTjJk
- chrome.alarms minimum period: https://developer.chrome.com/docs/extensions/reference/api/alarms
- Firefox MV3 host permissions at install (Firefox 127): https://blog.mozilla.org/addons/2024/05/14/manifest-v3-updates/
- Firefox MV3 default CSP: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_Security_Policy and https://github.com/motrixapp/motrix-extension/issues/3
- Firefox data collection consent: https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/
- Chrome Web Store policy updates 2026: https://developer.chrome.com/blog/cws-policy-updates-2026
- Chrome for Android extension status: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/LscNuM8AIaw
- Benchmarks: local Node 22 run, 100,000 synthetic eight-word text nodes, random `/usr/share/dict/words` vocabularies; matching only, no DOM cost.
