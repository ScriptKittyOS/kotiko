# 43 · Copy, print and translate coexistence

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | S (a day or two) |
| **Depends on** | [15-framework-safe-swapping](../15-framework-safe-swapping/SPEC.md); [16](../16-what-not-to-swap/SPEC.md) and [50](../50-ui-localization-and-base-language/SPEC.md) for the page-language gate |
| **Unblocks** | None |
| **Sources** | [03 B10, D1, D6, D7, D8, section 3](../../docs/research/03-browser-extension.md) |

## Problem

Swapped words leak into everything the user does with a page (03, read from the code):

- **Copy and paste** takes the foreign words: copying "Thanks for the coffee" from a page gives
  "Gracias for the coffee" in an email or a document (03 D1); for a Spanish reader learning
  Japanese, "Gracias por el café" becomes "ありがとう por el café".
- **Printing** and "Save as PDF" print the swapped page (03 B10).
- **Machine translation** collides with Mira. Chrome's built-in translation and Google Translate
  wrap text in `<font>` elements and change `<html lang>`; Mira's observer then matches words
  inside translated output (an English page translated into Spanish would get Spanish-base
  swaps on top of machine output), and the translator may translate Mira's words back into the
  learner's language (03 D7). The translator also replaces the text nodes Mira's swap records
  point at, which slice 15's cleanup would otherwise read as the site removing them.

## Goals

- Copying a selection that contains swaps puts the page's original text on the clipboard,
  whatever language the page is in (setting, on by default), in plain text and HTML.
- Printing shows the original page (setting, on by default) and the page returns to its
  swapped state afterwards, identically.
- Swapped words survive page translation untouched, Mira stays out of the translator's way while
  a page is translated, and resumes cleanly when translation is turned off.

## Non-goals

- Find in page (Ctrl+F) for swapped words: can't be fixed from a content script (03 D6); the
  toggle shortcut is [33](../33-context-menu-and-shortcuts/SPEC.md)'s, and onboarding mentions it.
- Other sites' text features (annotation tools, share-a-quote, reading-time counters): accepted
  cost, listed in the FAQ of [44](../44-docs-site/SPEC.md) (03 D8).

## User stories

- As a learner quoting an article in an email, I paste what the author wrote.
- As someone printing a recipe, the printout is the recipe as written, in English or in
  Spanish.
- As a learner who translates a page into Portuguese, my Spanish words stay Spanish inside the
  translated sentences, and Mira doesn't scramble the translation.
- As a Spanish reader who translates an English page into Spanish, I don't want Mira to start
  swapping words in the machine's Spanish halfway through.

## Specification

File: `extension/content/coexist.js`.

### Copy the original text

A `copy` listener and a `dragstart` listener on `window`, bubble phase, so the page's own handlers
run first.

```
onCopy(e):
  if !settings.copyOriginal or e.defaultPrevented: return    // the site wrote its own data
  sel = getSelection(); if !sel or sel.isCollapsed: return
  swaps = mira-w elements intersecting any range, in document order
          (range.intersectsNode over querySelectorAll within each range's common ancestor,
           plus shadow roots from 42 where the selection's anchor lives)
  if swaps is empty: return                                     // default copy, untouched

  // plain text: keep the browser's own line breaks and spacing
  text = sel.toString()
  cursor = 0
  for el in swaps:
    shown = visible part of el within the selection (its whole text, or the selected suffix or
            prefix when the range starts or ends inside it)
    i = text.indexOf(shown, cursor)
    if i < 0: continue                                          // hidden or collapsed: skip
    original = info.get(el).surface                             // the page's own word, as it was
    text = text.slice(0, i) + original + text.slice(i + shown.length)
    cursor = i + original.length

  // HTML: clone and replace in the same order
  html = ""
  for range in ranges:
    frag = range.cloneContents()
    clones = frag.querySelectorAll("mira-w")                    // same order as originals
    zip(clones, swaps in this range): replace each clone with a Text node of its original's surface
    html += serialize(frag)                                     // via a detached <div>
  e.clipboardData.setData("text/plain", text)
  e.clipboardData.setData("text/html", html)
  e.preventDefault()
```

The original is the exact surface slice 15 recorded ("Perros", "houses", "犬"), not the word's
gloss, so case, inflection and spacing come back as the author wrote them. A selection that
starts or ends inside a swapped word copies the whole original word: half a foreign word mapped
to half of the page's word would be meaningless. `dragstart` builds the same data
for `e.dataTransfer`. Editable fields never contain swaps (16), so `cut` needs no handling.

