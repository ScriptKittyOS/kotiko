// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Screenshots of the welcome tab (slice 22), every step and state, in light and dark,
// with the browser in English and in Spanish: arrival, the language search, each way to
// connect an AI (and a failed key), looking up, one word, several words, "which language",
// no AI, a failed lookup, the celebration with the confetti mid-flight and its calm
// reduced-motion variant, the preview and what's next, 320 px wide, and the dashboard's
// About with the story. For design review; not in CI.
//
//   node test/visual/welcome-screenshots.mjs [outDir] [filter]
//
// Chromium with the unpacked extension; the fixture server's fake model stands in for the
// learner's AI. KOTIKO_E2E_CHROMIUM picks another Chromium build. Default outDir:
// ./welcome-shots. Prints the files it wrote.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startFixtureServer } from "../helpers/fixture-server.mjs";

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension");
const OUT = path.resolve(process.argv[2] ?? "welcome-shots");
const FILTER = process.argv[3] ?? "";
const KEY = "test-provider-key-0123456789";

async function launch(lang) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kotiko-welcome-shots-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    executablePath: process.env.KOTIKO_E2E_CHROMIUM || undefined,
    headless: true,
    locale: lang,
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
  return { context, sw, base: `chrome-extension://${id}/`, userDataDir };
}

const errors = [];
const written = [];

// Fresh state for each shot: no words, no AI, not onboarded, no celebrations yet.
// Settings go in through the background's own copy (`__kotiko.seed`; storage.local is only
// its mirror, SCR-448), and the lookup service and its key through the settings' own
// messages, which bind where requests go (slice 28 §7). privacy.html has no side effects.
async function reset(env, { ai = false, words = false } = {}) {
  await env.sw.evaluate(async () => {
    const g = globalThis.__kotiko;
    await (await g.getStore()).replaceAll([]);
    await g.seed({ onboarding: { completedAt: null, skipped: false, version: 2 }, celebrations: null, prefs: {}, addJobs: [] });
    await g.projector.flush();
  });
  const page = await env.context.newPage();
  await page.goto(`${env.base}privacy.html`);
  const lookup = ai ? { kind: "provider", provider: "custom", baseUrl: env.llmUrl, model: null } : { kind: "none", provider: "openrouter", baseUrl: null, model: null };
  const msgs = [{ type: "secrets.remove", id: "provider:custom" }, { type: "backend.set", lookup }, ...(ai ? [{ type: "secrets.set", id: "provider:custom", value: KEY }] : [])];
  if (words) msgs.push({ type: "words.save", words: [{ lang: "ru", native: "дом", base_lang: "en", gloss: "house", forms: ["house"], origin: "manual" }] });
  for (const m of msgs) {
    const r = await page.evaluate((x) => chrome.runtime.sendMessage(x), m);
    if (r?.error) throw new Error(`${m.type}: ${JSON.stringify(r)}`);
  }
  await page.close();
}

