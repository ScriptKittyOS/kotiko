// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 02 smoke: install, connect to the fake server, sync, swap on basic.html, toggle
// off, add from the popup, and never leave localhost.
import { test, expect } from "./fixtures.mjs";

// Two Russian words, so what the page shows is deterministic (no language rotation).
const WORDS = [
  { id: 2, lang: "ru", language: "Russian", native: "дом", romanization: "dom", english: "house", forms: ["house", "houses"], note: null },
  { id: 1, lang: "ru", language: "Russian", native: "спасибо", romanization: "spasibo", english: "thanks", forms: ["thanks", "thank you"], note: null },
];
const P1 = "Thanks for visiting. This house has three rooms and a garden.";
const P1_SWAPPED = "Спасибо for visiting. This дом has three rooms and a garden.";

test("installs: the background worker runs and the popup opens on its first-run card", async ({ extensionId, popup }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  const page = await popup.page();
  await expect(page.locator(".wordmark")).toHaveText("Kotiko");
  // No server yet: a friendly setup card, never a red error or an open settings panel.
  await expect(page.locator("#firstRun")).toBeVisible();
  await expect(page.locator("#banners .banner")).toHaveCount(0);
  await expect(page.locator("#settings")).toBeHidden();
  await expect(page.locator("#addText")).toBeFocused();
});

test("connects to the server, syncs, swaps words on a page and restores them when off", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);
  await expect(p.locator("#count")).toHaveText("2 words");
  await expect(p.locator("#chips .chip")).toHaveCount(1);
  await expect(p.locator("#chips .chip .chip-label")).toHaveText("Русский");
  await expect(p.locator("#chips .chip")).toHaveAccessibleName("Russian, Русский, 2 words, shown");

  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);
  const swapped = page.locator("#p1 kotiko-w").first();
  await expect(swapped).toHaveAttribute("lang", "ru");
  // Nothing about the vocabulary in the page's DOM (slices 15 and 19): no title, no data-*.
  expect(await swapped.evaluate((el) => el.getAttributeNames().sort())).toEqual(["class", "dir", "lang", "translate"]);
  await expect(page.locator("#code")).toHaveText("thanks in a pre block stays English");

  const master = p.getByRole("switch", { name: "Swap words on pages" });
  await master.click();
  await expect(master).toHaveAttribute("aria-checked", "false");
  await expect(p.locator("#bannerOff")).toContainText("Kotiko is off on all sites.");
  await expect(page.locator("#p1")).toHaveText(P1);
  await expect(page.locator("kotiko-w")).toHaveCount(0);

  await p.locator('#bannerOff [data-action="turn-on"]').click();
  await expect(master).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);

  const requests = (await server.state()).log.filter((r) => r.path === "/kotiko/api/words");
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((r) => r.auth === `Bearer ${server.token}`)).toBe(true);
});

test("hiding a language restores its words on the page", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);
  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);

  const chip = p.locator('#chips .chip[data-lang="ru"]');
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#p1")).toHaveText(P1);
  await p.locator("#showAll").click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);
});

test("adds a word from the popup through the server", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);

  const added = await popup.add("sobaka");
  await expect(added).toHaveText(/^Added собака \(sobaka\) = dog · Russian\s*Undo$/);
  await expect(p.locator("#count")).toHaveText("3 words");
  expect((await server.state()).words.map((w) => w.native)).toContain("собака");

  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);

  await page.evaluate(() => {
    const p = document.createElement("p");
    p.id = "late";
    p.textContent = "A dog arrives later.";
    document.body.append(p);
  });
  await expect(page.locator("#late")).toHaveText("A собака arrives later.");

  // Undo removes it on the server and from the page.
  await added.getByRole("button", { name: "Undo adding собака" }).click();
  await expect(p.locator("#jobs li").first()).toHaveText("Removed собака.");
  await expect(page.locator("#late")).toHaveText("A dog arrives later.");
  expect((await server.state()).words.map((w) => w.native)).not.toContain("собака");
});

test("the add box clears at once, even when the server is slow", async ({ server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);
  await server.control({ kotiko: "slow", delayMs: 5000 });
  const input = p.locator("#addText");
  await input.fill("sobaka");
  const t0 = Date.now();
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  expect(Date.now() - t0).toBeLessThan(1000);
  await expect(p.locator("#jobs li").first()).toHaveText("Looking up sobaka…");
});

test("shows the server's errors in the popup, in plain words", async ({ server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);
  await server.control({ kotiko: "401" });
  await p.locator("#openSettings").click();
  await p.locator("#checkNow").click();
  await expect(p.locator("#connStatus .banner-body")).toHaveText(
    "Your Kotiko server didn't accept the access key. Paste it again in Connection settings.",
  );
  await p.locator("#closeSettings").click();
  await expect(p.locator("#bannerSync")).toHaveAttribute("data-severity", "blocking");
  await expect(p.locator("#bannerSync .banner-body")).toHaveText(
    "Your Kotiko server didn't accept the access key. Paste it again in Connection settings.",
  );
});

test("nothing outside localhost is requested, and the guard catches it when it is", async ({ context, server, popup, blocked }) => {
  await server.control({ words: WORDS });
  await popup.connect(server.kotikoUrl, server.token);
  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);
  expect(blocked).toEqual([]);

  // Prove the guard works: a deliberate external request is blocked and recorded.
  await page.evaluate(() => fetch("http://example.com/should-be-blocked").catch(() => {}));
  await expect.poll(() => blocked.slice()).toContain("http://example.com/should-be-blocked");
  blocked.length = 0;
});
