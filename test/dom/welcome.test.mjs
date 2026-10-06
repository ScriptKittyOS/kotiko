// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// welcome.html and welcome.js (slice 22) in jsdom, talking to the real background.js (vm,
// fake chrome, fake-indexeddb) and, for lookups, the fixture server's fake model. Every
// step and state: arrival in English and in Spanish, the languages you read, each way to
// connect an AI and a refused key, the "native = meaning" path with no network, a word
// looked up and nothing saved before "Make it my first word", several results, which
// language, no AI yet, the celebration once (confetti, reduced motion, turned off), the
// live preview and Edit, Skip, and reopening with words.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { createI18n, readMessages } from "../helpers/fake-i18n.mjs";
import { readExt, runInVm, runInWindow, sleep } from "../helpers/load-script.mjs";
import { startFixtureServer } from "../helpers/fixture-server.mjs";

const EXT_ID = "fake-extension-id";
const URL_ = `chrome-extension://${EXT_ID}/welcome.html`;
const SENDER = { id: EXT_ID, url: URL_, tab: { id: 7, url: URL_ } };
const KEY = "sk-or-v1-0123456789abcdef0123456789abcdefa1b2";
const FRESH = { onboarding: { completedAt: null, skipped: false, version: 2 } };
const SCRIPTS = [
  "spec/spec.js", "lib/lang.js", "lib/wordspec.js", "lib/word-merge.js", "lib/local-mode.js", "lib/text.js", "lib/matcher.js", "lib/casing.js",
  "lib/i18n.js", "ui/icons.js", "lib/speak.js", "lib/word-card.js", "lib/lookup-status.js", "lib/errors.js", "ui/popover-style.js",
  "content/popover.js", "ui/confetti.js", "lib/welcome-model.js", "welcome.js",
];

let srv;
const opened = [];
before(async () => {
  srv = await startFixtureServer();
});
after(async () => {
  for (const w of opened) {
    w.KotikoWelcome?.stopTimers();
    w.close();
  }
  await srv.close();
});

const plain = (v) => JSON.parse(JSON.stringify(v));

