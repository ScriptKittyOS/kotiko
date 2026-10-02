// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// dashboard.html and dashboard.js (slice 21) in jsdom, with a fake chrome whose background
// answers the dashboard's messages from an in-memory word store: the states, search,
// filters, the inspector's saves, delete and Undo, Recently deleted, bulk actions, the
// refresh line, live updates, adding words, settings and the interface language.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { createI18n, readMessages } from "../helpers/fake-i18n.mjs";
import { readExt, runInWindow, sleep } from "../helpers/load-script.mjs";
import { dashboardWords, manyWords } from "../helpers/dashboard-words.mjs";

const CONNECTED = { serverUrl: "http://127.0.0.1:4999", token: "t0ken", lastSync: Date.now() - 60_000, syncError: null };
const clone = (v) => JSON.parse(JSON.stringify(v));
// Windows are closed at the end so their timers (the refresh poll, retries) stop.
const opened = [];
after(() => {
  for (const dom of opened) dom.window.close();
});

// The background's side: /api/v1 semantics over an array, recording every message.
function fakeBackend({ words = dashboardWords(Date.now()), job = { state: "done", done: 0, total: 0 }, failList = null, candidates = {} } = {}) {
  const b = { words: clone(words), deleted: [], job, sent: [], failList, failWrites: null, stamp: Date.now() };
  const now = () => new Date(++b.stamp).toISOString();
  const find = (id) => b.words.find((w) => w.id === id);
  b.answer = (msg) => {
    b.sent.push(clone(msg));
    switch (msg.type) {
      case "sync":
        return { ok: true };
      case "words.list":
        if (b.failList) return b.failList;
        return { words: clone(b.words.filter((w) => !w.deleted_at)), cursor: "1" };
      case "words.deleted":
        return { entries: clone(b.deleted) };
      case "job.refresh":
        if (msg.action === "pause") b.job = { ...b.job, state: "paused" };
        if (msg.action === "resume") b.job = { ...b.job, state: "running" };
        return clone(b.job);
      case "words.preview":
        return { candidates: clone(candidates[msg.text] ?? []), rejected: [] };
      case "words.save": {
        const results = msg.words.map((w, i) => {
          const word = { ...w, id: `new-${b.words.length}-${i}`, base_lang: w.base_lang ?? "en", status: "active", created_at: now(), updated_at: now() };
          b.words.unshift(word);
          return { result: "created", word: clone(word) };
        });
        return { results, rejected: [] };
      }
      case "words.write": {
        if (b.failWrites) return { results: msg.ops.map(() => b.failWrites) };
        const results = msg.ops.map((op) => {
          const w = find(op.id);
          if (!w) return { ok: false, code: "word_gone", message: "", details: { status: 404 } };
          if (op.op === "delete") {
            w.deleted_at = w.updated_at = now();
            b.deleted.push({ id: w.id, at: Date.now(), word: clone(w) });
            return { ok: true, word: clone(w) };
          }
          if (op.op === "restore") {
            w.deleted_at = null;
            w.updated_at = now();
            b.deleted = b.deleted.filter((e) => e.id !== w.id);
            return { ok: true, word: clone(w) };
          }
          if (op.if_updated_at && op.if_updated_at !== w.updated_at) {
            return { ok: false, code: "word_conflict", message: "", details: { reason: "stale", word: clone(w), status: 409 } };
          }
          Object.assign(w, op.patch);
          if ("pronunciation" in op.patch || "pronunciation_careful" in op.patch) w.pronunciation_source = "user";
          w.updated_at = now();
          return { ok: true, word: clone(w) };
        });
        return { results };
      }
      default:
        return undefined;
    }
  };
  return b;
}

