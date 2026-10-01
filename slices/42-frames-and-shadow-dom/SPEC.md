# 42 · Frames and shadow DOM

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | M (about a week) |
| **Depends on** | [15-framework-safe-swapping](../15-framework-safe-swapping/SPEC.md) |
| **Unblocks** | None |
| **Sources** | [06 F26](../../docs/research/06-adversarial-qa.md), [03 B3, B7, B8, C1, section 3 "Observer strategy"](../../docs/research/03-browser-extension.md) |

## Problem

Mira only sees the top frame's light DOM (06 F26, read from the code):

- **Iframes are never processed.** The manifest has no `all_frames` (`extension/manifest.json:12-19`),
  so Disqus comments, embedded posts, AMP viewers and HTML email in Fastmail, Proton Mail and
  Outlook on the web are never swapped, whatever language they are in (03 B3, B8, C1).
- **Shadow DOM is invisible.** The `TreeWalker` and `MutationObserver` don't cross shadow
  boundaries (`extension/content.js:120-131`, `176`), so web-component sites such as Reddit's
  "shreddit" UI and Salesforce Lightning get nothing (03 B7).

Turning frames on naively multiplies every cost: a news page can carry 30 ad and tracking
frames, each of which would load the whole word list and build an index.

## Goals

- Text in same-origin, cross-origin, `about:blank` and `srcdoc` frames is swapped when the frame
  is big enough to read.
- Text in open and closed shadow roots is swapped and kept up to date.
- Choices are consistent across frames: "thanks" in a Disqus frame matches the article.
- Per-site rules follow the tab's site, not the frame's origin.
- Costs stay within budget on ad-heavy pages and component-heavy apps.

## Non-goals

- Canvas-rendered text (Google Docs), PDFs and browser-internal pages, where content scripts
  can't run (03 B9).
- Captions inside players: [52](../52-video-captions/SPEC.md).

## User stories

- As a reader of comments in an embedded Disqus frame, my words are swapped there too.
- As a Reddit user on the new interface, posts and comments are swapped.
- As a reader of a page full of ads, Mira doesn't slow it down by working inside ad frames.

## Specification

### Frames

**Manifest** (content script entry):

```json
"all_frames": true,
"match_about_blank": true,
"match_origin_as_fallback": true
```

`match_origin_as_fallback` (Chrome 119+) covers `about:blank`, `about:srcdoc`, `blob:` and
`data:` frames by their creator's origin; `match_about_blank` covers the about frames in Firefox.
Keys a browser doesn't know are ignored by it; `web-ext lint` in slice 02 must accept them.

**Early bail-out**, the first thing `main.js` does in a subframe (`window !== top`):

```
if innerWidth * innerHeight < 60,000 or innerWidth < 200 or innerHeight < 80:
    listen for "resize" for up to 10 s; start if the frame grows past the threshold; else stop
if document.designMode == "on" or body.isContentEditable: stop    // rich-text editor frames
```

This runs before reading storage, so tracking pixels and ad slots cost one size check.