async function openWelcome({ locale = "en", accept = null, bases = null, local = {}, reduced = false, network = false } = {}) {
  const b = bases ?? [locale];
  const fake = createFakeChrome({
    runtimeId: EXT_ID,
    local: { ...FRESH, baseLangs: b, ...local },
    sync: { ui: { uiLang: "auto", baseLangs: b, baseLangsDetected: b, baseLangsConfirmed: false } },
  });
  fake.chrome.i18n = { ...createI18n(locale), getAcceptLanguages: async () => accept ?? [locale] };
  // The background's network: the fake model (OpenRouter's address points at it too), or
  // nothing at all, with every request recorded.
  const requests = [];
  const bgFetch = (url, init) => {
    requests.push(String(url));
    if (!network) return Promise.reject(new TypeError("Failed to fetch"));
    return fetch(String(url).replace("https://openrouter.ai/api/v1", srv.llmUrl), init);
  };
  const bg = runInVm("background.js", { chrome: fake.chrome, fetch: bgFetch });
  await bg.__kotiko.ready();

  const tabs = { created: [], removed: [] };
  const page = {
    storage: fake.chrome.storage,
    i18n: fake.chrome.i18n,
    runtime: {
      id: EXT_ID,
      getURL: fake.chrome.runtime.getURL,
      getManifest: fake.chrome.runtime.getManifest,
      sendMessage: (msg) => fake.deliver(msg, SENDER),
      openOptionsPage: async () => void tabs.created.push("options"),
      onMessage: { addListener() {}, removeListener() {} },
    },
    tabs: {
      create: async (o) => void tabs.created.push(o.url),
      getCurrent: async () => ({ id: 7 }),
      remove: async (id) => void tabs.removed.push(id),
    },
  };
  const dom = new JSDOM(readExt("welcome.html"), { url: URL_, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  opened.push(w);
  w.chrome = page;
  w.matchMedia = (q) => ({ matches: reduced && q.includes("reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} });
  const draws = { canvases: 0 };
  w.HTMLCanvasElement.prototype.getContext = function () {
    draws.canvases++;
    return new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  };
  for (const rel of SCRIPTS) {
    runInWindow(dom, rel);
    if (rel === "lib/i18n.js") w.KotikoI18n._setLoader(async (l) => readMessages(l));
  }
  await w.KotikoWelcome.ready;
  w.KotikoWelcome.stopTimers();
  const doc = w.document;
  const $ = (sel) => doc.querySelector(sel);
  const $$ = (sel) => [...doc.querySelectorAll(sel)];
  const text = (sel) => $(sel)?.textContent.replace(/\s+/g, " ").trim() ?? null;
  const visible = (sel) => {
    for (let el = $(sel); el; el = el.parentElement) if (el.hidden) return false;
    return !!$(sel);
  };
  const until = async (fn, ms = 6000) => {
    const end = Date.now() + ms;
    for (;;) {
      await fake.idle();
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error("timed out waiting");
      await sleep(5);
    }
  };
  // Steps as 20 §3 counts them: typing one entry, a key that commits, a click.
  let steps = 0;
  const type = (sel, value) => {
    steps++;
    const input = $(sel);
    input.focus();
    input.value = value;
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const enter = (sel) => {
    steps++;
    const input = $(sel);
    const form = input.form;
    if (form) form.requestSubmit();
    else input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  };
  const click = (sel) => {
    steps++;
    (typeof sel === "string" ? $(sel) : sel).click();
  };
  const ask = async (value) => {
    type("#askText", value);
    enter("#askText");
  };
  const words = async () => (await bg.__kotiko.getStore()).list();
  return { dom, w, doc, $, $$, text, visible, until, type, enter, click, ask, words, fake, bg, requests, tabs, draws, store: fake.store.local, sync: fake.store.sync, steps: () => steps };
}

// The fixture server's fake model as "Another service", through the page's own fields.
async function connectFake(p) {
  p.click("#aiOther");
  await p.until(() => p.$('#providerOptions [data-value="custom"]'));
  p.click('#providerOptions [data-value="custom"]');
  await p.until(() => p.visible("#otherUrl"));
  p.type("#otherUrl", srv.llmUrl);
  p.enter("#otherUrl");
  await p.until(() => p.visible("#aiConnected"));
}

describe("arrival (22 §2)", () => {
  test("English: the conversation, the languages you read, the AI step and the ask box", async () => {
    const p = await openWelcome();
    assert.equal(p.doc.title, "Welcome to Kotiko");
    assert.equal(p.text("#turnGreet .line"), "Hi, I'm Kotiko. I swap words on the pages you read for words you're learning, one word at a time.");
    assert.equal(p.text("#basesLine"), "The pages you read are in:");
    const chip = p.$(".base-chip");
    assert.deepEqual([chip.getAttribute("role"), chip.getAttribute("aria-checked"), chip.textContent.trim()], ["checkbox", "true", "English"]);
    assert.equal(p.text("#addBase"), "Another");
    assert.ok(p.visible("#aiSetup"));
    assert.equal(p.text("#aiPaste"), "Paste an OpenRouter key (free)");
    assert.equal(p.text("#askLine"), "What's the first word you'd love to learn?");
    assert.equal(p.$("#askText").placeholder, "how do you say hello in Japanese");
    assert.equal(p.$("#askText").value, "", "the examples are a placeholder only");
    assert.equal(p.doc.activeElement, p.$("#askText"), "focus starts in the ask box");
    assert.equal(p.text("#noAiHint"), "No AI yet? Type the word and its meaning, like “hola = hello”. That works without one.");
    assert.equal(p.$("#log").getAttribute("role"), "log");
    assert.ok(p.$("#permission").hidden, "Chrome grants page access at install: no step 0");
    assert.deepEqual(p.requests, [], "no network request until the learner acts");
  });

  test("Try “hello” only fills the box, caret at the end; nothing is saved", async () => {
    const p = await openWelcome();
    p.click("#tryHello");
    assert.equal(p.$("#askText").value, "how do you say hello in ");
    assert.equal(p.doc.activeElement, p.$("#askText"));
    assert.equal(p.$("#askText").selectionStart, "how do you say hello in ".length);
    await p.fake.idle();
    assert.deepEqual(await p.words(), []);
    assert.ok(!p.fake.calls.sendMessage.some((m) => m.type === "words.save" || m.type === "words.preview"));
  });

  test("Puerto Rico: an all-Spanish browser gets the whole page in Spanish, with español as the base", async () => {
    const p = await openWelcome({ locale: "es", accept: ["es-PR", "es"] });
    assert.equal(p.text("#turnGreet .line"), "Hola, soy Kotiko. Cambio palabras en las páginas que lees por palabras que estás aprendiendo, una a la vez.");
    assert.deepEqual(p.$$(".base-chip").map((c) => c.textContent.trim()), ["español"]);
    assert.equal(p.text("#tryHello"), "Prueba con “hola”");
    assert.equal(p.text("#skip"), "Omitir por ahora");
    p.click("#tryHello");
    assert.equal(p.$("#askText").value, "¿cómo se dice hola en ");
    // No English string anywhere a person can perceive (22 acceptance: DOM scan against en).
    const en = readMessages("en");
    const es = readMessages("es");
    const englishOnly = new Set(Object.keys(en).filter((k) => es[k] && es[k].message !== en[k].message && /[a-z]{4}/.test(en[k].message)).map((k) => en[k].message.replace(/\$[A-Z_]+\$/g, "").trim()).filter((m) => m.length > 6));
    const seen = [];
    const walk = (n) => {
      if (n.nodeType === 1 && (n.hidden || n.localName === "script")) return;
      if (n.nodeType === 3 && n.textContent.trim()) seen.push(n.textContent.trim());
      if (n.nodeType === 1) for (const a of ["aria-label", "placeholder", "title"]) if (n.getAttribute(a)) seen.push(n.getAttribute(a));
      n.childNodes.forEach(walk);
    };
    walk(p.doc.body);
    assert.deepEqual(seen.filter((s) => englishOnly.has(s)), []);
  });
});

describe("the languages you read (22 §2b)", () => {
  test("untick, the last one refused, another added from the search; each written at once", async () => {
    const p = await openWelcome({ bases: ["es", "en"] });
    assert.deepEqual(p.$$(".base-chip").map((c) => [c.textContent.trim(), c.getAttribute("aria-label")]), [["Spanish", "Spanish, Español"], ["English", "English"]]);
    p.click(p.$$(".base-chip")[1]);
    await p.until(() => plain(p.sync.ui.baseLangs).join() === "es");
    assert.deepEqual(plain(p.store.baseLangs), ["es"]);
    assert.equal(p.$$(".base-chip")[1].getAttribute("aria-checked"), "false", "an unticked chip stays, to tick again");
    p.click(p.$$(".base-chip")[0]);
    await p.fake.idle();
    assert.equal(p.text("#basesNote"), "Kotiko needs at least one language you read.");
    assert.deepEqual(plain(p.sync.ui.baseLangs), ["es"]);
    p.click("#addBase");
    p.type("#baseSearchField", "fren");
    assert.equal(p.$("#baseSearchList .lang-option").dataset.lang, "fr");
    p.enter("#baseSearchField");
    await p.until(() => plain(p.sync.ui.baseLangs).join() === "es,fr");
    assert.ok(p.$("#baseSearch").hidden);
    assert.equal(p.sync.ui.baseLangsConfirmed, false, "confirmed only by the first word or Skip");
  });

  test("with a server connected, its Telegram bot follows the change (slice 41 §9)", async () => {
    srv.reset();
    const p = await openWelcome({ bases: ["es", "en"], network: true });
    await p.fake.deliver({ type: "server.connect", url: srv.kotikoUrl, token: srv.token }, SENDER);
    const asked = [];
    const deliver = p.fake.deliver;
    p.fake.deliver = (msg, from) => {
      asked.push(msg.type);
      return deliver(msg, from);
    };
    p.click(p.$$(".base-chip")[1]);
    await p.until(() => plain(p.sync.ui.baseLangs).join() === "es");
    await p.until(() => asked.includes("profile.sync"));
    await p.until(() => srv.state.profile?.base_langs?.join() === "es");
    assert.equal(srv.state.profile.ui_lang, null);
  });

  test("a Basic base carries the \"basic\" tag with its explanation", async () => {
    const p = await openWelcome({ bases: ["pl"] });
    assert.equal(p.text(".base-chip .chip-tag"), "basic");
    assert.match(p.$(".base-chip").getAttribute("aria-description"), /^Kotiko works in Polski, with simpler word checks/);
  });
});

describe("the first word with no AI and no network (22 §5, §6, §11)", () => {
  test("ありがとう = thanks: a card, nothing saved, then one word in 3 steps, celebrated once with confetti", async () => {
    const p = await openWelcome();
    await p.ask("ありがとう = thanks");
    await p.until(() => p.$("#wordCard"));
    assert.equal(p.text("#resultLine"), "Here it is:");
    assert.equal(p.text(".wcard-word"), "ありがとう");
    assert.equal(p.$(".wcard-word").lang, "ja");
    assert.equal(p.text(".wcard-meaning"), "thanks · Japanese");
    assert.equal(p.$(".wcard-rom"), null, "a typed word has no AI label");
    assert.equal(p.doc.activeElement, p.$("#wordCard"), "focus moves to the card");
    assert.equal(p.$("#wordCard").getAttribute("aria-label"), "ありがとう, thanks, Japanese");
    assert.deepEqual(await p.words(), [], "nothing is saved before the tap");
    p.click("#confirm");
    await p.until(() => p.visible("#done"));
    assert.equal(p.steps(), 3, "type, Enter, Make it my first word");
    const saved = await p.words();
    assert.deepEqual(saved.map((x) => [x.lang, x.native, x.gloss, x.base_lang, x.origin]), [["ja", "ありがとう", "thanks", "en", "manual"]]);
    assert.deepEqual(p.requests, [], "no network request at any step");
    assert.equal(p.text("#celebrateLine"), "Congrats, you got your first word!");
    assert.equal(p.draws.canvases, 1, "confetti, once");
    assert.equal(p.$("canvas.kotiko-confetti").getAttribute("aria-hidden"), "true");
    assert.ok(p.store.celebrations.done["vocab:first"]);
    assert.ok(p.store.onboarding.completedAt);
    assert.equal(p.store.onboarding.skipped, false);
    assert.equal(p.sync.ui.baseLangsConfirmed, true);
    assert.equal(p.doc.activeElement, p.$("#tryPage"), "focus moves to Try it on a page");
    assert.ok(p.$("#log").textContent.includes("Congrats, you got your first word!"), "announced through the log");
    // The preview: the real matcher, a sentence from en/sentences.json.
    assert.equal(p.text(".preview-before"), "Thanks for the coffee, it was perfect.");
    assert.equal(p.text(".preview-after"), "ありがとう for the coffee, it was perfect.");
    const swap = p.$(".preview-after kotiko-w");
    assert.deepEqual([swap.lang, swap.getAttribute("translate")], ["ja", "no"]);
    assert.equal(p.$(".preview").localName, "figure");
    assert.equal(p.text(".preview figcaption span"), "Preview");
    assert.equal(p.$(".preview").closest("[aria-live]"), null, "the preview isn't a live region");
    assert.equal(p.$("#tryPage").href, "https://simple.wikipedia.org/w/index.php?search=thanks&fulltext=1&ns0=1");
    assert.equal(p.text("#tryPageDesc"), "Opens a Wikipedia search for “thanks”.");
    assert.equal(p.text("#whatsNext"), "From now on, ありがとう shows up on pages in English wherever “thanks” does. Point at it, or tap it, to see what it means. Even if it's the only one you see, it's yours.");
    assert.ok(p.visible("#noAiLater"));
    assert.equal(p.text("#pinTip"), "Pin Kotiko: click the puzzle piece, then the pin next to Kotiko.");

    // Add another word: no second celebration.
    p.click("#addAnother");
    assert.ok(p.visible("#turnAsk"));
    assert.equal(p.text("#askLine"), "What would you like to learn next?");
    await p.ask("사랑 = love");
    await p.until(() => p.$("#wordCard"));
    assert.equal(p.text("#confirm"), "Add this word");
    p.click("#confirm");
    await p.until(async () => (await p.words()).length === 2 && p.visible("#done"));
    assert.ok(p.$("#turnCelebrate").hidden, "the first word is celebrated once, ever");
    assert.equal(p.draws.canvases, 1);
  });

  test("reduced motion: no confetti; the message and card fade in", async () => {
    const p = await openWelcome({ reduced: true });
    await p.ask("ありがとう = thanks");
    await p.until(() => p.$("#wordCard"));
    p.click("#confirm");
    await p.until(() => p.visible("#done"));
    assert.equal(p.text("#celebrateLine"), "Congrats, you got your first word!");
    assert.equal(p.draws.canvases, 0);
    assert.equal(p.$("canvas"), null);
    assert.ok(p.$("#done").classList.contains("fade-in"));
    assert.equal(p.$("#askText").placeholder, "how do you say hello in Japanese", "the placeholder stays still");
  });

  test("celebrations turned off before the first word: the message without confetti; Turn off celebrations works", async () => {
    const off = await openWelcome({ local: { prefs: { celebrations: false } } });
    await off.ask("ありがとう = thanks");
    await off.until(() => off.$("#wordCard"));
    off.click("#confirm");
    await off.until(() => off.visible("#done"));
    assert.equal(off.text("#celebrateLine"), "Congrats, you got your first word!");
    assert.equal(off.draws.canvases, 0);
    const on = await openWelcome();
    await on.ask("ありがとう = thanks");
    await on.until(() => on.$("#wordCard"));
    on.click("#confirm");
    await on.until(() => on.$("canvas"));
    on.click("#celebrationsOff");
    await on.until(() => on.visible("#celebrationsOffDone"));
    assert.equal(on.$("canvas"), null, "the running confetti stops");
    assert.equal(on.text("#celebrationsOffDone"), "Off. You can turn them back on in Settings.");
    assert.equal(on.store.prefs.celebrations, false);
  });

  test("hola = hello: which language? Español, then one Spanish word in 4 steps", async () => {
    const p = await openWelcome();
    await p.ask("hola = hello");
    await p.until(() => p.$(".pick-chip"));
    assert.deepEqual(p.$$(".pick-chip").map((c) => c.textContent), ["Español", "Português", "Italiano", "Français", "Deutsch", "Nederlands"]);
    assert.equal(p.text("#confirm"), "Choose a language first");
    assert.equal(p.$("#confirm").getAttribute("aria-disabled"), "true");
    p.click(p.$(".pick-chip"));
    await p.until(() => p.text("#confirm") === "Make it my first word");
    p.click("#confirm");
    await p.until(() => p.visible("#done"));
    assert.equal(p.steps(), 4);
    assert.deepEqual((await p.words()).map((x) => [x.lang, x.native, x.gloss, x.base_lang]), [["es", "hola", "hello", "en"]]);
    assert.equal(p.text(".preview-after"), "She said hola and waved from the bus.");
  });

  test("a Spanish reader's hello = hola: chips without Español; English saved for Spanish pages", async () => {
    const p = await openWelcome({ locale: "es" });
    await p.ask("hello = hola");
    await p.until(() => p.$(".pick-chip"));
    const chips = p.$$(".pick-chip").map((c) => c.textContent);
    assert.ok(!chips.includes("Español"), chips.join());
    assert.equal(chips[0], "English");
    assert.equal(p.text(".wcard-meaning"), "hola · ¿En qué idioma está?");
    p.click(p.$(".pick-chip"));
    await p.until(() => p.$("#confirm:not([aria-disabled])"));
    p.click("#confirm");
    await p.until(() => p.visible("#done"));
    assert.deepEqual((await p.words()).map((x) => [x.lang, x.native, x.base_lang, x.gloss]), [["en", "hello", "es", "hola"]]);
    assert.deepEqual(p.requests, []);
    assert.equal(p.text("#celebrateLine"), "¡Felicidades, ya tienes tu primera palabra!");
    assert.equal(p.text(".preview-after"), "Ella dijo hello y saludó desde el autobús.");
    assert.equal(p.$("#tryPage").href, "https://es.wikipedia.org/w/index.php?search=hola&fulltext=1&ns0=1");
  });

  test("a question with no AI: the meaning form; the meaning builds the card here", async () => {
    const p = await openWelcome();
    await p.ask("dog in Arabic");
    await p.until(() => p.visible("#meaningForm"));
    assert.equal(p.text("#resultLine"), "To look up “dog in Arabic”, connect your AI above. Or tell me what it means:");
    assert.equal(p.$("#meaningText").placeholder, "meaning in English");
    p.$("#meaningText").value = "kalb";
    p.$("#meaningForm").requestSubmit();
    await p.until(() => p.$(".pick-chip") || p.$("#wordCard"));
    assert.deepEqual(p.requests, []);
    assert.deepEqual(await p.words(), []);
  });
});

describe("with the learner's own AI (22 §4, §5)", () => {
  test("connect a service on this page, ask, see the card, nothing saved until the tap", async () => {
    await fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify({ reset: true }) });
    const p = await openWelcome({ network: true });
    await connectFake(p);
    assert.equal(p.text("#aiConnectedText"), "Connected to Another service.");
    await p.ask("how do you say hello in Japanese");
    assert.equal(p.text("#resultLine"), "Looking up “how do you say hello in Japanese”…");
    assert.equal(p.$("#askText").value, "", "the box clears and stays usable");
    await p.until(() => p.$("#wordCard"));
    assert.equal(p.text(".wcard-word"), "こんにちは");
    assert.equal(p.text('.wcard-pron [aria-hidden="true"]'), "kon-nee-chee-wa");
    assert.equal(p.text(".wcard-pron .sr-only"), "Pronunciation: kon-nee-chee-wa");
    assert.equal(p.text(".wcard-rom"), "konnichiwa · AI-generated");
    assert.equal(p.text(".wcard-meaning"), "hello · Japanese");
    assert.deepEqual(await p.words(), [], "nothing in the store");
    assert.deepEqual(plain(p.store.words ?? []), [], "nothing on pages");
    assert.deepEqual(plain(p.store.addJobs ?? []), [], "no add job either");
    // Try another: discarded, the learner's text back in the box.
    p.click("#tryAnother");
    assert.equal(p.$("#askText").value, "how do you say hello in Japanese");
    assert.equal(p.$("#cardSlot").children.length, 0);
    p.enter("#askText");
    await p.until(() => p.$("#wordCard"));
    p.click("#confirm");
    await p.until(() => p.visible("#done"));
    const saved = await p.words();
    assert.deepEqual(saved.map((x) => [x.native, x.gloss, x.origin, x.pronunciation]), [["こんにちは", "hello", "add", "kon-nee-chee-wa"]]);
    assert.equal(p.text(".preview-after"), "She said こんにちは and waved from the bus.");
    assert.equal(p.text("#celebrateLine"), "Congrats, you got your first word!");
  });

  test("Russian: the stress-marked word, the respelling with its stressed syllable, Slowly, the label", async () => {
    const p = await openWelcome({ network: true });
    await connectFake(p);
    await p.ask("please in russian");
    await p.until(() => p.$("#wordCard"));
    assert.equal(p.text(".wcard-word"), "пожа́луйста");
    assert.equal(p.text(".wcard-pron strong"), "ZHAL");
    assert.equal(p.text(".wcard-slow"), "Slowly: pa-ZHA-lu-sta");
    assert.equal(p.text(".wcard-rom"), "pozhaluysta · AI-generated");
    assert.match(p.$("#wordCard").getAttribute("aria-label"), /^пожа́луйста, Pronunciation: pa-zhal-sta, stress on zhal, please, Russian$/);
  });

  test("several results: a radio group, the first chosen; only the chosen one is saved", async () => {
    const p = await openWelcome({ network: true });
    await connectFake(p);
    await p.ask("hi in japanese");
    await p.until(() => p.$(".choices"));
    assert.equal(p.text("#resultLine"), "I found a few. Which one is yours?");
    const radios = p.$$('.choices input[type="radio"]');
    assert.equal(radios.length, 3);
    assert.ok(radios[0].checked);
    radios[1].click();
    await p.until(() => p.text(".choice-detail").includes("moh-shee"));
    p.click("#confirm");
    await p.until(() => p.visible("#done"));
    assert.deepEqual((await p.words()).map((x) => x.native), ["もしもし"]);
  });

  test("two bases: one model call, both meanings on the card, two records saved", async () => {
    await fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify({ reset: true }) });
    const p = await openWelcome({ locale: "es", bases: ["es", "en"], network: true });
    await connectFake(p);
    await p.ask("perro en japonés");
    await p.until(() => p.$("#wordCard"));
    assert.deepEqual(p.$$(".wcard-meaning li").map((li) => li.textContent), ["perro · en páginas en español", "dog · en páginas en inglés", "japonés"]);
    p.click("#confirm");
    await p.until(() => p.visible("#done"));
    assert.deepEqual((await p.words()).map((x) => [x.native, x.base_lang, x.gloss]).sort(), [["犬", "en", "dog"], ["犬", "es", "perro"]]);
    const chats = (await (await fetch(`${srv.url}/__control`)).json()).log.filter((r) => r.path === "/llm/v1/chat/completions");
    assert.equal(chats.length, 2, "the connection check and one lookup");
    assert.equal(p.$$(".preview").length, 2, "a preview per base");
    assert.equal(p.$$(".preview-after")[0].textContent, "Nuestro 犬 duerme junto a la puerta cada noche.");
  });

  test("a word asked before connecting is looked up once connected, with no retyping (still unsaved)", async () => {
    const p = await openWelcome({ network: true });
    await p.ask("how do you say hello in Japanese");
    await p.until(() => p.visible("#meaningForm"));
    await connectFake(p);
    await p.until(() => p.$("#wordCard"));
    assert.equal(p.text(".wcard-word"), "こんにちは");
    assert.deepEqual(await p.words(), []);
  });

  test("a refused OpenRouter key says so under the field, and the typed path still completes", async () => {
    await fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify({ reset: true, llm: "401" }) });
    const p = await openWelcome({ network: true });
    p.click("#aiPaste");
    assert.equal(p.$("#pasteKey").type, "password");
    assert.equal(p.$("#pasteKey").getAttribute("autocomplete"), "off");
    p.type("#pasteKey", KEY);
    p.$("#pasteKey").dispatchEvent(new p.w.Event("paste"));
    await p.until(() => p.$("#pasteStatus.status-bad"));
    assert.equal(p.text("#pasteStatus"), "OpenRouter didn't accept your key. Check it and paste it again.");
    assert.equal(p.$("#pasteKey").value, "", "the key never stays on the page");
    assert.match(p.$("#pasteKey").placeholder, /^Saved key: sk-or-…a1b2$/);
    assert.ok(!JSON.stringify([p.store, p.sync]).includes(KEY), "the key is in no storage area");
    await fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify({ llm: null }) });
    await p.ask("ありがとう = thanks");
    await p.until(() => p.$("#wordCard"));
    p.click("#confirm");
    await p.until(() => p.visible("#done"));
    assert.equal((await p.words()).length, 1);
  });
});

