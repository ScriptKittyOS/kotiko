// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Writes the design tokens into extension/ui/popover-style.js (slice 06 §2), the word
// popover's stylesheet as a string. The popover lives in a closed shadow root on web pages,
// where a CSS file would need web_accessible_resources (which lets any site detect Kotiko),
// so its tokens are copied in here from tokens.css and the script rules from base.css:
//
//   light tokens and the shared scale  -> .k-root
//   dark tokens                         -> .k-root.k-dark (the popover follows the page)
//   coarse pointer, reduced motion,
//   more contrast                       -> the same media queries on .k-root
//   base.css's :lang() font rules       -> the same selectors inside the shadow root
//
// rem values become px (16 px to the rem): in a shadow root rem follows the web page's own
// root font size, which sites set to anything (62.5 % is common).
//
//   node extension/ui/tools/popover-tokens.mjs           rewrite popover-style.js
//   node extension/ui/tools/popover-tokens.mjs --check   fail if it is stale (CI, tests)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(HERE, "..");
export const TOKENS_CSS = path.join(UI, "tokens.css");
export const BASE_CSS = path.join(UI, "base.css");
export const STYLE_JS = path.join(UI, "popover-style.js");
const START = "// <generated:tokens>";
const END = "// </generated:tokens>";

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// Top-level rules as [prelude, body], with nested at-rule bodies kept whole.
export function rules(css) {
  const out = [];
  const src = stripComments(css);
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    out.push([prelude, src.slice(open + 1, j - 1)]);
    i = j;
  }
  return out;
}

// Custom property declarations of a rule body, in order: [["--ink", "#1F1A2B"], ...].
export function declarations(body) {
  return [...stripComments(body).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].replace(/\s+/g, " ").trim()]);
}

export const remToPx = (value) => value.replace(/(\d*\.?\d+)rem\b/g, (_m, n) => `${+(Number(n) * 16).toFixed(3)}px`);

// The token sets of tokens.css.
export function readTokens(css = fs.readFileSync(TOKENS_CSS, "utf8")) {
  const sets = { light: [], dark: [], coarse: [], reduced: [], contrast: [] };
  for (const [prelude, body] of rules(css)) {
    if (prelude === ":root") sets.light.push(...declarations(body));
    else if (prelude === ':root[data-theme="dark"]') sets.dark.push(...declarations(body));
    else if (prelude.startsWith("@media (pointer: coarse)")) sets.coarse.push(...rules(body).flatMap(([, b]) => declarations(b)));
    else if (prelude.startsWith("@media (prefers-reduced-motion: reduce)")) sets.reduced.push(...rules(body).flatMap(([, b]) => declarations(b)));
    else if (prelude.startsWith("@media (prefers-contrast: more)")) sets.contrast.push(...rules(body).flatMap(([, b]) => declarations(b)));
  }
  return sets;
}

// base.css rules that only set custom properties on :lang() or [lang] selectors (the
// per-script font stacks).
export function readLangRules(css = fs.readFileSync(BASE_CSS, "utf8")) {
  return rules(css)
    .filter(([prelude]) => /:lang\(|\[lang\]/.test(prelude) && !prelude.startsWith("@") && !/:where/.test(prelude))
    .map(([prelude, body]) => [prelude.replace(/\s+/g, " "), declarations(body)])
    .filter(([, decls]) => decls.length && decls.every(([k]) => k.startsWith("--")));
}

const block = (selector, decls, extra = "") =>
  `${selector} {\n${extra}${decls.map(([k, v]) => `  ${k}: ${remToPx(v)};\n`).join("")}}\n`;

export function generate() {
  const t = readTokens();
  // Inside the shadow root, :root is the popover's own .k-root; a [lang] inside it wins.
  const scope = (sel) => sel.split(",").map((s) => `.k-root ${s.trim()}`).join(", ");
  let css = "";
  css += block(".k-root", t.light);
  css += block(".k-root.k-dark", t.dark, "  color-scheme: dark;\n");
  css += `@media (pointer: coarse) {\n${block(".k-root", t.coarse).replace(/^/gm, "  ").trimEnd()}\n}\n`;
  css += `@media (prefers-reduced-motion: reduce) {\n${block(".k-root", t.reduced).replace(/^/gm, "  ").trimEnd()}\n}\n`;
  css += `@media (prefers-contrast: more) {\n${block(".k-root, .k-root.k-dark", t.contrast).replace(/^/gm, "  ").trimEnd()}\n}\n`;
  for (const [sel, decls] of readLangRules()) css += block(`${scope(sel)}`, decls);
  return `${START} (node extension/ui/tools/popover-tokens.mjs; don't edit by hand)\n  const TOKENS = \`\n${css}\`;\n  ${END}`;
}

export function splice(source, generated) {
  const a = source.indexOf(START);
  const b = source.indexOf(END);
  if (a < 0 || b < a) throw new Error(`${path.basename(STYLE_JS)} has no ${START} … ${END} markers`);
  return source.slice(0, a) + generated + source.slice(b + END.length);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const current = fs.readFileSync(STYLE_JS, "utf8");
  const next = splice(current, generate());
  if (process.argv.includes("--check")) {
    if (next !== current) {
      console.error("popover-style.js is stale: run node extension/ui/tools/popover-tokens.mjs");
      process.exit(1);
    }
    console.log("popover-style.js tokens match tokens.css and base.css");
  } else {
    fs.writeFileSync(STYLE_JS, next);
    console.log(`wrote ${path.relative(process.cwd(), STYLE_JS)}`);
  }
}
