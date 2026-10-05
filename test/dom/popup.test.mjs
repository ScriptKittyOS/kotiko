// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// popup.html and popup.js (slice 20) in jsdom with a fake chrome: the states, the add and
// undo flow, the language chips, banners for coded errors (slice 25) and the interface
// language (slice 50).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { createI18n } from "../helpers/fake-i18n.mjs";
import { readExt, runInWindow, sleep } from "../helpers/load-script.mjs";
import { voiceLists } from "../helpers/speech-stub.mjs";

const HOST = "en.wikipedia.org";
const w = (id, lang, native, english, romanization = null) => ({ id, lang, language: null, native, romanization, english, forms: [english], note: null });
const WORDS = [
  w(1, "ru", "спасибо", "thanks", "spasibo"),
  w(2, "ru", "дом", "house", "dom"),
  w(3, "ru", "кошка", "cat", "koshka"),
  w(4, "ar", "شكرا", "thanks", "shukran"),
  w(5, "ar", "كتاب", "book", "kitab"),
  w(6, "ja", "犬", "dog", "inu"),
  w(7, "es", "gracias", "thanks"),
  w(8, "es", "agua", "water"),
];
const CONNECTED = { serverUrl: "http://127.0.0.1:4999", token: "t0ken", lastSync: Date.UTC(2026, 9, 1, 11, 58), syncError: null };


async function openPopup({ local = {}, session = {}, voices = null, locale = "en", tabUrl = `https://${HOST}/wiki/Cat`, permission = true, answer = () => ({ ok: true }), pageStatus = null } = {}) {
  const fake = createFakeChrome({
    local: { words: [], ...local },
    session,
    tabs: [{ id: 1, active: true, url: tabUrl }],
    onSendMessage: (msg) => answer(msg),
  });
  const requested = [];
  const opened = [];
  fake.chrome.tabs.create = async (o) => void opened.push(o.url);
  // The tab's content script answers "page-status" (slice 16), or there is none.
  const asked = [];
  fake.chrome.tabs.sendMessage = async (tabId, msg) => {
    asked.push(JSON.parse(JSON.stringify({ tabId, msg })));
    if (!pageStatus) throw new Error("Could not establish connection. Receiving end does not exist.");
    return JSON.parse(JSON.stringify(pageStatus));
  };
  fake.chrome.i18n = createI18n(locale);
  fake.chrome.permissions = {
    contains: async () => permission,
    request: async (p) => void requested.push(p),
  };
  const dom = new JSDOM(readExt("popup.html"), {
    url: "chrome-extension://fake-extension-id/popup.html",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.chrome = fake.chrome;
  // The device's voices (34), when a test gives some.
  const spoken = [];
  if (voices) {
    dom.window.speechSynthesis = { getVoices: () => voices, speak: (u) => spoken.push(u), cancel: () => {}, addEventListener: () => {} };
    dom.window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
  }
  // What the browser does for the parts the popup loads later (24: popup-more.js, the voice
  // library): runs a script it adds and says so; serves the extension's own files.
  const loadedLater = [];
  new dom.window.MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.localName !== "script" || !n.src) continue;
        const rel = n.src.replace(/^chrome-extension:\/\/[^/]+\//, "");
        loadedLater.push(rel);
        runInWindow(dom, rel);
        n.dispatchEvent(new dom.window.Event("load"));
      }
    }
  }).observe(dom.window.document.head, { childList: true });
  dom.window.fetch = async (url) => {
    const rel = String(url).replace(/^chrome-extension:\/\/[^/]+\//, "");
    try {
      return new Response(readExt(rel));
    } catch {
      return new Response("", { status: 404 });
    }
  };
  for (const rel of ["lib/i18n.js", "ui/icons.js", "lib/lookup-status.js", "popup.js"]) runInWindow(dom, rel);
  await dom.window.KotikoPopup.ready;
  const doc = dom.window.document;
  const $ = (sel) => doc.querySelector(sel);
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await fake.idle();
      await sleep(0);
    }
  };
  const text = (sel) => $(sel)?.textContent.replace(/\s+/g, " ").trim();
  const visible = (sel) => {
    for (let el = $(sel); el; el = el.parentElement) if (el.hidden) return false;
    return !!$(sel);
  };
  return { dom, win: dom.window, doc, $, fake, settle, text, visible, requested, opened, asked, store: fake.store.local, session: fake.store.session, loadedLater, spoken };
}

// Every text node and accessible name a person can perceive, for language checks.
function perceivable(doc) {
  const out = [];
  const walk = (node) => {
    if (node.nodeType === 1 && node.hidden) return;
    if (node.nodeType === 3 && node.textContent.trim()) out.push(node.textContent.trim());
    if (node.nodeType === 1) {
      for (const a of ["aria-label", "title", "placeholder"]) if (node.getAttribute(a)) out.push(node.getAttribute(a));
      if (node.tagName === "SCRIPT" || node.tagName === "STYLE" || node.tagName === "TITLE") return;
    }
    for (const c of node.childNodes) walk(c);
  };
  walk(doc.body);
  return out;
}

// The first run is done (slice 22): a word was saved somewhere, or the welcome tab skipped.
const ONBOARDED = { completedAt: Date.UTC(2026, 9, 1), skipped: true, version: 2 };

