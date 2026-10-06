// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Search for the dashboard's word list (slice 21 §4): one folded string per word group,
// built once and updated per change, so a keystroke is a substring test per group.
// Folding ignores case (with the word's own language where casing depends on it), accents
// and tone marks ("xiexie" finds "xièxie", "cafe" finds "café", "nino" finds "niño"), and
// pronunciations are also matched with hyphens and spaces removed ("spaseeba" finds
// spa-SEE-ba). No DOM, so the same file runs in the dashboard (globalThis.KotikoSearch)
// and in Node tests (module.exports).
//
//   const index = KotikoSearch.createIndex();
//   index.set(group.key, KotikoSearch.entryFor(group));   // on load and on each change
//   index.search("xiexie", orderedKeys)  -> keys in the given order, exact natives first
//   KotikoSearch.highlight("xièxie", "xie") -> [[0, 3]]   ranges in the original text
(() => {
  // Combining marks that are accents or vowel points, removed after NFKD: Latin, Greek and
  // Cyrillic diacritics (U+0300-036F), Arabic harakat and Hebrew points. Japanese voicing
  // marks and Indic vowel signs are letters for search, so they stay.
  const MARKS = /[\u0300-\u036f\u064b-\u065f\u0670\u0591-\u05c7]/g;
  // Letters NFKD doesn't decompose that learners type without the stroke.
  const EXTRA = { ł: "l", ø: "o", đ: "d", ħ: "h", ı: "i", ŀ: "l", ß: "ss", æ: "ae", œ: "oe" };
  const EXTRA_RE = /[łøđħıŀßæœ]/g;
  // Languages whose lowercase differs from the default (Turkish dotless i, Lithuanian dots).
  const LOCALE_CASE = new Set(["tr", "az", "lt", "crh", "tt", "ba"]);
  const SEP = "\u0001";
  const COMPACT = /[\s\u00a0\u2010-\u2015-]+/g;

  const primary = (tag) => String(tag ?? "").split(/[-_]/)[0].toLowerCase();

  function lower(s, lang) {
    if (lang && LOCALE_CASE.has(primary(lang))) {
      try {
        return s.toLocaleLowerCase(lang);
      } catch {
        // an invalid tag: the default casing
      }
    }
    return s.toLowerCase();
  }

  // The searchable form of a string: lowercase, no accents or tone marks, NFC.
  function fold(value, lang) {
    if (value === null || value === undefined) return "";
    return lower(String(value), lang).normalize("NFKD").replace(MARKS, "").replace(EXTRA_RE, (c) => EXTRA[c]).normalize("NFC");
  }

  // A pronunciation as typed in search: folded, without syllable hyphens or spaces.
  const compact = (value, lang) => fold(value, lang).replace(COMPACT, "");

  const texts = (v) => (Array.isArray(v) ? v : [v]).filter((x) => typeof x === "string" && x.trim());
  const formText = (f) => (typeof f === "string" ? f : f?.text);

  // The index entry of a word group (slice 21 §3: every record sharing lang and native key).
  // Matches native, romanization, the stress-marked form, every gloss, form and note in
  // every base, and each record's pronunciations.
  function entryFor(group) {
    const records = group.records ?? [group];
    const lang = group.lang ?? records[0]?.lang;
    const parts = [];
    const prons = [];
    const natives = new Set();
    for (const r of records) {
      const base = r.base_lang ?? "en";
      for (const n of texts(r.native)) natives.add(fold(n, lang));
      for (const t of texts([r.native, r.native_vocalized, r.romanization])) parts.push(fold(t, lang));
      for (const t of texts([r.gloss ?? r.english, ...(r.forms ?? []).map(formText), r.note])) parts.push(fold(t, base));
      for (const t of texts([r.pronunciation, r.pronunciation_careful])) {
        prons.push(compact(t, base));
        parts.push(fold(t, base));
      }
    }
    return { text: parts.join(SEP), pron: prons.join(SEP), natives: [...natives] };
  }

  function createIndex() {
    const entries = new Map();
    return {
      set: (key, entry) => void entries.set(key, entry),
      delete: (key) => void entries.delete(key),
      has: (key) => entries.has(key),
      get: (key) => entries.get(key),
      get size() {
        return entries.size;
      },
      clear: () => entries.clear(),
      // Keys from `keys` (already in the list's sort order) whose entry matches `query`,
      // with exact native matches moved first, keeping the order within each part.
      search(query, keys) {
        const q = fold(String(query ?? "").trim());
        if (!q) return keys.slice();
        const qc = q.replace(COMPACT, "");
        const exact = [];
        const rest = [];
        for (const key of keys) {
          const e = entries.get(key);
          if (!e) continue;
          if (e.text.includes(q) || (qc && e.pron.includes(qc))) {
            (e.natives.includes(q) ? exact : rest).push(key);
          }
        }
        return exact.length ? exact.concat(rest) : rest;
      },
    };
  }

  // Ranges [start, end) in `text` (UTF-16 offsets) whose folded form contains the folded
  // query, so the list can set matched letters in weight 600 whatever accents they carry.
  function highlight(text, query, lang) {
    const s = String(text ?? "");
    const q = fold(String(query ?? "").trim());
    if (!s || !q) return [];
    let folded = "";
    const origin = []; // folded index -> [start, end) of the code point it came from
    for (let i = 0; i < s.length;) {
      const cp = s.codePointAt(i);
      const len = cp > 0xffff ? 2 : 1;
      const f = fold(s.slice(i, i + len), lang);
      for (let k = 0; k < f.length; k++) origin.push([i, i + len]);
      folded += f;
      i += len;
    }
    const out = [];
    let from = 0;
    for (;;) {
      const at = folded.indexOf(q, from);
      if (at < 0 || !q.length) break;
      const start = origin[at][0];
      const end = origin[at + q.length - 1][1];
      const last = out.at(-1);
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else out.push([start, end]);
      from = at + q.length;
    }
    return out;
  }

  const api = { fold, compact, entryFor, createIndex, highlight };
  globalThis.KotikoSearch = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
