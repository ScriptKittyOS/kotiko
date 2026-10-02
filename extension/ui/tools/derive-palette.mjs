// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Derives Kotiko's color tokens from one brand purple (the logo tile) and writes them into
// extension/ui/tokens.css between the <generated:…> markers (slice 06 §3.1). Then runs the
// contrast check (contrast.mjs) and fails if any required pair is below AA.
//
//   node extension/ui/tools/derive-palette.mjs            brand from tokens.css (#8E5EFA)
//   node extension/ui/tools/derive-palette.mjs '#8E5EFA'  a new brand input
//   node extension/ui/tools/derive-palette.mjs --check    fail if tokens.css is stale
//   node extension/ui/tools/derive-palette.mjs --print    print the palette, write nothing
//
// When the final logo lands: run this with the tile color, then contrast.mjs, then update
// the tables in slices/06-design-system/SPEC.md from the output. If a pair fails, adjust
// the failing rule's L target here, never the threshold.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contrast, hexToOklch, oklchToHex } from "./color.mjs";
import { checkPalette, formatReport } from "./contrast.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TOKENS = path.resolve(HERE, "../tokens.css");

// The hue the fixed neutrals are tinted toward (the provisional brand's, 06 §3).
const NEUTRAL_HUE = 293.0;
const NEUTRALS = ["canvas", "surface", "sunken", "ink", "ink-2", "ink-3", "border", "divider", "inverse-bg", "inverse-ink", "surface-e2", "surface-e3"];

// Fixed values (06 §3 table). Purple rows marked "derived" are computed below.
const FIXED = {
  light: {
    "on-brand": "#FFFFFF",
    canvas: "#FAF6F0",
    surface: "#FFFFFF",
    sunken: "#F3EDE4",
    ink: "#1F1A2B",
    "ink-2": "#544C63",
    "ink-3": "#6B6379",
    border: "#8A8299",
    divider: "#E4DCD0",
    "on-primary": "#FFFFFF",
    orange: "#B4501A",
    "on-orange": "#FFFFFF",
    "orange-text": "#A3440F",
    "orange-soft": "#FBE6D6",
    blue: "#1F5FC0",
    "blue-soft": "#E2ECFA",
    success: "#0B6E7A",
    "success-soft": "#DDF1F3",
    warning: "#875800",
    "warning-soft": "#FBEFD3",
    danger: "#A8243A",
    "danger-soft": "#FBE3E6",
    "inverse-bg": "#1F1A2B",
    "inverse-ink": "#FAF6F0",
    // Raised surfaces (06 §8): light uses shadows on white.
    "surface-e2": "#FFFFFF",
    "surface-e3": "#FFFFFF",
  },
  dark: {
    "on-brand": "#FFFFFF",
    canvas: "#14121C",
    surface: "#1C1928",
    sunken: "#110F18",
    ink: "#F2EEF8",
    "ink-2": "#C4BCD4",
    "ink-3": "#A39BB5",
    border: "#7E7693",
    divider: "#2E2940",
    "on-primary": "#16102A",
    orange: "#F08A4B",
    "on-orange": "#1C0F06",
    "orange-text": "#F6A672",
    "orange-soft": "#3A2418",
    blue: "#8DBBFF",
    "blue-soft": "#1C2740",
    success: "#56C7D9",
    "success-soft": "#122F36",
    warning: "#F2C14E",
    "warning-soft": "#33280F",
    danger: "#FF6F8A",
    "danger-soft": "#3A1A22",
    "inverse-bg": "#F2EEF8",
    "inverse-ink": "#14121C",
    // Dark elevation uses lighter surfaces, because shadows vanish (06 §8).
    "surface-e2": "#252135",
    "surface-e3": "#2C2642",
  },
};

const ELEVATION = {
  light: {
    "e-1": "0 1px 2px rgb(31 26 43 / 0.06), 0 1px 1px rgb(31 26 43 / 0.04)",
    "e-2": "0 8px 24px rgb(31 26 43 / 0.12), 0 2px 6px rgb(31 26 43 / 0.08)",
    "e-3": "0 24px 48px rgb(31 26 43 / 0.18)",
  },
  dark: {
    "e-1": "inset 0 1px 0 rgb(255 255 255 / 0.04)",
    "e-2": "0 8px 24px rgb(0 0 0 / 0.5), 0 0 0 1px rgb(255 255 255 / 0.08)",
    "e-3": "0 24px 48px rgb(0 0 0 / 0.6)",
  },
};

const lighter = (lch, dL) => ({ ...lch, L: lch.L + dL });

// Lowers (step < 0) or raises L in 0.01 steps until ok(hex), from `start`.
function walk(start, step, ok) {
  let lch = { ...start };
  let hex = oklchToHex(lch);
  for (let i = 0; i < 100 && !ok(hex); i++) {
    lch = lighter(lch, step);
    hex = oklchToHex(lch);
  }
  if (!ok(hex)) throw new Error(`No lightness meets the rule from ${oklchToHex(start)}.`);
  return { lch, hex };
}

