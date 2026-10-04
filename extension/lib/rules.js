// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Which matches not to swap (slice 16 section 3): names, acronyms and initials are left
// alone, using each base's own capital conventions (spec/lang/_generic/casing.json): German
// nouns are capitalised and aren't names; caseless scripts have no case evidence at all.
// Precision over coverage for capitalised and short words. A capital at a sentence start or
// in an English headline is ambiguous ("Apple is…", "Man Bites Dog"); it waits for what the
// rest of the page shows, and once decided stays decided on that page view. No DOM: runs in
// the content script (globalThis.KotikoRules) and in Node tests.
//
//   const R = KotikoRules.create();
//   R.judge(match, { text, ctx, casing })  -> { keep: [candidates] } | { defer: "start" | "title" } | null
//   R.decision(key, kind)                    -> true | false | undefined
//   R.defer(key, kind, node);  R.settle()   -> nodes whose deferred matches may now be swapped
(() => {
  const ROMAN2 = /^(?=[IVXLCDM]{2,}$)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
  const LETTER = /\p{L}/u;
  const WORDS = /\p{L}[\p{L}\p{M}'’-]*/gu;
  const letters = (s) => [...s].filter((c) => LETTER.test(c));
  const isUpper = (c) => c !== c.toLowerCase();
  const isLower = (c) => c !== c.toUpperCase();
  const titleShaped = (w) => {
    const cased = [...w].filter((c) => isUpper(c) || isLower(c));
    return cased.length > 0 && isUpper(cased[0]) && cased.slice(1).every(isLower);
  };

  // "THANK YOU FOR READING": four or more words, 70 % of the cased letters capitals.
  function shouting(text) {
    if ((text.match(WORDS) ?? []).length < 4) return false;
    const cased = letters(text).filter((c) => isUpper(c) || isLower(c));
    return cased.length > 0 && cased.filter(isUpper).length / cased.length >= 0.7;
  }

  // A headline or menu in Title Case: three or more words of three letters or more, 75 % of
  // them title-shaped ("Man Bites Dog"; not "Will Smith said").
  function titleRun(text) {
    const long = (text.match(WORDS) ?? []).filter((w) => letters(w).length >= 3);
    return long.length >= 3 && long.filter(titleShaped).length / long.length >= 0.75;
  }

  const midTitle = (t) => !!t && t.shape === "title" && !t.sentenceStart;
  const lowerList = (list) => new Set((list ?? []).map((w) => w.toLowerCase()));

  function create() {
    const lowerSeen = new Set();
    const properSeen = new Set();
    const decided = new Map();
    const pending = new Map();

    // A name: next to an honorific ("Sr. Rosa", "Herr Wolf"), or, where nouns aren't
    // capitalised, next to another capitalised word mid-sentence ("Will Smith"); not inside
    // a Title Case headline, where every word has a capital ("Man Bites Dog").
    function nameLike(m, C, node) {
      const headline = C.title_case_headlines && node.titleRun;
      const hon = lowerList(C.honorifics);
      const near = [
        [m.prevToken, m.prevGap],
        [m.nextToken, m.nextGap],
      ];
      for (const [t, gap] of near) {
        if (!t || !/^\.?\s$/u.test(gap ?? "")) continue;
        if (hon.has(t.surface.toLowerCase())) return true;
        if (!headline && !C.nouns_capitalized && t.shape === "title" && !t.sentenceStart && !(C.capitalized_pronouns ?? []).includes(t.surface) && /^\s$/u.test(gap)) return true;
      }
      return false;
    }

    // "May 2026", "Chapter II", "Type A": a number, a Roman numeral or a lone capital next.
    function numberNext(m) {
      const n = m.nextToken?.surface ?? "";
      return /^\d/.test(n) || ROMAN2.test(n) || (/^\p{Lu}$/u.test(n) && n !== "I");
    }

    function singleLetter(m, C, isCaseless) {
      const s = m.surface;
      if (isCaseless) return "keep";
      if (lowerList(C.single_letter_words).has(s.toLowerCase())) {
        const ok = s === s.toLowerCase() && !midTitle(m.prevToken) && !/^[.)]/.test(m.nextGap ?? "") && !(/\($/.test(m.prevGap ?? "") && /^\)/.test(m.nextGap ?? ""));
        return ok ? "keep" : "drop";
      }
      if ((C.capitalized_pronouns ?? []).includes(s)) {
        // "I think", and at the end of a clause, "so do I.", "Can I?" ("World War I." and
        // "Type I." are dropped before this, by the lone-capital rule).
        const gap = m.nextGap ?? "";
        const next = (/^\s$/u.test(gap) && m.nextToken?.shape === "lower") || /^[.?!,;:]/.test(gap) || !m.nextToken;
        return next && !midTitle(m.prevToken) ? "keep" : "drop";
      }
      return "drop";
    }

    // The rules for candidates with the "any" or "lower" flag: "keep", "drop", or a deferral.
    function shapeRule(m, C, node, lowerOnly) {
      if (m.tokens === 1 && letters(m.surface).length === 1) return singleLetter(m, C, m.shape === "caseless");
      switch (m.shape) {
        case "caseless":
        case "lower":
          return "keep";
        case "mixed":
          return "drop";
        case "upper":
          if (node.shouting) return "keep";
          return letters(m.surface).length <= 5 ? "drop" : "keep";
        default: {
          if (lowerOnly) return m.sentenceStart && !nameLike(m, C, node) ? "keep" : "drop";
          if (numberNext(m) || nameLike(m, C, node)) return "drop";
          if (C.nouns_capitalized) return "keep";
          if (m.sentenceStart) return { defer: "start" };
          if (C.title_case_headlines && node.titleRun) return { defer: "title" };
          return "drop";
        }
      }
    }

    // What the page shows about a word's capitals, from every match scanned (swapped or not).
    function record(m, C, node) {
      if (m.shape === "lower") lowerSeen.add(m.key);
      else if (m.shape === "title" && !m.sentenceStart && !node.titleRun && !C.nouns_capitalized && m.tokens >= 1 && letters(m.surface).length > 1) properSeen.add(m.key);
    }

    // `text`: the text node's own text; `ctx`: { before, after } (slice 14's edges);
    // `casing`: the base's entry of casing.json. Returns the candidates that may be shown,
    // a deferral, or null.
    let last = null;
    function judge(m, { text, ctx = {}, casing = {} }) {
      // Once per text, not per match: a text node's matches are judged in a row.
      const full = `${ctx.before ?? ""}${text}${ctx.after ?? ""}`;
      if (last?.full !== full || last.text !== text) last = { full, text, node: { shouting: shouting(full), titleRun: titleRun(text) } };
      const { node } = last;
      record(m, casing, node);
      const cands = m.entry?.candidates ?? [];
      const keep = [];
      const others = [];
      for (const c of cands) {
        if (c.case === "exact") {
          if (m.surface === c.form) keep.push(c);
        } else if (c.case === "proper") {
          if (m.shape === "title" || m.shape === "upper") keep.push(c);
        } else others.push(c);
      }
      if (others.length) {
        const r = shapeRule(m, casing, node, others.every((c) => c.case === "lower"));
        if (r === "keep") keep.push(...others);
        else if (r !== "drop" && !keep.length) return r;
      }
      return keep.length ? { keep } : null;
    }

    const decision = (key, kind) => decided.get(`${kind}:${key}`);

    function defer(key, kind, node) {
      const id = `${kind}:${key}`;
      if (decided.has(id)) return;
      const p = pending.get(id) ?? pending.set(id, { key, kind, nodes: new Set() }).get(id);
      p.nodes.add(node);
    }

    // Decides every deferred match with the evidence so far: a sentence-start capital is
    // kept unless the word was seen capitalised mid-sentence; a headline capital only if it
    // was seen lowercase and never capitalised mid-sentence. Returns the nodes to revisit.
    function settle() {
      const revisit = new Set();
      for (const [id, p] of pending) {
        const keep = p.kind === "start" ? !properSeen.has(p.key) : lowerSeen.has(p.key) && !properSeen.has(p.key);
        decided.set(id, keep);
        if (keep) for (const n of p.nodes) revisit.add(n);
      }
      pending.clear();
      return [...revisit];
    }

    return { judge, decision, defer, settle, evidence: () => ({ lowerSeen, properSeen }) };
  }

  const api = { create, shouting, titleRun };
  globalThis.KotikoRules = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
