// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Decides whether text is part of a control (a button, toggle, menu, tab, form...), which
// Kotiko leaves in the learner's own language (DECISIONS, "Buttons and menus stay in the
// learner's own language"; slice 16). Works on any DOM elements and takes computed styles
// through a callback, so the same file runs as a content script
// (globalThis.KotikoControls) and in Node tests (module.exports).
(() => {
  const CONTROL_TAGS = new Set([
    "BUTTON", "LABEL", "SELECT", "OPTION", "OPTGROUP", "DATALIST", "SUMMARY", "LEGEND", "NAV", "MENU",
  ]);
  // gridcell is left out on purpose: data grids and calendars hold content, not labels.
  const CONTROL_ROLES = new Set([
    "button", "checkbox", "radio", "switch", "tab", "tablist", "option", "listbox", "combobox",
    "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "toolbar", "slider",
    "spinbutton", "textbox", "searchbox", "tree", "treeitem", "navigation",
  ]);
  // Landmarks and other big containers. Sites put tabindex on these (often -1 or 0 on
  // <main>, for skip links and keyboard scrolling), which must never skip the whole page.
  const CONTAINER_TAGS = new Set(["HTML", "BODY", "MAIN", "ARTICLE", "SECTION", "ASIDE", "DIALOG"]);
  const CONTAINER_ROLES = new Set(["main", "region", "document", "dialog", "alertdialog", "article", "application"]);
  // A <form> that holds the page's content (ASP.NET WebForms and some CMSs wrap the whole
  // body in one) isn't a control region; its buttons and labels are still skipped.
  const PAGE_CONTENT = "main, article, [role=main], [role=article], h1";
  // "Control-like" text for the tabindex and cursor rules: what fits on a toggle or chip.
  // Longer text (a clickable news card, a focusable scroll area) is content and is swapped.
  const MAX_WORDS = 4;
  const MAX_CHARS = 40;

  const tag = (el) => el.nodeName.toUpperCase();
  const roles = (el) => (el.getAttribute("role") || "").toLowerCase().split(/\s+/).filter(Boolean);
  const isLink = (el) => (tag(el) === "A" || tag(el) === "AREA") && el.hasAttribute("href");
  const isRoot = (el) => tag(el) === "BODY" || tag(el) === "HTML";
  const isContainer = (el) => CONTAINER_TAGS.has(tag(el)) || roles(el).some((r) => CONTAINER_ROLES.has(r));

  function shortText(el) {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    return t.length <= MAX_CHARS && (!t || t.split(" ").length <= MAX_WORDS);
  }

  function hasPopup(el) {
    const v = el.getAttribute("aria-haspopup");
    return v !== null && v !== "false";
  }

  // Signals on the element itself that need no computed style.
  function isControlElement(el) {
    const name = tag(el);
    if (CONTROL_TAGS.has(name)) return true;
    const r = roles(el);
    if (r.some((x) => CONTROL_ROLES.has(x))) return true;
    if ((r.includes("link") || isLink(el)) && hasPopup(el)) return true; // a menu trigger
    if (name === "FORM") return !el.querySelector(PAGE_CONTENT);
    const ti = el.getAttribute("tabindex");
    if (ti !== null && /^\s*\d+\s*$/.test(ti) && !isLink(el) && !isContainer(el)) return shortText(el);
    return false;
  }

  // A clickable div or label: it sets cursor: pointer itself (its parent doesn't; cursor is
  // inherited, so everything inside a clickable card has it too), isn't a link, and has
  // control-like text.
  function isPointerControl(el, cursorOf) {
    if (isRoot(el) || isLink(el) || isContainer(el) || cursorOf(el) !== "pointer") return false;
    const parent = el.parentElement;
    if (parent && cursorOf(parent) === "pointer") return false;
    return shortText(el);
  }

  // Returns { inControl(el), reset() }. inControl(el) is true when el or an ancestor below
  // <body> is a control. Decisions are cached per element until reset(). Each chain is
  // checked for cheap signals first; computed styles are read only when none is found.
  function createControlCheck(getCursor) {
    let cache = new WeakMap();
    let cursors = new WeakMap();
    const cursorOf = (el) => {
      let c = cursors.get(el);
      if (c === undefined) cursors.set(el, (c = getCursor(el) || ""));
      return c;
    };

    function inControl(el) {
      const chain = [];
      let known = false;
      for (let e = el; e && e.nodeType === 1 && !isRoot(e); e = e.parentElement) {
        const c = cache.get(e);
        if (c !== undefined) {
          known = c;
          break;
        }
        chain.push(e);
      }
      if (!known) {
        // nearest first; elements above the first control stay uncached
        for (let i = 0; i < chain.length; i++) {
          if (isControlElement(chain[i])) {
            for (let j = 0; j <= i; j++) cache.set(chain[j], true);
            return true;
          }
        }
        // no cheap signal: computed styles, from the top down
        let v = false;
        for (let i = chain.length - 1; i >= 0; i--) {
          v ||= isPointerControl(chain[i], cursorOf);
          cache.set(chain[i], v);
        }
        return v;
      }
      for (const e of chain) cache.set(e, true);
      return true;
    }

    return {
      inControl,
      reset() {
        cache = new WeakMap();
        cursors = new WeakMap();
      },
    };
  }

  const api = {
    CONTROL_TAGS, CONTROL_ROLES, MAX_WORDS, MAX_CHARS,
    isControlElement, isPointerControl, createControlCheck,
  };
  globalThis.KotikoControls = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
