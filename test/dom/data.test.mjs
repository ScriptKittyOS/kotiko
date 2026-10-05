// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 12 in the dashboard (jsdom, fake chrome): "Your data" loads its code on first use;
// the backup, spreadsheet and Anki downloads; restoring a backup (from the button or
// dropped into bulk add) with its preview and Undo; and "Delete everything" with its
// confirmation, after which the page asks for nothing more.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { createI18n, readMessages } from "../helpers/fake-i18n.mjs";
import { readExt, runInWindow, sleep } from "../helpers/load-script.mjs";
import { dashboardWords } from "../helpers/dashboard-words.mjs";

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../spec/fixtures/export");
const fixture = (name) => fs.readFileSync(path.join(FIX, name), "utf8");
const LOCAL = { wordsHome: "local", keys: { server: false, providers: { openrouter: true } }, lookup: { kind: "provider", provider: "openrouter" }, baseLangs: ["en"], prefs: { theme: "dark" } };
const clone = (v) => JSON.parse(JSON.stringify(v));
const opened = [];
after(() => {
  for (const dom of opened) dom.window.close();
});

function backend({ words = dashboardWords(Date.now()), describe: info = null, failDelete = null } = {}) {
  const b = { words: clone(words), sent: [] };
  b.answer = (msg) => {
    b.sent.push(clone(msg));
    switch (msg.type) {
      case "words.list":
        return { words: clone(b.words), cursor: null };
      case "words.deleted":
        return { entries: [] };
      case "backup.status":
        return { lastBackupAt: null, lastImport: null };
      case "backup.saved":
        return { ok: true };
      case "backup.preview":
        return { ok: true, home: "local", counts: { new: msg.words.length - 1, merge: 1, identical: 0, kept: 0, deletedLater: 2, restoredDeleted: msg.restoreDeleted ? 2 : 0 }, restoreDeleted: msg.restoreDeleted ?? false, total: msg.words.length };
      case "backup.restore":
        return { ok: true, home: "local", counts: { new: msg.words.length - 1, merge: 1 }, restoreDeleted: msg.restoreDeleted };
      case "backup.undo":
        return { ok: true, undone: 3, changed: 0 };
      case "data.describe":
        return info ?? { wordsHome: "local", words: b.words.length, providerKey: true, server: { url: "http://home.example:4747", words: 1204 }, syncReal: true };
      case "data.deleteAll":
        if (failDelete) return { error: failDelete.message, code: failDelete.code, details: { status: 500 } };
        return { ok: true, server: msg.server ? { deleted: 1204, reset_epoch: 1 } : null };
      default:
        return undefined;
    }
  };
  return b;
}

