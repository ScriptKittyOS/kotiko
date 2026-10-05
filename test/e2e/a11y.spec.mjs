// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 27 §6 in Chromium, on every Kotiko surface and state, in the light and dark themes:
//
//   - axe-core's WCAG 2.0, 2.1 and 2.2 A and AA rules: zero violations;
//   - Tab reaches every control, each shows a focus indicator and isn't hidden under
//     another element (2.1.1, 2.4.7, 2.4.11); modal layers keep Tab inside;
//   - every pointer target is at least 24 × 24 CSS px (2.5.8);
//   - WCAG's text-spacing overrides cut no text off (1.4.12), except in the word list's
//     one-line rows, whose every field the inspector shows whole;
//   - no horizontal page scroll at 320 CSS px (1.4.10);
//   - nothing moves under reduced motion, the system's or Kotiko's own setting (06 §9, 27 §4).
//
// A11Y_REPORT=<file> writes every finding (and axe's best-practice rules too) to a JSON
// file instead of failing; the audit in the slice's notes was made that way.
import fs from "node:fs";
import path from "node:path";
import { test, expect, connectServer } from "./fixtures.mjs";
import { axeScan, summarize, exposePopover, AXE_VERSION, WCAG_TAGS } from "../helpers/axe.mjs";
import { tabWalk, smallTargets, horizontalScroll, transformAnimations, textSpacingClips } from "../helpers/a11y-checks.mjs";
import { dashboardWords } from "../helpers/dashboard-words.mjs";
import { POPOVER_WORDS } from "../helpers/popover-words.mjs";
import { readCard, inShadow } from "../helpers/closed-shadow.mjs";

// Each state is audited twice (light and dark), with a full keyboard walk that compares
// screenshots: the longest state takes about 25 s on a developer machine, and CI runners
// are slower, so the default 30 s per test is too tight. The walk stays as thorough.
test.describe.configure({ timeout: 120_000 });

const REPORT = process.env.A11Y_REPORT || null;
const TAGS = REPORT ? [...WCAG_TAGS, "best-practice"] : WCAG_TAGS;
const SPEC_DIR = path.resolve(import.meta.dirname, "../../spec");

const findings = [];
test.afterAll(() => {
  if (!REPORT) return;
  let prev = [];
  try {
    prev = JSON.parse(fs.readFileSync(REPORT, "utf8")).findings;
  } catch {
    // the first file of the run: nothing to add to
  }
  fs.writeFileSync(REPORT, JSON.stringify({ axe: AXE_VERSION, findings: [...prev, ...findings] }, null, 2));
});

function record(label, theme, kind, items, fmt = (x) => x) {
  if (REPORT) for (const x of items) findings.push({ surface: label, theme, kind, ...(typeof x === "string" ? { id: kind, message: x } : x) });
  else expect.soft(items, `${label} (${theme}) ${kind}:\n${items.map(fmt).join("\n")}`).toEqual([]);
}

// Lets transitions started by a theme change finish, so colors are read at rest.
async function settle(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || !Number.isFinite(a.effect?.getComputedTiming?.().endTime)));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// The checks for one state, in light then dark: axe; with `keys`, the Tab walk; the target
// sizes and text spacing once (they don't depend on the theme).
async function check(page, label, { include = null, exclude = [], keys = true, targets = true } = {}) {
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await settle(page);
    const v = await axeScan(page, { include, exclude, tags: TAGS });
    record(label, theme, "axe", v, (x) => summarize([x]));
    if (keys) {
      const walk = await tabWalk(page);
      if (process.env.A11Y_DEBUG && walk.problems.length) console.log(label, theme, walk.stops);
      record(label, theme, "keyboard", walk.problems);
    }
  }
  if (targets) {
    record(label, "any", "target-size", await smallTargets(page));
    record(label, "any", "text-spacing", await textSpacingClips(page, { allow: [".wrow"] }));
  }
}

// ---------------------------------------------------------------- popup

