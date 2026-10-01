// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
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

test("installs: the background worker runs and the popup opens", async ({ extensionId, popup }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  const page = await popup.page();
  await expect(page.locator("h1")).toBeVisible();
  // The install-time sync has no token yet, so the popup asks for one.
  await expect(page.locator("#status")).toHaveText(/^(Not synced yet\.|Paste your API token to connect\.)$/);
  await expect(page.locator("#conn")).toHaveAttribute("open", "");
});

test("connects to the server, syncs, swaps words on a page and restores them when off", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.miraUrl, server.token);
  await expect(p.locator("#status")).toHaveText(/^2 words known, synced/);
  await expect(p.locator("#langs li")).toHaveCount(1);
  await expect(p.locator("#langs li label")).toHaveText("Russian");

  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);
  const swapped = page.locator("#p1 span.slovo-w").first();
  await expect(swapped).toHaveAttribute("lang", "ru");
  await expect(swapped).toHaveAttribute("title", "Thanks = спасибо (spasibo) · Russian");
  await expect(page.locator("#code")).toHaveText("thanks in a pre block stays English");

  await p.locator("#enabled").uncheck();
  await expect(page.locator("#p1")).toHaveText(P1);
  await expect(page.locator("span.slovo-w")).toHaveCount(0);

  await p.locator("#enabled").check();
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);

  const requests = (await server.state()).log.filter((r) => r.path === "/mira/api/words");
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((r) => r.auth === `Bearer ${server.token}`)).toBe(true);
});

test("hiding a language restores its words on the page", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.miraUrl, server.token);
  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);

  await p.locator("#lang-ru").uncheck();
  await expect(page.locator("#p1")).toHaveText(P1);
  await p.locator("#showAll").click();
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);
});

test("adds a word from the popup through the server", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.miraUrl, server.token);

  const added = await popup.add("sobaka");
  await expect(added).toHaveText(/^Added собака \(sobaka\) = dog · Russian undo$/);
  await expect(p.locator("#status")).toHaveText(/^3 words known, synced/);
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
  await added.locator("button", { hasText: "undo" }).click();
  await expect(added).toHaveText("Removed.");
  await expect(page.locator("#late")).toHaveText("A dog arrives later.");
  expect((await server.state()).words.map((w) => w.native)).not.toContain("собака");
});

test("shows the server's errors in the popup", async ({ server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.miraUrl, server.token);
  await server.control({ mira: "401" });
  await p.locator("#syncNow").click();
  await expect(p.locator("#status")).toHaveText("The server rejected that API token.");
});

test("nothing outside localhost is requested, and the guard catches it when it is", async ({ context, server, popup, blocked }) => {
  await server.control({ words: WORDS });
  await popup.connect(server.miraUrl, server.token);
  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);
  expect(blocked).toEqual([]);

  // Prove the guard works: a deliberate external request is blocked and recorded.
  await page.evaluate(() => fetch("http://example.com/should-be-blocked").catch(() => {}));
  await expect.poll(() => blocked.slice()).toContain("http://example.com/should-be-blocked");
  blocked.length = 0;
});
