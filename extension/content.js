// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
// SPDX-License-Identifier: Apache-2.0

// Replaces English words on the page with the words you've marked as known, in every
// language you haven't hidden. When several languages know the same English word, the
// page rotates between them. Hover a swapped word to see the English and all of them.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const { buildMatcher, matchCase, norm, tooltip } = globalThis.MiraMatcher; // lib/matcher.js
  const MARK = "slovo-w";
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

  function processText(node) {
    const text = node.nodeValue;
    if (!text || text.length < 2 || !node.parentNode) return;
    const { re, map, turns } = matcher;
    re.lastIndex = 0;
    if (!re.test(text)) return;
    re.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      const all = map.get(norm(m[0]));
      if (!all) continue;
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
    if (root.nodeType === Node.TEXT_NODE) return processText(root);
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
    nodes.forEach(processText);
  }

  function unwrapAll() {
    const parents = new Set();
    document.querySelectorAll(`span.${MARK}`).forEach((span) => {
      if (span.parentNode) parents.add(span.parentNode);
      span.replaceWith(document.createTextNode(span.dataset.en));
    });
    parents.forEach((p) => p.normalize());
  }

  function apply() {
    unwrapAll();
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

  if (document.body) init();
})();
