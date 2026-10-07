// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 26: background sync correctness in a real browser. A token fixed while a request
// with the old one is in flight shows the new result, a word added against a slow server
// is on the next page, and an address typed without a scheme connects.
import { test, expect } from "./fixtures.mjs";

const WORDS = [
  { id: 2, lang: "ru", language: "Russian", native: "дом", romanization: "dom", english: "house", forms: ["house", "houses"], note: null },
  { id: 1, lang: "ru", language: "Russian", native: "спасибо", romanization: "spasibo", english: "thanks", forms: ["thanks", "thank you"], note: null },
];

const storage = (page, keys) => page.evaluate((k) => globalThis.chrome.storage.local.get(k), keys);

test("fixing the token during a slow sync shows the new result, never the old 401", async ({ server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);

  // Record every status the popup shows from here on (settings and the banner area).
  await p.evaluate(() => {
    window.__statuses = [];
    for (const id of ["connStatus", "banners"]) {
      const el = document.getElementById(id);
      new MutationObserver(() => window.__statuses.push(el.textContent)).observe(el, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  });

  await server.control({ kotiko: "slow", delayMs: 2000 });
  await p.locator("#openSettings").click();
  await p.locator("#accessKey").fill("wrong-token");
  await p.locator("#saveConn").click();
  // The request with the wrong token is now waiting on the slow server.
  await p.waitForTimeout(300);
  const fixedAt = Date.now();
  await p.locator("#accessKey").fill(server.token);
  await p.locator("#saveConn").click();

  // Long enough for both requests to have answered had the first not been cancelled.
  await expect.poll(async () => (await storage(p, ["lastSync"])).lastSync ?? 0, { timeout: 10_000 }).toBeGreaterThan(fixedAt);
  await p.waitForTimeout(2500);

  const s = await storage(p, ["syncError", "lastSync", "words"]);
  expect(s.syncError).toBeNull();
  expect(s.words.map((w) => w.native)).toEqual(["дом", "спасибо"]);
  await expect(p.locator("#connStatus")).toHaveText(/^Connected\. Your server has 2 words\./);
  const shown = await p.evaluate(() => window.__statuses);
  expect(shown.filter((t) => /didn't accept/i.test(t))).toEqual([]);

  // The server never got a request signed with the wrong token: it couldn't prove it holds
  // that one (slice 54, B-01); no token is ever sent (D-01). The refusal of that superseded
  // sync was dropped too.
  const log = (await server.state()).log;
  expect(log.some((r) => r.auth && !r.signed)).toBe(false);
  expect(log.some((r) => r.auth?.includes("wrong-token") || r.auth?.includes(server.token))).toBe(false);
  expect(log.some((r) => r.path === "/kotiko/api/v1/proof")).toBe(true);
});

test("a word added against a slow server is on the next page", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  await popup.connect(server.kotikoUrl, server.token);
  await server.control({ kotiko: "slow", delayMs: 3000 });

  const added = await popup.add("sobaka");
  await expect(added).toHaveText(/^Added собака \(sobaka\) = dog · Russian\s*Undo$/);

  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await page.evaluate(() => {
    const p = document.createElement("p");
    p.id = "late";
    p.textContent = "A dog arrives.";
    document.body.append(p);
  });
  await expect(page.locator("#late")).toHaveText("A собака arrives.");
});

test("an address typed without http:// connects", async ({ server, popup }) => {
  await server.control({ words: WORDS });
  const bare = server.kotikoUrl.replace(/^http:\/\//, "");
  const p = await popup.connect(bare, server.token);
  await expect(p.locator("#count")).toHaveText("2 words");
});

test("an address with a user name explains what to do instead of 'can't reach'", async ({ server, popup }) => {
  const p = await popup.page();
  await p.locator("#openSettings").click();
  await p.locator("#serverUrl").fill(server.kotikoUrl.replace("http://", "http://me:secret@"));
  await p.locator("#accessKey").fill(server.token);
  await p.locator("#saveConn").click();
  await expect(p.locator("#connStatus .banner-body")).toHaveText(
    "That server address doesn't look right. Try one like http://127.0.0.1:4747.",
  );
  await p.locator("#connStatus summary").click();
  await expect(p.locator("#connStatus details pre")).toContainText("Leave the user name and password out of the address");
  expect((await server.state()).log).toEqual([]);
});
