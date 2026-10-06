// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Framework-safe swapping (slice 15): changes the page's words without taking text nodes
// away from the site. React, Vue and the rest keep references to their text nodes; Kotiko
// leaves each one in place holding the text before its first swapped word, and puts the
// swapped words and the rest of the text in nodes of its own right after it. Nothing is
// merged (no normalize()), detached or replaced. One observer on the whole document (a
// replaced body, document.open()), small changes swapped before the next paint, big pages
// in 8 ms slices, and budgets that stop Kotiko from fighting a page that keeps undoing its
// changes. What to swap is the caller's: `plan` (content.js) returns the swaps for a text.
//
//   const E = KotikoEngine.create({ plan, skip, onSwap, onStatus });
//   E.start();  E.reapply();  E.unwrapAll();  E.restoreWithin(el);  E.infoFor(el);  E.teardown();
//
//   plan({ text, node, edges }) -> [{ start, end, display, lang, info, read?, tab? }] sorted, or []
//     read: what screen readers hear instead of the word (27 §2), parts in order, each
//     { text, lang } or a plain string: the word shows inside aria-hidden <kotiko-v> and
//     the parts go in a visually hidden <kotiko-sr>. tab: the word is a Tab stop (27 §2).
//     edges() -> { before, after }: up to 16 characters of neighbouring inline text, or
//     U+2029 at a block boundary (slice 14's ctx).
//   skip(element) -> true when the element's text must be left alone (slice 16); asked for
//     every element the walk meets, so the caller caches it.
//   afterSlice() -> nodes to look at again (slice 16's settled deferrals), or nothing.
(() => {
  const MARK = "kotiko-w";
  const BLOCK = String.fromCharCode(0x2029);
  const SLICE_MS = 8;
  const BATCH = 50;
  const SYNC_CHARS = 20_000;
  const REVERTS = { max: 5, ms: 10_000 };
  const CHURN = { max: 30, ms: 60_000 };
  const STAND_DOWN = { max: 200, ms: 10_000 };
  const HYDRATION = { quiet: 500, max: 3000 };
  const BIG_PAGE = 5000;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE", "KBD", "SAMP", "SVG", "MATH", "CANVAS", "IFRAME", "TITLE", "TEMPLATE", "HEAD"]);
  const INLINE = new Set(["A", "ABBR", "B", "BDI", "BDO", "CITE", "DATA", "DEL", "DFN", "EM", "FONT", "I", "INS", "MARK", "Q", "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "WBR"]);
  const HYDRATION_MARKERS = "#__next, [data-reactroot], #__nuxt, [data-sveltekit-hydrated], [ng-version], [data-server-rendered]";

  function create({ plan, skip = () => false, afterSlice = () => null, onSwap = () => {}, onStatus = () => {}, doc = globalThis.document, now = () => performance.now(), clock = () => Date.now(), contextValid = () => true }) {
    const win = doc.defaultView ?? globalThis;
    const isMark = (n) => n?.nodeType === 1 && n.localName === MARK;
    // Kotiko's nodes: the text after a swapped word, and the swaps themselves.
    let owned = new WeakSet();
    // Site text node -> { original, prefix, nodes, sig }; `swapped` holds the same nodes so
    // a re-apply can visit them (pruned of nodes the site removed).
    let swaps = new WeakMap();
    let swapped = new Set();
    // <kotiko-w> -> the caller's info, plus the site node it came from.
    let info = new WeakMap();
    // Budgets (06 F08): per element, the site's reverts and text changes; elements past
    // them are left alone for the rest of the page's life.
    const budgets = new WeakMap();
    const volatile = new WeakSet();
    let pageReverts = [];
    let status = "idle";
    let observer = null;
    let torn = false;
    // Roots to walk, taken from `head` on (shift() is linear in the queue's length, and a
    // big page can queue thousands of roots).
    const queue = [];
    let head = 0;
    const pending = () => queue.length - head;
    function take() {
      if (head >= queue.length) {
        queue.length = head = 0;
        return undefined;
      }
      const root = queue[head];
      queue[head++] = undefined;
      if (head > 1024 && head * 2 > queue.length) {
        queue.splice(0, head);
        head = 0;
      }
      return root;
    }
    let walking = null;
    let scheduled = false;
    let dirty = false;
    let hydrating = null;

    // ── swapping one site text node in place ──────────────────────────────

    function ownText(s) {
      const t = doc.createTextNode(s);
      owned.add(t);
      return t;
    }

    const signature = (items) => JSON.stringify(items.map((m) => [m.start, m.end, m.display, m.lang, m.read ?? null, !!m.tab]));

    function swap(T, original, items) {
      const frag = doc.createDocumentFragment();
      let cursor = items[0].start;
      for (const m of items) {
        if (m.start > cursor) frag.append(ownText(original.slice(cursor, m.start)));
        const el = doc.createElement(MARK);
        el.lang = m.lang;
        el.dir = "auto"; // isolates right-to-left words from the text around them
        el.setAttribute("translate", "no"); // machine translation leaves the word alone (43)
        el.className = "notranslate";
        if (m.tab) el.tabIndex = 0;
        if (m.read) {
          // Custom elements, so the page's own CSS for span can't reach them.
          const shown = doc.createElement("kotiko-v");
          shown.setAttribute("aria-hidden", "true");
          shown.textContent = m.display;
          const heard = doc.createElement("kotiko-sr");
          for (const p of m.read) {
            if (typeof p === "string") heard.append(p);
            else {
              const part = doc.createElement("kotiko-l");
              part.lang = p.lang;
              part.textContent = p.text;
              heard.append(part);
            }
          }
          el.append(shown, heard);
        } else el.textContent = m.display;
        owned.add(el);
        info.set(el, { ...m.info, T });
        frag.append(el);
        cursor = m.end;
      }
      if (cursor < original.length) frag.append(ownText(original.slice(cursor)));
      const nodes = [...frag.childNodes];
      const prefix = original.slice(0, items[0].start);
      if (T.data !== prefix) T.data = prefix;
      T.parentNode.insertBefore(frag, T.nextSibling);
      swaps.set(T, { original, prefix, nodes, sig: signature(items) });
      swapped.add(T);
      onSwap(T, items);
    }

    // Kotiko's nodes for T go; T gets its text back if the site hasn't changed it since.
    function restore(T) {
      const r = swaps.get(T);
      if (!r) return;
      for (const n of r.nodes) n.remove();
      if (T.isConnected && T.data === r.prefix) T.data = r.original;
      swaps.delete(T);
      swapped.delete(T);
    }

    function dropNodes(T) {
      const r = swaps.get(T);
      if (!r) return;
      for (const n of r.nodes) n.remove();
      swaps.delete(T);
      swapped.delete(T);
    }

    // The text the site meant for T: its original when Kotiko swapped it.
    const siteText = (T) => swaps.get(T)?.original ?? T.data;

    // ── what to visit ─────────────────────────────────────────────────────

    function skipped(el) {
      for (let e = el; e; e = e.parentElement) {
        if (volatile.has(e) || isMark(e) || SKIP_TAGS.has(e.nodeName.toUpperCase()) || e.isContentEditable || e.localName === "kotiko-popover") return true;
      }
      return false;
    }

    // The caller's rules for an element or any of its ancestors (a text node added inside a
    // code editor, a language island).
    function skippedByCaller(el) {
      for (let e = el; e && e !== doc.documentElement; e = e.parentElement) if (skip(e)) return true;
      return false;
    }

    function* textsUnder(root) {
      if (root.nodeType === 3) {
        if (!owned.has(root) && root.parentElement && !skipped(root.parentElement) && !skippedByCaller(root.parentElement)) yield root;
        return;
      }
      if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
      if (root.nodeType === 1 && (skipped(root) || skippedByCaller(root))) return;
      const tw = doc.createTreeWalker(root, win.NodeFilter.SHOW_ELEMENT | win.NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (n.nodeType === 3) return owned.has(n) ? win.NodeFilter.FILTER_SKIP : win.NodeFilter.FILTER_ACCEPT;
          if (owned.has(n) || isMark(n) || volatile.has(n) || SKIP_TAGS.has(n.nodeName.toUpperCase()) || n.isContentEditable || n.localName === "kotiko-popover") return win.NodeFilter.FILTER_REJECT;
          // The caller's rules: a language the learner doesn't read, a code editor, a login
          // form (slice 16).
          if (skip(n)) return win.NodeFilter.FILTER_REJECT;
          return win.NodeFilter.FILTER_SKIP;
        },
      });
      while (tw.nextNode()) yield tw.currentNode;
    }

    // Up to 16 characters of the site's text just before or after T in the same inline run,
    // or U+2029 at a block or skipped boundary (slice 14's edges). The run goes straight
    // through inline elements, adding nothing: "hot<wbr>dog" and "do<span>g</span>" are one
    // word each. Kotiko's nodes count as the text they replaced.
    function edge(T, dir) {
      const before = dir === "previousSibling";
      let n = T;
      for (;;) {
        let s = n[dir];
        // Kotiko's nodes after a site node: before T, they stand for that node's text.
        while (s && owned.has(s) && before) s = s[dir];
        while (s && owned.has(s) && !before) s = s[dir];
        if (!s) {
          if (inline(n.parentNode) && n.parentNode !== doc.body) {
            n = n.parentNode;
            continue;
          }
          return BLOCK;
        }
        if (s.nodeType === 3 || (s.nodeType === 1 && inline(s) && !skip(s))) {
          const t = s.nodeType === 3 ? siteText(s) : s.textContent;
          // An empty one (<wbr>, an empty <span>): look past it.
          if (!t) {
            n = s;
            continue;
          }
          return before ? t.slice(-16) : t.slice(0, 16);
        }
        if (s.nodeType === 8) {
          n = s;
          continue;
        }
        return BLOCK;
      }
    }
    const inline = (n) => n?.nodeType === 1 && INLINE.has(n.nodeName.toUpperCase());

    // ── processing ────────────────────────────────────────────────────────

    // Plans for a batch of site text nodes: reads only (the caller may read styles).
    function planFor(T) {
      if (!T.isConnected || !T.parentNode || owned.has(T)) return null;
      if (!T.parentElement) return null;
      const text = siteText(T);
      if (!text || !/[\p{L}\p{N}]/u.test(text)) return null;
      let memo = null;
      const items = plan({ text, node: T, edges: () => (memo ??= { before: edge(T, "previousSibling"), after: edge(T, "nextSibling") }) });
      return { T, text, items: items ?? [] };
    }

    // Writes for a batch: the site's pending records are handled first, Kotiko's own are
    // dropped after.
    function write(plans) {
      if (observer) handle(observer.takeRecords(), { now: false });
      for (const p of plans) {
        if (!p) continue;
        const r = swaps.get(p.T);
        if (r && r.sig === signature(p.items)) {
          // The same words in the same places: nothing to write, but the word behind each
          // (an edited pronunciation, a new note) is the current one.
          for (const [i, el] of r.nodes.filter(isMark).entries()) if (p.items[i]) info.set(el, { ...p.items[i].info, T: p.T });
          continue;
        }
        if (r) restore(p.T);
        if (p.items.length && p.T.isConnected && p.T.data === p.text) swap(p.T, p.text, p.items);
      }
      observer?.takeRecords();
    }

    // ── the queue: roots in document order, run in slices of at most 8 ms ─

    function enqueue(root) {
      if (torn || status === "stood-down") return;
      queue.push(root);
    }

    // Runs queued work until the deadline; true when the queue is empty.
    function run(deadline) {
      for (;;) {
        if (!walking) {
          const root = take();
          if (!root) return true;
          // A root that yields nothing still costs time: the clock is checked after each.
          if (!root.isConnected && root.nodeType !== 9) {
            if (now() >= deadline) return !pending();
            continue;
          }
          walking = textsUnder(root);
        }
        // Plans (reads) for up to 200 nodes or until the deadline, then their writes.
        const plans = [];
        let chars = 0;
        for (;;) {
          const r = walking.next();
          if (r.done) {
            walking = null;
            break;
          }
          plans.push(planFor(r.value));
          chars += r.value.data.length;
          if (plans.length >= BATCH || chars >= SYNC_CHARS || now() >= deadline) break;
        }
        if (plans.length) write(plans);
        if (now() >= deadline) return !walking && !pending();
      }
    }

    // Back to the event loop between slices: scheduler.yield() where there is one, else a
    // message (unclamped, unlike setTimeout), else a timer.
    const Channel = win.MessageChannel ?? globalThis.MessageChannel;
    const yieldNow = () => {
      if (win.scheduler?.yield) return win.scheduler.yield();
      return new Promise((resolve) => {
        if (!Channel) return setTimeout(resolve, 0);
        const ch = new Channel();
        ch.port1.onmessage = () => {
          ch.port1.close();
          resolve();
        };
        ch.port2.postMessage(0);
      });
    };

    function schedule() {
      if (scheduled || torn) return;
      scheduled = true;
      (async () => {
        try {
          for (;;) {
            const done = torn || run(now() + SLICE_MS);
            settle();
            if (done && !walking && !pending()) break;
            await yieldNow();
          }
        } finally {
          scheduled = false;
        }
      })();
    }

    // Small changes are swapped in the observer's callback, before the next paint; anything
    // left after one slice continues time-sliced.
    function flushSoon() {
      if (torn) return;
      const done = run(now() + SLICE_MS);
      settle();
      if (!done) schedule();
    }

    // The caller's deferred decisions are made at the end of each slice; their nodes are
    // looked at again (slice 16).
    function settle() {
      const nodes = afterSlice();
      if (!nodes?.length) return;
      for (const n of nodes) if (n.isConnected) enqueue(n);
      if (!scheduled) schedule();
    }

    // ── observing ─────────────────────────────────────────────────────────

    function budget(el, kind) {
      if (!el) return;
      const t = clock();
      const b = budgets.get(el) ?? { reverts: [], churn: [] };
      const limit = kind === "reverts" ? REVERTS : CHURN;
      b[kind] = b[kind].filter((x) => t - x < limit.ms);
      b[kind].push(t);
      budgets.set(el, b);
      if (b[kind].length > limit.max && !volatile.has(el)) {
        volatile.add(el);
        restoreWithin(el);
      }
      if (kind === "reverts") {
        pageReverts = pageReverts.filter((x) => t - x < STAND_DOWN.ms);
        pageReverts.push(t);
        if (pageReverts.length > STAND_DOWN.max) standDown();
      }
    }

    // The element whose text a record changed, for the budgets.
    const ownerOf = (n) => (n?.nodeType === 1 ? n : n?.parentElement ?? null);

    function handle(records, { now: run_ = true } = {}) {
      let touched = false;
      for (const r of records) {
        if (r.type === "characterData") {
          const t = r.target;
          if (owned.has(t)) continue;
          const rec = swaps.get(t);
          if (rec && t.data === rec.prefix) continue; // Kotiko's own write
          if (rec) {
            dropNodes(t);
            // Putting the original text back undoes the swap; new text is the site's own
            // change (a counter, a re-render), which only the churn budget counts.
            if (t.data === rec.original) budget(ownerOf(t), "reverts");
          }
          budget(ownerOf(t), "churn");
          enqueue(t);
          touched = true;
          continue;
        }
        let undone = false;
        for (const n of r.removedNodes) {
          if (n.nodeType === 3 && swaps.has(n)) dropNodes(n);
          else if ((owned.has(n) || isMark(n)) && r.target.isConnected) undone = true;
        }
        // The site took Kotiko's nodes out: one revert, however many nodes went.
        if (undone) budget(ownerOf(r.target), "reverts");
        for (const n of r.addedNodes) {
          if (owned.has(n) || isMark(n) || n.localName === "kotiko-popover") continue;
          enqueue(n);
          touched = true;
        }
      }
      // Records made while handling these (Kotiko removing its own nodes) are Kotiko's: no
      // page script runs in between, so nothing of the site's is lost.
      observer?.takeRecords();
      if (touched && run_ && !hydrating) flushSoon();
    }

    function onMutations(records) {
      if (!contextValid()) return teardown();
      if (hydrating) {
        hydrating.quiet();
        return;
      }
      handle(records);
    }

    function standDown() {
      if (status === "stood-down") return;
      unwrapAll();
      observer?.disconnect();
      queue.length = head = 0;
      walking = null;
      status = "stood-down";
      onStatus(status);
    }

    // ── the public surface ────────────────────────────────────────────────

    // Starts observing and swaps the page: after a framework's hydration settles, and the
    // first viewport first on big pages.
    function start() {
      if (torn) return;
      status = "running";
      observer = new win.MutationObserver(onMutations);
      observer.observe(doc, { childList: true, subtree: true, characterData: true });
      if (doc.querySelector(HYDRATION_MARKERS)) {
        hydrating = waitQuiet(() => {
          hydrating = null;
          initialPass();
        });
      } else initialPass();
      doc.addEventListener("visibilitychange", onVisibility);
    }

    function waitQuiet(done) {
      const started = clock();
      let timer = null;
      const fire = () => {
        clearTimeout(timer);
        done();
      };
      const arm = () => {
        clearTimeout(timer);
        const left = HYDRATION.max - (clock() - started);
        timer = setTimeout(fire, Math.max(0, Math.min(HYDRATION.quiet, left)));
      };
      arm();
      return { quiet: arm, cancel: () => clearTimeout(timer) };
    }

    function initialPass() {
      if (torn || status !== "running") return;
      const body = doc.body ?? doc.documentElement;
      if (body && body.getElementsByTagName("*").length > BIG_PAGE) {
        const first = viewportRoot();
        if (first) enqueue(first);
      }
      enqueue(doc);
      flushSoon();
    }

    // The block around the middle of the viewport, so the first screen is done first.
    function viewportRoot() {
      let el = doc.elementFromPoint?.((win.innerWidth || 0) / 2, (win.innerHeight || 0) / 2);
      while (el && el !== doc.body) {
        if (/^(ARTICLE|MAIN|SECTION)$/.test(el.nodeName) || el.getElementsByTagName("*").length >= 20) return el;
        el = el.parentElement;
      }
      return null;
    }

    // Words or settings changed: rewrite only the swaps whose plan changed, then look for
    // new matches. In a hidden tab the work waits until the tab is shown (03 C3).
    function reapply() {
      if (torn || status !== "running") return;
      if (doc.hidden) {
        dirty = true;
        return;
      }
      dirty = false;
      for (const T of swapped) if (!T.isConnected) dropNodes(T);
      // One time-sliced walk: swapped nodes whose plan is unchanged are left as they are
      // (write() compares signatures), the rest are rewritten, and new matches are made.
      enqueue(doc);
      flushSoon();
    }

    function onVisibility() {
      if (!doc.hidden && dirty) reapply();
    }

    // Puts the page's own text back everywhere; swaps whose site node is gone become text.
    function unwrapAll() {
      observer?.takeRecords();
      for (const T of [...swapped]) restore(T);
      for (const el of doc.querySelectorAll(MARK)) {
        const i = info.get(el);
        if (!i) continue;
        el.before(ownText(i.surface ?? el.textContent));
        el.remove();
      }
      observer?.takeRecords();
    }

    // Restores the swaps inside `el` (an editor that just got focus, an element past its
    // budget).
    function restoreWithin(el) {
      observer?.takeRecords();
      for (const T of [...swapped]) if (el.contains(T)) restore(T);
      observer?.takeRecords();
    }

    function teardown() {
      if (torn) return;
      hydrating?.cancel();
      unwrapAll();
      torn = true;
      observer?.disconnect();
      queue.length = head = 0;
      walking = null;
      doc.removeEventListener("visibilitychange", onVisibility);
      status = "torn";
    }

    // Clears every swap and starts over (the word list or the page's language changed).
    function reset() {
      unwrapAll();
      owned = new WeakSet();
      swaps = new WeakMap();
      swapped = new Set();
      info = new WeakMap();
    }

    return {
      start,
      reapply,
      reset,
      unwrapAll,
      restoreWithin,
      teardown,
      infoFor: (el) => info.get(el) ?? null,
      status: () => status,
      isOwned: (n) => owned.has(n) || isMark(n),
      // For tests and slices 32, 35 and 46: the site nodes Kotiko swapped right now.
      swappedNodes: () => [...swapped].filter((T) => T.isConnected),
    };
  }

  const api = { create, MARK };
  globalThis.KotikoEngine = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
