// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The stylesheet for swapped words (slices 15, 17, 27), as a string the content script adds
// to a page only when it swaps its first word there. A manifest stylesheet would be in every
// page, paused, switched off and sensitive sites included, where a page could style its own
// <kotiko-w> and see Kotiko's rules apply (security review A-03).
//
//   KotikoSwapStyle.install(document)     adds the sheet once; again if the page dropped it
//   KotikoSwapStyle.uninstall(document)   takes it out (no swaps left on the page)
(() => {
  const CSS = `
/* A swapped word (slice 15): an inline custom element, isolated for right-to-left words,
   with a dotted underline in the text's own color. Pointing at it, clicking or tapping it
   opens the word card (slice 19). */
kotiko-w {
  display: inline;
  unicode-bidi: isolate;
  /* Slice 17: never grows the line box, whatever font draws the word. With 1, Firefox
     still sized the box from a taller fallback font (Myanmar +3.5 px, Thai +0.5 px);
     with 0 the paragraph's own line height alone sets the spacing. The underline, the
     hit area and the card's anchor use the text's content area, which this doesn't change. */
  line-height: 0;
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-color: currentColor;
  text-decoration-thickness: from-font;
  text-underline-offset: 0.18em;
  cursor: help;
}

/* Slice 27 §2. With "Screen readers hear swapped words as" set to the original word (or
   both), the word shows in <kotiko-v> (hidden from screen readers) and what they read sits
   in <kotiko-sr>: visually hidden, and left out of selections and copies. */
kotiko-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
  user-select: none;
}

/* "Let me Tab to swapped words": the focused word shows a ring in the text's own color. */
kotiko-w:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
`;

  const sheets = new WeakMap();

  // A constructed sheet in document.adoptedStyleSheets (no page CSP applies to it, and the
  // page's own <style> edits can't remove it); a <style> element where that isn't supported.
  function install(doc = globalThis.document) {
    const had = sheets.get(doc);
    try {
      const Sheet = globalThis.CSSStyleSheet;
      const sheet = had instanceof Sheet ? had : new Sheet();
      if (sheet !== had) {
        sheet.replaceSync(CSS);
        sheets.set(doc, sheet);
      }
      if (!doc.adoptedStyleSheets.includes(sheet)) doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      return;
    } catch {
      // no constructed stylesheets here: a <style> element instead
    }
    if (had?.isConnected) return;
    const style = had && had.localName === "style" ? had : doc.createElement("style");
    style.textContent = CSS;
    (doc.head ?? doc.documentElement).append(style);
    sheets.set(doc, style);
  }

  function uninstall(doc = globalThis.document) {
    const had = sheets.get(doc);
    if (!had) return;
    sheets.delete(doc);
    if (had.localName === "style") {
      had.remove();
      return;
    }
    try {
      if (doc.adoptedStyleSheets.includes(had)) doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((x) => x !== had);
    } catch {
      // the page's document went away
    }
  }

  const api = { CSS, install, uninstall };
  globalThis.KotikoSwapStyle = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
