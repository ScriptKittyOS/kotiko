// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The README's demo GIF: the same article as you'd read it, then with your words swapped in,
// then a word's card open. Made from the real extension (Chromium, the unpacked
// extension, test/fixtures/pages/store-article.html), so it's regenerated when the
// interface changes. Not part of CI. Needs ImageMagick (`convert`).
//
//   node test/visual/readme-demo.mjs [out.gif]
//
// Default output: brand/demo/kotiko-demo.gif. The words are the store screenshots' set
// (test/visual/store-screenshots.mjs), for a reader of English pages.
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startFixtureServer } from "../helpers/fixture-server.mjs";
import { readCard } from "../helpers/closed-shadow.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXT_DIR = path.join(ROOT, "extension");
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, "brand/demo/kotiko-demo.gif"));
const SIZE = { width: 1100, height: 560 };
const WORDS = [
  { lang: "es", native: "perro", gloss: "dog", forms: ["dog", "dogs"], pronunciation: "PEH-rro" },
  { lang: "es", native: "agua", gloss: "water", forms: ["water"], pronunciation: "AH-gwa" },
  { lang: "es", native: "amigo", gloss: "friend", forms: ["friend"], pronunciation: "ah-MEE-go" },
  { lang: "ja", native: "猫", gloss: "cat", forms: ["cat", "cats"], romanization: "neko", pronunciation: "neh-koh" },
  { lang: "ja", native: "本", gloss: "book", forms: ["book", "books"], romanization: "hon", pronunciation: "hohn" },
  { lang: "ja", native: "ありがとう", gloss: "thanks", forms: ["thanks", "thank you"], romanization: "arigatō", pronunciation: "ah-ree-gah-toh" },
  { lang: "ru", native: "дом", gloss: "house", forms: ["house"], romanization: "dom", pronunciation: "DOM" },
];
const HOVER = ["perro", "agua"];

async function run() {
  const srv = await startFixtureServer();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kotiko-readme-demo-"));
  const frames = await fs.mkdtemp(path.join(os.tmpdir(), "kotiko-readme-frames-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    executablePath: process.env.KOTIKO_E2E_CHROMIUM || undefined,
    headless: true,
    locale: "en",
    viewport: SIZE,
    deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, "--lang=en", "--no-first-run"],
  });
  try {
    await context.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (["http:", "https:"].includes(u.protocol) && !["127.0.0.1", "localhost"].includes(u.hostname)) return route.abort();
      return route.continue();
    });
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const base = `chrome-extension://${new URL(sw.url()).host}/`;
    // Past the first run, with the words saved and Kotiko off for the first frame.
    // Through the background's own copy (`__kotiko.seed`; storage.local is only its mirror).
    await sw.evaluate(async () => {
      for (let i = 0; i < 100 && !(await globalThis.__kotiko.area.get("onboarding")).onboarding; i++) await new Promise((r) => setTimeout(r, 50));
      const ui = { uiLang: "auto", baseLangs: ["en"], baseLangsConfirmed: true };
      const seedSalt = "0123456789abcdef0123456789abcdef";
      await chrome.storage.sync.set({ ui, seedSalt });
      await globalThis.__kotiko.seed({ ui, seedSalt, baseLangs: ["en"], onboarding: { completedAt: Date.now(), skipped: false, version: 2 }, mixing: { mode: "mix" }, celebrations: null });
    });
    const setup = await context.newPage();
    await setup.goto(`${base}dashboard.html`);
    const res = await setup.evaluate((words) => chrome.runtime.sendMessage({ type: "words.save", words }), WORDS.map((w) => ({ ...w, base_lang: "en", origin: "manual", pronunciation_source: "user" })));
    if (res?.error) throw new Error(`words.save: ${JSON.stringify(res)}`);
    await setup.evaluate(() => chrome.runtime.sendMessage({ type: "settings.set", set: { enabled: false } }));
    await new Promise((r) => setTimeout(r, 500));

    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(srv.pageUrl("store-article.html"));
    await page.waitForTimeout(800);
    const shot = async (name) => {
      const file = path.join(frames, `${name}.png`);
      await page.screenshot({ path: file, animations: "disabled" });
      return file;
    };
    const before = await shot("1-before");

    // Kotiko on, from an extension page: the open tab swaps in place.
    await setup.evaluate(() => chrome.runtime.sendMessage({ type: "settings.set", set: { enabled: true } }));
    await page.locator("kotiko-w").first().waitFor();
    await page.waitForTimeout(500);
    const after = await shot("2-after");

    const shown = await page.locator("kotiko-w").allTextContents();
    const pick = HOVER.find((w) => shown.includes(w));
    if (!pick) throw new Error(`None of ${HOVER.join(", ")} is swapped; swapped: ${shown.join(", ")}`);
    await page.locator("kotiko-w", { hasText: pick }).first().hover();
    for (let i = 0; i < 40 && !(await readCard(page))?.open; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(600);
    const card = await shot("3-card");

    // Each frame holds, with a short cross-fade between them; 800 px wide, 64 colors.
    await fs.mkdir(path.dirname(OUT), { recursive: true });
    execFileSync("convert", [
      "-delay", "180", before, "-delay", "8", "(", before, after, "-morph", "6", ")", "-delay", "220", after,
      "-delay", "8", "(", after, card, "-morph", "4", ")", "-delay", "320", card,
      "-resize", "800x", "-colors", "64", "-layers", "Optimize", "-loop", "0", OUT,
    ]);
    const { size } = await fs.stat(OUT);
    console.log(`${OUT} (${Math.round(size / 1024)} KB)`);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.rm(frames, { recursive: true, force: true });
    await srv.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
