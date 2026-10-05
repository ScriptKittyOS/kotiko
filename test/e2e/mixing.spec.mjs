// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 18 in the browser: one language per word per page that stays through reloads, and
// Focus holding back a language added while it's on.
import { test, expect } from "./fixtures.mjs";

const w = (id, lang, native, english) => ({ id, lang, language: null, native, romanization: null, english, forms: [english], note: null, created_at: "2026-01-01T00:00:00Z" });
const WORDS = [
  w(1, "es", "gracias", "thanks"), w(2, "ru", "спасибо", "thanks"), w(3, "zh", "谢谢", "thanks"),
  w(4, "es", "casa", "house"), w(5, "ru", "дом", "house"),
  w(6, "es", "perro", "dog"), w(7, "ru", "собака", "dog"), w(8, "zh", "狗", "dog"),
];

const swaps = (page) => page.locator("kotiko-w").evaluateAll((els) => els.map((e) => `${e.lang}:${e.textContent}`));

test("each word shows one language on the page, and the same after three reloads", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  await popup.connect(server.kotikoUrl, server.token);
  const page = await context.newPage();
  await page.goto(server.page("mixing.html"));
  await expect(page.locator("kotiko-w")).toHaveCount(10);
  const first = await swaps(page);
  // Every "thanks", every "house", every "dog" in one language each.
  const byWord = (list, natives) => new Set(list.filter((s) => natives.some((n) => s.endsWith(`:${n}`) || s.toLowerCase().endsWith(`:${n}`))).map((s) => s.split(":")[0]));
  expect(byWord(first, ["gracias", "спасибо", "谢谢"]).size).toBe(1);
  expect(byWord(first, ["casa", "дом"]).size).toBe(1);
  expect(byWord(first, ["perro", "собака", "狗"]).size).toBe(1);
  for (let i = 0; i < 3; i++) {
    await page.reload();
    await expect(page.locator("kotiko-w")).toHaveCount(10);
    expect(await swaps(page)).toEqual(first);
  }
});

test("Focus: only the focused language; a language added during Focus waits, and the popup says so", async ({ context, server, popup, serviceWorker }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);
  await p.locator('#chips [data-focus-lang="zh"]').click();
  const page = await context.newPage();
  await page.goto(server.page("mixing.html"));
  await expect(page.locator("#p1")).toHaveText("Many 谢谢 for the house. The 狗 likes the house.");
  // A Turkish word arrives from elsewhere while focusing.
  await serviceWorker.evaluate(async () => {
    const { words } = await chrome.storage.local.get("words");
    await chrome.storage.local.set({ words: [...words, { id: 99, lang: "tr", native: "ev", english: "house", forms: ["house"], base_lang: "en", status: "active", created_at: new Date().toISOString() }] });
  });
  await expect(p.locator("#focusStrip")).toContainText("Turkish is new. It's waiting until you leave Focus.");
  await expect(page.locator("#p1")).toHaveText("Many 谢谢 for the house. The 狗 likes the house.");
  // Stop: everything shows again, the new language included.
  await p.locator('#focusStrip [data-action="stop-focus"]').click();
  await expect(page.locator("#p1 kotiko-w")).toHaveCount(4);
});
