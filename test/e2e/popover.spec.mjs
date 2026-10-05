// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 19 (the word card) and slice 34 (its speak button) in Chromium with the unpacked
// extension: hover, click, links, the keyboard command, the top layer against hostile page
// CSS, the page's theme, what page scripts can see, the interface in Spanish, and speech
// with a stubbed voice list.
import { test, expect } from "./fixtures.mjs";
import { POPOVER_WORDS } from "../helpers/popover-words.mjs";
import { inShadow, readCard } from "../helpers/closed-shadow.mjs";
import { stubSpeech, voiceLists } from "../helpers/speech-stub.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stores the words and the connection directly (the popup's own flow is covered in
// smoke.spec.mjs); the page's sync then finds the same list on the fake server. The
// learner reads English and Spanish (slice 50's setting), as their words' meanings say.
async function setup({ server, serviceWorker }, extra = {}) {
  await server.control({ words: POPOVER_WORDS });
  // The install's own first-run step writes the browser's languages; it must be done before
  // this test sets its own, or it can overwrite them.
  await expect.poll(() => serviceWorker.evaluate(async () => !!(await chrome.storage.local.get("onboarding")).onboarding)).toBe(true);
  await serviceWorker.evaluate(async (o) => {
    await chrome.storage.sync.set({ ui: { uiLang: "auto", baseLangs: ["en", "es"], baseLangsConfirmed: true } });
    // "Mix within the page" (18), so the page's two "thanks" show 谢谢 and спасибо.
    await chrome.storage.local.set({ serverUrl: o.url, token: o.token, words: o.words, enabled: true, lastSync: Date.now(), mixing: { mode: "mix" }, ...o.extra });
  }, { url: server.kotikoUrl, token: server.token, words: POPOVER_WORDS, extra });
  // The background writes the rules for both languages for content scripts to read.
  await expect.poll(() => serviceWorker.evaluate(async () => Object.keys((await chrome.storage.local.get("baseRules")).baseRules ?? {}).join())).toBe("en,es");
}

async function openPage(context, server, name = "popover-light.html") {
  const page = await context.newPage();
  await page.goto(server.page(name));
  await expect(page.locator("kotiko-w").first()).toBeVisible();
  return page;
}

const word = (page, native) => page.locator("kotiko-w", { hasText: native }).first();

async function waitCard(page, open = true) {
  await expect.poll(async () => (await readCard(page))?.open ?? false, { timeout: 3000 }).toBe(open);
  return readCard(page);
}

// Sends the "Show details" command's message, as background.js does on Alt+Shift+R.
async function revealWord(serviceWorker, page) {
  const url = page.url();
  await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    await chrome.tabs.sendMessage(tab.id, { type: "reveal-word" });
  }, url);
}

test("hovering a word opens the card in the top layer, above hostile page CSS, with the pronunciation block", async ({ context, server, serviceWorker }) => {
  await setup({ server, serviceWorker });
  const page = await openPage(context, server);
  await word(page, "пожалуйста").hover();
  await sleep(150);
  expect((await readCard(page))?.open ?? false, "not before 300 ms").toBe(false);
  const card = await waitCard(page);
  expect(card.lines).toEqual(["пожа́луйста", "pa-ZHAL-sta", "Slowly: pa-ZHA-lu-sta", "pozhaluysta · AI-generated", "Russian · русский", "please", "Don't swap this word"]);
  expect(card.rect.width).toBeGreaterThanOrEqual(220);
  expect(card.rect.width).toBeLessThanOrEqual(320);
  expect(card.dark).toBe(false);

  // The page's `kotiko-popover { display: none !important; opacity: 0 !important }` loses.
  const host = await page.evaluate(() => {
    const h = document.querySelector("kotiko-popover");
    return { display: getComputedStyle(h).display, opacity: getComputedStyle(h).opacity, top: h.matches(":popover-open") };
  });
  expect(host).toEqual({ display: "block", opacity: "1", top: true });

  // Below the word, centered on it.
  const box = await word(page, "пожалуйста").boundingBox();
  expect(card.rect.y).toBeGreaterThan(box.y + box.height);
  expect(Math.abs(card.rect.x + card.rect.width / 2 - (box.x + box.width / 2))).toBeLessThan(2);

  // Moving into the card keeps it; leaving both closes it after 200 ms.
  await page.mouse.move(card.rect.x + 40, card.rect.y + 40, { steps: 5 });
  await sleep(400);
  expect((await readCard(page)).open).toBe(true);
  await page.mouse.move(5, 5);
  await waitCard(page, false);
});