async function openDashboard({ local = LOCAL, sync = { ui: { baseLangs: ["en"] } }, hash = "#settings/data", api = backend() } = {}) {
  const fake = createFakeChrome({ local: { ...local }, sync, onSendMessage: (msg) => api.answer(msg) });
  fake.chrome.i18n = createI18n("en");
  fake.chrome.runtime.getManifest = () => ({ manifest_version: 3, version: "0.3.0" });
  const dom = new JSDOM(readExt("dashboard.html"), { url: `chrome-extension://fake-extension-id/dashboard.html${hash}`, runScripts: "outside-only", pretendToBeVisual: true });
  opened.push(dom);
  const w = dom.window;
  w.chrome = fake.chrome;
  w.matchMedia = (q) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  // What the browser does for scripts the page adds later: runs them, says so.
  const loadedLater = [];
  new w.MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.localName !== "script" || !n.src) continue;
        const rel = n.src.replace(/^chrome-extension:\/\/[^/]+\//, "");
        loadedLater.push(rel);
        runInWindow(dom, rel);
        n.dispatchEvent(new w.Event("load"));
      }
    }
  }).observe(w.document.head, { childList: true });
  w.fetch = async (url) => new Response(readExt(String(url).replace(/^chrome-extension:\/\/[^/]+\//, "")));
  // Downloads: the Blob behind each <a download> that was clicked.
  const blobs = new Map();
  const downloads = [];
  w.URL.createObjectURL = (blob) => {
    const url = `blob:test/${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function click() {
    if (this.download) downloads.push({ name: this.download, blob: blobs.get(this.href), at: api.sent.length });
  };
  // An extension page's own localStorage (jsdom has none for chrome-extension:// pages).
  const kept = new Map([["kotiko-theme", "dark"]]);
  Object.defineProperty(w, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => (kept.has(k) ? kept.get(k) : null),
      setItem: (k, v) => void kept.set(k, String(v)),
      removeItem: (k) => void kept.delete(k),
      clear: () => kept.clear(),
      key: (i) => [...kept.keys()][i] ?? null,
      get length() {
        return kept.size;
      },
    },
  });
  runInWindow(dom, "lib/i18n.js");
  w.KotikoI18n._setLoader(async (l) => readMessages(l));
  for (const rel of ["spec/spec.js", "lib/lang.js", "lib/welcome-model.js", "ui/icons.js", "lib/speak.js", "lib/word-card.js", "lib/word-search.js", "lib/dashboard-model.js", "lib/precedence.js", "lib/word-source.js", "lib/text.js", "bulk/parse.js", "bulk/sheet.js", "lib/lookup-status.js", "lib/errors.js", "lib/story.js", "dashboard.js"]) {
    runInWindow(dom, rel);
    if (rel === "lib/story.js") w.KotikoStory._setLoader(async (l) => readExt(`story/${l}.md`));
  }
  await w.KotikoDashboard.ready;
  const doc = w.document;
  const $ = (sel) => doc.querySelector(sel);
  const $$ = (sel) => [...doc.querySelectorAll(sel)];
  const settle = async (n = 8) => {
    for (let i = 0; i < n; i++) {
      await fake.idle();
      await sleep(0);
    }
  };
  const text = (sel) => $(sel)?.textContent.replace(/\s+/g, " ").trim();
  const dialog = () => $(".dialog-card");
  const button = (label) => $$(".dialog-card button").find((b) => b.textContent === label);
  return { dom, w, doc, $, $$, fake, api, settle, text, dialog, button, loadedLater, downloads, store: fake.store.local };
}

// A file's text through the bulk add box (13), as pasting or dropping it does.
async function pasteIntoBulk(d, text) {
  d.w.location.hash = "#add";
  await d.settle();
  const area = d.$("#bulkText");
  area.value = text;
  area.dispatchEvent(new d.w.Event("input", { bubbles: true }));
  await sleep(200);
  await d.settle(12);
}

describe("Your data (§1)", () => {
  test("the section is in Settings; its code loads on first use only", async () => {
    const d = await openDashboard();
    assert.equal(d.$("#set-data").hidden, false);
    assert.deepEqual(d.$$("#set-data .field-label").map((n) => n.textContent), ["Back up", "Share", "Restore", "Danger zone"]);
    assert.equal(d.text("#dataLastBackup"), "No backup yet");
    assert.equal(d.$("#dataReminder").hidden, false, "words only in this browser: the reminder switch shows");
    assert.deepEqual(d.loadedLater, [], "nothing loaded for the first view");
    d.$("#dataBackup").click();
    await d.settle();
    assert.deepEqual(d.loadedLater, ["lib/word-merge.js", "lib/wordspec.js", "lib/backup.js", "lib/export-files.js", "data-tools.js"]);
  });

  test("Export backup: kotiko-backup-<date>.json with every word and the settings, never a token", async () => {
    const d = await openDashboard({ local: { ...LOCAL, token: "legacy-token-123", keys: { server: true, providers: {} }, server: { url: "http://me:pw@home.example:4747" } } });
    d.$("#dataBackup").click();
    await d.settle();
    const [file] = d.downloads;
    assert.match(file.name, /^kotiko-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const text = await file.blob.text();
    const doc = JSON.parse(text);
    assert.equal(doc.format, "kotiko.words");
    assert.equal(doc.words.length, d.api.words.length);
    assert.equal(doc.settings.prefs.theme, "dark");
    assert.deepEqual(doc.settings.server, { url: "http://home.example:4747" });
    assert.ok(!text.includes("legacy-token-123") && !text.includes(":pw@"));
    assert.ok(d.api.sent.some((m) => m.type === "backup.saved"));
    assert.match(d.text("#toasts"), /Saved kotiko-backup-/);
    d.$("#dataIncludeSettings").click();
    d.$("#dataBackup").click();
    await d.settle();
    assert.equal(JSON.parse(await d.downloads[1].blob.text()).settings, undefined, "unticked: no settings");
  });

  test("Spreadsheet: all words, or the current filter; the header in the interface language", async () => {
    const d = await openDashboard();
    d.$("#dataCsv").click();
    await d.settle();
    const bytes = new Uint8Array(await d.downloads[0].blob.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 with a byte-order mark");
    const all = await d.downloads[0].blob.text();
    assert.match(d.downloads[0].name, /^kotiko-words-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.ok(all.startsWith("word,word_with_marks,pronunciation,"));
    assert.equal(all.split("\r\n").filter(Boolean).length, d.api.words.length + 1);
    // The ⋯ menu's export follows the list's filters.
    d.w.location.hash = "#words?lang=ru";
    await d.settle();
    d.$("#moreMenu").click();
    await d.settle();
    const item = [...d.doc.querySelectorAll(".menu [role=menuitem], .menu button")].find((b) => b.textContent === "Export these words as a spreadsheet");
    assert.ok(item);
    item.click();
    await d.settle();
    const ru = (await d.downloads[1].blob.text()).split("\r\n").slice(1).filter(Boolean);
    assert.equal(ru.length, d.api.words.filter((w) => w.lang === "ru").length);
    assert.ok(ru.every((l) => l.includes(",ru,")));
  });

  test("Anki cards: 'My Anki is in' picks the note type's name; the howto is shown", async () => {
    const d = await openDashboard();
    d.$("#dataAnki").click();
    await d.settle();
    assert.equal(d.text(".dialog-title"), "Anki cards");
    assert.equal(d.$("#ankiLocale").value, "en");
    assert.match(d.text(".dialog-card"), /In Anki: File, Import, choose this file\./);
    d.$("[data-action=anki-download]").click();
    await d.settle();
    const text = await d.downloads[0].blob.text();
    assert.match(d.downloads[0].name, /^kotiko-anki-\d{4}-\d{2}-\d{2}\.txt$/);
    assert.ok(text.includes("#notetype:Basic (and reversed card)\n"));
    assert.ok(text.includes("#guid column:6"));
    // An Anki in a language with no verified name: no #notetype, so Anki asks.
    d.$("#dataAnki").click();
    await d.settle();
    d.$("#ankiLocale").value = "";
    d.$("[data-action=anki-download]").click();
    await d.settle();
    const other = await d.downloads[1].blob.text();
    assert.ok(!other.includes("#notetype"));
    assert.ok(other.includes("#guid column:"));
  });
});

describe("restoring a backup (§5)", () => {
  test("a backup dropped into bulk add opens 12's restore preview; Restore, then Undo", async () => {
    const d = await openDashboard({ hash: "#words" });
    await pasteIntoBulk(d, fixture("multi-script.json"));
    assert.equal(d.text(".dialog-title"), "Restore kotiko-backup.json");
    const body = d.text(".dialog-card");
    assert.match(body, /13 words in the file/);
    assert.match(body, /12 new/);
    assert.match(body, /1 will be merged/);
    assert.match(body, /0 can’t be used|0 can't be used/);
    assert.match(body, /Also restore 2 words you deleted after this backup was made/);
    assert.match(body, /Restore settings from the backup/);
    assert.equal(d.$("[data-action=restore]").textContent, "Restore 13 words");
    d.$("[data-action=restore-deleted]").click();
    await d.settle();
    assert.equal(d.api.sent.filter((m) => m.type === "backup.preview").at(-1).restoreDeleted, true, "ticking asks again");
    d.$("[data-action=restore]").click();
    await d.settle();
    const sent = d.api.sent.find((m) => m.type === "backup.restore");
    assert.equal(sent.words.length, 13);
    assert.equal(sent.restoreDeleted, true);
    assert.equal(d.store.hiddenLangs?.[0], "hy", "settings restored");
    assert.match(d.text("#toasts"), /Restored 13 words\./);
    d.$("#toasts .toast-undo").click();
    await d.settle();
    assert.ok(d.api.sent.some((m) => m.type === "backup.undo"));
    assert.match(d.text("#toasts"), /The restore is undone\./);
  });

  test("a version 1 backup with bases [es]: offers to add English; nothing is lost either way", async () => {
    const d = await openDashboard({ hash: "#words", sync: { ui: { baseLangs: ["es"] } } });
    await pasteIntoBulk(d, fixture("v1.json"));
    assert.match(d.text(".data-notice"), /These words are for pages in English, which isn’t one of your languages|These words are for pages in English, which isn't one of your languages/);
    d.$("[data-action=add-bases]").click();
    await d.settle();
    assert.deepEqual(d.fake.store.sync.ui.baseLangs, ["es", "en"]);
    assert.equal(d.$(".data-notice").hidden, true);
    const w = JSON.parse(JSON.stringify(d.api.sent.find((m) => m.type === "backup.preview").words));
    assert.deepEqual(w.map((x) => [x.gloss, x.base_lang]), [["please", "en"], ["cat", "en"], ["water", "en"]]);
  });

  test("a file from a newer Kotiko is refused with the 'newer version' message and changes nothing", async () => {
    const d = await openDashboard({ hash: "#words" });
    await pasteIntoBulk(d, fixture("newer.json"));
    assert.equal(d.dialog(), null);
    assert.match(d.text("#toasts"), /This backup was made by a newer version of Kotiko\. Update Kotiko, then try again\./);
    assert.ok(!d.api.sent.some((m) => m.type.startsWith("backup.preview") || m.type === "backup.restore"));
  });
});

describe("delete everything (§6)", () => {
  test("the dialog says what goes and what Kotiko can't delete; Cancel is the default", async () => {
    const d = await openDashboard();
    d.$("#dataDelete").click();
    await d.settle();
    assert.equal(d.text(".dialog-title"), "Delete everything Kotiko keeps in this browser?");
    const body = d.text(".dialog-card");
    assert.match(body, new RegExp(`${d.api.words.length} words`));
    assert.match(body, /Your settings/);
    assert.match(body, /Your AI key/);
    assert.match(body, /Kotiko can’t delete|Kotiko can't delete/);
    assert.equal(d.$("input[data-action=backup-first]").checked, true);
    assert.equal(d.$("input[data-action=clear-sync]").checked, false);
    assert.equal(d.$("input[data-action=delete-server]").checked, false);
    assert.match(d.$("input[data-action=delete-server]").closest("label").textContent, /Also delete all 1,204 words on my Kotiko server \(http:\/\/home\.example:4747\)/);
    assert.equal(d.doc.activeElement.textContent, "Cancel");
    d.doc.activeElement.click();
    await d.settle();
    assert.ok(!d.api.sent.some((m) => m.type === "data.deleteAll"));
  });

  test("no server or synced browsers: those boxes don't show", async () => {
    const d = await openDashboard({ api: backend({ describe: { wordsHome: "local", words: 3, providerKey: false, server: null, syncReal: false } }) });
    d.$("#dataDelete").click();
    await d.settle();
    assert.equal(d.$("input[data-action=delete-server]"), null);
    assert.equal(d.$("input[data-action=clear-sync]"), null);
    assert.doesNotMatch(d.text(".dialog-card"), /AI key/);
  });

  test("backup first, then the delete; the page clears its own storage and asks for nothing more", async () => {
    const d = await openDashboard();
    d.$("#dataDelete").click();
    await d.settle();
    d.$("input[data-action=delete-server]").click();
    d.$("[data-action=delete-everything]").click();
    await sleep(1700);
    await d.settle();
    const del = d.api.sent.findIndex((m) => m.type === "data.deleteAll");
    assert.ok(del >= 0);
    assert.deepEqual(d.api.sent[del], { type: "data.deleteAll", confirm: "delete-everything", server: true, sync: false });
    assert.equal(d.downloads.length, 1, "the backup was downloaded");
    assert.ok(d.downloads[0].at <= del, "before anything was deleted");
    assert.equal(d.w.localStorage.length, 0);
    assert.equal(d.text(".dialog-title"), "Everything is deleted.");
    assert.ok(d.button("Start again") && d.button("Close"));
    const count = d.api.sent.length;
    await d.fake.chrome.storage.local.set({ wordsHome: "server" });
    d.w.dispatchEvent(new d.w.Event("focus"));
    await d.settle();
    assert.equal(d.api.sent.length, count, "nothing recreates what was deleted");
    // Start again: the welcome page, and this tab closes.
    let closed = null;
    d.fake.chrome.tabs.getCurrent = async () => ({ id: 7 });
    d.fake.chrome.tabs.remove = async (id) => void (closed = id);
    d.button("Start again").click();
    await d.settle();
    assert.equal(d.api.sent.at(-1).type, "welcome.open");
    assert.equal(closed, 7);
  });

  test("Close closes the tab", async () => {
    const d = await openDashboard();
    d.$("#dataDelete").click();
    await d.settle();
    d.$("input[data-action=backup-first]").click();
    d.$("[data-action=delete-everything]").click();
    await d.settle();
    let closed = null;
    d.fake.chrome.tabs.getCurrent = async () => ({ id: 9 });
    d.fake.chrome.tabs.remove = async (id) => void (closed = id);
    d.button("Close").click();
    await d.settle();
    assert.equal(closed, 9);
    const count = d.api.sent.length;
    d.w.dispatchEvent(new d.w.Event("focus"));
    await d.settle();
    assert.equal(d.api.sent.length, count, "nothing recreates what was deleted");
  });

  test("when the server can't delete, nothing is deleted and the dialog says so", async () => {
    const d = await openDashboard({ api: backend({ failDelete: { code: "server_unreachable", message: "x" } }) });
    d.$("#dataDelete").click();
    await d.settle();
    d.$("input[data-action=backup-first]").click();
    d.$("input[data-action=delete-server]").click();
    d.$("[data-action=delete-everything]").click();
    await d.settle();
    assert.match(d.text(".dialog-card .field-error"), /Couldn’t delete the words on your server|Couldn't delete the words on your server/);
    assert.equal(d.w.localStorage.getItem("kotiko-theme"), "dark");
    assert.equal(d.$("[data-action=delete-everything]").disabled, false);
  });
});