// The derived tokens for one brand input (06 §3.1).
export function derive(brandHex) {
  const brand = hexToOklch(brandHex);
  const { h, C } = brand;
  const light = {};
  const dark = {};

  // Light primary: the brand if white on it is >= 4.8:1, else darker in 0.01 L steps.
  const primary = walk(brand, -0.01, (hex) => contrast("#FFFFFF", hex) >= 4.8);
  light.primary = primary.hex;
  light["primary-hover"] = oklchToHex(lighter(primary.lch, -0.06));
  light["purple-soft"] = oklchToHex({ L: 0.95, C: 0.035, h });
  light.selected = oklchToHex({ L: 0.94, C: 0.03, h });
  // Purple text: darker still until >= 4.5:1 on every light background it sits on.
  const textBgs = [FIXED.light.surface, FIXED.light.canvas, FIXED.light.sunken, light.selected, light["purple-soft"]];
  light["purple-text"] = walk(primary.lch, -0.01, (hex) => textBgs.every((bg) => contrast(hex, bg) >= 4.5)).hex;
  light.focus = light["purple-text"];

  // Dark primary, purple text and focus: chroma capped at 0.14, lighter until >= 6:1 on
  // the dark surface.
  const darkStart = { L: brand.L, C: Math.min(C, 0.14), h };
  const darkPrimary = walk(darkStart, 0.01, (hex) => contrast(hex, FIXED.dark.surface) >= 6);
  dark.primary = darkPrimary.hex;
  dark["purple-text"] = darkPrimary.hex;
  dark.focus = darkPrimary.hex;
  dark["primary-hover"] = oklchToHex({ L: darkPrimary.lch.L + 0.06, C: Math.min(darkPrimary.lch.C, 0.12), h });
  dark["purple-soft"] = oklchToHex({ L: 0.28, C: 0.07, h });
  dark.selected = oklchToHex({ L: 0.29, C: 0.06, h });

  // Neutrals are re-tinted only when the brand hue moves more than 30 degrees.
  const hueShift = Math.abs(((h - NEUTRAL_HUE + 540) % 360) - 180);
  const retint = (hex) => {
    if (hueShift <= 30) return hex;
    const n = hexToOklch(hex);
    return n.C < 0.002 ? hex : oklchToHex({ L: n.L, C: n.C, h });
  };

  const theme = (fixed, derived, mode) => {
    const out = { brand: brandHex.toUpperCase() };
    for (const [k, v] of Object.entries(fixed)) out[k] = NEUTRALS.includes(k) ? retint(v) : v;
    Object.assign(out, derived);
    return { colors: out, elevation: ELEVATION[mode] };
  };
  return { brand: brandHex.toUpperCase(), oklch: brand, hueShift, light: theme(FIXED.light, light, "light"), dark: theme(FIXED.dark, dark, "dark") };
}

// Token order in the CSS, grouped by role.
const ORDER = [
  "brand", "on-brand",
  "canvas", "surface", "surface-e2", "surface-e3", "sunken", "selected",
  "ink", "ink-2", "ink-3", "border", "divider",
  "primary", "primary-hover", "on-primary", "purple-text", "purple-soft", "focus",
  "orange", "on-orange", "orange-text", "orange-soft",
  "blue", "blue-soft", "success", "success-soft", "warning", "warning-soft", "danger", "danger-soft",
  "inverse-bg", "inverse-ink",
];

function block({ colors, elevation }, indent) {
  const lines = ORDER.map((k) => `${indent}--${k}: ${colors[k]};`);
  for (const [k, v] of Object.entries(elevation)) lines.push(`${indent}--${k}: ${v};`);
  return lines.join("\n");
}

// Replaces the text between <generated:name> markers, keeping the markers' indentation.
export function render(css, palette) {
  const fill = (src, name, theme) => {
    const re = new RegExp(`([ \\t]*)/\\* <generated:${name}> \\*/\\n[\\s\\S]*?([ \\t]*)/\\* </generated:${name}> \\*/`);
    if (!re.test(src)) throw new Error(`tokens.css has no <generated:${name}> markers.`);
    return src.replace(re, (_m, a, b) => `${a}/* <generated:${name}> */\n${block(theme, a)}\n${b}/* </generated:${name}> */`);
  };
  let out = fill(css, "light", palette.light);
  out = fill(out, "dark-media", palette.dark);
  out = fill(out, "dark", palette.dark);
  return out;
}

export function brandFromTokens(css) {
  return css.match(/--brand:\s*(#[0-9a-f]{6})/i)?.[1] ?? null;
}

function main(argv) {
  const check = argv.includes("--check");
  const print = argv.includes("--print");
  const input = argv.find((a) => /^#?[0-9a-f]{6}$/i.test(a));
  const css = fs.readFileSync(TOKENS, "utf8");
  const brandHex = input ? (input.startsWith("#") ? input : `#${input}`) : brandFromTokens(css);
  if (!brandHex) throw new Error("No brand color given and none found in tokens.css.");

  const palette = derive(brandHex);
  const { oklch } = palette;
  console.log(
    `Brand ${palette.brand}: OKLCH L ${oklch.L.toFixed(3)}, C ${oklch.C.toFixed(3)}, h ${oklch.h.toFixed(1)}` +
      ` (neutrals ${palette.hueShift > 30 ? "re-tinted" : "unchanged"}, hue shift ${palette.hueShift.toFixed(1)} deg)`,
  );
  const derivedKeys = ["primary", "primary-hover", "purple-text", "focus", "purple-soft", "selected"];
  for (const k of derivedKeys) console.log(`  --${k.padEnd(14)} light ${palette.light.colors[k]}  dark ${palette.dark.colors[k]}`);

  const result = checkPalette(palette);
  console.log("\n" + formatReport(result));

  if (!print) {
    const next = render(css, palette);
    if (check) {
      if (next !== css) {
        console.error("\ntokens.css is out of date. Run: node extension/ui/tools/derive-palette.mjs");
        process.exitCode = 1;
      } else {
        console.log("\ntokens.css matches the derived palette.");
      }
    } else if (next !== css) {
      fs.writeFileSync(TOKENS, next);
      console.log(`\nWrote ${path.relative(process.cwd(), TOKENS)}.`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