describe("states", () => {
  test("A, not onboarded (slice 22): the card invites the first word and Get started opens the welcome tab", async () => {
    const p = await openPopup({ local: { wordsHome: "local", lookup: { kind: "none", provider: "openrouter" }, onboarding: { completedAt: null, skipped: false, version: 2 } } });
    assert.ok(p.visible("#firstRun"));
    assert.equal(p.text("#firstRunTitle"), "Finish setting up Kotiko");
    assert.equal(p.text("#firstRunBody"), "Choose your first word, in any language. It takes under a minute.");
    assert.equal(p.text("#getStarted"), "Get started");
    assert.equal(p.doc.activeElement, p.$("#addText"), "the add box stays usable");
    let closed = false;
    p.win.close = () => void (closed = true);
    p.$("#getStarted").click();
    await p.settle();
    assert.deepEqual(p.fake.calls.sendMessage.filter((m) => m.type === "welcome.open"), [{ type: "welcome.open" }]);
    assert.deepEqual(p.opened, [], "the background opens or focuses the one welcome tab");
    assert.ok(closed);
    // A saved word (anywhere) or Skip for now finishes the first run: the card changes.
    await p.fake.chrome.storage.local.set({ onboarding: ONBOARDED });
    await p.settle();
    assert.equal(p.text("#firstRunTitle"), "Add your first word");
  });

  test("A, first run (slice 11: words in this browser): add the first word now, Set up lookups opens the dashboard", async () => {
    const p = await openPopup({ local: { wordsHome: "local", lookup: { kind: "none", provider: "openrouter" }, onboarding: ONBOARDED } });
    assert.ok(p.visible("#firstRun"));
    assert.equal(p.text("#firstRunTitle"), "Add your first word");
    assert.match(p.text("#firstRunBody"), /your own AI, free with OpenRouter\. Or type it with its meaning: gato = cat\.$/);
    assert.ok(!p.visible("#langSection"));
    assert.ok(!p.visible("#pageSection"));
    assert.equal(p.$("#banners").children.length, 0);
    assert.ok(p.$("#settings").hidden);
    assert.equal(p.doc.activeElement, p.$("#addText"));
    assert.equal(p.text("#getStarted"), "Set up lookups");
    p.$("#getStarted").click();
    await p.settle();
    assert.deepEqual(p.opened, ["chrome-extension://fake-extension-id/dashboard.html#settings/lookups"], "the key is typed on a full page, never here");
    assert.ok(p.$("#settings").hidden);
  });

  test("A, first run with lookups set up: the card has no button; a fresh profile counts as words in this browser", async () => {
    const p = await openPopup({ local: { wordsHome: "local", lookup: { kind: "provider", provider: "openrouter" }, keys: { server: false, providers: { openrouter: true } }, onboarding: ONBOARDED } });
    assert.equal(p.text("#firstRunTitle"), "Add your first word");
    assert.ok(!p.visible("#getStarted"));
    const fresh = await openPopup({ local: { onboarding: ONBOARDED } });
    assert.equal(fresh.text("#firstRunTitle"), "Add your first word");
    assert.equal(fresh.text("#getStarted"), "Set up lookups");
  });

  test("B, empty: the empty line and the This page section", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: [] } });
    assert.ok(p.visible("#emptyWords"));
    assert.equal(p.text("#emptyWords"), "No words yet. Type one above, in any language.");
    assert.ok(p.visible("#pageSection"));
    assert.equal(p.text("#pageTitle"), `This page · ${HOST}`);
    assert.equal(p.text("#count"), "");
  });

  test("C, normal: chips by word count with endonyms, accessible names and the footer count", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    const chips = [...p.doc.querySelectorAll("#chips .chip")];
    assert.deepEqual(chips.map((c) => c.dataset.lang), ["ru", "ar", "es", "ja"]);
    assert.deepEqual(chips.map((c) => c.querySelector(".chip-label").textContent), ["Русский", "العربية", "Español", "日本語"]);
    assert.equal(chips[0].getAttribute("aria-label"), "Russian, Русский, 3 words, shown");
    assert.equal(chips[3].getAttribute("aria-label"), "Japanese, 日本語, 1 word, shown");
    assert.equal(chips[0].getAttribute("aria-pressed"), "true");
    assert.equal(chips[1].querySelector(".chip-label").lang, "ar");
    assert.deepEqual(chips.map((c) => c.tabIndex), [0, -1, -1, -1], "one tab stop for the chip toolbar");
    assert.equal(p.text("#count"), "8 words");
    assert.ok(p.$("#pauseRow").getAttribute("aria-checked") === "false" && p.visible("#pauseRow"));
  });

  test("a word saved twice with the same spelling counts once", async () => {
    const twice = [...WORDS, { ...w(9, "ja", "犬", "perro"), base_lang: "es" }];
    const p = await openPopup({ local: { ...CONNECTED, words: twice } });
    assert.equal(p.text("#count"), "8 words");
    assert.match(p.$('#chips .chip[data-lang="ja"]').getAttribute("aria-label"), /1 word,/);
  });

  test("E, off everywhere: the switch reads Off, sections dim, a banner turns it back on", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS, enabled: false } });
    assert.equal(p.$("#enabled").getAttribute("aria-checked"), "false");
    assert.equal(p.text("#enabledText"), "Off");
    assert.equal(p.$("#main").dataset.off, "true");
    assert.match(p.text("#bannerOff"), /^Kotiko is off on all sites\./);
    p.$('#bannerOff [data-action="turn-on"]').click();
    await p.settle();
    assert.equal(p.store.enabled, true);
    assert.equal(p.$("#banners").children.length, 0);
    assert.equal(p.text("#enabledText"), "On");
  });

  test("the master switch turns Kotiko off and on", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    p.$("#enabled").click();
    await p.settle();
    assert.equal(p.store.enabled, false);
    p.$("#enabled").click();
    await p.settle();
    assert.equal(p.store.enabled, true);
  });

  test("F, paused: pause in one click, the row then says where, and Resume undoes it", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    p.$("#pauseRow").click();
    await p.settle();
    assert.deepEqual(p.store.pausedHosts, [HOST]);
    assert.ok(p.visible("#pausedRow") && !p.visible("#pauseRow"));
    assert.equal(p.text("#pausedText"), `Paused on ${HOST}`);
    assert.equal(p.doc.activeElement, p.$("#resume"));
    p.$("#resume").click();
    await p.settle();
    assert.deepEqual(p.store.pausedHosts, []);
  });

  test("G, unsupported page: a plain note instead of the site controls", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS }, tabUrl: "chrome://extensions/" });
    assert.ok(p.visible("#unsupported"));
    assert.equal(p.text("#unsupported"), "Kotiko can't run on browser pages like this one.");
    assert.ok(!p.visible("#pauseRow") && !p.visible("#pageTitle"));
    const store = await openPopup({ local: { ...CONNECTED, words: WORDS }, tabUrl: "https://chromewebstore.google.com/detail/x" });
    assert.ok(store.visible("#unsupported"));
  });

  test("I, offline: a header pill, and no outage banner while the network is down", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS, syncError: { code: "server_unreachable", message: "Can't reach", details: { reason: "network" } } } });
    assert.ok(p.visible("#bannerSync"));
    p.win.dispatchEvent(new p.win.Event("offline"));
    assert.ok(p.visible("#offline"));
    assert.equal(p.$("#banners").children.length, 0);
    p.win.dispatchEvent(new p.win.Event("online"));
    assert.ok(!p.visible("#offline"));
  });

  test("K, missing permission: a banner whose button asks the browser", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS }, permission: false });
    assert.equal(p.text("#bannerPermission .banner-body"), "Kotiko needs permission to read pages to swap words.");
    p.$('#bannerPermission [data-action="allow"]').click();
    await p.settle();
    assert.deepEqual(p.requested.map((r) => [...r.origins]), [["<all_urls>"]]);
  });
});

describe("server problems (slice 25 codes)", () => {
  const banner = async (syncError, words = WORDS, extra = {}) => {
    const p = await openPopup({ local: { ...CONNECTED, words, syncError, ...extra } });
    return { p, node: p.$("#bannerSync"), body: p.text("#bannerSync .banner-body") };
  };

  test("unreachable is a calm state that counts the words that still work", async () => {
    const { node, body } = await banner({ code: "server_unreachable", message: "Can't reach http://127.0.0.1:4999.", details: { reason: "network" } });
    assert.equal(node.dataset.severity, "state");
    assert.equal(body, "Can't reach your Kotiko server. Your 8 words still work on pages; adding new ones will work once it's back.");
    assert.ok(node.querySelector('[data-action="retry"]') && node.querySelector('[data-action="settings"]'));
    assert.match(node.querySelector("details pre").textContent, /127\.0\.0\.1:4999/);
    const empty = await banner({ code: "server_unreachable", details: {} }, []);
    assert.equal(empty.body, "Can't reach your Kotiko server. Adding words will work once it's back.");
  });

  test("a rejected key, a bad address and a non-Kotiko answer are blocking, with a way to fix them", async () => {
    const cases = [
      [{ code: "server_key_rejected", details: { status: 401 } }, "Your Kotiko server didn't accept the access key. Paste it again in Connection settings."],
      [{ code: "server_address_invalid", details: { hint: "Leave the user name out." } }, "That server address doesn't look right. Try one like http://localhost:4747."],
      [{ code: "not_kotiko_server", details: { status: 404 } }, "Something answered at that address, but it isn't a Kotiko server. Check the address."],
    ];
    for (const [err, expected] of cases) {
      const { p, node, body } = await banner(err);
      assert.equal(node.dataset.severity, "blocking", err.code);
      assert.equal(body, expected);
      node.querySelector('[data-action="settings"]').click();
      assert.ok(!p.$("#settings").hidden, `${err.code}: opens settings on request only`);
    }
  });

  test("server errors and old string errors read as something went wrong, with Try again", async () => {
    for (const err of [{ code: "internal", details: { status: 500, error: "Database is locked." } }, "The server answered 500."]) {
      const { p, node, body } = await banner(err);
      assert.equal(body, "Something went wrong in Kotiko. Try again; if it keeps happening, please report it.");
      node.querySelector('[data-action="retry"]').click();
      await p.settle();
      assert.ok(p.fake.calls.sendMessage.some((m) => m.type === "sync" && m.force));
    }
  });

  test("words in this browser with no AI set up say so, without an error, and offer Set up lookups", async () => {
    const p = await openPopup({ local: { words: WORDS, wordsHome: "local", lookup: { kind: "none" } } });
    assert.equal(p.$("#bannerLookups").dataset.severity, "info");
    assert.equal(p.text("#bannerLookups .banner-body"), "Word lookups aren't set up. Type a word with its meaning (gato = cat), or set up lookups.");
    assert.ok(p.$('#banners [data-action="setup-lookups"]'));
    const ready = await openPopup({ local: { words: WORDS, wordsHome: "local", lookup: { kind: "provider", provider: "ollama" } } });
    assert.equal(ready.$("#banners").children.length, 0, "Ollama needs no key");
  });

  test("the popup never opens settings on its own", async () => {
    const { p } = await banner({ code: "server_key_rejected", details: { status: 401 } });
    assert.ok(p.$("#settings").hidden);
    assert.ok(!p.$("#main").hidden);
  });
});

