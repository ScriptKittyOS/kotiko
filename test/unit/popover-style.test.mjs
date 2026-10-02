// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 06 §2 and 19 §6: the word card's stylesheet (ui/popover-style.js) carries the same
// tokens as tokens.css, uses token names only, and never loads anything remote.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { requireExt } from "../helpers/load-script.mjs";
import { STYLE_JS, generate, readTokens, remToPx, splice } from "../../extension/ui/tools/popover-tokens.mjs";

const style = requireExt("ui/popover-style.js");
const source = fs.readFileSync(STYLE_JS, "utf8");
const components = style.css.slice(style.tokens.length);

describe("popover-style.js", () => {
  test("its token block is up to date with tokens.css and base.css", () => {
    assert.equal(splice(source, generate()), source, "run: node extension/ui/tools/popover-tokens.mjs");
  });

  test("every token value equals tokens.css, light and dark (rem as px)", () => {
    const t = readTokens();
    const block = (selector) => {
      const start = style.tokens.indexOf(`${selector} {\n`);
      return style.tokens.slice(start, style.tokens.indexOf("}", start));
    };
    const light = block(".k-root");
    const dark = block(".k-root.k-dark");
    assert.ok(t.light.length > 60 && t.dark.length > 30);
    for (const [k, v] of t.light) assert.ok(light.includes(`${k}: ${remToPx(v)};`), `light ${k}`);
    for (const [k, v] of t.dark) assert.ok(dark.includes(`${k}: ${remToPx(v)};`), `dark ${k}`);
    assert.doesNotMatch(style.tokens, /\drem\b/, "rem follows the web page's root size; px only");
  });

  test("components use token names only, never raw colors or rem", () => {
    assert.doesNotMatch(components, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    assert.doesNotMatch(components, /\drem\b/);
    assert.doesNotMatch(components, /text-transform:\s*uppercase|letter-spacing:\s*(?!inherit|normal|0\b)\S/i);
  });

  test("nothing remote", () => {
    assert.doesNotMatch(style.css, /@import|url\(/i);
  });

  test("hidden in print, and a plain border in forced colors", () => {
    assert.match(components, /@media print \{\s*\.k-card,\s*\.k-toast \{\s*display: none !important;/);
    assert.match(components, /@media \(forced-colors: active\)/);
  });

  test("adopt() falls back to a <style> where adoptedStyleSheets is missing", () => {
    const { window } = new JSDOM("<p></p>");
    const host = window.document.createElement("div");
    const root = host.attachShadow({ mode: "closed" });
    assert.equal(style.adopt(root, window.document), "style");
    assert.equal(root.querySelector("style").textContent, style.css);
  });
});
