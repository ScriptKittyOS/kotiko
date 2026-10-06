// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The store screenshots (slice 28 §8): five 1280x800 PNGs with their captions from
// store/listing/<locale>.json, made from the real extension so they're regenerated when
// the interface changes. Not part of CI.
//
//   node test/visual/store-screenshots.mjs [outDir] [locale]
//
// Writes <outDir>/<locale>/raw/<n>-<id>.png (the bare captures) and
// <outDir>/<locale>/<n>-<id>.png (captioned, the files to upload). Default outDir:
// ./store-shots; default locale: en. Chromium with the unpacked extension, the browser in
// that locale, and a page written for the purpose (test/fixtures/pages/store-article.html,
// so no third-party content or logos appear), served at www.example.com by a route. The caption's colors come from the design
// tokens, and the script stops if their contrast is under 4.5:1. KOTIKO_E2E_CHROMIUM picks
// another Chromium build.
//
// The words shown are fixed below, for a reader of English pages; a listing in another
// language adds its own set and article when its translation lands.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startFixtureServer } from "../helpers/fixture-server.mjs";
import { readCard } from "../helpers/closed-shadow.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXT_DIR = path.join(ROOT, "extension");
const OUT = path.resolve(process.argv[2] ?? "store-shots");
const LOCALE = process.argv[3] ?? "en";
const SIZE = { width: 1280, height: 800 };
// The article is served at an ordinary-looking address (example.com is reserved for
// examples, RFC 2606) so the popup's "This page" line names a website, not 127.0.0.1. The
// browser never reaches the internet: the route below answers with the fixture file.
const ARTICLE_URL = "https://www.example.com/articles/store-article.html";

const WORDS = {
  en: [
    { lang: "es", native: "perro", gloss: "dog", forms: ["dog", "dogs"], pronunciation: "PEH-rro" },
    { lang: "es", native: "agua", gloss: "water", forms: ["water"], pronunciation: "AH-gwa" },
    { lang: "es", native: "amigo", gloss: "friend", forms: ["friend"], pronunciation: "ah-MEE-go" },
    { lang: "ja", native: "猫", gloss: "cat", forms: ["cat", "cats"], romanization: "neko", pronunciation: "neh-koh" },
    { lang: "ja", native: "本", gloss: "book", forms: ["book", "books"], romanization: "hon", pronunciation: "hohn" },
    { lang: "ja", native: "ありがとう", gloss: "thanks", forms: ["thanks", "thank you"], romanization: "arigatō", pronunciation: "ah-ree-gah-toh" },
    { lang: "ru", native: "дом", gloss: "house", forms: ["house"], romanization: "dom", pronunciation: "DOM" },
  ],
};
// The word whose card each shot opens: the first of these the page shows (which language
// "cat" shows in depends on the day once it has two, slice 18).
const HOVER = { en: { light: ["perro", "agua"], dark: ["猫", "本", "ありがとう"] } };
const ADD = { en: "gato = cat" };

// WCAG 2.2 contrast ratio of two #rrggbb colors.
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// A token's light-theme value from tokens.css (the first definition, under :root).
function token(css, name) {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`tokens.css has no --${name}`);
  return m[1].trim();
}

async function launch() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kotiko-store-shots-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    executablePath: process.env.KOTIKO_E2E_CHROMIUM || undefined,
    headless: true,
    locale: LOCALE,
    viewport: SIZE,
    deviceScaleFactor: 1,
    env: { ...process.env, LANGUAGE: LOCALE },
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      `--lang=${LOCALE}`,
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      "--no-first-run",
    ],
  });
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (["http:", "https:"].includes(u.protocol) && !["127.0.0.1", "localhost"].includes(u.hostname)) return route.abort();
    return route.continue();
  });
  const articleHtml = await fs.readFile(path.join(ROOT, "test/fixtures/pages/store-article.html"), "utf8");
  await context.route(ARTICLE_URL, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: articleHtml }));
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  return { context, sw, base: `chrome-extension://${new URL(sw.url()).host}/`, userDataDir };
}

