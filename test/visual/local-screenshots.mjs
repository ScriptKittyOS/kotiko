// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Screenshots of slice 11's screens: the dashboard's Word lookups settings and the words'
// home (with the move dialog), and the popup's states while no lookups are set up, in
// light and dark, with the browser in English and in Spanish. For design review; not in CI.
//
//   node test/visual/local-screenshots.mjs [outDir] [filter]
//
// Chromium with the unpacked extension; the fixture server's fake model and fake Kotiko
// server stand in for the provider and the server. KOTIKO_E2E_CHROMIUM picks another
// Chromium build. Default outDir: ./local-shots. Prints the files it wrote.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startFixtureServer } from "../helpers/fixture-server.mjs";

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension");
const OUT = path.resolve(process.argv[2] ?? "local-shots");
const FILTER = process.argv[3] ?? "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(lang) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kotiko-local-shots-"));
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
  return { context, base: `chrome-extension://${id}/`, userDataDir };
}

const errors = [];

async function shoot(env, name, { scheme, page: kind, size, hash = "", setup, act, waitMs = 400, section = null }) {
  const { context, base } = env;
  const file = kind === "popup" ? "popup.html" : "dashboard.html";
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  await page.setViewportSize(size ?? (kind === "popup" ? { width: 360, height: 600 } : { width: 1280, height: section ? 1700 : 900 }));
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.goto(`${base}${file}`);
  if (setup) await setup(page);
  await page.goto(`${base}${file}${hash}`);
  await page.reload();
  await sleep(250);
  if (act) await act(page);
  await sleep(waitMs);
  const out = path.join(OUT, `${name}.png`);
  if (section) await page.locator(section).screenshot({ path: out, animations: "disabled" });
  else await page.screenshot({ path: out, animations: "disabled" });
  await page.close();
  return out;
}

// Settings go in through the background's own copy (`__kotiko`, in its service worker):
// storage.local is only its mirror, and anything else written there is put back (SCR-448).
const worker = (page) => page.context().serviceWorkers()[0];
const seed = (page, items) => worker(page).evaluate((i) => globalThis.__kotiko.seed(i), items);

