// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The fixture corpus (test/fixtures/pages). Every page loads offline with the extension
// running; the behaviour each page exists for is a `fixme` until its slice lands (or the
// part of it that has landed).
import { test, expect } from "./fixtures.mjs";

const PAGES = [
  "basic.html",
  "boundaries.html",
  "react-list.html",
  "turbo-swap.html",
  "self-healing.html",
  "shadow.html",
  "iframes.html",
  "rtl.html",
  "non-english.html",
  "editors.html",
  "controls.html",
  "big.html",
  "captions.html",
];

test("every corpus page loads offline with the extension running, without page errors", async ({ context, server, popup }) => {
  test.setTimeout(90_000);
  await popup.connect(server.kotikoUrl, server.token);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  for (const name of PAGES) {
    const res = await page.goto(server.page(name), { waitUntil: "load" });
    expect(res.status(), name).toBe(200);
    await page.waitForTimeout(300);
  }
  expect(errors).toEqual([]);
});

test.describe("slice 14: matcher engine", () => {
  test("boundaries.html: contractions, hyphens, accents, addresses, acronyms and single letters aren't half-swapped", async ({ context, server, popup }) => {
    const w = (id, native, english, lang = "ru") => ({ id, lang, language: null, native, romanization: null, english, forms: [english], note: null });
    await server.control({
      words: [w(1, "можно", "can"), w(2, "это", "it"), w(3, "нас", "us"), w(4, "кот", "cat"), w(5, "сумма", "sum"), w(6, "кафе", "café"), w(7, "собака", "dog"), w(8, "хорошо", "well"), w(9, "почта", "mail"), w(10, "команда", "team"), w(11, "ein", "a", "de"), w(12, "yo", "I", "es")],
    });
    await popup.connect(server.kotikoUrl, server.token);
    const page = await context.newPage();
    await page.goto(server.page("boundaries.html"));
    const text = (id) => expect(page.locator(`#${id}`));
    await text("contractions").toHaveText("Yo can't go. Don't. It's late, isn't это? We'd won't.");
    await text("hyphens").toHaveText("A well-known, well-made e-mail about ein dog-friendly house.");
    await text("accents").toHaveText("A passé résumé from the кафе. The cafés. A naïve сумма. Über and uber.");
    await text("urls").toHaveText("See example.invalid/dog and mailto:dog@example.invalid, or #dog and @dog.");
    await text("wbr").toHaveText("hotdog and ice cream and dog");
    await text("acronyms").toHaveText("The IT команда in the US asked WHO about это and нас.");
    await text("letters").toHaveText("Yo think ein кот is ein pet. Vitamin A. Plan B. Grade a.");
  });
  test.fixme("big.html: the first pass over 100,000 text nodes stays inside the matcher budget", async () => {});
});