// Past the first run, the learner's words saved, one language read, words mixed per page,
// and lookups set up (the fixture server's fake model) through the settings' own messages.
// Settings go in through the background's own copy (`__kotiko.seed`): storage.local is only
// its mirror, and anything else written there is put back (SCR-448). The install's first
// run writes its own first, so this waits for it.
async function seed(env, srv) {
  await env.sw.evaluate(async (base) => {
    for (let i = 0; i < 100 && !(await globalThis.__kotiko.area.get("onboarding")).onboarding; i++) await new Promise((r) => setTimeout(r, 50));
    const ui = { uiLang: "auto", baseLangs: [base], baseLangsConfirmed: true };
    const seedSalt = "0123456789abcdef0123456789abcdef";
    await chrome.storage.sync.set({ ui, seedSalt });
    await globalThis.__kotiko.seed({ ui, seedSalt, baseLangs: [base], onboarding: { completedAt: Date.now(), skipped: false, version: 2 }, mixing: { mode: "mix" }, celebrations: null });
  }, LOCALE);
  const page = await env.context.newPage();
  await page.goto(`${env.base}dashboard.html`);
  const res = await page.evaluate((words) => chrome.runtime.sendMessage({ type: "words.save", words }), WORDS[LOCALE].map((w) => ({ ...w, base_lang: LOCALE, origin: "manual", pronunciation_source: "user" })));
  if (res?.error) throw new Error(`words.save: ${JSON.stringify(res)}`);
  for (const msg of [{ type: "backend.set", lookup: { kind: "provider", provider: "custom", baseUrl: srv.llmUrl, model: null } }, { type: "secrets.set", id: "provider:custom", value: "store-screenshot-key-0123" }]) {
    const r = await page.evaluate((m) => chrome.runtime.sendMessage(m), msg);
    if (r?.error) throw new Error(`${msg.type}: ${JSON.stringify(r)}`);
  }
  await page.close();
  // Give every open page time to receive the new list.
  await new Promise((r) => setTimeout(r, 500));
}

async function article(env, scheme, hover) {
  const page = await env.context.newPage();
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.goto(ARTICLE_URL);
  await page.locator("kotiko-w").first().waitFor();
  const shown = await page.locator("kotiko-w").allTextContents();
  const pick = hover.find((w) => shown.includes(w));
  if (!pick) throw new Error(`None of ${hover.join(", ")} is swapped on the page; swapped: ${shown.join(", ")}`);
  await page.locator("kotiko-w", { hasText: pick }).first().hover();
  for (let i = 0; i < 40 && !(await readCard(page))?.open; i++) await page.waitForTimeout(100);
  // The card's entrance has finished.
  await page.waitForTimeout(600);
  return page;
}

const shots = [
  { id: "page", take: (env) => article(env, "light", HOVER[LOCALE].light) },
  {
    id: "popup",
    // A real popup describes the tab it was opened over. Here it is a tab of its own, so the
    // article is opened first and the popup's "active tab" question answered with that real
    // tab (its id and address): "This page" then describes the article, not a browser page.
    async take(env) {
      const article = await env.context.newPage();
      await article.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await article.goto(ARTICLE_URL);
      await article.locator("kotiko-w").first().waitFor();
      const tab = await env.sw.evaluate(async (url) => (await chrome.tabs.query({ url })).map(({ id, url: u, title, windowId }) => ({ id, url: u, title, active: true, windowId }))[0] ?? null, article.url());
      if (!tab) throw new Error("The article's tab wasn't found");
      const page = await env.context.newPage();
      await page.setViewportSize({ width: 380, height: 600 });
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await page.addInitScript((t) => {
        if (!globalThis.chrome?.tabs?.query) return;
        const query = chrome.tabs.query.bind(chrome.tabs);
        chrome.tabs.query = (info = {}, ...rest) => (info.active ? Promise.resolve([t]) : query(info, ...rest));
      }, tab);
      await page.goto(`${env.base}popup.html`);
      await page.locator('#main[data-ready="true"]').waitFor();
      if (await page.locator("#unsupported").isVisible()) throw new Error("The popup describes a browser page, not the article");
      await page.locator("#pageSection").waitFor();
      await page.locator("#addText").fill(ADD[LOCALE]);
      await page.locator("#addText").press("Enter");
      await page.locator('#jobs [data-kind="word"]').first().waitFor();
      await page.locator("#addText").blur();
      return { page, region: page.locator("#main"), also: [article] };
    },
  },
  {
    id: "dashboard",
    async take(env) {
      const page = await env.context.newPage();
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await page.goto(`${env.base}dashboard.html`);
      // The word added in the popup gets its pronunciation in the background (slice 07 §8),
      // which shows "Adding pronunciations…: 0 of 1" until its next run (about a minute);
      // the shot waits for that line to go rather than show it.
      await page.waitForTimeout(1500);
      await page.locator("#refreshLine").waitFor({ state: "hidden", timeout: 120_000 });
      await page.waitForTimeout(800);
      return page;
    },
  },
  {
    id: "welcome",
    async take(env) {
      const page = await env.context.newPage();
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await page.goto(`${env.base}welcome.html`);
      await page.locator('#main[data-ready="true"]').waitFor();
      // Shown as most learners will see it: connected to OpenRouter, the default, rather than
      // the fixture's "Another service". Only the label changes; nothing is looked up.
      for (const msg of [{ type: "secrets.set", id: "provider:openrouter", value: "sk-or-v1-0123456789abcdef0123456789abcdef" }, { type: "backend.set", lookup: { kind: "provider", provider: "openrouter", baseUrl: null, model: null } }]) {
        const r = await page.evaluate((m) => chrome.runtime.sendMessage(m), msg);
        if (r?.error) throw new Error(`${msg.type}: ${JSON.stringify(r)}`);
      }
      await page.reload();
      await page.locator('#main[data-ready="true"]').waitFor();
      await page.waitForTimeout(300);
      return page;
    },
  },
  { id: "dark", take: (env) => article(env, "dark", HOVER[LOCALE].dark) },
];

