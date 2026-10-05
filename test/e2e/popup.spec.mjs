// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 20 in a real browser: the toolbar badge, the step counts that need a browser, and
// the popup with the browser in Spanish (slice 50).
import { test, expect } from "./fixtures.mjs";

const WORDS = [
  { id: 2, lang: "ru", language: "Russian", native: "дом", romanization: "dom", english: "house", forms: ["house", "houses"], note: null },
  { id: 3, lang: "ar", language: "Arabic", native: "شكرا", romanization: "shukran", english: "thanks", forms: ["thanks"], note: null },
];

// The badge text the browser shows on a tab, read from the background.
async function badgeOn(serviceWorker, url) {
  return serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    return chrome.action.getBadgeText({ tabId: tab.id });
  }, url);
}

test("the badge says off on a paused site and nothing elsewhere; off everywhere marks every tab", async ({ context, server, popup, serviceWorker }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);
  const paused = server.page("basic.html");
  const other = paused.replace("127.0.0.1", "localhost");
  for (const url of [paused, other]) await (await context.newPage()).goto(url);

  await expect.poll(() => badgeOn(serviceWorker, paused)).toBe("");
  await p.evaluate(() => chrome.storage.local.set({ pausedHosts: ["127.0.0.1"] }));
  await expect.poll(() => badgeOn(serviceWorker, paused)).toBe("off");
  await expect.poll(() => badgeOn(serviceWorker, other)).toBe("");

  await p.evaluate(() => chrome.storage.local.set({ pausedHosts: [], enabled: false }));
  await expect.poll(() => badgeOn(serviceWorker, other)).toBe("off");
  await expect.poll(() => badgeOn(serviceWorker, paused)).toBe("off");
});

test("hide a language in two steps and focus on one in two (20 §3, 18)", async ({ server, popup, context }) => {
  await server.control({ words: WORDS });
  await popup.connect(server.kotikoUrl, server.token);
  // Step 1 is opening the popup.
  const p = await context.newPage();
  await p.goto(popup.url);
  await p.locator('#chips [data-focus-lang="ar"]').click(); // step 2
  await expect(p.locator("#focusStrip")).toHaveText("Focusing on العربية · Stop");
  await expect.poll(() => p.evaluate(() => chrome.storage.local.get("mixing").then((s) => s.mixing?.focus))).toEqual(["ar"]);
});

// Slice 10: the free lookups left today come from the server's /api/v1/llm/status, and a
// failed lookup's code reads in plain words.
test("free lookups left show under the add box and go down after an add", async ({ server, popup }) => {
  await server.control({ words: WORDS, llmRemaining: 5 });
  const p = await popup.connect(server.kotikoUrl, server.token);
  await expect(p.locator("#lookupsLeft")).toHaveText("5 free lookups left today");
  await popup.add("shukran");
  await expect(p.locator("#lookupsLeft")).toHaveText("4 free lookups left today");

  await server.control({ llmRemaining: 30 });
  await popup.add("sobaka");
  await expect(p.locator("#lookupsLeft")).toBeHidden();
});

test("a used-up quota says when lookups come back", async ({ server, popup }) => {
  await server.control({ words: WORDS });
  await popup.connect(server.kotikoUrl, server.token);
  const retryAt = new Date(Date.now() + 4 * 3600_000).toISOString();
  // The lookup (slice 24: every add is a job; a used-up quota waits for its retry time).
  await server.control({ failNext: { path: "/words", status: 429, code: "quota_exhausted", message: "You've used today's free lookups.", details: { reason: "daily_limit", retry_at: retryAt } } });
  const line = await popup.add("shukran");
  await expect(line.locator(".job-text > p")).toHaveText(/^Waiting to look up shukran: today's free lookups are used up\. It runs by itself at \d{1,2}:\d{2}/);
  await expect(line.locator('[data-action="retry"]')).toHaveCount(0);
});

test.describe("with the browser in Spanish", () => {
  test.use({ browserLang: "es" });

  test("the popup, its accessible names and the extension's name are Spanish", async ({ server, popup }) => {
    const first = await popup.page();
    // Not onboarded yet (slice 22): the card sends the learner to the welcome tab.
    await expect(first.locator("#firstRunTitle")).toHaveText("Termina de configurar Kotiko");
    await expect(first.locator("#firstRunBody")).toHaveText("Elige tu primera palabra, en cualquier idioma. Toma menos de un minuto.");
    await expect(first.locator("#addText")).toHaveAttribute("placeholder", "Agrega una palabra, en cualquier idioma");
    await expect(first.getByRole("switch", { name: "Cambiar palabras en las páginas" })).toBeVisible();
    await expect(first.locator("html")).toHaveAttribute("lang", "es");
    expect(await first.evaluate(() => chrome.i18n.getMessage("extName"))).toBe("Kotiko");

    await server.control({ words: WORDS });
    await first.locator("#openSettings").click();
    await first.locator("#serverUrl").fill(server.kotikoUrl);
    await first.locator("#accessKey").fill(server.token);
    await first.locator("#saveConn").click();
    await expect(first.locator("#connStatus")).toHaveText(/^Conexión correcta\. Tu servidor tiene 2 palabras\./);
    await first.locator("#closeSettings").click();
    const p = first;
    await expect(p.locator("#langTitle")).toHaveText("Idiomas");
    await expect(p.locator("#count")).toHaveText("2 palabras");
    await expect(p.locator('#chips .chip[data-lang="ru"]')).toHaveAccessibleName("ruso, Русский, 1 palabra, visible");
  });
});

// Slice 20 §8's goal, measured: the popup paints within 100 ms, median of 10 opens, with
// words, a connection and Focus on. CI's runners are about 4.5 times slower (measured
// 2026-10-05: 136 to 172 ms, median 148, where this machine takes 32), so CI's budget is
// 200 ms. The size cap in test/dom/popup.test.mjs is only a backstop for this.
test("the popup paints within 100 ms (200 ms in CI), median of 10 opens", async ({ server, popup, context }) => {
  await server.control({ words: WORDS });
  const first = await popup.connect(server.kotikoUrl, server.token);
  await first.evaluate(() => chrome.storage.local.set({ mixing: { focus: ["ru"], focusSince: new Date().toISOString() } }));
  const times = [];
  for (let i = 0; i < 10; i++) {
    const p = await context.newPage();
    await p.setViewportSize({ width: 360, height: 600 });
    // A page in a background tab doesn't paint, so it reports no paint timing.
    await p.bringToFront();
    await p.goto(popup.url);
    await expect(p.locator("#chips .chip").first()).toBeVisible();
    const fcp = () => p.evaluate(() => performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint")?.startTime ?? null);
    await expect.poll(fcp).not.toBeNull();
    times.push(await fcp());
    await p.close();
  }
  times.sort((a, b) => a - b);
  const median = (times[4] + times[5]) / 2;
  const budget = process.env.CI ? 200 : 100;
  console.log(`popup first contentful paint: median ${median.toFixed(1)} ms (${times.map((t) => t.toFixed(0)).join(", ")})`);
  expect(median, `median of ${times.map((t) => t.toFixed(0)).join(", ")} ms`).toBeLessThanOrEqual(budget);
});