async function openDashboard({ local = CONNECTED, sync = {}, locale = "en", hash = "", width = 1440, backend = fakeBackend() } = {}) {
  const fake = createFakeChrome({ local: { ...local }, sync, onSendMessage: (msg) => backend.answer(msg) });
  fake.chrome.i18n = createI18n(locale);
  const dom = new JSDOM(readExt("dashboard.html"), {
    url: `chrome-extension://fake-extension-id/dashboard.html${hash}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  opened.push(dom);
  const w = dom.window;
  w.chrome = fake.chrome;
  // jsdom has no layout: report the width asked for.
  w.matchMedia = (q) => {
    const min = /min-width:\s*(\d+)/.exec(q);
    const max = /max-width:\s*(\d+)/.exec(q);
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  };
  runInWindow(dom, "lib/i18n.js");
  w.KotikoI18n._setLoader(async (l) => readMessages(l));
  for (const rel of ["ui/icons.js", "lib/speak.js", "lib/word-card.js", "lib/word-search.js", "lib/dashboard-model.js", "lib/word-source.js", "dashboard.js"]) runInWindow(dom, rel);
  await w.KotikoDashboard.ready;
  const doc = w.document;
  const $ = (sel) => doc.querySelector(sel);
  const $$ = (sel) => [...doc.querySelectorAll(sel)];
  const settle = async (n = 6) => {
    for (let i = 0; i < n; i++) {
      await fake.idle();
      await sleep(0);
    }
  };
  const text = (sel) => $(sel)?.textContent.replace(/\s+/g, " ").trim();
  const rows = () => $$(".wrow").sort((a, b) => Number(a.getAttribute("aria-rowindex")) - Number(b.getAttribute("aria-rowindex")));
  const row = (native) => rows().find((r) => r.querySelector(".w-native")?.textContent === native);
  const key = (k, opts = {}, target = doc.activeElement ?? doc.body) =>
    target.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }));
  const type = async (input, value) => {
    input.focus();
    input.value = value;
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
    await settle();
  };
  const commit = async (input, value) => {
    await type(input, value);
    key("Enter", {}, input);
    await settle();
  };
  const writes = () => backend.sent.filter((m) => m.type === "words.write");
  const field = (label) => $$("#inspector .fld").find((f) => f.querySelector(".field-label")?.textContent === label)?.querySelector("input, textarea");
  return { dom, w, doc, $, $$, fake, backend, settle, text, rows, row, key, type, commit, writes, field, store: fake.store.local };
}

// Every text node and accessible name a person can perceive.
function perceivable(doc) {
  const out = [];
  const walk = (node) => {
    if (node.nodeType === 1 && (node.hidden || node.tagName === "SCRIPT" || node.tagName === "STYLE")) return;
    if (node.nodeType === 3 && node.textContent.trim()) out.push(node.textContent.trim());
    if (node.nodeType === 1) for (const a of ["aria-label", "title", "placeholder"]) if (node.getAttribute(a)) out.push(node.getAttribute(a));
    for (const c of node.childNodes) walk(c);
  };
  walk(doc.body);
  return out;
}

describe("states (§11)", () => {
  test("the list: rows lead with the native word in its language, the shelf counts per language", async () => {
    const d = await openDashboard();
    assert.equal(d.text("#wordsTitle"), "Your words");
    assert.equal(d.text("#summary"), "23 words in 12 languages");
    assert.equal(d.$("#grid").getAttribute("aria-rowcount"), "24");
    const first = d.rows()[0];
    assert.equal(first.getAttribute("aria-rowindex"), "2");
    assert.equal(first.querySelector(".w-native").textContent, "спасибо");
    assert.equal(first.querySelector(".w-native").lang, "ru");
    assert.equal(first.querySelector(".w-rom").textContent, "spasibo");
    assert.equal(d.row("犬").querySelector(".c-meaning").textContent.replace(/\s+/g, " "), "dog · perro", "one row for both bases");
    assert.equal(d.row("شكرا").querySelector(".w-native").getAttribute("dir"), "auto");
    assert.equal(d.row("собака").querySelector(".c-status").textContent, "Paused");
    const cards = d.$$(".shelf-card");
    assert.equal(cards[0].getAttribute("aria-pressed"), "true", "All is selected");
    assert.equal(cards[1].querySelector(".shelf-title").textContent, "Русский");
    assert.equal(cards[1].querySelector(".shelf-title").lang, "ru");
    assert.equal(cards[1].getAttribute("aria-label"), "Russian, Русский, 5 words");
    assert.equal(d.$("#app").dataset.ready, "true");
  });

  test("no words: a friendly empty state with Add words", async () => {
    const d = await openDashboard({ backend: fakeBackend({ words: [] }) });
    assert.equal(d.text(".empty-title"), "No words yet.");
    assert.equal(d.text(".empty-body"), "Add the first one you’d love to learn, in any language.");
    d.$(".empty-actions .btn-primary").click();
    await d.settle();
    assert.equal(d.w.location.hash, "#add");
    assert.equal(d.$("#addSheet").hidden, false);
  });

  test("not connected: a banner that leads to Connection settings", async () => {
    const d = await openDashboard({ local: {}, backend: fakeBackend({ failList: { error: "no token", code: "server_key_rejected", details: { reason: "no_token" } } }) });
    assert.equal(d.text("#banners .banner-body"), "Connect your Kotiko server to see your words here.");
    d.$("#banners .btn").click();
    await d.settle();
    assert.equal(d.w.location.hash, "#settings/connection");
    assert.equal(d.$("#settingsView").hidden, false);
  });

  test("server unreachable: a calm state banner with Try again, and the list says why it's empty", async () => {
    const d = await openDashboard({ backend: fakeBackend({ failList: { error: "Can't reach", code: "server_unreachable", details: { reason: "network" } } }) });
    assert.equal(d.$("#banners .banner").dataset.severity, "state");
    assert.equal(d.text("#banners .banner-body"), "Can't reach your Kotiko server. Adding words will work once it's back.");
    assert.equal(d.text(".list-empty"), "Your words will show here when your server answers.");
    d.backend.failList = null;
    d.$("#banners .btn").click();
    await d.settle();
    assert.equal(d.$("#banners").children.length, 0);
    assert.equal(d.rows().length > 0, true);
  });
});

describe("search (§4)", () => {
  test("as you type, without accents or tone marks, with the match in weight 600", async () => {
    const d = await openDashboard();
    await d.type(d.$("#search"), "xiexie");
    assert.deepEqual(d.rows().map((r) => r.querySelector(".w-native").textContent), ["谢谢"]);
    assert.equal(d.rows()[0].querySelector("mark.hit").textContent, "xièxie");
    assert.equal(d.w.location.hash, "#words?q=xiexie", "state mirrored in the hash");
    await d.type(d.$("#search"), "spaseeba");
    assert.deepEqual(d.rows().map((r) => r.querySelector(".w-native").textContent), ["спасибо"]);
    await d.type(d.$("#search"), "perro");
    assert.deepEqual(d.rows().map((r) => r.querySelector(".w-native").textContent), ["犬"]);
  });

  test("no results offers to add the word or clear the search; Esc clears", async () => {
    const d = await openDashboard();
    await d.type(d.$("#search"), "zzqx");
    assert.equal(d.text(".list-empty .empty-title"), "No words match “zzqx”.");
    assert.equal(d.text(".list-empty .btn-primary"), "Add “zzqx” as a new word");
    d.key("Escape", {}, d.$("#search"));
    await d.settle();
    assert.equal(d.$("#search").value, "");
    assert.equal(d.rows().length > 1, true);
  });

  test("/ focuses search from anywhere outside a text field", async () => {
    const d = await openDashboard();
    d.doc.body.focus();
    d.key("/", {}, d.doc.body);
    assert.equal(d.doc.activeElement, d.$("#search"));
    // The field has focus when the page opens; "/" there isn't typed into it.
    assert.equal(d.key("/", {}, d.$("#search")), false, "default prevented");
  });
});

describe("filters and the shelf (§2, §3)", () => {
  test("a shelf card filters by language; All clears; routes are linkable", async () => {
    const d = await openDashboard();
    d.$('.shelf-card[data-lang="ru"]').click();
    await d.settle();
    assert.ok(d.rows().every((r) => r.querySelector(".w-native").lang === "ru"));
    assert.equal(d.w.location.hash, "#words?lang=ru");
    assert.equal(d.$('.shelf-card[data-lang="ru"]').getAttribute("aria-pressed"), "true");
    d.$('.shelf-card[data-lang=""]').click();
    await d.settle();
    assert.equal(d.rows().length, 23);
    const e = await openDashboard({ hash: "#words?lang=ar&q=book" });
    assert.deepEqual(e.rows().map((r) => r.querySelector(".w-native").textContent), ["كتاب"]);
  });

  test("filter chips open a menu; an empty filter says so with Clear filters", async () => {
    const d = await openDashboard({ backend: fakeBackend({ words: dashboardWords(Date.now()).filter((w) => w.status !== "paused") }) });
    d.$('[data-filter="status"]').click();
    const items = d.$$(".menu [role=menuitemradio]");
    assert.deepEqual(items.map((i) => i.textContent), ["Active and paused", "Active", "Paused", "Recently deleted"]);
    assert.equal(items[0].getAttribute("aria-checked"), "true");
    items[2].click();
    await d.settle();
    assert.equal(d.text(".list-empty .empty-title"), "No paused words.");
    assert.ok(d.$(".filter-clear"), "an active filter shows ×");
    d.$(".list-empty .btn").click();
    await d.settle();
    assert.equal(d.rows().length, 22);
  });

  test("sort by word A-Z", async () => {
    const d = await openDashboard({ hash: "#words?lang=ru&sort=native" });
    assert.deepEqual(d.rows().map((r) => r.querySelector(".w-native").textContent), ["дом", "кошка", "пожалуйста", "собака", "спасибо"]);
  });
});

describe("the inspector (§5)", () => {
  test("opens on click as a labelled region with the word as a specimen and the dotted line", async () => {
    const d = await openDashboard();
    d.row("спасибо").click();
    await d.settle();
    const insp = d.$("#inspector");
    assert.equal(insp.hidden, false);
    assert.equal(insp.getAttribute("role"), "region");
    assert.equal(insp.getAttribute("aria-label"), "Details of спасибо");
    assert.equal(d.$(".spec-field").value, "спасибо");
    assert.equal(d.$(".spec-field").lang, "ru");
    assert.equal(d.field("With stress mark").value, "спаси́бо");
    assert.equal(d.text(".insp-shows"), "Kotiko shows спасибо where pages say “thanks”.");
    assert.equal(d.text(".base-title"), "On pages in English");
    assert.equal(d.text(".pron-label"), "AI-generated");
    assert.equal(d.$(".pron-preview b").textContent, "SEE");
    assert.match(d.w.location.hash, /^#words\/0190a000/);
  });

  test("a field saves on Enter with no Save button, says Saved, and Ctrl+Z undoes it", async () => {
    const d = await openDashboard();
    d.row("спасибо").click();
    await d.settle();
    const id = d.backend.words.find((w) => w.native === "спасибо").id;
    const before = d.backend.words.find((w) => w.id === id).updated_at;
    await d.commit(d.field("Meaning"), "thank you");
    const [write] = d.writes();
    assert.deepEqual(write.ops, [{ op: "patch", id, patch: { gloss: "thank you" }, if_updated_at: before }]);
    assert.equal(d.$("#inspector .saved:not([hidden])")?.textContent, "Saved");
    assert.equal(d.text("#toasts .toast-text"), "Changed the meaning of спасибо.");
    assert.equal(d.row("спасибо").querySelector(".c-meaning").textContent.startsWith("thank you"), true, "the list updates at once");
    assert.equal(d.$("#inspector button[type=submit]"), null);
    d.$("#gridBody").focus();
    d.key("z", { ctrlKey: true }, d.doc.body);
    await d.settle();
    assert.deepEqual(d.writes().at(-1).ops[0].patch, { gloss: "thanks" });
    assert.equal(d.backend.words.find((w) => w.id === id).gloss, "thanks");
  });

  test("pronunciation: wrong capitals are refused inline; a good one saves as the learner's own", async () => {
    const d = await openDashboard();
    d.row("пожалуйста").click();
    await d.settle();
    const pron = d.field("Pronunciation");
    await d.commit(pron, "PA-ZHAL-STA");
    assert.equal(d.writes().length, 0, "nothing sent");
    assert.equal(pron.getAttribute("aria-invalid"), "true");
    assert.equal(d.text(`#${pron.getAttribute("aria-describedby")}`), "Write the stressed syllable in capitals, and only that one: pa-ZHAL-sta.");
    await d.commit(pron, "pa-ZHA-lu-sta");
    assert.deepEqual(d.writes()[0].ops[0].patch, { pronunciation: "pa-ZHA-lu-sta" });
    assert.equal(d.backend.words.find((w) => w.native === "пожалуйста").pronunciation_source, "user");
    await d.settle();
    assert.equal(d.$(".pron-label:not([hidden])"), null, "the AI-generated label goes away");
  });

  test("a two-base word: editing the English meaning leaves the Spanish record alone; pausing pauses both", async () => {
    const d = await openDashboard();
    d.row("犬").click();
    await d.settle();
    assert.deepEqual(d.$$(".base-title").map((n) => n.textContent), ["On pages in English", "On pages in Spanish"]);
    const meanings = d.$$("#inspector .gloss-field");
    await d.commit(meanings[0], "hound");
    assert.deepEqual(d.writes()[0].ops.map((o) => [o.id, o.patch]), [["0190a000-0000-7000-8000-0000000000a1", { gloss: "hound" }]]);
    assert.equal(d.backend.words.find((w) => w.id.endsWith("a2")).gloss, "perro");
    d.$(".insp-swap").click();
    await d.settle();
    assert.deepEqual(d.writes()[1].ops.map((o) => o.patch.status), ["paused", "paused"]);
  });

  test("the last form can't be removed", async () => {
    const d = await openDashboard();
    d.row("café").click();
    await d.settle();
    d.$(".form-remove").click();
    await d.settle();
    assert.equal(d.writes().length, 0);
    assert.equal(d.text(".forms .field-error"), "A word needs at least one meaning in English.");
  });

  test("forms: + Add takes several at once", async () => {
    const d = await openDashboard();
    d.row("café").click();
    await d.settle();
    await d.commit(d.$(".form-add"), "coffees, a coffee");
    assert.deepEqual(d.writes()[0].ops[0].patch.forms.map((f) => f.text), ["coffee", "coffees", "a coffee"]);
  });

  test("a change elsewhere while a field is being edited keeps the draft and offers both", async () => {
    const d = await openDashboard();
    d.row("café").click();
    await d.settle();
    const gloss = d.field("Meaning");
    await d.type(gloss, "a coffee");
    // Another device changes the word, and the dashboard reloads.
    const w = d.backend.words.find((x) => x.native === "café");
    Object.assign(w, { gloss: "espresso", updated_at: new Date(Date.now() + 5000).toISOString() });
    await d.fake.chrome.storage.local.set({ wordsVersion: { at: 1, by: "phone" } });
    await sleep(300);
    await d.settle();
    assert.equal(gloss.value, "a coffee", "the draft stays");
    assert.match(d.text(".fld-gloss-field .field-error"), /This word just changed on another device\. Use theirs Keep mine/);
    [...d.$$(".fld-gloss-field .field-error button")].find((b) => b.textContent === "Use theirs").click();
    assert.equal(gloss.value, "espresso");
  });

  test("a stale save offers Use theirs and Keep mine", async () => {
    const d = await openDashboard();
    d.row("agua").click();
    await d.settle();
    d.backend.words.find((x) => x.native === "agua").updated_at = "2099-01-01T00:00:00.000Z";
    await d.commit(d.field("Meaning"), "water!");
    assert.match(d.text(".fld-gloss-field .field-error"), /This word just changed on another device/);
    [...d.$$(".fld-gloss-field .field-error button")].find((b) => b.textContent === "Keep mine").click();
    await d.settle();
    assert.equal(d.writes().at(-1).ops[0].if_updated_at, undefined, "Keep mine saves over theirs");
    assert.equal(d.backend.words.find((x) => x.native === "agua").gloss, "water!");
  });

  test("an error on one edit reverts the field, says why, and offers Try again", async () => {
    const d = await openDashboard();
    d.row("agua").click();
    await d.settle();
    d.backend.failWrites = { ok: false, code: "invalid_word", message: "", details: { field: "romanization", reason: "bad_romanization" } };
    const rom = d.$(".rom-field");
    await d.commit(rom, "агуа");
    assert.equal(rom.value, "");
    assert.match(d.text(".fld-rom-field .field-error"), /Use Latin letters for the romanization\. Try again/);
  });

  test("offline: the edit stays, the row says Waiting to save, and it's sent when the server is back", async () => {
    const d = await openDashboard();
    d.row("agua").click();
    await d.settle();
    d.backend.failWrites = { ok: false, code: "server_unreachable", message: "", details: { reason: "network" } };
    await d.commit(d.field("Meaning"), "water!");
    assert.equal(d.field("Meaning").value, "water!");
    assert.equal(d.row("agua").querySelector(".c-status").textContent, "Waiting to save");
    assert.match(d.row("agua").querySelector(".c-meaning").textContent, /^water!/);
    d.backend.failWrites = null;
    d.w.dispatchEvent(new d.w.Event("online"));
    await d.settle();
    assert.equal(d.backend.words.find((w) => w.native === "agua").gloss, "water!");
    assert.equal(d.row("agua").querySelector(".c-status").textContent, "");
  });

  test("Esc closes the inspector and returns focus to the list", async () => {
    const d = await openDashboard();
    d.row("café").click();
    await d.settle();
    d.key("Escape", {}, d.$("#inspector"));
    assert.equal(d.$("#inspector").hidden, true);
    assert.equal(d.doc.activeElement, d.$("#grid"));
    assert.equal(d.w.location.hash, "#words");
  });

  test("narrow screens: the inspector is a modal sheet", async () => {
    const d = await openDashboard({ width: 600 });
    d.row("café").click();
    await d.settle();
    assert.equal(d.$("#inspector").getAttribute("role"), "dialog");
    assert.equal(d.$("#inspector").getAttribute("aria-modal"), "true");
    assert.equal(d.$("#scrim").hidden, false);
    assert.equal(d.doc.activeElement, d.$("#inspector"));
  });
});

