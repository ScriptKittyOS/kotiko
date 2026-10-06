// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 27 §2 on real pages: what the accessibility tree holds for a swapped word by
// default (the word, in its own language), with "Screen readers hear swapped words as" set
// to the original word or both (the page's own text, tagged with the language slice 16
// resolved for it, hidden from sight and from copies), and with "Let me Tab to swapped
// words" on (Tab reaches the word, Enter opens its card, Esc comes back). None of them moves
// anything on the page. The manual screen-reader passes are in docs/accessibility.md.
import { test, expect, connectServer } from "./fixtures.mjs";
import { POPOVER_WORDS } from "../helpers/popover-words.mjs";
import { readCard } from "../helpers/closed-shadow.mjs";

async function setup({ server, serviceWorker, context }, prefs = {}) {
  await server.control({ words: POPOVER_WORDS });
  await expect.poll(() => serviceWorker.evaluate(async () => !!(await chrome.storage.local.get("onboarding")).onboarding)).toBe(true);
  await serviceWorker.evaluate(async (o) => {
    await globalThis.__kotiko.seed({ ui: { uiLang: "auto", baseLangs: ["en", "es"], baseLangsConfirmed: true } });
    await globalThis.__kotiko.seed({ words: o.words, enabled: true, lastSync: Date.now(), mixing: { mode: "mix" }, prefs: o.prefs });
  }, { words: POPOVER_WORDS, prefs });
  await connectServer(context, serviceWorker, server.kotikoUrl, server.token);
  await expect.poll(() => serviceWorker.evaluate(async () => Object.keys((await chrome.storage.local.get("baseRules")).baseRules ?? {}).join())).toBe("en,es");
}

const setPrefs = (serviceWorker, prefs) => serviceWorker.evaluate((p) => globalThis.__kotiko.seed({ prefs: p }), prefs);

// The page as it lays out, and the swap's markup, for one word.
const look = (page, native) =>
  page.evaluate((n) => {
    const w = [...document.querySelectorAll("kotiko-w")].find((x) => (x.querySelector("kotiko-v") ?? x).textContent === n);
    const p = w.closest("p");
    const r = w.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    return {
      lang: w.lang,
      attrs: w.getAttributeNames().sort().join(","),
      shown: (w.querySelector("kotiko-v") ?? w).textContent,
      shownHidden: w.querySelector("kotiko-v")?.getAttribute("aria-hidden") ?? null,
      heard: [...(w.querySelector("kotiko-sr")?.childNodes ?? [])].map((c) => (c.nodeType === 1 ? `${c.textContent}@${c.lang}` : c.textContent)),
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(","),
      paragraph: [Math.round(pr.width), Math.round(pr.height)].join(","),
      selected: (getSelection().selectAllChildren(p), getSelection().toString().replace(/\s+/g, " ").trim()),
    };
  }, native);

test("by default a swap is the word in its own language; the original word or both are opt-in, hidden from sight and copies, and move nothing", async ({ context, server, serviceWorker }) => {
  await setup({ server, serviceWorker, context });
  const page = await context.newPage();
  await page.goto(server.page("popover-light.html"));
  await expect(page.locator("#p1 kotiko-w").first()).toBeVisible();
  const before = await look(page, "пожалуйста");
  expect(before).toMatchObject({ lang: "ru", attrs: "class,dir,lang,translate", shown: "пожалуйста", shownHidden: null, heard: [] });
  // What a screen reader gets: the swapped word (read in a Russian voice: lang="ru").
  await expect(page.locator("#p1")).toMatchAriaSnapshot("- paragraph: /^Come in, пожалуйста, and sit down\\./");

  // The original word, on an English page: the page's own "please", tagged as English.
  await setPrefs(serviceWorker, { screenReader: "original" });
  await expect.poll(async () => (await look(page, "пожалуйста")).heard).toEqual(["please@en"]);
  const original = await look(page, "пожалуйста");
  expect(original).toMatchObject({ lang: "ru", shown: "пожалуйста", shownHidden: "true" });
  expect(original.box, "the word doesn't move").toBe(before.box);
  expect(original.paragraph, "nor does the paragraph").toBe(before.paragraph);
  // (The rest of the paragraph can change on a re-apply: "Mix within the page" picks again.)
  expect(original.selected, "a copy of the paragraph has the word once, as shown").toMatch(/^Come in, пожалуйста, and sit down\./);
  expect(original.selected).not.toContain("please");
  // (Playwright's text joins the hidden part with a space; Chromium's tree has the static
  // texts "Come in, ", "please", ", and sit down." and no "пожалуйста".)
  await expect(page.locator("#p1")).toMatchAriaSnapshot("- paragraph: /^Come in, please ?, and sit down\\./");

  // On the page's Spanish paragraph (a base `es` word): "dog" reads as the page's "perro", in Spanish.
  expect((await look(page, "dog")).heard).toEqual(["perro@es"]);

  // Both: the word, then the original, each in its own language, joined as English joins a list.
  await setPrefs(serviceWorker, { screenReader: "both" });
  await expect.poll(async () => (await look(page, "пожалуйста")).heard).toEqual(["пожалуйста@ru", ", ", "please@en"]);
  expect((await look(page, "dog")).heard).toEqual(["dog@en", ", ", "perro@es"]);
  expect((await look(page, "пожалуйста")).box).toBe(before.box);

  // Back to the default: nothing of the page's text is left in the swap.
  await setPrefs(serviceWorker, {});
  await expect.poll(async () => (await look(page, "пожалуйста")).heard).toEqual([]);
  expect(await look(page, "пожалуйста")).toMatchObject({ attrs: "class,dir,lang,translate", shownHidden: null });
  expect(await page.locator("kotiko-sr, kotiko-v").count()).toBe(0);
});

test("Let me Tab to swapped words: Tab reaches each swap in document order, Enter opens its card, Esc comes back", async ({ context, server, serviceWorker }) => {
  await setup({ server, serviceWorker, context });
  const page = await context.newPage();
  await page.goto(server.page("popover-light.html"));
  await expect(page.locator("#p1 kotiko-w").first()).toBeVisible();
  expect(await page.locator("kotiko-w[tabindex]").count(), "off by default").toBe(0);

  await setPrefs(serviceWorker, { keyboardSwaps: true });
  await expect.poll(() => page.locator('kotiko-w[tabindex="0"]').count()).toBe(await page.locator("kotiko-w").count());
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => document.activeElement.textContent);
  expect(first).toBe(await page.locator("kotiko-w").first().textContent());
  // A visible ring in the text's own color.
  expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).toBe("solid");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await readCard(page))?.open ?? false).toBe(true);
  await expect.poll(async () => (await readCard(page)).focused).not.toBeNull();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await readCard(page))?.open ?? true).toBe(false);
  expect(await page.evaluate(() => document.activeElement.textContent), "focus is back on the word").toBe(first);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement.localName)).toBe("kotiko-w");

  await setPrefs(serviceWorker, {});
  await expect.poll(() => page.locator("kotiko-w[tabindex]").count()).toBe(0);
});
