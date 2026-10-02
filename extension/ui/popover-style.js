// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The word popover's and in-page toast's stylesheet (slices 06 §2, 19), as a string for the
// closed shadow root on web pages, loaded as a content script before content.js. A CSS file
// would need web_accessible_resources, which lets any site detect Kotiko.
//
// The token block is generated from tokens.css and base.css by
// `node extension/ui/tools/popover-tokens.mjs` (a unit test runs it with --check). The
// component rules below use token names only, never raw colors, and px instead of rem: in
// a shadow root rem follows the web page's root font size.
(() => {
  // <generated:tokens> (node extension/ui/tools/popover-tokens.mjs; don't edit by hand)
  const TOKENS = `
.k-root {
  --font-ui-stack: system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, "Noto Sans", Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans Arabic", "Geeza Pro", "Noto Sans Hebrew", "Noto Sans Devanagari", "Kohinoor Devanagari", "Nirmala UI", "Noto Sans Bengali", "Noto Sans Tamil", "Noto Sans Thai", "Thonburi", "Leelawadee UI", "Noto Sans Georgian", "Noto Sans Armenian", "Noto Sans Ethiopic", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji";
  --font-ui: var(--font-ui-stack);
  --font-display: ui-serif, "New York", "Iowan Old Style", Charter, "Source Serif 4", "Noto Serif", Georgia, serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono", "Noto Sans Mono", Menlo, Consolas, monospace;
  --t-caption: 400 12px/16px;
  --t-small: 400 13px/18px;
  --t-body: 400 14px/20px;
  --t-body-strong: 600 14px/20px;
  --t-lead: 400 16px/24px;
  --t-word: 500 18px/24px;
  --t-title: 600 20px/28px;
  --t-word-lg: 500 24px/30px;
  --t-headline: 600 32px/40px;
  --t-specimen: 500 44px/52px;
  --s-0: 0;
  --s-1: 2px;
  --s-2: 4px;
  --s-3: 6px;
  --s-4: 8px;
  --s-5: 12px;
  --s-6: 16px;
  --s-7: 20px;
  --s-8: 24px;
  --s-9: 32px;
  --s-10: 40px;
  --s-11: 56px;
  --r-xs: 4px;
  --r-sm: 8px;
  --r-md: 12px;
  --r-lg: 16px;
  --r-xl: 24px;
  --r-full: 999px;
  --d-fast: 120ms;
  --d-base: 180ms;
  --d-slow: 280ms;
  --d-swap: 420ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-enter: cubic-bezier(0.05, 0.7, 0.1, 1);
  --ease-exit: cubic-bezier(0.3, 0, 0.8, 0.15);
  --target-min: 24px;
  --lang-1: #C8641E;
  --lang-2: #0E66C8;
  --lang-3: #AF71F2;
  --lang-4: #904E81;
  --lang-5: #ED5790;
  --lang-6: #009EAF;
  --brand: #8E5EFA;
  --on-brand: #FFFFFF;
  --canvas: #FAF6F0;
  --surface: #FFFFFF;
  --surface-e2: #FFFFFF;
  --surface-e3: #FFFFFF;
  --sunken: #F3EDE4;
  --selected: #EBE8FE;
  --ink: #1F1A2B;
  --ink-2: #544C63;
  --ink-3: #6B6379;
  --border: #8A8299;
  --divider: #E4DCD0;
  --primary: #8351EC;
  --primary-hover: #723CD7;
  --on-primary: #FFFFFF;
  --purple-text: #7A46E1;
  --purple-soft: #EFECFE;
  --focus: #7A46E1;
  --orange: #B4501A;
  --on-orange: #FFFFFF;
  --orange-text: #A3440F;
  --orange-soft: #FBE6D6;
  --blue: #1F5FC0;
  --blue-soft: #E2ECFA;
  --success: #0B6E7A;
  --success-soft: #DDF1F3;
  --warning: #875800;
  --warning-soft: #FBEFD3;
  --danger: #A8243A;
  --danger-soft: #FBE3E6;
  --inverse-bg: #1F1A2B;
  --inverse-ink: #FAF6F0;
  --e-1: 0 1px 2px rgb(31 26 43 / 0.06), 0 1px 1px rgb(31 26 43 / 0.04);
  --e-2: 0 8px 24px rgb(31 26 43 / 0.12), 0 2px 6px rgb(31 26 43 / 0.08);
  --e-3: 0 24px 48px rgb(31 26 43 / 0.18);
}
.k-root.k-dark {
  color-scheme: dark;
  --brand: #8E5EFA;
  --on-brand: #FFFFFF;
  --canvas: #14121C;
  --surface: #1C1928;
  --surface-e2: #252135;
  --surface-e3: #2C2642;
  --sunken: #110F18;
  --selected: #2D2546;
  --ink: #F2EEF8;
  --ink-2: #C4BCD4;
  --ink-3: #A39BB5;
  --border: #7E7693;
  --divider: #2E2940;
  --primary: #A08AEB;
  --primary-hover: #B2A0F5;
  --on-primary: #16102A;
  --purple-text: #A08AEB;
  --purple-soft: #2B2148;
  --focus: #A08AEB;
  --orange: #F08A4B;
  --on-orange: #1C0F06;
  --orange-text: #F6A672;
  --orange-soft: #3A2418;
  --blue: #8DBBFF;
  --blue-soft: #1C2740;
  --success: #56C7D9;
  --success-soft: #122F36;
  --warning: #F2C14E;
  --warning-soft: #33280F;
  --danger: #FF6F8A;
  --danger-soft: #3A1A22;
  --inverse-bg: #F2EEF8;
  --inverse-ink: #14121C;
  --e-1: inset 0 1px 0 rgb(255 255 255 / 0.04);
  --e-2: 0 8px 24px rgb(0 0 0 / 0.5), 0 0 0 1px rgb(255 255 255 / 0.08);
  --e-3: 0 24px 48px rgb(0 0 0 / 0.6);
}
@media (pointer: coarse) {
  .k-root {
    --target-min: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .k-root {
    --d-base: 120ms;
    --d-slow: 120ms;
    --d-swap: 120ms;
  }
}
@media (prefers-contrast: more) {
  .k-root, .k-root.k-dark {
    --ink-3: var(--ink-2);
    --border: var(--ink-2);
    --divider: var(--border);
  }
}
.k-root :lang(ja) {
  --font-ui: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", "Noto Sans CJK JP", "Noto Sans JP", var(--font-ui-stack);
}
.k-root :lang(zh), .k-root :lang(zh-Hans), .k-root :lang(zh-CN) {
  --font-ui: "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", var(--font-ui-stack);
}
.k-root :lang(zh-Hant), .k-root :lang(zh-TW) {
  --font-ui: "PingFang TC", "Microsoft JhengHei UI", "Noto Sans CJK TC", "Noto Sans TC", var(--font-ui-stack);
}
.k-root :lang(zh-HK), .k-root :lang(yue) {
  --font-ui: "PingFang HK", "Noto Sans CJK HK", "Microsoft JhengHei UI", var(--font-ui-stack);
}
.k-root :lang(ko) {
  --font-ui: "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Noto Sans KR", var(--font-ui-stack);
}
.k-root :lang(ar), .k-root :lang(fa) {
  --font-ui: "Noto Naskh Arabic", "Geeza Pro", "Segoe UI", "Tahoma", var(--font-ui-stack);
}
.k-root :lang(ur) {
  --font-ui: "Noto Nastaliq Urdu", "Noto Naskh Arabic", "Geeza Pro", "Segoe UI", "Tahoma", var(--font-ui-stack);
}
.k-root [lang] {
  --font-word: var(--font-display);
}
.k-root :lang(ja), .k-root :lang(zh), .k-root :lang(ko), .k-root :lang(yue), .k-root :lang(ar), .k-root :lang(fa), .k-root :lang(ur), .k-root :lang(ps), .k-root :lang(he), .k-root :lang(yi), .k-root :lang(hi), .k-root :lang(mr), .k-root :lang(ne), .k-root :lang(sa), .k-root :lang(bn), .k-root :lang(as), .k-root :lang(pa), .k-root :lang(gu), .k-root :lang(or), .k-root :lang(ta), .k-root :lang(te), .k-root :lang(kn), .k-root :lang(ml), .k-root :lang(si), .k-root :lang(th), .k-root :lang(lo), .k-root :lang(km), .k-root :lang(my), .k-root :lang(bo), .k-root :lang(ka), .k-root :lang(hy), .k-root :lang(am), .k-root :lang(ti) {
  --font-word: var(--font-ui);
}
`;
  // </generated:tokens>

  const COMPONENTS = `
:host {
  all: initial;
}

.k-root {
  --font-word: var(--font-display);
  /* A 1 px edge that holds the card's shape on pages close to its color. */
  --hairline: color-mix(in srgb, var(--ink) 9%, transparent);
  position: fixed;
  inset: 0 auto auto 0;
  width: 0;
  height: 0;
  overflow: visible;
  font: var(--t-body) var(--font-ui);
  color: var(--ink);
  text-align: start;
  text-transform: none;
  letter-spacing: normal;
  word-spacing: normal;
  white-space: normal;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.k-root *,
.k-root *::before,
.k-root *::after {
  box-sizing: border-box;
}

[hidden] {
  display: none !important;
}

.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* --- The card (06 §10 popover; 19 §1) ------------------------------------------------ */
.k-card {
  position: fixed;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  width: max-content;
  min-width: 220px;
  max-width: min(320px, calc(100vw - 16px));
  max-height: 60vh;
  margin: 0;
  padding: 0;
  border-radius: var(--r-lg);
  background: var(--surface-e2);
  color: var(--ink);
  box-shadow: var(--e-2), 0 0 0 1px var(--hairline);
  outline: none;
}

/* The invisible 8 px bridge between the word and the card (19 §3), so the pointer can
   cross the gap without the card closing. */
.k-card::before {
  content: "";
  position: absolute;
  inset-inline: 0;
  height: 12px;
}

.k-card[data-side="below"]::before {
  bottom: 100%;
}

.k-card[data-side="above"]::before {
  top: 100%;
}

.k-arrow {
  position: absolute;
  width: 12px;
  height: 12px;
  margin-inline-start: -6px;
  background: var(--surface-e2);
  transform: rotate(45deg);
  pointer-events: none;
}

.k-card[data-side="below"] .k-arrow {
  top: -6px;
  box-shadow: -1px -1px 0 0 var(--hairline);
}

.k-card[data-side="above"] .k-arrow {
  bottom: -6px;
  box-shadow: 1px 1px 0 0 var(--hairline);
}

.k-scroll {
  position: relative;
  min-height: 0;
  padding: var(--s-6) var(--s-6) var(--s-6);
  overflow: auto;
  overscroll-behavior: contain;
  border-radius: inherit;
}

.k-enter {
  animation: k-in var(--d-base) var(--ease-enter) both;
}

.k-card[data-side="above"].k-enter {
  animation-name: k-in-above;
}

@keyframes k-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes k-in-above {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .k-enter,
  .k-card[data-side="above"].k-enter {
    animation: k-fade var(--d-fast) linear both;
  }
}

@keyframes k-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* --- The pronunciation block (19 §1a) ------------------------------------------------- */
.k-head {
  display: flex;
  align-items: center;
  gap: var(--s-4);
  min-height: 32px;
}

.k-head-text {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--s-4);
  min-width: 0;
  flex: 1 1 auto;
}

.k-word {
  position: relative;
  font: var(--t-word-lg) var(--font-word);
  color: var(--ink);
  overflow-wrap: anywhere;
  unicode-bidi: isolate;
}

/* The one ornament (06 §1): the row of dots under the learner's word, as on the page. */
.k-word::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  inset-block-end: -2px;
  height: 2px;
  background-image: radial-gradient(circle, var(--orange) 0.9px, transparent 1.1px);
  background-size: 5px 2px;
  background-repeat: repeat-x;
}

.k-reading {
  font: var(--t-small) var(--font-ui);
  color: var(--ink-2);
}

.k-speak {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-block: -2px;
  margin-inline-end: -6px;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  color: var(--purple-text);
  font: inherit;
  cursor: pointer;
  transition: background-color var(--d-fast) var(--ease-standard);
}

.k-speak:hover,
.k-speak[data-playing] {
  background: var(--purple-soft);
}

.k-speak svg {
  display: block;
}

.k-pron {
  margin-block-start: var(--s-3);
  font: var(--t-lead) var(--font-ui);
  color: var(--ink);
  text-transform: none;
  overflow-wrap: anywhere;
}

.k-stress {
  font-weight: 600;
}

.k-pron sup,
.k-careful sup {
  font-size: 0.68em;
  line-height: 0;
  vertical-align: 0.55em;
  font-variant-numeric: tabular-nums;
}

.k-careful {
  font: var(--t-small) var(--font-ui);
  color: var(--ink-2);
  text-transform: none;
}

.k-rom,
.k-lang {
  font: var(--t-small) var(--font-ui);
  color: var(--ink-3);
  overflow-wrap: anywhere;
}

.k-rom {
  margin-block-start: var(--s-1);
}

.k-label-icon {
  display: inline-block;
  vertical-align: -3px;
  margin-inline-end: 2px;
  color: var(--success);
}

.k-lang {
  margin-block-start: var(--s-1);
}

/* --- Meaning ------------------------------------------------------------------------- */
.k-rule {
  height: 2px;
  margin-block: var(--s-5);
  background-image: radial-gradient(circle, var(--divider) 1px, transparent 1.2px);
  background-size: 6px 2px;
  background-repeat: repeat-x;
}

.k-gloss {
  font: var(--t-lead) var(--font-ui);
  font-weight: 500;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.k-note {
  margin-block-start: var(--s-2);
  font: var(--t-small) var(--font-ui);
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

.k-note[data-clamped] .k-note-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}

.k-more {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--purple-text);
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.k-also,
.k-other {
  margin-block-start: var(--s-3);
  font: var(--t-small) var(--font-ui);
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

.k-also-word {
  color: var(--ink);
}

.k-also-rom {
  color: var(--ink-3);
}

/* --- Actions slot (19 §2): quiet buttons, 32 px tall ---------------------------------- */
.k-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-6);
  margin-block-start: var(--s-5);
}

.k-action {
  min-height: 32px;
  min-width: var(--target-min);
  padding: 0 var(--s-4);
  margin-inline-start: calc(-1 * var(--s-4));
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  color: var(--ink-2);
  font: var(--t-body-strong) var(--font-ui);
  cursor: pointer;
}

.k-action:hover {
  background: var(--sunken);
  color: var(--ink);
}

@media (pointer: coarse) {
  .k-speak {
    width: 44px;
    height: 44px;
    margin-block: -8px;
    margin-inline-end: -12px;
  }

  .k-action {
    min-height: 44px;
  }
}

/* --- Focus (06 §10) ---------------------------------------------------------------- */
.k-root :focus {
  outline: none;
}

.k-root :focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* --- Toast (19 §8; 06 §10) ----------------------------------------------------------- */
.k-toast {
  position: fixed;
  left: 50vw;
  bottom: 16px;
  display: flex;
  align-items: center;
  gap: var(--s-5);
  width: max-content;
  max-width: min(360px, calc(100vw - 32px));
  padding: var(--s-5) var(--s-6);
  border-radius: var(--r-lg);
  background: var(--inverse-bg);
  color: var(--inverse-ink);
  box-shadow: var(--e-3);
  font: var(--t-body) var(--font-ui);
  transform: translateX(-50%);
}

.k-toast:empty {
  display: none;
}

.k-toast-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.k-toast-action {
  flex: none;
  min-height: 32px;
  padding: 0 var(--s-2);
  border: 0;
  background: none;
  color: var(--inverse-ink);
  font: var(--t-body-strong) var(--font-ui);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.k-toast .k-root :focus-visible,
.k-toast :focus-visible {
  outline-color: var(--inverse-ink);
}

@media print {
  .k-card,
  .k-toast {
    display: none !important;
  }
}

@media (forced-colors: active) {
  .k-card,
  .k-toast {
    border: 1px solid CanvasText;
    box-shadow: none;
  }

  .k-arrow {
    display: none;
  }

  .k-word::after {
    background-image: radial-gradient(circle, CanvasText 0.9px, transparent 1.1px);
  }
}
`;

  const css = TOKENS + COMPONENTS;
  let sheet = null;

  // A constructed stylesheet for adoptedStyleSheets, shared by every shadow root in this
  // document, or null where constructable stylesheets are missing (then use a <style>).
  function constructed(win = globalThis) {
    if (sheet !== null) return sheet || null;
    try {
      sheet = new win.CSSStyleSheet();
      sheet.replaceSync(css);
    } catch {
      sheet = false;
    }
    return sheet || null;
  }

  // Puts the stylesheet into a shadow root.
  function adopt(root, doc = root.ownerDocument) {
    const s = constructed(doc?.defaultView ?? globalThis);
    if (s && "adoptedStyleSheets" in root) {
      try {
        root.adoptedStyleSheets = [s];
        return "adopted";
      } catch {
        // fall through to <style>
      }
    }
    const style = doc.createElement("style");
    style.textContent = css;
    root.append(style);
    return "style";
  }

  const api = { css, tokens: TOKENS, adopt };
  globalThis.KotikoPopoverStyle = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
