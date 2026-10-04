// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The welcome tab's rules (slice 22), as plain functions: the base languages detected
// from the browser (slice 50 section 2) and the chips that edit them, what the ask box
// does with a line ("native = meaning" is parsed here, with no model and no network),
// the languages offered when a word's script doesn't name one, the preview sentence with
// the learner's word swapped in by the matcher the pages use, and the Wikipedia search
// behind "Try it on a page". No DOM or extension APIs, so it runs on the welcome page
// (globalThis.KotikoWelcomeModel) and in Node tests (module.exports).
//
//   M.detectBases({ uiLanguage, acceptLanguages, Lang })        -> ["es"]
//   M.toggleBase(["es", "en"], "en", false)                      -> { bases: ["es"] }
//   M.moveBase(["es", "en"], 1, 0)                               -> ["en", "es"]
//   M.parseEntry("es: hola = hello", { bases, Lang, Local })     -> { kind: "manual", word }
//   M.pickPreview(records, "en", { sentences, Matcher })          -> { before, parts, fallback }
//   M.wikipediaUrl("es", "hola")                                  -> "https://es.wikipedia.org/…"
(() => {
  const MAX_BASES = 4;
  const MAX_DETECTED = 3;
  const MAX_CANDIDATES = 5;
  // 50 section 5's support levels: Full bases have their own data in spec/lang/; every
  // other base is Basic and uses the shared data.
  const FULL = new Set(["en", "es"]);

  const primary = (tag) => String(tag ?? "").split(/[-_]/)[0].toLowerCase();

  function segmenterSupports(tag) {
    try {
      return Intl.Segmenter.supportedLocalesOf([tag]).length > 0;
    } catch {
      return false;
    }
  }

  // 50 section 2: the interface language and the accept languages, as base tags, at most
  // three; the interface language alone when none of them has word segmentation.
  function detectBases({ uiLanguage = "en", acceptLanguages = [], Lang, supported = segmenterSupports }) {
    const out = [];
    for (const raw of [uiLanguage, ...(Array.isArray(acceptLanguages) ? acceptLanguages : [])]) {
      const tag = Lang.baseTagOf(raw);
      if (!tag || !supported(tag) || out.some((b) => b === tag || Lang.sameBase(b, tag))) continue;
      out.push(tag);
      if (out.length >= MAX_DETECTED) break;
    }
    if (out.length) return out;
    return [Lang.baseTagOf(uiLanguage) || "en"];
  }

  // Ticks or unticks one base. At least one stays ticked; at most four.
  //   -> { bases } or { bases, error: "last" | "full" }
  function toggleBase(bases, tag, on) {
    const has = bases.includes(tag);
    if (!on) {
      if (!has) return { bases };
      if (bases.length <= 1) return { bases, error: "last" };
      return { bases: bases.filter((b) => b !== tag) };
    }
    if (has) return { bases };
    if (bases.length >= MAX_BASES) return { bases, error: "full" };
    return { bases: [...bases, tag] };
  }

  // Moves the base at `from` to `to` (dashboard settings, drag or ↑/↓); the first is the
  // primary base. Out-of-range moves change nothing.
  function moveBase(bases, from, to) {
    if (from === to || from < 0 || to < 0 || from >= bases.length || to >= bases.length) return bases.slice();
    const next = bases.slice();
    const [tag] = next.splice(from, 1);
    next.splice(to, 0, tag);
    return next;
  }

  function levelOf(base) {
    if (FULL.has(base) || FULL.has(primary(base))) return "full";
    return "basic";
  }

  // A base's welcome.json or sentences.json, by its full tag, then its language.
  function langFile(spec, base, kind) {
    const lang = spec?.lang ?? {};
    return lang[base]?.[kind] ?? lang[primary(base)]?.[kind] ?? null;
  }

  // "es: hola = hello" names the word's language before a colon.
  const PREFIX = /^([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,2})\s*:\s*(\S.*)$/u;

  function prefixOf(text, Lang) {
    const m = PREFIX.exec(text);
    if (!m) return { hint: null, rest: text };
    const c = Lang.canonical(m[1]);
    if (!c.ok || !c.known) return { hint: null, rest: text };
    return { hint: c.tag, rest: m[2].trim() };
  }

  // What the ask box does with one line (22 section 5):
  //   { kind: "empty" }
  //   { kind: "manual", word, hint }             "ありがとう = thanks": a card, no network
  //   { kind: "which", parsed, base, script }    "hola = hello": the learner picks the language
  //   { kind: "lookup", text, hint }             anything else goes to the learner's AI
  function parseEntry(raw, { bases, Lang, Local, spec, supported = segmenterSupports }) {
    const text = String(raw ?? "").trim();
    if (!text) return { kind: "empty" };
    const base = bases[0];
    const { hint, rest } = prefixOf(text, Lang);
    const parsed = Local.parseManual(rest);
    if (!parsed) return { kind: "lookup", text, hint };
    const lang = hint ? Local.manualLang(parsed.native, { hintLang: hint, recent: [], base }) : scriptLanguage(parsed.native, { spec, Lang, supported });
    const word = lang && !Lang.sameBase(lang, base) ? Local.manualWord(parsed, { lang, base, text }) : null;
    if (word) return { kind: "manual", word, hint };
    return { kind: "which", parsed, base, script: scriptOf(parsed.native), text };
  }

  // The language a word's letters name on their own (22 section 5): its script, when
  // exactly one living language (one this browser can segment) uses that script by
  // default. Kana is Japanese, Hangul Korean; Thai, Georgian, Armenian and Greek name
  // theirs. Latin, Cyrillic, Arabic, Devanagari and Han alone are shared: null.
  function scriptLanguage(native, { spec, Lang, supported = segmenterSupports }) {
    if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(native)) return "ja";
    const scripts = spec.languages.unicode_scripts;
    let best = null;
    let most = 0;
    for (const name of Object.keys(scripts)) {
      const n = (native.match(new RegExp(`\\p{Script=${name}}`, "gu")) ?? []).length;
      if (n > most) [best, most] = [name, n];
    }
    if (!best) return null;
    const isos = scripts[best];
    const langs = Object.entries(spec.languages.languages).filter(([tag, e]) => !e.sign && isos.includes(e.script) && supported(tag)).map(([tag]) => tag);
    if (langs.length !== 1) return null;
    const s = Lang.checkScript(langs[0], native);
    return s.ok ? s.tag : null;
  }

  // The word for a language the learner picked in state D, or null when it can't be one.
  function manualFor(entry, lang, { Lang, Local }) {
    const c = Lang.canonical(lang);
    if (!c.ok) return null;
    const s = Lang.checkScript(c.tag, entry.parsed.native);
    if (!s.ok || Lang.sameBase(s.tag, entry.base)) return null;
    return Local.manualWord(entry.parsed, { lang: s.tag, base: entry.base, text: entry.text });
  }

  const SCRIPTS = [
    ["Hira", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
    ["Hang", /\p{Script=Hangul}/u],
    ["Hani", /\p{Script=Han}/u],
    ["Cyrl", /\p{Script=Cyrillic}/u],
    ["Arab", /\p{Script=Arabic}/u],
    ["Hebr", /\p{Script=Hebrew}/u],
    ["Deva", /\p{Script=Devanagari}/u],
    ["Grek", /\p{Script=Greek}/u],
    ["Thai", /\p{Script=Thai}/u],
    ["Ethi", /\p{Script=Ethiopic}/u],
    ["Latn", /\p{Script=Latin}/u],
  ];

  function scriptOf(native) {
    for (const [iso, re] of SCRIPTS) if (re.test(native)) return iso;
    return null;
  }

  // The most-learned languages written in each script, in this order (22 section 5, state
  // D): a short list to tap, with search for the rest.
  const POPULAR = {
    Latn: ["es", "en", "pt", "it", "fr", "de", "nl", "sv", "pl", "tr", "id", "vi", "sw", "tl"],
    Cyrl: ["ru", "uk", "bg", "sr", "kk", "be", "mn"],
    Arab: ["ar", "fa", "ur"],
    Hebr: ["he", "yi"],
    Deva: ["hi", "mr", "ne"],
    Hani: ["zh", "zh-Hant", "ja"],
    Grek: ["el"],
    Ethi: ["am", "ti"],
  };
  const CHIPS = 6;

  function languageChips(entry, { Lang }) {
    const list = POPULAR[entry.script] ?? [];
    const out = [];
    for (const tag of list) {
      const s = Lang.checkScript(tag, entry.parsed.native);
      if (!s.ok || Lang.sameBase(tag, entry.base)) continue;
      out.push(tag);
      if (out.length >= CHIPS) break;
    }
    return out;
  }

  // The languages the searchable lists offer: every language with word segmentation in
  // this browser (about 250 here), named in the interface language and in itself.
  function languageList({ spec, uiLocale = "en", Lang, supported = segmenterSupports }) {
    const out = [];
    for (const [tag, entry] of Object.entries(spec.languages.languages)) {
      if (entry.sign || !supported(tag)) continue;
      out.push({ tag, name: Lang.displayName(tag, uiLocale) ?? entry.names?.en ?? tag, endonym: entry.endonym ?? null });
    }
    for (const tag of ["zh-Hant", "pt-BR", "pt-PT", "sr-Latn"]) {
      if (!out.some((x) => x.tag === tag)) out.push({ tag, name: Lang.displayName(tag, uiLocale) ?? tag, endonym: null });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, uiLocale));
  }

  const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

  // Names, endonyms and tags that contain the query; names that start with it first.
  function searchLanguages(list, query, { limit = 8, exclude = [] } = {}) {
    const q = fold(query).trim();
    if (!q) return [];
    const scored = [];
    for (const x of list) {
      if (exclude.includes(x.tag)) continue;
      const fields = [fold(x.name), fold(x.endonym), x.tag.toLowerCase()];
      const rank = fields[2] === q ? 0 : fields.some((f) => f.startsWith(q)) ? 1 : fields.some((f) => f.includes(q)) ? 2 : -1;
      if (rank >= 0) scored.push([rank, x]);
    }
    return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, x]) => x);
  }

  // A preview's candidates (one record per base) grouped into the words the learner
  // chooses between: same language and native word.
  function groupCandidates(candidates) {
    const groups = [];
    for (const c of Array.isArray(candidates) ? candidates : []) {
      if (!c || typeof c.native !== "string" || typeof c.lang !== "string") continue;
      let g = groups.find((x) => x.lang === c.lang && x.native === c.native && (x.sense ?? "") === (c.sense ?? ""));
      if (!g) {
        if (groups.length >= MAX_CANDIDATES) continue;
        g = { lang: c.lang, native: c.native, sense: c.sense ?? "", records: [] };
        groups.push(g);
      }
      if (!g.records.some((r) => r.base_lang === c.base_lang)) g.records.push(c);
    }
    return groups;
  }

  // The record for one base, else the first one.
  const recordFor = (group, base) => group.records.find((r) => r.base_lang === base) ?? group.records[0];

  // The texts of a record's swappable forms, as the projection gives them to pages.
  function formTexts(w) {
    const forms = (Array.isArray(w.forms) ? w.forms : []).filter((f) => f && (typeof f === "string" || f.enabled !== false)).map((f) => (typeof f === "string" ? f : f.text)).filter(Boolean);
    return forms.length ? forms : w.gloss ? [w.gloss] : [];
  }

  const compact = (w) => ({ ...w, forms: formTexts(w) });

  // The index pages use (lib/matcher.js) for one base, with the shared boundary rules.
  function indexFor(mine, base, { spec, Matcher }) {
    const rules = globalThis.KotikoText.rulesFor(spec?.lang?._generic?.boundaries, base);
    return Matcher.buildIndex(mine, { base, rules });
  }

  // The page's swap (content.js) without the DOM: a line split into text and swapped words.
  //   -> [{ text }, { native, surface, word, all }, …]
  function swapParts(text, index, Matcher) {
    if (!index?.size) return [{ text }];
    const out = [];
    let last = 0;
    for (const m of Matcher.scan(text, { base: index.base }, index).matches) {
      if (m.surface.length === 1 && Matcher.skipLetter(text, m.start)) continue;
      const seen = new Set();
      const all = m.entry.candidates.map((c) => c.word).filter((w) => !seen.has(w.lang) && seen.add(w.lang));
      const w = all[0];
      if (m.start > last) out.push({ text: text.slice(last, m.start) });
      // Written as content.js writes it (slice 17); the preview's sentences never shout.
      const native = globalThis.KotikoCasing.display({ shape: m.shape, sentenceStart: m.sentenceStart, shouting: false, native: w.native, lang: w.lang });
      out.push({ native, surface: m.surface, word: w, all });
      last = m.end;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }

  // The preview for one base (22 section 8): the shortest sentence of the base's
  // sentences.json in which the matcher finds one of the word's forms; else the base's
  // fallback template; else (a base with no file) the meaning alone.
  //   -> { base, before, parts, kind: "sentence" | "fallback" | "word" }
  function pickPreview(records, base, { spec, Matcher }) {
    const mine = records.filter((r) => r.base_lang === base).map(compact);
    if (!mine.length) return null;
    const index = indexFor(mine, base, { spec, Matcher });
    const file = langFile(spec, base, "sentences");
    const parts = (text) => swapParts(text, index, Matcher);
    const swapped = (p) => p.some((x) => x.native !== undefined);
    if (file) {
      const sorted = file.sentences.slice().sort((a, b) => [...a].length - [...b].length || (a < b ? -1 : 1));
      for (const s of sorted) {
        const p = parts(s);
        if (swapped(p)) return { base, before: s, parts: p, kind: "sentence" };
      }
      const gloss = formTexts(mine[0])[0] ?? mine[0].gloss;
      const before = file.fallback.replace("{gloss}", gloss);
      const p = parts(before);
      if (swapped(p)) return { base, before, parts: p, kind: "fallback" };
    }
    const gloss = mine[0].gloss ?? formTexts(mine[0])[0];
    return { base, before: gloss, parts: [{ native: mine[0].native, surface: gloss, word: mine[0], all: [mine[0]] }], kind: "word" };
  }

  // A sentence the learner typed in Edit, swapped the same way.
  function previewText(records, base, text, { Matcher, spec = globalThis.KOTIKO_SPEC }) {
    const mine = records.filter((r) => r.base_lang === base).map(compact);
    return swapParts(text, mine.length ? indexFor(mine, base, { spec, Matcher }) : null, Matcher);
  }

  // "Try it on a page" (22 section 8): a Wikipedia full-text search in the base's own
  // language, whose result snippets contain the word several times.
  const WIKI = { en: "simple", "zh-Hans": "zh", "zh-Hant": "zh" };
  const VARIANT = { "zh-Hans": "zh-cn", "zh-Hant": "zh-tw" };

  function wikipediaUrl(base, form) {
    const wiki = WIKI[base] ?? primary(base);
    const variant = VARIANT[base] ? `&variant=${VARIANT[base]}` : "";
    return `https://${wiki}.wikipedia.org/w/index.php?search=${encodeURIComponent(form)}&fulltext=1&ns0=1${variant}`;
  }

  // Lookups are ready when the chosen provider has its key (or needs none) or a server
  // with an access key looks words up (the popup's rule).
  const KEYLESS = new Set(["ollama", "lmstudio", "custom"]);
  function aiReady(b) {
    const kind = b?.lookup?.kind;
    if (kind === "provider") return KEYLESS.has(b.lookup.provider) || b?.keys?.providers?.[b.lookup.provider] === true;
    if (kind === "server") return b?.keys?.server === true;
    return false;
  }

  const api = {
    MAX_BASES,
    MAX_DETECTED,
    detectBases,
    toggleBase,
    moveBase,
    levelOf,
    langFile,
    prefixOf,
    parseEntry,
    manualFor,
    scriptOf,
    scriptLanguage,
    languageChips,
    languageList,
    searchLanguages,
    groupCandidates,
    recordFor,
    formTexts,
    swapParts,
    pickPreview,
    previewText,
    wikipediaUrl,
    aiReady,
  };
  globalThis.KotikoWelcomeModel = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
