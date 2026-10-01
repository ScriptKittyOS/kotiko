# 33 · Context menu and shortcuts

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | S (a day or two) |
| **Depends on** | [24-add-flow-safety](../24-add-flow-safety/SPEC.md); uses [11-local-first-mode](../11-local-first-mode/SPEC.md)'s job queue, [18-language-precedence-and-mixing](../18-language-precedence-and-mixing/SPEC.md)'s Focus mode, [19-word-popover](../19-word-popover/SPEC.md)'s in-page host |
| **Unblocks** | None |
| **Sources** | [05 S14, S15, S16, S33, section 3.5](../../docs/research/05-learner-ux.md); [03 D3, D6](../../docs/research/03-browser-extension.md) |

## Problem

The moment a learner meets a word is while reading, and Mira can't be reached from
there. There is no `contextMenus` permission (`extension/manifest.json:6`) and no
`commands` key in the manifest, so:

- Adding a word you just read means opening the popup and retyping it
  ([05 S14](../../docs/research/05-learner-ux.md)).
- On a page in the language you're learning, you can't add the foreign word you selected
  ([05 S15](../../docs/research/05-learner-ux.md)).
- Keyboard users have to reach the toolbar icon for everything, can't toggle swaps to
  use Find in page ([03 D6](../../docs/research/03-browser-extension.md)), and can't open a
  swapped word's details.

## Goals

- Right-click a selection to learn it in one of your languages, or to add a foreign word,
  in one click, with the page's language as a hint.
- The click returns immediately; the result appears in the page and in the popup.
- Four keyboard shortcuts: open Mira, show the original English on this tab, open the
  popover for the selected swapped word, and cycle the Focus language.
- No URL or page content beyond the selection ever leaves the browser.

## Non-goals

- Actions on a swapped word (pause, edit, wrong meaning): slice [19](../19-word-popover/SPEC.md)'s popover.
- Firefox for Android, which has neither menus nor commands: slice [45](../45-firefox-android/SPEC.md) hides these.
- Adding long passages: the add flow's phrase choice belongs to slice [24](../24-add-flow-safety/SPEC.md).

## User stories

- As a learner reading English, I want to right-click "dog" and pick Spanish, so that
  "perro" appears on the next page without retyping.
- As a learner reading a Spanish news site, I want to right-click "periódico" and add it.
- As a keyboard user, I want a shortcut that shows the original English so that Find in
  page works, and the same shortcut to bring my words back.

## Specification

### 1. Context menu

Permission: `contextMenus` (no install warning in Chrome; Firefox exposes the same API,
also as `menus`). Created in `runtime.onInstalled` and rebuilt (debounced 1 s) whenever
the set of languages in the store changes.

```
Mira                                   (context: selection)
 ├─ Learn “%s” in  ▸  Spanish
 │                    Japanese
 │                    Arabic
 │                    ─────────
 │                    Another language…
 └─ Add “%s” to my words
```

- Languages: the user's languages with words, Focus language first, then by word count,
  at most 6, then "Another language…". With no languages yet, "Learn “%s” in" lists the
  learner's onboarding choices (slice 22), or only "Another language…".
- "Add “%s” to my words" is for a foreign word; the page's language is the hint.
- Firefox supports `menus.onShown` and `menus.refresh`, so there the menu hides the item
  that doesn't fit: if the selection is in a non-Latin script or the selection's nearest
  `lang` is not English, only "Add" shows; otherwise only "Learn in". Chrome can't change
  a menu while it is open, so both items show.
- The selection is trimmed and collapsed to single spaces. If it is longer than 60
  characters or 4 words, the click opens the add box prefilled instead of queuing, so
  slice 24's "phrase or pick words" choice applies.

**On click** (`contextMenus.onClicked`, in the background):

1. Build an add job (slice 11) with `text` (the selection), `targetLang` for "Learn in",
   `pageLang` from a one-shot `scripting.executeScript` that reads the selection's
   nearest `lang` and `<html lang>`, and a new `clientId`. No URL, no surrounding text.
2. Return. The badge shows a small dot while jobs are running (slice 20 owns the badge).
3. If the tab has Mira's content script, send it `{type: "toast", jobId}`; slice 19's
   in-page host shows:

   ```
   Learning “dog” in Spanish…        then      dog → perro · Spanish   Undo
   ```

   in a `role="status"` region that doesn't take focus, for 6 seconds or until Esc.
   Undo uses slice 24's undo for that job.
4. "Another language…" opens the add box prefilled with `dog in ` and the cursor at the
   end: `action.openPopup()` where the browser allows it from a menu click (Chrome 127+,
   Firefox with a user gesture; medium confidence), otherwise a small window
   (`windows.create({type: "popup"})`) with the same add page.

