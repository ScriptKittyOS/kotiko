// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Playwright fixtures: Chromium with the unpacked extension, the fixture server, a network
// guard, and helpers for the popup.
//
//   import { test, expect } from "./fixtures.mjs";
//   test("…", async ({ context, server, popup }) => { … });
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, chromium } from "@playwright/test";

export { expect };

export const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension");

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const NETWORK_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:", "ftp:"]);

// True for a request that would leave this machine.
export function isExternal(url) {
  try {
    const u = new URL(url);
    return NETWORK_PROTOCOLS.has(u.protocol) && !LOCAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

// Connects Kotiko to a server the way its settings do: `server.connect` from one of its own
// pages (slice 28 §7: an address or token written straight to storage.local is ignored).
// privacy.html is used because opening it has no side effects.
export async function connectServer(context, serviceWorker, url, token) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(serviceWorker.url()).host}/privacy.html`);
  const res = await page.evaluate((m) => chrome.runtime.sendMessage(m), { type: "server.connect", url, token });
  await page.close();
  if (res?.error) throw new Error(`server.connect: ${JSON.stringify(res)}`);
  return res;
}

// Writes settings as Kotiko's own code does (SCR-448): storage.local is only the
// background's mirror, and anything else written there is put back. Inside a
// `serviceWorker.evaluate`, call `globalThis.__kotiko.seed(items)` directly.
export const seed = (serviceWorker, items) => serviceWorker.evaluate((i) => globalThis.__kotiko.seed(i), items);

export const test = base.extend({
  // The fixture server started in global-setup.mjs.
  server: async ({}, use) => {
    const url = process.env.FIXTURE_URL;
    if (!url) throw new Error("FIXTURE_URL isn't set; run the tests through `npm run e2e`.");
    const control = async (body) => {
      const res = await fetch(`${url}/__control`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`/__control answered ${res.status}`);
    };
    await control({ reset: true });
    await use({
      url,
      token: process.env.FIXTURE_TOKEN,
      kotikoUrl: `${url}/kotiko`,
      llmUrl: `${url}/llm/v1`,
      page: (name) => `${url}/pages/${name}`,
      control,
      state: async () => (await fetch(`${url}/__control`)).json(),
    });
  },

  // Requests that tried to leave localhost. Every test fails if this isn't empty at the
  // end; a test that triggers one on purpose empties it after checking.
  blocked: async ({}, use) => {
    await use([]);
  },

  // The browser's interface language, e.g. "es" with test.use({ browserLang: "es" }).
  browserLang: [null, { option: true }],

  context: async ({ blocked, browserLang }, use, testInfo) => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kotiko-e2e-"));
    const lang = browserLang
      ? { args: [`--lang=${browserLang}`], env: { ...process.env, LANGUAGE: browserLang }, locale: browserLang }
      : { args: [], env: undefined, locale: undefined };
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...(lang.env ? { env: lang.env, locale: lang.locale } : {}),
      // Bundled Chromium: branded Chrome ignores --load-extension since Chrome 137.
      channel: "chromium",
      // Optional: another Chromium build (for example an already-downloaded one offline).
      // MIRA_E2E_CHROMIUM is the old name, accepted for this release. legacy-name-ok
      executablePath: process.env.KOTIKO_E2E_CHROMIUM || process.env.MIRA_E2E_CHROMIUM || undefined, // legacy-name-ok
      headless: true,
      args: [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        // Belt and braces: even a request the route below can't see fails to resolve.
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
        "--disable-component-update",
        "--no-first-run",
        ...lang.args,
      ],
    });
    // Wiktionary (slice 49 §4a) is the one outside site the extension asks on its own, for
    // pronunciations of words added with the learner's own AI. It's blocked like everything
    // else (the resolver rule above), so the extension keeps the model's pronunciation, as it
    // does offline; it just isn't counted as a fixture that left localhost.
    const record = (url) => {
      if (new URL(url).hostname === "en.wiktionary.org") return;
      if (!blocked.includes(url)) blocked.push(url);
    };
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (!isExternal(url)) return route.continue();
      record(url);
      return route.abort("blockedbyclient");
    });
    // Catches anything the router doesn't see (for example a worker's own requests).
    context.on("request", (req) => isExternal(req.url()) && record(req.url()));

    await context.tracing.start({ screenshots: true, snapshots: true });
    await use(context);

    const failed = testInfo.status !== testInfo.expectedStatus;
    if (failed) {
      await context.tracing.stop({ path: testInfo.outputPath("trace.zip") });
      for (const [i, page] of context.pages().entries()) {
        await page.screenshot({ path: testInfo.outputPath(`page-${i}.png`), fullPage: true }).catch(() => {});
      }
    } else {
      await context.tracing.stop();
    }
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    expect(blocked, "requests outside localhost (fixtures must be self-contained)").toEqual([]);
  },

  serviceWorker: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await use(sw);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  // Opens the toolbar popup's page in a tab and returns helpers for it.
  popup: async ({ context, extensionId }, use) => {
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const open = async () => {
      const page = await context.newPage();
      await page.goto(popupUrl);
      return page;
    };
    let page = null;
    const get = async () => (page && !page.isClosed() ? page : (page = await open()));
    await use({
      url: popupUrl,
      page: get,
      // Opens Connection settings, fills them in, waits for the first good check, and goes
      // back to the main view.
      async connect(serverUrl, token) {
        const p = await get();
        await p.locator("#openSettings").click();
        await p.locator("#serverUrl").fill(serverUrl);
        await p.locator("#accessKey").fill(token);
        await p.locator("#saveConn").click();
        // The success line (a check icon and "Connected…" in the interface language).
        await expect(p.locator("#connStatus .conn-ok")).toBeVisible({ timeout: 10_000 });
        await p.locator("#closeSettings").click();
        return p;
      },
      // Types a word and presses Enter; resolves with the newest line under the add box once
      // it has an answer.
      async add(text) {
        const p = await get();
        await p.locator("#addText").fill(text);
        await p.locator("#addText").press("Enter");
        const line = p.locator("#jobs li").first();
        await expect(line).not.toHaveAttribute("data-kind", "looking", { timeout: 15_000 });
        return line;
      },
    });
  },
});
