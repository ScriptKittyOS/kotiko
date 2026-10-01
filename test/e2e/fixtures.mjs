// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
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
      miraUrl: `${url}/mira`,
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

  context: async ({ blocked }, use, testInfo) => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mira-e2e-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      // Bundled Chromium: branded Chrome ignores --load-extension since Chrome 137.
      channel: "chromium",
      // Optional: another Chromium build (for example an already-downloaded one offline).
      executablePath: process.env.MIRA_E2E_CHROMIUM || undefined,
      headless: true,
      args: [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        // Belt and braces: even a request the route below can't see fails to resolve.
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
        "--disable-component-update",
        "--no-first-run",
      ],
    });
    const record = (url) => {
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
      // Fills in the Connection section and waits for the first good sync.
      async connect(serverUrl, token) {
        const p = await get();
        if (!(await p.locator("#conn").evaluate((d) => d.open))) await p.locator("#conn summary").click();
        await p.locator("#serverUrl").fill(serverUrl);
        await p.locator("#token").fill(token);
        await p.locator("#save").click();
        await expect(p.locator("#status")).toHaveText(/words? known, synced/, { timeout: 10_000 });
        return p;
      },
      async add(text) {
        const p = await get();
        await p.locator("#addText").fill(text);
        await p.locator("#addBtn").click();
        await expect(p.locator("#addBtn")).toHaveText("Add", { timeout: 15_000 });
        return p.locator("#added");
      },
    });
  },
});
