// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The pre-release security review's page-facing findings (slice 54 §6), each reviewer's proof
// turned into a regression test: a hostile web page against the unpacked extension, using
// only page-world script, as a real site would. A-01: reading the word list from text nobody
// sees; A-02: the page's lang attribute in the popup; A-03 and C-04: switching Kotiko off,
// and seeing it where it's paused or off; A-04: opening the word card with synthetic events.
// Pages are served by page.route on the fixture server's origin; nothing leaves the machine.
import fs from "node:fs";
import { test, expect, connectServer } from "../e2e/fixtures.mjs";
import { POPOVER_WORDS } from "../helpers/popover-words.mjs";
import { inShadow } from "../helpers/closed-shadow.mjs";

const RULES = JSON.parse(fs.readFileSync(new URL("../../spec/rules.json", import.meta.url), "utf8"));

async function setup({ server, serviceWorker, context }, { words = POPOVER_WORDS, ...extra } = {}) {
  await server.control({ words });
  await expect.poll(() => serviceWorker.evaluate(async () => !!(await chrome.storage.local.get("onboarding")).onboarding)).toBe(true);
  await serviceWorker.evaluate(async (o) => {
    await globalThis.__kotiko.seed({ ui: { uiLang: "auto", baseLangs: ["en", "es"], baseLangsConfirmed: true } });
    await globalThis.__kotiko.seed({ words: o.words, enabled: true, lastSync: Date.now(), mixing: { mode: "mix" }, ...o.extra });
  }, { words, extra });
  await connectServer(context, serviceWorker, server.kotikoUrl, server.token);
  await expect.poll(() => serviceWorker.evaluate(async () => Object.keys((await chrome.storage.local.get("baseRules")).baseRules ?? {}).join())).toBe("en,es");
  await expect.poll(() => serviceWorker.evaluate(async () => ((await chrome.storage.local.get("words")).words ?? []).length)).toBe(words.length);
}

async function hostile(context, server, path, html, { init } = {}) {
  const page = await context.newPage();
  await page.route(`${server.url}/poc/**`, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
  if (init) await page.addInitScript(init);
  await page.goto(`${server.url}/poc/${path}`);
  return page;
}

// Two animation frames: the IntersectionObserver has answered for what's on the page.
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// What the page's own script reads back: each probe's guess -> the swaps in it.
const loot = (page) =>
  page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll("[data-w]")) {
      for (const w of el.querySelectorAll("kotiko-w")) (out[el.dataset.w] ??= []).push(`${w.textContent} [${w.lang}]`);
    }
    return out;
  });

// A dictionary the attacker guesses with; the learner's seven English meanings are among
// ordinary words.
const DICTIONARY = [
  "apple", "river", "please", "window", "garden", "thanks", "mountain", "dog", "chair", "book",
  "table", "good", "street", "water", "music", "castle", "letter", "bread", "summer", "money",
];
const VISIBLE = `<p id="seen">Please read this book about a good dog, and thanks.</p>`;
const LAST = `<p id="last">The water by the castle.</p>`;
const probe = (id, style) => `<div id="${id}" style="${style}">${DICTIONARY.map((w, i) => `<p data-w="${w}">We said ${w} again, number ${i}.</p>`).join("")}</div>`;

