// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Finds the learner's words in text written in one of their base languages (slice 14).
// One index per base: the forms of every word whose meaning is in that base, looked up
// by key one word (or one phrase) at a time, so cost doesn't grow with the vocabulary.
// Text is split with KotikoText (lib/text.js), which must load first. No DOM or extension
// APIs: it runs as a content script (globalThis.KotikoMatcher), in extension pages and in
// Node tests (module.exports).
//
//   const indexes = KotikoMatcher.buildIndexes(words, ["es", "en"], { rules: (base) => … });
//   const { matches, tokenCount } = KotikoMatcher.scan(text, { base: "es", before, after }, indexes.get("es"));
//   // matches: [{ start, end, surface, key, entry: { key, candidates: [{ word, form }] }, … }]
(() => {
  const Text = globalThis.KotikoText;
  const SWAP = new Set(["active", "well_known"]);
  const MAX_FORM = 64;
  const MAX_NATIVE = 64;
  const MAX_WORDS = 20_000;
  const MAX_SYMBOLIC = 200;
  // Glue characters (lib/text.js) make a form symbolic: c++, c#, .net, u.s.
  const SYMBOLIC = /[_@#/\\=+&%~|<>^*$`]|[.:](?=[\p{L}\p{M}\p{N}])/u;
  // Punctuation around a form that isn't part of it: "thank you!", "¡hola!", "dog."
  const EDGE = /^[^\p{L}\p{M}\p{N}'\u2019\u02BC\-\u2010\u2011\s]+|[^\p{L}\p{M}\p{N}'\u2019\u02BC\-\u2010\u2011\s]+$/gu;
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Language tags the browser's language detector still uses for some languages.
  const OLD_TAGS = { iw: "he", in: "id", ji: "yi", jw: "jv", cmn: "zh" };
  const TRADITIONAL = new Set(["TW", "HK", "MO"]);

  // A tag's primary language and script (zh-TW is zh in Hant; zh alone is Hans).
  function partsOf(tag) {
    const p = String(tag ?? "").split(/[-_]/);
    const lang = OLD_TAGS[p[0].toLowerCase()] ?? p[0].toLowerCase();
    let script = p.slice(1).find((x) => /^[A-Za-z]{4}$/.test(x)) ?? null;
    if (script) script = script[0].toUpperCase() + script.slice(1).toLowerCase();
    if (!script && lang === "zh") script = p.slice(1).some((x) => TRADITIONAL.has(x.toUpperCase())) ? "Hant" : "Hans";
    return { lang, script };
  }

  // The same base language (slice 50): the same primary language, and the same script when
  // both name one. pt-BR and pt are the same base; zh-Hans and zh-Hant are not.
  function sameBase(a, b) {
    if (!a || !b) return false;
    const x = partsOf(a);
    const y = partsOf(b);
    return x.lang === y.lang && (x.script === y.script || !x.script || !y.script);
  }

  // The learner's base that `tag` is written in, or null.
  const baseOf = (tag, bases) => (tag ? (bases ?? []).find((b) => sameBase(tag, b)) ?? null : null);

  // A word's enabled forms as { text, case }: `case` is 07's flag (any, lower, exact,
  // proper) that slice 16's rules read; a bare string means any.
  const CASES = new Set(["any", "lower", "exact", "proper"]);
  function formsOf(w) {
    const forms = (Array.isArray(w.forms) ? w.forms : [])
      .filter((f) => f && (typeof f === "string" || f.enabled !== false))
      .map((f) => (typeof f === "string" ? { text: f, case: "any" } : { text: f.text, case: CASES.has(f.case) ? f.case : "any" }))
      .filter((f) => typeof f.text === "string" && f.text);
    return forms.length ? forms : typeof w.gloss === "string" && w.gloss ? [{ text: w.gloss, case: "any" }] : [];
  }
  const formTexts = (w) => formsOf(w).map((f) => f.text);

  // Where a phrase key can continue, so the scan only extends a phrase that some form
  // starts with: after a space, after an elision's apostrophe (dell'acqua), and, for
  // languages written without spaces, after any character.
  function addPrefixes(set, key, spaces) {
    for (let i = 1; i < key.length; i++) {
      if (!spaces || key[i] === " " || key[i - 1] === "'") set.add(key.slice(0, i).trimEnd());
    }
  }

  // One base's index. `words` newest first (the projection's order); every candidate is
  // kept, several per language included, for slice 18 to choose from. Oversized natives
  // and forms, and words beyond the newest 20,000, are left out and counted in `diag`.
  function buildIndex(words, { base, rules = Text.DEFAULT_RULES, maxPhraseTokens = 6 } = {}) {
    const entries = new Map();
    const prefixes = new Set();
    const symbolic = new Map();
    // Languages without spaces: the first character of every key, so text with none of
    // them is never segmented (width-folded keys are matched by folding the text first).
    const firstChars = new Set();
    const diag = { words: 0, forms: 0, natives: 0, phrases: 0, symbolic: 0 };
    const spaces = rules.spaces !== false;
    let kept = 0;
    for (const w of words ?? []) {
      if (!w || (w.status && !SWAP.has(w.status)) || w.deleted_at) continue;
      if (!sameBase(w.base_lang ?? "en", base) || sameBase(w.lang, base)) continue;
      if (typeof w.native !== "string" || !w.native || w.native.length > MAX_NATIVE || /[\r\n]/.test(w.native)) {
        diag.natives++;
        continue;
      }
      if (++kept > MAX_WORDS) {
        diag.words++;
        continue;
      }
      for (const { text, case: kase } of formsOf(w)) {
        if (text.length > MAX_FORM) {
          diag.forms++;
          continue;
        }
        // c++, c#, .net and u.s. keep their punctuation; trailing sentence punctuation
        // alone doesn't make a form symbolic ("dog.", "thank you!").
        if (SYMBOLIC.test(text.trim().replace(/[.!?,;:]+$/, ""))) {
          const key = text.trim().toLowerCase();
          if (!symbolic.has(key) && symbolic.size >= MAX_SYMBOLIC) {
            diag.symbolic++;
            continue;
          }
          const e = symbolic.get(key) ?? symbolic.set(key, { key, candidates: [], symbolic: true }).get(key);
          e.candidates.push({ word: w, form: text, case: kase });
          continue;
        }
        const key = Text.keyOf(text.trim().replace(EDGE, ""), base, rules);
        if (!key || !Text.hasWord(key)) continue;
        if ((spaces ? key.split(" ").length : 1) > maxPhraseTokens) {
          diag.phrases++;
          continue;
        }
        const e = entries.get(key) ?? entries.set(key, { key, candidates: [], symbolic: false }).get(key);
        e.candidates.push({ word: w, form: text, case: kase });
        addPrefixes(prefixes, key, spaces);
        if (!spaces) firstChars.add(String.fromCodePoint(key.codePointAt(0)));
      }
    }
    const sym = [...symbolic.keys()].sort((a, b) => b.length - a.length);
    return {
      base,
      rules,
      entries,
      prefixes,
      firstChars: spaces ? null : firstChars,
      symbolic,
      // The only regular expression left: forms with glue characters, at most 200, escaped.
      symbolicRe: sym.length ? new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${sym.map(escapeRe).join("|")})(?![\\p{L}\\p{M}\\p{N}])`, "giu") : null,
      maxPhraseTokens,
      size: entries.size + symbolic.size,
      diag,
    };
  }

  // One index per base (at most 4, slice 50). `rules(base)` gives a base's boundary rules.
  function buildIndexes(words, bases, { rules = () => Text.DEFAULT_RULES, maxPhraseTokens } = {}) {
    const out = new Map();
    for (const base of (bases ?? []).slice(0, 4)) out.set(base, buildIndex(words, { base, rules: rules(base), maxPhraseTokens }));
    return out;
  }

  const SPACE_ONLY = /^[^\S\u2029]+$/;

  // What joins token j to token j+1 in a phrase key: one space, nothing (languages without
  // spaces, and after an elision such as dell'), or null when the gap breaks the phrase.
  function joint(gap, prev, spaces) {
    if (gap === "") return !spaces || prev.elision ? "" : null;
    return SPACE_ONLY.test(gap) ? " " : null;
  }

  function neighbour(full, t, rules, base) {
    if (!t) return null;
    const surface = full.slice(t.start, t.end);
    return { key: t.key, surface, shape: Text.shapeOf(surface), sentenceStart: Text.sentenceStart(full, t.start, rules, base) };
  }

  // One match. What slices 16 to 18 read about it (its case shape, whether it starts a
  // sentence, its neighbours) is worked out only when asked for: most matches are swapped
  // without anyone looking.
  class Match {
    constructor(scanned, i, best, off) {
      this._s = scanned;
      this._i = i;
      this._j = best.j;
      this._end = best.end;
      const t = scanned.tokens[i];
      this.start = t.start - off;
      this.end = best.end - off;
      this.surface = scanned.full.slice(t.start, best.end);
      this.key = best.key;
      this.entry = scanned.index.entries.get(best.key);
      this.tokens = best.j - i + 1;
      this.tokenIndex = best.tokenIndex;
    }

    get shape() {
      return Text.shapeOf(this.surface);
    }

    get sentenceStart() {
      const { full, tokens, rules, base } = this._s;
      return Text.sentenceStart(full, tokens[this._i].start, rules, base);
    }

    get prevToken() {
      const { full, tokens, rules, base } = this._s;
      return neighbour(full, tokens[this._i - 1], rules, base);
    }

    get nextToken() {
      const { full, tokens, rules, base } = this._s;
      return neighbour(full, tokens[this._j + 1], rules, base);
    }

    get prevGap() {
      const { full, tokens } = this._s;
      return full.slice(tokens[this._i - 1]?.end ?? 0, tokens[this._i].start);
    }

    get nextGap() {
      const { full, tokens } = this._s;
      return full.slice(this._end, tokens[this._j + 1]?.start ?? full.length);
    }
  }

  // Could `text` contain a word of an index for a language without spaces? Only if one of
  // its characters starts a key.
  function mayMatch(text, index) {
    const width = (index.rules.fold ?? []).includes("width");
    for (const ch of text) {
      if (index.firstChars.has(ch)) return true;
      if (width && index.firstChars.has(ch.normalize("NFKC")[0])) return true;
    }
    return false;
  }

  // The matches in `text` (one text node), scanned in `ctx.base` against that base's
  // index. `ctx.before` and `ctx.after` are a little of the neighbouring text in the same
  // line, or U+2029 at a block boundary; a word that runs across the edge is never matched.
  // Leftmost-longest wins and matches never overlap. `tokenCount` counts the words inside
  // `text`; for a language without spaces, text that can't match isn't segmented and
  // counts 0 unless `ctx.count` asks for the count (slice 32's coverage).
  function scan(text, ctx, index) {
    if (!index || !text || !Text.hasWord(text)) return { matches: [], tokenCount: 0 };
    if (index.firstChars && !ctx?.count && !mayMatch(text, index)) return { matches: [], tokenCount: 0 };
    const base = ctx?.base ?? index.base;
    const rules = index.rules;
    const before = ctx?.before ?? "";
    const full = before + text + (ctx?.after ?? "");
    const off = before.length;
    const endText = off + text.length;
    const tokens = Text.tokenize(full, base, rules);
    const inside = (t) => t.start >= off && t.end <= endText;
    let tokenCount = 0;
    for (const t of tokens) if (inside(t)) tokenCount++;
    if (!index.size) return { matches: [], tokenCount };

    const scanned = { full, tokens, index, rules, base };
    const spaces = rules.spaces !== false;
    const free = (t) => inside(t) && !Text.glued(full, t.start, t.end);
    const matches = [];
    let seen = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (inside(t)) seen++;
      if (!free(t)) continue;
      let key = t.key;
      let best = !t.elision && index.entries.has(key) ? { j: i, key, end: t.end } : null;
      let j = i;
      while (index.prefixes.has(key) && j + 1 < tokens.length && j + 1 - i < index.maxPhraseTokens) {
        const next = tokens[j + 1];
        if (!free(next)) break;
        const sep = joint(full.slice(tokens[j].end, next.start), tokens[j], spaces);
        if (sep === null) break;
        key = key + sep + next.key;
        j++;
        if (index.entries.has(key)) best = { j, key, end: next.end };
      }
      best ??= possessive(full, t, i, index, base);
      if (!best) continue;
      best.tokenIndex = seen - 1;
      matches.push(new Match(scanned, i, best, off));
      for (let k = i + 1; k <= best.j; k++) if (inside(tokens[k])) seen++;
      i = best.j;
    }
    if (index.symbolicRe) addSymbolic(text, index, matches);
    matches.sort((a, b) => a.start - b.start);
    return { matches, tokenCount };
  }

  // English "the house's roof": the word before 's, with 's left as written. After "it",
  // "let" and the rest, 's is "is" or "us" and the token matches only whole.
  function possessive(full, t, i, index, base) {
    const rules = index.rules;
    if (!rules.possessive_suffix || t.elision) return null;
    const suffix = Text.keyOf(rules.possessive_suffix, base, rules);
    if (!t.key.endsWith(suffix) || t.key.length <= suffix.length) return null;
    const stem = t.key.slice(0, -suffix.length);
    if (!index.entries.has(stem) || (rules.possessive_whole_after ?? []).some((w) => Text.keyOf(w, base, rules) === stem)) return null;
    const raw = full.slice(t.start, t.end);
    let cut = raw.length;
    while (cut > 0 && !Text.APOS.includes(raw[cut - 1])) cut--;
    if (cut <= 1) return null;
    return { j: i, key: stem, end: t.start + cut - 1 };
  }

  function addSymbolic(text, index, matches) {
    const re = index.symbolicRe;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (matches.some((x) => x.start < end && start < x.end)) continue;
      const key = m[0].toLowerCase();
      matches.push({
        start,
        end,
        surface: m[0],
        key,
        entry: index.symbolic.get(key),
        tokens: 1,
        tokenIndex: -1,
        shape: Text.shapeOf(m[0]),
        sentenceStart: false,
        prevToken: null,
        nextToken: null,
        prevGap: "",
        nextGap: "",
      });
    }
  }

  // A lone capital letter next to a numeral, an acronym or a code is part of a name, not
  // a word: "AOI I", "World War I", "Henry VIII I", "Type I", "I-95", "I/O". `s` is the
  // text around the match (content.js adds a little of the neighbouring text) and `i` the
  // index of the one-letter match in it. Lowercase letters are never skipped here ("a NASA
  // report" keeps its "a"). Slice 16's token rules replace this.
  const ROMAN = /^(?=[IVXLCDM])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
  const JOINER = /[-\u2010\u2011/]/; // hyphens and slash; not dashes, which are prose punctuation
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
    // that word starts the sentence and a lowercase word follows ("Can I go", "Then I
    // said"), or a question ends there ("Can I?", "May I?").
    if (/^\p{Lu}\p{Ll}/u.test(prev)) {
      let q = p;
      while (q >= 0 && SPACE.test(s[q])) q--;
      const midSentence = q >= 0 && /[\p{L}\p{N},;]/u.test(s[q]);
      if (midSentence || !(pronounLike || s[i + 1] === "?")) return true;
    }
    return false;
  }

  const api = { MAX_WORDS, sameBase, baseOf, formTexts, formsOf, buildIndex, buildIndexes, scan, skipLetter };
  globalThis.KotikoMatcher = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