async function shoot(env, name, { scheme, size = { width: 1100, height: 1000 }, reduced = true, ai = false, words = false, act, full = true, url = "welcome.html", locator = null }) {
  if (FILTER && !name.includes(FILTER)) return;
  await reset(env, { ai, words });
  const page = await env.context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.goto(`${env.base}${url}`);
  if (url.startsWith("welcome")) await page.waitForSelector('#main[data-ready="true"]');
  else await page.waitForTimeout(400);
  const out = path.join(OUT, `${name}.png`);
  try {
    if (act) await act(page, env);
  } catch (e) {
    errors.push(`${name}: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: out.replace(/\.png$/, "-FAILED.png"), fullPage: true });
    await page.close();
    return;
  }
  if (locator) await page.locator(locator).screenshot({ path: out });
  else await page.screenshot({ path: out, fullPage: full });
  written.push(out);
  await page.close();
}

const ask = async (page, text) => {
  await page.locator("#askText").fill(text);
  await page.locator("#askText").press("Enter");
};

async function run() {
  await fs.mkdir(OUT, { recursive: true });
  const srv = await startFixtureServer();
  const control = (body) => fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify(body) });
  for (const lang of ["en", "es"]) {
    const env = { ...(await launch(lang)), llmUrl: srv.llmUrl };
    const L = lang === "es";
    const question = L ? "¿cómo se dice hola en japonés?" : "how do you say hello in Japanese";
    const please = L ? "por favor en ruso" : "please in russian";
    const several = L ? "hola en japonés" : "hi in japanese";
    const thanks = L ? "ありがとう = gracias" : "ありがとう = thanks";
    for (const scheme of ["light", "dark"]) {
      const tag = `${lang}-${scheme}`;
      await control({ reset: true });
      await shoot(env, `01-arrival-${tag}`, { scheme });
      await shoot(env, `02-bases-search-${tag}`, {
        scheme,
        act: async (p) => {
          await p.locator("#addBase").click();
          await p.locator("#baseSearchField").fill(L ? "fra" : "fre");
        },
      });
      await shoot(env, `03-bases-last-${tag}`, { scheme, act: async (p) => p.locator(".base-chip").first().click() });
      await shoot(env, `04-paste-key-${tag}`, { scheme, act: async (p) => p.locator("#aiPaste").click() });
      await shoot(env, `05-other-service-${tag}`, {
        scheme,
        act: async (p) => {
          await p.locator("#aiOther").click();
          await p.locator('#providerOptions [data-value="custom"]').click();
        },
      });
      await shoot(env, `06-server-${tag}`, { scheme, act: async (p) => p.locator("#aiServer").click() });
      await shoot(env, `07-key-rejected-${tag}`, {
        scheme,
        act: async (p, env) => {
          await control({ llm: "401" });
          await p.locator("#aiOther").click();
          await p.locator('#providerOptions [data-value="custom"]').click();
          await p.locator("#otherUrl").fill(env.llmUrl);
          await p.locator("#otherUrl").press("Enter");
          await p.locator("#otherStatus.status-bad").waitFor();
          await p.locator("#otherKey").fill("sk-wrong-key-123456789");
          await p.locator("#otherKey").press("Enter");
          await p.locator("#otherStatus.status-bad").waitFor();
          await control({ llm: null });
        },
      });
      await shoot(env, `08-connected-${tag}`, { scheme, ai: true });
      await shoot(env, `09-looking-up-${tag}`, {
        scheme,
        ai: true,
        act: async (p) => {
          await control({ llmDelayMs: 4000 });
          await ask(p, question);
          await p.waitForTimeout(300);
        },
      });
      await control({ llmDelayMs: 0 });
      await shoot(env, `10-card-${tag}`, { scheme, ai: true, act: async (p) => (await ask(p, question), p.locator("#wordCard").waitFor({ timeout: 8000 })) });
      await shoot(env, `11-card-russian-${tag}`, { scheme, ai: true, act: async (p) => (await ask(p, please), p.locator("#wordCard").waitFor({ timeout: 8000 })) });
      await shoot(env, `12-several-${tag}`, { scheme, ai: true, act: async (p) => (await ask(p, several), p.locator(".choices").waitFor()) });
      await shoot(env, `13-which-language-${tag}`, { scheme, act: async (p) => (await ask(p, L ? "hello = hola" : "hola = hello"), p.locator(".pick-chip").first().waitFor()) });
      await shoot(env, `14-no-ai-${tag}`, { scheme, act: async (p) => (await ask(p, L ? "perro en árabe" : "dog in Arabic"), p.locator("#meaningForm").waitFor()) });
      await shoot(env, `15-no-word-${tag}`, { scheme, ai: true, act: async (p) => (await ask(p, "zzzz qqq"), p.locator("#meaningForm").waitFor()) });
      await shoot(env, `16-confetti-${tag}`, {
        scheme,
        reduced: false,
        full: false,
        act: async (p) => {
          await ask(p, thanks);
          await p.locator("#confirm").click();
          await p.locator("canvas.kotiko-confetti").waitFor();
          await p.waitForTimeout(520);
        },
      });
      await shoot(env, `17-celebration-reduced-${tag}`, {
        scheme,
        full: false,
        act: async (p) => {
          await ask(p, thanks);
          await p.locator("#confirm").click();
          await p.locator("#done").waitFor();
          await p.waitForTimeout(300);
        },
      });
      await shoot(env, `18-done-full-${tag}`, {
        scheme,
        ai: true,
        act: async (p) => {
          await ask(p, question);
          await p.locator("#confirm").click();
          await p.locator("#done").waitFor();
          await p.locator("#celebrationsOff").click();
          await p.waitForTimeout(300);
        },
      });
      await shoot(env, `19-preview-popover-${tag}`, {
        scheme,
        full: false,
        act: async (p) => {
          await ask(p, thanks);
          await p.locator("#confirm").click();
          await p.locator(".preview-after kotiko-w").first().scrollIntoViewIfNeeded();
          await p.locator(".preview-after kotiko-w").first().click();
          await p.waitForTimeout(500);
        },
      });
      await shoot(env, `20-reopened-${tag}`, { scheme, ai: true, words: true });
      await shoot(env, `21-narrow-320-${tag}`, { scheme, size: { width: 320, height: 900 } });
      await shoot(env, `22-narrow-card-320-${tag}`, { scheme, size: { width: 320, height: 900 }, ai: true, act: async (p) => (await ask(p, please), p.locator("#wordCard").waitFor({ timeout: 8000 })) });
      await shoot(env, `23-about-story-${tag}`, { scheme, url: "dashboard.html#settings/about", size: { width: 1280, height: 1100 }, locator: "#set-about", act: async (p) => p.locator("#story").waitFor() });
      await shoot(env, `24-popup-first-run-${tag}`, { scheme, url: "popup.html", size: { width: 360, height: 600 }, full: false });
    }
    await env.context.close();
    await fs.rm(env.userDataDir, { recursive: true, force: true });
  }
  await srv.close();
  console.log(written.join("\n"));
  if (errors.length) {
    console.error(`\nPage errors:\n${errors.join("\n")}`);
    process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