describe("adding words (D, slice 24)", () => {
  // The background in miniature: an add becomes a job in storage, finished as `outcome`
  // says; Undo, "Add it back" and a pick write their outcome on the job, as it does.
  function background(outcome = () => ({})) {
    const ref = {};
    const jobs = () => ref.p.fake.chrome.storage.local.get({ addJobs: [] }).then((s) => s.addJobs);
    const put = async (id, fn) => ref.p.fake.chrome.storage.local.set({ addJobs: (await jobs()).map((j) => (j.id === id ? fn(j) : j)) });
    const keyOf = (w) => `${w.lang}\u001f${w.native}`;
    const answer = (msg) => {
      if (msg.type === "add") {
        const r = outcome(msg);
        // Refused before it became a job (text too long).
        if (r?.refuse) return r.refuse;
        const job = { id: msg.id, text: msg.text, state: "looking_up", createdAt: Date.now(), seen: false, results: [], baseLangs: ["en"], ...r };
        queueMicrotask(async () => ref.p.fake.chrome.storage.local.set({ addJobs: [job, ...(await jobs()).filter((j) => j.id !== job.id)] }));
        return { ok: true, job: { id: msg.id, state: "queued" } };
      }
      if (msg.type === "jobs.undo" || msg.type === "jobs.redo") {
        const undo = msg.type === "jobs.undo" ? ref.undo ?? { undo: "done" } : { undo: null };
        return put(msg.id, (j) => ({ ...j, results: j.results.map((x) => (keyOf(x.word) === msg.key ? { ...x, ...undo } : x)) })).then(() => ({ ok: true }));
      }
      if (msg.type === "jobs.retry") return put(msg.id, (j) => ({ ...j, ...(ref.retry ?? {}) })).then(() => ({ ok: true }));
      return { ok: true };
    };
    return { answer, ref };
  }
  const word = (id, lang, native, gloss, extra = {}) => ({ id, lang, native, gloss, base_lang: "en", forms: [gloss], ...extra });
  const rec = (w, result = "created", extra = {}) => ({ wordId: w.id, baseLang: w.base_lang, result, word: w, previous: null, undo: null, ...extra });
  async function add(text, outcome, local = {}) {
    const bg = background(outcome);
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS, ...local }, answer: bg.answer });
    bg.ref.p = p;
    p.$("#addText").value = text;
    p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
    return { p, bg, sent: p.fake.calls.sendMessage.find((m) => m.type === "add") };
  }

  test("Enter clears and refocuses the box at once; the line follows the job to Added, with Undo and Add it back", async () => {
    const sobaka = word("01900000-0000-7000-8000-0000000000a1", "ru", "собака", "dog", { romanization: "sobaka", pronunciation: "sa-BA-ka" });
    const bg = background(() => ({}));
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS }, answer: bg.answer });
    bg.ref.p = p;
    const input = p.$("#addText");
    input.value = "sobaka";
    p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    assert.equal(input.value, "", "cleared before any answer");
    assert.equal(p.doc.activeElement, input);
    assert.match(p.text("#jobs"), /^Looking up sobaka…/);
    const sent = p.fake.calls.sendMessage.find((m) => m.type === "add");
    assert.match(sent.id, /^[0-9a-f-]{36}$/, "every add is a job with its own id, server mode included");
    await p.settle();
    const jobs = (await p.fake.chrome.storage.local.get("addJobs")).addJobs;
    await p.fake.chrome.storage.local.set({ addJobs: jobs.map((j) => ({ ...j, state: "done", results: [rec(sobaka)] })) });
    await p.settle();
    const line = p.$('#jobs [data-kind="word"]');
    assert.equal(line.querySelector(".job-text").textContent, "Added собака (sa-BA-ka) = dog · Russian", "the pronunciation, else the romanization");
    assert.equal(line.querySelector(".word").lang, "ru");
    assert.equal(line.querySelector('[data-action="undo"]').getAttribute("aria-label"), "Undo adding собака");
    line.querySelector('[data-action="undo"]').click();
    await p.settle();
    assert.deepEqual(p.fake.calls.sendMessage.find((m) => m.type === "jobs.undo"), { type: "jobs.undo", id: sent.id, key: "ru\u001fсобака" });
    assert.equal(p.text('#jobs [data-kind="word"] .job-text'), "Removed собака.");
    p.$('#jobs [data-action="redo"]').click();
    await p.settle();
    assert.ok(p.fake.calls.sendMessage.some((m) => m.type === "jobs.redo"));
    assert.match(p.text("#jobs"), /^Added собака/);
  });

  test("three adds in a row each get their line, newest first, and only three are kept", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS }, answer: (msg) => (msg.type === "add" ? new Promise(() => {}) : { ok: true }) });
    for (const text of ["uno", "dos", "tres", "cuatro"]) {
      p.$("#addText").value = text;
      p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    }
    assert.deepEqual([...p.doc.querySelectorAll("#jobs li .job-text")].map((li) => li.textContent), ["Looking up cuatro…", "Looking up tres…", "Looking up dos…"]);
  });

  test("each word in a multi-word add has its own Undo", async () => {
    const gato = word("01900000-0000-7000-8000-0000000000b1", "es", "gato", "cat");
    const perro = word("01900000-0000-7000-8000-0000000000b2", "es", "perro", "dog");
    const { p } = await add("cat and dog in spanish", () => ({ state: "done", results: [rec(gato), rec(perro)] }));
    const undos = p.doc.querySelectorAll('#jobs [data-action="undo"]');
    assert.equal(undos.length, 2);
    undos[1].click();
    await p.settle();
    assert.equal(p.fake.calls.sendMessage.find((m) => m.type === "jobs.undo").key, "es\u001fperro");
    assert.match(p.text("#jobs"), /Added gato = cat · Spanish.*Removed perro\./);
  });

  test("a word already in the list: named calmly with Open, never an Undo that could delete it", async () => {
    const spasibo = word("01900000-0000-7000-8000-0000000000c1", "ru", "спасибо", "thanks");
    const gato = word("01900000-0000-7000-8000-0000000000c2", "es", "gato", "cat");
    const { p } = await add("gato and spasibo", () => ({ state: "done", results: [rec(gato), rec(spasibo, "unchanged")] }));
    const lines = [...p.doc.querySelectorAll('#jobs [data-kind="word"]')];
    assert.equal(lines[1].querySelector(".job-text").textContent, "Already in your list: спасибо = thanks · Russian");
    assert.equal(lines[1].querySelector('[data-action="undo"]'), null);
    assert.equal(lines[1].querySelector('[data-action="open"]').getAttribute("aria-label"), "Open спасибо");
    assert.equal(p.doc.querySelectorAll('#jobs [data-action="undo"]').length, 1, "only the new word has Undo");
  });

  test("an update names the new forms; Undo puts the word back as it was", async () => {
    const before = word("01900000-0000-7000-8000-0000000000d1", "es", "casa", "house", { forms: ["house"] });
    const after = { ...before, forms: ["house", "home"], updated_at: "2026-10-05T10:00:00Z" };
    const { p } = await add("casa", () => ({ state: "done", results: [rec(after, "updated", { previous: before })] }));
    assert.equal(p.text('#jobs [data-kind="word"] .job-text'), "Updated casa = house · Spanish: new forms: home");
    p.$('#jobs [data-action="undo"]').click();
    await p.settle();
    assert.equal(p.text('#jobs [data-kind="word"] .job-text'), "Put casa back as it was.");
    assert.equal(p.$('#jobs [data-action="redo"]'), null);
  });

  test("one word for two bases is one line, perro · dog, whose Undo covers both", async () => {
    const es = word("01900000-0000-7000-8000-0000000000e1", "ja", "犬", "perro", { base_lang: "es", pronunciation: "i-nu" });
    const en = word("01900000-0000-7000-8000-0000000000e2", "ja", "犬", "dog", { base_lang: "en", pronunciation: "ee-noo" });
    const { p } = await add("犬", () => ({ state: "done", baseLangs: ["es", "en"], results: [rec(en), rec(es)] }));
    const lines = p.doc.querySelectorAll('#jobs [data-kind="word"]');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].querySelector(".job-text").textContent, "Added 犬 (i-nu) = perro · dog · Japanese", "base order; the primary base's pronunciation");
    lines[0].querySelector('[data-action="undo"]').click();
    await p.settle();
    assert.equal(p.fake.calls.sendMessage.filter((m) => m.type === "jobs.undo").length, 1);
    assert.equal(p.text('#jobs [data-kind="word"] .job-text'), "Removed 犬.");
  });

  test("a meaning missing for one base is said under the line", async () => {
    const es = word("01900000-0000-7000-8000-0000000000f1", "ja", "犬", "perro", { base_lang: "es" });
    const { p } = await add("犬", () => ({ state: "done", baseLangs: ["es", "de"], missingBases: ["de"], results: [rec(es)] }));
    assert.equal(p.text('#jobs [data-kind="missing"]'), "No meaning in German yet.");
  });

  test("four or more words: a checklist, function words unticked; Add 3 words sends exactly the ticked ones", async () => {
    const c = (native, gloss, unticked = false) => ({ lang: "es", native, gloss, base_lang: "en", unticked });
    const candidates = [c("gato", "cat"), c("sentarse", "sat"), c("estera", "mat"), c("en", "on", true), c("mi", "my", true)];
    const { p, sent } = await add("the cat sat on my mat", () => ({ state: "needs_choice", candidates }));
    assert.match(p.text('#jobs [data-kind="choose"] p'), /^Found 5 words in “the cat sat on my mat”\.$/);
    const boxes = [...p.doc.querySelectorAll('#jobs [data-kind="choose"] input[type="checkbox"]')];
    assert.deepEqual(boxes.map((b) => b.checked), [true, true, true, false, false]);
    const button = p.$('#jobs [data-action="choose"]');
    assert.equal(button.textContent, "Add 3 words");
    boxes[2].checked = false;
    boxes[2].dispatchEvent(new p.win.Event("change"));
    assert.equal(button.textContent, "Add 2 words");
    button.click();
    await p.settle();
    assert.deepEqual(p.fake.calls.sendMessage.find((m) => m.type === "jobs.choose"), { type: "jobs.choose", id: sent.id, keys: ["es\u001fgato", "es\u001fsentarse"] });
  });

  test("an Undo that fails says so and can be tried again; one refused because the word changed since says to open it", async () => {
    const gato = word("01900000-0000-7000-8000-0000000000a9", "es", "gato", "cat");
    const failing = await add("gato", () => ({ state: "done", results: [rec(gato)] }));
    failing.bg.ref.undo = { undo: "failed", undoError: { code: "server_unreachable", details: {} } };
    failing.p.$('#jobs [data-action="undo"]').click();
    await failing.p.settle();
    assert.match(failing.p.text('#jobs [data-kind="word"] p'), /^Couldn't undo: Can't reach your Kotiko server\./);
    assert.ok(failing.p.$('#jobs [data-kind="word"] [data-action="retry"]'), "the Undo stays");
    const stale = await add("gato", () => ({ state: "done", results: [rec(gato, "updated", { previous: gato })] }));
    stale.bg.ref.undo = { undo: "failed", undoError: { code: "word_conflict", details: { reason: "stale" } } };
    stale.p.$('#jobs [data-action="undo"]').click();
    await stale.p.settle();
    assert.equal(stale.p.text('#jobs [data-kind="word"] p'), "This word changed since. Open it to fix.");
    assert.ok(stale.p.$('#jobs [data-kind="word"] [data-action="open"]'));
  });

  test("failures read in plain language, with the right next step", async () => {
    const cases = [
      [{ code: "http_error", details: { status: 422 } }, /^Your Kotiko server couldn't save that word\./, "retry"],
      [{ code: "server_key_rejected", details: {} }, /^Your Kotiko server didn't accept the access key\./, "settings"],
      [{ code: "no_word_found", details: { reply: "I couldn't find a word in that." } }, /^Couldn't find a word in “zzz”\. Try the word on its own\.$/, null],
      [{ code: "rejected_same_as_gloss", details: {} }, /^“zzz” is already a word in English\. Try naming the language you want it in\.$/, null],
      [{ code: "bad_lookup_result", details: { status: 502 } }, /^The lookup came back garbled\./, "retry"],
      [{ code: "key_rejected", details: { provider: "openrouter", status: 502 } }, /^OpenRouter didn't accept your Kotiko server's key\./, null],
    ];
    for (const [error, expected, action] of cases) {
      const { p } = await add("zzz", () => ({ state: "failed", error }));
      const line = p.$('#jobs [data-kind="failed"]');
      assert.match(line?.querySelector(".job-text > p").textContent ?? p.text("#jobs"), expected, JSON.stringify(error));
      assert.ok(line.querySelector(".icon-error"), "an icon, not color alone");
      if (action) assert.ok(line.querySelector(`[data-action="${action}"]`), `${expected}: ${action}`);
      assert.doesNotMatch(line.querySelector(".job-text > p").textContent, /token|API|model/i);
    }
  });

  test("a job that waits says why: busy, out of lookups, unreachable, offline", async () => {
    const later = new Date(Date.now() + 6 * 3600_000).toISOString();
    const cases = [
      [{ code: "rate_limited", details: { retry_at: later } }, /^Waiting to look up zzz: the AI is busy\. It runs again by itself in a moment\.$/],
      [{ code: "quota_exhausted", details: { retry_at: later } }, /^Waiting to look up zzz: today's free lookups are used up\./],
      [{ code: "server_unreachable", details: {} }, /^Waiting to look up zzz: Can't reach your Kotiko server\./],
      [{ code: "offline", details: {} }, /^Waiting to look up zzz: you're offline\. It continues when you're back online\.$/],
    ];
    for (const [error, expected] of cases) {
      const { p } = await add("zzz", () => ({ state: "waiting", error }));
      assert.match(p.text('#jobs [data-kind="waiting"] p') ?? p.text("#jobs"), expected, JSON.stringify(error));
      assert.ok(p.$('#jobs [data-kind="waiting"] [data-action="cancel"]'));
    }
  });

  test("text too long is refused at once; Try again on a failed line asks the background", async () => {
    const { p } = await add("x".repeat(201), () => ({ refuse: { error: { code: "invalid_message", message: "text must be 1 to 200 characters" } } }));
    assert.match(p.text('#jobs [data-kind="failed"] p'), /^That's a lot of text for one word\./);
    p.$('#jobs [data-action="dismiss"]').click();
    assert.equal(p.doc.querySelectorAll("#jobs li").length, 0);
    const failed = await add("sobaka", () => ({ state: "failed", error: { code: "http_error", details: { status: 422 } } }));
    failed.p.$('#jobs [data-action="retry"]').click();
    await failed.p.settle();
    assert.ok(failed.p.fake.calls.sendMessage.some((m) => m.type === "jobs.retry"));
  });

  test("free lookups left today: shown at 20 or fewer, asked for on open, live", async () => {
    const resets = new Date(Date.now() + 3600_000).toISOString();
    const status = (remaining) => ({ provider: "openrouter", quota: { used: 50 - remaining, limit: 50, remaining, resets_at: resets, estimated: false }, at: Date.now() });
    const asked = [];
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS, lookupStatus: status(38) }, answer: (msg) => (asked.push(msg.type), { ok: true }) });
    await p.settle();
    assert.ok(asked.includes("llmStatus"), "the popup asks the background for a fresh status");
    assert.ok(!p.visible("#lookupsLeft"), "38 left: nothing to say");

    await p.fake.chrome.storage.local.set({ lookupStatus: status(12) });
    await p.settle();
    assert.ok(p.visible("#lookupsLeft"));
    assert.equal(p.text("#lookupsLeft"), "12 free lookups left today");

    await p.fake.chrome.storage.local.set({ lookupStatus: status(1) });
    await p.settle();
    assert.equal(p.text("#lookupsLeft"), "1 free lookup left today");

    await p.fake.chrome.storage.local.set({ lookupStatus: status(0) });
    await p.settle();
    assert.match(p.text("#lookupsLeft"), /^No free lookups left today\. They come back at \d{1,2}:\d{2}/);

    // No quota (another provider), or numbers from before the reset: nothing.
    await p.fake.chrome.storage.local.set({ lookupStatus: { provider: "localhost", quota: null } });
    await p.settle();
    assert.ok(!p.visible("#lookupsLeft"));
    const stale = status(3);
    stale.quota.resets_at = new Date(Date.now() - 1000).toISOString();
    await p.fake.chrome.storage.local.set({ lookupStatus: stale });
    await p.settle();
    assert.ok(!p.visible("#lookupsLeft"));
  });

  test("free lookups left, in Spanish; not asked for before the server is connected", async () => {
    const resets = new Date(Date.now() + 3600_000).toISOString();
    const lookupStatus = { provider: "openrouter", quota: { used: 45, limit: 50, remaining: 5, resets_at: resets, estimated: true } };
    const p = await openPopup({ locale: "es", local: { ...CONNECTED, words: WORDS, lookupStatus } });
    assert.equal(p.text("#lookupsLeft"), "Te quedan 5 búsquedas gratis hoy");

    const asked = [];
    const q = await openPopup({ local: { words: [], lookupStatus }, answer: (msg) => (asked.push(msg.type), { ok: true }) });
    await q.settle();
    assert.ok(!asked.includes("llmStatus"));
    assert.ok(!q.visible("#lookupsLeft"));
  });

});

describe("languages", () => {
  test("a chip toggles its language; ten rapid toggles end in the state of the last click", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    const chip = (lang) => p.$(`#chips .chip[data-lang="${lang}"]`);
    chip("ru").click();
    await p.settle();
    assert.deepEqual(p.store.hiddenLangs, ["ru"]);
    assert.equal(chip("ru").getAttribute("aria-pressed"), "false");
    assert.match(chip("ru").getAttribute("aria-label"), /, hidden$/);

    // Research 06 F37: rapid clicks on different chips never lose one.
    for (const lang of ["ar", "ja", "ru", "es", "ar", "ja", "es", "ar", "ru", "ja"]) chip(lang).click();
    const shown = Object.fromEntries([...p.doc.querySelectorAll("#chips .chip")].map((c) => [c.dataset.lang, c.getAttribute("aria-pressed")]));
    await p.settle();
    await sleep(20);
    await p.settle();
    const stored = new Set(p.store.hiddenLangs);
    for (const [lang, pressed] of Object.entries(shown)) assert.equal(!stored.has(lang), pressed === "true", lang);
    const after = Object.fromEntries([...p.doc.querySelectorAll("#chips .chip")].map((c) => [c.dataset.lang, c.getAttribute("aria-pressed")]));
    assert.deepEqual(after, shown, "no flicker back to an intermediate state");
  });

  test("Focus shows only one language, says so, leaves hidden languages alone, and Stop ends it (slice 18)", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS, hiddenLangs: ["ja"] } });
    p.$('#chips [data-focus-lang="ar"]').click();
    await p.settle();
    assert.deepEqual(p.store.mixing.focus, ["ar"]);
    assert.ok(p.store.mixing.focusSince);
    assert.deepEqual(p.store.hiddenLangs, ["ja"], "untouched");
    assert.equal(p.text("#focusStrip"), "Focusing on العربية · Stop");
    assert.equal(p.$('#chips .chip[data-lang="ar"]').dataset.focus, "true");
    assert.equal(p.$('#chips .chip[data-lang="es"]').getAttribute("aria-pressed"), "false");
    // A chip adds its language to Focus.
    p.$('#chips .chip[data-lang="es"]').click();
    await p.settle();
    assert.deepEqual(p.store.mixing.focus, ["ar", "es"]);
    p.$('#focusStrip [data-action="stop-focus"]').click();
    await p.settle();
    assert.equal(p.store.mixing.focus, null);
    assert.deepEqual(p.store.hiddenLangs, ["ja"], "what showed before comes back");
    assert.ok(!p.visible("#focusStrip"));
  });

  test("a language whose first word came during Focus waits, and says so", async () => {
    const since = "2026-10-01T00:00:00.000Z";
    const tr = { id: 99, lang: "tr", native: "teşekkürler", english: "thanks", forms: ["thanks"], created_at: "2026-10-02T00:00:00.000Z" };
    const p = await openPopup({ local: { ...CONNECTED, words: [...WORDS, tr], mixing: { focus: ["ar"], focusSince: since } } });
    assert.match(p.text("#focusStrip"), /Turkish is new\. It's waiting until you leave Focus\./);
  });

  test("Show all appears when some languages are hidden", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS, hiddenLangs: ["ja"] } });
    assert.ok(p.visible("#showAll"));
    p.$("#showAll").click();
    await p.settle();
    assert.deepEqual(p.store.hiddenLangs, []);
    assert.ok(!p.visible("#showAll"));
  });

  test("keyboard: arrows move between chips, Home/End jump, F focuses on the current one", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    const key = (k) => p.doc.activeElement.dispatchEvent(new p.win.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    p.$('#chips .chip[data-lang="ru"]').focus();
    key("ArrowRight");
    assert.equal(p.doc.activeElement.dataset.lang, "ar");
    assert.equal(p.doc.activeElement.tabIndex, 0);
    key("End");
    assert.equal(p.doc.activeElement.dataset.lang, "ja");
    key("ArrowRight");
    assert.equal(p.doc.activeElement.dataset.lang, "ru", "wraps around");
    key("ArrowLeft");
    key("f");
    await p.settle();
    assert.deepEqual(p.store.mixing.focus, ["ja"]);
    assert.deepEqual(p.store.hiddenLangs ?? [], [], "Focus never edits hidden languages");
  });

  test("a word list change from elsewhere updates the chips and the count", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    await p.fake.chrome.storage.local.set({ words: [...WORDS, w(70, "ko", "개", "dog", "gae")] });
    await p.settle();
    assert.ok(p.$('#chips .chip[data-lang="ko"]'));
    assert.equal(p.text("#count"), "9 words");
  });
});

