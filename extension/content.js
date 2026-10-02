// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Replaces English words on the page with the words you've marked as known, in every
// language you haven't hidden. When several languages know the same English word, the
// page rotates between them. Hover a swapped word to see the English and all of them.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const { buildMatcher, matchCase, norm, tooltip, skipLetter } = globalThis.KotikoMatcher; // lib/matcher.js
  const { createControlCheck } = globalThis.KotikoControls; // lib/controls.js
  const MARK = "kotiko-w";
  const SKIP = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION",
    "CODE", "PRE", "KBD", "SAMP", "SVG", "MATH", "CANVAS", "IFRAME", "TITLE",
  ]);
  const host = location.hostname;

  let state = { words: [], enabled: true, pausedHosts: [], hiddenLangs: [] };
  let matcher = null;
  let observer = null;
  const pending = new Set();
  let flushTimer = null;

  // Buttons, toggles, menus and forms stay as the site wrote them (lib/controls.js).
  const controls = createControlCheck((el) => getComputedStyle(el).cursor);

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
    while (s?.nodeType === 1 && !s.classList.contains(MARK)) {
      if (!inline(s)) return "";
      crossed = true;
      s = before ? s.lastChild : s.firstChild;
    }
    if (!s) return "";
    const t = s.nodeType === 3 ? s.nodeValue : s.nodeType === 1 ? s.dataset.en ?? "" : "";
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
      const span = document.createElement("span");
      span.className = MARK;
      span.dataset.en = m[0];
      span.lang = w.lang;
      span.dir = "auto"; // isolates right-to-left words (Arabic, Hebrew) from the English around them
      span.title = tooltip(m[0], w, all);
      span.textContent = matchCase(m[0], w.native);
      frag.appendChild(span);
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
      if (SKIP.has(el.nodeName.toUpperCase()) || el.isContentEditable || el.classList?.contains(MARK)) {
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
        if (SKIP.has(n.nodeName.toUpperCase()) || n.isContentEditable || n.classList.contains(MARK)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });
    const nodes = [];
    while (tw.nextNode()) nodes.push(tw.currentNode);
    processTexts(nodes);
  }

  function unwrapAll(selector = `span.${MARK}`) {
    const parents = new Set();
    document.querySelectorAll(selector).forEach((span) => {
      if (span.parentNode) parents.add(span.parentNode);
      span.replaceWith(document.createTextNode(span.dataset.en ?? span.textContent));
    });
    parents.forEach((p) => p.normalize());
  }

  function apply() {
    unwrapAll();
    controls.reset();
    const on = state.enabled && !(state.pausedHosts || []).includes(host);
    matcher = on ? buildMatcher(state.words || [], new Set(state.hiddenLangs || [])) : null;
    if (matcher) walk(document.body);
    observer?.takeRecords(); // ignore the mutations we just caused
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
    if (!matcher) return;
    for (const r of records) {
      if (r.type === "characterData") pending.add(r.target);
      for (const n of r.addedNodes) {
        if (n.nodeType === 1 && n.classList.contains(MARK)) continue;
        pending.add(n);
      }
    }
    if (pending.size && !flushTimer) flushTimer = setTimeout(flush, 250);
  }

  async function init() {
    state = await ext.storage.local.get(state);
    observer = new MutationObserver(onMutations);
    apply();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      let dirty = false;
      for (const k of ["words", "enabled", "pausedHosts", "hiddenLangs"]) {
        if (changes[k]) {
          state[k] = changes[k].newValue ?? state[k];
          dirty = true;
        }
      }
      if (dirty) apply();
    });

    // Pick up words added from Telegram since the last sync.
    ext.runtime.sendMessage({ type: "sync" }).catch(() => {});
  }

  // Tabs open during the update still have spans from the content script before the
  // rename; put the page's own text back first. Remove in the next release.
  unwrapAll("span.slovo-w"); // legacy-name-ok
  if (document.body) init();
})();