test.describe("slice 15: framework-safe swapping", () => {
  const ru = (id, native, english) => ({ id, lang: "ru", language: "Russian", native, romanization: null, english, forms: [english], note: null });
  const WORDS = [ru(1, "дом", "house"), ru(2, "спасибо", "thanks"), ru(3, "собака", "dog")];
  async function open(context, server, popup, name) {
    await server.control({ words: WORDS });
    await popup.connect(server.kotikoUrl, server.token);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.page(name));
    return { page, errors };
  }

  test("react-list.html: a React 18 list keeps re-rendering, unmounting and remounting, with swaps, and never errs", async ({ context, server, popup }) => {
    const { page, errors } = await open(context, server, popup, "react-list.html");
    await expect(page.locator("kotiko-w").first()).toBeVisible();
    const seen = new Set();
    let swapped = 0;
    for (let i = 0; i < 25; i++) {
      seen.add(await page.evaluate(() => window.check()));
      swapped = Math.max(swapped, await page.locator("li kotiko-w").count());
      await page.waitForTimeout(150);
    }
    expect([...seen]).toEqual(["ok"]);
    expect(swapped).toBeGreaterThan(0);
    expect(await page.locator("#errors").textContent()).toBe("");
    expect(errors).toEqual([]);
  });

  test("turbo-swap.html: words are swapped again after document.body is replaced and after document.open()", async ({ context, server, popup }) => {
    const { page } = await open(context, server, popup, "turbo-swap.html");
    await expect(page.locator("#first")).toHaveText("The first дом before the swap.");
    await expect(page.locator("#second")).toHaveText("A second дом after the body was replaced. Спасибо!");
    await page.locator("#reopen").click();
    await expect(page.locator("#third")).toHaveText("A third дом, written with document.write.");
  });

  test("self-healing.html: rewriting stops after a few reverts (no ping-pong)", async ({ context, server, popup }) => {
    const { page } = await open(context, server, popup, "self-healing.html");
    await page.waitForTimeout(1500);
    const first = Number(await page.locator("#reverts").textContent());
    await page.waitForTimeout(1500);
    expect(Number(await page.locator("#reverts").textContent())).toBe(first);
    expect(first).toBeLessThanOrEqual(8);
    await expect(page.locator("#owned")).toHaveText("A good house and a good dog.");
  });

  test("basic.html: text a page adds is swapped before it is painted", async ({ context, server, popup }) => {
    const { page } = await open(context, server, popup, "basic.html");
    await expect(page.locator("kotiko-w").first()).toBeVisible();
    const painted = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const p = document.createElement("p");
          p.textContent = "A brand new house appeared.";
          document.body.append(p);
          requestAnimationFrame(() => resolve(p.textContent));
        }),
    );
    expect(painted).toBe("A brand new дом appeared.");
  });

  // Slice 15 aims at no task over 50 ms. Measured on this page (Long Animation Frames):
  // Kotiko's own script never blocks for more than about 20 ms, but each frame's style and
  // layout pass takes 30-60 ms while swaps land all over a 100,000-node document, and now and
  // then that pass plus a garbage collection reaches about 100 ms. The old matcher froze the
  // page for seconds. 150 ms catches a regression; swapping off-screen text only as it
  // scrolls near (slice 15's future work) is what brings such pages under 50 ms.
  test("big.html: no long task over 150 ms while swapping 100,000 text nodes", async ({ context, server, popup }) => {
    test.setTimeout(60_000);
    await server.control({ words: WORDS });
    await popup.connect(server.kotikoUrl, server.token);
    const page = await context.newPage();
    // Long tasks after the page's own generator script (which is the page's, not Kotiko's).
    await page.addInitScript(() => {
      window.__long = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__long.push({ start: e.startTime, duration: e.duration });
      }).observe({ type: "longtask", buffered: true });
      document.addEventListener("DOMContentLoaded", () => (window.__ready = performance.now()));
    });
    await page.goto(server.page("big.html"));
    await expect(page.locator("p").last().locator("kotiko-w").first()).toBeAttached({ timeout: 30_000 });
    await page.waitForTimeout(500);
    const long = await page.evaluate(() => window.__long.filter((t) => t.start > window.__ready + 1).map((t) => Math.round(t.duration)));
    expect(long.filter((d) => d > 150), `long tasks after load: ${JSON.stringify(long)}`).toEqual([]);
  });
});

