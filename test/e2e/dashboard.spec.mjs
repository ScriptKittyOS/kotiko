// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 21 in a real browser against the fixture server's in-memory /api/v1: open the
// dashboard from the popup (the extension's options page), edit a word and see the pages'
// word list follow, delete with Undo, restore from Recently deleted, and a word added in
// the popup arriving live.
import { test, expect } from "./fixtures.mjs";

const WORDS = [
  { id: 2, lang: "ru", language: "Russian", native: "дом", romanization: "dom", english: "house", forms: ["house", "houses"], note: null },
  { id: 3, lang: "ar", language: "Arabic", native: "شكرا", romanization: "shukran", english: "thanks", forms: ["thanks"], note: null },
  { id: 4, lang: "ja", language: "Japanese", native: "犬", romanization: "inu", english: "dog", forms: ["dog"], note: null },
];

const row = (page, native) => page.locator(".wrow", { has: page.locator(".w-native", { hasText: native }) });

// Opens the dashboard the way a learner does: the popup's "Open your words" (2 steps).
async function openFromPopup(context, popupPage) {
  const [dash] = await Promise.all([context.waitForEvent("page"), popupPage.locator("#openDashboard").click()]);
  await dash.waitForLoadState();
  await expect(dash.locator("#app")).toHaveAttribute("data-ready", "true");
  return dash;
}

test("the popup opens the dashboard, which is the extension's options page, once", async ({ context, server, popup, extensionId }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);
  await expect(p.locator("#openDashboard")).toHaveText("Open your words");
  const dash = await openFromPopup(context, p);
  expect(dash.url()).toBe(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(dash.locator("#summary")).toHaveText("3 words in 3 languages");
  await expect(row(dash, "дом")).toContainText("house");
  const manifest = await dash.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.options_ui).toEqual({ page: "dashboard.html", open_in_tab: true });

  // Opening again focuses the same tab instead of a second one.
  const p2 = await popup.page();
  await p2.locator("#openDashboard").click();
  await expect.poll(() => context.pages().filter((x) => x.url().includes("dashboard.html")).length).toBe(1);
});

test("editing a meaning saves without a Save button and reaches the pages' word list", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);
  const dash = await openFromPopup(context, p);
  await row(dash, "дом").click(); // step 1: select
  const meaning = dash.locator("#inspector .gloss-field");
  await meaning.fill("home"); // step 2: edit the field
  await meaning.press("Enter"); // step 3
  await expect(dash.locator("#inspector .fld-gloss-field .saved")).toBeVisible();
  await expect(dash.locator("#toasts")).toContainText("Changed the meaning of дом.");
  await expect.poll(async () => (await server.state()).v1.find((w) => w.native === "дом").gloss).toBe("home");
  // Content scripts read `words` from storage; the background's follow-up sync updates it.
  await expect.poll(() => dash.evaluate(() => chrome.storage.local.get("words").then((s) => s.words.find((w) => w.native === "дом")?.english))).toBe("home");

  // Ctrl+Z undoes the last change on this page.
  await dash.locator("#grid").focus();
  await dash.keyboard.press("Control+z");
  await expect.poll(async () => (await server.state()).v1.find((w) => w.native === "дом").gloss).toBe("house");
});

test("delete in two steps with Undo, then restore from Recently deleted", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);
  const dash = await openFromPopup(context, p);

  await row(dash, "شكرا").click(); // step 1
  await dash.keyboard.press("Delete"); // step 2 (focus is in the list after a click)
  await expect(row(dash, "شكرا")).toHaveCount(0);
  await expect(dash.locator("#toasts .toast-text")).toHaveText("Deleted شكرا.");
  await dash.locator("#toasts .toast-undo").click(); // Undo: 1 step
  await expect(row(dash, "شكرا")).toHaveCount(1);
  await expect.poll(async () => (await server.state()).v1.find((w) => w.native === "شكرا").deleted_at).toBe(null);

  await row(dash, "犬").click();
  await dash.locator(".insp-delete").click();
  await expect(row(dash, "犬")).toHaveCount(0);
  await dash.locator('[data-filter="status"]').click();
  await dash.getByRole("menuitemradio", { name: "Recently deleted" }).click();
  await expect(row(dash, "犬")).toHaveCount(1);
  await row(dash, "犬").getByRole("button", { name: "Restore 犬" }).click();
  await expect(dash.locator("#toasts")).toContainText("Restored 1 word.");
  await expect.poll(async () => (await server.state()).v1.find((w) => w.native === "犬").deleted_at).toBe(null);
  await dash.locator(".filter-clear").click();
  await expect(row(dash, "犬")).toHaveCount(1);
});

test("a word added in the popup appears in the open dashboard without a reload", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);
  const dash = await openFromPopup(context, p);
  await expect(row(dash, "собака")).toHaveCount(0);
  await popup.add("sobaka");
  await expect(row(dash, "собака")).toHaveCount(1, { timeout: 3000 });
  await expect(row(dash, "собака").locator(".c-status")).toHaveText("New");
});

test("search finds a word with one keystroke sequence, without accents", async ({ context, server, popup }) => {
  await server.control({ words: [...WORDS, { id: 9, lang: "es", language: "Spanish", native: "café", romanization: null, english: "coffee", forms: ["coffee"], note: null }] });
  const p = await popup.connect(server.kotikoUrl, server.token);
  const dash = await openFromPopup(context, p);
  await dash.keyboard.press("/");
  await dash.keyboard.type("cafe");
  await expect(dash.locator(".wrow")).toHaveCount(1);
  await expect(dash.locator(".wrow mark.hit")).toHaveText("café");
});

test("Languages you read in: add one, drag it first, and the pages' copy follows (slice 50)", async ({ context, server, popup }) => {
  await server.control({ words: WORDS });
  const p = await popup.connect(server.kotikoUrl, server.token);
  const dash = await openFromPopup(context, p);
  await dash.evaluate(() => (location.hash = "#settings/languages"));
  const rows = dash.locator("#baseList .base-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-lang", "en");
  await dash.locator("#addBaseLang").click();
  await dash.locator(".dialog-card input").fill("pol");
  await dash.locator(".dialog-card input").press("Enter");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).locator(".base-level")).toHaveText("Basic");
  await rows.nth(1).dragTo(rows.nth(0));
  await expect(rows.first()).toHaveAttribute("data-lang", "pl");
  await expect.poll(() => dash.evaluate(() => chrome.storage.sync.get("ui").then((s) => s.ui.baseLangs))).toEqual(["pl", "en"]);
  // Content scripts read the local mirror; the background's projection keeps it in step.
  await expect.poll(() => dash.evaluate(() => chrome.storage.local.get("baseLangs").then((s) => s.baseLangs))).toEqual(["pl", "en"]);
});
