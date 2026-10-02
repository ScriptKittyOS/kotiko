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

  const api = { escapeRe, norm, languageName, buildMatcher, matchCase, describe, tooltip };
  globalThis.KotikoMatcher = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