describe("delete, Undo and Recently deleted (§5, §6)", () => {
  test("Delete removes at once with an Undo toast; Undo restores", async () => {
    const d = await openDashboard();
    d.row("café").click();
    await d.settle();
    d.$(".insp-delete").click();
    await d.settle();
    assert.equal(d.row("café"), undefined);
    assert.equal(d.$("#inspector").hidden, true);
    assert.equal(d.text("#toasts .toast-text"), "Deleted café.");
    assert.equal(d.$("#toasts").getAttribute("role"), "status");
    d.$("#toasts .toast-undo").click();
    await d.settle();
    assert.equal(d.writes().at(-1).ops[0].op, "restore");
    assert.ok(d.row("café"));
  });

  test("Recently deleted lists tombstones with Restore", async () => {
    const backend = fakeBackend();
    const cafe = backend.words.find((w) => w.native === "café");
    cafe.deleted_at = new Date().toISOString();
    backend.deleted.push({ id: cafe.id, at: Date.now(), word: clone(cafe) });
    const d = await openDashboard({ backend, hash: "#words?status=deleted" });
    assert.deepEqual(d.rows().map((r) => r.querySelector(".w-native").textContent), ["café"]);
    assert.equal(d.text("#addedHead"), "Deleted");
    d.rows()[0].querySelector(".row-restore").click();
    await d.settle();
    assert.equal(cafe.deleted_at, null);
    assert.equal(d.text("#toasts .toast-text"), "Restored 1 word.");
    assert.equal(d.text(".list-empty .empty-title"), "Nothing deleted in the last 30 days.");
  });
});

