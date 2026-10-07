// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The word popover and the in-page toast (slice 19). One `<kotiko-popover>` host per page,
// created on first use, with a closed shadow root in the top layer; page scripts can't read
// what is inside. It opens on hover intent, click, tap, a long press inside links, Enter on
// a focused word and the "Show details" command, and shows the word's pronunciation block
// (with 34's speak button), meaning and other candidates in Kotiko's interface language.
//
//   const pop = KotikoPopover.createPopover({ infoFor, isWord, ... });
//   pop.install();            delegated listeners on document (capture phase)
//   pop.openFor(el, "click")  open on a swapped word
//   pop.reveal()              the keyboard command: the word in the selection or focus
//   pop.toast("Saved.")       the standalone toast
//   pop.destroy()
//
// Nothing here writes word data into the page DOM: the content comes from `infoFor(el)`,
// the content script's WeakMap entry for the swapped element (slice 15).
(() => {
  const HOST_TAG = "kotiko-popover";
  const WORD_TAG = "kotiko-w";
  const HOVER_MS = 300; // 19 open question 1
  const STILL_PX = 4; // hover intent: moved less than this…
  const STILL_WINDOW_MS = 100; // …in the last 100 ms
  const LEAVE_MS = 200;
  const LONG_PRESS_MS = 500;
  const TOAST_MS = 6000;
  const TOAST_ACTION_MS = 10_000;
  const GAP = 10; // word to card: the 6 px arrow plus air
  const EDGE = 8; // clamp from viewport edges
  const HOST_STYLE = [
    "all: initial !important",
    "position: fixed !important",
    "inset: 0 auto auto 0 !important",
    "display: block !important",
    "width: 0 !important",
    "height: 0 !important",
    "margin: 0 !important",
    "padding: 0 !important",
    "border: 0 !important",
    "background: transparent !important",
    "overflow: visible !important",
    "visibility: visible !important",
    "opacity: 1 !important",
    "z-index: 2147483647 !important",
  ].join("; ");

  // --- Placement (19 §4) --------------------------------------------------------------
  // anchor: the word's first line box; size: the card; view: the viewport.
  // -> { x, y, side: "below" | "above", arrowX }
  function place(anchor, size, view, { gap = GAP, edge = EDGE } = {}) {
    const w = Math.min(size.width, view.width - 2 * edge);
    const center = anchor.left + anchor.width / 2;
    const x = Math.round(Math.max(edge, Math.min(center - w / 2, view.width - w - edge)));
    const below = view.height - anchor.bottom - gap - edge;
    const above = anchor.top - gap - edge;
    const side = below >= size.height || below >= above ? "below" : "above";
    let y = side === "below" ? anchor.bottom + gap : anchor.top - gap - size.height;
    y = Math.round(Math.max(edge, Math.min(y, view.height - size.height - edge)));
    const arrowX = Math.round(Math.max(16, Math.min(center - x, w - 16)));
    return { x, y, side, arrowX };
  }

  // --- Theme (19 §5) -----------------------------------------------------------------
  // "rgb(1, 2, 3)", "rgba(1 2 3 / 0.5)" -> [1, 2, 3, 0.5]; null when it can't be read.
  function parseColor(s) {
    const m = String(s ?? "").match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
    if (!m) return s === "transparent" ? [0, 0, 0, 0] : null;
    let a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (m[4]?.endsWith("%")) a /= 100;
    return [Number(m[1]), Number(m[2]), Number(m[3]), a];
  }

  // WCAG relative luminance of an sRGB color (0-255 channels).
  function luminance([r, g, b]) {
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  // The popover follows the page, not the OS: the nearest ancestor with a background
  // decides (luminance under 0.2 is dark). Memoized per element for the page view.
  function createThemeDetector(win) {
    let cache = new WeakMap();
    const prefersDark = () => {
      try {
        return win.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
      } catch {
        return false;
      }
    };
    try {
      win.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => (cache = new WeakMap()));
    } catch {
      // no media query events
    }
    function fallback(doc) {
      // Every ancestor transparent: the page shows the browser's canvas, dark only when the
      // page allows a dark scheme and the system prefers it.
      let scheme = "";
      try {
        scheme = win.getComputedStyle(doc.documentElement).colorScheme || "";
      } catch {
        // ignore
      }
      if (!scheme || scheme === "normal") scheme = doc.querySelector('meta[name="color-scheme"]')?.getAttribute("content") ?? "";
      const dark = /\bdark\b/.test(scheme);
      const light = /\blight\b/.test(scheme);
      return dark && (!light || prefersDark()) ? "dark" : "light";
    }
    return function themeFor(el) {
      const walked = [];
      let theme = null;
      for (let e = el?.nodeType === 1 ? el : el?.parentElement; e; e = e.parentElement) {
        if (cache.has(e)) {
          theme = cache.get(e);
          break;
        }
        walked.push(e);
        let bg;
        try {
          bg = parseColor(win.getComputedStyle(e).backgroundColor);
        } catch {
          bg = null;
        }
        if (bg && bg[3] >= 0.5) {
          theme = luminance(bg) < 0.2 ? "dark" : "light";
          break;
        }
      }
      theme ??= fallback(el.ownerDocument ?? win.document);
      for (const e of walked) cache.set(e, theme);
      return theme;
    };
  }

  // --- The popover --------------------------------------------------------------------
  function createPopover(opts) {
    const {
      doc = globalThis.document,
      win = globalThis.window ?? globalThis,
      infoFor, // (el) -> { word, all, others, surface } | null
      i18n = globalThis.KotikoI18n,
      card: cards = globalThis.KotikoWordCard,
      icons = globalThis.KotikoIcons,
      style = globalThis.KotikoPopoverStyle,
      speak = globalThis.KotikoSpeak,
      actions = [], // [{ id, label: (info) => string, visible?: (info) => bool, run: (info, pop) => void }]
      // Kotiko's own "Reduce motion" setting (27 §4); the system's preference is a media query.
      reduceMotion = () => false,
      now = () => (win.performance?.now?.() ?? Date.now()),
    } = opts;
    const setT = (f, ms) => win.setTimeout(f, ms);
    const clearT = (id) => id && win.clearTimeout(id);
    const t = (key, params) => i18n.t(key, params);
    const themeFor = createThemeDetector(win);

    let host = null;
    let shadow = null;
    let root = null;
    let cardEl = null;
    let arrowEl = null;
    let scrollEl = null;
    let toastEl = null;
    let speakBtn = null;
    let installed = false;
    let open = null; // { el, info, mode, pinned, keyboard, restore, ranges, side }
    let renderToken = 0;
    let hover = null; // { el, samples, timer }
    let leaveTimer = 0;
    let press = null; // { el, x, y, timer }
    let longPressed = null; // { el, at }
    let toastState = null; // { timer, paused, remaining, started }
    let rafId = 0;

    const isWord = (n) => n?.nodeType === 1 && n.localName === WORD_TAG;
    const wordFrom = (n) => {
      for (let e = n?.nodeType === 1 ? n : n?.parentElement; e; e = e.parentElement) {
        if (isWord(e)) return e;
        if (e === host) return null;
      }
      return null;
    };
    const inHost = (n) => !!host && (n === host || host.contains?.(n));
    const inLinkOrButton = (el) => !!el.closest?.("a[href], area[href], button, [role=button], [role=link], summary, label");
    const editable = (el) => !!(el?.isContentEditable || el?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable=true]"));

    function node(tag, attrs = {}, ...children) {
      const el = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else el.setAttribute(k, v === true ? "" : String(v));
      }
      for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
      return el;
    }

    // A word in its own language and direction, isolated from the text around it.
    const bdi = (text, lang, cls) => node("bdi", { lang, dir: "auto", class: cls }, text);

    function ensureHost() {
      if (host?.isConnected) return;
      host = doc.createElement(HOST_TAG);
      host.setAttribute("translate", "no");
      host.setAttribute("style", HOST_STYLE);
      if (typeof host.showPopover === "function") host.setAttribute("popover", "manual");
      shadow = host.attachShadow({ mode: "closed" });
      style.adopt(shadow, doc);
      root = node("div", { class: "k-root", lang: i18n.locale(), dir: i18n.dir() });
      arrowEl = node("div", { class: "k-arrow", "aria-hidden": "true" });
      scrollEl = node("div", { class: "k-scroll" });
      cardEl = node("div", { class: "k-card", role: "dialog", tabindex: "-1", hidden: true }, arrowEl, scrollEl);
      toastEl = node("div", { class: "k-toast", role: "status", "aria-live": "polite" });
      root.append(cardEl, toastEl);
      shadow.append(root);
      // Tab cycles inside the popover; the shadow root sees focus moves the page can't.
      shadow.addEventListener("keydown", onShadowKeydown);
      toastEl.addEventListener("pointerenter", () => pauseToast(true));
      toastEl.addEventListener("pointerleave", () => pauseToast(false));
      toastEl.addEventListener("focusin", () => pauseToast(true));
      toastEl.addEventListener("focusout", () => pauseToast(false));
      // documentElement, not body: some sites replace <body>.
      doc.documentElement.append(host);
    }

    // In the top layer while the card or the toast shows; re-shown on each open so it sits
    // above anything the page put there since.
    function syncShown(raise = false) {
      if (!host || typeof host.showPopover !== "function") return;
      const want = (cardEl && !cardEl.hidden) || (toastEl && toastEl.childNodes.length > 0);
      let shown;
      try {
        shown = host.matches(":popover-open");
      } catch {
        shown = false;
      }
      try {
        if (shown && (!want || raise)) host.hidePopover();
        if (want && (!shown || raise)) host.showPopover();
      } catch {
        // a page that removed or re-parented the host; the fixed fallback still shows
      }
    }

    // --- Content (19 §1, §1a) ----------------------------------------------------------
    function languageLine(lang) {
      const name = i18n.languageName(lang) ?? null;
      const endonym = i18n.languageName(lang, lang) ?? null;
      if (!name) return [endonym ?? lang];
      if (!endonym || endonym.toLocaleLowerCase() === name.toLocaleLowerCase()) return [name];
      return i18n.parts("popover_language_line", { language: name, endonym: bdi(endonym, lang) });
    }

    const languageName = (lang, word) => i18n.languageName(lang) ?? word?.language ?? lang;

    // The syllables, stressed one in semibold, tones as raised digits (all aria-hidden;
    // the accessible text is separate and lowercase).
    function syllables(words) {
      const out = [];
      words.forEach((syls, wi) => {
        if (wi) out.push(" ");
        syls.forEach((s, si) => {
          if (si) out.push("-");
          const part = s.stressed ? node("b", { class: "k-stress" }, s.text) : s.text;
          out.push(part);
          if (s.tone) out.push(node("sup", {}, String(s.tone)));
        });
      });
      return out;
    }

    function pronA11y(words) {
      const a = cards.pronunciationA11y(words, (n) => t("popover_tone", { n: String(n) }));
      if (!a) return "";
      return a.stressed.length
        ? t("popover_pron_a11y", { pronunciation: a.plain, syllable: a.stressed.join(", ") })
        : t("popover_pron_a11y_plain", { pronunciation: a.plain });
    }

    function labelNode(label) {
      if (!label) return null;
      if (label.kind === "checked") {
        const icon = icons?.icon ? icons.icon("check", 16) : null;
        if (icon) icon.setAttribute("class", "k-label-icon");
        return node("span", { class: "k-label" }, icon, t("popover_pron_checked", { source: label.source }));
      }
      if (label.kind === "differs") return node("span", { class: "k-label" }, t("popover_pron_differs", { source: label.source }));
      return node("span", { class: "k-label" }, t("popover_pron_ai"));
    }

    function render(info) {
      const token = ++renderToken;
      const { word } = info;
      const m = cards.cardFor(word, { all: info.all ?? [], others: info.others ?? [] });
      scrollEl.replaceChildren();

      // 1. The word (stress-marked for ru, uk, be), its reading, and the speak button.
      const headText = node("div", { class: "k-head-text" }, bdi(m.headword, m.lang, "k-word"));
      if (m.reading) headText.append(" ", node("span", { class: "k-reading", lang: m.lang }, m.reading));
      speakBtn = node("button", { class: "k-speak", type: "button", hidden: true });
      if (icons?.icon) speakBtn.append(icons.icon("speaker", 20));
      speakBtn.append(node("span", { class: "sr" }, i18n.parts("speak_label", { word: bdi(m.native, m.lang), lang: languageName(m.lang, word) })));
      speakBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        sayCurrent();
      });
      scrollEl.append(node("div", { class: "k-head" }, headText, speakBtn));
      if (speak?.canSpeak) {
        speak.canSpeak(m.lang).then(
          (ok) => {
            if (token !== renderToken || !speakBtn) return;
            speakBtn.hidden = !ok;
            // Keyboard-opened: the speak button is the first action.
            if (ok && open?.keyboard && shadow.activeElement === cardEl) speakBtn.focus();
            if (open) position();
          },
          () => {},
        );
      }

      // 2. The pronunciation for this base; 3. the careful form.
      if (m.pronunciation) {
        scrollEl.append(
          node("div", { class: "k-pron", lang: m.base }, node("span", { "aria-hidden": "true" }, syllables(m.pronunciation)), node("span", { class: "sr" }, pronA11y(m.pronunciation))),
        );
      }
      if (m.careful) {
        const visible = node("span", { "aria-hidden": "true" }, i18n.parts("popover_careful", { pronunciation: node("span", { lang: m.base }, syllables(m.careful)) }));
        const a = cards.pronunciationA11y(m.careful, (n) => t("popover_tone", { n: String(n) }));
        scrollEl.append(node("div", { class: "k-careful" }, visible, node("span", { class: "sr" }, t("popover_careful", { pronunciation: a.plain }))));
      }

      // 4. The romanization and the source label (own line when there is no romanization).
      const label = labelNode(m.label);
      if (m.romanization || label) {
        const line = node("div", { class: "k-rom" });
        if (m.romanization) {
          line.append(
            node("span", { "aria-hidden": "true" }, bdi(m.romanization, m.romanizationLang)),
            node("span", { class: "sr" }, t("popover_romanization_a11y", { romanization: m.romanization })),
          );
          if (label) line.append(node("span", { class: "k-sep", "aria-hidden": "true" }, " · "));
        }
        if (label) line.append(label);
        scrollEl.append(line);
      }

      // The language, in the interface language and in its own.
      scrollEl.append(node("div", { class: "k-lang" }, languageLine(m.lang)));

      // The meaning in this page's base, the note, the other bases, the other candidates.
      const meaning = [];
      if (m.gloss) meaning.push(node("div", { class: "k-gloss", lang: m.base, dir: "auto" }, m.gloss));
      if (m.note) {
        const text = node("span", { class: "k-note-text" }, m.note);
        const note = node("div", { class: "k-note", lang: m.base, dir: "auto", "data-clamped": true }, text);
        meaning.push(note);
        // "More" only when the note is long enough to be cut at three lines.
        if (m.note.length > 120) {
          const more = node("button", { class: "k-more", type: "button" }, t("popover_more"));
          more.addEventListener("click", (e) => {
            e.stopPropagation();
            note.removeAttribute("data-clamped");
            more.remove();
            position();
          });
          note.append(" ", more);
        }
      }
      for (const o of m.otherBases) {
        meaning.push(node("div", { class: "k-other" }, i18n.parts("popover_other_base", { base: languageName(o.base), gloss: bdi(o.gloss, o.base) })));
      }
      if (m.also.length) {
        const list = [];
        m.also.forEach((a, i) => {
          if (i) list.push(node("span", { class: "k-sep", "aria-hidden": "true" }, " · "));
          list.push(bdi(a.native, a.lang, "k-also-word"));
          const extra = [a.romanization, a.langs.length > 1 ? a.langs.map((l) => languageName(l)).join(", ") : null].filter(Boolean);
          if (extra.length) list.push(" ", node("span", { class: "k-also-rom" }, `(${extra.join(", ")})`));
        });
        const span = node("span", {}, list);
        meaning.push(node("div", { class: "k-also" }, i18n.parts("popover_also", { list: span })));
      }
      if (meaning.length) scrollEl.append(node("div", { class: "k-rule", "aria-hidden": "true" }), ...meaning);

      // The actions slot (19 §2): Edit, Pause word and Wrong meaning here plug in here when
      // their backends exist; 35 adds review buttons above it.
      const shown = actions.filter((a) => !a.visible || a.visible(info));
      if (shown.length) {
        const row = node("div", { class: "k-actions" });
        for (const a of shown) {
          const b = node("button", { class: "k-action", type: "button", "data-action": a.id }, a.label(info));
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            a.run(info, api);
          });
          row.append(b);
        }
        scrollEl.append(row);
      }

      cardEl.setAttribute("aria-label", t("popover_dialog_label", { native: m.native, language: languageName(m.lang, word) }));
      return m;
    }

    function sayCurrent() {
      if (!open || !speakBtn || speakBtn.hidden) return false;
      const { word } = open.info;
      const btn = speakBtn;
      btn.setAttribute("data-playing", "");
      Promise.resolve(
        speak.say(word, {
          onEnd: () => btn.removeAttribute("data-playing"),
          onError: () => {
            btn.removeAttribute("data-playing");
            btn.hidden = true;
          },
        }),
      ).then(
        (ok) => ok || btn.removeAttribute("data-playing"),
        () => btn.removeAttribute("data-playing"),
      );
      return true;
    }

    // --- Position (19 §4) -------------------------------------------------------------
    function anchorRect(el) {
      const rects = el.getClientRects?.();
      return rects && rects.length ? rects[0] : el.getBoundingClientRect();
    }

    function inView(r) {
      const vw = win.innerWidth || doc.documentElement.clientWidth;
      const vh = win.innerHeight || doc.documentElement.clientHeight;
      return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && (r.width > 0 || r.height > 0);
    }

    function position() {
      if (!open || !cardEl) return;
      const r = anchorRect(open.el);
      const size = cardEl.getBoundingClientRect();
      const view = { width: win.innerWidth || doc.documentElement.clientWidth, height: win.innerHeight || doc.documentElement.clientHeight };
      const p = place(r, { width: size.width, height: size.height }, view);
      cardEl.style.left = `${p.x}px`;
      cardEl.style.top = `${p.y}px`;
      cardEl.dataset.side = p.side;
      arrowEl.style.left = `${p.arrowX}px`;
      open.side = p.side;
    }

    function onViewportChange() {
      if (!open || rafId) return;
      rafId = win.requestAnimationFrame(() => {
        rafId = 0;
        if (!open) return;
        if (!open.el.isConnected || !inView(anchorRect(open.el))) return close();
        position();
      });
    }

    // --- Open and close (19 §3) -------------------------------------------------------
    function canOpenOn(el) {
      if (!el?.isConnected || editable(el)) return false;
      const fs = doc.fullscreenElement;
      if (fs && !fs.contains(el)) return false;
      return true;
    }

    function saveRanges() {
      const sel = win.getSelection?.();
      const ranges = [];
      if (sel) for (let i = 0; i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i).cloneRange());
      return ranges;
    }

    function openFor(el, mode = "click") {
      if (!canOpenOn(el)) return false;
      const info = infoFor(el);
      if (!info?.word) return false;
      cancelHover();
      cancelLeave();
      ensureHost();
      const moving = !!open && !cardEl.hidden;
      const keyboard = mode === "keyboard";
      const prev = open;
      open = {
        el,
        info,
        mode,
        pinned: mode !== "hover",
        keyboard,
        // Esc returns focus where it was (19 §3, 27).
        restore: keyboard ? (prev?.keyboard ? prev.restore : doc.activeElement) : null,
        ranges: keyboard ? (prev?.keyboard ? prev.ranges : saveRanges()) : null,
      };
      root.classList.toggle("k-dark", themeFor(el) === "dark");
      root.classList.toggle("k-reduce", !!reduceMotion());
      render(info);
      cardEl.hidden = false;
      cardEl.classList.remove("k-enter");
      syncShown(!moving);
      position();
      if (!moving) {
        // Restart the enter animation (06 §9: 180 ms fade and 4 px rise; a fade alone under
        // reduced motion). Hovering another word moves the card with no animation.
        void cardEl.offsetWidth;
        cardEl.classList.add("k-enter");
      }
      if (keyboard) cardEl.focus();
      if (!moving) {
        doc.addEventListener("scroll", onViewportChange, { capture: true, passive: true });
        win.addEventListener("resize", onViewportChange, { passive: true });
      }
      return true;
    }

    function close({ restore = false } = {}) {
      cancelHover();
      cancelLeave();
      if (!open) return;
      const was = open;
      open = null;
      renderToken++;
      if (cardEl) {
        cardEl.hidden = true;
        cardEl.classList.remove("k-enter");
      }
      doc.removeEventListener("scroll", onViewportChange, { capture: true });
      win.removeEventListener("resize", onViewportChange);
      if (rafId) win.cancelAnimationFrame(rafId);
      rafId = 0;
      syncShown();
      if (restore && was.keyboard) {
        try {
          if (was.restore?.isConnected && was.restore !== doc.body) was.restore.focus({ preventScroll: true });
          else if (shadow?.activeElement) shadow.activeElement.blur();
          const sel = win.getSelection?.();
          if (sel && was.ranges?.length) {
            sel.removeAllRanges();
            for (const r of was.ranges) sel.addRange(r);
          }
        } catch {
          // the page moved on
        }
      } else if (shadow?.activeElement) {
        shadow.activeElement.blur();
      }
    }

    // --- Hover intent ---------------------------------------------------------------
    function cancelHover() {
      if (!hover) return;
      clearT(hover.timer);
      doc.removeEventListener("pointermove", onHoverMove, { capture: true });
      hover = null;
    }

    function cancelLeave() {
      clearT(leaveTimer);
      leaveTimer = 0;
    }

    function scheduleLeave() {
      if (!open || open.pinned) return;
      cancelLeave();
      leaveTimer = setT(() => {
        leaveTimer = 0;
        if (open && !open.pinned) close();
      }, LEAVE_MS);
    }

    function onHoverMove(e) {
      if (!hover) return;
      const at = now();
      hover.samples.push({ x: e.clientX, y: e.clientY, t: at });
      while (hover.samples.length > 2 && at - hover.samples[1].t > STILL_WINDOW_MS * 2) hover.samples.shift();
    }

    // Still enough: the pointer moved less than STILL_PX in the last STILL_WINDOW_MS.
    function settled() {
      const at = now();
      const last = hover.samples.at(-1);
      return hover.samples.filter((s) => at - s.t <= STILL_WINDOW_MS).every((s) => Math.hypot(s.x - last.x, s.y - last.y) < STILL_PX);
    }

    function checkIntent() {
      if (!hover) return;
      const el = hover.el;
      if (!el.isConnected) return cancelHover();
      if (settled()) {
        cancelHover();
        openFor(el, "hover");
      } else {
        hover.timer = setT(checkIntent, 50);
      }
    }

    function onPointerOver(e) {
      if (inHost(e.target)) return cancelLeave();
      if (e.pointerType === "touch") return;
      const w = wordFrom(e.target);
      if (!w) return;
      if (open && open.el === w) return cancelLeave();
      if (hover?.el === w) return;
      cancelHover();
      hover = { el: w, samples: [{ x: e.clientX, y: e.clientY, t: now() }], timer: 0 };
      doc.addEventListener("pointermove", onHoverMove, { capture: true, passive: true });
      hover.timer = setT(checkIntent, HOVER_MS);
    }

    function onPointerOut(e) {
      const to = e.relatedTarget;
      if (hover && wordFrom(e.target) === hover.el && !(to && hover.el.contains(to))) cancelHover();
      if (!open || open.pinned) return;
      const fromOurs = inHost(e.target) || (wordFrom(e.target) === open.el);
      if (!fromOurs) return;
      if (to && (inHost(to) || open.el.contains(to))) return;
      scheduleLeave();
    }

    // --- Click, tap and long press ---------------------------------------------------
    function onPointerDown(e) {
      if (open && !inHost(e.target) && !(open.el.contains(e.target))) {
        // A press on another word: the click that follows opens it.
        close();
      }
      if (e.pointerType !== "touch") return;
      const w = wordFrom(e.target);
      if (!w || !inLinkOrButton(w)) return;
      // Inside a link a tap navigates; a long press opens (19 §3).
      cancelPress();
      press = { el: w, x: e.clientX, y: e.clientY, timer: setT(() => {
        const el = press?.el;
        cancelPress();
        if (el && openFor(el, "tap")) longPressed = { el, at: now() };
      }, LONG_PRESS_MS) };
      doc.addEventListener("pointermove", onPressMove, { capture: true, passive: true });
      doc.addEventListener("pointerup", cancelPress, { capture: true, passive: true });
      doc.addEventListener("pointercancel", cancelPress, { capture: true, passive: true });
    }

    function onPressMove(e) {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
    }

    function cancelPress() {
      if (!press) return;
      clearT(press.timer);
      press = null;
      doc.removeEventListener("pointermove", onPressMove, { capture: true });
      doc.removeEventListener("pointerup", cancelPress, { capture: true });
      doc.removeEventListener("pointercancel", cancelPress, { capture: true });
    }

    const recentLongPress = (w) => longPressed && longPressed.el === w && now() - longPressed.at < 1500;

    function onContextMenu(e) {
      const w = wordFrom(e.target);
      if (w && recentLongPress(w)) e.preventDefault();
    }

    function onClick(e) {
      if (inHost(e.target)) return;
      const w = wordFrom(e.target);
      if (!w) return;
      if (inLinkOrButton(w)) {
        // Never open from a click in a link, never block its navigation, except the click
        // a long press may leave behind.
        if (recentLongPress(w)) {
          longPressed = null;
          e.preventDefault();
        }
        return;
      }
      // A selection that started on the word is a selection, not a click.
      const sel = win.getSelection?.();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      if (open && open.el === w && open.pinned) return close();
      openFor(w, e.pointerType === "touch" ? "tap" : "click");
    }

    // --- Keyboard -------------------------------------------------------------------
    function onKeyDown(e) {
      if (e.key === "Escape") {
        if (open) return close({ restore: true });
        if (toastState) dismissToast();
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      // S speaks (34); by key position too, for layouts without a Latin S.
      if (open && (e.key === "s" || e.code === "KeyS") && !e.shiftKey) {
        const target = inHost(e.target) ? null : e.target;
        if (target && editable(target)) return;
        if (sayCurrent()) e.preventDefault();
        return;
      }
      if (e.key === "Enter" && isWord(e.target)) {
        if (openFor(e.target, "keyboard")) e.preventDefault();
      }
    }

    function focusables() {
      return [...cardEl.querySelectorAll("button")].filter((b) => !b.hidden && !b.closest("[hidden]"));
    }

    function onShadowKeydown(e) {
      if (e.key !== "Tab" || !open || cardEl.hidden) return;
      const list = focusables();
      if (!list.length) {
        e.preventDefault();
        cardEl.focus();
        return;
      }
      const i = list.indexOf(shadow.activeElement);
      const next = e.shiftKey ? (i <= 0 ? list.at(-1) : list[i - 1]) : i === -1 || i === list.length - 1 ? list[0] : list[i + 1];
      e.preventDefault();
      next.focus();
    }

    // The "Show details" command (33's reveal-word): the word in the selection, or the one
    // holding the caret or focus.
    function wordInSelection() {
      const sel = win.getSelection?.();
      if (sel?.rangeCount) {
        for (let i = 0; i < sel.rangeCount; i++) {
          const r = sel.getRangeAt(i);
          const direct = wordFrom(r.startContainer) ?? wordFrom(r.endContainer);
          if (direct) return direct;
          const scope = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
          for (const w of scope?.querySelectorAll?.(WORD_TAG) ?? []) if (r.intersectsNode(w)) return w;
        }
      }
      return wordFrom(doc.activeElement);
    }

    function reveal() {
      const w = wordInSelection();
      if (w && openFor(w, "keyboard")) return true;
      toast(t("toast_select_word_first"));
      return false;
    }

    // --- Toast (19 §8) --------------------------------------------------------------
    function toast(message, { actionLabel = null, onAction = null } = {}) {
      ensureHost();
      dismissToast();
      root.classList.toggle("k-dark", themeFor(doc.body ?? doc.documentElement) === "dark");
      const text = node("span", { class: "k-toast-text" }, String(message ?? ""));
      toastEl.append(text);
      if (actionLabel && onAction) {
        const b = node("button", { class: "k-toast-action", type: "button" }, actionLabel);
        b.addEventListener("click", () => {
          dismissToast();
          onAction();
        });
        toastEl.append(b);
      }
      const ms = actionLabel ? TOAST_ACTION_MS : TOAST_MS;
      toastState = { remaining: ms, started: now(), timer: setT(dismissToast, ms), paused: false };
      syncShown(true);
      return text;
    }

    function pauseToast(on) {
      if (!toastState || toastState.paused === on) return;
      toastState.paused = on;
      if (on) {
        clearT(toastState.timer);
        toastState.remaining -= now() - toastState.started;
      } else {
        toastState.started = now();
        toastState.timer = setT(dismissToast, Math.max(1000, toastState.remaining));
      }
    }

    function dismissToast() {
      if (toastState) clearT(toastState.timer);
      toastState = null;
      if (toastEl) toastEl.replaceChildren();
      syncShown();
    }

    // --- Lifecycle ------------------------------------------------------------------
    // Only the learner opens, closes or speaks the card: events a page script makes
    // (isTrusted false) are ignored, or any site could open the card on a word and search
    // its closed shadow root with window.find (security review A-04).
    const learner = (fn) => (e) => {
      if (e.isTrusted) fn(e);
    };
    const LISTENERS = [
      ["pointerover", learner(onPointerOver), { capture: true, passive: true }],
      ["pointerout", learner(onPointerOut), { capture: true, passive: true }],
      ["pointerdown", learner(onPointerDown), { capture: true, passive: true }],
      // Not passive: only to cancel the click a long press inside a link leaves behind.
      ["click", learner(onClick), { capture: true }],
      ["keydown", learner(onKeyDown), { capture: true }],
      // Not passive: suppresses the context menu only after a long press on a word.
      ["contextmenu", learner(onContextMenu), { capture: true }],
    ];

    function install() {
      if (installed) return;
      installed = true;
      for (const [type, fn, o] of LISTENERS) doc.addEventListener(type, fn, o);
    }

    function destroy() {
      close();
      dismissToast();
      cancelPress();
      for (const [type, fn, o] of LISTENERS) doc.removeEventListener(type, fn, o);
      installed = false;
      host?.remove();
      host = shadow = root = cardEl = toastEl = scrollEl = arrowEl = speakBtn = null;
    }

    // After the words change: follow the same word to its new element, or close (19 §10).
    // `find(current)` returns the new element for the open word, or null when it is gone.
    function refresh(find) {
      if (!open) return;
      const next = find(open);
      const info = next ? infoFor(next) : null;
      if (!info?.word) return close();
      const hadFocus = !!shadow.activeElement;
      open.el = next;
      open.info = info;
      render(info);
      position();
      if (hadFocus && !shadow.activeElement) cardEl.focus();
    }

    const api = {
      install,
      destroy,
      openFor,
      close,
      reveal,
      toast,
      dismissToast,
      refresh,
      speak: sayCurrent,
      isOpen: () => !!open,
      current: () => (open ? { el: open.el, info: open.info, mode: open.mode, pinned: open.pinned } : null),
      // For tests: the closed shadow root and host, which page scripts can't reach.
      _shadow: () => shadow,
      _host: () => host,
    };
    return api;
  }

  const api = { createPopover, place, parseColor, luminance, createThemeDetector, HOST_TAG };
  globalThis.KotikoPopover = api;
})();