test.describe("slice 16: what not to swap", () => {
  test("non-english.html: a German page keeps die, Gift and Kind; the lang=en island swaps", async ({ context, server, popup }) => {
    const ru = (id, native, english) => ({ id, lang: "ru", language: null, native, romanization: null, english, forms: [english], note: null });
    await server.control({ words: [ru(1, "подарок", "gift"), ru(2, "добрый", "kind"), ru(3, "ребёнок", "child"), ru(4, "умереть", "die")] });
    await popup.connect(server.kotikoUrl, server.token);
    const page = await context.newPage();
    await page.goto(server.page("non-english.html"));
    await expect(page.locator("#en-island")).toHaveText("An English island: the подарок for a добрый ребёнок will умереть down.");
    await expect(page.locator("#de")).toHaveText("Die Katze und das Kind. Das Gift ist gefährlich. Die Kinder spielen im Haus.");
  });

  test("editors.html: textarea, contenteditable, role=textbox, CodeMirror-like editors and translate=no are untouched", async ({ context, server, popup }) => {
    const ru = (id, native, english) => ({ id, lang: "ru", language: null, native, romanization: null, english, forms: [english], note: null });
    await server.control({ words: [ru(1, "дом", "house"), ru(2, "спасибо", "thanks")] });
    await popup.connect(server.kotikoUrl, server.token);
    const page = await context.newPage();
    await page.goto(server.page("editors.html"));
    await expect(page.locator("#outside")).toHaveText("A дом outside the editors.");
    await expect(page.locator("#textarea")).toHaveValue("thanks for the house");
    await expect(page.locator("#input")).toHaveValue("thanks for the house");
    for (const id of ["ce", "ce-nested", "textbox", "cm", "notranslate"]) await expect(page.locator(`#${id}`)).not.toContainText(/дом|спасибо/);
    expect(await page.locator("kotiko-w").count()).toBe(1);
  });
  // Done early after a maintainer report ("AOI I" toggles showed "AOI Я"). The setting
  // "Swap words in buttons and menus" is still to come.
  test("controls.html: buttons, nav, labels, toggles and form fields stay English", async ({ context, server, popup }) => {
    const ru = (id, native, english, forms) => ({ id, lang: "ru", language: "Russian", native, romanization: null, english, forms, note: null });
    await server.control({ words: [ru(3, "я", "I", ["I"]), ru(2, "дом", "house", ["house"]), ru(1, "спасибо", "thanks", ["thanks"])] });
    await popup.connect(server.kotikoUrl, server.token);
    const page = await context.newPage();
    await page.goto(server.page("controls.html"));

    // content is swapped (in a <main tabindex="-1">, links, a long clickable card)
    await expect(page.locator("#prose")).toHaveText("Prose about a дом still swaps. Спасибо!");
    await expect(page.locator("#link")).toHaveText("the дом");
    await expect(page.locator("#card-text")).toHaveText("A дом by the sea sold for a record price today.");
    await expect(page.locator("#numerals")).toHaveText("World War I, Type I, I-95 and AOI I stay. Я think this one swaps.");

    // controls are not
    const same = {
      "#nav": "House · Thanks",
      "#button": "Thanks",
      "#label": "House number",
      "#form-help": "Thanks for telling us about your house.",
      "#toggle-1": "AOI I",
      "#toggle-2": "AOI II",
      "#toggle-3": "My house",
      "#radio-1": "House I",
      "#radio-2": "House II",
      "#tab": "Thanks",
      "#chip": "house",
    };
    for (const [sel, text] of Object.entries(same)) await expect(page.locator(sel), sel).toHaveText(text);
    await expect(page.locator("#select option").first()).toHaveText("house");
    await expect(page.locator("#submit")).toHaveValue("Thanks");
    await expect(page.locator("#f1")).toHaveAttribute("placeholder", "house");
    await expect(page.locator("kotiko-w")).toHaveCount(5);
  });
});

test.describe("slice 17: casing and script display", () => {
  test.fixme("rtl.html: swapped words in right-to-left pages are isolated and readable", async () => {});
});

test.describe("slice 42: frames and shadow DOM", () => {
  test.fixme("shadow.html: open and closed shadow roots and nested custom elements are swapped", async () => {});
  test.fixme("iframes.html: same-origin, srcdoc and about:blank frames are swapped; the tiny ad frame is skipped", async () => {});
});

test.describe("slice 52: video captions", () => {
  test.fixme("captions.html: a caption line updating every 100 ms is swapped without flicker", async () => {});
});