The prompt receives `targetLang` as structured input (slice 09 defines the field; "If
the user names a language, always use it", as today in `server/lib/slovo/llm.ex:40`).
In Firefox, the first use with a remote provider requests the optional `websiteContent`
data consent (slice 28, section 4); if declined, the add box opens prefilled instead, so
the user sends it by pressing Enter.

### 2. Keyboard commands

```json
"commands": {
  "_execute_action": { "suggested_key": { "default": "Alt+Shift+M" }, "description": "Open Mira" },
  "toggle-tab":      { "suggested_key": { "default": "Alt+Shift+O" }, "description": "Show the original English on this tab, or swap again" },
  "reveal-word":     { "suggested_key": { "default": "Alt+Shift+R" }, "description": "Show details for the selected word" },
  "cycle-focus":     { "suggested_key": { "default": "Alt+Shift+L" }, "description": "Focus on the next language" }
}
```

Chrome allows at most four suggested shortcuts per extension, so all four have one; any
later command ships without a default. If a key is taken by another extension, the
browser leaves it unset; the settings page shows that state.

- **toggle-tab**: per tab, until the tab closes. The background keeps
  `tabsOriginal: {tabId: true}` in `storage.session` and tells the content script, which
  unwraps (slice 15) or re-applies. It survives navigation in that tab, because the
  content script asks on load. The toolbar badge shows the "off" state (slice 20). Toast:
  "Showing the original English. Alt+Shift+O to swap again."
- **reveal-word**: the content script finds a swapped word inside the selection, or the
  one containing the caret or focus, and opens slice 19's popover on it with focus moved
  into it. Nothing selected: toast "Select a swapped word first."
- **cycle-focus**: All → each language in order → All, using slice 18's Focus setting.
  Toast: "Focus: Spanish" / "All languages".

**Settings page** "Shortcuts" row lists `commands.getAll()` with the current keys. In
Firefox, each key is editable in place with `commands.update`. In Chrome, "Change" opens
`chrome://extensions/shortcuts` with `tabs.create`.

### 3. Accessibility and copy

Toasts are announced politely and never steal focus. All copy goes through slice 25's
message table and slice 50's localization. Shortcut text uses the platform's names
(Option on macOS) from `runtime.getPlatformInfo()`.

## Acceptance criteria

- [ ] Right-click "dog" → Learn in → Spanish queues one job with `targetLang: "es"`, no URL
      in the job or the request body, and the toast shows the result with a working Undo.
- [ ] The click returns before the model answers; closing the tab doesn't lose the job.
- [ ] On a page with `<html lang="es">`, "Add “periódico”" sends `pageLang: "es"`.
- [ ] In Firefox, only the fitting menu item shows for an English and a Cyrillic selection.
- [ ] Selecting 10 words and clicking opens the prefilled add box instead of queuing.
- [ ] The menu's language list updates within 2 s of adding a word in a new language.
- [ ] Each command does what section 2 says in Chromium and Firefox; `toggle-tab` survives
      a same-tab navigation and resets when the tab closes.
- [ ] Toasts are announced by NVDA and VoiceOver without moving focus (manual).

## Test plan

- **Unit** (slice 02's Node harness): menu model from a language list; selection
  normalisation and the 60-character/4-word rule; job construction (no URL); the
  `tabsOriginal` state; focus cycling order.
- **End-to-end** (Playwright): call the registered `onClicked` and `commands.onCommand`
  listeners through the extension's test hook (native menus and global shortcuts can't be
  driven reliably), then assert the job, the toast and the page state.
- **Manual**: real right-click and real shortcuts on Windows, macOS and Linux in Chrome
  and Firefox; conflicts with common keyboard layout switchers (Alt+Shift).

## Rollout and migration

- Adds the `contextMenus` permission. In Chrome it has no warning, so the update doesn't
  disable the extension; in Firefox it adds no prompt (medium confidence; check on the
  release build).
- Changelog: "Right-click any word to learn it in one of your languages. New shortcuts:
  Alt+Shift+M opens Mira, Alt+Shift+O shows the original English."

## Open questions

1. **Default shortcuts.** Alt+Shift+M/O/R/L as specified? Recommendation: yes; they avoid
   common browser shortcuts. Revisit if users report clashes with layout switching.
2. **Menu when nothing is selected.** Add "Pause Mira on this site" to the page context
   menu? Recommendation: not now; the popup is one click away and menus get crowded.

## Future work

- "Hold to show originals" needs key-up events, which commands don't provide; a content
  script key listener could do it as an opt-in.
- Context menu on images with alt text, and on links.