describe("selection and bulk actions (§6, §12)", () => {
  test("click, Shift+click, then P pauses the range; the toast's Undo resumes them", async () => {
    const d = await openDashboard();
    const r = d.rows();
    r[0].click();
    r[2].dispatchEvent(new d.w.MouseEvent("click", { bubbles: true, shiftKey: true }));
    await d.settle();
    assert.equal(d.$("#selbar").hidden, false);
    assert.equal(d.text(".selbar-count"), "3 selected");
    assert.equal(d.rows()[1].getAttribute("aria-selected"), "true");
    d.$("#grid").focus();
    d.key("p", {}, d.$("#grid"));
    await d.settle();
    assert.equal(d.writes()[0].ops.length, 3);
    assert.ok(d.writes()[0].ops.every((o) => o.patch.status === "paused"));
    assert.equal(d.text("#toasts .toast-text"), "Paused 3 words.");
    d.$("#toasts .toast-undo").click();
    await d.settle();
    assert.ok(d.writes()[1].ops.every((o) => o.patch.status === "active"));
  });

  test("deleting 500 selected words takes one key press and Undo brings them all back", async () => {
    const d = await openDashboard({ backend: fakeBackend({ words: manyWords(500) }) });
    d.$("#grid").focus();
    d.key("a", { ctrlKey: true }, d.$("#grid"));
    assert.equal(d.text(".selbar-count"), "500 selected");
    d.key("Delete", {}, d.$("#grid"));
    await d.settle();
    assert.equal(d.writes().length, 1, "one message");
    assert.equal(d.writes()[0].ops.length, 500);
    assert.equal(d.rows().length, 0);
    assert.equal(d.text("#toasts .toast-text"), "Deleted 500 words.");
    d.key("z", { metaKey: true }, d.doc.body);
    await d.settle();
    assert.equal(d.writes()[1].ops.filter((o) => o.op === "restore").length, 500);
    assert.equal(d.$("#grid").getAttribute("aria-rowcount"), "501");
  });

  test("keyboard: arrows move the active row, Space toggles, Enter opens, M offers languages", async () => {
    const d = await openDashboard();
    const grid = d.$("#grid");
    grid.focus();
    d.key("ArrowDown", {}, grid);
    d.key("ArrowDown", {}, grid);
    assert.equal(d.doc.getElementById(grid.getAttribute("aria-activedescendant")).querySelector(".w-native").textContent, "ありがとう");
    d.key(" ", {}, grid);
    assert.equal(d.row("ありがとう").getAttribute("aria-selected"), "true");
    d.key("Enter", {}, grid);
    await d.settle();
    assert.equal(d.$(".spec-field").value, "ありがとう");
    grid.focus();
    d.key("m", {}, grid);
    const items = d.$$(".menu [role=menuitem]").map((i) => i.textContent);
    assert.ok(items.includes("Russian") && items.includes("Other language…"));
    assert.ok(!items.includes("Japanese"), "not its own language");
    d.$$(".menu [role=menuitem]").find((i) => i.textContent === "Korean").click();
    await d.settle();
    assert.deepEqual(d.writes()[0].ops[0].patch, { lang: "ko" });
  });

  test("? lists the shortcuts; N opens Add words", async () => {
    const d = await openDashboard();
    d.key("?", {}, d.doc.body);
    assert.equal(d.text(".dialog-title"), "Keyboard shortcuts");
    d.key("Escape", {}, d.$(".dialog-card button"));
    assert.equal(d.$(".dialog-card"), null);
    d.key("n", {}, d.doc.body);
    await d.settle();
    assert.equal(d.$("#addSheet").hidden, false);
    assert.equal(d.doc.activeElement, d.$("#addText"));
  });

  test("deleting a whole language from its card is the one confirmed action", async () => {
    const d = await openDashboard();
    d.$(".shelf-item:has(.shelf-card[data-lang='es']) .shelf-more").click();
    d.$$(".menu-item").find((i) => i.textContent.startsWith("Delete all")).click();
    await d.settle();
    assert.equal(d.text(".dialog-title"), "Delete all 3 Spanish words? You can undo this for 10 seconds.");
    d.$$(".dialog-card button").find((b) => b.textContent === "Delete 3 words").click();
    await d.settle();
    assert.equal(d.writes()[0].ops.length, 3);
  });
});

