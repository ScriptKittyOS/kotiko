// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Kotiko's icons (slice 06 §11): a small custom set on a 20 px grid, 1.5 px stroke, round
// caps and joins, drawn in currentColor. Built as inline SVG with DOM methods (no icon
// font, no remote assets, no HTML strings). Icons are always decorative (aria-hidden); the
// control that holds one carries the accessible name.
//
//   const svg = KotikoIcons.icon("check");           // 20 px
//   const small = KotikoIcons.icon("info", 16);
(() => {
  const NS = "http://www.w3.org/2000/svg";
  // Each shape: [tag, attributes]. `dot` is a filled circle (the i in info, the warning
  // point).
  const dot = (cx, cy, r = 1) => ["circle", { cx, cy, r, fill: "currentColor", stroke: "none" }];
  const ICONS = {
    add: [["path", { d: "M10 4.5v11M4.5 10h11" }]],
    check: [["path", { d: "M5 10.5l3.2 3.2L15 7" }]],
    close: [["path", { d: "M5.5 5.5l9 9M14.5 5.5l-9 9" }]],
    sliders: [
      ["path", { d: "M3.5 6h8M15.5 6h1M3.5 14h1M8.5 14h8" }],
      ["circle", { cx: 13.5, cy: 6, r: 2 }],
      ["circle", { cx: 6.5, cy: 14, r: 2 }],
    ],
    undo: [["path", { d: "M7.5 4.75L4.25 8l3.25 3.25" }], ["path", { d: "M4.5 8h7.25a4 4 0 0 1 0 8H9.5" }]],
    info: [["circle", { cx: 10, cy: 10, r: 7.25 }], ["path", { d: "M10 9.25v4.5" }], dot(10, 6.6, 0.95)],
    warning: [["path", { d: "M10 3.6L17.2 16H2.8z" }], ["path", { d: "M10 8.5v3.4" }], dot(10, 14, 0.95)],
    error: [["path", { d: "M7 2.9h6l4.1 4.1v6l-4.1 4.1H7l-4.1-4.1V7z" }], ["path", { d: "M6.75 10h6.5" }]],
    success: [["circle", { cx: 10, cy: 10, r: 7.25 }], ["path", { d: "M6.9 10.2l2.1 2.1 4.1-4.5" }]],
    target: [["circle", { cx: 10, cy: 10, r: 6.25 }], ["circle", { cx: 10, cy: 10, r: 2.25 }]],
    circle: [["circle", { cx: 10, cy: 10, r: 6.25 }]],
    clock: [["circle", { cx: 10, cy: 10, r: 7.25 }], ["path", { d: "M10 6.25V10l2.5 1.6" }]],
    pause: [["path", { d: "M7.75 5.5v9M12.25 5.5v9" }]],
    play: [["path", { d: "M7 5.2v9.6L14.6 10z" }]],
    back: [["path", { d: "M11.75 5l-5 5 5 5" }]],
    chevron: [["path", { d: "M8.25 5l5 5-5 5" }]],
    up: [["path", { d: "M10 15.5v-11M5.5 9L10 4.5 14.5 9" }]],
    down: [["path", { d: "M10 4.5v11M5.5 11l4.5 4.5 4.5-4.5" }]],
    grip: [dot(7.5, 5.5), dot(12.5, 5.5), dot(7.5, 10), dot(12.5, 10), dot(7.5, 14.5), dot(12.5, 14.5)],
    enter: [["path", { d: "M15.25 5.25v3.5a2.5 2.5 0 0 1-2.5 2.5H5" }], ["path", { d: "M8 8.25l-3 3 3 3" }]],
    external: [
      ["path", { d: "M11.5 3.75h4.75V8.5M16 4l-6.5 6.5" }],
      ["path", { d: "M14 11.5v3.25a1.5 1.5 0 0 1-1.5 1.5h-7.25a1.5 1.5 0 0 1-1.5-1.5V7.5A1.5 1.5 0 0 1 5.25 6H8.5" }],
    ],
    more: [dot(5, 10, 1.25), dot(10, 10, 1.25), dot(15, 10, 1.25)],
    // The dashboard (slice 21): search, restore and the keyboard map.
    search: [["circle", { cx: 8.75, cy: 8.75, r: 5 }], ["path", { d: "M12.5 12.5l4 4" }]],
    restore: [["path", { d: "M4.5 10a5.5 5.5 0 1 0 1.6-3.9" }], ["path", { d: "M4.25 3.75v3h3" }]],
    keyboard: [
      ["rect", { x: 2.75, y: 5.25, width: 14.5, height: 9.5, rx: 2 }],
      ["path", { d: "M6 8.5h.01M9 8.5h.01M12 8.5h.01M15 8.5h.01M6.5 11.75h7" }],
    ],
    // Pronunciation audio (slice 34): a speaker with two sound waves.
    speaker: [
      ["path", { d: "M3.75 7.75v4.5h2.9L10.5 15.4V4.6L6.65 7.75z" }],
      ["path", { d: "M13.25 7.6a3.4 3.4 0 0 1 0 4.8" }],
      ["path", { d: "M15.4 5.4a6.5 6.5 0 0 1 0 9.2" }],
    ],
  };

  function icon(name, size = 20) {
    const shapes = ICONS[name];
    if (!shapes) throw new Error(`No icon named ${name}`);
    const svg = document.createElementNS(NS, "svg");
    const attrs = {
      viewBox: "0 0 20 20",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.5,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
      class: `icon icon-${name}`,
    };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
    for (const [tag, a] of shapes) {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(a)) el.setAttribute(k, String(v));
      svg.append(el);
    }
    return svg;
  }

  // Replaces every <span data-icon="name"> in `root` with its icon.
  function hydrate(root = document) {
    for (const el of root.querySelectorAll("[data-icon]")) {
      const size = Number(el.dataset.iconSize) || 20;
      el.replaceWith(icon(el.dataset.icon, size));
    }
  }

  const api = { icon, hydrate, names: Object.keys(ICONS) };
  globalThis.KotikoIcons = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
