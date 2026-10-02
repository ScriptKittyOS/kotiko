// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 06: the palette derivation, the contrast check and the token rules.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { contrast, round2, hexToOklch, deltaE } from "../../extension/ui/tools/color.mjs";
import { derive, render, brandFromTokens, TOKENS } from "../../extension/ui/tools/derive-palette.mjs";
import { checkPalette, parseTokens, PAIRS } from "../../extension/ui/tools/contrast.mjs";
import { readExt } from "../helpers/load-script.mjs";

const css = fs.readFileSync(TOKENS, "utf8");

describe("color math", () => {
  test("WCAG contrast matches known pairs", () => {
    assert.equal(round2(contrast("#777777", "#FFFFFF")), 4.48);
    assert.equal(round2(contrast("#000000", "#FFFFFF")), 21);
    assert.equal(round2(contrast("#FFFFFF", "#FFFFFF")), 1);
  });

  test("OKLCH of the provisional brand is as the spec says", () => {
    const { L, C, h } = hexToOklch("#8A63EA");
    assert.equal(L.toFixed(3), "0.607");
    assert.equal(C.toFixed(3), "0.195");
    assert.equal(h.toFixed(1), "293.0");
  });

  test("CVD separations reproduce 06 §4.2 for the fixed colors", () => {
    assert.equal(deltaE("#0B6E7A", "#A8243A").toFixed(1), "24.8");
    assert.equal(deltaE("#0B6E7A", "#A8243A", "deutan").toFixed(1), "10.9");
    assert.equal(deltaE("#875800", "#A8243A", "deutan").toFixed(1), "4.2");
  });
});

describe("derive-palette", () => {
  test("#8A63EA reproduces every derived value in the spec's table (06 §3)", () => {
    const p = derive("#8A63EA");
    const expect = {
      light: { primary: "#7F56DC", "primary-hover": "#6E43C8", "purple-text": "#764DD2", focus: "#764DD2", "purple-soft": "#EFECFE", selected: "#EBE8FE" },
      dark: { primary: "#A18BEC", "primary-hover": "#B3A1F5", "purple-text": "#A18BEC", focus: "#A18BEC", "purple-soft": "#2B2148", selected: "#2D2546" },
    };
    for (const mode of ["light", "dark"]) {
      for (const [k, v] of Object.entries(expect[mode])) assert.equal(p[mode].colors[k], v, `${mode} --${k}`);
    }
  });

  test("#8A63EA reproduces the spec's ratios (06 §4.1) for the pairs it lists", () => {
    const r = checkPalette(derive("#8A63EA"));
    const at = (fg, bg) => r.rows.find((x) => x.fg === fg && x.bg === bg);
    assert.deepEqual([at("on-primary", "primary").light, at("on-primary", "primary").dark], [4.92, 6.5]);
    assert.deepEqual([at("purple-text", "surface").light, at("purple-text", "surface").dark], [5.58, 6.09]);
    assert.deepEqual([at("ink", "canvas").light, at("ink", "canvas").dark], [15.72, 16.2]);
    assert.deepEqual([at("border", "sunken").light, at("border", "sunken").dark], [3.15, 4.43]);
    assert.deepEqual([at("on-brand", "brand").light, at("brand", "canvas").light], [4.16, 3.86]);
  });

  test("the brand in tokens.css is the logo tile, and tokens.css is regenerated from it", () => {
    assert.equal(brandFromTokens(css), "#8E5EFA");
    assert.equal(render(css, derive("#8E5EFA")), css, "run: node extension/ui/tools/derive-palette.mjs");
  });

  test("the shipped palette meets AA for every allowed pair in both themes", () => {
    const r = checkPalette(parseTokens(css));
    assert.deepEqual(r.failures, []);
    assert.equal(r.rows.length, PAIRS.length);
  });

  test("other brand inputs derive a passing ramp or name the failing pair", () => {
    // A blue-violet, a red-violet and a very dark purple (06 test plan).
    for (const brand of ["#6A5ACD", "#B0409A", "#3B1F6B"]) {
      let result;
      try {
        result = checkPalette(derive(brand));
      } catch (e) {
        assert.match(e.message, /No lightness meets the rule/);
        continue;
      }
      if (!result.ok) for (const f of result.failures) assert.match(f, /^[a-z-]+ (on|vs) [a-z-]+/);
      assert.equal(result.rows.length, PAIRS.length);
    }
  });

  test("a hue far from the tinted neutrals re-tints them", () => {
    const teal = derive("#00897B");
    assert.ok(teal.hueShift > 30);
    assert.notEqual(teal.light.colors.canvas, "#FAF6F0");
    assert.equal(derive("#8E5EFA").light.colors.canvas, "#FAF6F0");
  });
});

describe("tokens and components", () => {
  test("the dark theme applies under the media query and under data-theme, from the same block", () => {
    assert.match(css, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\)/);
    assert.match(css, /:root\[data-theme="dark"\]/);
    assert.match(css, /:root\[data-theme="light"\]/);
    assert.doesNotThrow(() => parseTokens(css));
  });

  test("tokens.css defines the type, space, radius, elevation and motion tokens", () => {
    for (const t of ["--t-caption", "--t-small", "--t-body", "--t-body-strong", "--t-lead", "--t-word", "--t-title", "--t-word-lg", "--t-headline", "--t-specimen"]) assert.ok(css.includes(`${t}:`), t);
    for (let i = 0; i <= 11; i++) assert.ok(css.includes(`--s-${i}:`), `--s-${i}`);
    for (const t of ["--r-xs", "--r-sm", "--r-md", "--r-lg", "--r-xl", "--r-full", "--e-1", "--e-2", "--e-3", "--d-fast", "--d-base", "--d-slow", "--d-swap", "--ease-standard", "--ease-enter", "--ease-exit"]) assert.ok(css.includes(`${t}:`), t);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /--font-display:/);
  });

  test("components and pages use tokens, never raw colors", () => {
    for (const file of ["ui/components.css", "ui/base.css", "popup.css"]) {
      const src = readExt(file).replace(/\/\*[\s\S]*?\*\//g, "");
      assert.doesNotMatch(src, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, `${file} has a raw color`);
    }
  });

  test("no remote fonts or resources in the UI files", () => {
    for (const file of ["ui/tokens.css", "ui/base.css", "ui/components.css", "popup.css", "popup.html"]) {
      assert.doesNotMatch(readExt(file), /@import|url\(\s*["']?https?:|<link[^>]+href="https?:|<script[^>]+src="https?:/i, file);
    }
  });

  test("no uppercase transforms and no letter spacing (06 §5.2)", () => {
    for (const file of ["ui/components.css", "ui/base.css", "popup.css"]) {
      assert.doesNotMatch(readExt(file), /text-transform:\s*uppercase|letter-spacing:\s*(?!inherit|normal|0\b)\S/i, file);
    }
  });
});
