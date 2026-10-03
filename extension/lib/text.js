// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Splitting text into words in any base language (slice 14). The browser's word segmenter
// does the work for every language, including those written without spaces (Japanese,
// Chinese, Thai); the shared boundary table (spec/lang/_generic/boundaries.json) adjusts
// it where a language needs that: hyphenated words kept whole, French l'eau split, Turkish
// casing. No DOM or extension APIs: it runs in content scripts (globalThis.KotikoText),
// extension pages, the background and Node tests (module.exports).
//
//   const rules = KotikoText.rulesFor(table, "fr");   // table = boundaries.json, or null
//   KotikoText.tokenize("l'eau froide", "fr", rules)  -> [{ start, end, key, elision }, …]
//   KotikoText.keyOf("Ｃafé", "ja", rules)              -> "café"
(() => {
  const APOS = "'\u2019\u02BC";
  const HYPHENS = "-\u2010\u2011";
  const INVISIBLE = "\u00AD\u200B\u200C\u200D\u2060\uFEFF";
  const GLUE = new Set("_@#/\\=+&%~|<>^*$`");
  const WORD = /[\p{L}\p{M}\p{N}]/u;
  const HAS_WORD = WORD;
  const SPACE = /\s/;
  const ASCII = /^[\x20-\x7e]*$/;
  const INVISIBLE_RE = /\u00AD|\u200B|\u200C|\u200D|\u2060|\uFEFF/g;
  const APOS_RE = /[\u2019\u02BC]/g;
  // Hyphens and runs of space become one space in keys: "ice-cream" and "ice cream" are
  // the same form.
  const GAP_RE = /[\s\-\u2010\u2011]+/g;
  // What comes before a sentence: punctuation, quotes and brackets, bullets, U+2029 (the
  // block boundary content scripts pass as context).
  const SENTENCE_BEFORE = new Set(".!?:;…\"“«([—–。！？•·◦‣▪\u2029");

  // A complete set of rules, for a base whose table can't be read (a page that loaded
  // before the background wrote it). Matches spec/lang/_generic/boundaries.json's default.
  const DEFAULT_RULES = Object.freeze({
    spaces: true,
    join: ["hyphen", "invisible"],
    possessive_suffix: null,
    possessive_whole_after: [],
    elision_prefixes: [],
    keep_whole: [],
    trailing_apostrophe_words: [],
    sentence_openers: [],
    fold: [],
    lower_locale: false,
  });

  const primary = (tag) => String(tag ?? "").split(/[-_]/)[0].toLowerCase();

  // The rules for a base: its entry in the shared table by full tag, else by primary
  // language, over the table's default.
  function rulesFor(table, base) {
    const entry = table?.[base] ?? table?.[primary(base)] ?? {};
    return { ...DEFAULT_RULES, ...(table?.default ?? {}), ...entry };
  }

  // Lists in the rules, as sets of keys, built once per rules object.
  const compiled = new WeakMap();
  function compile(rules, base) {
    let c = compiled.get(rules);
    if (c) return c;
    const keys = (list) => new Set((list ?? []).map((w) => rawKey(w, base, rules)));
    const join = new Set(rules.join ?? []);
    join.add("invisible");
    c = {
      join,
      elision: [...keys(rules.elision_prefixes)].sort((a, b) => b.length - a.length),
      keepWhole: keys(rules.keep_whole),
      trailing: keys(rules.trailing_apostrophe_words),
      possessive: rules.possessive_suffix ? rawKey(rules.possessive_suffix, base, rules) : null,
      possessiveWhole: keys(rules.possessive_whole_after),
      openers: new Set(rules.sentence_openers ?? []),
      width: (rules.fold ?? []).includes("width"),
      // A page repeats its words: each one's key is worked out once (up to 20,000 per base).
      keys: new Map(),
    };
    compiled.set(rules, c);
    return c;
  }

  // One segmenter per locale for the life of the script: construction costs far more than
  // a call.
  const segmenters = new Map();
  function segmenter(base) {
    let s = segmenters.get(base);
    if (!s) {
      try {
        s = new Intl.Segmenter(base, { granularity: "word" });
      } catch {
        s = new Intl.Segmenter("und", { granularity: "word" });
      }
      segmenters.set(base, s);
    }
    return s;
  }

  function rawKey(s, base, rules) {
    let k = String(s ?? "");
    if (!ASCII.test(k)) {
      k = k.replace(INVISIBLE_RE, "").replace(APOS_RE, "'").normalize("NFC");
      if ((rules.fold ?? []).includes("width")) k = k.normalize("NFKC");
    }
    k = k.replace(GAP_RE, " ").trim();
    if (rules.lower_locale) {
      try {
        return k.toLocaleLowerCase(base);
      } catch {
        return k.toLowerCase();
      }
    }
    return k.toLowerCase();
  }

  // The key a form or a token is looked up by: NFC, curly apostrophes as ', hyphens and
  // spaces as one space, invisible characters removed, lowercase. Accents are kept: "si"
  // (if) and "sí" (yes) are different words.
  const keyOf = (s, base, rules = DEFAULT_RULES) => rawKey(s, base, rules);

  const joinerKind = (c) => (APOS.includes(c) ? "apostrophe" : HYPHENS.includes(c) ? "hyphen" : INVISIBLE.includes(c) ? "invisible" : null);

  // The words of `text` in `base`: [{ start, end, key, elision, hyphenated }], offsets in
  // UTF-16 code units. An elision token (French l', Italian dell') is never matched alone.
  function tokenize(text, base, rules = DEFAULT_RULES) {
    const c = compile(rules, base);
    const segs = [];
    for (const s of segmenter(base).segment(text)) {
      if (!s.isWordLike) continue;
      // U+202F (French puts it inside « » and before ! ?) counts as part of a word for the
      // segmenter; it never belongs to one here.
      let start = s.index;
      let end = start + s.segment.length;
      while (start < end && SPACE.test(text[start])) start++;
      while (end > start && SPACE.test(text[end - 1])) end--;
      if (start < end) segs.push({ start, end });
    }
    // Join words with exactly one joiner between them: well-known, hot<soft hyphen>dog.
    const joined = [];
    for (const s of segs) {
      const prev = joined[joined.length - 1];
      if (prev && s.start - prev.end === 1) {
        const kind = joinerKind(text[prev.end]);
        if (kind && c.join.has(kind)) {
          prev.end = s.end;
          if (kind === "hyphen") prev.hyphenated = true;
          continue;
        }
      }
      joined.push({ start: s.start, end: s.end, hyphenated: false });
    }
    const out = [];
    const keyFor = (raw) => {
      let k = c.keys.get(raw);
      if (k === undefined) {
        if (c.keys.size >= 20_000) c.keys.clear();
        k = rawKey(raw, base, rules);
        c.keys.set(raw, k);
      }
      return k;
    };
    for (const t of joined) {
      // Italian po': the apostrophe after it belongs to the word.
      if (c.trailing.size && APOS.includes(text[t.end] ?? "") && c.trailing.has(rawKey(text.slice(t.start, t.end + 1), base, rules))) t.end += 1;
      const raw = text.slice(t.start, t.end);
      const key = keyFor(raw);
      if (c.elision.length && !c.keepWhole.has(key)) {
        const split = splitElision(raw, base, rules, c);
        if (split > 0 && split < raw.length) {
          out.push({ start: t.start, end: t.start + split, key: rawKey(raw.slice(0, split), base, rules), elision: true, hyphenated: false });
          const rest = raw.slice(split);
          out.push({ start: t.start + split, end: t.end, key: rawKey(rest, base, rules), elision: false, hyphenated: t.hyphenated });
          continue;
        }
      }
      out.push({ start: t.start, end: t.end, key, elision: false, hyphenated: t.hyphenated });
    }
    return out;
  }

  // Where the leftmost elision prefix of a word ends (after its apostrophe), or 0.
  function splitElision(raw, base, rules, c) {
    for (let i = 0; i < raw.length; i++) {
      if (!APOS.includes(raw[i])) continue;
      const head = rawKey(raw.slice(0, i + 1), base, rules);
      if (c.elision.includes(head)) return i + 1;
      return 0;
    }
    return 0;
  }

  // Characters next to a token that make it part of an address, handle, path or code:
  // www.house.com, @house, house_2, C++. "." and ":" count only with a letter or digit on
  // their far side, so "My house. The dog" keeps both words.
  function glued(text, start, end) {
    const b = text[start - 1];
    const a = text[end];
    if (b !== undefined && (GLUE.has(b) || ((b === "." || b === ":") && WORD.test(text[start - 2] ?? "")))) return true;
    if (a !== undefined && (GLUE.has(a) || ((a === "." || a === ":") && WORD.test(text[end + 1] ?? "")))) return true;
    return false;
  }

  // Is the token at `start` the first word of a sentence? The nearest character before it
  // that isn't a space decides; the start of the text counts.
  function sentenceStart(text, start, rules = DEFAULT_RULES, base = "und") {
    const c = compile(rules, base);
    for (let i = start - 1; i >= 0; i--) {
      const ch = text[i];
      if (SPACE.test(ch) && ch !== "\u2029") continue;
      return SENTENCE_BEFORE.has(ch) || c.openers.has(ch);
    }
    return true;
  }

  const isUpper = (ch) => ch !== ch.toLowerCase();
  const isLower = (ch) => ch !== ch.toUpperCase();

  // caseless (Han, kana, Thai, Arabic), upper (two or more letters, all capitals), title
  // (a capital, then lowercase; a lone capital too), lower, or mixed (iPhone).
  function shapeOf(s) {
    const cased = [...s].filter((ch) => isUpper(ch) || isLower(ch));
    if (!cased.length) return "caseless";
    if (cased.every(isUpper)) return cased.length >= 2 ? "upper" : "title";
    if (cased.every(isLower)) return "lower";
    if (isUpper(cased[0]) && cased.slice(1).every(isLower)) return "title";
    return "mixed";
  }

  const hasWord = (s) => HAS_WORD.test(s);

  const api = { APOS, HYPHENS, INVISIBLE, DEFAULT_RULES, primary, rulesFor, keyOf, tokenize, glued, sentenceStart, shapeOf, hasWord, segmenter };
  globalThis.KotikoText = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
