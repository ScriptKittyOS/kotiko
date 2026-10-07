// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Replaces words on pages written in one of the learner's base languages (the languages
// they read in, slice 50) with the words they've marked as known, in every language they
// haven't hidden. A page in another language is left alone, except for parts of it whose
// own lang is one of their languages (lib/page-lang.js, slice 16). When several languages
// know the same word, the page rotates between them. Point at, click, tap or use the
// "Show details" shortcut on a swapped word to see the word card (content/popover.js,
// slice 19).
//
// The DOM work is content/engine.js's (slice 15): site text nodes stay where the site put
// them, and each swap is a <kotiko-w> element carrying only lang, dir, translate="no" and
// the notranslate class. The original text, the word and its candidates live in the
// engine's WeakMap, which page scripts can't reach: no title, no data-* attributes. This
// file decides what to swap (`plan`) and wires settings, the popup and the word card.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const { buildIndexes, scan, skipLetter, baseOf } = globalThis.KotikoMatcher; // lib/matcher.js
  const Casing = globalThis.KotikoCasing; // lib/casing.js
  const Text = globalThis.KotikoText; // lib/text.js
  const PageLang = globalThis.KotikoPageLang; // lib/page-lang.js
  const { createControlCheck } = globalThis.KotikoControls; // lib/controls.js
  const SwapStyle = globalThis.KotikoSwapStyle; // ui/swap-style.js
  const MARK = "kotiko-w";
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE", "KBD", "SAMP", "SVG", "MATH", "CANVAS", "IFRAME", "TITLE"]);
  const SAMPLE = 2000;
  // Slice 16's element rules: code editors and code views, editable roles, and the site's own
  // "don't translate" marks (below <body>: many React sites put translate="no" on <html> only
  // to keep Google Translate from breaking them).
  const SKIP_SELECTOR = [
    ".monaco-editor", ".cm-editor", ".CodeMirror", ".ace_editor", ".react-code-lines", ".blob-code", ".highlight",
    "[class*='language-']", "[role=code]", "[role=textbox]", "[role=searchbox]",
    "[translate=no]", ".notranslate", "[data-kotiko-skip]", "[data-slovo-skip]", // legacy-name-ok
    "template", "var", "object", "embed", "video", "audio",
  ].join(",");
  // Login and payment forms, on every site.
  const SENSITIVE = "input[type=password], [autocomplete^='cc-'], [autocomplete=one-time-code]";
  const host = location.hostname;
  const isMark = (n) => n?.nodeType === 1 && n.localName === MARK;

  const DEFAULTS = { words: [], enabled: true, pausedHosts: [], hiddenLangs: [], speech: null, baseLangs: null, baseRules: null, prefs: null, sensitiveSites: null, mixing: null, seedSalt: null };
  let state = { ...DEFAULTS };
  // A key removed from storage (slice 12's "delete everything" clears it all) is back to
  // its default, so the page puts its original words back.
  const changed = (c, k) => (c.newValue === undefined ? DEFAULTS[k] : c.newValue);
  let indexes = null;
  // The page's base (or null) and why, from lib/page-lang.js.
  let page = { base: null, reason: "unknown", lang: null };
  let engine = null;
  let popover = null;
  let torn = false;
  // Changes that arrive while starting up are kept and applied once the engine runs, so a
  // word added as the page opens is never missed.
  let ready = false;
  let missed = null;
  let recheckTimer = null;
  // element -> its base for this apply (null: not one of the learner's languages)
  let baseCache = new WeakMap();
  // element -> whether slice 16's element rules leave it alone, for this apply
  let skipCache = new WeakMap();
  // Slice 16's token rules, with this page view's evidence and decisions.
  let rules = globalThis.KotikoRules.create();
  // Which of the learner's languages each word shows (slice 18): one per concept per page
  // per day, the same for every occurrence and after every re-render. The page session's
  // day and start time are fixed when the page opens, not at midnight mid-read.
  const Precedence = globalThis.KotikoPrecedence; // lib/precedence.js
  const STARTED = Date.now();
  const DAY = Precedence.dayKey(new Date(STARTED));
  // Without the synced salt (a moment after install), a salt for this page view only.
  const localSalt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  let session = null;
  let sessionHref = null;
  let eligibleLangs = new Set();
  // What this page view has shown, concept -> its languages, for as long as the document
  // lives (a single-page app's navigations included). A page reads its own DOM, so each
  // swap tells it one of the learner's words; capping the distinct concepts (and the
  // languages of one concept, for "mix within the page") caps what any page can learn in
  // one view, whatever text it shows (security review A-01; spec/rules.json).
  const PAGE_RULES = globalThis.KOTIKO_PAGE_RULES ?? {};
  const MAX_CONCEPTS = PAGE_RULES.max_page_concepts ?? 500;
  const MAX_LANGS = PAGE_RULES.max_page_langs_per_concept ?? 3;
  const revealed = new Map();

  // Buttons, toggles, menus and forms stay as the site wrote them (lib/controls.js).
  const controls = createControlCheck((el) => getComputedStyle(el).cursor);

  // The settings slice 16 reads from prefs: whether sensitive sites are left alone (on by
  // default) and which ones the learner let Kotiko run on anyway, whether words in buttons
  // and menus are swapped (off by default), and the words never to swap.
  const prefs = () => (state.prefs && typeof state.prefs === "object" ? state.prefs : {});
  const PAGE_PREFS = ["sensitiveSites", "sensitiveAllowed", "swapControls", "neverSwap", "screenReader", "keyboardSwaps"];
  const pagePrefs = (p) => JSON.stringify(PAGE_PREFS.map((k) => p?.[k] ?? null));
  let neverSwap = new Set();

  // The category of a sensitive site Kotiko leaves alone here (slice 16 §4), or null.
  function sensitive() {
    const p = prefs();
    if (p.sensitiveSites === false) return null;
    if (Array.isArray(p.sensitiveAllowed) && p.sensitiveAllowed.includes(host)) return null;
    return globalThis.KotikoSensitive.match(state.sensitiveSites, location);
  }

  // Whether Kotiko swaps on this page at all.
  const active = () => state.enabled && !(state.pausedHosts || []).includes(host) && !sensitive();

  // False once the extension was updated, reloaded or removed under this page (06 F15).
  function contextValid() {
    try {
      return !!ext?.runtime?.id;
    } catch {
      return false;
    }
  }

  // The learner's base languages, in their order: the ones the background wrote rules for
  // (from slice 50's setting, in every mode); before that exists, the local copy of the
  // setting, else the bases of the words themselves.
  function bases() {
    const keys = Object.keys(state.baseRules ?? {});
    if (keys.length) return keys.slice(0, 4);
    if (Array.isArray(state.baseLangs) && state.baseLangs.length) return state.baseLangs.slice(0, 4);
    const seen = [...new Set((state.words || []).map((w) => w.base_lang ?? "en"))];
    return seen.length ? seen.slice(0, 4) : ["en"];
  }
  const rulesOf = (base) => state.baseRules?.[base]?.boundaries ?? Text.DEFAULT_RULES;
  const casingOf = (base) => state.baseRules?.[base]?.casing ?? {};
  const stopwordsOf = (base) => new Set(state.baseRules?.[base]?.stopwords ?? []);

  // ── which language the page is in ─────────────────────────────────────────

  // The page's declared language, as a canonical tag; a lang attribute that isn't a
  // language tag counts as none (lib/page-lang.js, security review A-02).
  function declaredLanguage() {
    const html = document.documentElement;
    const tag = html.getAttribute("lang") || html.getAttribute("xml:lang");
    if (tag) return PageLang.canonical(tag);
    const meta = document.querySelector('meta[http-equiv="content-language" i]')?.getAttribute("content");
    return meta ? PageLang.canonical(meta.split(",")[0]) : null;
  }

  // Up to 2,000 characters of the page's own text (our swaps count as the words they
  // replaced), from main or article when there is one; no layout reads.
  function sampleText() {
    const root = document.querySelector("main, article, [role=main]") ?? document.body;
    if (!root) return "";
    let out = "";
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (isMark(n)) return NodeFilter.FILTER_ACCEPT;
        return SKIP.has(n.nodeName.toUpperCase()) || n.localName === "kotiko-popover" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      },
    });
    while (out.length < SAMPLE && tw.nextNode()) {
      const n = tw.currentNode;
      const t = isMark(n) ? engine?.infoFor(n)?.surface ?? "" : isMark(n.parentNode) ? "" : n.nodeValue;
      if (t && /\S/.test(t)) out += `${t.trim()} `;
    }
    return out.slice(0, SAMPLE);
  }

  async function detect(text) {
    try {
      if (!ext?.i18n?.detectLanguage || !text) return null;
      return await ext.i18n.detectLanguage(text);
    } catch {
      return null;
    }
  }

  async function decidePage() {
    const bs = bases();
    const declared = declaredLanguage();
    const text = sampleText();
    const detected = await detect(text);
    const common = !declared && (!detected || text.length < PageLang.SHORT) ? PageLang.bestCommon(text, bs, { rules: rulesOf, stopwords: stopwordsOf }) : null;
    page = PageLang.decide({ bases: bs, declared, detected, sampleLength: text.length, common });
    // Single-page apps fill in their text after load: look once more in 5 s.
    clearTimeout(recheckTimer);
    if (!declared && text.length < PageLang.SHORT) recheckTimer = setTimeout(recheck, 5000);
  }

  async function recheck() {
    if (torn) return;
    const before = page.base;
    await decidePage();
    clearTimeout(recheckTimer);
    if (page.base !== before) apply({ fresh: true });
  }

  // The base a piece of the page is written in: the nearest lang attribute below <html>
  // when it names one of the learner's languages (null when it names another language),
  // else the page's base. An empty lang inherits the page's.
  function baseFor(el) {
    if (!el) return page.base;
    if (baseCache.has(el)) return baseCache.get(el);
    const owner = el.closest("[lang]");
    const tag = owner && owner !== document.documentElement ? owner.getAttribute("lang").trim() : "";
    const b = tag ? baseOf(tag, bases()) : page.base;
    baseCache.set(el, b);
    return b;
  }

  // ── what to swap ────────────────────────────────────────────────────────────

  // The candidates slice 16's rules let a match show, or null; a capital that waits for the
  // page's evidence is noted and looked at again once decided.
  function allowed(m, text, ctx, node) {
    const r = rules.judge(m, { text, ctx, casing: casingOf(ctx.base) });
    if (r?.keep) return r.keep;
    if (!r?.defer) return null;
    const d = rules.decision(m.key, r.defer);
    if (d === undefined) rules.defer(m.key, r.defer, node);
    return d ? m.entry.candidates.filter((c) => c.case !== "exact" && c.case !== "proper") : null;
  }

  // The page session that picks languages; a new one when a single-page app navigates.
  function newSession() {
    sessionHref = location.href;
    session = Precedence.createSession({
      salt: typeof state.seedSalt === "string" && state.seedSalt ? state.seedSalt : localSalt,
      pageKey: Precedence.pageKey(location.href),
      dayKey: DAY,
      mixing: state.mixing,
      eligible: eligibleLangs,
      words: state.words || [],
      keyOf: (s, b) => Text.keyOf(s, b, rulesOf(b)),
      now: STARTED,
    });
  }

  // The indexes hold every word, so a concept never depends on what is hidden; which
  // languages may show is the session's question (18 §1).
  function rebuild() {
    neverSwap = new Set(Array.isArray(prefs().neverSwap) ? prefs().neverSwap : []);
    eligibleLangs = Precedence.eligible({ words: state.words || [], hiddenLangs: state.hiddenLangs || [], mixing: state.mixing });
    indexes = active() && eligibleLangs.size ? buildIndexes(state.words || [], bases(), { rules: rulesOf }) : null;
    if (indexes && ![...indexes.values()].some((i) => i.size)) indexes = null;
    newSession();
  }

  // The engine's question: what to swap in `text` (a site text node's own text). Reads
  // computed styles only for a node with a match (lib/controls.js), and before any write.
  function plan({ text, node, edges, shown }) {
    if (!indexes) return [];
    const base = baseFor(node.parentElement);
    const index = base && indexes.get(base);
    if (!index?.size) return [];
    if (!scan(text, { base }, index).matches.length) return [];
    if (prefs().swapControls !== true && controls.inControl(node.parentElement)) return [];
    // Text the learner doesn't see waits until they do (engine.js, security review A-01).
    if (shown && !shown()) return [];
    const ctx = { base, ...edges() };
    const items = [];
    const ordinals = new Map();
    if (location.href !== sessionHref) newSession();
    for (const m of scan(text, ctx, index).matches) {
      if (m.surface.length === 1 && skipLetter(ctx.before + text + ctx.after, ctx.before.length + m.start)) continue;
      if (neverSwap.has(m.key)) continue;
      const cands = allowed(m, text, ctx, node);
      if (!cands?.length) continue;
      // "Mix within the page" tells occurrences apart by the text around them.
      const before = text.slice(Math.max(0, m.start - 32), m.start);
      const after = text.slice(m.end, m.end + 32);
      const spot = `${m.key}${before}${after}`;
      const ordinal = ordinals.get(spot) ?? 0;
      ordinals.set(spot, ordinal + 1);
      const c = session.choose({ base, entry: m.entry, candidates: cands, surface: m.surface, before, after, ordinal });
      if (!c?.word) continue;
      const w = reveal(c);
      if (!w) continue;
      const all = [w, ...[c.word, ...c.others].filter((x) => x !== w)];
      const alsoLangs = w === c.word ? c.alsoLangs : [...new Set(all.filter((x) => x !== w && x.lang !== w.lang && x.native === w.native).map((x) => x.lang))];
      // Written in the target's own capitals (slice 17).
      const { shouting } = rules.flags(text, ctx);
      // sentenceStart is worked out lazily; only a capitalised word needs it.
      const display = Casing.display({ shape: m.shape, sentenceStart: m.shape === "title" && m.sentenceStart, shouting, native: w.native, lang: w.lang });
      items.push({ start: m.start, end: m.end, display, lang: w.lang, read: heard(display, w.lang, text.slice(m.start, m.end), base), tab: prefs().keyboardSwaps === true || null, info: { surface: m.surface, key: m.key, word: w, all, alsoLangs } });
    }
    return items;
  }

  // The word a choice may show within this page view's caps, or null: a concept past the
  // cap stays as the site wrote it; a concept already in its language limit shows one of
  // the languages it has shown.
  function reveal(c) {
    let langs = revealed.get(c.concept);
    if (!langs) {
      if (revealed.size >= MAX_CONCEPTS) return null;
      revealed.set(c.concept, (langs = new Set()));
    }
    const w = langs.has(c.word.lang) || langs.size < MAX_LANGS ? c.word : c.others.find((x) => langs.has(x.lang)) ?? null;
    if (w) langs.add(w.lang);
    return w;
  }

  // What screen readers hear on a swap (27 §2). The default is the word itself, in its own
  // voice (null: the element's text). "original" puts back the page's own text, tagged with
  // the language slice 16 resolved for it; "both" reads the word, then the original, joined
  // the way the interface language joins a list. Either puts page text into the page's DOM,
  // which the setting says.
  function heard(display, lang, original, base) {
    const mode = prefs().screenReader;
    if (mode !== "original" && mode !== "both") return null;
    if (mode === "original") return [{ text: original, lang: base }];
    let parts;
    try {
      parts = new Intl.ListFormat(globalThis.KotikoI18n?.locale?.() ?? "en", { type: "unit", style: "short" }).formatToParts(["\u0001", "\u0002"]);
    } catch {
      parts = [{ type: "element", value: "\u0001" }, { type: "literal", value: ", " }, { type: "element", value: "\u0002" }];
    }
    return parts.map((p) => (p.type === "literal" ? p.value : p.value === "\u0001" ? { text: display, lang } : { text: original, lang: base }));
  }

  // Slice 16's element rules, asked by the engine for every element it walks: a part of
  // the page in a language the learner doesn't read, a code editor, an editable box, the
  // site's "don't translate" marks, a login or payment form.
  function skip(el) {
    if (skipCache.has(el)) return skipCache.get(el);
    // <html>'s lang is the page's, which decidePage weighs: a German page can still hold an
    // English quote the learner reads.
    if (el === document.documentElement || el === document.body) {
      skipCache.set(el, false);
      return false;
    }
    const r = (el.hasAttribute("lang") && baseFor(el) === null) || el.matches(SKIP_SELECTOR) || (el.localName === "form" && !!el.querySelector(SENSITIVE));
    skipCache.set(el, r);
    return r;
  }

  // ── applying settings ───────────────────────────────────────────────────────

  const sameId = (a, b) => String(a) === String(b);

  // Everything the word card needs for one swap, built when it opens.
  function infoFor(el) {
    const i = engine?.infoFor(el);
    if (!i) return null;
    const w = i.word;
    const base = w.base_lang ?? "en";
    // The same target word saved for the learner's other base languages (50 §3).
    const others = (state.words || []).filter((x) => x !== w && x.lang === w.lang && x.native === w.native && (x.base_lang ?? "en") !== base);
    return { surface: i.surface, key: i.key, word: w, all: i.all, others };
  }

  // "Don't swap this word" (slice 16 §5): the form's key joins the never-swap list, with an
  // undo. The background changes the list (content scripts write no settings, SCR-448); the
  // storage change re-applies every page.
  async function setNeverSwap(key, on) {
    const r = await ext.runtime.sendMessage({ type: "neverSwap", key, on });
    if (!r?.ok) throw new Error("not saved");
  }

  const popoverActions = [
    {
      id: "never-swap",
      label: () => globalThis.KotikoI18n.t("popover_never_swap"),
      visible: (info) => typeof info?.key === "string",
      run: (info, pop) => {
        const { key, surface } = info;
        pop.close();
        setNeverSwap(key, true)
          .then(() => pop.toast(globalThis.KotikoI18n.t("toast_never_swap", { word: surface }), { actionLabel: globalThis.KotikoI18n.t("add_undo"), onAction: () => setNeverSwap(key, false).catch(() => {}) }))
          .catch(() => {});
      },
    },
  ];

  // Rebuilds the indexes and brings the page up to date: only swaps whose word changed are
  // rewritten (slice 15). `fresh` starts over (the page's language changed).
  function apply({ fresh = false } = {}) {
    // The open word card follows its word through the re-swap (19 §10).
    const cur = popover?.current();
    const anchorParent = cur?.el.parentElement ?? null;
    controls.reset();
    baseCache = new WeakMap();
    skipCache = new WeakMap();
    rebuild();
    if (fresh || !indexes) {
      engine.reset();
      rules = globalThis.KotikoRules.create();
    }
    if (indexes) engine.reapply();
    // The page may have dropped the sheet; it comes back with the swaps, and goes once
    // Kotiko is off or paused here.
    if (!indexes) unstyle();
    else if (styled) SwapStyle.install(document);
    if (cur) {
      const { id } = cur.info.word;
      const gone = !(state.words || []).some((w) => sameId(w.id, id));
      popover.refresh(() => {
        if (cur.el.isConnected && !gone) return cur.el;
        if (gone || !anchorParent) return null;
        for (const el of anchorParent.querySelectorAll(MARK)) {
          const i = engine.infoFor(el);
          if (i && i.surface === cur.info.surface && sameId(i.word.id, id)) return el;
        }
        return null;
      });
      if (gone) popover.toast(globalThis.KotikoI18n.t("popover_removed"));
    }
  }

  function configureSpeech() {
    const KotikoSpeak = globalThis.KotikoSpeak;
    if (!KotikoSpeak) return;
    KotikoSpeak.configure({ ...KotikoSpeak.DEFAULTS, ...(state.speech && typeof state.speech === "object" ? state.speech : {}) });
  }

  // What the popup shows about this page (slice 20, states H and H2): the page's base, or
  // the language it's in when that isn't one of the learner's, whether any word has a
  // meaning in its base, and whether Kotiko stepped back from a page that kept undoing it.
  function pageStatus() {
    const index = page.base ? indexes?.get(page.base) ?? null : null;
    const out = { base: page.base, reason: page.reason, lang: page.lang, words: index ? index.size : 0 };
    if (engine?.status() === "stood-down") out.stoodDown = true;
    const category = sensitive();
    if (category) out.sensitive = category;
    return out;
  }

  // Messages from Kotiko's background and popup only (slice 26): a sender of this
  // extension with no tab. Other content scripts can't message this one directly.
  function onMessage(msg, sender, sendResponse) {
    if (torn || !msg || typeof msg !== "object" || sender?.id !== ext.runtime.id || sender.tab) return undefined;
    if (msg.type === "page-status") {
      sendResponse(pageStatus());
      return undefined;
    }
    if (msg.type === "reveal-word") {
      popover.reveal();
      return undefined;
    }
    if (msg.type === "toast" && typeof msg.message === "string" && msg.message.length <= 300) {
      popover.toast(msg.message);
    }
    return undefined;
  }

  async function onStorage(changes, area) {
    if (torn || area !== "local") return;
    if (!contextValid()) return teardown();
    if (!ready) {
      for (const k of Object.keys(state)) if (changes[k]) state[k] = changed(changes[k], k);
      missed = { languages: missed?.languages || !!(changes.baseLangs || changes.baseRules) };
      return;
    }
    if (changes.speech) {
      state.speech = changes.speech.newValue ?? null;
      configureSpeech();
    }
    let dirty = false;
    // Only the page's own settings in prefs (not the theme, say) re-apply.
    if (changes.prefs) {
      const next = changes.prefs.newValue ?? null;
      if (pagePrefs(next) !== pagePrefs(state.prefs)) dirty = true;
      state.prefs = next;
    }
    for (const k of ["words", "enabled", "pausedHosts", "hiddenLangs", "sensitiveSites", "mixing", "seedSalt"]) {
      if (changes[k]) {
        state[k] = changed(changes[k], k);
        dirty = true;
      }
    }
    let languages = false;
    for (const k of ["baseLangs", "baseRules"]) {
      if (changes[k] && JSON.stringify(changes[k].newValue ?? null) !== JSON.stringify(state[k])) {
        state[k] = changes[k].newValue ?? null;
        languages = true;
      }
    }
    if (languages) {
      // Judge the page again by its own text, not our swaps.
      engine.unwrapAll();
      await decidePage();
      if (torn) return;
      apply({ fresh: true });
      return;
    }
    if (dirty) apply();
  }

  // An editor that gets focus never has swapped words to type around (slice 16 §2).
  function onFocus(e) {
    const t = e.target;
    if (t?.nodeType === 1 && (t.isContentEditable || /^(textbox|searchbox|combobox)$/.test(t.getAttribute?.("role") ?? ""))) engine.restoreWithin(t);
  }

  // Swaps made before this version kept the original text in data-en: the span from
  // before the rename and span.kotiko-w (before slice 15's element). Put the page's own
  // text back, on pages Kotiko swaps (elsewhere a page could plant one to see Kotiko act).
  // Remove two releases after 0.3.
  function unwrapLegacy() {
    document.querySelectorAll("span.slovo-w, span.kotiko-w").forEach((span) => { // legacy-name-ok
      span.before(document.createTextNode(span.dataset.en ?? span.textContent));
      span.remove();
    });
  }

  // One live instance per document (slice 15). Nothing about this is on the page: an event
  // or attribute there would let any site switch Kotiko off, or see it installed where it's
  // paused or off (security review A-03). Instances of one extension in a frame share this
  // script world, so a newer one (injected into a tab open at install, or injected twice)
  // finds the live one here and tears it down. One left from before an update or a reload
  // has lost its extension context: it tears down at its next DOM change (the engine checks
  // contextValid()), which waitForOrphans() makes happen before this one swaps.
  const LIVE = "__kotikoContent";
  function claimDocument() {
    const prev = globalThis[LIVE];
    globalThis[LIVE] = { teardown };
    try {
      prev?.teardown?.();
    } catch {
      // the old instance's script is gone
    }
  }

  // Swaps on the page that aren't this instance's are an orphan's: one DOM change wakes it,
  // and this instance waits (up to a second) until it has put the page's text back. Only
  // where Kotiko swaps anyway, so a page that plants a <kotiko-w> learns nothing.
  async function waitForOrphans() {
    if (!document.querySelector(MARK)) return;
    const poke = document.createTextNode("");
    document.documentElement.append(poke);
    poke.remove();
    await new Promise((resolve) => {
      const mo = new MutationObserver(() => {
        if (!document.querySelector(MARK)) done();
      });
      const timer = setTimeout(done, 1000);
      function done() {
        mo.disconnect();
        clearTimeout(timer);
        resolve();
      }
      mo.observe(document, { childList: true, subtree: true });
    });
  }

  // The swap stylesheet goes in with the first swap: nothing of Kotiko's styles a page it
  // doesn't swap (ui/swap-style.js).
  let styled = false;
  function styleSwaps() {
    styled = true;
    SwapStyle.install(document);
  }
  function unstyle() {
    if (!styled) return;
    styled = false;
    SwapStyle.uninstall(document);
  }

  function teardown() {
    if (torn) return;
    torn = true;
    if (globalThis[LIVE]?.teardown === teardown) delete globalThis[LIVE];
    clearTimeout(recheckTimer);
    engine?.teardown();
    unstyle();
    popover?.destroy();
    document.removeEventListener("focusin", onFocus, true);
    try {
      ext.storage.onChanged.removeListener(onStorage);
      ext.runtime.onMessage.removeListener(onMessage);
    } catch {
      // the old extension context is gone
    }
  }

  async function init() {
    ext.storage.onChanged.addListener(onStorage);
    state = await ext.storage.local.get(state);
    if (torn) return;
    configureSpeech();
    popover = globalThis.KotikoPopover.createPopover({ infoFor, actions: popoverActions, reduceMotion: () => prefs().motion === "reduce" });
    popover.install();
    engine = globalThis.KotikoEngine.create({ plan, skip, afterSlice: () => rules.settle(), contextValid, onSwap: () => styled || styleSwaps() });
    ext.runtime.onMessage.addListener(onMessage);
    // Installed a moment ago: the background may not have copied the list yet.
    if (!Array.isArray(state.sensitiveSites)) {
      const r = await ext.runtime.sendMessage({ type: "sensitiveSites" }).catch(() => null);
      if (torn) return;
      state.sensitiveSites = Array.isArray(r?.sites) ? r.sites : [];
    }
    await decidePage();
    if (torn) return;
    rebuild();
    if (active()) unwrapLegacy();
    // The word segmenter loads its data on first use: pay for that in a task of its own, not
    // in the first slice of swapping (no task over 50 ms, slice 15).
    if (indexes) {
      for (const b of indexes.keys()) Text.tokenize("warm up", b, rulesOf(b));
      // Any style work the page left pending, before the first slice reads a style.
      if (document.body) void getComputedStyle(document.body).cursor;
      await new Promise((r) => setTimeout(r, 0));
      if (torn) return;
      await waitForOrphans();
      if (torn) return;
    }
    engine.start();
    document.addEventListener("focusin", onFocus, true);
    ready = true;
    if (missed) {
      if (missed.languages) await decidePage();
      if (torn) return;
      apply({ fresh: missed.languages });
      missed = null;
    }

    // Pick up words added from Telegram since the last sync.
    ext.runtime.sendMessage({ type: "sync" }).catch(() => {});
  }

  claimDocument();
  if (document.body) init();
})();
