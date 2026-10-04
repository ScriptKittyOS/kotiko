# 15 · Framework-safe swapping

| | |
|---|---|
| **Status** | Built (2026-10-04); see Implementation notes |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [14-matcher-engine](../14-matcher-engine/SPEC.md); the base for each subtree comes from [16](../16-what-not-to-swap/SPEC.md) and [50](../50-ui-localization-and-base-language/SPEC.md) |
| **Unblocks** | [19](../19-word-popover/SPEC.md), [42](../42-frames-and-shadow-dom/SPEC.md), [43](../43-copy-print-translate-coexistence/SPEC.md), [52](../52-video-captions/SPEC.md) |
| **Sources** | [06 F02, F03, F08, F15, F25](../../docs/research/06-adversarial-qa.md), [03 A1-A8, B11, C3, E4, E5, section 3](../../docs/research/03-browser-extension.md), [01 S2, S17](../../docs/research/01-language-mixing.md) |

## Problem

Kotiko can break the sites it runs on. Reproduced in research 06 with jsdom against the real
content script:

- **It detaches text nodes the site owns** (06 F02). `processText` replaces the site's text
  node with a fragment (`extension/content.js:103`). React, Preact, Vue and Svelte keep
  references to their text nodes, so later updates land on a detached node (the page shows
  stale text) or `removeChild` throws `NotFoundError`, which can blank the whole app. It is
  the same class of bug Google Translate causes on React sites (facebook/react#11538).
- **It merges site text nodes on every settings change** (06 F03). `unwrapAll()` calls
  `normalize()` on every parent (`content.js:140`), disconnecting nodes Kotiko never touched.
  It runs in every open tab whenever a word or setting changes (`content.js:143-149`,
  `178-188`).
- **It fights sites that restore their own text** (06 F08). A page that resets its text when
  a swap appears and Kotiko re-swapping 250 ms later loop forever (11 cycles in 3 s).
- **It stops after a body swap** (06 F25). The observer watches the original `document.body`
  (`content.js:176`), so Turbo-style navigation and `document.open()` end swapping.
- **Old copies keep running after an update** (06 F15, reasoned). In Chrome, an updated or
  disabled extension leaves the old content script alive with a dead API; its observer keeps
  swapping and the popup can't stop it. Chrome also never injects into tabs that were open
  at install, so a new user sees nothing on the page they already had open (03 A7, A8).
- **It stalls big pages and flashes the original text.** All text nodes are collected and
  processed in one task (`content.js:129-131`). New content waits on a 250 ms timer that
  starts at the first mutation (`content.js:169`), so feeds show the page's own words, then
  jump (03 A5, B11).
- **It leaks the vocabulary.** Every swap is a `span.slovo-w` with `data-en` and a `title`
  holding the original word and every language (`content.js:91-97`), readable by any page script
  and recorded by session-replay tools (03 E4). Site CSS such as `span { display:block }`
  can restyle it (03 E5).

## Goals

- Site-owned text nodes are never detached, replaced, merged or split into nodes the site
  doesn't hold a reference to at its original position.
- A React 18 fixture that re-renders text containing known words keeps updating, and throws
  nothing, through swap, re-render, unmount, settings change and disable.
- New content is swapped before it is painted for small batches; no task longer than 50 ms.
- Changing words or settings rewrites only the swaps whose outcome changed.
- Exactly one live Kotiko instance per document, including across updates and reloads.
- No original text, gloss, language list or word ID in page-visible attributes.

## Non-goals

- Tokenizing and matching: [14](../14-matcher-engine/SPEC.md).
- Which elements and pages to skip: [16](../16-what-not-to-swap/SPEC.md).
- The popover that replaces `title`: [19](../19-word-popover/SPEC.md).
- Iframes and shadow roots: [42](../42-frames-and-shadow-dom/SPEC.md).
- Copy, print, machine translation: [43](../43-copy-print-translate-coexistence/SPEC.md).

## User stories

- As someone using Kotiko on a React web app, the app keeps working exactly as without Kotiko.
- As a learner scrolling a feed, new posts arrive already swapped, without a flash of the
  unswapped text.
- As a learner who adds a word on my phone, the page I'm reading doesn't reshuffle; at most
  the new word appears.
- As someone who just installed or updated Kotiko, the tabs I already had open start working
  without a reload.

## Specification

### Files

```
extension/content/engine.js   swap, restore, bookkeeping, observer, scheduler
extension/content/main.js     startup, settings, handoff, wiring of slices 16-18, 31, 32
extension/content.css         kotiko-w styles
```

### The swap element

Every swap is an autonomous custom element `<kotiko-w>` (never registered; content scripts
can't define custom elements, and an undefined element with a hyphen renders inline):

```html
<kotiko-w lang="zh-Hans" dir="auto" translate="no" class="notranslate">谢谢</kotiko-w>
```

- `lang` is the chosen word's canonical tag ([08](../08-language-tags/SPEC.md)); it drives
  screen-reader voice switching and Han glyph choice.
- `dir="auto"` isolates right-to-left words (kept from `content.js:95`).
- `translate="no"` and `notranslate` keep the word intact under machine translation (43).
- No `data-*`, `title`, `id` or `aria-*`. The original surface, candidates and IDs live in a content-script
  `WeakMap<Element, SwapInfo>` that page scripts can't reach. The visible word itself is
  still readable by the page; slice 28 discloses this.
- `content.css`:

```css
kotiko-w {
  display: inline;
  unicode-bidi: isolate;
  line-height: 1;          /* slice 17: never grows the line box */
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-thickness: from-font;
  text-underline-offset: 0.18em;
  cursor: help;
}
```

Colors and states come from [06](../06-design-system/SPEC.md) and
[37](../37-language-colors-and-reading-aids/SPEC.md) as classes on `kotiko-w` (for example
`kotiko-missed` from slice 35); classes never carry original text or word data. A custom element
name avoids nearly all site selectors aimed at `span`.

### Swapping a text node in place

The site's node `T` stays in the document at its position and keeps the text before the first
match. Everything after it is inserted as new siblings that Kotiko owns. Bookkeeping lives in
`swaps: WeakMap<Text, SwapRecord>` and `info: WeakMap<Element, SwapInfo>`.

```
swap(T, plan):                         // plan: matches with chosen display text, sorted
  original = T.data
  first = plan[0].start
  frag = new DocumentFragment
  cursor = first
  for m in plan:
    if m.start > cursor: frag.append(ownText(original.slice(cursor, m.start)))
    el = createElement("kotiko-w"); set lang, dir, translate, class; el.textContent = m.display
    info.set(el, { T, surface: m.surface, base: ctx.base, key: m.key, choice: m.choice, entry: m.entry })
    frag.append(el)
    cursor = m.end
  if cursor < original.length: frag.append(ownText(original.slice(cursor)))
  nodes = [...frag.childNodes]
  T.data = original.slice(0, first)                // may become "" and that is fine
  T.parentNode.insertBefore(frag, T.nextSibling)
  swaps.set(T, { original, prefix: T.data, nodes, planSig: signature(plan) })

ownText(s): t = new Text(s); ownedText.add(t); return t     // WeakSet
```

Why this is safe: the framework's reference to `T` still points at a connected node in the
right place. `parent.removeChild(T)` works. `T.data = "new"` shows the new text immediately;
Kotiko's observer then removes the stale siblings and re-swaps (below). New site nodes that the
framework inserts before "the next sibling it knows" land after Kotiko's nodes, so order holds.
A moment where both old and new text exist is never painted, because it is resolved in the
observer callback, which runs as a microtask before rendering.

### Unswapping

```
restore(T):
  r = swaps.get(T); if !r: return
  for n in r.nodes: n.remove()                       // only Kotiko's nodes
  if T.isConnected and T.data === r.prefix: T.data = r.original
  swaps.delete(T)
```

There is no `normalize()` anywhere (06 F03). `unwrapAll()` finds every `kotiko-w` with
`querySelectorAll` (plus the shadow-root registry from 42), restores each distinct `T`, and
removes any `kotiko-w` whose `T` is gone by replacing it with a text node holding its original
surface.

Legacy cleanup: on startup, every `span.slovo-w` from version 0.2 is replaced with a text node
of its `data-en` (the original text 0.2 stored there; no `normalize`). This runs once per document and is removed two releases
later.

### Processing pipeline

For each text node, in this order:

```
process(T):
  if ownedText.has(T) or skipCache says T's parent is skipped (16): return
  if swaps.has(T): restore(T)                          // reprocess from the original
  base = skip.baseFor(T.parentElement)                  // 16: a base tag, or null to leave alone
  if base is null: return
  ctx = { base, ...edges(T) }                            // 14: before/after inline text
  { matches, tokenCount } = matcher.scan(T.data, ctx, indexes.get(base))
  coverage.count(T, base, tokenCount, matches)           // 32, per base, before any filtering of choice
  matches = rules.filter(matches, ctx, page)             // 16: case, acronym, names, deferral
  for m in matches: m.choice = precedence.choose(m, page)  // 18; drop if null
  plan = density.select(T, matches)                      // 31
  for m in plan: m.display = casing.display(m)           // 17
  if plan nonempty: swap(T, plan)
```

`edges(T)` walks previous and next sibling text within the same inline run (the element list
in 14) and returns up to 16 characters each side, or U+2029 at a block or skip boundary.

`indexes` is `KotikoMatcher.buildIndexes(words, storage.local.baseLangs)` (14, 50), rebuilt when
the words or the base languages change; a change to the base languages re-runs the page gate
(16) and then re-applies like any other settings change. `skip.baseFor` is cached per element
with the rest of 16's element rules, so a page in Spanish with an English quote scans each
part with its own base's index.

Slice 16 may defer capitalized matches until it has seen more of the page. At the end of each
processing slice, the nodes holding resolved deferrals are run through `process(T)` again;
16's decisions are memoized per page, so the re-run applies them and nothing else changes.

### Walking and scheduling

- The walker is a `TreeWalker` with `SHOW_ELEMENT | SHOW_TEXT`. Elements that slice 16 skips
  are `FILTER_REJECT` (whole subtree); `kotiko-w` is rejected; owned text is skipped.
- Work is queued as roots (elements or text nodes) in document order and processed in
  slices of at most **8 ms**, measured with `performance.now()`. Between slices, yield with
  `scheduler.yield()` where available, otherwise a `MessageChannel` post (faster than
  `setTimeout(0)` clamping).
- **Initial pass.** For pages under 5,000 text nodes, document order. Above that, start with
  the subtree under the element at the viewport's centre (`document.elementFromPoint`),
  climbing to its nearest `article`, `main`, `section` or block with at least 20 text nodes,
  then the rest in document order, so the first viewport is done first.
- **Framework pages.** If the page shows hydration markers (`#__next`, `[data-reactroot]`,
  `#__nuxt`, `[data-sveltekit-hydrated]`, `[ng-version]`, `[data-server-rendered]`), wait for
  500 ms without mutations, at most 3 s, before the initial pass (03 A2).
- Budgets: no task over **50 ms**; the first viewport swapped within **100 ms** of the initial
  pass starting; a 100,000-node page finishes in under **2 s** of wall time without a long
  task. Measured with `performance.mark` behind a debug flag and a `PerformanceObserver` for
  long tasks in the end-to-end run.

### Observing

One `MutationObserver` on `document.documentElement` with
`{ childList: true, subtree: true, characterData: true }` (fixes F25: a new `body` is just an
added node). A second observer on `documentElement` only, `{ attributes: true,
attributeFilter: ["lang", "class"] }`, feeds slices 16 and 43.

Handling a batch of records:

```
onMutations(mutationRecords):
  if !contextValid(): return teardown()                  // F15
  for r in mutationRecords:
    if r.type == "characterData":
      if ownedText.has(r.target): continue               // Kotiko's own tail text
      rec = swaps.get(r.target)
      if rec and r.target.data === rec.prefix: continue  // Kotiko's own write
      if rec: drop rec.nodes from DOM; swaps.delete(r.target); budget.revert(parentOf(r.target))
      enqueue(r.target)
    else:                                                 // childList
      for n in r.removedNodes:
        if swaps.has(n): remove its nodes; swaps.delete(n)     // site removed T
      for n in r.addedNodes:
        if n is kotiko-w or ownedText.has(n): continue
        if n was one of Kotiko's removed nodes being re-added by the site: budget.revert(parent)
        enqueue(n)
  if queue is small (under 200 text nodes and 20,000 characters): run it now, synchronously
  else: schedule time-sliced processing
```

Kotiko's own writes must not be mistaken for the site's, and the site's must not be lost. Every
write batch therefore starts with `observer.takeRecords()` (those records are the site's and
are handled first) and ends with `observer.takeRecords()` (those are Kotiko's and are dropped).

### Rewrite budgets (06 F08, 03 A4)

Two counters per element in a `WeakMap<Element, {reverts, churn, since}>`:

- **reverts**: the site undid a swap (rewrote `T`, removed Kotiko's nodes, or re-set text Kotiko
  had swapped) and Kotiko re-swapped. More than **5 in 10 s** marks the element volatile.
- **churn**: the element's text changed for any reason. More than **30 in 60 s** marks it
  volatile (live clocks and tickers). Slice 52 exempts caption containers.

A volatile element is restored and added to a `WeakSet` that 16's skip check consults for the
rest of the page's life. Page-wide, more than **200 reverts in 10 s** puts the page in "stand
down" mode: unwrap everything, disconnect, and report `{ status: "stood-down" }` to the
popup, which says "Kotiko stepped back on this page because the page kept undoing its changes"
(copy owned by [25](../25-plain-language-errors/SPEC.md)). A one-line console message is
logged once, at debug level only.

### Applying changes to words or settings

When words or relevant settings change:

1. Rebuild the index (14) and recompute choices (18). Unchanged choices stay unchanged,
   because 18's choice is seeded, not counted.
2. For each entry in `swaps`, recompute its plan from `original`; if `signature(plan)` equals
   `rec.planSig`, leave it alone; otherwise restore and swap it again.
3. Walk unrecorded text for newly matching forms.

All of this is time-sliced. The trigger is a change to slice 11's `wordsVersion` key (or to
a settings group from 39). In a hidden tab, mark the document dirty and do the work on
`visibilitychange` to visible, so one added word doesn't wake 40 tabs (03 C3). Turning Kotiko
off or pausing the site runs `unwrapAll()`.

### One instance per document

- Each instance has a random `instanceId`. On startup it dispatches
  `document.dispatchEvent(new CustomEvent("kotiko:handoff", { detail: instanceId }))`. Any other
  instance listening tears itself down synchronously: disconnect observers, `unwrapAll()`,
  remove listeners. The new instance then walks the page. A page can fire this event too;
  the worst it can do is make Kotiko re-render, which is acceptable.
- `contextValid()` is `try { return !!ext.runtime?.id } catch { return false }`. It is checked
  in every observer callback, timer and event listener; when false the instance tears down
  (06 F15).
- **Injection into open tabs.** On `runtime.onInstalled` (install and update) and on
  `management.onEnabled` where available, the background script calls
  `scripting.insertCSS` and `scripting.executeScript` with the content files for every tab
  whose URL is http(s), `allFrames: true`, ignoring per-tab errors. This needs the
  `scripting` permission (host access is already granted); slice 28 lists it. Firefox may
  also re-inject on its own; the handoff makes that harmless.

### Element-level editability

If an element becomes editable or receives focus as an editor, Kotiko restores the swaps
inside it before the user can type into swapped words. The trigger rules are in slice 16; the
mechanism is `restoreWithin(element)`.

### Public surface for other slices

```js
KotikoEngine.infoFor(el)        // SwapInfo for a kotiko-w: surface, base, key, choice, entry, T
KotikoEngine.unwrapAll()        // used by 43 (print), popup "off", teardown
KotikoEngine.restoreWithin(el)  // used by 16 (editables)
KotikoEngine.reapply(reason)    // used by settings changes, 43 (afterprint)
KotikoEngine.suspend()          // pause processing, keep the queue; used by 43 (print)
KotikoEngine.freeze(on)         // no new swaps and no orphan cleanup while a page is
                               // machine-translated; on release, reconcile then reapply (43)
KotikoEngine.onSwap(fn)         // used by 32 (coverage), 35 (exposure), 46 (stats)
KotikoEngine.addRoot(root)      // used by 42 for shadow roots
```

## Acceptance criteria

- [ ] After swapping, every original text node object is still connected, at its original
      index among the site's own nodes (06 F02 repro passes: `t3.isConnected === true`, setting
      `t3.data` updates the page, `removeChild(t3)` succeeds).
- [ ] No call to `normalize()`, `replaceChild` or `replaceWith` on site-owned nodes exists in
      the extension (lint rule plus test).
- [ ] The 06 F03 repro: after any settings change, child count and identity of site nodes are
      unchanged and `b.data = "Alice"` shows "Alice".
- [ ] A React 18 fixture toggling and editing a list with known words for 60 s throws no
      errors and its text always matches React's state.
- [ ] The 06 F08 ping-pong page stops within 10 s and stays stable.
- [ ] After `documentElement.replaceChild(newBody, document.body)`, new text is swapped.
- [ ] No `title`, `data-en` or other attribute on swaps reveals the original text, the gloss
      or other languages.
- [ ] Mutations of under 200 text nodes are swapped before the next paint (Playwright checks
      a `requestAnimationFrame` callback never sees the unswapped text).
- [ ] No long task over 50 ms on the 100,000-node fixture; first viewport within 100 ms.
- [ ] Adding one word rewrites only nodes containing its forms (count of DOM writes in test).
- [ ] After an extension reload in Chromium, the old instance's swaps are gone, the new
      instance swaps, and exactly one set of `kotiko-w` exists.
- [ ] On install, a tab opened before install gets swaps without reload (Chromium).
- [ ] Legacy `span.slovo-w` elements are converted back to their original text on first run.

## Test plan

- **jsdom (slice 02):** node-identity tests for swap and restore; F02, F03, F08, F25 repros as
  regression tests; the self-write filter (site records arriving in the same task as Kotiko's
  writes are not dropped); budgets for reverts and churn with fake timers; signature-based
  re-apply only touching changed nodes.
- **Playwright with the unpacked extension:** slice 02's `react-list.html`, `turbo-swap.html`,
  `self-healing.html` and `big.html`; added by this slice: `vue-list.html`, `ticker.html` (clock
  text every 500 ms) and `feed.html` (50 posts appended every second). Assertions: no page errors,
  framework state equals DOM text, long-task observer empty, no unswapped frame captured; `feed.html` runs once with an
  English page and once with a Spanish page (base `es`).
- **Lifecycle:** Playwright reloads the extension via `chrome.runtime.reload()` from the
  service worker and checks handoff; installs into a browser with an already-open tab.
- **Manual:** GitHub (Turbo), Reddit, X, YouTube comments, Gmail reading pane, Notion,
  a Next.js documentation site.

## Rollout and migration

Ships with 14, 16 and 17 as one release. The new element and handoff replace the old span
immediately; legacy spans are cleaned on first run. Adds the `scripting` permission, which
Chrome may surface as a permission change on update; mention it in the release notes and in
slice 28's disclosures. Changelog: "Kotiko no longer interferes with web apps like React and
Vue sites, keeps working after page navigations, and starts on open tabs right after you
install or update."

## Open questions

1. **Per-site safe-mode list shipped with the extension.** Recommendation: don't ship one at
   launch; rely on the budgets and "Pause on this site", and add entries only from reported
   breakage, through slice 38's rules.
2. **Firefox re-injection.** Firefox may inject into open tabs by itself (03 A7, medium
   confidence). Recommendation: inject explicitly anyway and rely on the handoff; verify in
   the end-to-end run and drop the explicit call for Firefox if it doubles work.

## Future work

- Viewport-first processing with an `IntersectionObserver` over block containers for very
  long pages, if the centre-first heuristic proves insufficient.
- A per-instance random element name to reduce fingerprinting (needs a style injection
  strategy that doesn't use a fixed selector).

## Implementation notes

*2026-10-04: the slice is built (`extension/content/engine.js`, wired from `content.js`).*

**Built as specified**: swapping in place (the site's node keeps the text before its first
swap, Kotiko's nodes follow it, tracked in WeakMaps and a WeakSet); restore without
`normalize()` and a test that forbids `normalize()`, `replaceChild` and `replaceWith` in the
content scripts; the self-write filter (`takeRecords()` before and after every write); revert
and churn budgets, volatile elements and page-wide stand-down with its popup line
(`popup_stood_down`); time-sliced processing in 8 ms slices with `scheduler.yield()` or a
`MessageChannel`, small changes swapped inside the observer callback, before the next paint;
centre-first initial passes on pages over 5,000 elements; the hydration wait; signature-based
re-apply (a new word rewrites only the text that has it; unchanged swaps get their word's
current data); hidden tabs deferred to `visibilitychange`; `restoreWithin` on a focused editor;
injection into open tabs on install and update (`scripting`); the handoff. Tests: the F02, F03,
F08 and F25 repros, a React 18 app (production build from `node_modules`) re-rendering,
unmounting and remounting for four seconds with no error and its counts always equal to its
state, Turbo-style body replacement and `document.open()`, the self-healing page, an
unpainted-frame check, and the 100,000-node page.

**Different from the text above, and why**:

- The observer watches `document`, not `document.documentElement`: `document.open()`
  replaces the root element itself.
- A **revert** is the site putting back its original text or removing Kotiko's nodes. The site
  writing *new* text into a swapped node (a counter, a re-render) is churn only: counting it as
  a revert gave up on any live app within about a second.
- Which word a spot shows is remembered per site text node and spot, so a re-render or a
  settings change keeps the same word in the same place; slice 18 replaces the rotation.
- The engine asks `content.js` for a plan (`plan({ text, node, edges })`); `content/main.js`
  is still `content.js`.
- Startup warms the word segmenter and pending style work in a task of its own, and listens
  for storage changes from its first moment, applying any that arrive while starting.

**Measured on the 100,000-node page** (Chromium, Long Animation Frames): Kotiko's own scripts
never block for more than about 20 ms, but each frame's style and layout pass takes 30 to
60 ms while swaps land all over the document, and now and then that pass and a garbage
collection reach about 100 ms; the page finishes in about 3.5 s. The 50 ms and 2 s budgets are
not met on a page this size; ordinary pages (a few thousand nodes) are well inside them. The
end-to-end test guards against regressions at 150 ms.

**Next**: viewport-first swapping (Future work, first item) is what brings very large pages
under the budgets: swap what is on or near the screen, and the rest as it scrolls near.