describe("the dashboard (slice 21)", () => {
  test("the footer's Open your words opens the options page (the dashboard) and closes the popup", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    let opened = 0;
    p.fake.chrome.runtime.openOptionsPage = async () => void opened++;
    let closed = 0;
    p.win.close = () => void closed++;
    assert.equal(p.text("#openDashboard"), "Open your words");
    p.$("#openDashboard").click();
    await p.settle();
    assert.equal(opened, 1);
    assert.equal(closed, 1);
  });
});

describe("keyboard and focus (20 §4)", () => {
  test("the add box comes first in the tab order and the header last", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    const order = [...p.doc.querySelectorAll("#main button, #main input")].filter((el) => el.tabIndex >= 0 && !el.closest("[hidden]"));
    assert.equal(order[0].id, "addText");
    assert.deepEqual(order.slice(-2).map((el) => el.id), ["enabled", "openSettings"]);
    assert.ok(order.findIndex((el) => el.classList.contains("chip")) < order.findIndex((el) => el.id === "pauseRow"));
  });

  test("/ returns to the add box; ↓ in the add box reaches the newest line's first action", async () => {
    const done = { id: "01900000-0000-7000-8000-000000000080", text: "sobaka", state: "done", createdAt: Date.now(), seen: false, baseLangs: ["en"], results: [{ wordId: "w-80", result: "created", word: { id: "w-80", lang: "ru", native: "собака", gloss: "dog", base_lang: "en" } }] };
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS, addJobs: [done] } });
    p.$("#addText").focus();
    p.$("#addText").dispatchEvent(new p.win.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    assert.equal(p.doc.activeElement.dataset.action, "undo");
    p.doc.activeElement.dispatchEvent(new p.win.KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
    assert.equal(p.doc.activeElement, p.$("#addText"));
  });

  test("icon-only buttons have names; nothing has a positive tabindex", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    for (const b of p.doc.querySelectorAll("button")) {
      const name = b.getAttribute("aria-label") || b.textContent.trim();
      assert.ok(name, b.outerHTML.slice(0, 80));
    }
    assert.equal(p.doc.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])').length, 0);
    for (const svg of p.doc.querySelectorAll("svg")) assert.equal(svg.getAttribute("aria-hidden"), "true");
  });
});

