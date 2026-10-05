// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 17 in the browser: swapped words in taller scripts never change a line's height,
// and right-to-left swaps keep punctuation on the correct side. Chromium runs the real
// extension; Firefox (when installed) checks the same stylesheet on its own.
import fs from "node:fs";
import path from "node:path";
import { firefox } from "@playwright/test";
import { test, expect, EXT_DIR } from "./fixtures.mjs";

const w = (id, lang, native, english, base_lang = "en") => ({ id, lang, language: null, native, romanization: null, english, forms: [english], note: null, base_lang });

// Stores the words and the connection directly, as popover.spec.mjs does, for a learner
// who reads `bases`.
async function setup({ server, serviceWorker }, words, bases) {
  await server.control({ words });
  await expect.poll(() => serviceWorker.evaluate(async () => !!(await chrome.storage.local.get("onboarding")).onboarding)).toBe(true);
  await serviceWorker.evaluate(async (o) => {
    await chrome.storage.sync.set({ ui: { uiLang: "auto", baseLangs: o.bases, baseLangsConfirmed: true } });
    await chrome.storage.local.set({ serverUrl: o.url, token: o.token, words: o.words, enabled: true, lastSync: Date.now() });
  }, { url: server.kotikoUrl, token: server.token, words, bases });
  await expect.poll(() => serviceWorker.evaluate(async () => Object.keys((await chrome.storage.local.get("baseRules")).baseRules ?? {}).sort().join())).toBe([...bases].sort().join());
}

const TALL = [
  w(1, "zh-Hans", "谢谢", "thanks"),
  w(2, "ja", "犬", "dog"),
  w(3, "hi", "पानी", "water"),
  w(4, "th", "หนังสือ", "book"),
  w(5, "my", "ရဲတိုက်", "castle"),
];

test("swapped Chinese, Japanese, Devanagari, Thai and Myanmar words keep every line's height (normal and 1.6)", async ({ context, server, serviceWorker }) => {
  await setup({ server, serviceWorker }, TALL, ["en"]);
  const page = await context.newPage();
  await page.goto(server.page("scripts-line-height.html"));
  await expect(page.locator("kotiko-w")).toHaveCount(10);
  const rows = await page.evaluate(() => [...document.querySelectorAll("p")].map((p) => ({ id: p.id, before: Number(p.dataset.before), after: p.getBoundingClientRect().height, swapped: p.querySelector("kotiko-w")?.textContent })));
  for (const r of rows) {
    expect(r.swapped, r.id).toBeTruthy();
    expect(Math.abs(r.after - r.before), `${r.id}: ${r.before} -> ${r.after}`).toBeLessThanOrEqual(1);
  }
});

// Where a character is drawn: its left and right edges.
const edges = (page, id) =>
  page.evaluate((id) => {
    const p = document.getElementById(id);
    const word = p.querySelector("kotiko-w").getBoundingClientRect();
    const at = (ch) => {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement.localName === "kotiko-w") continue;
        const i = n.data.indexOf(ch);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const b = r.getBoundingClientRect();
        return { left: b.left, right: b.right };
      }
      return null;
    };
    return { word: { left: word.left, right: word.right }, bang: at("!"), open: at("("), close: at(")") };
  }, id);

test("right-to-left swaps keep the page's punctuation on the correct side", async ({ context, server, serviceWorker }) => {
  await setup({ server, serviceWorker }, [w(1, "ar", "شكرا", "thanks"), w(2, "es", "gracias", "شكرا", "ar")], ["en", "ar"]);
  const page = await context.newPage();
  await page.goto(server.page("rtl.html"));
  await expect(page.locator("#en-bang kotiko-w")).toHaveText("شكرا");
  await expect(page.locator("#ar-paren kotiko-w")).toHaveText("gracias");

  // An English line: "شكرا!" with the "!" after the word, to its right.
  const bang = await edges(page, "en-bang");
  expect(bang.bang.left).toBeGreaterThanOrEqual(bang.word.right - 0.5);
  // "(شكرا)": the parentheses around the word, opening on the left.
  const paren = await edges(page, "en-paren");
  expect(paren.open.right).toBeLessThanOrEqual(paren.word.left + 0.5);
  expect(paren.close.left).toBeGreaterThanOrEqual(paren.word.right - 0.5);
  // An Arabic line: "(gracias)" read right to left, so the opening parenthesis is on the right.
  const ar = await edges(page, "ar-paren");
  expect(ar.open.left).toBeGreaterThanOrEqual(ar.word.right - 0.5);
  expect(ar.close.right).toBeLessThanOrEqual(ar.word.left + 0.5);
  // No bidi control characters were added to the page.
  expect(await page.evaluate(() => /[‎‏‪-‮⁦-⁩]/.test(document.body.textContent))).toBe(false);
});

// The same stylesheet in Firefox, without the extension: a line with Kotiko's elements
// holding taller scripts is as tall as the same line in English.
test("Firefox: Kotiko's stylesheet keeps line heights too", async () => {
  let browser;
  try {
    browser = await firefox.launch();
  } catch {
    test.skip(true, "Firefox isn't installed (npx playwright install firefox)");
    return;
  }
  try {
    const page = await browser.newPage();
    const css = fs.readFileSync(path.join(EXT_DIR, "content.css"), "utf8");
    const line = (cls, inner) => `<p class="${cls}">Many ${inner} for the help.</p>`;
    const words = TALL.map((x) => `<kotiko-w lang="${x.lang}" dir="auto">${x.native}</kotiko-w>`);
    await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css} body{font:16px serif} p{white-space:nowrap;margin:0} .tall{line-height:1.6}</style></head><body>
      ${["", "tall"].map((cls) => [line(cls, "thanks"), ...words.map((x) => line(cls, x))].join("")).join("")}</body></html>`);
    const heights = await page.evaluate(() => [...document.querySelectorAll("p")].map((p) => p.getBoundingClientRect().height));
    const per = TALL.length + 1;
    for (const group of [heights.slice(0, per), heights.slice(per)]) {
      for (const h of group.slice(1)) expect(Math.abs(h - group[0])).toBeLessThanOrEqual(1);
    }
  } finally {
    await browser.close();
  }
});