describe("the pronunciation refresh line (§3)", () => {
  test("running, Pause, paused with Resume, and gone when done", async () => {
    const backend = fakeBackend({ job: { state: "running", done: 40, total: 120 } });
    const d = await openDashboard({ backend });
    await d.settle();
    assert.equal(d.text("#refreshText"), "Adding pronunciations to your saved words: 40 of 120.");
    assert.equal(d.$("#refreshStatus").getAttribute("role"), "status");
    assert.equal(d.text("#refreshAction"), "Pause");
    d.$("#refreshAction").click();
    await d.settle();
    assert.equal(d.text("#refreshText"), "Adding pronunciations is paused: 40 of 120.");
    assert.equal(d.text("#refreshAction"), "Resume");
    const done = await openDashboard({ backend: fakeBackend({ job: { state: "done", done: 120, total: 120 } }) });
    await done.settle();
    assert.equal(done.$("#refreshLine").hidden, true);
  });

  test("in Spanish", async () => {
    const d = await openDashboard({ locale: "es", backend: fakeBackend({ job: { state: "running", done: 40, total: 120 } }) });
    await d.settle();
    assert.equal(d.text("#refreshText"), "Agregando la pronunciación a tus palabras guardadas: 40 de 120.");
    assert.equal(d.text("#refreshAction"), "Pausar");
  });
});

