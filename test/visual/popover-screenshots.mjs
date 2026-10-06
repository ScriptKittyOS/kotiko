// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Screenshots of the word card (slice 19) with its speak button (slice 34) on a light and a
// dark fixture page, with the browser in English and in Spanish: Russian with stress and a
// careful form, Mandarin with tones, Japanese with its kana reading, a word with no
// pronunciation, a checked one, the learner's own, a "differs" one, and the toast. For
// design review; not part of CI.
//
//   node test/visual/popover-screenshots.mjs [outDir]
//
// Chromium with the unpacked extension against the local fixture server, like the e2e
// fixtures; a stubbed voice list (macOS's) so the speaker shows. KOTIKO_E2E_CHROMIUM picks
// another Chromium build. Default outDir: ./popover-shots. Prints the files it wrote.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startFixtureServer } from "../helpers/fixture-server.mjs";
import { POPOVER_WORDS } from "../helpers/popover-words.mjs";
import { stubSpeech, voiceLists } from "../helpers/speech-stub.mjs";

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension");
const OUT = path.resolve(process.argv[2] ?? "popover-shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(lang) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kotiko-pop-shots-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    executablePath: process.env.KOTIKO_E2E_CHROMIUM || undefined,
    headless: true,
    locale: lang,
    viewport: { width: 720, height: 520 },
    deviceScaleFactor: 2,
    env: { ...process.env, LANGUAGE: lang, LANG: lang === "es" ? "es_ES.UTF-8" : "en_US.UTF-8" },
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      `--lang=${lang}`,
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      "--no-first-run",
    ],
  });
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (["http:", "https:"].includes(u.protocol) && !["127.0.0.1", "localhost"].includes(u.hostname)) return route.abort();
    return route.continue();
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  return { context, sw, userDataDir };
}

// The first swapped word on the page whose text is `native`.
const wordLocator = (page, native) => page.locator("kotiko-w", { hasText: native }).first();

async function run() {
  await fs.mkdir(OUT, { recursive: true });
  const srv = await startFixtureServer();
  const control = (body) => fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify(body) });
  await control({ reset: true });
  await control({ words: POPOVER_WORDS });
  const voices = voiceLists().macos;
  const written = [];
  try {
    for (const lang of ["en", "es"]) {
      const { context, sw, userDataDir } = await launch(lang);
      // Through the background's own copy: storage.local is only its mirror (SCR-448).
      await sw.evaluate((o) => globalThis.__kotiko.seed({ words: o.words, enabled: true, lastSync: Date.now() }), { words: POPOVER_WORDS });
      // Connects as the settings do (slice 28: an address written to storage.local is ignored).
      const setupPage = await context.newPage();
      await setupPage.goto(`chrome-extension://${new URL(sw.url()).host}/privacy.html`);
      await setupPage.evaluate((m) => chrome.runtime.sendMessage(m), { type: "server.connect", url: `${srv.url}/kotiko`, token: srv.token });
      await setupPage.close();
      const shots = [
        ["ru-stress-careful", "popover-light.html", "пожалуйста"],
        ["zh-tones-also-note", "popover-light.html", "谢谢"],
        ["ja-reading", "popover-light.html", "犬"],
        ["ar-no-pronunciation", "popover-light.html", "كتاب"],
        ["ru-checked", "popover-light.html", "хорошо"],
        ["es-learner-own", "popover-light.html", "agua"],
        ["ru-differs", "popover-light.html", "замок"],
        ["ru-in-clipped-card-flips-above", "popover-light.html", "спасибо"],
        ["en-dog-for-spanish-reader", "popover-light.html", "dog"],
        ["dark-ru-stress-careful", "popover-dark.html", "пожалуйста"],
        ["dark-zh-tones", "popover-dark.html", "谢谢"],
        ["dark-ja-reading", "popover-dark.html", "犬"],
        ["dark-ar-no-pronunciation", "popover-dark.html", "كتاب"],
        ["dark-ru-checked", "popover-dark.html", "хорошо"],
      ];
      for (const [name, file, native] of shots) {
        const page = await context.newPage();
        await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
        await page.goto(srv.url + "/pages/" + file);
        const target = wordLocator(page, native);
        await target.waitFor();
        await stubSpeech(page, voices);
        await target.hover();
        await sleep(600);
        const out = path.join(OUT, `${name}-${lang}.png`);
        await page.screenshot({ path: out, animations: "disabled" });
        written.push(out);
        await page.close();
      }
      // Keyboard focus on the speak button, and the standalone toast.
      {
        const page = await context.newPage();
        await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
        await page.goto(srv.url + "/pages/popover-light.html");
        await wordLocator(page, "пожалуйста").waitFor();
        await stubSpeech(page, voices);
        await page.evaluate(() => {
          const w = document.querySelector("kotiko-w");
          getSelection().selectAllChildren(w);
        });
        await sw.evaluate(async () => {
          const [tab] = await chrome.tabs.query({ active: true });
          await chrome.tabs.sendMessage(tab.id, { type: "reveal-word" });
        });
        await sleep(500);
        let out = path.join(OUT, `keyboard-focus-${lang}.png`);
        await page.screenshot({ path: out, animations: "disabled" });
        written.push(out);
        await page.keyboard.press("Escape");
        await page.evaluate(() => getSelection().removeAllRanges());
        await sw.evaluate(async () => {
          const [tab] = await chrome.tabs.query({ active: true });
          await chrome.tabs.sendMessage(tab.id, { type: "reveal-word" });
        });
        await sleep(400);
        out = path.join(OUT, `toast-${lang}.png`);
        await page.screenshot({ path: out, animations: "disabled" });
        written.push(out);
        await page.close();
      }
      await context.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  } finally {
    await srv.close();
  }
  for (const f of written) console.log(f);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
