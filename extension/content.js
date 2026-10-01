// Replaces English words on the page with the words you've marked as known, in every
// language you haven't hidden. When several languages know the same English word, the
// page rotates between them. Hover a swapped word to see the English and all of them.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
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

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

  let names = null;
  function languageName(w) {
    if (w.language) return w.language;
    try {
      names ??= new Intl.DisplayNames(["en"], { type: "language" });
      return names.of(w.lang);
    } catch {
      return w.lang;
    }
  }

  // English form -> candidate words, at most one per language.
  function buildMatcher(words, hidden) {
    const map = new Map();
    for (const w of words) {
      if (hidden.has(w.lang)) continue;
      for (const f of w.forms?.length ? w.forms : [w.english]) {
        const k = norm(f || "");
        if (!k) continue;
        const list = map.get(k) ?? map.set(k, []).get(k);
        // server sends newest first; newest wins within a language
        if (!list.some((c) => c.lang === w.lang)) list.push(w);
      }
    }
    if (!map.size) return null;
    const alts = [...map.keys()]
      .sort((a, b) => b.length - a.length)
      .map((k) => escapeRe(k).replace(/ /g, "\\s+"));
    // turns: how many times each English word has been swapped, to rotate its languages
    return { re: new RegExp(`\\b(?:${alts.join("|")})\\b`, "gi"), map, turns: new Map() };
  }

  function matchCase(src, out) {
    if (src.length > 1 && /[A-Z]/.test(src) && src === src.toUpperCase()) return out.toUpperCase();
    if (/^[A-Z]/.test(src)) return out.charAt(0).toUpperCase() + out.slice(1);
    return out;
  }

  function describe(w) {
    const name = languageName(w);
    return w.romanization ? `${w.native} (${w.romanization}) · ${name}` : `${w.native} · ${name}`;
  }

  function tooltip(en, w, all) {
    const lines = [`${en} = ${describe(w)}`];
    if (w.note) lines.push(w.note);
    const others = all.filter((c) => c !== w);
    if (others.length) lines.push("", ...others.map(describe));
    return lines.join("\n");
  }

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