const POPUP_WORDS = [
  { id: 1, lang: "ru", language: "Russian", native: "спасибо", romanization: "spasibo", english: "thanks", forms: ["thanks"], note: null },
  { id: 2, lang: "ru", language: "Russian", native: "дом", romanization: "dom", english: "house", forms: ["house"], note: null },
  { id: 3, lang: "ar", language: "Arabic", native: "شكرا", romanization: "shukran", english: "thanks", forms: ["thanks"], note: null },
  { id: 4, lang: "ja", language: "Japanese", native: "犬", romanization: "inu", english: "dog", forms: ["dog"], note: null },
  { id: 5, lang: "es", language: "Spanish", native: "gracias", romanization: null, english: "thanks", forms: ["thanks"], note: null },
];

// Opens popup.html in a 360 px tab, with the active tab the popup would see stubbed (as
// test/visual/popup-screenshots.mjs does).
async function openPopup(context, extensionId, { tabUrl = "https://en.wikipedia.org/wiki/Cat", noPermission = false } = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 600 });
  await page.addInitScript((o) => {
    if (!globalThis.chrome?.tabs) return;
    const tab = { id: 1, active: true, url: o.tabUrl };
    chrome.tabs.query = async () => [tab];
    if (o.noPermission) chrome.permissions.contains = async () => false;
  }, { tabUrl, noPermission });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator("#main")).toHaveAttribute("data-ready", "true");
  return page;
}

async function popupConnected({ context, server, serviceWorker }, local = {}, words = POPUP_WORDS, bases = ["en"]) {
  await server.control({ words });
  await connectServer(context, serviceWorker, server.kotikoUrl, server.token);
  await serviceWorker.evaluate((o) => chrome.storage.sync.set({ ui: { uiLang: "auto", baseLangs: o.bases, baseLangsConfirmed: true } }), { bases });
  await serviceWorker.evaluate((o) => chrome.storage.local.set({ words: o.words, baseLangs: o.bases, enabled: true, pausedHosts: [], lastSync: Date.now() - 60_000, syncError: null, onboarding: { completedAt: Date.now(), skipped: false, version: 2 }, ...o.local }), { words, local, bases });
}

