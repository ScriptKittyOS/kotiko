// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 22 in a real browser: a fresh install opens the welcome tab; the learner points
// "Another service" at the fixture server's fake model, asks for a word, confirms it,
// gets the confetti and the preview, and sees the word swapped on the page "Try it on a
// page" opens (a stand-in for the Wikipedia search). The typed "native = meaning" path
// makes no request at all. An update never opens the welcome tab.
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, EXT_DIR } from "./fixtures.mjs";

const KEY = "test-provider-key-0123456789";
const WIKI = "https://simple.wikipedia.org/";

// The welcome tab the install opened.
async function welcomeTab(context, extensionId) {
  const url = `chrome-extension://${extensionId}/welcome.html`;
  await expect.poll(() => context.pages().some((p) => p.url() === url), { timeout: 10_000 }).toBe(true);
  const page = context.pages().find((p) => p.url() === url);
  await expect(page.locator('#main[data-ready="true"]')).toBeAttached();
  return page;
}

test("a fresh install opens the welcome tab once: connect a provider, ask, confirm, confetti, preview, and the word on a page", async ({ context, extensionId, server, blocked }) => {
  const page = await welcomeTab(context, extensionId);
  expect(context.pages().filter((p) => p.url().includes("welcome.html"))).toHaveLength(1);
  await expect(page.locator("#askText")).toBeFocused();
  await expect(page.locator(".base-chip")).toHaveText(["English"]);

  // Connect "Another service" at the fake model's address, with a key.
  await page.locator("#aiOther").click();
  await page.getByRole("radio", { name: "Another service" }).click();
  await page.locator("#otherUrl").fill(server.llmUrl);
  await page.locator("#otherUrl").press("Enter");
  await expect(page.locator("#aiConnectedText")).toHaveText("Connected to Another service.");
  await page.locator("#aiChange").click();
  await page.locator("#aiOther").click();
  await page.locator("#otherKey").fill(KEY);
  await page.locator("#otherKey").press("Enter");
  await expect(page.locator("#aiConnectedText")).toHaveText("Connected to Another service.");

  // Ask, see the card, nothing saved yet.
  await page.locator("#askText").fill("how do you say hello in Japanese");
  await page.locator("#askText").press("Enter");
  await expect(page.locator(".wcard-word")).toHaveText("こんにちは");
  await expect(page.locator(".wcard-rom")).toHaveText("konnichiwa · AI-generated");
  const before = await page.evaluate(async () => ({ local: await chrome.storage.local.get({ words: [] }) }));
  expect(before.local.words).toEqual([]);

  // Make it my first word: the confetti (motion allowed), the message, the preview.
  await page.locator("#confirm").click();
  await expect(page.locator("#celebrateLine")).toHaveText("Congrats, you got your first word!");
  await expect(page.locator("canvas.kotiko-confetti")).toBeAttached();
  await expect(page.locator("canvas.kotiko-confetti")).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator(".preview-after")).toHaveText("She said こんにちは and waved from the bus.");
  await expect(page.locator("#tryPage")).toBeFocused();
  const state = await page.evaluate(async () => chrome.storage.local.get(["celebrations", "onboarding"]));
  expect(state.celebrations.done["vocab:first"]).toBeGreaterThan(0);
  expect(state.onboarding.completedAt).toBeGreaterThan(0);

  // The real popover opens on the preview's word.
  await page.locator(".preview-after kotiko-w").click();
  await expect(page.locator("kotiko-popover")).toBeAttached();

  // Try it on a page: the Wikipedia search for "hello", served here by the fixture.
  await expect(page.locator("#tryPage")).toHaveAttribute("href", "https://simple.wikipedia.org/w/index.php?search=hello&fulltext=1&ns0=1");
  const html = await fs.readFile(path.join(EXT_DIR, "../test/fixtures/pages/wiki-search.html"), "utf8");
  await context.route(`${WIKI}**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  const [wiki] = await Promise.all([context.waitForEvent("page"), page.locator("#tryPage").click()]);
  await expect(wiki.locator("#r1")).toHaveText("こんにちは: こんにちは is a greeting in the English language.");
  await expect(wiki.locator("#r2 kotiko-w")).toHaveText("こんにちは");
  expect(page.isClosed()).toBe(false);

  // The only request that left localhost is the one the learner asked for.
  expect(blocked.every((u) => u.startsWith(WIKI))).toBe(true);
  blocked.splice(0, blocked.length);
  const chats = (await server.state()).log.filter((r) => r.path === "/llm/v1/chat/completions");
  expect(chats.at(-1).auth).toBe(`Bearer ${KEY}`);
});

test("the typed path with no AI: three steps, no request at all, and the word swaps on a page", async ({ context, extensionId, server }) => {
  const page = await welcomeTab(context, extensionId);
  await page.locator("#askText").fill("ありがとう = thanks");
  await page.locator("#askText").press("Enter");
  await page.locator("#confirm").click();
  await expect(page.locator("#celebrateLine")).toHaveText("Congrats, you got your first word!");
  await expect(page.locator(".preview-after")).toHaveText("ありがとう for the coffee, it was perfect.");
  expect((await server.state()).log).toEqual([]);
  const fixture = await context.newPage();
  await fixture.goto(server.page("basic.html"));
  await expect(fixture.locator("#p1")).toHaveText("ありがとう for visiting. This house has three rooms and a garden.");
});

test("an update never opens the welcome tab, and an existing learner gets no first-word celebration", async ({ context, extensionId, serviceWorker }) => {
  // The install opened it once; close it, and make this profile look like a learner from
  // before the welcome tab: words, and no first-run state.
  const first = await welcomeTab(context, extensionId);
  await first.close();
  // The install's own projection writes the (empty) word list; let it land before ours.
  await expect.poll(() => serviceWorker.evaluate(async () => !!(await chrome.storage.local.get("wordsVersion")).wordsVersion)).toBe(true);
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.remove(["onboarding"]);
    await chrome.storage.local.set({ words: [{ id: "1", lang: "ru", native: "дом", base_lang: "en", gloss: "house", forms: ["house"] }] });
  });
  // An unpacked extension can't be updated in this harness (a reload disables it), so the
  // worker's own onInstalled listener runs with what Chrome sends on an update, against the
  // real tabs and storage APIs.
  await serviceWorker.evaluate(() => {
    globalThis.__kotiko.onInstalled({ reason: "update", previousVersion: "0.2.0" });
    globalThis.__kotiko.onInstalled({ reason: "chrome_update" });
  });
  await expect.poll(() => serviceWorker.evaluate(async () => (await chrome.storage.local.get("onboarding")).onboarding?.upgraded ?? false), { timeout: 10_000 }).toBe(true);
  const { celebrations } = await serviceWorker.evaluate(() => chrome.storage.local.get("celebrations"));
  expect(celebrations.done["vocab:first"]).toBeGreaterThan(0);
  // A new tab would have opened by now: the storage write above comes after the decision.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  // Past the first run: the popup never sends this learner to the welcome tab.
  await expect(popup.locator('#main[data-ready="true"]')).toBeAttached();
  // The first-run card may be hidden (the learner has words) with its default text still in
  // the DOM; what matters is that a visible card never asks this learner to finish setup.
  if (await popup.locator("#firstRun").isVisible()) {
    await expect(popup.locator("#firstRunTitle")).not.toHaveText("Finish setting up Kotiko");
  }
  expect(context.pages().some((p) => p.url().includes("welcome.html"))).toBe(false);
});
