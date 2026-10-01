# 19 · Word popover

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [06-design-system](../06-design-system/SPEC.md), [15-framework-safe-swapping](../15-framework-safe-swapping/SPEC.md) |
| **Unblocks** | [34-pronunciation-audio](../34-pronunciation-audio/SPEC.md), [35-reveal-mode-and-review](../35-reveal-mode-and-review/SPEC.md), [37-language-colors-and-reading-aids](../37-language-colors-and-reading-aids/SPEC.md), [45-firefox-android](../45-firefox-android/SPEC.md) |
| **Sources** | [05 S24, S25, S36, §3.2](../../docs/research/05-learner-ux.md); [03 D2, D3, D4, E4, E5](../../docs/research/03-browser-extension.md); [02 F4](../../docs/research/02-linguistics.md); [01 S6, S8](../../docs/research/01-language-mixing.md) |

## Problem

The moment a learner checks a word is the core learning moment, and today it is a native
tooltip built from the `title` attribute (`extension/content.js:65-71, 96`):

- It appears after about a second, looks different in every browser, can't be styled or
  themed, and can't hold buttons (speak, edit, pause).
- It does nothing on touch screens and can't be reached with a keyboard; screen readers
  handle `title` inconsistently ([03 D2](../../docs/research/03-browser-extension.md)).
- It is a plain string, so right-to-left words, parentheses and "·" can reorder
  ([02 F4](../../docs/research/02-linguistics.md)).
- It leaks: every site can read `span.slovo-w`, `data-en` and `title`
  (`content.js:92-96`) and learn which languages and words the user is studying; session
  replay tools record it ([03 E4](../../docs/research/03-browser-extension.md)).
- The learner has no way to act on a wrong swap from where they see it
  ([05 S25](../../docs/research/05-learner-ux.md)).

## Goals

- One shared popover per page, in a closed shadow root, in the top layer, that opens on
  hover intent, click or tap, and a keyboard command.
- It shows the native word, romanization, language, English, note and the other languages
  for the same English word, with correct bidi handling.
- It offers actions in a fixed slot: speak, edit, pause word, wrong meaning here.
- Nothing about the learner's vocabulary is written into the page DOM beyond the visible
  word itself.
- It never breaks a link, a click or a text selection on the host page.

## Non-goals

- The swap element and the WeakMap that maps it to its entry: [15](../15-framework-safe-swapping/SPEC.md).
  This spec calls that element `<mira-w>`; 15 owns its name and attributes.
- Audio: [34](../34-pronunciation-audio/SPEC.md) fills the speak action.
- Reveal mode and knew-it buttons: [35](../35-reveal-mode-and-review/SPEC.md) uses the same
  popover with English hidden.
- Grammar fields (part of speech, gender): [36](../36-grammar-and-senses/SPEC.md).
- Mobile tap details inside links on Firefox for Android: [45](../45-firefox-android/SPEC.md).
- Keyboard shortcut registration: [33](../33-context-menu-and-shortcuts/SPEC.md).

## User stories

- As a reader, I want to rest my pointer on a swapped word and see its meaning quickly,
  without the page jumping.
- As a keyboard user, I want to select a swapped word and press a shortcut to see the same
  information and act on it.
- As a phone reader, I want to tap a swapped word to see what it means.
- As a learner who sees "like" swapped in "looks like rain", I want to tell Mira this is the
  wrong meaning, right there.
- As a privacy-minded user, I want sites not to see what I'm learning.

## Specification

### 1. Content and layout

```
            …see you soon, 谢谢 for reading.
                           ┄┄┄┄  ← the swapped word (dotted underline)
            ┌──────────────▲─────────────────────────┐
            │ 谢谢                              (🔈) │  native: --t-word-lg, display role, lang="zh"
            │ xièxie                                 │  romanization: --t-body, --ink-2
            │ Chinese · 中文                         │  language: --t-small, --ink-3 (+ color dot, 37)
            │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
            │ thanks                                 │  English: --t-lead, --ink (hidden in reveal mode)
            │ "谢谢你" = thank you.                  │  note: --t-small, --ink-2, max 3 lines
            │ Also: gracias · спасибо (spasibo)      │  other candidates (18): --t-small
            │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
            │ Edit   Pause word   Wrong meaning here  │  actions: quiet buttons, 32 px tall
            └────────────────────────────────────────┘
```