test.describe("popup", () => {
  test("first run, no words, words and languages, focus", async ({ context, extensionId, server, serviceWorker }) => {
    const first = await openPopup(context, extensionId);
    await expect(first.locator("#firstRun")).toBeVisible();
    await check(first, "popup: first run (A)");
    await first.close();

    await popupConnected({ context, server, serviceWorker }, {}, []);
    const empty = await openPopup(context, extensionId);
    await check(empty, "popup: no words (B)");
    await empty.close();

    await popupConnected({ context, server, serviceWorker }, {}, POPUP_WORDS, ["en", "es"]);
    const p = await openPopup(context, extensionId);
    await expect(p.locator("#chips .chip").first()).toBeVisible();
    await expect(p.locator("#pagesIn")).toBeVisible();
    await check(p, "popup: words, languages, two bases (C)");
    await p.locator('#chips [data-focus-lang="ar"]').click();
    await expect(p.locator("#focusStrip")).toBeVisible();
    await check(p, "popup: focusing on one language");
  });

  test("adding: a result, a failure with details, a lookup; the language picker and the manual form", async ({ context, extensionId, server, serviceWorker }) => {
    await popupConnected({ context, server, serviceWorker });
    const p = await openPopup(context, extensionId);
    await p.locator("#addText").fill("sobaka");
    await p.locator("#addText").press("Enter");
    await expect(p.locator('#jobs li[data-kind="word"]').first()).toBeVisible({ timeout: 10_000 });
    await server.control({ kotiko: "500" });
    await p.locator("#addText").fill("xyzzy");
    await p.locator("#addText").press("Enter");
    const failed = p.locator('#jobs li[data-kind="failed"]').first();
    await expect(failed).toBeVisible({ timeout: 10_000 });
    await failed.locator("summary").first().click();
    await server.control({ kotiko: "slow", delayMs: 20_000 });
    await p.locator("#addText").fill("gracias");
    await p.locator("#addText").press("Enter");
    await expect(p.locator('#jobs li[data-kind="looking"]').first()).toBeVisible();
    await check(p, "popup: add results (D)");
    await server.control({ reset: true });

    // 24 §6: the language chip opens the picker (popup-more.js, on first use).
    await p.locator('#jobs li[data-kind="word"] .lang-chip').first().click();
    await expect(p.locator("dialog.picker")).toBeVisible();
    await p.locator("dialog.picker input").fill("span");
    await expect(p.locator("dialog.picker .picker-option").first()).toBeVisible();
    await check(p, "popup: language picker");
    await p.keyboard.press("Escape");
    await expect(p.locator("dialog.picker")).toHaveCount(0);
    await expect(p.locator('#jobs li[data-kind="word"] .lang-chip').first(), "focus goes back to the chip").toBeFocused();

    // 24 §7: "Add it yourself" on the failed line.
    await failed.locator('[data-action="manual"]').click();
    await expect(p.locator("#jobs form").first()).toBeVisible();
    await check(p, "popup: add it yourself");
  });

  test("off, paused, unsupported page, no permission", async ({ context, extensionId, server, serviceWorker }) => {
    await popupConnected({ context, server, serviceWorker }, { enabled: false });
    let p = await openPopup(context, extensionId);
    await check(p, "popup: off (E)");
    await p.close();
    await popupConnected({ context, server, serviceWorker }, { pausedHosts: ["en.wikipedia.org"] });
    p = await openPopup(context, extensionId);
    await expect(p.locator("#pausedRow")).toBeVisible();
    await check(p, "popup: paused on this site (F)");
    await p.close();
    await popupConnected({ context, server, serviceWorker });
    p = await openPopup(context, extensionId, { tabUrl: "chrome://newtab/" });
    await check(p, "popup: unsupported page (G)");
    await p.close();
    p = await openPopup(context, extensionId, { noPermission: true });
    await check(p, "popup: no site access (K)");
  });

  test("a server problem banner with details, offline, and the settings view", async ({ context, extensionId, server, serviceWorker }) => {
    await popupConnected({ context, server, serviceWorker }, { syncError: { code: "server_key_rejected", message: "401", at: Date.now() } });
    await server.control({ kotiko: "401" });
    let p = await openPopup(context, extensionId);
    await expect(p.locator("#banners .banner")).toBeVisible();
    await p.locator("#banners details summary").first().click();
    await check(p, "popup: server banner (J)");
    await p.close();
    await server.control({ reset: true });

    await popupConnected({ context, server, serviceWorker });
    p = await openPopup(context, extensionId);
    await p.context().setOffline(true);
    await p.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(p.locator("#offline")).toBeVisible();
    await check(p, "popup: offline (I)");
    await p.context().setOffline(false);
    await p.locator("#openSettings").click();
    await expect(p.locator("#settings")).toBeVisible();
    await check(p, "popup: connection settings");
  });
});

// ---------------------------------------------------------------- dashboard

async function dashboard({ context, extensionId, server, serviceWorker }, { hash = "#words", size = { width: 1280, height: 900 }, v1Words, local = {} } = {}) {
  const words = v1Words ?? dashboardWords(Date.now());
  await server.control({ v1Words: words, job: { state: "running", done: 40, total: 120 } });
  await serviceWorker.evaluate((l) => chrome.storage.local.set({ lastSync: Date.now() - 60_000, syncError: null, onboarding: { completedAt: Date.now(), skipped: false, version: 2 }, ...l }), local);
  await serviceWorker.evaluate(() => chrome.storage.sync.set({ ui: { uiLang: "auto", baseLangs: ["en", "es"], baseLangsConfirmed: true } }));
  await connectServer(context, serviceWorker, server.kotikoUrl, server.token);
  const page = await context.newPage();
  await page.setViewportSize(size);
  await page.goto(`chrome-extension://${extensionId}/dashboard.html${hash}`);
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  return { page, words };
}