async function run() {
  await fs.mkdir(OUT, { recursive: true });
  const srv = await startFixtureServer();
  const control = (body) => fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify(body) });
  const send = (page, msg) => page.evaluate((m) => chrome.runtime.sendMessage(m), msg);

  // A fresh local profile: storage and the word store emptied, words in this browser.
  const fresh = async (page) => {
    await control({ reset: true });
    await seed(page, { wordsHome: "local", addJobs: [] });
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: "backend.set", lookup: { kind: "none", provider: "openrouter", baseUrl: null, model: null, dataCollection: "allow" } });
      for (const id of ["provider:openrouter", "provider:custom", "server"]) await chrome.runtime.sendMessage({ type: "secrets.remove", id });
      const { words } = await chrome.runtime.sendMessage({ type: "words.list" });
      if (words.length) await chrome.runtime.sendMessage({ type: "words.write", ops: words.map((w) => ({ op: "delete", id: w.id })) });
    });
    await seed(page, { addJobs: [] });
  };
  const withWords = async (page) => {
    await fresh(page);
    for (const text of ["дом = house", "спасибо = thanks", "犬 = dog", "gracias = thanks"]) await send(page, { type: "add", text, hintLang: text.startsWith("gracias") ? "es" : undefined });
    await page.waitForFunction(async () => {
      const { addJobs = [] } = await chrome.storage.local.get("addJobs");
      return addJobs.length >= 4 && addJobs.every((j) => j.state === "done");
    }, null, { timeout: 10_000 });
    await page.evaluate(() => chrome.storage.local.get("addJobs").then(({ addJobs }) => chrome.runtime.sendMessage({ type: "jobs.seen", ids: addJobs.map((j) => j.id) })));
  };
  const provider = (lookup, key) => async (page) => {
    await fresh(page);
    await send(page, { type: "backend.set", lookup });
    if (key) await send(page, { type: "secrets.set", id: `provider:${lookup.provider}`, value: key });
  };

  const states = [
    ["dash-lookups-none", { page: "dashboard", setup: fresh, hash: "#settings/lookups", section: "#set-lookups" }],
    ["dash-lookups-openrouter-no-key", { page: "dashboard", setup: provider({ kind: "provider", provider: "openrouter" }), hash: "#settings/lookups", section: "#set-lookups" }],
    ["dash-lookups-openrouter-key", { page: "dashboard", setup: provider({ kind: "provider", provider: "openrouter", baseUrl: `${srv.url}/llm/v1` }, "sk-or-v1-5f2c0d9e8b7a6c5d4e3f2a1b0c9d8e7f6a5ba1b2"), hash: "#settings/lookups", section: "#set-lookups" }],
    ["dash-lookups-test-ok", {
      page: "dashboard",
      setup: provider({ kind: "provider", provider: "custom", baseUrl: `${srv.url}/llm/v1` }, "test-key-0123456789"),
      hash: "#settings/lookups",
      section: "#set-lookups",
      act: async (p) => {
        await p.locator("#testLookup").click();
        await p.locator("#lookupState .conn-ok, #lookupState .conn-bad").waitFor({ timeout: 10_000 });
      },
    }],
    ["dash-lookups-ollama", { page: "dashboard", setup: provider({ kind: "provider", provider: "ollama" }), hash: "#settings/lookups", section: "#set-lookups" }],
    ["dash-move-to-server", {
      page: "dashboard",
      setup: async (p) => {
        await withWords(p);
        await control({ v1Words: [] });
        await send(p, { type: "server.connect", url: `${srv.url}/kotiko`, token: srv.token });
      },
      hash: "#settings/connection",
      section: "#set-connection",
      act: async (p) => {
        await p.locator("#moveWords").click();
        await p.locator("#moveConfirm:not([hidden])").waitFor({ timeout: 5000 });
      },
    }],
    ["dash-words-banner", { page: "dashboard", setup: withWords, hash: "#words" }],
    ["popup-first-run", { page: "popup", setup: fresh }],
    ["popup-lookups-off", { page: "popup", setup: withWords }],
    ["popup-waiting", {
      page: "popup",
      setup: async (p) => {
        await withWords(p);
        await worker(p).evaluate(async () => {
          const now = Date.now();
          const job = (id, text, error, retryAt) => ({ id, surface: "popup", text, hintLang: null, baseLangs: ["en"], manual: null, state: "waiting", createdAt: now - Number(id.slice(-1)), startedAt: now - 5000, attempts: 1, waits: 1, error, results: [], rejected: [], missingBases: [], retryAt, seen: false });
          const { addJobs = [] } = await globalThis.__kotiko.area.get({ addJobs: [] });
          await globalThis.__kotiko.seed({
            addJobs: [
              job("01900000-0000-7000-8000-000000000001", "shukran", { code: "lookup_not_set_up", details: {} }, null),
              job("01900000-0000-7000-8000-000000000002", "kniga", { code: "quota_exhausted", details: { retry_at: new Date(Date.UTC(2026, 9, 3, 0, 0)).toISOString() } }, Date.UTC(2026, 9, 3)),
              ...addJobs,
            ],
          });
        });
      },
    }],
    ["popup-added", {
      page: "popup",
      setup: provider({ kind: "provider", provider: "custom", baseUrl: `${srv.url}/llm/v1` }, "test-key-0123456789"),
      act: async (p) => {
        await p.locator("#addText").fill("shukran");
        await p.locator("#addText").press("Enter");
        await p.locator('#jobs li[data-kind="word"]').first().waitFor({ timeout: 10_000 });
      },
    }],
  ];

  const written = [];
  for (const lang of ["en", "es"]) {
    const env = await launch(lang);
    try {
      for (const scheme of ["light", "dark"]) {
        for (const [name, opts] of states) {
          const label = `${name}-${scheme}-${lang}`;
          if (FILTER && !label.includes(FILTER)) continue;
          written.push(await shoot(env, label, { scheme, ...opts }));
        }
      }
    } finally {
      await env.context.close();
      await fs.rm(env.userDataDir, { recursive: true, force: true });
    }
  }
  await srv.close();
  for (const f of written) console.log(f);
  if (errors.length) {
    console.error("\nPage errors:");
    for (const e of [...new Set(errors)]) console.error(`  ${e}`);
    process.exitCode = 1;
  }
}

await run();