describe("settings (Connection, until the dashboard)", () => {
  test("opens on request with the stored address, sends address and token to the background, never reads the token back", async () => {
    const SERVER = { wordsHome: "server", lookup: { kind: "server" }, server: { url: "http://127.0.0.1:4999" }, keys: { server: true, providers: {} }, lastSync: CONNECTED.lastSync, syncError: null };
    const p = await openPopup({
      local: { ...SERVER, words: WORDS },
      answer: (msg) => (msg.type === "secrets.describe" ? { secrets: { server: "t0ken-…wxyz" } } : { ok: true }),
    });
    p.$("#openSettings").click();
    await p.settle();
    assert.ok(!p.$("#settings").hidden && p.$("#main").hidden);
    assert.equal(p.$("#serverUrl").value, "http://127.0.0.1:4999");
    assert.equal(p.$("#accessKey").value, "", "the token isn't in any page");
    assert.equal(p.$("#accessKey").placeholder, "Saved: t0ken-…wxyz. Type a new one to replace it.");
    assert.equal(p.$("#accessKey").type, "password");
    p.$("#toggleKey").click();
    assert.equal(p.$("#accessKey").type, "text");
    assert.equal(p.text("#connStatus").split(".")[0], "Connected");

    p.$("#serverUrl").value = "http://192.168.1.5:4747";
    p.$("#serverUrl").dispatchEvent(new p.win.Event("input"));
    p.$("#accessKey").focus();
    // A sync landing mid-edit doesn't overwrite fields (research 06 F16).
    await p.fake.chrome.storage.local.set({ server: { url: "http://elsewhere:1" } });
    await p.settle();
    assert.equal(p.$("#serverUrl").value, "http://192.168.1.5:4747");

    p.$("#accessKey").value = "  new-key ";
    p.$("#connForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
    assert.deepEqual(p.fake.calls.sendMessage.find((m) => m.type === "server.connect"), { type: "server.connect", url: "http://192.168.1.5:4747", token: "new-key" });
    assert.equal(p.store.token, undefined, "nothing is written where content scripts read");
    assert.equal(p.$("#accessKey").value, "");

    p.$("#closeSettings").click();
    assert.ok(p.$("#settings").hidden && !p.$("#main").hidden);
    assert.equal(p.doc.activeElement, p.$("#openSettings"));
  });

  test("connecting a server while words live in this browser opens the dashboard to move them first", async () => {
    const p = await openPopup({ local: { words: WORDS, wordsHome: "local" }, answer: (msg) => (msg.type === "server.connect" ? { ok: true, wordsHome: "local", needsSwitch: true, count: 8 } : { ok: true }) });
    p.$("#openSettings").click();
    p.$("#serverUrl").value = "http://192.168.1.5:4747";
    p.$("#accessKey").value = "k";
    p.$("#connForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
    assert.deepEqual(p.opened, ["chrome-extension://fake-extension-id/dashboard.html#settings/connection"]);
  });

  test("shows the server's problem in plain words, without a link to itself", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: [], syncError: { code: "server_address_invalid", message: "Leave the user name and password out of the address.", details: {} } } });
    p.$("#openSettings").click();
    assert.equal(p.text("#connStatus .banner-body"), "That server address doesn't look right. Try one like http://localhost:4747.");
    assert.equal(p.$('#connStatus [data-action="settings"]'), null);
    assert.match(p.text("#connStatus details pre"), /user name and password/);
  });
});