test.describe("dashboard", () => {
  test("list, inspector, a field error, selection, toast", async ({ context, extensionId, server, serviceWorker }) => {
    const { page, words } = await dashboard({ context, extensionId, server, serviceWorker });
    await expect(page.locator(".wrow").first()).toBeVisible();
    await check(page, "dashboard: list");
    await page.goto(`chrome-extension://${extensionId}/dashboard.html#words/${words[7].id}`);
    await expect(page.locator("#inspector .gloss-field").first()).toBeVisible();
    await check(page, "dashboard: inspector, two bases");
    await page.goto(`chrome-extension://${extensionId}/dashboard.html#words/${words[0].id}`);
    await page.locator("#inspector .pron-field").first().fill("PA-ZHAL-STA");
    await page.locator("#inspector .pron-field").first().press("Enter");
    await expect(page.locator("#inspector [aria-invalid=true]")).toHaveCount(1);
    await check(page, "dashboard: inspector with a field error");
    await page.keyboard.press("Escape");
    const rows = page.locator(".wrow");
    await rows.nth(1).click();
    await rows.nth(4).click({ modifiers: ["Shift"] });
    await expect(page.locator("#selbar")).toBeVisible();
    await check(page, "dashboard: selection bar");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await rows.nth(2).click();
    await page.locator(".insp-delete").click();
    await expect(page.locator("#toasts .toast")).toBeVisible();
    await check(page, "dashboard: toast", { keys: false });
  });

  test("menus, the language picker and the keyboard shortcuts dialog", async ({ context, extensionId, server, serviceWorker }) => {
    const { page } = await dashboard({ context, extensionId, server, serviceWorker });
    await page.locator("#moreMenu").click();
    await expect(page.locator("#layer .menu")).toBeVisible();
    await check(page, "dashboard: more menu", { keys: false });
    await page.keyboard.press("Escape");
    await expect(page.locator("#moreMenu")).toBeFocused();
    await page.locator('[data-filter="status"]').click();
    await check(page, "dashboard: filter menu", { keys: false });
    await page.keyboard.press("Escape");
    await page.locator(".shelf-start").click();
    await expect(page.locator(".lang-picker")).toBeVisible();
    await check(page, "dashboard: language picker dialog");
    await page.keyboard.press("Escape");
    await expect(page.locator(".shelf-start"), "focus goes back").toBeFocused();
    await page.locator("#grid").focus();
    await page.keyboard.press("?");
    await expect(page.locator(".dialog-card")).toBeVisible();
    await check(page, "dashboard: keyboard shortcuts dialog");
  });

  test("no results, recently deleted, no words, unreachable", async ({ context, extensionId, server, serviceWorker }) => {
    const { page, words } = await dashboard({ context, extensionId, server, serviceWorker });
    await page.locator("#search").fill("zzqx");
    await expect(page.locator("#listEmpty")).toBeVisible();
    await check(page, "dashboard: no results");
    await page.evaluate((id) => chrome.runtime.sendMessage({ type: "words.write", ops: [{ op: "delete", id }] }), words[1].id);
    await page.goto(`chrome-extension://${extensionId}/dashboard.html#words?status=deleted`);
    await expect(page.locator(".row-restore").first()).toBeVisible();
    await check(page, "dashboard: recently deleted");
    const e = await dashboard({ context, extensionId, server, serviceWorker }, { v1Words: [] });
    await check(e.page, "dashboard: no words");
    await e.page.evaluate(() => chrome.runtime.sendMessage({ type: "server.connect", url: "http://127.0.0.1:9", token: "t0ken" }));
    await e.page.reload();
    await expect(e.page.locator("#banners .banner")).toBeVisible();
    await check(e.page, "dashboard: server unreachable");
  });

  test("add sheet with results, bulk add with a pasted list", async ({ context, extensionId, server, serviceWorker }) => {
    const { page } = await dashboard({ context, extensionId, server, serviceWorker }, { hash: "#add" });
    await expect(page.locator("#addSheet")).toBeVisible();
    await page.locator("#addText").fill("kniga");
    await page.locator("#addText").press("Enter");
    await expect(page.locator("#addJobs li").first()).toBeVisible({ timeout: 10_000 });
    await check(page, "dashboard: add sheet");
    await page.locator("#bulkText").fill("gato = cat\nperro = dog\ncasa = house\nlibro");
    await expect(page.locator('.bulk [data-action="save"]')).toBeVisible({ timeout: 10_000 });
    await check(page, "dashboard: bulk add review");
  });

  test("settings, every section, and the Your data dialogs", async ({ context, extensionId, server, serviceWorker }) => {
    const { page } = await dashboard({ context, extensionId, server, serviceWorker }, { hash: "#settings" });
    await expect(page.locator("#settingsView")).toBeVisible();
    await check(page, "dashboard: settings");
    await page.locator("#dataDelete").click();
    await expect(page.locator(".dialog-card")).toBeVisible();
    await check(page, "dashboard: delete everything dialog");
    await page.keyboard.press("Escape");
    await expect(page.locator("#dataDelete"), "focus goes back").toBeFocused();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#dataRestore").click()]);
    await chooser.setFiles(path.join(SPEC_DIR, "fixtures/export/multi-script.json"));
    await expect(page.locator(".dialog-card")).toBeVisible();
    await check(page, "dashboard: restore preview dialog");
  });

  test("a tip shown on hover or focus stays while hovered and Esc hides it (1.4.13)", async ({ context, extensionId, server, serviceWorker }) => {
    const { page } = await dashboard({ context, extensionId, server, serviceWorker }, { hash: "#settings/languages" });
    const badge = page.locator(".base-level").first();
    const tip = page.locator(".base-tip").first();
    await badge.hover();
    await expect(tip).toBeVisible();
    // Down onto the tip, across the gap: it stays (hoverable).
    const b = await badge.boundingBox();
    const r = await tip.boundingBox();
    await page.mouse.move(b.x + 4, b.y + b.height + 2, { steps: 4 });
    await page.mouse.move(r.x + 8, r.y + r.height / 2, { steps: 4 });
    await expect(tip).toBeVisible();
    // Esc hides it without the pointer moving (dismissible), and does nothing else.
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    await expect(page).toHaveURL(/#settings\/languages$/);
    // It comes back once the pointer has left and returns; from the keyboard too.
    await page.mouse.move(2, 2);
    await badge.hover();
    await expect(tip).toBeVisible();
    await page.mouse.move(2, 2);
    await badge.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(tip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
  });

  test("narrow: the list and the inspector as a modal sheet", async ({ context, extensionId, server, serviceWorker }) => {
    const { page, words } = await dashboard({ context, extensionId, server, serviceWorker }, { size: { width: 390, height: 844 } });
    await check(page, "dashboard narrow: list");
    await page.goto(`chrome-extension://${extensionId}/dashboard.html#words/${words[5].id}`);
    await expect(page.locator("#inspector")).toBeVisible();
    await expect(page.locator("#inspector")).toHaveAttribute("aria-modal", "true");
    await check(page, "dashboard narrow: inspector sheet");
  });
});

// ---------------------------------------------------------------- welcome and privacy

async function welcome(context, extensionId, serviceWorker, { size = { width: 1100, height: 1000 } } = {}) {
  await serviceWorker.evaluate(() => chrome.storage.local.set({ onboarding: { completedAt: null, skipped: false, version: 2 }, celebrations: null }));
  const page = await context.newPage();
  await page.setViewportSize(size);
  await page.goto(`chrome-extension://${extensionId}/welcome.html`);
  await expect(page.locator('#main[data-ready="true"]')).toBeAttached();
  return page;
}

const ask = async (page, text) => {
  await page.locator("#askText").fill(text);
  await page.locator("#askText").press("Enter");
};

test.describe("welcome", () => {
  test("arrival, another language, the AI choices, a refused key", async ({ context, extensionId, serviceWorker, server }) => {
    const page = await welcome(context, extensionId, serviceWorker);
    await check(page, "welcome: arrival");
    await page.locator("#addBase").click();
    await page.locator("#baseSearchField").fill("fre");
    await check(page, "welcome: another language search");
    await page.reload();
    await page.locator("#aiPaste").click();
    await check(page, "welcome: paste a key");
    await page.reload();
    await page.locator("#aiServer").click();
    await check(page, "welcome: my Kotiko server");
    await page.reload();
    await server.control({ llm: "401" });
    await page.locator("#aiOther").click();
    await page.locator('#providerOptions [data-value="custom"]').click();
    await page.locator("#otherUrl").fill(server.llmUrl);
    await page.locator("#otherUrl").press("Enter");
    await expect(page.locator("#otherStatus.status-bad")).toBeVisible();
    await check(page, "welcome: another service, refused");
  });

  test("connected: several results, the card", async ({ context, extensionId, serviceWorker, server }) => {
    const page = await welcome(context, extensionId, serviceWorker);
    // "Another service" at the fake model's address, as welcome.spec.mjs connects.
    await page.locator("#aiOther").click();
    await page.getByRole("radio", { name: "Another service" }).click();
    await page.locator("#otherUrl").fill(server.llmUrl);
    await page.locator("#otherUrl").press("Enter");
    await expect(page.locator("#aiConnectedText")).toHaveText("Connected to Another service.");
    await check(page, "welcome: connected");
    await ask(page, "hi in japanese");
    await expect(page.locator(".choices")).toBeVisible({ timeout: 8000 });
    await check(page, "welcome: several results");
    await page.reload();
    await ask(page, "please in russian");
    await expect(page.locator("#wordCard")).toBeVisible({ timeout: 8000 });
    await check(page, "welcome: the card");
  });

  test("typed words: which language, the meaning form, the celebration and preview", async ({ context, extensionId, serviceWorker }) => {
    const page = await welcome(context, extensionId, serviceWorker);
    await ask(page, "hola = hello");
    await expect(page.locator(".pick-chip").first()).toBeVisible();
    await check(page, "welcome: which language");
    await page.reload();
    await ask(page, "dog in Arabic");
    await expect(page.locator("#meaningForm")).toBeVisible();
    await check(page, "welcome: the meaning form (no AI)");
    await page.reload();
    await ask(page, "ありがとう = thanks");
    await expect(page.locator("#wordCard")).toBeVisible();
    await page.locator("#confirm").click();
    await expect(page.locator("#done")).toBeVisible();
    await check(page, "welcome: celebration and preview");
  });

  test("privacy policy", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/privacy.html`);
    await expect(page.locator("h1")).toBeVisible();
    await check(page, "privacy policy");
  });
});

// ---------------------------------------------------------------- reflow (1.4.10)

test("no horizontal page scroll at 320 CSS px: dashboard, welcome, privacy policy", async ({ context, extensionId, server, serviceWorker }) => {
  const size = { width: 320, height: 800 };
  const { page } = await dashboard({ context, extensionId, server, serviceWorker }, { size });
  const at = async (label) => expect.soft(await horizontalScroll(page), label).toBeNull();
  await at("dashboard: words");
  for (const hash of ["#settings", "#add"]) {
    await page.goto(`chrome-extension://${extensionId}/dashboard.html${hash}`);
    await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
    await at(`dashboard: ${hash}`);
  }
  await page.locator("#bulkText").fill("gato = cat\nperro = dog\nlibro");
  await expect(page.locator('.bulk [data-action="save"]')).toBeVisible({ timeout: 10_000 });
  await at("dashboard: bulk add review");
  const w = await welcome(context, extensionId, serviceWorker, { size });
  expect.soft(await horizontalScroll(w), "welcome: arrival").toBeNull();
  await ask(w, "ありがとう = thanks");
  await expect(w.locator("#wordCard")).toBeVisible();
  expect.soft(await horizontalScroll(w), "welcome: the card").toBeNull();
  await w.locator("#confirm").click();
  await expect(w.locator("#done")).toBeVisible();
  expect.soft(await horizontalScroll(w), "welcome: the preview").toBeNull();
  const policy = await context.newPage();
  await policy.setViewportSize(size);
  await policy.goto(`chrome-extension://${extensionId}/privacy.html`);
  await expect(policy.locator("h1")).toBeVisible();
  expect.soft(await horizontalScroll(policy), "privacy policy").toBeNull();
});

// The popup at 200 % zoom (1.4.4): Chrome's popup window is at most 800 × 600 device px, so
// 400 × 300 CSS px. Nothing scrolls sideways; every control is reachable and visible.
test("the popup at 200 % zoom: no sideways scroll, every control reachable and in view", async ({ context, extensionId, server, serviceWorker }) => {
  await popupConnected({ context, server, serviceWorker }, {}, POPUP_WORDS, ["en", "es"]);
  const p = await openPopup(context, extensionId);
  await p.setViewportSize({ width: 400, height: 300 });
  await p.locator("#addText").fill("sobaka");
  await p.locator("#addText").press("Enter");
  await expect(p.locator('#jobs li[data-kind="word"]').first()).toBeVisible({ timeout: 10_000 });
  expect(await horizontalScroll(p)).toBeNull();
  await p.emulateMedia({ reducedMotion: "reduce" });
  expect((await tabWalk(p)).problems).toEqual([]);
  await p.locator("#openSettings").click();
  expect(await horizontalScroll(p)).toBeNull();
  expect((await tabWalk(p)).problems).toEqual([]);
});

// ---------------------------------------------------------------- reduced motion (06 §9, 27 §4)

// The word card's animations: the page's document.getAnimations() doesn't list those in
// its closed shadow root, so they're read through the DevTools protocol.
const cardAnimations = (page) =>
  inShadow(page, function () {
    return this.getAnimations()
      .filter((a) => a.playState === "running" || a.playState === "pending")
      .filter((a) => (a.effect?.getKeyframes?.() ?? []).some((k) => ["transform", "translate", "scale", "rotate"].some((p) => k[p] && !/^(none|0px|1|0deg)$/.test(String(k[p])))))
      .map((a) => `${a.animationName || a.transitionProperty} on ${a.effect?.target?.className}`);
  }).then((x) => x ?? []);

// Polls for moving animations for a moment after `act`, which starts something that moves
// when motion isn't reduced.
async function noMovement(page, label, act, read = transformAnimations) {
  const seen = new Set();
  let polling = true;
  const poll = (async () => {
    while (polling) for (const a of await read(page).catch(() => [])) seen.add(a);
  })();
  try {
    await act();
    for (let i = 0; i < 8; i++) for (const a of await read(page)) seen.add(a);
  } finally {
    polling = false;
    await poll;
  }
  expect.soft([...seen], `${label}: animations that move under reduced motion`).toEqual([]);
}

for (const how of ["system", "setting"]) {
  test(`reduced motion (${how === "system" ? "the system's preference" : "Kotiko's own setting"}): nothing moves on any surface`, async ({ context, extensionId, server, serviceWorker }) => {
    const local = how === "setting" ? { prefs: { motion: "reduce" } } : {};
    const motion = async (page) => {
      await page.emulateMedia({ reducedMotion: how === "system" ? "reduce" : "no-preference" });
      if (how === "setting") await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
    };

    // The popup: an add (the swap motion on the new line), the master switch.
    await popupConnected({ context, server, serviceWorker }, local);
    const p = await openPopup(context, extensionId);
    await motion(p);
    await noMovement(p, "popup: an add", async () => {
      await p.locator("#addText").fill("sobaka");
      await p.locator("#addText").press("Enter");
      await expect(p.locator('#jobs li[data-kind="word"]').first()).toBeVisible({ timeout: 10_000 });
    });
    await noMovement(p, "popup: the switch", () => p.locator("#enabled").click());

    // The dashboard: the skip link, a menu, the inspector, a toast, the add sheet.
    const { page } = await dashboard({ context, extensionId, server, serviceWorker }, { local });
    await motion(page);
    await noMovement(page, "dashboard: the skip link", async () => {
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press("Tab");
    });
    await noMovement(page, "dashboard: a menu", () => page.locator("#moreMenu").click());
    await page.keyboard.press("Escape");
    await noMovement(page, "dashboard: the inspector and a toast", async () => {
      await page.locator(".wrow").nth(1).click();
      await page.locator(".insp-delete").click();
      await expect(page.locator("#toasts .toast")).toBeVisible();
    });
    await noMovement(page, "dashboard: the add sheet", () => page.locator("#addWords").click());

    // The welcome tab: the card, the celebration (no confetti) and the preview.
    const w = await welcome(context, extensionId, serviceWorker);
    await motion(w);
    await noMovement(w, "welcome: card, celebration, preview", async () => {
      await ask(w, "ありがとう = thanks");
      await w.locator("#confirm").click();
      await expect(w.locator("#done")).toBeVisible();
    });
    await expect(w.locator("canvas.kotiko-confetti"), "no confetti").toHaveCount(0);

    // The word card on a page.
    await popoverSetup({ server, serviceWorker, context });
    if (how === "setting") await serviceWorker.evaluate(() => chrome.storage.local.set({ prefs: { motion: "reduce" } }));
    const page2 = await context.newPage();
    await page2.emulateMedia({ reducedMotion: how === "system" ? "reduce" : "no-preference" });
    await page2.goto(server.page("popover-light.html"));
    await expect(page2.locator("kotiko-w").first()).toBeVisible();
    await noMovement(page2, "word card", async () => {
      await page2.locator("kotiko-w").first().click();
      await expect.poll(async () => (await readCard(page2))?.open ?? false).toBe(true);
    }, cardAnimations);
  });
}

// ---------------------------------------------------------------- word card and toast on pages

async function popoverSetup({ server, serviceWorker, context }) {
  await server.control({ words: POPOVER_WORDS });
  await expect.poll(() => serviceWorker.evaluate(async () => !!(await chrome.storage.local.get("onboarding")).onboarding)).toBe(true);
  await serviceWorker.evaluate(async (words) => {
    await chrome.storage.sync.set({ ui: { uiLang: "auto", baseLangs: ["en", "es"], baseLangsConfirmed: true } });
    await chrome.storage.local.set({ words, enabled: true, lastSync: Date.now(), mixing: { mode: "mix" } });
  }, POPOVER_WORDS);
  await connectServer(context, serviceWorker, server.kotikoUrl, server.token);
  await expect.poll(() => serviceWorker.evaluate(async () => Object.keys((await chrome.storage.local.get("baseRules")).baseRules ?? {}).join())).toBe("en,es");
}

// The card's pointer targets, measured inside its closed root.
const cardTargets = (page) =>
  inShadow(page, function () {
    const out = [];
    for (const el of this.querySelectorAll("button, a[href], [tabindex]")) {
      const r = el.getBoundingClientRect();
      if (!el.checkVisibility() || (r.width >= 24 && r.height >= 24)) continue;
      out.push(`${el.className || el.localName} is ${r.width.toFixed(1)} × ${r.height.toFixed(1)}`);
    }
    return out;
  });

test.describe("word card on pages", () => {
  for (const name of ["popover-light.html", "popover-dark.html", "rtl.html"]) {
    test(`the card, its targets and the toast: ${name}`, async ({ context, server, serviceWorker }) => {
      await popoverSetup({ server, serviceWorker, context });
      const page = await context.newPage();
      await page.goto(server.page(name));
      const w = page.locator("kotiko-w").first();
      await expect(w).toBeVisible();
      await w.click();
      await expect.poll(async () => (await readCard(page))?.open ?? false).toBe(true);
      await exposePopover(page);
      // Only Kotiko's own UI: the fixture pages themselves aren't under test.
      await check(page, `word card: ${name}`, { include: ["kotiko-popover", "kotiko-w"], keys: false, targets: false });
      record(`word card: ${name}`, "any", "target-size", await cardTargets(page));
      await page.mouse.click(2, 2);
      await expect.poll(async () => (await readCard(page))?.open ?? true).toBe(false);
      // The toast: the "Show details" command with nothing selected.
      await serviceWorker.evaluate(async (u) => {
        const [tab] = await chrome.tabs.query({ url: u });
        await chrome.tabs.sendMessage(tab.id, { type: "reveal-word" });
      }, page.url());
      await expect.poll(async () => (await readCard(page))?.toast ?? null).toBe("Select a swapped word first.");
      await exposePopover(page);
      await check(page, `toast: ${name}`, { include: ["kotiko-popover"], keys: false, targets: false });
    });
  }
});