describe("live updates (§10)", () => {
  test("a word added from the popup appears without reload, marked New", async () => {
    const d = await openDashboard();
    d.backend.words.unshift({ id: "fresh-1", lang: "ru", native: "книга", romanization: "kniga", gloss: "book", forms: ["book"], base_lang: "en", status: "active", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await d.fake.chrome.storage.local.set({ wordsVersion: { at: Date.now(), by: null } });
    await sleep(300);
    await d.settle();
    assert.ok(d.row("книга"));
    assert.equal(d.row("книга").querySelector(".c-status").textContent, "New");
    assert.equal(d.text("#summary"), "24 words in 12 languages");
  });

  test("a word the filters hide is counted in a strip with Show", async () => {
    const d = await openDashboard({ hash: "#words?lang=ar" });
    d.backend.words.unshift({ id: "fresh-2", lang: "ru", native: "книга", gloss: "book", forms: ["book"], base_lang: "en", status: "active", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await d.fake.chrome.storage.local.set({ words: [{ lang: "ru", native: "книга", english: "book" }] });
    await sleep(300);
    await d.settle();
    assert.equal(d.text("#newStrip"), "1 new word isn't shown by your filters. Show");
    d.$("#newStrip .link").click();
    await d.settle();
    assert.ok(d.row("книга"));
  });

  test("its own edits don't reload the whole list", async () => {
    const d = await openDashboard();
    d.row("café").click();
    await d.settle();
    await d.commit(d.field("Meaning"), "coffee!");
    const lists = d.backend.sent.filter((m) => m.type === "words.list").length;
    await d.fake.chrome.storage.local.set({ wordsVersion: { at: Date.now(), by: d.backend.sent.find((m) => m.type === "words.write").clientId } });
    await sleep(300);
    await d.settle();
    assert.equal(d.backend.sent.filter((m) => m.type === "words.list").length, lists);
  });
});

describe("adding words (§8; 24's preview, full control)", () => {
  const kniga = { lang: "ru", native: "книга", romanization: "kniga", base_lang: "en", gloss: "book", forms: ["book"] };

  test("one word is saved after its preview, with Undo", async () => {
    const d = await openDashboard({ hash: "#add", backend: fakeBackend({ candidates: { kniga: [kniga] } }) });
    await d.type(d.$("#addText"), "kniga");
    d.$("#addForm").dispatchEvent(new d.w.Event("submit", { bubbles: true, cancelable: true }));
    await d.settle(10);
    assert.deepEqual(d.backend.sent.filter((m) => m.type.startsWith("words.")).map((m) => m.type).slice(-2), ["words.preview", "words.save"]);
    assert.equal(d.text(".add-job.is-done .add-job-text"), "Added книга kniga = book Russian");
    assert.ok(d.row("книга"));
    d.$(".add-job.is-done .btn").click();
    await d.settle();
    assert.equal(d.row("книга"), undefined);
  });

  test("four or more words wait for the learner's choice; nothing is saved before", async () => {
    const many = ["один", "два", "три", "четыре"].map((n, i) => ({ ...kniga, native: n, gloss: String(i + 1) }));
    const d = await openDashboard({ hash: "#add", backend: fakeBackend({ candidates: { "1 2 3 4": many } }) });
    await d.type(d.$("#addText"), "1 2 3 4");
    d.$("#addForm").dispatchEvent(new d.w.Event("submit", { bubbles: true, cancelable: true }));
    await d.settle(10);
    assert.equal(d.backend.sent.filter((m) => m.type === "words.save").length, 0);
    assert.equal(d.$$(".cand input").length, 4);
    d.$$(".cand input")[3].click();
    await d.settle();
    d.$$(".add-job-actions .btn-primary")[0].click();
    await d.settle(10);
    assert.equal(d.backend.sent.find((m) => m.type === "words.save").words.length, 3);
  });

  test("a word that finds nothing says so in plain words", async () => {
    const d = await openDashboard({ hash: "#add" });
    await d.type(d.$("#addText"), "qqq");
    d.$("#addForm").dispatchEvent(new d.w.Event("submit", { bubbles: true, cancelable: true }));
    await d.settle(10);
    assert.match(d.text(".add-job.is-failed"), /Couldn't find a word in “qqq”/);
  });
});

describe("settings (§9)", () => {
  test("every built section, each saving on change", async () => {
    const d = await openDashboard({ hash: "#settings" });
    assert.equal(d.$("#settingsView").hidden, false);
    assert.deepEqual(d.$$("#settingsIndex a").map((a) => a.textContent), ["Kotiko’s language", "Your Kotiko server", "Voices", "Appearance", "About"]);
    assert.equal(d.$("#accessKey").type, "password", "the key is typed here, hidden by default");
    assert.equal(d.$("#accessKey").value, "t0ken");
    d.$("#serverUrl").value = "http://127.0.0.1:5000";
    d.$("#serverUrl").dispatchEvent(new d.w.Event("input"));
    d.$("#serverUrl").dispatchEvent(new d.w.Event("change"));
    await d.settle();
    assert.equal(d.store.serverUrl, "http://127.0.0.1:5000");
    d.$("#onlineVoices").click();
    await d.settle();
    assert.equal(d.store.speech.allowOnline, true);
    [...d.$$("#themeOptions [role=radio]")].find((b) => b.textContent === "Dark").click();
    await d.settle();
    assert.equal(d.store.prefs.theme, "dark");
    d.$("#motionOptions [role=radio]").focus();
    d.key("ArrowRight", {}, d.$("#motionOptions [role=radio]"));
    await d.settle();
    assert.equal(d.store.prefs.motion, "reduce");
    assert.match(d.text("#aboutVersion"), /^Kotiko /);
  });

  test("Kotiko's language: switching to Español re-renders in Spanish without a reload", async () => {
    const d = await openDashboard({ hash: "#settings" });
    [...d.$$("#uiLangOptions [role=radio]")].find((b) => b.textContent === "Español").click();
    await d.settle(10);
    assert.deepEqual(d.fake.store.sync.ui, { uiLang: "es" });
    assert.equal(d.text("#settingsTitle"), "Ajustes");
    assert.equal(d.doc.documentElement.lang, "es");
    d.w.location.hash = "#words";
    await d.settle();
    assert.equal(d.text("#wordsTitle"), "Tus palabras");
    assert.equal(d.text("#summary"), "23 palabras en 12 idiomas");
    assert.equal(d.row("café").querySelector(".c-lang").textContent, "español");
  });

  test("the stored choice applies on open, whatever the browser's language", async () => {
    const d = await openDashboard({ locale: "es", sync: { ui: { uiLang: "en" } } });
    assert.equal(d.text("#wordsTitle"), "Your words");
  });
});

describe("interface language and accessibility (50, 27)", () => {
  test("with the browser in Spanish every string is Spanish and none is a raw key", async () => {
    const d = await openDashboard({ locale: "es", backend: fakeBackend({ job: { state: "running", done: 1, total: 2 } }) });
    d.row("спасибо").click();
    await d.settle();
    const strings = perceivable(d.doc);
    assert.ok(!strings.some((s) => /\b(dash|popup|settings|error)_[a-z_]+\b/.test(s)), strings.filter((s) => /_/.test(s)).join(" | "));
    for (const s of ["Tus palabras", "Agregar palabras", "Ajustes", "En páginas en inglés", "Significado", "Eliminar palabra", "Cambiar en las páginas"]) assert.ok(strings.includes(s), s);
    assert.equal(d.doc.documentElement.lang, "es");
  });

  test("icon-only buttons have names; nothing has a positive tabindex; the grid is a grid", async () => {
    const d = await openDashboard();
    d.row("спасибо").click();
    await d.settle();
    for (const b of d.$$("button")) {
      if (b.closest("[hidden]")) continue;
      const name = b.getAttribute("aria-label") || b.textContent.trim();
      assert.ok(name, b.outerHTML.slice(0, 120));
    }
    assert.ok(!d.$$("[tabindex]").some((n) => Number(n.getAttribute("tabindex")) > 0));
    const grid = d.$("#grid");
    assert.equal(grid.getAttribute("aria-multiselectable"), "true");
    assert.ok(d.rows().every((r) => r.getAttribute("role") === "row" && r.querySelectorAll("[role=gridcell]").length === 6));
  });

  test("word data is only ever text", async () => {
    const evil = { id: "evil", lang: "en", native: "<img src=x onerror=alert(1)>", gloss: "<b>bold</b>", forms: ["<b>bold</b>"], base_lang: "es", status: "active", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const d = await openDashboard({ backend: fakeBackend({ words: [evil] }) });
    assert.equal(d.$$("img[src=x]").length, 0);
    assert.equal(d.rows()[0].querySelector(".w-native").textContent, evil.native);
    d.rows()[0].click();
    await d.settle();
    assert.equal(d.$$("#inspector b").length, 0);
  });
});
