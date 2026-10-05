// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Screenshots of the popup (slice 20) in every state it has today, in light and dark, with
// the browser in English and in Spanish. For design review; not part of CI.
//
//   node test/visual/popup-screenshots.mjs [outDir]
//
// Chromium with the unpacked extension against the local fixture server, like the e2e
// fixtures; popup.html opens in a 360 px tab. KOTIKO_E2E_CHROMIUM picks another Chromium
// build. Default outDir: ./popup-shots. Prints the files it wrote.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startFixtureServer } from "../helpers/fixture-server.mjs";

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension");
const OUT = path.resolve(process.argv[2] ?? "popup-shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const w = (id, lang, language, native, romanization, english) => ({
  id, lang, language, native, romanization, english, forms: [english], note: null,
});
const WORDS = [
  w(1, "ru", "Russian", "спасибо", "spasibo", "thanks"),
  w(2, "ru", "Russian", "дом", "dom", "house"),
  w(3, "ru", "Russian", "кошка", "koshka", "cat"),
  w(4, "ar", "Arabic", "شكرا", "shukran", "thanks"),
  w(5, "ar", "Arabic", "كتاب", "kitab", "book"),
  w(6, "ja", "Japanese", "犬", "inu", "dog"),
  w(7, "es", "Spanish", "gracias", null, "thanks"),
  w(8, "es", "Spanish", "agua", null, "water"),
];
const MANY = [
  ...WORDS,
  w(9, "zh", "Chinese", "谢谢", "xièxie", "thanks"),
  w(10, "ko", "Korean", "고마워", "gomawo", "thanks"),
  w(11, "tr", "Turkish", "teşekkürler", null, "thanks"),
  w(12, "hi", "Hindi", "धन्यवाद", "dhanyavaad", "thanks"),
  w(13, "el", "Greek", "ευχαριστώ", "efcharistó", "thanks"),
  w(14, "he", "Hebrew", "תודה", "toda", "thanks"),
  w(15, "pt", "Portuguese", "obrigado", null, "thanks"),
  w(16, "de", "German", "Hund", null, "dog"),
  w(17, "id", "Indonesian", "terima kasih", null, "thanks"),
];

async function launch(lang) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kotiko-shots-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    executablePath: process.env.KOTIKO_E2E_CHROMIUM || undefined,
    headless: true,
    locale: lang,
    viewport: { width: 360, height: 600 },
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
  const id = new URL(sw.url()).host;
  return { context, sw, url: `chrome-extension://${id}/popup.html`, userDataDir };
}

async function shoot({ context, url }, name, { scheme, setup, act, waitMs = 250, tabUrl = "https://en.wikipedia.org/wiki/Cat", noPermission = false, slowStorage = 0 }) {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.goto("about:blank");
  // Stand-ins for the browser around the popup, set before popup.js runs: the active tab,
  // the host permission and slow storage.
  await page.addInitScript((o) => {
    if (!globalThis.chrome?.tabs) return;
    const tab = { id: 1, active: true, url: o.tabUrl };
    chrome.tabs.query = async () => [tab];
    if (o.noPermission) chrome.permissions.contains = async () => false;
    if (o.slowStorage) {
      const get = chrome.storage.local.get.bind(chrome.storage.local);
      chrome.storage.local.get = (k) => new Promise((r) => setTimeout(() => r(get(k)), o.slowStorage));
    }
  }, { tabUrl, noPermission, slowStorage });
  await page.goto(url);
  await page.evaluate(() => chrome.storage.local.clear());
  if (setup) await setup(page);
  await page.reload();
  if (act) await act(page);
  await sleep(waitMs);
  const file = path.join(OUT, `${name}.png`);
  await page.locator("body").screenshot({ path: file, animations: "disabled" });
  await page.close();
  return file;
}

const set = (page, items) => page.evaluate((i) => chrome.storage.local.set(i), items);
// Connects as the settings do (slice 28: an address or token written to storage.local is ignored).
const connect = (page, url, token) => page.evaluate((m) => chrome.runtime.sendMessage(m), { type: "server.connect", url, token });

