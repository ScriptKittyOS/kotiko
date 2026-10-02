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

test("hide a language in two steps and show only one in two (20 §3)", async ({ server, popup, context }) => {
  await server.control({ words: WORDS });
  await popup.connect(server.kotikoUrl, server.token);
  // Step 1 is opening the popup.
  const p = await context.newPage();
  await p.goto(popup.url);
  await p.locator('#chips [data-only-lang="ar"]').click(); // step 2
  await expect(p.locator("#onlyStrip")).toHaveText("Showing only العربية · Show all");
  await expect.poll(() => p.evaluate(() => chrome.storage.local.get("hiddenLangs").then((s) => s.hiddenLangs))).toEqual(["ru"]);
});

test.describe("with the browser in Spanish", () => {
  test.use({ browserLang: "es" });

  test("the popup, its accessible names and the extension's name are Spanish", async ({ server, popup }) => {
    const first = await popup.page();
    await expect(first.locator("#firstRunTitle")).toHaveText("Termina de configurar Kotiko");
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