- Width: content-sized, min 220 px, max 320 px; padding 16; `--r-lg`; `--e-2`
  ([06](../06-design-system/SPEC.md)). An 8 px arrow points at the word.
- Native word, romanization and each "Also" item are in `<bdi>` with their own `lang`, so
  Arabic, Hebrew and mixed strings never reorder the line.
- "Also" lists the other candidates for the same English form in the shown languages, merged
  by identical native string ([01 S6](../../docs/research/01-language-mixing.md): "da ·
  Serbian, Croatian") and including same-language synonyms
  ([01 S8](../../docs/research/01-language-mixing.md): "Also: hogar").
- The note is truncated at three lines with "More" that expands in place.
- Speak (34) is a 32 × 32 icon button at the top end; hidden when no matching voice exists.
- The actions row is an extension point: [35](../35-reveal-mode-and-review/SPEC.md) adds
  "I knew it" / "Didn't know" above it; [37](../37-language-colors-and-reading-aids/SPEC.md)
  adds the color dot.

### 2. Actions

| Action | What happens | Undo |
|---|---|---|
| Edit | Opens the dashboard at this word with its inspector open ([21](../21-dashboard/SPEC.md)), in a new tab | n/a |
| Pause word | Sets the word's status to paused ([07](../07-word-model-v2/SPEC.md)); swaps of it on this page revert to English within 100 ms; a toast in the popover: "Paused 谢谢. It won't be swapped until you resume it." | "Undo" in the popover for 10 s; also resumable in the dashboard |
| Wrong meaning here | Opens a two-choice panel in the popover: "Never swap “like” for 喜欢" (removes that English form from the word) or "Skip it just on this page" (adds the form to a per-page skip set for this page view). | "Undo" for 10 s |

Writes go through background messages (sender-checked,
[26](../26-background-sync-correctness/SPEC.md)); the popover updates optimistically.

### 3. Opening and closing

| Input | Opens | Closes |
|---|---|---|
| Mouse / pen (`pointer: fine`) | Pointer rests on a `<mira-w>` for 300 ms (hover intent: the pointer has moved less than 4 px in the last 100 ms) | Pointer leaves both word and popover for 200 ms; Esc; click outside; scroll that moves the word out of view |
| Click on a `<mira-w>` not inside a link or button | Immediately, and pinned (stays open while the pointer is away) | Esc; click outside; click on the word again |
| Touch (`pointer: coarse`) | Tap on a `<mira-w>` not inside a link or button | Tap outside; Esc on attached keyboards |
| Touch inside a link | Long press (500 ms) opens; `contextmenu` is suppressed only when its target is a `<mira-w>` | as above |
| Keyboard | The "Show word" command ([33](../33-context-menu-and-shortcuts/SPEC.md)) with a selection or caret inside a `<mira-w>`; or, when keyboard mode is on ([27](../27-accessibility-baseline/SPEC.md)), Enter on a focused `<mira-w>` | Esc returns focus to where it was |

- A **click inside a link** never opens the popover and never prevents navigation; hover still
  works there.
- Text selection that starts on a swapped word does not open the popover.
- Moving from the word to the popover keeps it open (the 200 ms grace plus an invisible
  8 px bridge along the arrow).
- Only one popover exists; hovering another word moves it with no close animation.

### 4. Placement

- Below the word, centered on it, flipping above when there is less space below than the
  popover's height plus 8 px; clamped 8 px from viewport edges, the arrow moving to stay over
  the word.
- Multi-line words (wrapped) anchor to the first line box (`getClientRects()[0]`).
- Position updates on scroll and resize in `requestAnimationFrame`; if the word leaves the
  viewport, the popover closes (pinned popovers too).
- The host uses `popover="manual"` so it renders in the top layer above any z-index, overflow
  or transform on the page; where the Popover API is missing (it is supported in Chrome 114+,
  Firefox 125+, Safari 17+), it falls back to `position: fixed; z-index: 2147483647` on the
  host.

### 5. Theme

The popover matches the page, not only the OS: on open, it reads the computed background of
the word's nearest ancestor with a non-transparent background (up to `<html>`), and uses the
dark tokens when that color's relative luminance is below 0.2, else light. If every ancestor
is transparent, it follows `prefers-color-scheme` and `<meta name="color-scheme">`. The
Mira theme preference ([06 §2](../06-design-system/SPEC.md)) does not override this: the
popover is part of the page.

### 6. DOM, isolation and privacy

- One host element, `<mira-popover>`, created lazily on the first open and appended to
  `document.documentElement` (not `body`, which some sites replace). It carries inline
  `style` with `all: initial !important; position: fixed !important; inset: auto
  !important; ...` so site CSS can't hide or move it, and `translate="no"`.
- A **closed** shadow root holds everything; page scripts can't read its content. Styles come
  from `ui/popover-style.js` ([06 §2](../06-design-system/SPEC.md)) as a constructed
  stylesheet (`adoptedStyleSheets`), with a `<style>` fallback.
- Content is built on demand from the content script's WeakMap entry for the word (from
  [15](../15-framework-safe-swapping/SPEC.md), `MiraEngine.infoFor(el)`); the page's
  `<mira-w>` carries only what 15 puts there: `lang` and `dir` (rendering and screen readers),
  `translate="no"` and `class="notranslate"` (machine translation, [43](../43-copy-print-translate-coexistence/SPEC.md)),
  and `mira-*` state classes that carry no word data. No `title`, no `data-*`, no `aria-*`.
