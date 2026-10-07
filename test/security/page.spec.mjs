// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The pre-release security review's page-facing findings (slice 54 §6), each reviewer's proof
// turned into a regression test: a hostile web page against the unpacked extension, using
// only page-world script, as a real site would. A-01: reading the word list from text nobody
// sees; A-02: the page's lang attribute in the popup; A-03 and C-04: switching Kotiko off,
// and seeing it where it's paused or off; A-04: opening the word card with synthetic events;
// E-05: getting the learner's own input to open it on a stretched or hidden swap; E-04: text
// hidden by a filter, clip-path or mask.
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

// E-05 (reviewer E, rc.3): the page restyles its own <kotiko-w> (it's in the page's DOM) so
// the learner's resting pointer, or their click on the page's own button, lands on it and
// opens the card, which page script then searches with window.find. The card opens only
// where the learner's pointer is on the word's drawn text, and only on a word they can see.
test.describe("E-05: a page can't get the word card opened by stretching or hiding a swap", () => {
  const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>x</title></head><body><main><p id="t">Please come in, and thanks for the book.</p><button id="go" style="margin:40px;padding:20px">Continue reading</button></main></body></html>`;
  // Text that is only in the card, never on the page: the romanization, the respellings,
  // the other language's word in "Also", the note.
  const CARD_ONLY = ["pozhaluysta", "pa-ZHAL-sta", "pa-ZHA-lu-sta", "xièxie", "shyeh4-shyeh", "spasibo", "warmer"];
  const STRETCH = "#t kotiko-w:first-of-type{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483646!important;opacity:0.001!important;display:block!important}";
  const cardOpen = (page) => inShadow(page, function () { return this.querySelector(".k-card")?.hidden === false; }).then((v) => !!v);
  const found = (page) =>
    page.evaluate((gs) => gs.filter((g) => {
      getSelection().removeAllRanges();
      const hit = window.find(g, true, false, true, false, false, false);
      getSelection().removeAllRanges();
      return hit;
    }), CARD_ONLY);
  const restyle = (page, css) => page.evaluate((c) => {
    const s = document.createElement("style");
    s.textContent = c;
    document.head.append(s);
  }, css);

  test("A-04b: the learner's pointer resting anywhere on the page doesn't open it", async ({ context, serviceWorker, server }) => {
    await setup({ server, serviceWorker, context });
    const page = await hostile(context, server, "hover.html", PAGE);
    await expect(page.locator("#t kotiko-w").first()).toBeVisible();
    await restyle(page, STRETCH);
    await page.mouse.move(600, 400, { steps: 5 });
    await page.mouse.move(602, 401, { steps: 2 });
    await page.waitForTimeout(1000);
    expect(await cardOpen(page)).toBe(false);
    expect(await found(page)).toEqual([]);
  });

  test("the learner's click on the page's own button under a stretched swap doesn't open it", async ({ context, serviceWorker, server }) => {
    await setup({ server, serviceWorker, context });
    const page = await hostile(context, server, "jack.html", PAGE);
    await expect(page.locator("#t kotiko-w").first()).toBeVisible();
    await restyle(page, STRETCH);
    const box = await page.locator("#go").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    expect(await cardOpen(page)).toBe(false);
    expect(await found(page)).toEqual([]);
  });

  test("a transparent swap the page keeps under the pointer doesn't open it either", async ({ context, serviceWorker, server }) => {
    await setup({ server, serviceWorker, context });
    const page = await hostile(context, server, "follow.html", PAGE);
    await expect(page.locator("#t kotiko-w").first()).toBeVisible();
    // Word-sized, its text right under the pointer, nearly transparent.
    await page.evaluate(() => {
      const w = document.querySelector("#t kotiko-w");
      w.style.cssText = "position:fixed!important;z-index:2147483646!important;opacity:0.01!important";
      const text = document.createRange();
      text.selectNodeContents(w);
      document.addEventListener("pointermove", (e) => {
        const r = text.getBoundingClientRect();
        w.style.left = `${parseFloat(w.style.left || 0) + e.clientX - (r.left + r.width / 2)}px`;
        w.style.top = `${parseFloat(w.style.top || 0) + e.clientY - (r.top + r.height / 2)}px`;
      }, true);
    });
    await page.mouse.move(600, 400, { steps: 5 });
    await page.mouse.move(602, 401, { steps: 2 });
    await page.waitForTimeout(1000);
    const at = await page.evaluate(() => {
      const text = document.createRange();
      text.selectNodeContents(document.querySelector("#t kotiko-w"));
      const r = text.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, top: document.elementFromPoint(602, 401)?.localName };
    });
    expect(at.x < 602 && at.x + at.w > 602 && at.y < 401 && at.y + at.h > 401, `the swap is under the pointer: ${JSON.stringify(at)}`).toBe(true);
    expect(await cardOpen(page)).toBe(false);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await cardOpen(page)).toBe(false);
    expect(await found(page)).toEqual([]);
  });

  test("A-04c: a page that reads the card within the frame it opens finds nothing", async ({ context, serviceWorker, server }) => {
    await setup({ server, serviceWorker, context });
    const page = await hostile(context, server, "cover.html", PAGE.replace("</main>", `</main><div id="mine" popover="manual" style="position:fixed;inset:0;margin:0;border:0;background:#fff">Loading…</div>`));
    await expect(page.locator("#t kotiko-w").first()).toBeVisible();
    await restyle(page, STRETCH);
    await page.evaluate((gs) => {
      window.__read = [];
      const tick = () => {
        if (document.querySelector("kotiko-popover")?.matches(":popover-open")) {
          window.__read = gs.filter((g) => {
            getSelection().removeAllRanges();
            return window.find(g, true, false, true, false, false, false);
          });
          document.getElementById("mine").showPopover();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, CARD_ONLY);
    await page.mouse.move(600, 400, { steps: 5 });
    await page.mouse.move(602, 401, { steps: 2 });
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => window.__read)).toEqual([]);
    expect(await cardOpen(page)).toBe(false);
  });

  test("the learner's own hover and click on a swap they see still open it", async ({ context, serviceWorker, server }) => {
    await setup({ server, serviceWorker, context });
    const page = await hostile(context, server, "real.html", PAGE);
    const w = page.locator("#t kotiko-w").first();
    await expect(w).toBeVisible();
    await w.hover();
    await expect.poll(() => cardOpen(page)).toBe(true);
    await page.mouse.move(5, 5);
    await expect.poll(() => cardOpen(page)).toBe(false);
    await w.click();
    await expect.poll(() => cardOpen(page)).toBe(true);
  });
});

// E-04 (reviewer E, rc.3): text a page hides with filter: opacity(), clip-path or a mask got
// swaps, 300 of 300 of the learner's words. A page reads its own DOM, so it learned them.
test.describe("E-04: text hidden by filter, clip-path or a mask gets no swaps", () => {
  const letters = (i) => `q${(i + 26 * 26).toString(26).replace(/./g, (c) => "abcdefghijklmnopqrstuvwxyz"[parseInt(c, 26)])}`;
  const decoy = (i) => `zq${i.toString(36).replace(/\d/g, (d) => "abcdefghij"[d])}`;
  const LEARNER = Array.from({ length: 300 }, (_, i) => ({ id: 1000 + i, lang: "ru", language: "Russian", native: `дом${i}`, romanization: null, english: letters(i), forms: [letters(i)], note: null, base_lang: "en" }));
  // The learner's meanings among as many made-up words, 100 to a paragraph.
  const DICT = LEARNER.flatMap((w, i) => [w.english, decoy(i)]);
  const paragraphs = () => {
    const ps = [];
    for (let i = 0; i < DICT.length; i += 100) ps.push(`<p>${DICT.slice(i, i + 100).join(" ")}.</p>`);
    return ps.join("");
  };
  // The probe sits outside <main>, so the made-up words don't change the page's language.
  const doc = (style) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>News</title><style>body{margin:0;font:14px/18px sans-serif;background:#fff}p{margin:0 0 4px}</style></head><body><main><p id="seen">Please read this note about the ${letters(0)} today.</p><p>The weather is fine today, and the people in the town are going to the market to buy bread and fruit.</p></main><div id="probe" style="${style}">${paragraphs()}</div></body></html>`;
  // Distinct swapped words in the probe, as the page's own script counts them.
  const revealed = (page) => page.evaluate(() => new Set([...document.querySelectorAll("#probe kotiko-w")].map((w) => w.textContent)).size);
  const settled = async (page) => {
    let last = -1;
    await expect.poll(async () => {
      const n = await page.locator("kotiko-w").count();
      const same = n === last;
      last = n;
      return same;
    }, { intervals: [400] }).toBe(true);
  };

  const hidden = {
    "filter: opacity(0)": "filter:opacity(0)",
    "clip-path: inset(100%)": "clip-path:inset(100%)",
    "clip-path: circle(0)": "clip-path:circle(0)",
    "a fully transparent mask": "mask-image:linear-gradient(transparent,transparent);-webkit-mask-image:linear-gradient(transparent,transparent)",
    "opacity 0.01": "opacity:0.01",
  };
  for (const [label, style] of Object.entries(hidden)) {
    test(`${label}: none of 300 words revealed`, async ({ context, serviceWorker, server }) => {
      await setup({ server, serviceWorker, context }, { words: LEARNER });
      const page = await hostile(context, server, "e04.html", doc(style));
      await expect(page.locator("#seen kotiko-w").first()).toBeVisible();
      await settled(page);
      expect(await revealed(page)).toBe(0);
    });
  }

  test("the same probe in plain view is swapped, and a clip-path the page takes away swaps once the learner clicks", async ({ context, serviceWorker, server }) => {
    await setup({ server, serviceWorker, context }, { words: LEARNER });
    const plain = await hostile(context, server, "e04-plain.html", doc(""));
    await expect(plain.locator("#probe kotiko-w").first()).toBeVisible();
    await settled(plain);
    expect(await revealed(plain)).toBeGreaterThan(0);
    const page = await hostile(context, server, "e04-reveal.html", doc("clip-path:inset(100%)"));
    await expect(page.locator("#seen kotiko-w").first()).toBeVisible();
    await settled(page);
    expect(await revealed(page)).toBe(0);
    await page.evaluate(() => (document.getElementById("probe").style.clipPath = "none"));
    await page.mouse.click(5, 5);
    await expect.poll(() => revealed(page)).toBeGreaterThan(0);
  });
});