Setting: "Copy the original text" (`copyOriginal`, default on; Spanish "Copiar el texto
original"). With it off, the clipboard gets what is on screen.

### Print the original page

```
window.addEventListener("beforeprint", () => {
  if (!settings.printOriginal) return;
  engine.suspend();          // observer paused, queue held
  engine.unwrapAll();        // synchronous, in place, no normalize (15)
});
window.addEventListener("afterprint", () => {
  if (suspendedForPrint) engine.reapply("print");   // 18's seeded choices give the same page
});
```

`matchMedia("print")` change events are a fallback where `beforeprint` is missing. Budget:
unwrapping 10,000 swaps takes under 100 ms, inside the handler, before the browser lays out the
print snapshot. Setting: "Print the original page" (`printOriginal`, default on; Spanish
"Imprimir la página original").

### Machine translation

**Keep words intact.** Every swap carries `translate="no"` and class `notranslate` (15), which
Chrome's translator, Google Translate and Microsoft Translator respect, so the learner's word stays
in the translated sentence.

**Detect translation** from slice 15's attribute observer on `<html>`:

| Signal | Translator |
|---|---|
| class `translated-ltr` or `translated-rtl` added | Chrome built-in, Google Translate |
| `lang` changes from the page's original language to another one | Firefox Translations, Edge, others |
| `_msttexthash` attributes appearing on elements under body (checked when an added `font` or text batch arrives) | Microsoft Translator in Edge |

**While translated**, Mira is frozen:

- no new swaps (the observer keeps running but only records);
- slice 15's orphan cleanup is suspended, because the translator, not the site, is replacing nodes
  Mira tracks, and it restores them when translation is undone;
- existing swaps stay, untouched.

**When translation is undone** (class removed, `lang` back to the original language): leave frozen mode, run
slice 15's reconciliation (restore records whose original node is gone by replacing their
`mira-w` elements with their original surface text, drop stale records), then re-apply. The page language gate
(16) is re-evaluated at the same moment.

**A page translated into one of the learner's base languages** stays frozen for as long as the
translation is on, even though its new `lang` is a base: machine output is not what the author
wrote, and swapping in it would mix two layers of substitution. The popup's page state says
"This page is machine-translated. Mira waits until you switch back to the original."
(Spanish: "Esta página está traducida automáticamente. Mira espera a que vuelvas al original.")

If translation is detected after Mira already processed some of the translator's mutations (the
class can arrive a few milliseconds after the first replacements), the cleanup handler checks the
class at handling time and skips removals whenever it is present.

## Acceptance criteria

- [ ] Copying a paragraph with three swaps gives the page's original text in `text/plain` and
      `text/html`, on an English fixture and on a Spanish one ("Los perros" comes back as "Los
      perros", not the gloss "perro") (Playwright reads the clipboard in Chromium and Firefox).
- [ ] A selection starting mid-swap copies the whole original word; a selection without swaps is
      left to the browser.
- [ ] A site that sets its own clipboard data (`preventDefault`) keeps it.
- [ ] With "Print the original page" on, `page.emulateMedia({ media: "print" })` plus a `beforeprint`
      dispatch shows no `mira-w`; after `afterprint`, the swapped DOM is identical to before.
- [ ] On a fixture that simulates Chrome translation (class change plus `<font>` wrapping of text
      nodes), swaps survive, no new swaps are made inside `<font>`, and undoing translation
      returns a consistent page with no duplicated or missing text.
- [ ] With base languages `es` and `en`, translating an English fixture into Spanish (simulated)
      makes no Spanish-base swaps in the translated text; undoing it resumes English-base swaps.

## Test plan

- **Playwright, new fixtures in slice 02's corpus:** `copy.html` (selections across swaps, inside a swap, across
  blocks, in a shadow root); `print.html`; `translate-sim.html` replaying a recorded Chrome
  translation mutation sequence and its revert.
- **Manual:** Chrome built-in translate and Edge translate on a news article; Firefox
  Translations; print preview in all three browsers; copying into Google Docs and a mail client.

## Rollout and migration

Both settings default on. Changelog: "Copying and printing now give you the page's original text,
and Mira stays out of the way of page translation."

## Open questions

1. **Copy default.** Recommendation: on; learners who want the foreign words can switch it off,
   and the safe default avoids surprises in emails and documents.

## Future work

- A modifier key (for example Alt+copy) to copy what is on screen without changing the setting.