describe("interface language (slice 50)", () => {
  test("with the browser in Spanish, every string is Spanish and none is a raw key", async () => {
    const p = await openPopup({ locale: "es", local: { ...CONNECTED, words: WORDS, syncError: { code: "server_unreachable", details: {} } } });
    assert.equal(p.doc.documentElement.lang, "es");
    assert.equal(p.text("#langTitle"), "Idiomas");
    assert.equal(p.text("#pageTitle"), `Esta página · ${HOST}`);
    assert.equal(p.$("#addText").placeholder, "Agrega una palabra, en cualquier idioma");
    assert.equal(p.$('#chips .chip[data-lang="ja"]').getAttribute("aria-label"), "japonés, 日本語, 1 palabra, visible");
    assert.equal(p.text("#count"), "8 palabras");
    assert.match(p.text("#bannerSync .banner-body"), /^No se puede contactar tu servidor de Kotiko\. Tus 8 palabras siguen funcionando/);
    for (const s of perceivable(p.doc)) {
      assert.doesNotMatch(s, /^[a-z]+(_[a-z]+)+$/, `raw key shown: ${s}`);
      assert.doesNotMatch(s, /\b(Add|Languages|This page|Pause|Settings|words?|Show)\b/, `English left in: ${s}`);
    }
  });

  test("no visible string says sync, token or known", async () => {
    for (const local of [{}, { ...CONNECTED, words: WORDS }, { ...CONNECTED, words: WORDS, syncError: { code: "server_key_rejected", details: { status: 401 } } }]) {
      const p = await openPopup({ local });
      for (const s of perceivable(p.doc)) assert.doesNotMatch(s, /sync|token|known/i, s);
    }
  });
});

// Slice 24 §6-§9: the word's language, the languages read, the draft, saying it.
describe("the add box's language controls (24 §6-§9)", () => {
  const BOTH = { ...CONNECTED, words: WORDS, baseLangs: ["es", "en"] };
  const submitText = (p, text) => {
    p.$("#addText").value = text;
    p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
  };
  const lastAdd = (p) => p.fake.calls.sendMessage.filter((m) => m.type === "add").at(-1);

  test("the hint: Auto, the learner's languages, Other; the pick goes with the next add and lasts the session", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    const sel = p.$("#hintLang");
    const options = [...sel.options].map((o) => [o.value, o.textContent]);
    assert.deepEqual(options[0], ["", "Auto"]);
    assert.deepEqual(options.at(-1), ["*", "Other language…"]);
    assert.ok(options.some(([v, name]) => v === "ar" && name === "Arabic"), "the learner's languages between");
    sel.value = "ar";
    sel.dispatchEvent(new p.win.Event("change"));
    await p.settle();
    submitText(p, "shukran");
    assert.equal(lastAdd(p).hintLang, "ar");
    assert.equal(p.session.addHint, "ar");
  });

  test("reopened in the same session: the hint and the half-typed word are back", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS }, session: { addHint: "ar", addDraft: "shuk" } });
    assert.equal(p.$("#hintLang").value, "ar");
    assert.equal(p.$("#addText").value, "shuk");
  });

  test("Focus on one language shows it in place of Auto", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS, mixing: { focus: ["ja"] } } });
    assert.equal(p.$("#hintLang").options[0].textContent, "Japanese");
  });

  test("For pages in: shown with two languages read, all ticked; unticking narrows the next add only; one stays ticked", async () => {
    const one = await openPopup({ local: { ...CONNECTED, words: WORDS, baseLangs: ["en"] } });
    assert.equal(one.visible("#pagesIn"), false);
    const p = await openPopup({ local: BOTH });
    const boxes = () => [...p.doc.querySelectorAll("#pagesIn input")];
    assert.deepEqual(boxes().map((b) => [b.value, b.checked]), [["es", true], ["en", true]]);
    assert.deepEqual([...p.doc.querySelectorAll("#pagesIn label")].map((l) => l.textContent), ["Spanish", "English"]);
    boxes()[1].checked = false;
    boxes()[1].dispatchEvent(new p.win.Event("change"));
    assert.equal(boxes()[0].disabled, true, "the last one can't be unticked");
    submitText(p, "inu");
    assert.deepEqual(lastAdd(p).baseLangs, ["es"]);
    assert.deepEqual(boxes().map((b) => b.checked), [true, true], "back to all after the add");
    submitText(p, "neko");
    assert.equal(lastAdd(p).baseLangs, undefined, "all: the background's default");
  });

  test("the draft is kept for the session 300 ms after typing stops, and cleared by an add", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    p.$("#addText").value = "sob";
    p.$("#addText").dispatchEvent(new p.win.Event("input"));
    await sleep(350);
    await p.settle();
    assert.equal(p.session.addDraft, "sob");
    submitText(p, "sobaka");
    await sleep(20);
    await p.settle();
    assert.equal(p.session.addDraft, "");
  });

  const created = (extra = {}) => ({
    id: "01900000-0000-7000-8000-0000000000c9",
    text: "gato",
    state: "done",
    createdAt: Date.now(),
    seen: false,
    baseLangs: ["en"],
    results: [{ wordId: "w-9", result: "created", word: { id: "w-9", lang: "es", native: "gato", gloss: "cat", base_lang: "en" } }],
    ...extra,
  });

  test("the language chip on a saved word: two clicks re-add it in another language; the picker loads on first use", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS, addJobs: [created()] } });
    const chip = p.$('#jobs [data-action="relang"]');
    assert.equal(chip.textContent, "Spanish");
    assert.equal(chip.getAttribute("aria-label"), "gato is in Spanish. Choose another language");
    assert.equal(p.loadedLater.includes("popup-more.js"), false, "not loaded with the popup");
    chip.click();
    await p.settle();
    assert.ok(p.loadedLater.includes("popup-more.js"));
    const search = p.$(".picker input[type=search]");
    search.value = "ital";
    search.dispatchEvent(new p.win.Event("input"));
    for (let i = 0; i < 20 && !p.$('.picker [data-lang="it"]'); i++) await sleep(10);
    p.$('.picker [data-lang="it"]').click();
    await p.settle();
    assert.deepEqual(p.fake.calls.sendMessage.find((m) => m.type === "jobs.relang"), { type: "jobs.relang", id: created().id, key: "es\u001fgato", lang: "it" });
    assert.equal(p.$(".picker"), null, "closed");
  });

  test("a job re-added in another language gives way to the new one", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS, addJobs: [created({ replacedBy: "x" })] } });
    assert.equal(p.$('#jobs [data-kind="word"]'), null);
  });

  test("Add it yourself: the form in the line, prefilled; it checks the fields, then saves without a lookup", async () => {
    const waiting = { id: "01900000-0000-7000-8000-0000000000d9", text: "gatto", state: "waiting", createdAt: Date.now(), seen: false, baseLangs: ["es", "en"], error: { code: "lookup_not_set_up", details: {} }, results: [] };
    const p = await openPopup({ local: { ...BOTH, addJobs: [waiting] }, answer: () => ({ ok: true }) });
    p.$('#jobs [data-action="manual"]').click();
    await p.settle();
    const form = p.$("#jobs form.manual-form");
    assert.ok(form);
    assert.equal(form.querySelector('[name="native"]').value, "gatto");
    assert.deepEqual([...form.querySelectorAll(".field-label")].map((l) => l.textContent).slice(0, 4), ["Word", "Meaning in Spanish", "Meaning in English", "Language"]);
    form.dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
    assert.equal(form.querySelector(".manual-error").textContent, "Type its meaning in Spanish.");
    form.querySelector('[name="meaning-es"]').value = "gato";
    form.dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
    assert.equal(form.querySelector(".manual-error").textContent, "Choose the word's language.");
    form.querySelector('[data-action="language"]').click();
    await p.settle();
    const search = p.$(".picker input[type=search]");
    search.value = "spanish";
    search.dispatchEvent(new p.win.Event("input"));
    for (let i = 0; i < 20 && !p.$('.picker [data-lang="es"]'); i++) await sleep(10);
    p.$('.picker [data-lang="es"]').click();
    await p.settle();
    form.dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
    assert.equal(form.querySelector(".manual-error").textContent, "A word can't be in Spanish, the language of its meaning.");
    form.querySelector('[data-action="language"]').click();
    await p.settle();
    p.$(".picker input[type=search]").value = "italian";
    p.$(".picker input[type=search]").dispatchEvent(new p.win.Event("input"));
    for (let i = 0; i < 20 && !p.$('.picker [data-lang="it"]'); i++) await sleep(10);
    p.$('.picker [data-lang="it"]').click();
    await p.settle();
    form.querySelector('[name="meaning-en"]').value = "cat, kitty";
    form.dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
    const sent = p.fake.calls.sendMessage.find((m) => m.type === "jobs.addManual");
    assert.deepEqual({ ...sent, id: undefined }, { type: "jobs.addManual", id: undefined, surface: "popup", native: "gatto", lang: "it", meanings: [{ base_lang: "es", gloss: "gato" }, { base_lang: "en", gloss: "cat, kitty" }], romanization: null, pronunciation: null, note: null });
    assert.ok(p.fake.calls.sendMessage.some((m) => m.type === "jobs.cancel" && m.id === waiting.id), "the waiting lookup gives way");
  });

  test("a word spelled like its meaning asks once before saving", async () => {
    const failed = { id: "01900000-0000-7000-8000-0000000000e9", text: "hotel", state: "failed", createdAt: Date.now(), seen: false, baseLangs: ["en"], error: { code: "no_word_found", details: {} }, results: [] };
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS, addJobs: [failed] }, answer: () => ({ ok: true }) });
    p.$('#jobs [data-action="manual"]').click();
    await p.settle();
    const form = p.$("#jobs form.manual-form");
    form.querySelector('[name="meaning-en"]').value = "hotel";
    form.querySelector('[data-action="language"]').click();
    await p.settle();
    p.$(".picker input[type=search]").value = "fr";
    p.$(".picker input[type=search]").dispatchEvent(new p.win.Event("input"));
    for (let i = 0; i < 20 && !p.$('.picker [data-lang="fr"]'); i++) await sleep(10);
    p.$('.picker [data-lang="fr"]').click();
    await p.settle();
    form.dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
    assert.equal(form.querySelector(".manual-error").textContent, "This is spelled the same as the English word. Save anyway?");
    assert.equal(p.fake.calls.sendMessage.some((m) => m.type === "jobs.addManual"), false);
    form.dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
    assert.equal(p.fake.calls.sendMessage.some((m) => m.type === "jobs.addManual"), true);
  });

  test("a saved word gets a speak button when the device has a voice for it, and says the stored word", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS, addJobs: [created()] }, voices: voiceLists().macos });
    for (let i = 0; i < 40 && !p.$('#jobs [data-action="speak"]'); i++) await sleep(10);
    const speak = p.$('#jobs [data-action="speak"]');
    assert.equal(speak.getAttribute("aria-label"), "Hear gato in Spanish");
    speak.click();
    for (let i = 0; i < 40 && !p.spoken.length; i++) await sleep(10);
    assert.equal(p.spoken[0].text, "gato");
    const none = await openPopup({ local: { ...CONNECTED, words: WORDS, addJobs: [created()] }, voices: [] });
    await sleep(60);
    await none.settle();
    assert.equal(none.$('#jobs [data-action="speak"]'), null, "no voice, no button");
  });

  test("the voice library loads after the first frame, not with the popup", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    await sleep(60);
    await p.settle();
    assert.ok(p.loadedLater.includes("lib/speak.js"));
  });
});

