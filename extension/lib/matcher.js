// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Finds known English words in text and picks the word to show for each. No DOM or
// extension APIs, so the same file runs as a content script (globalThis.KotikoMatcher)
// and in Node tests (module.exports).
(() => {
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

  let names = null;
  function languageName(w) {
    if (w.language) return w.language;
    try {
      names ??= new Intl.DisplayNames(["en"], { type: "language" });
      return names.of(w.lang);
    } catch {
      return w.lang;
    }
  }

  // English form -> candidate words, at most one per language.
  function buildMatcher(words, hidden) {
    const map = new Map();
    for (const w of words) {
      if (hidden.has(w.lang)) continue;
      for (const f of w.forms?.length ? w.forms : [w.english]) {
        const k = norm(f || "");
        if (!k) continue;
        const list = map.get(k) ?? map.set(k, []).get(k);
        // server sends newest first; newest wins within a language
        if (!list.some((c) => c.lang === w.lang)) list.push(w);
      }
    }
    if (!map.size) return null;
    const alts = [...map.keys()]
      .sort((a, b) => b.length - a.length)
      .map((k) => escapeRe(k).replace(/ /g, "\\s+"));
    // turns: how many times each English word has been swapped, to rotate its languages
    return { re: new RegExp(`\\b(?:${alts.join("|")})\\b`, "gi"), map, turns: new Map() };
  }

  function matchCase(src, out) {
    if (src.length > 1 && /[A-Z]/.test(src) && src === src.toUpperCase()) return out.toUpperCase();
    if (/^[A-Z]/.test(src)) return out.charAt(0).toUpperCase() + out.slice(1);
    return out;
  }

  function describe(w) {
    const name = languageName(w);
    return w.romanization ? `${w.native} (${w.romanization}) · ${name}` : `${w.native} · ${name}`;
  }

  function tooltip(en, w, all) {
    const lines = [`${en} = ${describe(w)}`];
    if (w.note) lines.push(w.note);
    const others = all.filter((c) => c !== w);
    if (others.length) lines.push("", ...others.map(describe));
    return lines.join("\n");
  }

  // A lone capital letter next to a numeral, an acronym or a code is part of a name, not
  // a word: "AOI I", "World War I", "Henry VIII I", "Type I", "I-95", "I/O". `s` is the
  // text around the match (content.js adds a little of the neighbouring text) and `i` the
  // index of the one-letter match in it. Lowercase letters are never skipped here ("a NASA
  // report" keeps its "a"). Slice 16's token rules replace this.
  const ROMAN = /^(?=[IVXLCDM])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
  const JOINER = /[-‐‑/]/; // hyphens and slash; not dashes, which are prose punctuation
  const ALNUM = /[\p{L}\p{N}]/u;
  const SPACE = /\s/;
  const codeLike = (t) =>
    /\d/.test(t) || ROMAN.test(t) || (t.length >= 2 && /\p{Lu}/u.test(t) && t === t.toUpperCase());

  function skipLetter(s, i) {
    if (!/^\p{Lu}$/u.test(s[i] ?? "")) return false;
    // joined to a neighbour: I-95, A-1, I/O, 95-I
    if (JOINER.test(s[i + 1] ?? "") && ALNUM.test(s[i + 2] ?? "")) return true;
    if (JOINER.test(s[i - 1] ?? "") && ALNUM.test(s[i - 2] ?? "")) return true;

    // the neighbouring tokens, when only whitespace separates them from the letter
    let a = i - 1;
    while (a >= 0 && SPACE.test(s[a])) a--;
    let p = a;
    while (p >= 0 && ALNUM.test(s[p])) p--;
    const prev = a < i - 1 ? s.slice(p + 1, a + 1) : "";
    let b = i + 1;
    while (b < s.length && SPACE.test(s[b])) b++;
    let n = b;
    while (n < s.length && ALNUM.test(s[n])) n++;
    const next = b > i + 1 ? s.slice(b, n) : "";

    // Followed by a lowercase word ("I think") it reads as the pronoun, so a number before
    // it doesn't count: "In 2020 I moved". An acronym or numeral before it always does
    // ("AOI I and AOI II"), at the cost of "OK I think".
    const pronounLike = /^\p{Ll}/u.test(next);
    if (next && codeLike(next)) return true;
    if (prev && codeLike(prev) && !(pronounLike && /\d/.test(prev))) return true;
    // A capitalized word before it: "World War I began", "Type I", "Vitamin A". Kept when
    // that word starts the sentence and a lowercase word follows: "Can I go", "Then I said".
    if (/^\p{Lu}\p{Ll}/u.test(prev)) {
      let q = p;
      while (q >= 0 && SPACE.test(s[q])) q--;
      const midSentence = q >= 0 && /[\p{L}\p{N},;]/u.test(s[q]);
      if (midSentence || !pronounLike) return true;
    }
    return false;
  }

  const api = { escapeRe, norm, languageName, buildMatcher, matchCase, describe, tooltip, skipLetter };
  globalThis.KotikoMatcher = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