- The page can still see the visible foreign word and that a `<mira-popover>` exists after
  first use; the privacy policy ([28](../28-privacy-and-store-readiness/SPEC.md)) says so.
- Event listeners are delegated: one `pointerover`, `pointerout`, `pointerdown`, `click`
  and `keydown` listener on `document` in the capture phase, all passive except the
  long-press `contextmenu` suppression. They do nothing unless the target is inside a
  `<mira-w>` or the popover.

### 7. Accessibility

- The popover's root is `role="dialog"` with `aria-label="{native}, {English name of the
  language}"` (or without English in reveal mode). It is non-modal.
- Hover-opened: focus stays on the page; the popover content is not announced (this matches
  how sighted users get it and avoids chatter). Keyboard-opened: focus moves to the popover's
  first action; Tab cycles inside it; Esc closes and returns focus; the dialog is announced.
- Native text carries `lang` so screen readers switch voice; the language name is also
  written out, never conveyed by color.
- All actions are buttons with visible labels, 32 px tall, at least 24 px apart from each
  other (WCAG 2.5.8); 44 px on coarse pointers.
- Under reduced motion the popover appears with a 120 ms fade and no movement; otherwise a
  180 ms fade and 4 px rise (`--ease-enter`).
- What screen readers hear on the swapped word itself is decided in
  [27](../27-accessibility-baseline/SPEC.md).

### 8. Standalone toast

The same `<mira-popover>` host also renders a toast that works with no popover open, for
messages that start outside the page: [33](../33-context-menu-and-shortcuts/SPEC.md)'s
context-menu add ("Learning “dog” in Spanish…", then "dog → perro · Spanish  Undo"),
keyboard command feedback ("Select a swapped word first."), and pause or undo confirmations.

- The content script accepts `{type: "toast", jobId}` or `{type: "toast", message}` from the
  background only (sender checks per [26](../26-background-sync-correctness/SPEC.md)); for a
  job it renders the job's current line from `addJobs` ([24 §4](../24-add-flow-safety/SPEC.md))
  and follows it as it changes.
- Position: bottom center of the viewport, 16 px from the edge, above page content in the top
  layer; max width 360 px; [06](../06-design-system/SPEC.md)'s toast component.
- `role="status"`, `aria-live="polite"`, never takes focus; 6 s, or 10 s with an action;
  paused while hovered or focused; Esc dismisses; one toast at a time (a new one replaces the
  old).
- Its Undo calls the background's `undo` message for that job and word.
- Created lazily like the popover; if the content script isn't running in the tab, the
  background falls back as 33 describes.

### 9. Copy