// The captioned 1280x800 frame: the caption on the canvas color, the capture below it.
function frameHtml({ png, small, colors, css }) {
  return `<!doctype html><html lang="${LOCALE}"><head><meta charset="utf-8"><style>${css}
    html, body { margin: 0; width: ${SIZE.width}px; height: ${SIZE.height}px; overflow: hidden; background: ${colors.bg}; }
    .cap { box-sizing: border-box; height: 128px; padding: 36px 64px 0; color: ${colors.ink}; font: 600 40px/52px var(--font-display); }
    .shot { display: flex; justify-content: center; align-items: flex-start; height: 672px; }
    img { display: block; border-radius: 12px; box-shadow: 0 8px 32px rgb(31 26 43 / 0.18); ${small ? "max-height: 640px;" : "height: 640px;"} }
  </style></head><body><div class="cap"></div><div class="shot"><img src="data:image/png;base64,${png.toString("base64")}" alt=""></div></body></html>`;
}

async function run() {
  const listing = JSON.parse(await fs.readFile(path.join(ROOT, "store/listing", `${LOCALE}.json`), "utf8"));
  if (!WORDS[LOCALE]) throw new Error(`No screenshot words for ${LOCALE} yet; add them above.`);
  const css = await fs.readFile(path.join(EXT_DIR, "ui/tokens.css"), "utf8");
  const colors = { bg: token(css, "canvas"), ink: token(css, "ink") };
  const ratio = contrast(colors.bg, colors.ink);
  if (ratio < 4.5) throw new Error(`Caption contrast ${ratio.toFixed(2)}:1 is under 4.5:1`);

  const out = path.join(OUT, LOCALE);
  await fs.mkdir(path.join(out, "raw"), { recursive: true });
  const srv = await startFixtureServer();
  const env = await launch();
  const written = [];
  try {
    await seed(env, srv);
    for (const [i, shot] of shots.entries()) {
      const caption = listing.screenshots?.find((s) => s.id === shot.id)?.caption;
      if (!caption) throw new Error(`store/listing/${LOCALE}.json has no caption for ${shot.id}`);
      const name = `${String(i + 1).padStart(2, "0")}-${shot.id}.png`;
      const got = await shot.take(env, srv);
      const page = got.region ? got.page : got;
      const raw = path.join(out, "raw", name);
      if (got.region) await got.region.screenshot({ path: raw });
      else await page.screenshot({ path: raw });
      await page.close();
      for (const p of got.also ?? []) await p.close();

      const frame = await env.context.newPage();
      await frame.setViewportSize(SIZE);
      await frame.setContent(frameHtml({ png: await fs.readFile(raw), small: !!got.region, colors, css }));
      await frame.locator(".cap").evaluate((el, text) => (el.textContent = text), caption);
      await frame.screenshot({ path: path.join(out, name) });
      await frame.close();
      written.push(path.join(out, name));
    }
  } finally {
    await env.context.close();
    await fs.rm(env.userDataDir, { recursive: true, force: true });
    await srv.close();
  }
  for (const f of written) console.log(f);
  console.log(`Caption contrast ${ratio.toFixed(2)}:1. Upload ${path.join(out, "*.png")} (1280x800).`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