async function run() {
  await fs.mkdir(OUT, { recursive: true });
  const srv = await startFixtureServer();
  const control = (body) => fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify(body) });
  const connected = (extra = {}) => async (page) => {
    await control({ reset: true });
    await control({ words: extra.words ?? WORDS });
    await connect(page, `${srv.url}/kotiko`, srv.token);
    await set(page, {
      words: extra.words ?? WORDS,
      lastSync: Date.now() - 120_000,
      syncError: null,
      ...extra.local,
    });
  };
  const written = [];
  try {
    for (const lang of ["en", "es"]) {
      const browser = await launch(lang);
      const schemes = ["light", "dark"];
      for (const scheme of schemes) {
        const tag = `${lang}-${scheme}`;
        const s = (name, opts) => shoot(browser, `${name}-${tag}`, { scheme, ...opts }).then((f) => written.push(f));

        await s("A-first-run", {});
        await s("B-empty", { setup: connected({ words: [] }) });
        await s("C-normal", { setup: connected() });
        await s("C-only", { setup: connected({ local: { hiddenLangs: ["ar", "ja", "es"] } }) });
        await s("C-some-hidden", { setup: connected({ local: { hiddenLangs: ["ja"] } }) });
        await s("C-many-languages", { setup: connected({ words: MANY }) });
        await s("D-adding", {
          setup: connected(),
          act: async (page) => {
            await page.locator("#addText").fill("sobaka");
            await page.keyboard.press("Enter");
            await page.locator('#jobs [data-kind="word"]').first().waitFor();
            await control({ kotiko: "500" });
            await page.locator("#addText").fill("xyzzy");
            await page.keyboard.press("Enter");
            await page.locator('#jobs [data-kind="failed"]').first().waitFor();
            await control({ kotiko: "slow", delayMs: 20_000 });
            await page.locator("#addText").fill("gracias");
            await page.keyboard.press("Enter");
            await page.locator('#jobs [data-kind="looking"]').first().waitFor();
            await page.locator("#addText").blur();
          },
          waitMs: 400,
        });
        await control({ reset: true });
        await s("E-off", { setup: connected({ local: { enabled: false } }) });
        await s("F-paused", { setup: connected({ local: { pausedHosts: ["en.wikipedia.org"] } }) });
        await s("G-unsupported", { setup: connected(), tabUrl: "chrome://newtab/" });
        await s("J-unreachable", {
          setup: async (page) => {
            await connect(page, "http://127.0.0.1:9", "x");
            await set(page, { words: WORDS, lastSync: Date.now() - 3_600_000, syncError: { code: "server_unreachable", message: "Can't reach http://127.0.0.1:9. Is the server running?", details: { reason: "network" }, at: Date.now() } });
          },
          act: async (page) => {
            await page.locator("#banners .banner").waitFor();
          },
        });
        await s("J-key-rejected", {
          setup: async (page) => {
            await control({ reset: true });
            await control({ words: WORDS, kotiko: "401" });
            await connect(page, `${srv.url}/kotiko`, "wrong");
            await set(page, { words: WORDS, lastSync: Date.now() - 600_000 });
          },
          act: async (page) => {
            await page.locator("#banners .banner").waitFor();
          },
        });
        await control({ reset: true });
        await s("K-permission", { setup: connected(), noPermission: true });
        await s("L-loading", { setup: connected(), slowStorage: 1500, waitMs: 300 });
        await s("S-settings-connected", {
          setup: connected(),
          act: async (page) => {
            await page.locator("#openSettings").click();
            await page.locator(".conn-ok").waitFor();
          },
        });
        await s("S-settings-error", {
          setup: async (page) => {
            await connect(page, "me:secret@localhost:4747", "x");
            await set(page, { words: [], syncError: { code: "server_address_invalid", message: "Leave the user name and password out of the address; paste the token in the API token field.", details: { hint: "Leave the user name and password out of the address." }, at: Date.now() } });
          },
          act: async (page) => {
            await page.locator("#openSettings").click();
          },
        });
        await s("I-offline", {
          setup: connected(),
          act: async (page) => {
            await page.context().setOffline(true);
            await page.evaluate(() => window.dispatchEvent(new Event("offline")));
            await sleep(100);
          },
        });
        await browser.context.setOffline(false);
      }
      await browser.context.close();
      await fs.rm(browser.userDataDir, { recursive: true, force: true });
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