| Element | Copy |
|---|---|
| Language line | "{English name} · {endonym}" (endonym omitted when equal) |
| Also | "Also: {native} ({romanization}) · …" |
| Actions | "Edit", "Pause word", "Wrong meaning here" |
| Wrong-meaning choices | "Never swap “{form}” for {native}" / "Skip it just on this page" |
| Paused toast | "Paused {native}. It won't be swapped until you resume it." + "Undo" |
| Form removed toast | "{native} won't replace “{form}” any more." + "Undo" |
| Skipped toast | "Skipped on this page." + "Undo" |
| Last form edge case | If the form is the word's only English form: "That's the only meaning saved for {native}. Pause the word instead?" with "Pause word" |

### 10. Edge cases

- **Word removed or edited while open:** the popover updates from the new entry, or closes with
  "That word was removed." if gone.
- **Swap inside a contenteditable or form field:** never happens ([16](../16-what-not-to-swap/SPEC.md));
  if a `<mira-w>` becomes editable, the popover doesn't open.
- **Iframes:** each frame's content script owns its own popover ([42](../42-frames-and-shadow-dom/SPEC.md)).
- **Fullscreen video:** the top layer handles it; if the word is outside the fullscreen
  element, the popover doesn't open.
- **Print:** the host has `@media print { display: none }`.
- **Very long notes or many candidates:** max height 60 vh, the middle scrolls.
- **Pages with `pointer-events: none` overlays:** hover won't fire; the keyboard command still
  works.

### 11. Performance

- Zero cost until the first interaction except the delegated listeners.
- Opening builds at most ~40 nodes; budget 4 ms on a mid-range laptop.
- No `getComputedStyle` calls on hover except for the theme check at open (memoized per
  ancestor for the page view).

## Acceptance criteria

- [ ] No swapped element on any fixture page has a `title` or any `data-*` attribute; the
      only Mira elements in light DOM are `<mira-w>` and, after first use, `<mira-popover>`.
- [ ] `document.querySelector("mira-popover").shadowRoot` is `null` from page script.
- [ ] Hovering a swapped word for 300 ms opens the popover; moving into the popover keeps it
      open; leaving both for 200 ms closes it.
- [ ] Clicking a swapped word inside `<a href>` navigates and does not open the popover.
- [ ] Keyboard command on a selected swapped word opens the popover with focus on its first
      action; Esc returns focus to the selection.
- [ ] An Arabic native with a romanization renders in the correct order inside an English
      sentence (visual test).
- [ ] On a dark website with a light OS theme, the popover uses dark tokens.
- [ ] Pause word reverts all swaps of that word on the page within 100 ms and survives reload.
- [ ] "Wrong meaning here" → "Never swap" removes the form from the word in storage, with a
      working Undo.
- [ ] Site CSS `* { display: none !important }` on `mira-popover` does not hide it
      (fixture).
- [ ] axe-core finds no violations inside the popover in both themes.
- [ ] A `{type: "toast", jobId}` message from the background shows the job's line in the
      page with no popover open, updates when the job finishes, and its Undo works; the toast
      never takes focus.

## Test plan

- **Unit (jsdom):** placement math (flip, clamp, arrow), hover-intent timing with fake timers,
  theme detection from ancestor backgrounds, bidi markup.
- **End-to-end (Playwright):** fixtures with links, buttons, a React app, a dark page,
  `transform`ed containers, `overflow: hidden` parents, a page with hostile CSS, RTL page;
  touch emulation for tap and long press; keyboard path; privacy assertions from page
  context.
- **Manual:** NVDA + Firefox, VoiceOver + Safari later ([51](../51-safari-port/SPEC.md)),
  TalkBack + Firefox for Android.

## Rollout and migration

Ships with [15](../15-framework-safe-swapping/SPEC.md)'s element change, replacing `title`
tooltips in one release. The `cursor: help` hint stays as 15 defines it. Changelog: "Point at, tap, or use a shortcut on any swapped word to see its meaning,
hear it, and fix it."

## Open questions

1. **Hover delay.** Recommendation: 300 ms, tunable in settings later if learners ask; shorter
   delays fire while the pointer passes over text.
2. **Edit inline or in the dashboard?** Recommendation: dashboard. Editing every field inside a
   320 px popover on someone else's page is cramped and risky; the popover keeps the two most
   common fixes (pause, wrong meaning) inline.

## Future work

- "Words on this page" list in the popup for touch users who can't long-press in links.
- Show the sentence the word came from ([07](../07-word-model-v2/SPEC.md) `source_text`) in
  the popover.