test("page scripts see no vocabulary: no title or data-* on swaps, and the card's root is closed", async ({ context, server, serviceWorker }) => {
  await setup({ server, serviceWorker });
  const page = await openPage(context, server);
  await word(page, "谢谢").hover();
  await waitCard(page);
  const seen = await page.evaluate(() => ({
    attrs: [...new Set([...document.querySelectorAll("kotiko-w")].map((el) => el.getAttributeNames().sort().join(",")))],
    shadow: document.querySelector("kotiko-popover").shadowRoot,
    hostText: document.querySelector("kotiko-popover").textContent,
    html: document.documentElement.outerHTML,
  }));
  expect(seen.attrs).toEqual(["class,dir,lang,translate"]);
  expect(seen.shadow).toBeNull();
  expect(seen.hostText).toBe("");
  expect(seen.html).not.toMatch(/xièxie|shyeh|AI-generated|Thanks/);
});

test("click pins the card; a click inside a link navigates and never opens it", async ({ context, server, serviceWorker }) => {
  await setup({ server, serviceWorker });
  const page = await openPage(context, server);
  await word(page, "хорошо").click();
  const card = await waitCard(page);
  expect(card.text("k-label")).toBe("Checked in Wiktionary");
  await page.mouse.move(5, 5);
  await sleep(400);
  expect((await readCard(page)).open, "pinned").toBe(true);
  await page.mouse.click(5, 5);
  await waitCard(page, false);

  await page.locator("#link kotiko-w").click();
  await expect(page).toHaveURL(/#dog$/);
  await sleep(100);
  expect((await readCard(page))?.open ?? false).toBe(false);
});

test("touch: a tap opens the card; inside a link a tap navigates and a long press opens it", async ({ context, server, serviceWorker }) => {
  await setup({ server, serviceWorker });
  const page = await openPage(context, server);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const center = async (loc) => {
    const b = await loc.boundingBox();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  };
  const touch = async (pt, holdMs) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt] });
    await sleep(holdMs);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };

  await touch(await center(word(page, "谢谢")), 40);
  let card = await waitCard(page);
  expect(card.lines[0]).toBe("谢谢");
  await touch({ x: 5, y: 5 }, 40);
  await waitCard(page, false);

  // A long press on the word in a link opens the card and doesn't follow the link.
  await touch(await center(page.locator("#link kotiko-w")), 700);
  card = await waitCard(page);
  expect(card.lines[0]).toBe("犬 いぬ");
  await sleep(300);
  expect(page.url()).not.toMatch(/#dog$/);
  await touch({ x: 5, y: 5 }, 40);
  await waitCard(page, false);

  // A short tap on it navigates as usual.
  await touch(await center(page.locator("#link kotiko-w")), 40);
  await expect(page).toHaveURL(/#dog$/);
  expect((await readCard(page)).open).toBe(false);
});

test("the keyboard command opens the selected word with focus inside; Esc closes and restores the selection", async ({ context, server, serviceWorker }) => {
  await setup({ server, serviceWorker });
  const page = await openPage(context, server);
  await stubSpeech(page, voiceLists().macos);
  await page.evaluate(() => getSelection().selectAllChildren([...document.querySelectorAll("kotiko-w")].find((w) => w.textContent === "犬")));
  await revealWord(serviceWorker, page);
  const card = await waitCard(page);
  expect(card.lines.slice(0, 2)).toEqual(["犬 いぬ", "ee-noo"]);
  await expect.poll(async () => (await readCard(page)).focused).toBe("k-speak");
  expect(await page.evaluate(() => document.activeElement?.localName)).toBe("kotiko-popover");
  await page.keyboard.press("Tab");
  expect((await readCard(page)).focused, "then the card's action (slice 16 §5)").toBe("k-action");
  await page.keyboard.press("Tab");
  expect((await readCard(page)).focused, "and round again").toBe("k-speak");
  await page.keyboard.press("Escape");
  await waitCard(page, false);
  expect(await page.evaluate(() => getSelection().toString())).toBe("犬");

  // Nothing selected: a toast, and no focus taken.
  await page.evaluate(() => getSelection().removeAllRanges());
  await revealWord(serviceWorker, page);
  await expect.poll(async () => (await readCard(page)).toast).toBe("Select a swapped word first.");
  expect(await page.evaluate(() => document.activeElement?.localName)).toBe("body");
});

