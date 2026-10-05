// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Which of the learner's languages a word of the page shows (slice 18). By default each
// concept ("thanks", "dogs" and "dog" alike) gets one language per page per day, picked by
// a seeded weighted draw (rendezvous hashing): every language wins its share of the words
// they have in common, words added in the last week win first, and adding or hiding a
// language only moves the words that language wins or loses. "priority" always takes the
// first language in the learner's order; "mix" rotates every occurrence, stably. Nothing
// derived from the page's address leaves memory. No DOM: content scripts
// (globalThis.KotikoPrecedence) and Node tests.
//
//   const P = KotikoPrecedence;
//   const E = P.eligible({ words, hiddenLangs, mixing });
//   const s = P.createSession({ salt, pageKey: P.pageKey(location.href), dayKey: P.dayKey(new Date()),
//                               mixing, eligible: E, words, keyOf, now });
//   s.choose({ base, entry, candidates, surface, before, after })
//     -> { concept, lang, word, alsoLangs, fresh, others } | { known: true } | null
(() => {
  const US = String.fromCharCode(31);
  const DAY_MS = 86400000;
  const SWAPPABLE = new Set(["active", "well_known"]);
  const DEFAULTS = { mode: "balanced", weights: {}, priority: [], focus: null, freshDays: 7 };

  /*
    cyrb53 (c) 2018 bryc (github.com/bryc). Public domain.
    A fast and simple 53-bit string hash function with decent collision resistance.
    Largely inspired by MurmurHash2/3, but with a focus on speed/simplicity.
  */
  const cyrb53 = (str, seed = 0) => {
    let h1 = 0xdeadbeef ^ seed,
      h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  };

  // The page, without tracking parameters or the fragment, its query sorted.
  const TRACKING = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid", "si", "ref", "ref_src", "_hsenc", "_hsmi", "yclid"]);
  function pageKey(href) {
    let u;
    try {
      u = new URL(href);
    } catch {
      return String(href ?? "");
    }
    const params = [...u.searchParams].filter(([k]) => !TRACKING.has(k) && !k.startsWith("utm_"));
    params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    const q = new URLSearchParams(params).toString();
    return `${u.origin}${u.pathname}${q ? `?${q}` : ""}`;
  }

  // The local date a page session started on.
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const settings = (mixing) => ({ ...DEFAULTS, ...(mixing && typeof mixing === "object" ? mixing : {}) });
  const weightOf = (m, lang) => {
    const w = Number(m.weights?.[lang]);
    return Number.isFinite(w) ? Math.min(10, Math.max(0, w)) : 1;
  };
  // A word's created_at as a number, parsed once per word.
  const times = new WeakMap();
  const time = (w) => {
    if (!w || typeof w !== "object") return Infinity;
    let t = times.get(w);
    if (t === undefined) {
      t = Date.parse(w.created_at ?? "");
      times.set(w, (t = Number.isFinite(t) ? t : Infinity));
    }
    return t;
  };
  const older = (a, b) => time(a) - time(b) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

  // Step 1: the languages that may show. Focus ignores hidden languages for the ones it
  // names and never edits them, so leaving Focus restores exactly what showed before.
  function eligible({ words = [], hiddenLangs = [], mixing = null, site = null }) {
    const all = new Set(words.filter((w) => SWAPPABLE.has(w.status ?? "active")).map((w) => w.lang));
    const m = settings(mixing);
    const pick = (list) => new Set((list ?? []).filter((l) => all.has(l)));
    if (site?.focus) return pick([site.focus].flat());
    if (site?.show) return pick(site.show);
    // A Focus whose languages all lost their words would hide everything; it's ignored
    // until the popup tidies it.
    if (Array.isArray(m.focus) && m.focus.length && pick(m.focus).size) return pick(m.focus);
    const hidden = new Set(hiddenLangs ?? []);
    return new Set([...all].filter((l) => !hidden.has(l)));
  }

  // "café" and "cafe", "Hotel" and "hotel" are the same string to a reader. A word's is kept
  // across page sessions, as long as the word object lives.
  const plain = (s, base, keyOf) => keyOf(String(s ?? ""), base).normalize("NFD").replace(/\p{M}/gu, "");
  const plains = new WeakMap();

  function createSession({ salt, pageKey: page, dayKey: day, mixing = null, eligible: E, words = [], keyOf, now = Date.now() }) {
    const m = settings(mixing);
    const freshMs = Math.max(0, Number(m.freshDays) || 0) * DAY_MS;
    const fresh = (w) => freshMs > 0 && now - time(w) < freshMs;
    // Priority mode's tail: languages not listed, by their first word; worked out once, and
    // only in that mode.
    let firstWord = null;
    const firstOf = (lang) => {
      if (!firstWord) {
        firstWord = new Map();
        for (const w of words) if (!(time(w) >= (firstWord.get(w.lang) ?? Infinity))) firstWord.set(w.lang, time(w));
      }
      return firstWord.get(lang) ?? Infinity;
    };
    const seeds = new Map();
    const plainWord = (w, base) => {
      const memo = plains.get(w);
      if (memo?.base === base && memo.keyOf === keyOf) return memo.value;
      const value = plain(w.native, base, keyOf);
      plains.set(w, { base, keyOf, value });
      return value;
    };
    const choices = new Map();
    const rotations = new Map();
    const occurrences = new Map();

    const seedOf = (concept) => seeds.get(concept) ?? seeds.set(concept, cyrb53(`${salt}${US}${concept}${US}${page}${US}${day}`).toString(16)).get(concept);
    // Uniform in (0, 1) for one seed and one name.
    const u = (seed, x) => (cyrb53(seed + US + x) + 0.5) / 2 ** 53;
    const score = (seed, x, w) => -Math.log(u(seed, x)) / w;

    // The concept: the oldest candidate's meaning, taken before cleanup so hiding a
    // language never changes it; "dog" and "dogs" share one choice.
    function conceptOf(entry, base) {
      const cands = entry?.candidates ?? [];
      let oldest = null;
      for (const c of cands) if (c?.word && (!oldest || older(c.word, oldest) < 0)) oldest = c.word;
      const gloss = oldest?.gloss ?? oldest?.english;
      return typeof gloss === "string" && gloss ? keyOf(gloss, base) : entry?.key ?? "";
    }

    // Step 2: the candidates that may show for this match, one per word.
    function cleanup(candidates, base, surface) {
      const seen = new Set();
      const ok = [];
      for (const c of candidates ?? []) {
        const w = c?.word ?? c;
        if (!w || seen.has(w)) continue;
        seen.add(w);
        if (!E.has(w.lang) || !SWAPPABLE.has(w.status ?? "active")) continue;
        if ((w.base_lang ?? "en") !== base || w.lang === base) continue;
        if (/^[-\u2010\u2011]|[-\u2010\u2011]$/.test(w.native ?? "")) continue;
        ok.push(w);
      }
      const page = plain(surface, base, keyOf);
      const real = ok.filter((w) => plainWord(w, base) !== page);
      return { words: real, known: ok.length > 0 && real.length === 0 };
    }

    function balanced(seed, langs, C) {
      let P = langs.filter((l) => weightOf(m, l) > 0);
      const w = P.length ? (l) => weightOf(m, l) : () => 1;
      if (!P.length) P = langs;
      const F = P.filter((l) => C.some((x) => x.lang === l && fresh(x)));
      if (F.length) P = F;
      let best = null;
      let bestScore = Infinity;
      for (const l of P) {
        const s = score(seed, l, w(l));
        if (s < bestScore) [best, bestScore] = [l, s];
      }
      return best;
    }

    function priority(langs) {
      const listed = (m.priority ?? []).filter((l) => langs.includes(l));
      const rest = langs.filter((l) => !listed.includes(l)).sort((a, b) => firstOf(a) - firstOf(b) || (a < b ? -1 : 1));
      return [...listed, ...rest][0] ?? null;
    }

    // Smooth weighted round-robin per concept; fresh languages count three times.
    function rotate(key, seed, langs, C) {
      const P0 = langs.filter((l) => weightOf(m, l) > 0);
      const P = P0.length ? P0 : langs;
      const w = (l) => (P0.length ? weightOf(m, l) : 1) * (C.some((x) => x.lang === l && fresh(x)) ? 3 : 1);
      const r = rotations.get(key) ?? rotations.set(key, new Map()).get(key);
      const total = P.reduce((t, l) => t + w(l), 0);
      let best = null;
      for (const l of P) {
        r.set(l, (r.get(l) ?? 0) + w(l));
        if (!best || r.get(l) > r.get(best) || (r.get(l) === r.get(best) && -Math.log(u(seed, l)) < -Math.log(u(seed, best)))) best = l;
      }
      r.set(best, r.get(best) - total);
      return best;
    }

    // Step 5: a word within the language; fresh ones first, then a seeded draw so
    // synonyms take turns across pages and days.
    function wordOf(seed, lang, C) {
      let W = C.filter((x) => x.lang === lang);
      const F = W.filter(fresh);
      if (F.length) W = F;
      let best = null;
      let bestScore = Infinity;
      for (const x of W) {
        const s = score(seed, `${lang}${US}${x.id}`, 1);
        if (s < bestScore) [best, bestScore] = [x, s];
      }
      return best;
    }

    function choose({ base, entry, candidates = entry?.candidates, surface, before = "", after = "", ordinal = 0 }) {
      // One pick per form and candidate set on a page, looked up before any other work (mix
      // mode rotates instead).
      let ids = "";
      for (const c of candidates ?? []) ids += `${(c?.word ?? c)?.id},`;
      const memoKey = `${base}${US}${entry?.key ?? surface}${US}${ids}`;
      if (m.mode !== "mix" && choices.has(memoKey)) return choices.get(memoKey);
      const { words: C, known } = cleanup(candidates, base, surface);
      if (known || !C.length) {
        const none = known ? { known: true } : null;
        if (m.mode !== "mix") choices.set(memoKey, none);
        return none;
      }
      const concept = conceptOf(entry, base);
      const seed = seedOf(concept);
      const langs = [...new Set(C.map((x) => x.lang))].sort();
      let lang;
      if (m.mode === "mix") {
        const occ = `${base}${US}${cyrb53(`${concept}${String(before).slice(-32)}${US}${String(after).slice(0, 32)}`)}#${ordinal}${US}${memoKey}`;
        lang = occurrences.get(occ);
        if (!lang || !langs.includes(lang)) occurrences.set(occ, (lang = rotate(`${base}${US}${concept}`, seed, langs, C)));
      } else {
        lang = m.mode === "priority" ? priority(langs) : balanced(seed, langs, C);
      }
      const word = wordOf(seed, lang, C);
      const alsoLangs = [...new Set(C.filter((x) => x !== word && x.lang !== lang && x.native === word.native).map((x) => x.lang))];
      const choice = { concept, lang, word, alsoLangs, fresh: fresh(word), others: C.filter((x) => x !== word) };
      if (m.mode !== "mix") choices.set(memoKey, choice);
      return choice;
    }

    return { choose, conceptOf, cleanup, seedOf, u };
  }

  const api = { cyrb53, pageKey, dayKey, eligible, createSession, DEFAULTS };
  globalThis.KotikoPrecedence = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
