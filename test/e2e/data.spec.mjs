// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 12 in a real browser: back up the words to a file, delete everything while a tab
// shows swapped words (the tab gets its own words back, every storage area and the
// database are gone), then restore the file and get exactly the same words back.
import fs from "node:fs/promises";
import { test, expect } from "./fixtures.mjs";

const P1 = "Thanks for visiting. This house has three rooms and a garden.";
const KEY = "test-provider-key-0123456789";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const everything = (page) => page.evaluate(async () => ({
  local: await chrome.storage.local.get(null),
  sync: await chrome.storage.sync.get(null),
  session: await chrome.storage.session.get(null),
  databases: (await indexedDB.databases()).map((d) => d.name),
}));
const records = (page) => page.evaluate(async () => (await chrome.runtime.sendMessage({ type: "words.list" })).words.sort((a, b) => (a.id < b.id ? -1 : 1)));

test("back up, delete everything with a tab showing swaps, restore: the same words come back", async ({ context, extensionId, server, popup, serviceWorker }, testInfo) => {
  await popup.add("дом = house");
  await popup.add("спасибо = thanks");
  const tab = await context.newPage();
  await tab.goto(server.page("basic.html"));
  await expect(tab.locator("#p1")).toHaveText("Спасибо for visiting. This дом has three rooms and a garden.");

  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#settings/data`);
  // A key, so "delete everything" has a secret to delete.
  await dash.evaluate((key) => chrome.runtime.sendMessage({ type: "secrets.set", id: "provider:custom", value: key }), KEY);
  const before = await records(dash);
  expect(before.map((w) => w.native).sort()).toEqual(["дом", "спасибо"]);

  const [download] = await Promise.all([dash.waitForEvent("download"), dash.locator("#dataBackup").click()]);
  expect(download.suggestedFilename()).toMatch(/^kotiko-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  const text = await fs.readFile(file, "utf8");
  expect(JSON.parse(text).words.map((w) => w.native).sort()).toEqual(["дом", "спасибо"]);
  expect(text).not.toContain(KEY);
  await expect(dash.locator("#dataLastBackup")).toHaveText("Last backup: today");

  await dash.locator("#dataDelete").click();
  const dialog = dash.locator(".dialog-card");
  await expect(dialog.locator(".dialog-title")).toHaveText("Delete everything Kotiko keeps in this browser?");
  await expect(dialog).toContainText("2 words");
  await expect(dialog).toContainText("Your AI key");
  await dialog.locator("input[data-action=backup-first]").uncheck();
  await dialog.locator("[data-action=delete-everything]").click();
  await expect(dash.locator(".dialog-title")).toHaveText("Everything is deleted.");

  // The open tab puts its own words back; nothing is left anywhere.
  await expect(tab.locator("#p1")).toHaveText(P1);
  const left = await everything(dash);
  expect(left.local).toEqual({});
  expect(left.session).toEqual({});
  expect(left.databases).not.toContain("kotiko");
  expect(JSON.stringify(left)).not.toContain(KEY);
  expect(await dash.evaluate(() => localStorage.length)).toBe(0);
  // And from the background's side.
  const fromWorker = await serviceWorker.evaluate(async () => ({ databases: (await indexedDB.databases()).map((d) => d.name), local: await chrome.storage.local.get(null) }));
  expect(fromWorker).toEqual({ databases: [], local: {} });

  // Restore the file on a fresh dashboard, opened a moment later.
  await sleep(2500);
  const again = await context.newPage();
  await again.goto(`chrome-extension://${extensionId}/dashboard.html#settings/data`);
  expect(await again.evaluate(() => chrome.runtime.sendMessage({ type: "secrets.describe" }))).toEqual({ secrets: {} });
  const [chooser] = await Promise.all([again.waitForEvent("filechooser"), again.locator("#dataRestore").click()]);
  await chooser.setFiles(file);
  const preview = again.locator(".dialog-card");
  await expect(preview).toContainText("2 words in the file");
  await expect(preview).toContainText("2 new");
  await preview.locator("[data-action=restore]").click();
  await expect(again.locator("#toasts")).toContainText("Restored 2 words.");
  expect(await records(again)).toEqual(before);
  await tab.reload();
  await expect(tab.locator("#p1")).toHaveText("Спасибо for visiting. This дом has three rooms and a garden.");
});
