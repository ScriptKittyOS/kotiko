// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Computes the WCAG 2.x contrast of every foreground/background pair the tokens allow
// (slice 06 §4.1) in both themes, from extension/ui/tokens.css, and fails if a text pair is
// under 4.5:1 or a non-text pair (control boundary, focus ring, shape) under 3:1. Also
// reports the color-vision checks of 06 §4.2 and fails if the primary purple and the
// danger color come within ΔE 8 of each other under any simulated deficiency.
//
//   node extension/ui/tools/contrast.mjs              check tokens.css
//   node extension/ui/tools/contrast.mjs --markdown   print the tables for the spec
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contrast, deltaE, round2 } from "./color.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKENS = path.resolve(HERE, "../tokens.css");

export const TEXT = 4.5;
export const NON_TEXT = 3;
export const LARGE_TEXT = 3;

// [foreground, background, use, minimum]. Pairs not listed here are not allowed in
// components (06 §4.1). The block after the spec's table adds pairs the popup (slice 20)
// uses: text and links on the status tints, and the failed-job line on the canvas.
export const PAIRS = [
  ["ink", "canvas", "Body text", TEXT],
  ["ink", "surface", "Body text", TEXT],
  ["ink", "sunken", "Body text", TEXT],
  ["ink", "selected", "Selected row text", TEXT],
  ["ink-2", "canvas", "Secondary text", TEXT],
  ["ink-2", "surface", "Secondary text", TEXT],
  ["ink-2", "selected", "Secondary on selected", TEXT],
  ["ink-3", "canvas", "Tertiary, placeholder", TEXT],
  ["ink-3", "surface", "Tertiary, placeholder", TEXT],
  ["ink-3", "sunken", "Tertiary on sunken", TEXT],
  ["ink-3", "selected", "Tertiary on selected", TEXT],
  ["on-brand", "brand", "Large text on the brand surface", LARGE_TEXT],
  ["on-primary", "primary", "Primary button label", TEXT],
  ["on-primary", "primary-hover", "Primary button hover", TEXT],
  ["purple-text", "surface", "Links, selected labels", TEXT],
  ["purple-text", "canvas", "Links", TEXT],
  ["purple-text", "sunken", "Links on sunken", TEXT],
  ["purple-text", "purple-soft", "Chip on", TEXT],
  ["purple-text", "selected", "Purple on selected", TEXT],
  ["orange-text", "surface", "Orange text", TEXT],
  ["orange-text", "canvas", "Orange text", TEXT],
  ["orange-text", "orange-soft", "Orange text on tint", TEXT],
  ["on-orange", "orange", "Text on orange", TEXT],
  ["blue", "surface", "Info text", TEXT],
  ["blue", "blue-soft", "Info on tint", TEXT],
  ["success", "surface", "Success text", TEXT],
  ["success", "success-soft", "Success on tint", TEXT],
  ["warning", "surface", "Warning text", TEXT],
  ["warning", "warning-soft", "Warning on tint", TEXT],
  ["danger", "surface", "Error text", TEXT],
  ["danger", "danger-soft", "Error on tint", TEXT],
  ["inverse-ink", "inverse-bg", "Toast text", TEXT],
  ["border", "surface", "Control boundary", NON_TEXT],
  ["border", "canvas", "Control boundary", NON_TEXT],
  ["border", "sunken", "Control boundary", NON_TEXT],
  ["focus", "surface", "Focus ring", NON_TEXT],
  ["focus", "canvas", "Focus ring", NON_TEXT],
  ["primary", "surface", "Primary button shape", NON_TEXT],
  ["primary", "canvas", "Primary button shape", NON_TEXT],
  ["orange", "surface", "Meter fill", NON_TEXT],
  ["brand", "canvas", "Brand tile or band edge", NON_TEXT],
  ["brand", "surface", "Brand tile or band edge", NON_TEXT],
  // Added with the popup (slice 20).
  ["ink", "warning-soft", "Banner text (state)", TEXT],
  ["ink", "blue-soft", "Banner text (info)", TEXT],
  ["ink", "danger-soft", "Banner text (blocking)", TEXT],
  ["ink-2", "sunken", "Secondary on sunken", TEXT],
  ["ink-2", "warning-soft", "Banner details", TEXT],
  ["ink-2", "blue-soft", "Banner details", TEXT],
  ["ink-2", "danger-soft", "Banner details", TEXT],
  ["purple-text", "warning-soft", "Link in a banner", TEXT],
  ["purple-text", "blue-soft", "Link in a banner", TEXT],
  ["purple-text", "danger-soft", "Link in a banner", TEXT],
  ["danger", "canvas", "Failed add line", TEXT],
  ["ink-3", "purple-soft", "Count on a chip that is on", TEXT],
  // Added with the word card (slice 19), whose surface is --surface-e2. The speak button
  // hovered or playing is purple-text on purple-soft, and a hovered action ink on sunken,
  // both above.
  ["ink", "surface-e2", "Word card: word, respelling, meaning", TEXT],
  ["ink-2", "surface-e2", "Word card: careful form, note, Also", TEXT],
  ["ink-3", "surface-e2", "Word card: romanization, label, language", TEXT],
  ["purple-text", "surface-e2", "Word card: speak icon, More", TEXT],
  ["success", "surface-e2", "Checked label's check mark", NON_TEXT],
  ["orange", "surface-e2", "The word's dotted underline", NON_TEXT],
  ["focus", "surface-e2", "Focus ring in the card", NON_TEXT],
  // Added with the dashboard (slice 21): menus on --surface-e2 (danger item), the selection
  // bar, add sheet and dialogs on --surface-e3, the selected row's bar and focus ring, the
  // confirm button, and the checkbox and form chips.
  ["danger", "surface-e2", "Menu: Delete all", TEXT],
  ["ink", "surface-e3", "Selection bar, add sheet, dialogs", TEXT],
  ["ink-2", "surface-e3", "Selection bar buttons, add lines", TEXT],
  ["ink-3", "surface-e3", "Add sheet: romanization, language", TEXT],
  ["purple-text", "surface-e3", "Selection bar: Select all", TEXT],
  ["danger", "surface-e3", "Selection bar: Delete; failed add", TEXT],
  ["surface", "danger", "Confirm button: delete a language", TEXT],
  ["primary", "selected", "Open row's bar, selected shelf card ring", NON_TEXT],
  ["focus", "selected", "Focus ring on a selected row", NON_TEXT],
  ["border", "selected", "Checkbox on a selected row", NON_TEXT],
  ["orange-text", "sunken", "Shelf: this week's adds on hover", TEXT],
];