describe("a pasted list (13 §1)", () => {
  test("two lines or more open bulk add, the list kept whole for the session", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    const paste = (text) => {
      const e = new p.win.Event("paste", { bubbles: true, cancelable: true });
      e.clipboardData = { getData: () => text };
      p.$("#addText").dispatchEvent(e);
      return e;
    };
    assert.equal(paste("gato").defaultPrevented, false, "one word: an ordinary paste");
    assert.equal(p.visible("#bulkOffer"), false);
    assert.equal(paste("gato = cat\nperro = dog").defaultPrevented, true);
    await p.settle();
    assert.equal(p.session.bulkDraft, "gato = cat\nperro = dog");
    p.$("#openBulk").click();
    await p.settle();
    assert.deepEqual(p.opened, ["chrome-extension://fake-extension-id/dashboard.html#add"]);
  });
});

describe("size (20 §8)", () => {
  // §8's goal is a first paint within 100 ms on a mid-range device, measured in
  // test/e2e/popup.spec.mjs. The popup starts from scratch on every open, so what it loads
  // up front is held to a cap, and parts the first view doesn't need load later or on first
  // use. The caps are a backstop for the measured goal, set from what the files weigh with
  // some room: 2026-10-05, after slice 24's language controls, own files 73 KB, everything
  // loaded at open 120 KB, the parts loaded later 10 KB (popup-more) and 11 KB (voices).
  const size = (files) => files.reduce((n, f) => n + Buffer.byteLength(readExt(f)), 0);
  const html = readExt("popup.html");
  const atOpen = [...html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g)].map((m) => m[1]);

  test("what loads at open: the popup's own JS and CSS under 80 KB, everything under 128 KB", () => {
    assert.ok(size(["popup.js", "popup.css"]) < 80 * 1024, `popup.js + popup.css: ${size(["popup.js", "popup.css"])} bytes`);
    assert.ok(size(atOpen) < 128 * 1024, `everything at open: ${size(atOpen)} bytes (${atOpen.join(", ")})`);
  });

  test("what loads later stays out of the first view, and small", () => {
    for (const later of ["popup-more.js", "popup-more.css", "lib/speak.js"]) assert.ok(!atOpen.includes(later), `${later} is loaded at open`);
    assert.ok(size(["popup-more.js", "popup-more.css"]) < 32 * 1024, `popup-more: ${size(["popup-more.js", "popup-more.css"])} bytes`);
  });
});