**Frame handshake.** A subframe that passes the size check sends
`runtime.sendMessage({ type: "frame-hello" })`. The background answers from `sender.tab.url`
(the top page, which a cross-origin frame can't read itself):

```ts
{ run: boolean, topHost: string, pageKey: string, siteRule: SiteRule | null }
```

`run` applies the top site's pause, per-site rule (38) and sensitive-site rule (16): a payment
frame inside a bank's page is skipped because the bank is. `pageKey` is the top page's key, so
slice 18's choices match the article. The frame applies its own page-language gate (16) to its
own document, because a frame can be in another language: a Spanish newsletter in an English
webmail page uses the Spanish base index when Spanish is one of the learner's base languages
([50](../50-ui-localization-and-base-language/SPEC.md)) and is skipped when it isn't. A
`base` site rule (38) on the top site applies to its frames too.

**Word data.** Each running frame reads the word list from `storage.local` like the top frame
and builds its own indexes, one per base language present in the frame (14: under 40 ms at
20,000 words). Cross-origin frames usually run in
another process, so this doesn't block the top page's main thread. If profiling on the
`ads-heavy.html` fixture shows more than 5 frames running per page, a follow-up moves index
building into the background worker and sends frames a compact index (Future work).

**Density and coverage.** Blocks are frame-local (31). The per-word page cap is per frame. Each
frame reports its coverage counts to the background tagged with its `frameId`, and slice 32 sums
them per tab.

**Lifecycle.** Each frame has its own instance with slice 15's handoff and context checks.
Slice 15's injection on install and update already passes `allFrames: true`.

### Shadow roots

**Discovery during the walk.** In the walker's `acceptNode`, for every element:

```
root = el.shadowRoot                                        // open roots
       ?? chrome.dom?.openOrClosedShadowRoot?.(el)          // closed, Chrome 88+
       ?? el.openOrClosedShadowRoot?.()                     // closed, Firefox content scripts
if root and !roots.has(root): addRoot(root)
```

Property access is cheap; elements are visited anyway.

**`addRoot(root)`** (slice 15's `MiraEngine.addRoot`):

1. Register it in `roots: Set<WeakRef<ShadowRoot>>`, pruned when the host disconnects.
2. `observer.observe(root, { childList: true, subtree: true, characterData: true })`; the same
   observer instance handles it.
3. Queue the root for walking, in document order after its host.
4. Attach the popover's delegated pointer and focus listeners to the root (19). Events from a
   closed root are retargeted to its host, and `composedPath()` hides the inner nodes from
   document-level listeners, so listening on the root itself works for open and closed roots
   alike.

**Roots attached later.** There is no event for `attachShadow`. When the observer reports an
added element whose tag name contains "-" (custom elements, which upgrade asynchronously), Mira
checks it for a root at once, after 100 ms and after 1 s. Declarative shadow DOM
(`<template shadowrootmode>`) is already attached when the walk sees it. Once more, at `load`
plus 2 s, the walker re-checks hosts it saw without a root. Content scripts can't use
`customElements.whenDefined` (Chrome gives them no registry), hence the timers.

**Styling inside roots.** `content.css` doesn't reach into shadow trees. Swaps inside a shadow
root get the same declarations as an inline `style` attribute, generated from the current
settings (15's base style plus 35's and 37's classes resolved to declarations). Mira never edits
the root's `adoptedStyleSheets` or inserts `<style>` elements into it, because component
frameworks (Lit and others) reassign those and would either drop Mira's style or be surprised by
it.

**Boundaries.** A shadow root is a block boundary for slice 14's edge context and slice 31's
density. Slotted light-DOM text belongs to the light DOM and is processed there.

**Unwrapping.** `unwrapAll()` iterates `document` plus every live root in `roots`.

### Performance budgets

Measured in slice 02's Playwright runs:

| Fixture | Budget |
|---|---|
| `ads-heavy.html`: article plus 30 frames of 300x250 and smaller | added main-thread time from frames under 20 ms; no index built in frames under the size threshold |
| `components.html`: 2,000 custom elements with open roots, 20 % with text | initial pass at most 1.5x the same content in light DOM |
| `reddit-snapshot.html` (saved page with shreddit components) | no long task over 50 ms |

## Acceptance criteria

- [ ] Text in a same-origin iframe, a cross-origin iframe, a `srcdoc` iframe and an `about:blank`
      iframe written by script is swapped.
- [ ] Frames under the size threshold never read storage (verified with a storage spy).
- [ ] Pausing the top site stops swapping in its frames; a frame whose content is in a
      language that isn't one of the learner's bases is skipped by the language gate, and a
      frame in another of the learner's bases (a Spanish frame on an English page for an
      es+en reader) is swapped with that base's words.
- [ ] The same concept shows the same word in the top page and a frame (shared page key).
- [ ] Text in open and closed shadow roots is swapped, including roots attached after load and
      nested roots.
- [ ] Swaps inside shadow roots are styled like other swaps and react to settings changes.
- [ ] The popover opens for swaps inside open and closed roots.
- [ ] Budgets in the table hold in CI.

## Test plan

- **Playwright:** slice 02's `iframes.html` and `shadow.html`, extended with late-attached and
  declarative roots and a cross-origin frame (served from a second port of the fixture server);
  added by this slice: `ads-heavy.html`, `components.html`, `reddit-snapshot.html`; settings change and disable/enable with frames and roots present.
- **Unit:** size bail-out logic; handshake response handling.
- **Manual:** Disqus on a blog, Reddit, Outlook on the web reading pane, Salesforce trial org,
  YouTube embeds (player chrome must not be swapped).

## Rollout and migration

The manifest change needs no new permission (host access is already `<all_urls>`). Release
notes: "Mira now works inside embedded comments, email bodies and modern web components."
Watch issue reports for webmail quoting (16, open question 3).

## Open questions

1. **Run in all frames by default?** Recommendation: yes, with the size bail-out; add a hidden
   setting to turn frames off if a site misbehaves, and expose it through per-site rules (38).

## Future work

- Background-built compact index shared with frames, if frame counts warrant it.
- Viewport-aware processing inside large frames.
