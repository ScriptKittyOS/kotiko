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
// Each swap is a <kotiko-w> element carrying only lang, dir, translate="no" and the
// notranslate class (slice 15). The original text, the word and its candidates live in a
// WeakMap here, which page scripts can't reach: no title, no data-* attributes.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const { buildIndexes, scan, matchCase, skipLetter, baseOf } = globalThis.KotikoMatcher; // lib/matcher.js
  const Text = globalThis.KotikoText; // lib/text.js
  const PageLang = globalThis.KotikoPageLang; // lib/page-lang.js
  const { createControlCheck } = globalThis.KotikoControls; // lib/controls.js
  const MARK = "kotiko-w";
  const SKIP = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION",
    "CODE", "PRE", "KBD", "SAMP", "SVG", "MATH", "CANVAS", "IFRAME", "TITLE",
  ]);
  // The block boundary (U+2029): what the matcher sees beyond the edge of a line of text.
  const BLOCK = String.fromCharCode(0x2029);
  const SAMPLE = 2000;
  const host = location.hostname;
  const isMark = (n) => n?.nodeType === 1 && n.localName === MARK;

  let state = { words: [], enabled: true, pausedHosts: [], hiddenLangs: [], speech: null, baseLangs: null, baseRules: null };
  let indexes = null;
  // The page's base (or null) and why, from lib/page-lang.js.
  let page = { base: null, reason: "unknown", lang: null };
  let observer = null;
  let popover = null;
  let torn = false;
  const pending = new Set();
  let flushTimer = null;
  let recheckTimer = null;
  // <kotiko-w> -> { surface, word, all }: the page's own text, the word shown and every
  // candidate for that form (slice 15's SwapInfo, reduced to what exists today).
  let info = new WeakMap();
  // element -> its base for this apply (null: not one of the learner's languages)
  let baseCache = new WeakMap();
  // entry -> how many times it was swapped on this page, to rotate its languages
  let turns = new Map();

  // Buttons, toggles, menus and forms stay as the site wrote them (lib/controls.js).
  const controls = createControlCheck((el) => getComputedStyle(el).cursor);

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
      const t = isMark(n) ? info.get(n)?.surface ?? "" : isMark(n.parentNode) ? "" : n.nodeValue;
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
    if (page.base !== before) apply();
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

  // ── swapping ────────────────────────────────────────────────────────────────

  // Up to 16 characters of the text just before or after `node` in the same line of text:
  // from a sibling, or the parent's sibling when the parent is inline (two levels at
  // most), never across a block, where the matcher sees U+2029: "<b>AOI</b> I",
  // "hot<wbr>dog". Element boundaries count as a space.
  const INLINE = new Set([
    "A", "ABBR", "B", "BDI", "BDO", "CITE", "DATA", "DEL", "DFN", "EM", "FONT", "I", "INS", "MARK", "Q", "S", "SMALL",
    "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "WBR",
  ]);
  const inline = (n) => INLINE.has(n?.nodeName.toUpperCase());

  function neighbourText(node, dir) {
    const before = dir === "previousSibling";
    let n = node;
    for (let up = 0; up < 2 && !n[dir] && inline(n.parentNode); up++) n = n.parentNode;
    let s = n[dir];
    let crossed = n !== node;
    while (s?.nodeType === 1 && !isMark(s)) {
      if (!inline(s)) return BLOCK;
      crossed = true;
      s = before ? s.lastChild : s.firstChild;
    }
    if (!s) return BLOCK;
    const t = s.nodeType === 3 ? s.nodeValue : isMark(s) ? info.get(s)?.surface ?? "" : "";
    const part = before ? t.slice(-16) : t.slice(0, 16);
    if (!crossed) return part;
    return before ? `${part} ` : ` ${part}`;
  }

  // The matches in one text node, or null. Scans without the neighbouring text first, which
  // is cheaper, and only for a node with a match looks again with it, so a word split
  // across elements ("hot<wbr>dog") is never matched.
  function matchesIn(node) {
    const text = node.nodeValue;
    if (!text || !node.parentNode) return null;
    const base = baseFor(node.parentElement);
    const index = base && indexes.get(base);
    if (!index?.size) return null;
    if (!scan(text, { base }, index).matches.length) return null;
    const ctx = { base, before: neighbourText(node, "previousSibling"), after: neighbourText(node, "nextSibling") };
    const { matches } = scan(text, ctx, index);
    return matches.length ? { node, ctx, matches } : null;
  }

  // One candidate per language (the newest), in the order the index keeps them.
  function choices(entry) {
    const seen = new Set();
    return entry.candidates.map((c) => c.word).filter((w) => !seen.has(w.lang) && seen.add(w.lang));
  }

  function swapText({ node, ctx, matches }) {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of matches) {
      if (m.surface.length === 1 && skipLetter(ctx.before + text + ctx.after, ctx.before.length + m.start)) continue;
      const all = choices(m.entry);
      if (!all.length) continue;
      const turn = turns.get(m.entry) ?? 0;
      turns.set(m.entry, turn + 1);
      const w = all[turn % all.length];
      if (m.start > last) frag.appendChild(document.createTextNode(text.slice(last, m.start)));
      const el = document.createElement(MARK);
      el.lang = w.lang; // screen-reader voice and Han glyphs
      el.dir = "auto"; // isolates right-to-left words (Arabic, Hebrew) from the text around them
      el.setAttribute("translate", "no"); // machine translation leaves the word alone (43)
      el.className = "notranslate";
      el.textContent = matchCase(m.surface, w.native);
      info.set(el, { surface: m.surface, word: w, all });
      frag.appendChild(el);
      last = m.end;
    }
    if (last === 0) return;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  // Reads first, then writes: the control check may read computed styles, and reading
  // them between our own DOM changes would make the browser recalculate styles each time.
  // Only text nodes with a match are checked.
  function processTexts(nodes) {
    const todo = [];
    for (const n of nodes) {
      const found = matchesIn(n);
      if (found && !controls.inControl(n.parentElement)) todo.push(found);
    }
    todo.forEach(swapText);
  }

  function insideSkipped(node) {
    for (let el = node.nodeType === 1 ? node : node.parentElement; el; el = el.parentElement) {
      if (SKIP.has(el.nodeName.toUpperCase()) || el.isContentEditable || isMark(el) || el.localName === "kotiko-popover") {
        return true;
      }
    }
    return false;
  }

  function walk(root) {
    if (!indexes || !root || insideSkipped(root)) return;
    if (root.nodeType === Node.TEXT_NODE) return processTexts([root]);
    if (root.nodeType !== Node.ELEMENT_NODE) return;

    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (SKIP.has(n.nodeName.toUpperCase()) || n.isContentEditable || isMark(n)) {
          return NodeFilter.FILTER_REJECT;
        }
        // A part of the page in a language the learner doesn't read.
        if (n.hasAttribute("lang") && baseFor(n) === null) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      },
    });
    const nodes = [];
    while (tw.nextNode()) nodes.push(tw.currentNode);
    processTexts(nodes);
  }

  // Puts the page's own text back for every swap this instance made. A <kotiko-w> that
  // isn't in this instance's map belongs to another instance, which restores its own when
  // it hands off (below).
  function unwrapAll() {
    const parents = new Set();
    document.querySelectorAll(MARK).forEach((el) => {
      const i = info.get(el);
      if (!i) return;
      if (el.parentNode) parents.add(el.parentNode);
      el.replaceWith(document.createTextNode(i.surface));
    });
    info = new WeakMap();
    parents.forEach((p) => p.normalize());
  }

  // Swaps made before this version kept the original text in data-en: the span from
  // before the rename and span.kotiko-w (before slice 15's element). Put the page's own
  // text back. Remove two releases after 0.3.
  function unwrapLegacy() {
    const parents = new Set();
    document.querySelectorAll("span.slovo-w, span.kotiko-w").forEach((span) => { // legacy-name-ok
      if (span.parentNode) parents.add(span.parentNode);
      span.replaceWith(document.createTextNode(span.dataset.en ?? span.textContent));
    });
    parents.forEach((p) => p.normalize());
  }

  const sameId = (a, b) => String(a) === String(b);

  // Everything the word card needs for one swap, built when it opens.
  function infoFor(el) {
    const i = info.get(el);
    if (!i) return null;
    const w = i.word;
    const base = w.base_lang ?? "en";
    // The same target word saved for the learner's other base languages (50 §3).
    const others = (state.words || []).filter((x) => x !== w && x.lang === w.lang && x.native === w.native && (x.base_lang ?? "en") !== base);
    return { ...i, others };
  }

  function apply() {
    // The open word card follows its word through the re-swap (19 §10).
    const cur = popover?.current();
    const anchorParent = cur?.el.parentElement ?? null;
    unwrapAll();
    controls.reset();
    baseCache = new WeakMap();
    turns = new Map();
    const on = state.enabled && !(state.pausedHosts || []).includes(host);
    const hidden = new Set(state.hiddenLangs || []);
    indexes = on ? buildIndexes((state.words || []).filter((w) => !hidden.has(w.lang)), bases(), { rules: rulesOf }) : null;
    if (indexes && ![...indexes.values()].some((i) => i.size)) indexes = null;
    if (indexes) walk(document.body);
    observer?.takeRecords(); // ignore the mutations we just caused
    if (cur) {
      const { id } = cur.info.word;
      const gone = !(state.words || []).some((w) => sameId(w.id, id));
      popover.refresh(() => {
        if (gone || !anchorParent) return null;
        for (const el of anchorParent.querySelectorAll(MARK)) {
          const i = info.get(el);
          if (i && i.surface === cur.info.surface && sameId(i.word.id, id)) return el;
        }
        return null;
      });
      if (gone) popover.toast(globalThis.KotikoI18n.t("popover_removed"));
    }
  }

  function flush() {
    flushTimer = null;
    if (!indexes) return pending.clear();
    const nodes = [...pending];
    pending.clear();
    for (const n of nodes) if (n.isConnected) walk(n);
    observer.takeRecords();
  }

  function onMutations(records) {
    if (!contextValid()) return teardown();
    if (!indexes) return;
    for (const r of records) {
      if (r.type === "characterData") pending.add(r.target);
      for (const n of r.addedNodes) {
        if (isMark(n) || n.localName === "kotiko-popover") continue;
        pending.add(n);
      }
    }
    if (pending.size && !flushTimer) flushTimer = setTimeout(flush, 250);
  }

  function configureSpeech() {
    const KotikoSpeak = globalThis.KotikoSpeak;
    if (!KotikoSpeak) return;
    KotikoSpeak.configure({ ...KotikoSpeak.DEFAULTS, ...(state.speech && typeof state.speech === "object" ? state.speech : {}) });
  }

  // What the popup shows about this page (slice 20, states H and H2): the page's base, or
  // the language it's in when that isn't one of the learner's, and whether any word has a
  // meaning in its base.
  function pageStatus() {
    const index = page.base ? indexes?.get(page.base) ?? null : null;
    return { base: page.base, reason: page.reason, lang: page.lang, words: index ? index.size : 0 };
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
    if (changes.speech) {
      state.speech = changes.speech.newValue ?? null;
      configureSpeech();
    }
    let dirty = false;
    for (const k of ["words", "enabled", "pausedHosts", "hiddenLangs"]) {
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
      unwrapAll();
      await decidePage();
      if (torn) return;
      dirty = true;
    }
    if (dirty) apply();
  }

  // One live instance per document (slice 15): a newer instance (after an update or a
  // reload of the extension) announces itself, and this one restores the page and stops.
  const instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  function onHandoff(e) {
    if (e.detail !== instanceId) teardown();
  }

  function teardown() {
    if (torn) return;
    torn = true;
    clearTimeout(flushTimer);
    clearTimeout(recheckTimer);
    pending.clear();
    observer?.disconnect();
    indexes = null;
    unwrapAll();
    popover?.destroy();
    document.removeEventListener("kotiko:handoff", onHandoff);
    try {
      ext.storage.onChanged.removeListener(onStorage);
      ext.runtime.onMessage.removeListener(onMessage);
    } catch {
      // the old extension context is gone
    }
  }

  async function init() {
    state = await ext.storage.local.get(state);
    configureSpeech();
    popover = globalThis.KotikoPopover.createPopover({ infoFor });
    popover.install();
    ext.runtime.onMessage.addListener(onMessage);
    await decidePage();
    if (torn) return;
    observer = new MutationObserver(onMutations);
    apply();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    ext.storage.onChanged.addListener(onStorage);

    // Pick up words added from Telegram since the last sync.
    ext.runtime.sendMessage({ type: "sync" }).catch(() => {});
  }

  document.dispatchEvent(new CustomEvent("kotiko:handoff", { detail: instanceId }));
  document.addEventListener("kotiko:handoff", onHandoff);
  unwrapLegacy();
  if (document.body) init();
})();
