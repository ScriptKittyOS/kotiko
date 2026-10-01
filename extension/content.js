// Replaces English words on the page with the words you've marked as known.
// Hover a swapped word to see the English, romanization and note.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const MARK = "slovo-w";
  const SKIP = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION",
    "CODE", "PRE", "KBD", "SAMP", "SVG", "MATH", "CANVAS", "IFRAME", "TITLE",
  ]);
  const host = location.hostname;

  let state = { words: [], enabled: true, pausedHosts: [] };
  let matcher = null;
  let observer = null;
  const pending = new Set();
  let flushTimer = null;

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

  function buildMatcher(words) {
    const map = new Map();
    for (const w of words) {
      for (const f of w.forms?.length ? w.forms : [w.english]) {
        const k = norm(f || "");
        if (k && !map.has(k)) map.set(k, w); // server sends newest first; newest wins
      }
    }
    if (!map.size) return null;
    const alts = [...map.keys()]
      .sort((a, b) => b.length - a.length)
      .map((k) => escapeRe(k).replace(/ /g, "\\s+"));
    return { re: new RegExp(`\\b(?:${alts.join("|")})\\b`, "gi"), map };
  }

  function matchCase(src, out) {
    if (src.length > 1 && /[A-Z]/.test(src) && src === src.toUpperCase()) return out.toUpperCase();
    if (/^[A-Z]/.test(src)) return out.charAt(0).toUpperCase() + out.slice(1);
    return out;
  }

  function tooltip(en, w) {
    const head = w.romanization ? `${en}  (${w.romanization})` : en;
    return w.note ? `${head}\n${w.note}` : head;
  }

  function processText(node) {
    const text = node.nodeValue;
    if (!text || text.length < 2 || !node.parentNode) return;
    const { re, map } = matcher;
    re.lastIndex = 0;
    if (!re.test(text)) return;
    re.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      const w = map.get(norm(m[0]));
      if (!w) continue;
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement("span");
      span.className = MARK;
      span.dataset.en = m[0];
      span.lang = w.lang;
      span.title = tooltip(m[0], w);
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
    matcher = on ? buildMatcher(state.words || []) : null;
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
    state = await ext.storage.local.get({ words: [], enabled: true, pausedHosts: [] });
    observer = new MutationObserver(onMutations);
    apply();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      let dirty = false;
      for (const k of ["words", "enabled", "pausedHosts"]) {
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
