// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 25 §4: swapping never depends on the network. With the server stopped, the popup
// says so calmly, counts the words that still work, and pages keep their swaps.
import { test, expect } from "./fixtures.mjs";

const WORDS = [
  { id: 2, lang: "ru", language: "Russian", native: "дом", romanization: "dom", english: "house", forms: ["house", "houses"], note: null },
  { id: 1, lang: "ru", language: "Russian", native: "спасибо", romanization: "spasibo", english: "thanks", forms: ["thanks", "thank you"], note: null },
];
const P1_SWAPPED = "Спасибо for visiting. This дом has three rooms and a garden.";

test("with the server stopped: a calm state with the word count, and pages keep their swaps", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);
  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);

  // The server stops: every connection closes unanswered.
  await server.control({ kotiko: "down" });
  await p.locator("#openSettings").click();
  await p.locator("#checkNow").click();
  await expect(p.locator("#connStatus .banner-body")).toHaveText(/^Can't reach your Kotiko server\./);
  await p.locator("#closeSettings").click();

  const banner = p.locator("#bannerSync");
  await expect(banner).toHaveAttribute("data-severity", "state");
  await expect(banner.locator(".banner-body")).toHaveText("Can't reach your Kotiko server. Your 2 words still work on pages; adding new ones will work once it's back.");
  await expect(banner.locator('[data-action="retry"]')).toBeVisible();
  await expect(p.locator("#settings")).toBeHidden();

  // Details: the technical cause, one click away, and Copy details in a real browser.
  await banner.locator("details summary").click();
  await expect(banner.locator("details pre")).toContainText(server.kotikoUrl);
  await banner.locator('[data-action="copy-details"]').click();
  // "Copied" shows only once the browser accepted the write (its content: test/dom).
  await expect(banner.locator('[data-action="copy-details"]')).toHaveText("Copied");

  // A page opened now still swaps, from the words cached in this browser.
  await page.reload();
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);
  const other = await context.newPage();
  await other.goto(server.page("basic.html"));
  await expect(other.locator("#p1")).toHaveText(P1_SWAPPED);

  // Back up: Try again clears the state, with no "back online" message.
  await server.control({ kotiko: null });
  await banner.locator('[data-action="retry"]').click();
  await expect(p.locator("#bannerSync")).toHaveCount(0);
  await expect(p.locator("#banners .banner")).toHaveCount(0);
});

test("a captive portal's page is not a word list: the popup says so and the cached words stay", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);
  await server.control({ kotiko: "html" });
  await p.locator("#openSettings").click();
  await p.locator("#checkNow").click();
  await p.locator("#closeSettings").click();
  await expect(p.locator("#bannerSync")).toHaveAttribute("data-severity", "blocking");
  await expect(p.locator("#bannerSync .banner-body")).toHaveText("Something answered at that address, but it isn't a Kotiko server. Check the address.");
  await expect(p.locator("#count")).toHaveText("2 words");
  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);
});
