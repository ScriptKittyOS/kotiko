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
function fakeBackend({ words = dashboardWords(Date.now()), job = { state: "done", done: 0, total: 0 }, failList = null, candidates = {}, previews = {}, lookupStatus = null } = {}) {
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
        if (previews[msg.text]) return clone(previews[msg.text]);
        return { candidates: clone(candidates[msg.text] ?? []), rejected: [] };
      case "llmStatus":
        return lookupStatus ? clone(lookupStatus) : { error: "x", code: "server_outdated", details: { status: 404 } };
      case "words.save": {
        // 07's merge: an existing word (language, spelling, base) gains forms or stays.
        const text = (f) => (typeof f === "string" ? f : f.text);
        const results = msg.words.map((w, i) => {
          const old = b.words.find((x) => !x.deleted_at && x.lang === w.lang && x.native === w.native && (x.base_lang ?? "en") === (w.base_lang ?? "en"));
          if (old) {
            const had = new Set((old.forms ?? []).map(text));
            const add = (w.forms ?? []).filter((f) => !had.has(text(f)));
            if (!add.length) return { result: "unchanged", word: clone(old) };
            const previous = clone(old);
            old.forms = [...old.forms, ...add];
            old.updated_at = now();
            return { result: "updated", word: clone(old), previous };
          }
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

async function openDashboard({ local = CONNECTED, sync = {}, session = {}, locale = "en", hash = "", width = 1440, backend = fakeBackend() } = {}) {
  const fake = createFakeChrome({ local: { ...local }, sync, session, onSendMessage: (msg) => backend.answer(msg) });
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
  for (const rel of ["spec/spec.js", "lib/lang.js", "lib/welcome-model.js", "ui/icons.js", "lib/speak.js", "lib/word-card.js", "lib/word-search.js", "lib/dashboard-model.js", "lib/precedence.js", "lib/word-source.js", "lib/text.js", "bulk/parse.js", "bulk/sheet.js", "lib/lookup-status.js", "lib/errors.js", "lib/story.js", "dashboard.js"]) {
    runInWindow(dom, rel);
    if (rel === "lib/story.js") w.KotikoStory._setLoader(async (l) => readExt(`story/${l}.md`));
  }
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

  test("words in this browser with no AI set up: a banner that leads to Word lookups (slice 11)", async () => {
    const d = await openDashboard({ local: {}, backend: fakeBackend({ words: [] }) });
    assert.equal(d.text("#banners .banner-body"), "Word lookups aren't set up. New words need their meaning typed, or set up lookups.");
    d.$("#banners .btn").click();
    await d.settle();
    assert.equal(d.w.location.hash, "#settings/lookups");
    assert.equal(d.$("#settingsView").hidden, false);
  });

  test("not connected: a banner that leads to Connection settings", async () => {
    const d = await openDashboard({ local: { wordsHome: "server", keys: { server: false } }, backend: fakeBackend({ failList: { error: "no token", code: "server_key_rejected", details: { reason: "no_token" } } }) });
    assert.equal(d.text("#banners .banner-body"), "Connect your Kotiko server to see your words here.");
    d.$("#banners .btn").click();
    await d.settle();
    assert.equal(d.w.location.hash, "#settings/connection");
    assert.equal(d.$("#settingsView").hidden, false);
  });

  test("a rejected key blocks with Connection settings; Details copies no word data (25 §3)", async () => {
    const d = await openDashboard({ backend: fakeBackend({ failList: { error: "The server rejected that API token.", code: "server_key_rejected", details: { status: 401 } } }) });
    assert.equal(d.$("#banners .banner").dataset.severity, "blocking");
    assert.equal(d.text("#banners .banner-body"), "Your Kotiko server didn't accept the access key. Paste it again in Connection settings.");
    assert.equal(d.text("#banners .btn"), "Connection settings");
    const copied = [];
    Object.defineProperty(d.w.navigator, "clipboard", { value: { writeText: async (text) => void copied.push(text) }, configurable: true });
    d.$('#banners [data-action="copy-details"]').click();
    await d.settle();
    assert.match(copied[0], /^Kotiko 0\.0\.0-test\n.+\ncode: server_key_rejected\nThe server rejected that API token\.\nHTTP 401$/);
  });

  test("server unreachable: a calm state banner with Try again, and the list says why it's empty", async () => {
    const d = await openDashboard({ backend: fakeBackend({ failList: { error: "Can't reach", code: "server_unreachable", details: { reason: "network" } } }) });
    assert.equal(d.$("#banners .banner").dataset.severity, "state");
    assert.equal(d.text("#banners .banner-body"), "Can't reach your Kotiko server. Adding words will work once it's back.");
    assert.equal(d.text(".list-empty"), "Your words will show here when your server answers.");
    d.backend.failList = null;
    d.$("#banners .btn").click();
    await d.settle();
    assert.equal(d.$("#banners").children.length, 0, d.text("#banners"));
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
    d.$("#grid").focus();
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

  test("Esc dismisses a toast: the one focus is in, else the newest once nothing else takes Esc (27 §3)", async () => {
    const d = await openDashboard();
    d.row("café").click();
    await d.settle();
    d.$(".insp-delete").click();
    await d.settle();
    d.row("niño").click();
    await d.settle();
    d.$(".insp-delete").click();
    await d.settle();
    assert.equal(d.$$("#toasts .toast").length, 2);
    d.$("#toasts .toast:first-child .toast-undo").focus();
    d.key("Escape", {}, d.$("#toasts .toast:first-child .toast-undo"));
    await d.settle();
    assert.deepEqual(d.$$("#toasts .toast-text").map((n) => n.textContent), ["Deleted niño."], "the focused one");
    assert.equal(d.doc.activeElement, d.$("#grid"), "focus goes back to the list");
    d.key("Escape", {}, d.$("#grid"));
    await d.settle();
    assert.equal(d.$$("#toasts .toast").length, 0, "then the newest");
    assert.ok(d.row("niño") === undefined && d.row("café") === undefined, "dismissing isn't undoing");
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

  test("a failed lookup says why (slice 10's codes), and what it found nothing for", async () => {
    const soon = new Date(Date.now() + 3 * 3600_000).toISOString();
    const previews = {
      a: { error: "x", code: "quota_exhausted", details: { reason: "daily_limit", retry_at: soon, status: 429 } },
      b: { error: "x", code: "rate_limited", details: { status: 429 } },
      c: { error: "x", code: "key_rejected", details: { provider: "openrouter", status: 502 } },
      d: { error: "x", code: "lookup_not_set_up", details: { status: 503 } },
      e: { error: "x", code: "lookup_timeout", details: { status: 503 } },
      perro: { candidates: [], rejected: [{ native: "perro", base_lang: "es", reason: "same_as_gloss" }], code: "rejected_same_as_gloss" },
      zz: { candidates: [], rejected: [{ native: "zz", reason: "script_mismatch" }], code: "bad_lookup_result" },
    };
    const expected = {
      a: /^You've used today's free lookups\. Add words yourself, or try again after \d{1,2}:\d{2}/,
      b: /^Word lookup is busy\. Try again in a minute, or add the word yourself\./,
      c: /^OpenRouter didn't accept your Kotiko server's key\./,
      d: /^Word lookup isn't set up on your Kotiko server yet\. Words you type as “word = meaning” still work\./,
      e: /^That lookup took too long\. Try again, or add the word yourself\./,
      perro: /^“perro” is already a word in Spanish\./,
      zz: /^The lookup came back garbled\./,
    };
    for (const [text, re] of Object.entries(expected)) {
      const d = await openDashboard({ hash: "#add", backend: fakeBackend({ previews }) });
      await d.type(d.$("#addText"), text);
      d.$("#addForm").dispatchEvent(new d.w.Event("submit", { bubbles: true, cancelable: true }));
      await d.settle(10);
      assert.match(d.text(".add-job.is-failed .add-job-text"), re, text);
    }
  });

  test("free lookups left today: under the add box at 20 or fewer, and in settings", async () => {
    const resets = new Date(Date.now() + 3600_000).toISOString();
    const lookupStatus = (remaining) => ({ provider: "openrouter", quota: { used: 50 - remaining, limit: 50, remaining, resets_at: resets, estimated: false }, at: Date.now() });

    let d = await openDashboard({ hash: "#add", backend: fakeBackend({ lookupStatus: lookupStatus(7) }) });
    await d.settle(10);
    assert.ok(d.backend.sent.some((m) => m.type === "llmStatus"));
    assert.equal(d.$("#addQuota").hidden, false);
    assert.equal(d.text("#addQuota"), "7 free lookups left today");

    d = await openDashboard({ hash: "#add", backend: fakeBackend({ lookupStatus: lookupStatus(38) }) });
    await d.settle(10);
    assert.equal(d.$("#addQuota").hidden, true, "38 left: nothing to say");

    d = await openDashboard({ hash: "#settings", backend: fakeBackend({ lookupStatus: lookupStatus(38) }) });
    await d.settle(10);
    assert.match(d.text("#connStatus"), /38 of 50 free lookups left today\./);

    d = await openDashboard({ hash: "#add", locale: "es", backend: fakeBackend({ lookupStatus: lookupStatus(0) }) });
    await d.settle(10);
    assert.match(d.text("#addQuota"), /^No te quedan búsquedas gratis hoy\. Vuelven a las /);

    // An older server without the status route: nothing.
    d = await openDashboard({ hash: "#add" });
    await d.settle(10);
    assert.equal(d.$("#addQuota").hidden, true);
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
  test("About: the story from its single source, and Show welcome again (slice 22)", async () => {
    const d = await openDashboard({ hash: "#settings/about" });
    await d.settle();
    assert.equal(d.text("#storyTitle"), "Why Kotiko?");
    assert.equal(d.$$("#storyBody p").length, 7);
    // The story names the mascot (05 §1). legacy-name-ok
    assert.match(d.text("#storyBody"), /Our mascot is a small black kitten named Mira\./); // legacy-name-ok
    assert.ok(d.$("#storyPending").hidden);
    d.$("#showWelcome").click();
    await d.settle();
    assert.ok(d.backend.sent.some((m) => m.type === "welcome.open"));
    const es = await openDashboard({ hash: "#settings/about", locale: "es" });
    await es.settle();
    assert.equal(es.text("#storyTitle"), "¿Por qué Kotiko?");
    assert.equal(es.$("#story").lang, "es");
    assert.ok(!es.$("#storyPending").hidden, "the Spanish story says it is waiting for its final version");
    assert.equal(es.text("#showWelcome"), "Mostrar la bienvenida otra vez");
  });

  test("Learning: Celebrations, on by default, one switch (slice 32 §8)", async () => {
    const d = await openDashboard({ hash: "#settings/learning" });
    assert.equal(d.$("#celebrations").getAttribute("aria-checked"), "true");
    d.$("#celebrations").click();
    await d.settle();
    assert.equal(d.store.prefs.celebrations, false);
    assert.equal(d.$("#celebrations").getAttribute("aria-checked"), "false");
    d.$("#celebrations").click();
    await d.settle();
    assert.equal(d.store.prefs.celebrations, true);
  });

  test("Pages: sensitive sites on, buttons and menus off, and the lists to take things off (slice 16)", async () => {
    const d = await openDashboard({ hash: "#settings/pages", local: { prefs: { neverSwap: ["house"], sensitiveAllowed: ["www.chase.com"] } } });
    assert.equal(d.$("#sensitiveSites").getAttribute("aria-checked"), "true");
    assert.equal(d.$("#swapControls").getAttribute("aria-checked"), "false");
    d.$("#sensitiveSites").click();
    await d.settle();
    assert.equal(d.store.prefs.sensitiveSites, false);
    d.$("#swapControls").click();
    await d.settle();
    assert.equal(d.store.prefs.swapControls, true);
    assert.deepEqual(d.$$("#neverSwap bdi").map((b) => b.textContent), ["house"]);
    assert.equal(d.$("#sensitiveAllowedField").hidden, false);
    d.$("#neverSwap .form-remove").click();
    await d.settle();
    assert.deepEqual(d.store.prefs.neverSwap, []);
    assert.equal(d.$("#neverSwap").textContent, "None yet.");
    assert.equal(d.$("#sensitiveAllowed .form-remove").getAttribute("aria-label"), "Leave www.chase.com alone again");
    d.$("#sensitiveAllowed .form-remove").click();
    await d.settle();
    assert.deepEqual(d.store.prefs.sensitiveAllowed, []);
    assert.equal(d.$("#sensitiveAllowedField").hidden, true);
    assert.equal(d.store.prefs.swapControls, true, "the other settings are kept");
  });

  test("every built section, each saving on change", async () => {
    const d = await openDashboard({ hash: "#settings" });
    assert.equal(d.$("#settingsView").hidden, false);
    assert.deepEqual(d.$$("#settingsIndex a").map((a) => a.textContent), ["Languages you read in", "Kotiko’s language", "Word lookups", "Your Kotiko server", "Voices", "Reading", "Learning", "Your languages on a page", "Pages", "Appearance", "Your data", "About"]);
    assert.equal(d.$("#accessKey").type, "password", "the key is typed here, hidden by default");
    assert.equal(d.$("#accessKey").value, "", "a saved token is never read back (slice 11)");
    d.$("#serverUrl").value = "http://127.0.0.1:5000";
    d.$("#serverUrl").dispatchEvent(new d.w.Event("input"));
    d.$("#serverUrl").dispatchEvent(new d.w.Event("change"));
    await d.settle();
    assert.deepEqual(d.backend.sent.find((m) => m.type === "server.connect"), { type: "server.connect", url: "http://127.0.0.1:5000" });
    assert.equal(d.store.serverUrl, CONNECTED.serverUrl, "nothing new is written where content scripts read");
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

  test("Reading (27 §2, §5): what screen readers hear, swaps as Tab stops, and the voice-control warning", async () => {
    const d = await openDashboard({ hash: "#settings/reading" });
    const radios = () => d.$$("#screenReaderOptions [role=radio]");
    assert.deepEqual(radios().map((b) => [b.textContent, b.getAttribute("aria-checked")]), [["The word I'm learning", "true"], ["The original word", "false"], ["Both", "false"]]);
    assert.equal(d.$("#screenReaderOptions").getAttribute("aria-describedby"), "screenReaderHelp");
    assert.match(d.text("#screenReaderHelp"), /^The word you're learning is read in its own language's voice\./);
    radios()[1].click();
    await d.settle();
    assert.equal(d.store.prefs.screenReader, "original");
    assert.equal(d.text("#screenReaderHelp"), "Sites can read this text: the page's own word goes back into the page, hidden, next to each swapped word.");
    radios()[1].focus();
    d.key("ArrowRight", {}, radios()[1]);
    await d.settle();
    assert.equal(d.store.prefs.screenReader, "both", "arrows move and apply (27 §3)");
    assert.equal(d.$("#keyboardSwaps").getAttribute("aria-checked"), "false", "off by default");
    d.$("#keyboardSwaps").click();
    await d.settle();
    assert.equal(d.store.prefs.keyboardSwaps, true);
    assert.equal(d.$("#swapControlsWarn").hidden, true);
    d.$("#swapControls").click();
    await d.settle();
    assert.equal(d.$("#swapControlsWarn").hidden, false);
    assert.equal(d.text("#swapControlsWarn"), "Voice control commands that use button names may stop working.");
  });

  test("Kotiko's language: switching to Español re-renders in Spanish without a reload", async () => {
    const d = await openDashboard({ hash: "#settings" });
    [...d.$$("#uiLangOptions [role=radio]")].find((b) => b.textContent === "Español").click();
    await d.settle(10);
    assert.deepEqual(d.fake.store.sync.ui, { uiLang: "es" });
    // A connected server's Telegram bot follows (slice 41 §9).
    assert.ok(d.fake.calls.sendMessage.some((m) => m.type === "profile.sync"));
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

describe("Languages you read in (slice 50 §2)", () => {
  const UI = { uiLang: "auto", baseLangs: ["en", "es"], baseLangsDetected: ["en"], baseLangsConfirmed: true };
  const open = (ui = UI, opts = {}) => openDashboard({ hash: "#settings/languages", sync: { ui: { ...ui } }, ...opts });
  const baseRows = (d) => d.$$("#baseList .base-row");
  const langs = (d) => baseRows(d).map((r) => r.dataset.lang);
  const button = (d, lang, action) => d.$(`#baseList .base-row[data-lang="${lang}"] button[data-action="${action}"]`);

  test("primary first, each with its support level, the words missing a meaning, and the browser's languages as a hint", async () => {
    const d = await open();
    assert.equal(d.$$("#settingsIndex a")[0].textContent, "Languages you read in");
    assert.deepEqual(langs(d), ["en", "es"]);
    const [en, es] = baseRows(d);
    assert.equal(en.querySelector(".base-label").textContent, "English");
    assert.equal(en.querySelector(".base-primary").textContent, "main");
    assert.equal(es.querySelector(".base-primary"), null);
    assert.deepEqual(baseRows(d).map((r) => r.querySelector(".base-level").textContent), ["Full", "Full"]);
    assert.equal(es.querySelector(".base-endonym").textContent, "Español");
    assert.equal(es.querySelector(".base-endonym").lang, "es");
    // The level explains itself on focus, as the level's description.
    const level = es.querySelector(".base-level");
    assert.equal(d.doc.getElementById(level.getAttribute("aria-describedby")).textContent, "Kotiko knows this language well: careful word checks and a pronunciation guide written for its readers.");
    assert.equal(en.querySelector(".base-missing"), null, "every word has an English meaning");
    // 23 words: 犬 has a Spanish meaning and three words are Spanish themselves.
    assert.match(es.querySelector(".base-missing").textContent, /^19 words have no meaning in Spanish yet\. Type meanings$/);
    assert.equal(d.text("#basesDetected"), "From your browser: English");
    assert.equal(button(d, "en", "up").disabled, true);
    assert.equal(button(d, "es", "down").disabled, true);
    for (const b of d.$$("#baseList button[data-action]")) assert.ok(b.getAttribute("aria-label"), "icon buttons have names");
  });

  test("Add a language: a search over every language, saved at once as a Basic one", async () => {
    const d = await open();
    d.$("#addBaseLang").click();
    await d.settle();
    const input = d.$(".dialog-card input");
    assert.equal(d.text(".dialog-title"), "Add a language you read");
    assert.ok(!d.$$(".dialog-card .lang-option").some((o) => /Spanish|English/.test(o.textContent)), "languages already read aren't offered");
    await d.type(input, "pol");
    d.key("Enter", {}, input);
    await d.settle();
    assert.deepEqual(d.fake.store.sync.ui, { ...UI, baseLangs: ["en", "es", "pl"] });
    assert.deepEqual(d.store.baseLangs, ["en", "es", "pl"], "the copy content scripts read");
    assert.ok(d.fake.calls.sendMessage.some((m) => m.type === "profile.sync"), "a connected server's bot follows (slice 41 §9)");
    const pl = baseRows(d)[2];
    assert.equal(pl.querySelector(".base-level").textContent, "Basic");
    assert.equal(d.doc.getElementById(pl.querySelector(".base-level").getAttribute("aria-describedby")).textContent, "Kotiko works in Polski, with simpler word checks and no pronunciation guide yet.");
    assert.equal(pl.querySelector(".base-improve").href, "https://github.com/ScriptKittyOS/kotiko/blob/main/spec/lang/README.md");
    // Type meanings: the list of words missing one, with a chip that clears the filter.
    pl.querySelector(".base-missing button").click();
    await d.settle();
    assert.equal(d.w.location.hash, "#words?missing=pl");
    assert.equal(d.rows().length, 23);
    assert.equal(d.text('[data-filter="missing"]'), "No meaning in Polish");
    d.$('[data-filter="missing"] + .filter-clear').click();
    await d.settle();
    assert.equal(d.w.location.hash, "#words");
  });

  test("up to four; the fifth is refused with what to do", async () => {
    const d = await open({ ...UI, baseLangs: ["en", "es", "fr", "de"] });
    d.$("#addBaseLang").click();
    await d.settle();
    assert.equal(d.$(".dialog-card"), null);
    assert.equal(d.text("#basesNote"), "Kotiko can follow up to 4 languages you read. Remove one first.");
    assert.deepEqual(d.fake.store.sync.ui.baseLangs, ["en", "es", "fr", "de"]);
  });

  test("↑ and ↓ reorder, keep focus on the language, and the first becomes the primary", async () => {
    const d = await open({ ...UI, baseLangs: ["en", "es", "fr"] });
    button(d, "fr", "up").focus();
    button(d, "fr", "up").click();
    await d.settle();
    assert.deepEqual(langs(d), ["en", "fr", "es"]);
    assert.equal(d.doc.activeElement, button(d, "fr", "up"));
    button(d, "fr", "up").click();
    await d.settle();
    assert.deepEqual(langs(d), ["fr", "en", "es"]);
    assert.deepEqual(d.fake.store.sync.ui.baseLangs, ["fr", "en", "es"]);
    assert.equal(baseRows(d)[0].querySelector(".base-primary").textContent, "main");
    assert.equal(d.doc.activeElement.closest(".base-row").dataset.lang, "fr", "the disabled ↑ hands focus to a sibling");
    button(d, "en", "down").click();
    await d.settle();
    assert.deepEqual(langs(d), ["fr", "es", "en"]);
  });

  test("removing keeps the meanings, says so with Undo; the last one stays", async () => {
    const d = await open();
    button(d, "es", "remove").click();
    await d.settle();
    assert.deepEqual(d.fake.store.sync.ui.baseLangs, ["en"]);
    assert.deepEqual(d.store.baseLangs, ["en"]);
    assert.equal(d.text(".toast-text"), "Kotiko won’t swap words on pages in Spanish. Your 1 meaning is kept.");
    assert.ok(!d.backend.sent.some((m) => m.type === "words.write"), "no word is touched");
    d.$(".toast-undo").click();
    await d.settle();
    assert.deepEqual(d.fake.store.sync.ui.baseLangs, ["en", "es"]);
    button(d, "es", "remove").click();
    await d.settle();
    button(d, "en", "remove").click();
    await d.settle();
    assert.deepEqual(d.fake.store.sync.ui.baseLangs, ["en"]);
    assert.equal(d.text("#basesNote"), "Kotiko needs at least one language you read.");
  });

  test("a change from the welcome tab or another device shows at once", async () => {
    const d = await open();
    await d.fake.chrome.storage.sync.set({ ui: { ...UI, baseLangs: ["es"] } });
    await d.settle();
    assert.deepEqual(langs(d), ["es"]);
  });

  test("#settings/languages (the popup's link) shows the section with its heading focused", async () => {
    const d = await openDashboard({ hash: "#settings/languages", sync: { ui: { ...UI } } });
    assert.equal(d.$("#settingsView").hidden, false);
    assert.equal(d.doc.activeElement, d.$("#setBasesTitle"));
    assert.equal(d.$(".dialog-card"), null);
  });

  test("#settings/languages/add/pt-BR opens the picker ready to add it; Enter adds it", async () => {
    const d = await openDashboard({ hash: "#settings/languages/add/pt-BR", sync: { ui: { ...UI } } });
    await d.settle();
    const input = d.$(".dialog-card input");
    assert.ok(input.value);
    assert.equal(d.w.location.hash, "#settings/languages", "a reload doesn't open it again");
    d.key("Enter", {}, input);
    await d.settle();
    assert.deepEqual(d.fake.store.sync.ui.baseLangs, ["en", "es", "pt-BR"]);
    // A language already read opens nothing.
    const again = await openDashboard({ hash: "#settings/languages/add/es-PR", sync: { ui: { ...UI } } });
    await again.settle();
    assert.equal(again.$(".dialog-card"), null);
  });

  test("in Spanish", async () => {
    const d = await open(UI, { locale: "es" });
    assert.equal(d.text("#setBasesTitle"), "Idiomas en los que lees");
    assert.equal(baseRows(d)[0].querySelector(".base-label").textContent, "inglés");
    assert.equal(baseRows(d)[0].querySelector(".base-level").textContent, "Completo");
    assert.equal(button(d, "es", "remove").getAttribute("aria-label"), "Quitar español");
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

describe("Word lookups and the words' home (slice 11)", () => {
  const PROVIDERS = JSON.parse(readExt("spec/providers.json")).providers.map(({ id, label, baseUrl, keyRequired, keyUrl, modelSource, local, beta, free }) => ({ id, label, baseUrl, keyRequired, keyUrl, modelSource, local: !!local, beta: !!beta, free: !!free }));
  const LOCAL = { wordsHome: "local", lookup: { kind: "none", provider: "openrouter", baseUrl: null, model: null, dataCollection: "allow" }, server: { url: "http://localhost:4747" }, keys: { server: false, providers: {} } };

  // The background's settings and secrets routes, over plain state.
  function withSettings(b, settings = LOCAL, masked = {}) {
    const st = { ...clone(settings), masked: { ...masked } };
    const base = b.answer;
    b.st = st;
    b.answer = (msg) => {
      switch (msg.type) {
        case "backend.get":
          b.sent.push(clone(msg));
          return { wordsHome: st.wordsHome, lookup: clone(st.lookup), server: clone(st.server), keys: clone(st.keys), providers: PROVIDERS, bases: ["en"] };
        case "secrets.describe":
          b.sent.push(clone(msg));
          return { secrets: { ...st.masked } };
        case "backend.set":
          b.sent.push(clone(msg));
          st.lookup = { ...st.lookup, ...msg.lookup };
          return { ok: true, lookup: clone(st.lookup) };
        case "secrets.set":
          b.sent.push(clone(msg));
          st.masked[msg.id] = `${msg.value.slice(0, 6)}…${msg.value.slice(-4)}`;
          st.keys.providers[msg.id.split(":")[1]] = true;
          return { ok: true, masked: st.masked[msg.id] };
        case "secrets.remove":
          b.sent.push(clone(msg));
          delete st.masked[msg.id];
          return { ok: true };
        case "backend.test":
          b.sent.push(clone(msg));
          return { ok: true, model: "fake/model-a:free", ms: 1234, quota: { remaining: 41, limit: 50 } };
        case "migrate.preview":
          b.sent.push(clone(msg));
          return { to: msg.to, count: 23, server: st.server.url };
        case "migrate.run":
          b.sent.push(clone(msg));
          st.wordsHome = msg.to;
          return msg.to === "server" ? { ok: true, total: 23, created: 20, updated: 2, unchanged: 1 } : { ok: true, total: 23 };
        default:
          return base(msg);
      }
    };
    return b;
  }

  test("the section lists the eight presets, the server when one is connected, and Nobody; a key is pasted, saved, shown masked", async () => {
    const backend = withSettings(fakeBackend());
    const d = await openDashboard({ local: LOCAL, hash: "#settings/lookups", backend });
    const radios = () => d.$$("#providerOptions [role=radio]").map((r) => r.textContent);
    assert.deepEqual(radios(), ["OpenRouter (free)", "OpenAI", "Anthropic (beta)", "Google Gemini", "Groq", "Ollama", "LM Studio", "Another service", "Nobody: I'll type meanings myself"]);
    assert.equal(d.$('#providerOptions [aria-checked="true"]').textContent, "Nobody: I'll type meanings myself");
    assert.equal(d.text("#lookupState"), "New words need their meaning typed: gato = cat.");
    assert.ok(d.$$("#providerOptions [role=radio]").every((r) => !r.hasAttribute("lang")));
    assert.equal(d.text("#banners .banner-body"), "Word lookups aren't set up. New words need their meaning typed, or set up lookups.");

    d.$$("#providerOptions [role=radio]")[0].click();
    await d.settle();
    assert.deepEqual(backend.sent.find((m) => m.type === "backend.set"), { type: "backend.set", lookup: { kind: "provider", provider: "openrouter", baseUrl: null, model: null } });
    assert.equal(d.$("#lookupKeyField").hidden, false);
    assert.equal(d.text("#lookupKeyLabel"), "OpenRouter key");
    assert.equal(d.$("#lookupKey").type, "password");
    assert.equal(d.$("#getKey").href, "https://openrouter.ai/settings/keys");
    assert.equal(d.text("#providerNote"), "Free models by default. A key with a credit limit is the safest choice.");
    assert.equal(d.text("#lookupState"), "Paste a key to start looking words up.");
    assert.equal(d.$("#dataCollectionRow").hidden, false);

    d.$("#lookupKey").value = "sk-or-v1-abcdefghijklmnopqrstuvwxyz-a1b2";
    d.$("#saveKey").click();
    await d.settle();
    assert.deepEqual(backend.sent.find((m) => m.type === "secrets.set"), { type: "secrets.set", id: "provider:openrouter", value: "sk-or-v1-abcdefghijklmnopqrstuvwxyz-a1b2" });
    assert.equal(d.$("#lookupKey").value, "", "the page keeps nothing");
    assert.equal(d.text("#lookupKeyMasked"), "Saved key: sk-or-…a1b2");
    assert.equal(d.$("#lookupKeyEntry").hidden, true);
    assert.equal(d.text("#lookupState"), "Ready to look words up.");
    assert.equal(d.$("#banners").children.length, 0, "the banner goes once lookups work");
    assert.equal(JSON.stringify(d.store).includes("abcdefghijklmnop"), false, "never in storage");

    d.$("#testLookup").click();
    await d.settle();
    assert.equal(d.text("#lookupState"), "It works. fake/model-a:free answered in 1.2 s.");

    d.$("#replaceKey").click();
    assert.equal(d.$("#lookupKeyEntry").hidden, false);
    d.$("#removeKey").click();
    await d.settle();
    assert.deepEqual(backend.sent.find((m) => m.type === "secrets.remove"), { type: "secrets.remove", id: "provider:openrouter" });
    assert.equal(d.text("#lookupState"), "Paste a key to start looking words up.");
  });

  test("Ollama needs no key, shows its one setting and an editable address; the model is optional", async () => {
    const backend = withSettings(fakeBackend(), { ...LOCAL, lookup: { ...LOCAL.lookup, kind: "provider", provider: "ollama" } });
    const d = await openDashboard({ local: LOCAL, hash: "#settings/lookups", backend });
    assert.equal(d.$("#lookupKeyField").hidden, true);
    assert.equal(d.$("#noKeyNeeded").hidden, false);
    assert.match(d.text("#providerNote"), /OLLAMA_ORIGINS=chrome-extension:\/\/\*,moz-extension:\/\/\*/);
    assert.equal(d.$("#lookupBaseUrl").value, "http://localhost:11434/v1");
    assert.equal(d.text("#lookupState"), "Ready to look words up.");
    d.$("#lookupBaseUrl").value = "http://192.168.1.9:11434/v1";
    d.$("#lookupBaseUrl").dispatchEvent(new d.w.Event("change"));
    d.$("#lookupModel").value = "llama3.2";
    d.$("#lookupModel").dispatchEvent(new d.w.Event("change"));
    await d.settle();
    const sets = backend.sent.filter((m) => m.type === "backend.set").map((m) => m.lookup);
    assert.deepEqual(sets, [{ baseUrl: "http://192.168.1.9:11434/v1" }, { model: "llama3.2" }]);
  });

  test("moving words to a server: connecting doesn't move them; the count is shown first, then the result", async () => {
    const backend = withSettings(fakeBackend(), { ...LOCAL, keys: { server: true, providers: {} } }, { server: "tok-12…wxyz" });
    const d = await openDashboard({ local: LOCAL, hash: "#settings/connection", backend });
    assert.equal(d.text("#wordsHomeText"), "Your words are kept in this browser.");
    assert.equal(d.$("#accessKey").placeholder, "Saved: tok-12…wxyz. Type a new one to replace it.");
    d.$("#moveWords").click();
    await d.settle();
    assert.equal(d.text("#moveText"), "Upload your 23 words to http://localhost:4747? Words the server already has are merged, never doubled.");
    assert.equal(d.text("#moveConfirm"), "Upload 23 words");
    assert.equal(backend.sent.some((m) => m.type === "migrate.run"), false, "nothing moves before Confirm");
    d.$("#moveConfirm").click();
    await d.settle(10);
    assert.deepEqual(backend.sent.find((m) => m.type === "migrate.run"), { type: "migrate.run", to: "server", forget: false, serverLookups: false });
    assert.match(d.text("#toasts") ?? d.doc.body.textContent, /Done\. 20 added, 2 merged, 1 already there\./);
    assert.equal(d.text("#wordsHomeText"), "Your words are kept on your Kotiko server.");
  });

  test("copying the server's words here: the dialog says the server keeps its copy and offers to forget it", async () => {
    const backend = withSettings(fakeBackend(), { ...LOCAL, wordsHome: "server", lookup: { ...LOCAL.lookup, kind: "server" }, keys: { server: true, providers: {} } });
    const d = await openDashboard({ local: { ...CONNECTED, wordsHome: "server" }, hash: "#settings/connection", backend });
    d.$("#moveWords").click();
    await d.settle();
    assert.match(d.text("#moveText"), /^Copy your 23 words from the server into this browser\? The server keeps its copy\./);
    assert.equal(d.$("#moveForgetRow").hidden, false);
    d.$("#moveForget").checked = true;
    d.$("#moveCancel").click();
    assert.equal(d.$("#moveBox").hidden, true);
    d.$("#moveWords").click();
    await d.settle();
    d.$("#moveForget").checked = true;
    d.$("#moveConfirm").click();
    await d.settle(10);
    assert.deepEqual(backend.sent.filter((m) => m.type === "migrate.run"), [{ type: "migrate.run", to: "local", forget: true, serverLookups: false }]);
  });

  test("in Spanish, the section reads in Spanish", async () => {
    const backend = withSettings(fakeBackend(), { ...LOCAL, lookup: { ...LOCAL.lookup, kind: "provider" } });
    const d = await openDashboard({ local: LOCAL, locale: "es", hash: "#settings/lookups", backend });
    assert.equal(d.text("#setLookupsTitle"), "Búsqueda de palabras");
    assert.equal(d.text("#lookupKeyLabel"), "Clave de OpenRouter");
    assert.equal(d.$$("#providerOptions [role=radio]")[0].textContent, "OpenRouter (gratis)");
    assert.equal(d.text("#lookupState"), "Pega una clave para empezar a buscar palabras.");
  });
});

// Slice 13: bulk add, in the add sheet.
describe("bulk add (slice 13)", () => {
  const paste = async (d, text) => {
    const area = d.$("#bulkText");
    area.value = text;
    area.dispatchEvent(new d.w.Event("input"));
    await sleep(200);
    await d.settle();
  };
  const learn = async (d, name) => {
    d.$('[data-action="learning"]').click();
    await d.settle();
    const input = d.$(".lang-picker input");
    input.value = name;
    input.dispatchEvent(new d.w.Event("input"));
    input.dispatchEvent(new d.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await d.settle();
  };
  // A learner who reads English (slice 50).
  const EN = { ui: { baseLangs: ["en"], baseLangsConfirmed: true } };
  const statuses = (d) => d.$$(".bulk-table tbody tr").map((tr) => tr.dataset.status);

  test("200 lines of 'native = meaning': all ready, saved in one batch with no lookup, then a summary with Undo", async () => {
    const d = await openDashboard({ hash: "#add", sync: EN });
    await learn(d, "Spanish");
    const lines = Array.from({ length: 200 }, (_, i) => `palabra${i} = word${i}`).join("\n");
    await paste(d, lines);
    assert.equal(d.text(".bulk-counts").startsWith("200 words"), true);
    assert.equal(d.$$(".bulk-table tbody tr").length, 100, "a page at a time");
    assert.equal(d.$('[data-action="save"]').textContent, "Add 200 words");
    d.$('[data-action="save"]').click();
    await d.settle(12);
    const saves = d.backend.sent.filter((m) => m.type === "words.save");
    assert.equal(saves.length, 1);
    assert.equal(saves[0].words.length, 200);
    assert.deepEqual(Object.fromEntries(["lang", "native", "base_lang", "gloss", "origin", "source_text"].map((k) => [k, saves[0].words[0][k]])), { lang: "es", native: "palabra0", base_lang: "en", gloss: "word0", origin: "bulk", source_text: "palabra0 = word0" });
    assert.equal(d.backend.sent.filter((m) => m.type === "words.preview").length, 0, "no lookup");
    assert.match(d.text(".bulk-summary"), /^Added 200 words to Spanish\./);
    d.$('.bulk-summary [data-action="undo"]').click();
    await d.settle(12);
    const deletes = d.backend.sent.filter((m) => m.type === "words.write").flatMap((m) => m.ops).filter((o) => o.op === "delete");
    assert.equal(deletes.length, 200);
    assert.equal(d.text(".bulk-summary"), "Removed the words this list added, and put changed ones back.");
  });

  test("a Spanish reader's 'dog = perro' list and its reverse both learn dog, with perro as the meaning", async () => {
    for (const text of ["dog = perro\ncat = gato\nhouse = casa", "perro = dog\ngato = cat\ncasa = house"]) {
      const d = await openDashboard({ hash: "#add", sync: { ui: { baseLangs: ["es"], baseLangsConfirmed: true } } });
      d.w.chrome.i18n.detectLanguage = async (t) => (/perro/.test(t) ? { isReliable: true, languages: [{ language: "es", percentage: 95 }] } : { isReliable: true, languages: [{ language: "en", percentage: 95 }] });
      await learn(d, "English");
      await paste(d, text);
      const words = d.$$('.bulk-table [data-field="native"]').map((i) => i.value);
      assert.deepEqual(words, ["dog", "cat", "house"], text);
      d.$('[data-action="save"]').click();
      await d.settle(12);
      const w = d.backend.sent.find((m) => m.type === "words.save").words[0];
      assert.deepEqual([w.lang, w.native, w.gloss, w.base_lang], ["en", "dog", "perro", "es"]);
    }
  });

  test("statuses against the word list: already there, adds a meaning, duplicate, same as the meaning, a problem", async () => {
    const backend = fakeBackend({ words: [{ id: "w1", lang: "es", native: "gato", base_lang: "en", gloss: "cat", forms: [{ text: "cat", enabled: true }], status: "active", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, { id: "w2", lang: "es", native: "casa", base_lang: "en", gloss: "house", forms: [{ text: "house", enabled: true }], status: "active", created_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" }] });
    const d = await openDashboard({ hash: "#add", backend, sync: EN });
    await learn(d, "Spanish");
    await paste(d, `gato = cat\ncasa = house, home\nperro = dog\nperro = dog\nhotel = hotel\n${"x".repeat(70)} = long`);
    assert.deepEqual(statuses(d), ["known", "adds", "ready", "duplicate", "same", "problem"]);
    assert.deepEqual(d.$$(".bulk-table tbody input[type=checkbox]").map((c) => c.checked), [false, true, true, false, false, false]);
    assert.equal(d.$('.bulk-table tr[data-status="problem"] input[type=checkbox]').disabled, true);
    assert.match(d.text('.bulk-table tr[data-status="adds"] .bulk-status'), /Adds 1 meaning to your word/);
    assert.ok(d.$('.bulk-table tr[data-status="problem"] [data-action="split"]'), "too long: split into words");
    d.$('[data-action="save"]').click();
    await d.settle(12);
    assert.match(d.text(".bulk-summary"), /1 got a new meaning\./);
  });

  test("words without a meaning: looked up on request, one at a time, filling their rows", async () => {
    const backend = fakeBackend({ candidates: { mariposa: [{ lang: "es", native: "mariposa", base_lang: "en", gloss: "butterfly", forms: ["butterfly", "moth"] }], spaseeba: [{ lang: "ru", native: "спасибо", base_lang: "en", gloss: "thanks", forms: ["thanks"] }] } });
    const d = await openDashboard({ hash: "#add", backend, sync: EN });
    await learn(d, "Spanish");
    await paste(d, "zorro = fox\nmariposa\nspaseeba");
    assert.deepEqual(statuses(d), ["ready", "needs", "needs"]);
    assert.match(d.text(".bulk-footer"), /2 words need a meaning\. Look them up uses about 2 lookups/);
    d.$('[data-action="look-up"]').click();
    await d.settle(12);
    assert.deepEqual(statuses(d), ["ready", "ready", "known"], "спасибо = thanks was already in the list");
    assert.equal(d.$$('.bulk-table [data-field="gloss"]')[1].value, "butterfly, moth");
    assert.match(d.text('.bulk-table tr[data-row="2"] .bulk-status'), /Kotiko read “spaseeba” as спасибо/);
    assert.equal(d.backend.sent.filter((m) => m.type === "words.preview").length, 2, "only the rows without a meaning");
  });

  test("lookups that run out: those rows go back, with a way to save them for later as add jobs", async () => {
    const backend = fakeBackend({ previews: { a1: { error: "x", code: "quota_exhausted", details: {} }, a2: { error: "x", code: "quota_exhausted", details: {} } } });
    const d = await openDashboard({ hash: "#add", backend, sync: EN });
    await learn(d, "Spanish");
    await paste(d, "a1\na2");
    d.$('[data-action="look-up"]').click();
    await d.settle(12);
    assert.deepEqual(statuses(d), ["needs", "needs"]);
    assert.match(d.text(".bulk-notes"), /You've used today's free lookups\./);
    d.$('[data-action="later"]').click();
    await d.settle(12);
    const adds = d.backend.sent.filter((m) => m.type === "add");
    assert.deepEqual(adds.map((m) => [m.text, m.hintLang, m.baseLangs]), [["a1", "es", ["en"]], ["a2", "es", ["en"]]]);
  });

  test("a file: chosen with the button, read, and unreadable ones explained", async () => {
    const d = await openDashboard({ hash: "#add", sync: EN });
    await learn(d, "Spanish");
    assert.ok(d.$('[data-action="choose-file"]'), "a button, not only dropping");
    const sheet = d.w.document.querySelector(".bulk");
    void sheet;
    const file = (name, text) => ({ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer });
    const input = d.$('.bulk input[type="file"]');
    Object.defineProperty(input, "files", { value: [file("words.csv", "\uFEFFword,meaning\nperro,\"dog, hound\"")], configurable: true });
    input.dispatchEvent(new d.w.Event("change"));
    await sleep(50);
    await d.settle(12);
    assert.deepEqual(d.$$('.bulk-table [data-field="native"]').map((i) => i.value), ["perro"]);
    assert.equal(d.$$('.bulk-table [data-field="gloss"]')[0].value, "dog, hound");
    Object.defineProperty(input, "files", { value: [file("book.xlsx", "PK")], configurable: true });
    input.dispatchEvent(new d.w.Event("change"));
    await sleep(50);
    await d.settle(12);
    assert.match(d.text(".bulk-notes"), /Kotiko reads \.csv files\./);
  });

  test("a list pasted in the popup opens here, once", async () => {
    const d = await openDashboard({ hash: "#add", sync: EN, session: { bulkDraft: "zorro = fox\nlobo = wolf" } });
    await sleep(200);
    await d.settle();
    assert.equal(d.$("#bulkText").value, "zorro = fox\nlobo = wolf");
    assert.equal(d.$$(".bulk-table tbody tr").length, 2);
    assert.equal(d.fake.store.session.bulkDraft, undefined, "handed over, then gone");
  });

  test("Choose a language first when nothing says what the words are in", async () => {
    const d = await openDashboard({ hash: "#add", backend: fakeBackend({ words: [] }), sync: EN });
    await paste(d, "gato = cat");
    assert.equal(d.$('[data-action="save"]').textContent, "Choose a language");
    assert.equal(d.$('[data-action="save"]').disabled, true);
  });
});
