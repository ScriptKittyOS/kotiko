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

// A promise with its resolve function, for answers that arrive later.
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

async function openPopup({ local = {}, locale = "en", tabUrl = `https://${HOST}/wiki/Cat`, permission = true, answer = () => ({ ok: true }), pageStatus = null } = {}) {
  const fake = createFakeChrome({
    local: { words: [], ...local },
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
  return { dom, win: dom.window, doc, $, fake, settle, text, visible, requested, opened, asked, store: fake.store.local };
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

describe("adding words (D)", () => {
  test("Enter clears and refocuses the box at once, the line says Looking up, then Added with Undo", async () => {
    const add = deferred();
    const p = await openPopup({
      local: { ...CONNECTED, words: WORDS },
      answer: (msg) => (msg.type === "add" ? add.promise : { ok: true }),
    });
    const input = p.$("#addText");
    input.value = "sobaka";
    p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    assert.equal(input.value, "", "cleared before any answer");
    assert.equal(p.doc.activeElement, input);
    assert.equal(p.text("#jobs"), "Looking up sobaka…");
    assert.deepEqual(p.fake.calls.sendMessage.filter((m) => m.type === "add"), [{ type: "add", text: "sobaka" }]);

    add.resolve({ words: [{ id: 42, lang: "ru", language: "Russian", native: "собака", romanization: "sobaka", english: "dog", forms: ["dog"] }] });
    await p.settle();
    const line = p.$('#jobs [data-kind="word"]');
    assert.equal(line.querySelector(".job-text").textContent, "Added собака (sobaka) = dog · Russian");
    assert.equal(line.querySelector(".word").lang, "ru");
    assert.equal(line.querySelector('[data-action="undo"]').getAttribute("aria-label"), "Undo adding собака");

    line.querySelector('[data-action="undo"]').click();
    await p.settle();
    assert.deepEqual(p.fake.calls.sendMessage.filter((m) => m.type === "remove"), [{ type: "remove", id: 42 }]);
    assert.equal(p.text("#jobs"), "Removed собака.");
  });

  test("three adds in a row each get their line, newest first, and only three are kept", async () => {
    const p = await openPopup({
      local: { ...CONNECTED, words: WORDS },
      answer: (msg) => (msg.type === "add" ? new Promise(() => {}) : { ok: true }),
    });
    for (const text of ["uno", "dos", "tres", "cuatro"]) {
      p.$("#addText").value = text;
      p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    }
    assert.deepEqual([...p.doc.querySelectorAll("#jobs li")].map((li) => li.textContent), ["Looking up cuatro…", "Looking up tres…", "Looking up dos…"]);
  });

  test("each word in a multi-word add has its own Undo", async () => {
    const p = await openPopup({
      local: { ...CONNECTED, words: WORDS },
      answer: (msg) => (msg.type === "add" ? { words: [w(50, "es", "gato", "cat"), w(51, "es", "perro", "dog")] } : { ok: true }),
    });
    p.$("#addText").value = "cat and dog in spanish";
    p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
    const undos = p.doc.querySelectorAll('#jobs [data-action="undo"]');
    assert.equal(undos.length, 2);
    undos[1].click();
    await p.settle();
    assert.deepEqual(p.fake.calls.sendMessage.filter((m) => m.type === "remove"), [{ type: "remove", id: 51 }]);
    assert.match(p.text("#jobs"), /Added gato = cat · Spanish.*Removed perro\./);
  });

  test("a word already in the list is named calmly, with no Undo that could delete it", async () => {
    const p = await openPopup({
      local: { ...CONNECTED, words: WORDS },
      answer: (msg) =>
        msg.type === "add"
          ? { words: [w(52, "es", "gato", "cat")], known: ["спасибо"], reply: "Already in your list: спасибо" }
          : { ok: true },
    });
    p.$("#addText").value = "gato and spasibo";
    p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
    const known = p.$('#jobs [data-kind="known"]');
    assert.equal(known.textContent, "Already in your list: спасибо");
    assert.equal(known.querySelectorAll("button").length, 0);
    assert.equal(p.doc.querySelectorAll('#jobs [data-action="undo"]').length, 1, "only the new word has Undo");
    assert.equal(p.$('#jobs [data-kind="failed"]'), null);
  });

  test("failures read in plain language, with the right next step", async () => {
    const cases = [
      [{ error: "Can't reach http://x.", code: "server_unreachable" }, CONNECTED, /^Can't reach your Kotiko server\./, "retry"],
      [{ error: "The language model failed: 429", code: "http_error", details: { status: 502 } }, CONNECTED, /^Word lookup didn't answer\. Try again in a moment\.$/, "retry"],
      [{ error: "Couldn't save", code: "http_error", details: { status: 422 } }, CONNECTED, /^Your Kotiko server couldn't save that word\./, "retry"],
      [{ error: "The server rejected that API token.", code: "server_key_rejected" }, CONNECTED, /^Your Kotiko server didn't accept the access key\./, "settings"],
      [{ error: { code: "invalid_message", message: "text must be 1 to 200 characters" } }, CONNECTED, /^That's a lot of text for one word\./, null],
      [{ words: [], reply: "I couldn't find a word in that." }, CONNECTED, /^Couldn't find a word in “zzz”\. Try the word on its own\.$/, null],
    ];
    for (const [res, local, expected, action] of cases) {
      const p = await openPopup({ local: { ...local, words: WORDS }, answer: (msg) => (msg.type === "add" ? res : { ok: true }) });
      p.$("#addText").value = "zzz";
      p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
      await p.settle();
      const line = p.$('#jobs [data-kind="failed"]');
      assert.match(line.querySelector(".job-text > p").textContent, expected);
      assert.ok(line.querySelector(".icon-error"), "an icon, not color alone");
      if (action) assert.ok(line.querySelector(`[data-action="${action}"]`), `${expected}: ${action}`);
      assert.doesNotMatch(line.querySelector(".job-text > p").textContent, /token|API|model/i);
    }
  });

  test("a failed lookup's code (slice 10) reads in plain language, never 'Word lookup didn't answer'", async () => {
    const tomorrow = new Date(Date.now() + 6 * 3600_000).toISOString();
    const cases = [
      [{ code: "rate_limited", details: { status: 429, retry_at: tomorrow } }, /^Word lookup is busy\. Try again in a minute\.$/, "retry"],
      [{ code: "quota_exhausted", details: { reason: "daily_limit", retry_at: tomorrow, provider: "openrouter" } }, /^You've used today's free lookups\. Try again after \d{1,2}:\d{2}/, null],
      [{ code: "quota_exhausted", details: { reason: "payment_required", provider: "openrouter", status: 402 } }, /^OpenRouter needs credit on your account/, null],
      [{ code: "model_unavailable", details: { status: 502 } }, /^Word lookup isn't answering right now\./, "retry"],
      [{ code: "lookup_timeout", details: { status: 503 } }, /^That lookup took too long\. Try again\.$/, "retry"],
      [{ code: "bad_lookup_result", details: { status: 502 } }, /^The lookup came back garbled\./, "retry"],
      [{ code: "key_rejected", details: { provider: "openrouter", status: 502 } }, /^OpenRouter didn't accept your Kotiko server's key\./, null],
      [{ code: "lookup_not_set_up", details: { status: 503 } }, /^Word lookup isn’t set up on your Kotiko server yet\.$/, null],
    ];
    for (const [res, expected, action] of cases) {
      const p = await openPopup({ local: { ...CONNECTED, words: WORDS }, answer: (msg) => (msg.type === "add" ? { error: "x", ...res } : { ok: true }) });
      p.$("#addText").value = "zzz";
      p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
      await p.settle();
      const line = p.$('#jobs [data-kind="failed"]');
      assert.match(line.querySelector(".job-text > p").textContent, expected);
      if (action) assert.ok(line.querySelector(`[data-action="${action}"]`), `${expected}: ${action}`);
      else assert.equal(line.querySelector('[data-action="retry"]'), null, `${expected}: no retry`);
    }
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

  test("Try again on a failed line runs the add again; dismiss clears it", async () => {
    let n = 0;
    const p = await openPopup({
      local: { ...CONNECTED, words: WORDS },
      answer: (msg) => (msg.type !== "add" ? { ok: true } : n++ ? { words: [w(60, "ru", "собака", "dog", "sobaka")] } : { error: "x", code: "server_unreachable" }),
    });
    p.$("#addText").value = "sobaka";
    p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
    p.$('#jobs [data-action="retry"]').click();
    await p.settle();
    assert.match(p.text("#jobs"), /^Added собака/);
    p.$("#addText").value = "x".repeat(201);
    p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    p.$('#jobs [data-action="dismiss"]').click();
    assert.equal(p.doc.querySelectorAll("#jobs li").length, 1);
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

  test("Show only hides the others, says so, and Show all brings them back", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    p.$('#chips [data-only-lang="ar"]').click();
    await p.settle();
    assert.deepEqual([...p.store.hiddenLangs].sort(), ["es", "ja", "ru"]);
    assert.ok(p.visible("#onlyStrip"));
    assert.equal(p.text("#onlyStrip"), "Showing only العربية · Show all");
    assert.equal(p.$('#chips .chip[data-lang="ar"]').dataset.only, "true");
    p.$('#onlyStrip [data-action="show-all"]').click();
    await p.settle();
    assert.deepEqual(p.store.hiddenLangs, []);
    assert.ok(!p.visible("#onlyStrip"));
  });

  test("Show all appears when some languages are hidden", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS, hiddenLangs: ["ja"] } });
    assert.ok(p.visible("#showAll"));
    p.$("#showAll").click();
    await p.settle();
    assert.deepEqual(p.store.hiddenLangs, []);
    assert.ok(!p.visible("#showAll"));
  });

  test("keyboard: arrows move between chips, Home/End jump, F shows only the current one", async () => {
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
    assert.deepEqual([...p.store.hiddenLangs].sort(), ["ar", "es", "ru"]);
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
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS }, answer: (m) => (m.type === "add" ? { words: [w(80, "ru", "собака", "dog")] } : { ok: true }) });
    p.$("#addText").value = "sobaka";
    p.$("#addForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
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

describe("size (20 §8)", () => {
  // §8's budget is the popup's own files; the guard on everything it loads moved from 100
  // to 110 KB with slice 11 (local first run, waiting jobs, the lookup set-up state).
  test("the popup's own JS and CSS stay under 60 KB, and everything it loads under 110 KB", () => {
    const size = (files) => files.reduce((n, f) => n + Buffer.byteLength(readExt(f)), 0);
    const own = ["popup.js", "popup.css"];
    const shared = ["ui/tokens.css", "ui/base.css", "ui/components.css", "ui/icons.js", "ui/theme.js", "lib/i18n.js", "lib/lookup-status.js"];
    assert.ok(size(own) < 60 * 1024, `popup.js + popup.css: ${size(own)} bytes`);
    assert.ok(size([...own, ...shared]) < 110 * 1024, `everything: ${size([...own, ...shared])} bytes`);
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
    assert.equal(p.text("#jobs"), "Looking up shukran…");
    assert.equal(p.$("#addBtn").disabled, false, "never disabled");
    const sent = p.fake.calls.sendMessage.find((m) => m.type === "add");
    assert.match(sent.id, /^[0-9a-f-]{36}$/);
    assert.equal(sent.text, "shukran");
    await p.fake.chrome.storage.local.set({ addJobs: [job(sent.id, "looking_up")] });
    await p.settle();
    assert.equal(p.text("#jobs"), "Looking up shukran…");
    await p.fake.chrome.storage.local.set({ addJobs: [job(sent.id, "done", { results: [{ wordId: "w-1", result: "created", word: shukran, undo: null }] })] });
    await p.settle();
    assert.match(p.text("#jobs"), /^Added شكرا \(shukran\) = thanks · Arabic\s*Undo$/);
    p.$('#jobs [data-action="undo"]').click();
    await p.settle();
    assert.deepEqual(p.fake.calls.sendMessage.find((m) => m.type === "remove"), { type: "remove", id: "w-1", jobId: sent.id });
    assert.match(p.text("#jobs"), /^Removed شكرا/);
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
    assert.match(p.text("#jobs"), /^Added شكرا/);
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