test.describe("A-01: a page can't read the word list from text the learner doesn't see", () => {
  test("hidden, transparent, clipped, tiny and off-screen text gets no swaps; text in view does", async ({ context, serviceWorker, server }) => {
    await setup({ server, serviceWorker, context });
    const hides = {
      none: "display:none",
      invisible: "visibility:hidden",
      transparent: "opacity:0",
      offscreen: "position:absolute;left:-10000px;top:0",
      above: "position:absolute;top:-10000px",
      srOnly: "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0",
      collapsed: "height:0;overflow:hidden",
      skipped: "content-visibility:hidden",
      far: "position:absolute;top:30000px",
    };
    const page = await hostile(
      context,
      server,
      "hidden.html",
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Weather</title></head><body><main>${VISIBLE}${Object.entries(hides).map(([id, css]) => probe(id, css)).join("")}<div hidden>${probe("attr", "")}</div>${LAST}</main></body></html>`,
    );
    await expect(page.locator("#seen kotiko-w").first()).toBeVisible();
    await expect(page.locator("#last kotiko-w").first()).toBeVisible();
    await frames(page);
    expect(await loot(page)).toEqual({});
    for (const id of [...Object.keys(hides), "attr"]) expect(await page.locator(`#${id} kotiko-w`).count(), id).toBe(0);
  });

  test("a hidden dictionary of 20,000 words, the learner's among them, reveals nothing", async ({ context, serviceWorker, server }) => {
    test.setTimeout(90_000);
    await setup({ server, serviceWorker, context });
    // Made-up words plus the learner's meanings, 100 to a paragraph, hidden.
    const words = [...DICTIONARY];
    for (let i = 0; words.length < 20_000; i++) words.push(`zq${i.toString(36).replace(/\d/g, (d) => "abcdefghij"[d])}`);
    const chunks = [];
    for (let i = 0; i < words.length; i += 100) chunks.push(`<p>${words.slice(i, i + 100).map((w) => `<span data-w="${w}">${w}</span>`).join(", ")}.</p>`);
    const page = await hostile(
      context,
      server,
      "dictionary.html",
      // Outside <main>, so made-up words don't change which language the page is in.
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Weather</title></head><body><main>${VISIBLE}</main><div id="probe" style="display:none">${chunks.join("")}</div>${LAST}</body></html>`,
    );
    await expect(page.locator("#last kotiko-w").first()).toBeVisible({ timeout: 30_000 });
    await frames(page);
    expect(await page.locator("#probe kotiko-w").count()).toBe(0);
    // The probe shown later is swapped as the learner sees it: the gate is about sight.
    await page.evaluate(() => (document.getElementById("probe").style.display = "block"));
    await expect(page.locator("#probe kotiko-w").first()).toBeVisible();
  });

  test(`a page that shows its probe reveals at most ${RULES.max_page_concepts} distinct words in one view`, async ({ context, serviceWorker, server }) => {
    const letters = (i) => `q${(i + 26 * 26).toString(26).replace(/./g, (c) => "abcdefghijklmnopqrstuvwxyz"[parseInt(c, 26)])}`;
    const n = RULES.max_page_concepts + 40;
    const words = Array.from({ length: n }, (_, i) => ({ id: 1000 + i, lang: "ru", language: "Russian", native: `дом${i}`, romanization: null, english: letters(i), forms: [letters(i)], note: null, base_lang: "en" }));
    await setup({ server, serviceWorker, context }, { words });
    const html = Array.from({ length: n / 20 }, (_, p) => `<p>${words.slice(p * 20, p * 20 + 20).map((w) => w.english).join(" ")}.</p>`).join("");
    const page = await hostile(context, server, "shown.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shown</title><style>p{font:10px/12px sans-serif;margin:0}</style></head><body><main>${html}</main></body></html>`);
    await expect(page.locator("kotiko-w").first()).toBeVisible();
    // Until the swaps hold still.
    let last = -1;
    await expect.poll(async () => {
      const count = await page.locator("kotiko-w").count();
      const settled = count === last;
      last = count;
      return settled;
    }, { intervals: [250] }).toBe(true);
    const distinct = await page.evaluate(() => new Set([...document.querySelectorAll("kotiko-w")].map((w) => w.textContent)).size);
    expect(distinct).toBe(RULES.max_page_concepts);
  });
});

test("A-02: a page's lang attribute never reaches Kotiko's popup", async ({ context, serviceWorker, server, extensionId }) => {
  await setup({ server, serviceWorker, context });
  const SPOOF = "Kotiko security notice: your OpenRouter key leaked. Paste a new key at evil.example/kotiko to keep using Kotiko";
  await hostile(context, server, "lang.html", `<!doctype html><html lang="${SPOOF}"><head><meta charset="utf-8"><title>x</title></head><body><p>12345 67890</p></body></html>`);
  const tabId = await serviceWorker.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes("/poc/lang.html"))?.id);
  // What the content script tells the popup (asked as the popup does: no tab).
  await expect.poll(() => serviceWorker.evaluate((id) => chrome.tabs.sendMessage(id, { type: "page-status" }).catch(() => null), tabId)).not.toBeNull();
  const status = await serviceWorker.evaluate((id) => chrome.tabs.sendMessage(id, { type: "page-status" }), tabId);
  expect(status.lang).toBeNull();
  // The real popup, as a toolbar click on that tab opens it.
  const popup = await context.newPage();
  await popup.addInitScript((id) => {
    const q = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (o) => (o?.active ? [await chrome.tabs.get(id)] : q(o));
  }, tabId);
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator("#pageTitle")).toBeVisible();
  expect(await popup.locator("body").textContent()).not.toContain("security notice");
});