// 06 §4.2 pairs, plus the brand's distance from danger (re-checked for every brand input).
export const CVD_PAIRS = [
  ["success", "danger"],
  ["success", "warning"],
  ["warning", "danger"],
  ["danger", "orange-text"],
  ["danger", "purple-text"],
  ["blue", "purple-text"],
  ["primary", "danger"],
];
export const CVD_KINDS = ["normal", "protan", "deutan", "tritan"];
const CVD_REQUIRED = { pair: ["primary", "danger"], min: 8 };

// Reads the generated color blocks of tokens.css into {light: {colors}, dark: {colors}}.
export function parseTokens(css) {
  const grab = (name) => {
    const m = css.match(new RegExp(`/\\* <generated:${name}> \\*/([\\s\\S]*?)/\\* </generated:${name}> \\*/`));
    if (!m) throw new Error(`tokens.css has no <generated:${name}> block.`);
    const colors = {};
    for (const [, k, v] of m[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) colors[k] = v.toUpperCase();
    return colors;
  };
  const light = grab("light");
  const dark = grab("dark");
  const darkMedia = grab("dark-media");
  if (JSON.stringify(dark) !== JSON.stringify(darkMedia)) {
    throw new Error("The two dark blocks in tokens.css differ; regenerate with derive-palette.mjs.");
  }
  return { light: { colors: light }, dark: { colors: dark } };
}

export function checkPalette(palette) {
  const rows = [];
  const failures = [];
  for (const [fg, bg, use, min] of PAIRS) {
    const row = { fg, bg, use, min };
    for (const mode of ["light", "dark"]) {
      const c = palette[mode].colors;
      if (!c[fg] || !c[bg]) throw new Error(`Token --${!c[fg] ? fg : bg} is missing in ${mode}.`);
      const ratio = round2(contrast(c[fg], c[bg]));
      row[mode] = ratio;
      if (ratio < min) failures.push(`${fg} on ${bg} (${mode}): ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
    rows.push(row);
  }
  const cvd = CVD_PAIRS.map(([a, b]) => {
    const row = { a, b };
    for (const kind of CVD_KINDS) {
      row[kind] = ["light", "dark"].map((m) => Math.round(deltaE(palette[m].colors[a], palette[m].colors[b], kind) * 10) / 10);
    }
    return row;
  });
  const req = cvd.find((r) => r.a === CVD_REQUIRED.pair[0] && r.b === CVD_REQUIRED.pair[1]);
  for (const kind of CVD_KINDS) {
    for (const [i, mode] of ["light", "dark"].entries()) {
      if (req[kind][i] < CVD_REQUIRED.min) failures.push(`primary vs danger under ${kind} (${mode}): ΔE ${req[kind][i]}, needs ${CVD_REQUIRED.min}`);
    }
  }
  return { ok: failures.length === 0, rows, cvd, failures };
}

export function formatReport({ rows, cvd, failures }, { markdown = false } = {}) {
  const lines = [];
  if (markdown) {
    lines.push("| Foreground | Background | Use | Needs | Light | Dark |", "|---|---|---|---|---|---|");
    for (const r of rows) lines.push(`| \`${r.fg}\` | \`${r.bg}\` | ${r.use} | ${r.min} | ${r.light.toFixed(2)} | ${r.dark.toFixed(2)} |`);
    lines.push("", "| Pair (light / dark) | Normal | Protan | Deutan | Tritan |", "|---|---|---|---|---|");
    for (const r of cvd) lines.push(`| ${r.a} vs ${r.b} | ${CVD_KINDS.map((k) => r[k].join(" / ")).join(" | ")} |`);
  } else {
    lines.push(`${"foreground".padEnd(13)} ${"background".padEnd(13)} needs  light   dark`);
    for (const r of rows) {
      const flag = (v) => (v < r.min ? "!" : " ");
      lines.push(`${r.fg.padEnd(13)} ${r.bg.padEnd(13)} ${String(r.min).padEnd(5)} ${r.light.toFixed(2).padStart(6)}${flag(r.light)} ${r.dark.toFixed(2).padStart(6)}${flag(r.dark)}`);
    }
    lines.push("", "ΔE OKLab x100 (light / dark): " + CVD_KINDS.join(", "));
    for (const r of cvd) lines.push(`${`${r.a} vs ${r.b}`.padEnd(26)} ${CVD_KINDS.map((k) => r[k].join(" / ").padEnd(12)).join(" ")}`);
  }
  lines.push("");
  lines.push(failures.length ? `FAIL: ${failures.length} pair(s) below the minimum:\n  ${failures.join("\n  ")}` : `OK: all ${rows.length} pairs meet WCAG 2.2 AA in both themes.`);
  return lines.join("\n");
}

function main(argv) {
  const palette = parseTokens(fs.readFileSync(TOKENS, "utf8"));
  const result = checkPalette(palette);
  console.log(formatReport(result, { markdown: argv.includes("--markdown") }));
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
