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

async function openPopup({ local = {}, locale = "en", tabUrl = `https://${HOST}/wiki/Cat`, permission = true, answer = () => ({ ok: true }) } = {}) {
  const fake = createFakeChrome({
    local: { words: [], ...local },
    tabs: [{ id: 1, active: true, url: tabUrl }],
    onSendMessage: (msg) => answer(msg),
  });
  const requested = [];
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
  for (const rel of ["lib/i18n.js", "ui/icons.js", "popup.js"]) runInWindow(dom, rel);
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
  return { dom, win: dom.window, doc, $, fake, settle, text, visible, requested, store: fake.store.local };
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

describe("states", () => {
  test("A, first run: a friendly setup card, no error, no settings panel; the add box has focus", async () => {
    const p = await openPopup({ local: { syncError: { code: "server_key_rejected", details: { reason: "no_token" } } } });
    assert.ok(p.visible("#firstRun"));
    assert.equal(p.text("#firstRunTitle"), "Finish setting up Kotiko");
    assert.ok(!p.visible("#langSection"));
    assert.ok(!p.visible("#pageSection"));
    assert.equal(p.$("#banners").children.length, 0);
    assert.ok(p.$("#settings").hidden);
    assert.equal(p.doc.activeElement, p.$("#addText"));
    p.$("#getStarted").click();
    assert.ok(!p.$("#settings").hidden, "Get started opens Connection settings");
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

  test("words without a server say so, without an error", async () => {
    const { node, body } = await banner({ code: "server_key_rejected", details: { reason: "no_token" } }, WORDS, { token: "" });
    assert.equal(node.dataset.severity, "info");
    assert.match(body, /isn't connected to a server.*Your 8 words still work on pages\./);
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
      [{ error: "Paste your API token to connect.", code: "server_key_rejected" }, { ...CONNECTED, token: "" }, /^Connect your Kotiko server to add words\.$/, "settings"],
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
  test("opens on request with the stored values, saves, and checks the server", async () => {
    const p = await openPopup({ local: { ...CONNECTED, words: WORDS } });
    p.$("#openSettings").click();
    assert.ok(!p.$("#settings").hidden && p.$("#main").hidden);
    assert.equal(p.$("#serverUrl").value, CONNECTED.serverUrl);
    assert.equal(p.$("#accessKey").value, CONNECTED.token);
    assert.equal(p.$("#accessKey").type, "password");
    p.$("#toggleKey").click();
    assert.equal(p.$("#accessKey").type, "text");
    assert.equal(p.text("#connStatus").split(".")[0], "Connected");

    p.$("#serverUrl").value = "http://192.168.1.5:4747";
    p.$("#serverUrl").dispatchEvent(new p.win.Event("input"));
    p.$("#accessKey").focus();
    // A sync landing mid-edit doesn't overwrite fields (research 06 F16).
    await p.fake.chrome.storage.local.set({ serverUrl: "http://elsewhere:1", token: "other" });
    await p.settle();
    assert.equal(p.$("#serverUrl").value, "http://192.168.1.5:4747");
    assert.equal(p.$("#accessKey").value, CONNECTED.token);

    p.$("#accessKey").value = "  new-key ";
    p.$("#connForm").dispatchEvent(new p.win.Event("submit", { cancelable: true }));
    await p.settle();
    assert.equal(p.store.serverUrl, "http://192.168.1.5:4747");
    assert.equal(p.store.token, "new-key");
    assert.ok(p.fake.calls.sendMessage.some((m) => m.type === "sync" && m.force));

    p.$("#closeSettings").click();
    assert.ok(p.$("#settings").hidden && !p.$("#main").hidden);
    assert.equal(p.doc.activeElement, p.$("#openSettings"));
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
  test("the popup's own JS and CSS stay under 60 KB, and everything it loads under 100 KB", () => {
    const size = (files) => files.reduce((n, f) => n + Buffer.byteLength(readExt(f)), 0);
    const own = ["popup.js", "popup.css"];
    const shared = ["ui/tokens.css", "ui/base.css", "ui/components.css", "ui/icons.js", "ui/theme.js", "lib/i18n.js"];
    assert.ok(size(own) < 60 * 1024, `popup.js + popup.css: ${size(own)} bytes`);
    assert.ok(size([...own, ...shared]) < 100 * 1024, `everything: ${size([...own, ...shared])} bytes`);
  });
});
