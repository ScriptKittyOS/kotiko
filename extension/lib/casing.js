// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// How a swapped word is written (slice 17): which of the page's capitals it carries, in the
// target language's own rules. A capital on the page is passed on only where it marks
// position or emphasis (a sentence start, a shouted line), never where the base language
// capitalises the word itself (English Monday and I, German nouns, headline Title Case).
// Otherwise the word shows exactly as stored: Kotiko never lowercases it, so English
// "Monday" keeps its capital on a Spanish page. Scripts without case in practice, Georgian
// included, are returned untouched. No DOM; runs in content scripts, the welcome page
// (globalThis.KotikoCasing) and Node tests.
//
//   KotikoCasing.display({ surface, shape, sentenceStart, shouting, native, lang }) -> string
(() => {
  // Scripts whose case is used in everyday writing (step 2). Georgian has Mtavruli capitals
  // since Unicode 11, but prose doesn't use them and many fonts lack them.
  const CASED = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Adlam}]/u;
  const LETTER = /\p{L}/u;

  const primary = (lang) => String(lang ?? "").split("-")[0].toLowerCase();
  // Root casing, except where a locale's differs: Turkish and Azerbaijani dotted İ,
  // Lithuanian dot above.
  const LOCALE_CASING = new Set(["tr", "az", "lt"]);
  const localeFor = (lang) => (LOCALE_CASING.has(primary(lang)) ? primary(lang) : "und");

  function hasCase(s) {
    const first = [...s].find((c) => LETTER.test(c));
    return !!first && CASED.test(first);
  }

  // Greek capitals drop accents and breathings, keep the dialytika, and add one where a
  // dropped accent kept two vowels apart (άι -> ΑΪ), as Greek typography does.
  const GREEK_DROP = new Set(["\u0301", "\u0300", "\u0342", "\u0313", "\u0314"]);
  const GREEK_SPLIT = new Set(["\u03B9", "\u03C5", "\u0399", "\u03A5"]);
  function greekUpper(s) {
    const out = [];
    let dropped = false;
    const chars = [...s.normalize("NFD")];
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (GREEK_DROP.has(c)) {
        dropped = true;
        continue;
      }
      if (/\p{M}/u.test(c)) {
        out.push(c);
        continue;
      }
      out.push(c);
      if (dropped && GREEK_SPLIT.has(c) && chars[i + 1] !== "\u0308") out.push("\u0308");
      dropped = false;
    }
    return out.join("").toUpperCase().normalize("NFC");
  }

  function upper(s, lang) {
    if (primary(lang) === "el") return greekUpper(s);
    return s.toLocaleUpperCase(localeFor(lang));
  }

  // Serbo-Croatian digraph letters have their own title-case forms: ǆ -> ǅ, not Ǆ.
  const DIGRAPH_TITLE = new Map([
    ["\u01C4", "\u01C5"], ["\u01C5", "\u01C5"], ["\u01C6", "\u01C5"],
    ["\u01C7", "\u01C8"], ["\u01C8", "\u01C8"], ["\u01C9", "\u01C8"],
    ["\u01CA", "\u01CB"], ["\u01CB", "\u01CB"], ["\u01CC", "\u01CB"],
    ["\u01F1", "\u01F2"], ["\u01F2", "\u01F2"], ["\u01F3", "\u01F2"],
  ]);
  const graphemes = typeof Intl?.Segmenter === "function" ? new Intl.Segmenter("und", { granularity: "grapheme" }) : null;
  function firstGrapheme(s) {
    if (graphemes) for (const { segment } of graphemes.segment(s)) return segment;
    return s.match(/^\P{M}\p{M}*/u)?.[0] ?? s.charAt(0);
  }

  function title(s, lang) {
    if (!s) return s;
    if (primary(lang) === "nl" && s.startsWith("ij")) return `IJ${s.slice(2)}`;
    const g = firstGrapheme(s);
    const d = DIGRAPH_TITLE.get(g[0]);
    if (d) return d + g.slice(1) + s.slice(g.length);
    return g.toLocaleUpperCase(localeFor(lang)) + s.slice(g.length);
  }

  // Step 1: which capitals the page's text passes on. Only position and emphasis do: a
  // capital the base writes for the word itself (Monday, I, a German noun mid-sentence, a
  // headline in Title Case) says nothing about the target word. Slice 16 decides whether
  // such a match is swapped at all.
  function target({ shape, sentenceStart, shouting }) {
    if (shape === "upper" && shouting) return "upper";
    if (shape === "title" && sentenceStart) return "title";
    return "none";
  }

  function display({ shape, sentenceStart = false, shouting = false, native, lang }) {
    const s = String(native ?? "");
    const t = target({ shape, sentenceStart, shouting });
    if (t === "none" || !hasCase(s)) return s;
    return t === "upper" ? upper(s, lang) : title(s, lang);
  }

  const api = { display, upper, title, greekUpper, hasCase, localeFor };
  globalThis.KotikoCasing = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
