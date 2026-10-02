// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Color math for the design system's tools (slice 06 §3-§4): sRGB hex, OKLab/OKLCH,
// WCAG 2.x contrast and color-vision-deficiency simulation. No dependencies.
// Development tooling only: nothing in the extension imports this file at runtime.

export function hexToRgb(hex) {
  const h = String(hex).trim().replace(/^#/, "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Not a hex color: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

export function rgbToHex(rgb) {
  return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// 8-bit sRGB -> linear-light RGB in 0..1.
export const linearRgb = (rgb) => rgb.map((v) => toLinear(v / 255));

export function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToOklch(hex) {
  const [L, a, b] = linearToOklab(linearRgb(hexToRgb(hex)));
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

const inGamut = (lin) => lin.every((c) => c >= -1e-6 && c <= 1 + 1e-6);

function oklchToLinear({ L, C, h }) {
  const rad = (h * Math.PI) / 180;
  return oklabToLinear([L, C * Math.cos(rad), C * Math.sin(rad)]);
}

// OKLCH -> hex. A color outside sRGB loses chroma in 0.005 steps until it fits (06 §3.1;
// the step size reproduces the spec's table, for example purple-soft #EFECFE).
export const GAMUT_STEP = 0.005;
export function oklchToHex({ L, C, h }) {
  let chroma = C;
  let lin = oklchToLinear({ L, C: chroma, h });
  while (!inGamut(lin) && chroma > 0) {
    chroma = Math.max(0, chroma - GAMUT_STEP);
    lin = oklchToLinear({ L, C: chroma, h });
  }
  return rgbToHex(lin.map((c) => toGamma(Math.max(0, Math.min(1, c))) * 255));
}

// WCAG 2.x relative luminance and contrast ratio.
export function luminance(hex) {
  const [r, g, b] = linearRgb(hexToRgb(hex));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Two decimals, as recorded in the spec.
export const round2 = (n) => Math.round(n * 100) / 100;

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear RGB.
export const CVD = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export function simulate(hex, kind) {
  const lin = linearRgb(hexToRgb(hex));
  if (!kind || kind === "normal") return lin;
  const m = CVD[kind];
  return m.map((row) => Math.max(0, Math.min(1, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])));
}

// OKLab distance x 100 between two colors as seen with a deficiency ("normal" for none).
export function deltaE(a, b, kind = "normal") {
  const [L1, a1, b1] = linearToOklab(simulate(a, kind));
  const [L2, a2, b2] = linearToOklab(simulate(b, kind));
  return Math.hypot(L1 - L2, a1 - a2, b1 - b2) * 100;
}