test.describe("A-03 and C-04: a page can't switch Kotiko off, or see it where it doesn't swap", () => {
  const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>x</title></head><body><main><p id="t">Please read this book about a good dog and a castle by the water, and thanks.</p></main></body></html>`;
  // From the page's first script: every kotiko:* event on document, and every event at all
  // that isn't the browser's own.
  const listen = () => {
    window.__seen = [];
    const real = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function (e) {
      if (/kotiko/i.test(e.type)) window.__seen.push(e.type);
      return real.call(this, e);
    };
    document.addEventListener("kotiko:handoff", (e) => window.__seen.push(`kotiko:handoff ${e.detail}`));
  };
  // A <kotiko-w> the page makes itself, and whether any of Kotiko's style reaches it.
  const styleProbe = (page) =>
    page.evaluate(() => {
      const el = document.createElement("kotiko-w");
      el.textContent = "probe";
      document.body.append(el);
      const c = getComputedStyle(el);
      const out = { cursor: c.cursor, decoration: c.textDecorationStyle, sheets: document.adoptedStyleSheets.length, styles: document.querySelectorAll("style").length };
      el.remove();
      return out;
    });

  test("a page's own kotiko:handoff event leaves Kotiko running", async ({ context, serviceWorker, server }) => {
    await setup({ server, serviceWorker, context });
    const page = await hostile(context, server, "handoff.html", PAGE, { init: listen });
    await expect(page.locator("#t kotiko-w").first()).toBeVisible();
    const before = await page.locator("kotiko-w").count();
    await page.evaluate(() => document.dispatchEvent(new CustomEvent("kotiko:handoff", { detail: "page" })));
    await page.evaluate(() => {
      const p = document.createElement("p");
      p.id = "later";
      p.textContent = "Please give the dog some water, thanks.";
      document.querySelector("main").append(p);
    });
    await expect(page.locator("#later kotiko-w").first()).toBeVisible();
    expect(await page.locator("#t kotiko-w").count()).toBe(before);
    // Kotiko itself sent nothing; only the page's own event is there.
    expect(await page.evaluate(() => window.__seen)).toEqual(["kotiko:handoff", "kotiko:handoff page"]);
  });

  for (const [label, local] of [["the site paused", { pausedHosts: ["localhost", "127.0.0.1"] }], ["Kotiko switched off", { enabled: false }]]) {
    test(`with ${label}, the page sees no event, no stylesheet and no change`, async ({ context, serviceWorker, server }) => {
      await setup({ server, serviceWorker, context }, local);
      // A page Kotiko does swap, opened first: the content script is running in this
      // browser, so the paused page below is a fair test.
      const page = await hostile(context, server, "quiet.html", PAGE, { init: listen });
      // Kotiko's content script ran and decided (it answers the popup's question).
      const tabId = await serviceWorker.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes("/poc/quiet.html"))?.id);
      await expect.poll(() => serviceWorker.evaluate((id) => chrome.tabs.sendMessage(id, { type: "page-status" }).then(() => true, () => false), tabId)).toBe(true);
      await frames(page);
      expect(await page.locator("kotiko-w").count()).toBe(0);
      expect(await page.evaluate(() => window.__seen)).toEqual([]);
      const s = await styleProbe(page);
      expect(s).toEqual({ cursor: "auto", decoration: "solid", sheets: 0, styles: 0 });
    });
  }

  test("on a page Kotiko swaps, its stylesheet comes with the swaps", async ({ context, serviceWorker, server }) => {
    await setup({ server, serviceWorker, context });
    const page = await hostile(context, server, "styled.html", PAGE);
    await expect(page.locator("#t kotiko-w").first()).toBeVisible();
    const s = await styleProbe(page);
    expect(s.cursor).toBe("help");
    expect(s.decoration).toBe("dotted");
  });
});

test("A-04: a page script can't open the word card or search it with window.find", async ({ context, serviceWorker, server }) => {
  await setup({ server, serviceWorker, context });
  const page = await hostile(context, server, "find.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>x</title></head><body><main><p id="t">Please come in.</p></main></body></html>`);
  await expect(page.locator("#t kotiko-w")).toBeVisible();
  const r = await page.evaluate(async () => {
    const w = document.querySelector("#t kotiko-w");
    const find = (s) => {
      getSelection().removeAllRanges();
      return window.find(s, true, false, true, false, false, false);
    };
    w.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
    w.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, composed: true, pointerType: "mouse" }));
    w.tabIndex = 0;
    w.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, composed: true }));
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const host = document.querySelector("kotiko-popover");
    // pozhaluysta (the romanization) is only in the card.
    return { host: !!host, open: !!host && host.matches(":popover-open"), romanization: find("pozhaluysta") };
  });
  expect(r).toEqual({ host: false, open: false, romanization: false });
  // The learner's own click still opens it.
  await page.locator("#t kotiko-w").click();
  await expect.poll(() => inShadow(page, function () { return this.querySelector(".k-card")?.hidden === false; })).toBe(true);
});