test("a dark page gets the dark card", async ({ context, server, serviceWorker }) => {
  await setup({ server, serviceWorker });
  const page = await openPage(context, server, "popover-dark.html");
  await page.emulateMedia({ colorScheme: "light" });
  await word(page, "пожалуйста").hover();
  const card = await waitCard(page);
  expect(card.dark).toBe(true);
});

test("speech: the stored word in a matching voice, never the respelling; no voice, no button", async ({ context, server, serviceWorker }) => {
  await setup({ server, serviceWorker });
  const page = await openPage(context, server);
  const speech = await stubSpeech(page, voiceLists().macos);
  const say = async (native) => {
    await page.mouse.move(5, 5);
    await waitCard(page, false).catch(() => {});
    await word(page, native).hover();
    const card = await waitCard(page);
    await expect.poll(async () => (await readCard(page)).speakHidden).toBe(false);
    await page.keyboard.press("s");
    return card;
  };
  await say("пожалуйста");
  await say("谢谢");
  await say("犬");
  await say("كتاب");
  await say("dog");
  await expect.poll(() => speech.spoken().then((s) => s.length)).toBe(5);
  expect(await speech.spoken()).toEqual([
    { text: "пожалуйста", lang: "ru-RU", voice: "Milena", rate: 0.9 },
    { text: "谢谢", lang: "zh-CN", voice: "Tingting", rate: 0.9 },
    { text: "いぬ", lang: "ja-JP", voice: "Kyoko", rate: 0.9 },
    { text: "كتاب", lang: "ar-001", voice: "Maged", rate: 0.9 },
    { text: "dog", lang: "en-US", voice: "Alex", rate: 0.9 },
  ]);

  // A system with only Spanish voices: no speaker for the English word.
  const spanishOnly = voiceLists().macos.filter((v) => v.lang.startsWith("es"));
  const other = await openPage(context, server);
  await stubSpeech(other, spanishOnly);
  await word(other, "dog").hover();
  await waitCard(other);
  await sleep(100);
  expect((await readCard(other)).speakHidden).toBe(true);
});

test.describe("with the browser in Spanish", () => {
  test.use({ browserLang: "es" });

  test("every label in the card is Spanish, and language names too", async ({ context, server, serviceWorker }) => {
    await setup({ server, serviceWorker });
    const page = await openPage(context, server);
    await stubSpeech(page, voiceLists().macos);
    await word(page, "пожалуйста").hover();
    let card = await waitCard(page);
    expect(card.lines.slice(1, 5)).toEqual(["pa-ZHAL-sta", "Despacio: pa-ZHA-lu-sta", "pozhaluysta · Generado por IA", "ruso · русский"]);
    await expect.poll(async () => (await readCard(page)).speakHidden).toBe(false);
    card = await readCard(page);
    expect(card.text("k-speak")).toBe("Escuchar пожалуйста en ruso");
    await page.mouse.move(5, 5);
    await waitCard(page, false);
    await word(page, "谢谢").hover();
    card = await waitCard(page);
    expect(card.text("k-lang")).toBe("chino · 中文");
    expect(card.text("k-also")).toBe("También: спасибо (spasibo)");
  });
});

test("Don't swap this word: the page shows the site's word again, everywhere, with an undo (slice 16 §5)", async ({ context, server, serviceWorker }) => {
  await setup({ server, serviceWorker });
  const page = await openPage(context, server);
  await word(page, "хорошо").click();
  await waitCard(page);
  await inShadow(page, function () {
    this.querySelector("[data-action=never-swap]").click();
  });
  await expect(page.locator("#p3")).toContainText("It is a good ");
  expect(await serviceWorker.evaluate(async () => (await chrome.storage.local.get("prefs")).prefs.neverSwap)).toEqual(["good"]);
  const other = await openPage(context, server);
  await expect(other.locator("#p3")).toContainText("It is a good ");
  await other.close();
  // The toast's Undo puts it back.
  await inShadow(page, function () {
    this.querySelector(".k-toast-action").click();
  });
  await expect(page.locator("#p3 kotiko-w", { hasText: "хорошо" })).toBeVisible();
  expect(await serviceWorker.evaluate(async () => (await chrome.storage.local.get("prefs")).prefs.neverSwap)).toEqual([]);
});