describe("words in this browser (slice 11): adds are background jobs", () => {
  const LOCAL = { wordsHome: "local", lookup: { kind: "provider", provider: "openrouter" }, keys: { server: false, providers: { openrouter: true } } };
  const job = (id, state, extra = {}) => ({ id, text: "shukran", state, createdAt: Date.now(), seen: false, results: [], ...extra });
  const shukran = { id: "w-1", lang: "ar", native: "شكرا", gloss: "thanks", base_lang: "en", romanization: "shukran" };

  test("Enter sends the job with its own id, clears the box at once, and the line follows addJobs in storage", async () => {
    const p = await openPopup({ local: { ...LOCAL, words: WORDS } });
    p.$("#addText").value = "shukran";
    p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    assert.equal(p.$("#addText").value, "");
    assert.equal(p.text("#jobs .job-text"), "Looking up shukran…");
    assert.ok(p.$('#jobs [data-action="cancel"]'), "a lookup can be cancelled");
    assert.equal(p.$("#addBtn").disabled, false, "never disabled");
    const sent = p.fake.calls.sendMessage.find((m) => m.type === "add");
    assert.match(sent.id, /^[0-9a-f-]{36}$/);
    assert.equal(sent.text, "shukran");
    await p.fake.chrome.storage.local.set({ addJobs: [job(sent.id, "looking_up")] });
    await p.settle();
    assert.equal(p.text("#jobs .job-text"), "Looking up shukran…");
    await p.fake.chrome.storage.local.set({ addJobs: [job(sent.id, "done", { results: [{ wordId: "w-1", result: "created", word: shukran, undo: null }] })] });
    await p.settle();
    assert.match(p.text("#jobs"), /^Added شكرا \(shukran\) = thanks · Arabic\s*Undo$/);
    p.$('#jobs [data-action="undo"]').click();
    await p.settle();
    assert.deepEqual(p.fake.calls.sendMessage.find((m) => m.type === "jobs.undo"), { type: "jobs.undo", id: sent.id, key: "ar\u001fشكرا" });
  });

  test("a waiting job says why and offers the next step; with no AI set up, Set up lookups", async () => {
    const retry = new Date(Date.now() + 3_600_000).toISOString();
    const p = await openPopup({
      local: {
        ...LOCAL,
        words: WORDS,
        addJobs: [
          job("01900000-0000-7000-8000-000000000001", "waiting", { text: "kniga", error: { code: "quota_exhausted", details: { retry_at: retry } }, createdAt: Date.now() - 10 }),
          job("01900000-0000-7000-8000-000000000002", "waiting", { text: "sobaka", error: { code: "lookup_not_set_up", details: {} } }),
        ],
      },
    });
    const lines = [...p.doc.querySelectorAll('#jobs [data-kind="waiting"]')];
    assert.equal(lines.length, 2);
    assert.equal(lines[0].querySelector("p").textContent, "sobaka will be looked up once lookups are set up.");
    assert.ok(lines[0].querySelector('[data-action="setup-lookups"]'));
    assert.match(lines[1].querySelector("p").textContent, /^Waiting to look up kniga: today's free lookups are used up\. It runs by itself at \d/);
    lines[1].querySelector('[data-action="cancel"]').click();
    await p.settle();
    assert.deepEqual(p.fake.calls.sendMessage.find((m) => m.type === "jobs.cancel"), { type: "jobs.cancel", id: "01900000-0000-7000-8000-000000000001" });
  });

  test("a job that finished while the popup was closed shows on open, and counts as seen", async () => {
    const id = "01900000-0000-7000-8000-000000000003";
    const p = await openPopup({ local: { ...LOCAL, words: WORDS, addJobs: [job(id, "done", { results: [{ wordId: "w-1", result: "created", word: shukran }] }), job("old", "done", { seen: true, text: "old", results: [{ wordId: "w-2", result: "created", word: { ...shukran, id: "w-2", native: "قديم" } }] })] } });
    assert.match(p.text("#jobs"), /^While you were awayAdded شكرا/, "finished with the popup closed: says so (24 §9)");
    assert.doesNotMatch(p.text("#jobs"), /قديم/, "seen before: not shown again");
    assert.deepEqual(p.fake.calls.sendMessage.find((m) => m.type === "jobs.seen"), { type: "jobs.seen", ids: [id] });
  });

  test("a failed lookup with the learner's own key reads as such and leads to the settings", async () => {
    const p = await openPopup({ local: { ...LOCAL, words: WORDS, addJobs: [job("01900000-0000-7000-8000-000000000004", "failed", { error: { code: "key_rejected", details: { provider: "openrouter" } } })] } });
    assert.equal(p.text('#jobs [data-kind="failed"] .job-text > p'), "OpenRouter didn't accept your key. Check it in Settings.");
    assert.ok(p.$('#jobs [data-action="setup-lookups"]'));
    p.$('#jobs [data-action="dismiss"]').click();
    await p.settle();
    assert.equal(p.$("#jobs").children.length, 0);
    assert.ok(p.fake.calls.sendMessage.some((m) => m.type === "jobs.dismiss"));
  });

  test("the free lookups left come from the learner's own provider", async () => {
    const p = await openPopup({ local: { ...LOCAL, words: WORDS, lookupStatus: { provider: "openrouter", quota: { remaining: 4, limit: 50, resets_at: new Date(Date.now() + 3_600_000).toISOString() } } } });
    assert.equal(p.text("#lookupsLeft"), "4 free lookups left today");
    assert.ok(p.fake.calls.sendMessage.some((m) => m.type === "llmStatus"));
  });
});

// Slice 20 states H and H2: what the tab's content script made of the page (16).
describe("the page's language", () => {
  test("a page in a language the learner doesn't read says so, with a way to add it", async () => {
    const p = await openPopup({ local: { words: WORDS }, pageStatus: { base: null, reason: "declared_other", lang: "de", words: 0 } });
    await p.settle();
    assert.deepEqual(p.asked, [{ tabId: 1, msg: { type: "page-status" } }]);
    assert.ok(p.visible("#pageLang"));
    assert.equal(p.text("#pageLangText"), "This page is in German, which isn't one of your languages. Kotiko leaves it alone. I read German too");
    assert.equal(p.text("#readToo"), "I read German too");
    p.$("#readToo").click();
    await p.settle();
    assert.deepEqual(p.opened, ["chrome-extension://fake-extension-id/dashboard.html#settings/languages"]);
  });

  test("in Spanish, the language is named in Spanish", async () => {
    const p = await openPopup({ locale: "es", local: { words: WORDS }, pageStatus: { base: null, reason: "detected_other", lang: "de", words: 0 } });
    await p.settle();
    assert.equal(p.text("#pageLangText"), "Esta página está en alemán, que no es uno de tus idiomas. Kotiko no la toca. También leo alemán");
    assert.equal(p.text("#readToo"), "También leo alemán");
  });

  test("a page in one of the learner's languages with no word for it yet", async () => {
    const p = await openPopup({ local: { words: WORDS }, pageStatus: { base: "fr", reason: "declared", lang: "fr", words: 0 } });
    await p.settle();
    assert.equal(p.text("#pageLangText"), "No words have meanings in French yet.");
    assert.ok(!p.visible("#readToo"));
  });

  test("a page that kept undoing Kotiko's changes (slice 15)", async () => {
    const p = await openPopup({ local: { words: WORDS }, pageStatus: { base: "en", reason: "declared", lang: "en", words: 4, stoodDown: true } });
    await p.settle();
    assert.equal(p.text("#pageLangText"), "Kotiko stepped back on this page because the page kept undoing its changes.");
  });

  test("a sensitive site: why, and a way to run there anyway (slice 16 §4)", async () => {
    const p = await openPopup({ local: { words: WORDS, prefs: { theme: "dark" } }, pageStatus: { base: "en", reason: "declared", lang: "en", words: 4, sensitive: "banking" } });
    await p.settle();
    assert.equal(p.text("#pageLangText"), "This looks like a bank's site, so Kotiko leaves it alone. Swap words here anyway");
    p.$("#runSensitive").click();
    await p.settle();
    assert.deepEqual(p.store.prefs, { theme: "dark", sensitiveAllowed: [HOST] });
    assert.equal(p.$("#pageLang").hidden, true);
  });

  test("nothing when the page is in their language, unknown, paused, or there is no content script", async () => {
    for (const [pageStatus, local] of [
      [{ base: "en", reason: "declared", lang: "en", words: 12 }, {}],
      [{ base: null, reason: "unknown", lang: null, words: 0 }, {}],
      [{ base: null, reason: "declared_other", lang: "de", words: 0 }, { pausedHosts: [HOST] }],
      [{ base: null, reason: "declared_other", lang: "de", words: 0 }, { enabled: false }],
      [null, {}],
    ]) {
      const p = await openPopup({ local: { words: WORDS, ...local }, pageStatus });
      await p.settle();
      assert.ok(!p.visible("#pageLang"), JSON.stringify(pageStatus));
    }
  });
});

describe("the backup reminder (slice 12 §8)", () => {
  const DAY = 86_400_000;
  const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, lang: "ru", native: `дом${i}`, base_lang: "en", gloss: `word${i}`, forms: [`word${i}`], status: "active" }));
  const LOCAL = { wordsHome: "local", lookup: { kind: "provider", provider: "openrouter" }, keys: { server: false, providers: { openrouter: true } }, onboarding: { completedAt: 1, skipped: false, version: 2 } };

  test("words only in this browser, 20 or more, no backup for 30 days: one quiet line; Back up now; Not now", async () => {
    const p = await openPopup({ local: { ...LOCAL, words: many(25), backupSince: Date.now() - 40 * DAY } });
    await p.settle();
    assert.equal(p.$("#bannerBackup").dataset.severity, "info");
    assert.equal(p.text("#bannerBackup .banner-body"), "Your 25 words are only in this browser.");
    p.$("#bannerBackup [data-action=backup-now]").click();
    await p.settle();
    assert.deepEqual(p.opened, ["chrome-extension://fake-extension-id/dashboard.html#settings/data/backup"]);
    p.$("#bannerBackup [data-action=not-now]").click();
    await p.settle();
    assert.ok(p.store.backupSnooze > Date.now() + 29 * DAY);
    assert.equal(p.$("#bannerBackup"), null, "hidden for 30 days");
  });

  test("not shown: a recent backup, fewer than 20 words, words on a server, the setting off, or no clock yet", async () => {
    for (const local of [
      { ...LOCAL, words: many(25), backupSince: Date.now() - 40 * DAY, lastBackupAt: Date.now() - 2 * DAY },
      { ...LOCAL, words: many(19), backupSince: Date.now() - 40 * DAY },
      { ...LOCAL, words: many(25), backupSince: Date.now() - 40 * DAY, prefs: { backupReminder: false } },
      { ...LOCAL, words: many(25) },
      { ...CONNECTED, words: many(25), backupSince: Date.now() - 40 * DAY },
    ]) {
      const p = await openPopup({ local });
      await p.settle();
      assert.equal(p.$("#bannerBackup"), null, JSON.stringify({ ...local, words: local.words.length }));
    }
  });
});