describe("skip, reopen, edit (22 §8 to §10)", () => {
  test("Skip for now finishes the first run and closes the tab", async () => {
    const p = await openWelcome();
    p.click("#skip");
    await p.until(() => p.tabs.removed.length);
    assert.deepEqual(p.tabs.removed, [7]);
    assert.equal(p.store.onboarding.skipped, true);
    assert.ok(p.store.onboarding.completedAt);
    assert.equal(p.sync.ui.baseLangsConfirmed, true);
    assert.deepEqual(await p.words(), []);
  });

  test("reopened with words: the next question, the connection shown as connected, no celebration", async () => {
    const q = await openWelcome({ network: true, local: { lookup: { kind: "provider", provider: "custom", baseUrl: srv.llmUrl }, keys: { server: false, providers: { custom: true } }, words: [{ id: "1", lang: "ru", native: "дом", base_lang: "en", gloss: "house", forms: ["house"] }], celebrations: { done: { "vocab:first": 1 } } } });
    assert.equal(q.text("#askLine"), "What would you like to learn next?");
    assert.ok(q.visible("#aiConnected"));
    assert.equal(q.text("#aiConnectedText"), "Connected to Another service.");
    await q.ask("ありがとう = thanks");
    await q.until(() => q.$("#wordCard"));
    q.click("#confirm");
    await q.until(() => q.visible("#done"));
    assert.ok(q.$("#turnCelebrate").hidden);
    assert.equal(q.draws.canvases, 0);
  });

  test("Edit: any sentence, swapped within one frame", async () => {
    const p = await openWelcome({ reduced: true });
    await p.ask("ありがとう = thanks");
    await p.until(() => p.$("#wordCard"));
    p.click("#confirm");
    await p.until(() => p.visible("#done"));
    p.click(p.$(".preview figcaption button"));
    const field = p.$(".preview-field");
    assert.equal(field.lang, "en");
    assert.equal(field.value, "Thanks for the coffee, it was perfect.");
    field.value = "I said thanks, and thanks again.";
    field.dispatchEvent(new p.w.Event("input"));
    await new Promise((r) => p.w.requestAnimationFrame(() => r()));
    await new Promise((r) => p.w.requestAnimationFrame(() => r()));
    assert.equal(p.text(".preview-after"), "I said ありがとう, and ありがとう again.");
  });
});

test("the AI key is typed only on full pages: the welcome tab and the dashboard, never the popup", () => {
  const dom = (f) => new JSDOM(readExt(f)).window.document;
  assert.ok(dom("welcome.html").querySelector("#pasteKey"));
  assert.ok(dom("dashboard.html").querySelector("#lookupKey"));
  const popup = dom("popup.html");
  assert.equal(popup.querySelector("#pasteKey, #lookupKey, #otherKey"), null);
  assert.ok(!/secrets\.set|provider:/.test(readExt("popup.js")), "the popup never sends a provider key");
});
