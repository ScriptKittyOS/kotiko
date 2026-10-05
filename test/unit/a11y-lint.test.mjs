// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 27 §6's lint, over the extension's own files:
//
//   - every accessible name, description, tooltip, alt text and placeholder comes from
//     _locales (data-i18n-* attributes in HTML, KotikoI18n.t() in scripts), never a literal;
//   - an icon-only button in HTML has a name;
//   - no positive tabindex anywhere;
//   - no `outline: none` without a replacement focus indicator.
//
// axe (test/e2e/a11y.spec.mjs) checks the names of what scripts build at run time.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension");

function files(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Development tooling and bundled data aren't interface code.
      if (["tools", "spec", "_locales", "story", "privacy", "data"].includes(e.name)) continue;
      files(p, ext, out);
    } else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(EXT, p);
const lineOf = (src, i) => src.slice(0, i).split("\n").length;

const HTML = files(EXT, ".html");
const JS = files(EXT, ".js");
const CSS = files(EXT, ".css");

// Text a person reads: has a letter in some script, and isn't an address or an example URL.
const isWords = (v) => /\p{L}/u.test(v) && !/^(https?:\/\/|[\w.-]+:\d+$)/.test(v.trim());

describe("accessible names come from _locales (27 §6, 50)", () => {
  test("HTML: no literal aria-label, aria-description, title, alt or placeholder", () => {
    const bad = [];
    for (const f of HTML) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?<![\w-])(aria-label|aria-description|aria-roledescription|aria-valuetext|title|alt|placeholder)="([^"]*)"/g)) {
        if (isWords(m[2])) bad.push(`${rel(f)}:${lineOf(src, m.index)} ${m[1]}="${m[2]}"`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test("scripts: no literal accessible name, description, tooltip, alt or placeholder", () => {
    const bad = [];
    const props = /(?:"(aria-label|aria-description|aria-roledescription|aria-valuetext)"|\b(title|alt|placeholder)):\s*(["'`])((?:(?!\3).)*)\3/g;
    const attrs = /setAttribute\(\s*"(aria-label|aria-description|title|alt|placeholder)",\s*(["'`])((?:(?!\2).)*)\2/g;
    for (const f of JS) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(props)) {
        if (m[3] === "`" && /\$\{/.test(m[4])) continue;
        if (isWords(m[4])) bad.push(`${rel(f)}:${lineOf(src, m.index)} ${m[0]}`);
      }
      for (const m of src.matchAll(attrs)) if (isWords(m[3])) bad.push(`${rel(f)}:${lineOf(src, m.index)} ${m[0]}`);
    }
    assert.deepEqual(bad, []);
  });

  test("HTML: a button with nothing but an icon has a name", () => {
    const bad = [];
    for (const f of HTML) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const [, attrs, inner] = m;
        if (!/data-icon|<svg|<img/.test(inner)) continue; // text set by the page's script
        const named = /\b(aria-label|data-i18n-aria-label|aria-labelledby)=/.test(attrs);
        const text = inner.replace(/<[^>]*>/g, "").trim() || /data-i18n=/.test(inner);
        if (!named && !text) bad.push(`${rel(f)}:${lineOf(src, m.index)} <button${attrs}>`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test("the lint catches what it's for", () => {
    const props = /(?:"(aria-label|aria-description|aria-roledescription|aria-valuetext)"|\b(title|alt|placeholder)):\s*(["'`])((?:(?!\3).)*)\3/g;
    assert.equal([...`el("button", { "aria-label": "Close" })`.matchAll(props)].filter((m) => isWords(m[4])).length, 1);
    assert.equal([...`el("button", { "aria-label": t("dash_close") })`.matchAll(props)].length, 0);
    assert.equal([...`el("input", { placeholder: "http://localhost:4747" })`.matchAll(props)].filter((m) => isWords(m[4])).length, 0);
  });
});

describe("keyboard (27 §6)", () => {
  test("no positive tabindex: the DOM order is the focus order", () => {
    const bad = [];
    for (const f of [...HTML, ...JS]) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/tabindex(?:="|:\s*"|\s*=\s*"?)\s*([1-9]\d*)|tabIndex\s*=\s*([1-9]\d*)/gi)) bad.push(`${rel(f)}:${lineOf(src, m.index)} ${m[0]}`);
    }
    assert.deepEqual(bad, []);
  });

  // `outline: none` is allowed where focus is never from the keyboard's Tab (a `:focus`
  // rule, with `:focus-visible` drawing the ring), where the same rule draws a box-shadow
  // ring instead, or where a `focus ring:` comment in the rule says what draws it.
  test("no outline: none without a replacement focus indicator", () => {
    const sources = [...CSS.map((f) => [f, fs.readFileSync(f, "utf8")]), [path.join(EXT, "ui/popover-style.js"), fs.readFileSync(path.join(EXT, "ui/popover-style.js"), "utf8")]];
    const bad = [];
    for (const [f, src] of sources) {
      for (const m of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        const [, rawSel, body] = m;
        if (!/outline\s*:\s*(none|0)\b/.test(body)) continue;
        const sel = rawSel.replace(/\/\*[\s\S]*?\*\//g, "").trim();
        const focusOnly = sel.split(",").every((s) => /:focus\s*$/.test(s.trim()));
        const ring = /box-shadow\s*:(?!\s*none)/.test(body);
        const said = /focus ring:/.test(m[0]);
        if (!focusOnly && !ring && !said) bad.push(`${rel(f)}:${lineOf(src, m.index + m[1].length)} ${sel}`);
      }
    }
    assert.deepEqual(bad, []);
  });
});
