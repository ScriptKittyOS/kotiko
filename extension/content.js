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
  const { buildIndexes, scan, matchCase, skipLetter, baseOf } = globalThis.KotikoMatcher; // lib/matcher.js
  const Text = globalThis.KotikoText; // lib/text.js
  const PageLang = globalThis.KotikoPageLang; // lib/page-lang.js
  const { createControlCheck } = globalThis.KotikoControls; // lib/controls.js
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

  let state = { words: [], enabled: true, pausedHosts: [], hiddenLangs: [], speech: null, baseLangs: null, baseRules: null, prefs: null, sensitiveSites: null };
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
  // Which word each swap shows, remembered per site text node so a re-render or a settings
  // change shows the same word in the same place (a choice is only redone when its word is
  // gone). turns: how many times each form was given a word, to rotate its languages.
  let chosen = new WeakMap();
  let turns = new Map();

  // Buttons, toggles, menus and forms stay as the site wrote them (lib/controls.js).
  const controls = createControlCheck((el) => getComputedStyle(el).cursor);

  // The settings slice 16 reads from prefs: whether sensitive sites are left alone (on by
  // default) and which ones the learner let Kotiko run on anyway, whether words in buttons
  // and menus are swapped (off by default), and the words never to swap.
  const prefs = () => (state.prefs && typeof state.prefs === "object" ? state.prefs : {});
  const PAGE_PREFS = ["sensitiveSites", "sensitiveAllowed", "swapControls", "neverSwap"];
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

  function declaredLanguage() {
    const html = document.documentElement;
    const tag = html.getAttribute("lang") || html.getAttribute("xml:lang");
    if (tag) return tag.trim();
    const meta = document.querySelector('meta[http-equiv="content-language" i]')?.getAttribute("content");
    return meta ? meta.split(",")[0].trim() : null;
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

  // One candidate per language (the newest), in the order the index keeps them.
  function choices(candidates) {
    const seen = new Set();
    return candidates.map((c) => c.word).filter((w) => !seen.has(w.lang) && seen.add(w.lang));
  }

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

  // The word a match shows: the one this spot showed before while it's still a choice,
  // else the language whose turn it is.
  function choose(node, m, ordinal, all) {
    const memo = chosen.get(node) ?? chosen.set(node, new Map()).get(node);
    const spot = `${m.key}#${ordinal}`;
    const before = memo.get(spot);
    if (before && all.some((w) => String(w.id) === String(before.id) && w.native === before.native)) return all.find((w) => String(w.id) === String(before.id));
    const turn = turns.get(m.key) ?? 0;
    turns.set(m.key, turn + 1);
    const w = all[turn % all.length];
    memo.set(spot, w);
    return w;
  }

  // The engine's question: what to swap in `text` (a site text node's own text). Reads
  // computed styles only for a node with a match (lib/controls.js), and before any write.
  function plan({ text, node, edges }) {
    if (!indexes) return [];
    const base = baseFor(node.parentElement);
    const index = base && indexes.get(base);
    if (!index?.size) return [];
    if (!scan(text, { base }, index).matches.length) return [];
    if (prefs().swapControls !== true && controls.inControl(node.parentElement)) return [];
    const ctx = { base, ...edges() };
    const items = [];
    const ordinals = new Map();
    for (const m of scan(text, ctx, index).matches) {
      if (m.surface.length === 1 && skipLetter(ctx.before + text + ctx.after, ctx.before.length + m.start)) continue;
      if (neverSwap.has(m.key)) continue;
      const cands = allowed(m, text, ctx, node);
      if (!cands?.length) continue;
      const all = choices(cands);
      if (!all.length) continue;
      const n = ordinals.get(m.key) ?? 0;
      ordinals.set(m.key, n + 1);
      const w = choose(node, m, n, all);
      items.push({ start: m.start, end: m.end, display: matchCase(m.surface, w.native), lang: w.lang, info: { surface: m.surface, key: m.key, word: w, all } });
    }
    return items;
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
  // undo. The storage change re-applies every page.
  async function setNeverSwap(key, on) {
    const { prefs: p = {} } = await ext.storage.local.get({ prefs: {} });
    const list = new Set(Array.isArray(p.neverSwap) ? p.neverSwap : []);
    if (on) list.add(key);
    else list.delete(key);
    await ext.storage.local.set({ prefs: { ...p, neverSwap: [...list] } });
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
    neverSwap = new Set(Array.isArray(prefs().neverSwap) ? prefs().neverSwap : []);
    const hidden = new Set(state.hiddenLangs || []);
    indexes = active() ? buildIndexes((state.words || []).filter((w) => !hidden.has(w.lang)), bases(), { rules: rulesOf }) : null;
    if (indexes && ![...indexes.values()].some((i) => i.size)) indexes = null;
    if (fresh || !indexes) {
      engine.reset();
      chosen = new WeakMap();
      turns = new Map();
      rules = globalThis.KotikoRules.create();
    }
    if (indexes) engine.reapply();
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
      for (const k of Object.keys(state)) if (changes[k]) state[k] = changes[k].newValue ?? state[k];
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
    for (const k of ["words", "enabled", "pausedHosts", "hiddenLangs", "sensitiveSites"]) {
      if (changes[k]) {
        state[k] = changes[k].newValue ?? state[k];
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
  // text back. Remove two releases after 0.3.
  function unwrapLegacy() {
    document.querySelectorAll("span.slovo-w, span.kotiko-w").forEach((span) => { // legacy-name-ok
      span.before(document.createTextNode(span.dataset.en ?? span.textContent));
      span.remove();
    });
  }

  // One live instance per document (slice 15): a newer instance (after an update or a
  // reload of the extension, or injected into a tab open at install) announces itself, and
  // this one restores the page and stops.
  const instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  function onHandoff(e) {
    if (e.detail !== instanceId) teardown();
  }

  function teardown() {
    if (torn) return;
    torn = true;
    clearTimeout(recheckTimer);
    engine?.teardown();
    popover?.destroy();
    document.removeEventListener("kotiko:handoff", onHandoff);
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
    popover = globalThis.KotikoPopover.createPopover({ infoFor, actions: popoverActions });
    popover.install();
    engine = globalThis.KotikoEngine.create({ plan, skip, afterSlice: () => rules.settle(), contextValid });
    ext.runtime.onMessage.addListener(onMessage);
    // Installed a moment ago: the background may not have copied the list yet.
    if (!Array.isArray(state.sensitiveSites)) {
      const r = await ext.runtime.sendMessage({ type: "sensitiveSites" }).catch(() => null);
      if (torn) return;
      state.sensitiveSites = Array.isArray(r?.sites) ? r.sites : [];
    }
    await decidePage();
    if (torn) return;
    neverSwap = new Set(Array.isArray(prefs().neverSwap) ? prefs().neverSwap : []);
    const hidden = new Set(state.hiddenLangs || []);
    indexes = active() ? buildIndexes((state.words || []).filter((w) => !hidden.has(w.lang)), bases(), { rules: rulesOf }) : null;
    if (indexes && ![...indexes.values()].some((i) => i.size)) indexes = null;
    // The word segmenter loads its data on first use: pay for that in a task of its own, not
    // in the first slice of swapping (no task over 50 ms, slice 15).
    if (indexes) {
      for (const b of indexes.keys()) Text.tokenize("warm up", b, rulesOf(b));
      // Any style work the page left pending, before the first slice reads a style.
      if (document.body) void getComputedStyle(document.body).cursor;
      await new Promise((r) => setTimeout(r, 0));
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

  document.dispatchEvent(new CustomEvent("kotiko:handoff", { detail: instanceId }));
  document.addEventListener("kotiko:handoff", onHandoff);
  unwrapLegacy();
  if (document.body) init();
})();
