// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Replaces English words on the page with the words you've marked as known, in every
// language you haven't hidden. When several languages know the same English word, the
// page rotates between them. Point at, click, tap or use the "Show details" shortcut on a
// swapped word to see the word card (content/popover.js, slice 19).
//
// Each swap is a <kotiko-w> element carrying only lang, dir, translate="no" and the
// notranslate class (slice 15). The original text, the word and its candidates live in a
// WeakMap here, which page scripts can't reach: no title, no data-* attributes.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const { buildMatcher, matchCase, norm, skipLetter } = globalThis.KotikoMatcher; // lib/matcher.js
  const { createControlCheck } = globalThis.KotikoControls; // lib/controls.js
  const MARK = "kotiko-w";
  const SKIP = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION",
    "CODE", "PRE", "KBD", "SAMP", "SVG", "MATH", "CANVAS", "IFRAME", "TITLE",
  ]);
  const host = location.hostname;
  const isMark = (n) => n?.nodeType === 1 && n.localName === MARK;

  let state = { words: [], enabled: true, pausedHosts: [], hiddenLangs: [], speech: null };
  let matcher = null;
  let observer = null;
  let popover = null;
  let torn = false;
  const pending = new Set();
  let flushTimer = null;
  // <kotiko-w> -> { surface, word, all }: the page's own text, the word shown and every
  // candidate for that English form (slice 15's SwapInfo, reduced to what exists today).
  let info = new WeakMap();

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

  function hasMatch(node) {
    const text = node.nodeValue;
    if (!text || text.length < 2 || !node.parentNode) return false;
    matcher.re.lastIndex = 0;
    const found = matcher.re.test(text);
    matcher.re.lastIndex = 0;
    return found;
  }

  // Up to 40 characters of the text just before or after `node` in the same line of text:
  // from a sibling, or the parent's sibling when the parent is inline (two levels at
  // most), never across a block: "<b>AOI</b> I", "<span>AOI</span><span>I</span>".
  // Element boundaries count as a space.
  const INLINE = new Set([
    "A", "ABBR", "B", "BDI", "BDO", "CITE", "DFN", "EM", "FONT", "I", "MARK", "Q", "S", "SMALL",
    "SPAN", "STRONG", "SUB", "SUP", "TIME", "U",
  ]);
  const inline = (n) => INLINE.has(n?.nodeName.toUpperCase());

  function neighbourText(node, dir) {
    const before = dir === "previousSibling";
    let n = node;
    for (let up = 0; up < 2 && !n[dir] && inline(n.parentNode); up++) n = n.parentNode;
    let s = n[dir];
    let crossed = n !== node;
    while (s?.nodeType === 1 && !isMark(s)) {
      if (!inline(s)) return "";
      crossed = true;
      s = before ? s.lastChild : s.firstChild;
    }
    if (!s) return "";
    const t = s.nodeType === 3 ? s.nodeValue : isMark(s) ? info.get(s)?.surface ?? "" : "";
    const part = before ? t.slice(-40) : t.slice(0, 40);
    if (!crossed) return part;
    return before ? `${part} ` : ` ${part}`;
  }

  function swapText(node) {
    const text = node.nodeValue;
    const { re, map, turns } = matcher;
    re.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    let ctx = null;
    while ((m = re.exec(text))) {
      const all = map.get(norm(m[0]));
      if (!all) continue;
      if (m[0].length === 1 && m[0] !== m[0].toLowerCase()) {
        ctx ??= { before: neighbourText(node, "previousSibling"), after: neighbourText(node, "nextSibling") };
        if (skipLetter(ctx.before + text + ctx.after, ctx.before.length + m.index)) continue;
      }
      const turn = turns.get(all) ?? 0;
      turns.set(all, turn + 1);
      const w = all[turn % all.length];
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const el = document.createElement(MARK);
      el.lang = w.lang; // screen-reader voice and Han glyphs
      el.dir = "auto"; // isolates right-to-left words (Arabic, Hebrew) from the text around them
      el.setAttribute("translate", "no"); // machine translation leaves the word alone (43)
      el.className = "notranslate";
      el.textContent = matchCase(m[0], w.native);
      info.set(el, { surface: m[0], word: w, all });
      frag.appendChild(el);
      last = m.index + m[0].length;
    }
    if (last === 0) return;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  // Reads first, then writes: the control check may read computed styles, and reading
  // them between our own DOM changes would make the browser recalculate styles each time.
  // Only text nodes with a match are checked.
  function processTexts(nodes) {
    const todo = nodes.filter((n) => hasMatch(n) && !controls.inControl(n.parentElement));
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
    if (!matcher || !root || insideSkipped(root)) return;
    if (root.nodeType === Node.TEXT_NODE) return processTexts([root]);
    if (root.nodeType !== Node.ELEMENT_NODE) return;

    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (SKIP.has(n.nodeName.toUpperCase()) || n.isContentEditable || isMark(n)) {
          return NodeFilter.FILTER_REJECT;
        }
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
    const on = state.enabled && !(state.pausedHosts || []).includes(host);
    matcher = on ? buildMatcher(state.words || [], new Set(state.hiddenLangs || [])) : null;
    if (matcher) walk(document.body);
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
    if (!matcher) return pending.clear();
    const nodes = [...pending];
    pending.clear();
    for (const n of nodes) if (n.isConnected) walk(n);
    observer.takeRecords();
  }

  function onMutations(records) {
    if (!contextValid()) return teardown();
    if (!matcher) return;
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

  // Messages from Kotiko's background only (slice 26): a sender of this extension with no
  // tab. Other content scripts can't message this one directly.
  function onMessage(msg, sender) {
    if (torn || !msg || typeof msg !== "object" || sender?.id !== ext.runtime.id || sender.tab) return undefined;
    if (msg.type === "reveal-word") {
      popover.reveal();
      return undefined;
    }
    if (msg.type === "toast" && typeof msg.message === "string" && msg.message.length <= 300) {
      popover.toast(msg.message);
    }
    return undefined;
  }

  function onStorage(changes, area) {
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
    pending.clear();
    observer?.disconnect();
    matcher = null;
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
    observer = new MutationObserver(onMutations);
    apply();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    ext.storage.onChanged.addListener(onStorage);
    ext.runtime.onMessage.addListener(onMessage);

    // Pick up words added from Telegram since the last sync.
    ext.runtime.sendMessage({ type: "sync" }).catch(() => {});
  }

  document.dispatchEvent(new CustomEvent("kotiko:handoff", { detail: instanceId }));
  document.addEventListener("kotiko:handoff", onHandoff);
  unwrapLegacy();
  if (document.body) init();
})();
