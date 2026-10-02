// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Screenshots of the dashboard (slice 21) in its main states, in light and dark, with the
// browser in English and in Spanish. For design review; not part of CI.
//
//   node test/visual/dashboard-screenshots.mjs [outDir] [filter]
//
// Chromium with the unpacked extension against the local fixture server's fake Kotiko API
// (test/helpers/fixture-server.mjs), like the e2e fixtures. KOTIKO_E2E_CHROMIUM picks
// another Chromium build. Default outDir: ./dashboard-shots. Prints the files it wrote.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startFixtureServer } from "../helpers/fixture-server.mjs";
import { dashboardWords } from "../helpers/dashboard-words.mjs";

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension");
const OUT = path.resolve(process.argv[2] ?? "dashboard-shots");
const FILTER = process.argv[3] ?? "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(lang) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kotiko-dash-shots-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    executablePath: process.env.KOTIKO_E2E_CHROMIUM || undefined,
    headless: true,
    locale: lang,
    viewport: { width: 1440, height: 900 },
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

async function shoot(env, name, { scheme, size = { width: 1440, height: 900 }, hash = "#words", setup, act, waitMs = 350, full = false }) {
  const { context, base } = env;
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.goto(`${base}dashboard.html`);
  if (setup) await setup(page);
  await page.goto(`${base}dashboard.html${hash}`);
  await page.reload();
  await page.waitForFunction(() => document.getElementById("app")?.dataset.ready === "true", null, { timeout: 10_000 }).catch(() => {});
  if (act) await act(page);
  await sleep(waitMs);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full, animations: "disabled" });
  await page.close();
  return file;
}

async function run() {
  await fs.mkdir(OUT, { recursive: true });
  const srv = await startFixtureServer();
  const control = (body) => fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify(body) });
  const now = Date.now();
  const words = dashboardWords(now);

  // Connected to the fixture server with the dashboard words and the refresh job running.
  const connected = ({ v1Words = words, job = { state: "running", done: 40, total: 120 }, local = {} } = {}) => async (page) => {
    await control({ reset: true });
    await control({ v1Words, job });
    await page.evaluate(async (o) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ serverUrl: o.url, token: o.token, lastSync: Date.now() - 60_000, syncError: null, ...o.local });
    }, { url: `${srv.url}/kotiko`, token: srv.token, local });
  };
  const deleteIds = (ids) => async (page) => {
    await page.evaluate(async (list) => {
      for (const id of list) await chrome.runtime.sendMessage({ type: "words.write", ops: [{ op: "delete", id }] });
    }, ids);
  };

  const states = [
    ["list", { setup: connected() }],
    ["inspector", { setup: connected(), hash: `#words/${words[0].id}` }],
    ["inspector-two-bases", { setup: connected(), hash: `#words/${words[6].id}` }],
    ["inspector-bottom", { setup: connected(), hash: `#words/${words[5].id}`, act: async (p) => { await p.locator("#inspector").evaluate((n) => (n.scrollTop = n.scrollHeight)); } }],
    ["inspector-error", {
      setup: connected({ job: { state: "done", done: 0, total: 0 } }),
      hash: `#words/${words[5].id}`,
      act: async (p) => {
        await p.locator("#inspector .pron-field").first().fill("PA-ZHAL-STA");
        await p.locator("#inspector .pron-field").first().press("Enter");
      },
    }],
    ["search", { setup: connected({ job: { state: "done", done: 0, total: 0 } }), act: async (p) => { await p.locator("#search").fill("xiexie"); } }],
    ["search-pron", { setup: connected({ job: { state: "done", done: 0, total: 0 } }), act: async (p) => { await p.locator("#search").fill("spaseeba"); } }],
    ["no-results", { setup: connected({ job: { state: "done", done: 0, total: 0 } }), act: async (p) => { await p.locator("#search").fill("zzqx"); } }],
    ["filtered-lang", { setup: connected({ job: { state: "paused", done: 40, total: 120 } }), hash: "#words?lang=ru" }],
    ["paused-none", { setup: connected({ v1Words: words.filter((x) => x.status !== "paused"), job: { state: "done", done: 0, total: 0 } }), hash: "#words?status=paused" }],
    ["deleted", {
      setup: async (p) => {
        await connected({ job: { state: "done", done: 0, total: 0 } })(p);
        await deleteIds([words[1].id, words[9].id, words[13].id])(p);
      },
      hash: "#words?status=deleted",
    }],
    ["selection", {
      setup: connected({ job: { state: "done", done: 0, total: 0 } }),
      act: async (p) => {
        const rows = p.locator(".wrow");
        await rows.nth(1).click();
        await rows.nth(4).click({ modifiers: ["Shift"] });
      },
    }],
    ["toast-delete", {
      setup: connected({ job: { state: "done", done: 0, total: 0 } }),
      act: async (p) => {
        await p.locator(".wrow").nth(2).click();
        await p.locator(".insp-delete").click();
      },
    }],
    ["add", {
      setup: connected({ job: { state: "done", done: 0, total: 0 } }),
      hash: "#add",
      act: async (p) => {
        await p.locator("#addText").fill("kniga");
        await p.locator("#addText").press("Enter");
        await p.locator(".add-job.is-done").first().waitFor({ timeout: 5000 }).catch(() => {});
      },
    }],
    ["empty", { setup: connected({ v1Words: [], job: { state: "done", done: 0, total: 0 } }) }],
    ["not-connected", { setup: async (p) => { await control({ reset: true }); await p.evaluate(() => chrome.storage.local.clear()); } }],
    ["unreachable", {
      setup: async (p) => {
        await control({ reset: true });
        await p.evaluate(async () => {
          await chrome.storage.local.clear();
          await chrome.storage.local.set({ serverUrl: "http://127.0.0.1:9", token: "t0ken" });
        });
      },
    }],
    ["settings", { setup: connected(), hash: "#settings", full: true }],
    ["keys", { setup: connected({ job: { state: "done", done: 0, total: 0 } }), act: async (p) => { await p.locator("#grid").focus(); await p.keyboard.press("?"); } }],
    ["narrow", { setup: connected(), size: { width: 390, height: 844 } }],
    ["narrow-inspector", { setup: connected(), size: { width: 390, height: 844 }, hash: `#words/${words[5].id}` }],
    ["medium-inspector", { setup: connected(), size: { width: 820, height: 1000 }, hash: `#words/${words[1].id}` }],
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
