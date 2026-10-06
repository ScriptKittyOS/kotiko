// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Every page of the built site, in Chromium, in the light and the dark theme:
//
//   - axe-core's WCAG 2.0, 2.1 and 2.2 A and AA rules report no serious or critical issue
//     (slice 44 acceptance; anything milder is listed in the test's annotations);
//   - the browser asks no host but the site itself, and the Content Security Policy blocks
//     nothing (so the policy and the pages agree);
//   - search works without leaving the site;
//   - /connect/ with a code, and no Kotiko installed, stays plain text and asks for nothing.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test, expect } from "@playwright/test";
import { serve } from "./serve.mjs";

const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const DIST = path.resolve(import.meta.dirname, "../dist");

// Every page, as the path a visitor opens. Redirect stubs (a meta refresh) only send the
// browser on and are skipped; 404.html is opened at a path that doesn't exist.
function pages() {
  if (!fs.existsSync(DIST)) throw new Error("dist/ is missing: run `npm run build` first.");
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".html")) {
        const html = fs.readFileSync(p, "utf8");
        if (/http-equiv="refresh"/i.test(html)) continue;
        const rel = path.relative(DIST, p).split(path.sep).join("/");
        out.push(rel === "404.html" ? "/no-such-page/" : `/${rel.replace(/index\.html$/, "")}`);
      }
    }
  };
  walk(DIST);
  return out.sort();
}

let site;
test.beforeAll(async () => {
  site = await serve(DIST);
});
test.afterAll(async () => {
  await site?.close();
});

// A page with a log of requests that left the site (they're blocked) and of what the
// Content Security Policy refused.
async function open(browser, url, colorScheme) {
  const context = await browser.newContext({ colorScheme });
  const outside = [];
  const refused = [];
  await context.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(site.url) || u.startsWith("data:")) return route.continue();
    outside.push(u);
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) refused.push(m.text());
  });
  page.on("pageerror", (e) => refused.push(`page error: ${e.message}`));
  await page.goto(site.url + url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  return { context, page, outside, refused };
}

async function axe(page) {
  await page.evaluate(AXE);
  return page.evaluate(async (tags) => {
    const r = await globalThis.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
  }, WCAG);
}

for (const url of pages()) {
  test(`${url} is accessible in light and dark and loads only from the site`, async ({ browser }) => {
    for (const scheme of ["light", "dark"]) {
      const { context, page, outside, refused } = await open(browser, url, scheme);
      // Starlight follows the system theme when the visitor hasn't picked one.
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
      if (theme !== null) expect(theme, `${url} follows the ${scheme} system theme`).toBe(scheme);
      const violations = await axe(page);
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      for (const v of violations.filter((x) => !serious.includes(x))) {
        test.info().annotations.push({ type: `axe ${v.impact} (${scheme})`, description: `${v.id}: ${v.help} ${v.nodes.join(", ")}` });
      }
      expect(serious, `${url} (${scheme}) serious or critical axe issues`).toEqual([]);
      expect(outside, `${url} (${scheme}) requests to other hosts`).toEqual([]);
      expect(refused, `${url} (${scheme}) refused by the Content Security Policy or failing`).toEqual([]);
      await context.close();
    }
  });
}

test("search finds pages without leaving the site", async ({ browser }) => {
  const { context, page, outside, refused } = await open(browser, "/", "light");
  await page.getByRole("button", { name: "Search" }).first().click();
  await page.getByRole("dialog", { name: "Search" }).getByRole("textbox", { name: "Search" }).fill("privacy");
  await expect(page.locator(".pagefind-ui__result-link").first()).toBeVisible({ timeout: 10_000 });
  await page.waitForLoadState("networkidle");
  expect(outside).toEqual([]);
  expect(refused).toEqual([]);
  await context.close();
});

test("/connect/ with a code and no Kotiko stays plain text and asks for nothing", async ({ browser }) => {
  const context = await browser.newContext();
  const requests = [];
  context.on("request", (r) => requests.push(r.url()));
  const page = await context.newPage();
  await page.goto(`${site.url}/connect/?code=test-code-0123456789`, { waitUntil: "networkidle" });
  const status = page.locator("#kotiko-connect-status");
  await expect(status).toHaveText(/If Kotiko is installed in this browser, it is finishing your sign-in now/);
  await expect(status).toHaveAttribute("role", "status");
  expect(await page.evaluate(() => document.scripts.length)).toBe(0);
  // Only the page itself carries the code; its stylesheet and icons don't.
  const others = requests.filter((u) => !u.includes("/connect/?code="));
  expect(others.every((u) => u.startsWith(site.url) && !u.includes("test-code"))).toBe(true);
  expect(requests.filter((u) => u.includes("test-code"))).toHaveLength(1);
  await context.close();
});
