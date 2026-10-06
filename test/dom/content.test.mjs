// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// content.js in jsdom, loaded the way the manifest injects it (lib/text.js, lib/matcher.js,
// lib/page-lang.js and lib/controls.js first). Pages declare lang="en" unless a test says
// otherwise; `detect` stands in for the browser's language detector.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { createPage, injectContentScripts, sleep } from "../helpers/load-script.mjs";
import { baseRulesFor, basesOf } from "../helpers/base-rules.mjs";

let nextId = 1;
const word = (native, english, forms = [english], lang = "ru", extra = {}) => ({
  id: nextId++,
  lang,
  language: null,
  native,
  romanization: null,
  english,
  forms,
  note: null,
  ...extra,
});

const WORDS = [
  word("дом", "house", ["house", "houses"], "ru", { language: "Russian" }),
  word("спасибо", "thanks", ["thanks", "thank you"], "ru", { language: "Russian", romanization: "spasibo" }),
  word("谢谢", "thanks", ["thanks", "thank you"], "zh", { language: "Mandarin" }),
  word("شكرا", "thanks", ["thanks"], "ar", { language: "Arabic" }),
];

const FLUSH_MS = 300; // content.js batches page mutations for 250 ms

async function load(html, { words = WORDS, url = "https://example.com/", beforeInject, lang = "en", detect = null, ...local } = {}) {
  // As the background writes it: rules for the learner's bases (theirs, else their words').
  if (!("baseRules" in local)) local.baseRules = baseRulesFor(local.baseLangs ?? basesOf(words));
  // As the background copies it: the sensitive-sites list (none, unless a test gives one).
  if (!("sensitiveSites" in local)) local.sensitiveSites = [];
  // The synced salt, fixed so each test sees the same languages (slice 18).
  if (!("seedSalt" in local)) local.seedSalt = "content-tests";
  const fake = createFakeChrome({
    local: { words, enabled: true, pausedHosts: [], hiddenLangs: [], ...local },
    onSendMessage: () => ({ ok: true }),
  });
  fake.chrome.i18n = { detectLanguage: async (text) => (detect ? detect(text) : { isReliable: false, languages: [] }) };
  const page = /<html[\s>]/i.test(html) ? html : `<!doctype html><html${lang ? ` lang="${lang}"` : ""}><head></head><body>${html}</body></html>`;
  const dom = createPage({ html: page, url, chrome: fake.chrome });
  beforeInject?.(dom);
  injectContentScripts(dom);
  await fake.idle();
  // content.js starts swapping a task after it loads (the segmenter's warm-up, slice 15);
  // asking the background for a sync is the last thing it does.
  for (let i = 0; i < 400 && !fake.calls.sendMessage.some((m) => m.type === "sync"); i++) await sleep(5);
  await sleep(0);
  const doc = dom.window.document;
  return {
    dom,
    fake,
    doc,
    $: (id) => doc.getElementById(id),
    spans: () => [...doc.querySelectorAll("kotiko-w")],
    // Changes extension storage and waits for content.js to react.
    async set(patch) {
      await fake.chrome.storage.local.set(patch);
      await fake.idle();
    },
  };
}

describe("swapping", () => {
  test("clearing storage (slice 12's delete everything) puts the page's own words back", async () => {
    const { $, fake, spans } = await load(`<p id="p">My house is your house.</p>`);
    assert.equal($("p").textContent, "My дом is your дом.");
    await fake.chrome.storage.local.clear();
    await fake.idle();
    await sleep(FLUSH_MS);
    assert.equal($("p").textContent, "My house is your house.");
    assert.equal(spans().length, 0);
  });

  test("swaps known words into <kotiko-w> elements that carry no word data (slice 15)", async () => {
    const { $, spans } = await load(`<p id="p">My house is your house.</p>`);
    assert.equal($("p").textContent, "My дом is your дом.");
    const [s] = spans();
    assert.equal(s.localName, "kotiko-w");
    assert.equal(s.lang, "ru");
    assert.equal(s.dir, "auto");
    assert.equal(s.getAttribute("translate"), "no");
    assert.equal(s.className, "notranslate");
    // Only rendering and translation hints: no title, no data-*, no aria-*, no id.
    assert.deepEqual(s.getAttributeNames().sort(), ["class", "dir", "lang", "translate"]);
  });

  test("keeps the English casing; a short all-capitals word is an acronym unless the line shouts (slice 16)", async () => {
    const { $ } = await load(`<p id="p">House. HOUSE! house?</p><p id="q">THIS HOUSE IS MINE</p>`);
    assert.equal($("p").textContent, "Дом. HOUSE! дом?");
    assert.equal($("q").textContent, "THIS ДОМ IS MINE");
  });

  test("one language for every occurrence of a word; the original word and the others stay out of the page DOM", async () => {
    const { doc, spans } = await load("<p>thanks thanks thanks</p><p>Many thanks.</p>");
    assert.equal(spans().length, 4);
    assert.equal(new Set(spans().map((s) => s.lang)).size, 1, "slice 18: one language per page per day");
    assert.ok(spans().every((s) => !s.hasAttribute("title") && !Object.keys(s.dataset).length));
    assert.doesNotMatch(doc.documentElement.outerHTML, /thanks|spasibo|Mandarin|Russian/);
  });

  test("leaves code, form fields, editors and scripts alone", async () => {
    const { $, spans } = await load(`
      <pre id="pre">house</pre><code id="code">house</code><textarea id="ta">house</textarea>
      <div id="ce" contenteditable="true"><p>house</p></div><script id="js">var house = "house";</script>
      <p id="p">house</p>`);
    assert.equal(spans().length, 1);
    assert.equal($("p").textContent, "дом");
    assert.equal($("pre").textContent, "house");
    assert.equal($("code").textContent, "house");
    assert.equal($("ta").value, "house");
    assert.equal($("ce").textContent, "house");
    assert.equal($("js").textContent, `var house = "house";`);
  });

  test("swaps text added after load once the batch flushes", async () => {
    const { $ } = await load(`<p id="p">nothing yet</p><div id="late"></div>`);
    $("late").textContent = "A late house appears.";
    assert.equal($("late").textContent, "A late house appears.");
    await sleep(FLUSH_MS);
    assert.equal($("late").textContent, "A late дом appears.");
  });

  test("never puts the word list into markup", async () => {
    const evil = word("<img src=x onerror=alert(1)>", "house", ["house"], "ru", { note: "<b>note</b>" });
    const { doc, spans } = await load("<p>house</p>", { words: [evil] });
    assert.equal(doc.querySelector("img"), null);
    assert.equal(spans()[0].textContent, "<img src=x onerror=alert(1)>");
  });

  test("asks the background for a sync on load", async () => {
    const { fake } = await load("<p>house</p>");
    assert.deepEqual(fake.calls.sendMessage, [{ type: "sync" }]);
  });
});

// DECISIONS "Buttons and menus stay in the learner's own language" and slice 16's control
// rules, done early after a maintainer report: toggles labelled "AOI I" / "AOI II" showed
// "AOI Я" for a learner who saved я ("I").
describe("screen readers and keyboards (slice 27 §2)", () => {
  const heard = (el) => [...(el.querySelector("kotiko-sr")?.childNodes ?? [])].map((c) => (c.nodeType === 1 ? `${c.textContent}@${c.lang}` : c.textContent));

  test("by default the word is the element's only text, in its own language, and no Tab stop", async () => {
    const { spans } = await load(`<p id="p">House prices are up.</p>`);
    const [w] = spans();
    assert.equal(w.textContent, "Дом");
    assert.equal(w.lang, "ru");
    assert.deepEqual(w.getAttributeNames().sort(), ["class", "dir", "lang", "translate"]);
    assert.equal(w.querySelector("kotiko-sr, kotiko-v"), null);
  });

  test("the original word: shown word hidden from screen readers, the page's own text in the page's language", async () => {
    const { spans, $ } = await load(`<p id="p">House prices are up.</p>`, { prefs: { screenReader: "original" } });
    const [w] = spans();
    assert.equal(w.querySelector("kotiko-v").textContent, "Дом");
    assert.equal(w.querySelector("kotiko-v").getAttribute("aria-hidden"), "true");
    assert.deepEqual(heard(w), ["House@en"], "the page's own capitals, tagged with the page text's language");
    assert.equal(w.lang, "ru");
    assert.equal($("p").textContent, "ДомHouse prices are up.", "both are in the DOM (the setting says sites can read it)");
  });

  test("both: the word, then the original, each in its own language", async () => {
    const { spans } = await load("<p>thanks for the house</p>", { words: [WORDS[0]], prefs: { screenReader: "both" } });
    assert.deepEqual(heard(spans()[0]), ["дом@ru", ", ", "house@en"]);
  });

  test("a Spanish page: the hidden original is tagged Spanish", async () => {
    const perro = word("dog", "perro", ["perro"], "en", { base_lang: "es" });
    const { spans } = await load("<p>el perro duerme</p>", { words: [perro], lang: "es", baseLangs: ["es"], prefs: { screenReader: "original" } });
    assert.equal(spans()[0].lang, "en");
    assert.deepEqual(heard(spans()[0]), ["perro@es"]);
  });

  test("changing the setting re-swaps in place; Tab stops come and go with their switch", async () => {
    const { spans, set } = await load(`<p id="p">My house is here.</p>`);
    await set({ prefs: { screenReader: "original", keyboardSwaps: true } });
    await sleep(FLUSH_MS);
    assert.deepEqual(heard(spans()[0]), ["house@en"]);
    assert.equal(spans()[0].getAttribute("tabindex"), "0");
    await set({ prefs: {} });
    await sleep(FLUSH_MS);
    assert.equal(spans()[0].textContent, "дом");
    assert.equal(spans()[0].hasAttribute("tabindex"), false);
  });
});

describe("controls stay as the site wrote them", () => {
  const I = word("я", "I", ["I"], "ru", { language: "Russian" });
  const CTL_WORDS = [...WORDS, I];
  const ctl = (html, opts = {}) => load(html, { words: CTL_WORDS, ...opts });

  test("AOI I / AOI II toggles as role=radio divs", async () => {
    const { $, spans } = await ctl(`
      <div role="radiogroup"><div id="t1" role="radio" aria-checked="true">AOI I</div><div id="t2" role="radio">AOI II</div></div>
      <div id="t3" role="switch">My house</div>`);
    assert.equal($("t1").textContent, "AOI I");
    assert.equal($("t2").textContent, "AOI II");
    assert.equal($("t3").textContent, "My house");
    assert.equal(spans().length, 0);
  });

  test("AOI I / AOI II toggles as labels and as cursor: pointer divs", async () => {
    const { $, spans } = await ctl(`
      <style>.toggle { cursor: pointer; padding: 4px }</style>
      <label id="l1"><input type="radio" name="a">House I</label>
      <div id="d1" class="toggle">My house</div>
      <div id="d2" style="cursor:pointer"><span id="d2s">thanks</span></div>
      <p id="p">I think the house is nice.</p>`);
    assert.equal($("l1").textContent, "House I");
    assert.equal($("d1").textContent, "My house");
    assert.equal($("d2").textContent, "thanks");
    assert.equal($("p").textContent, "Я think the дом is nice.");
    assert.equal(spans().length, 2);
  });

  test("buttons, option lists, menus, tabs, nav and summary", async () => {
    const { $, spans } = await ctl(`
      <button id="b"><span>Thanks</span></button>
      <ul role="listbox"><li id="o1" role="option">house</li><li id="o2" role="option">thanks</li></ul>
      <div role="menu"><div id="m" role="menuitem">My house</div></div>
      <div role="tablist"><div id="tab" role="tab">House</div></div>
      <nav id="nav"><a href="#">House</a></nav>
      <details><summary id="sum">House rules</summary><p id="det">The house rules.</p></details>
      <a id="pop" href="#" aria-haspopup="menu">House</a>`);
    for (const id of ["b", "o1", "o2", "m", "tab", "nav", "sum", "pop"]) assert.doesNotMatch($(id).textContent, /дом|спасибо/, id);
    assert.equal($("det").textContent, "The дом rules.", "the details body is content");
    assert.equal(spans().length, 1);
  });

  test("everything inside a form, unless the form wraps the page", async () => {
    const { $ } = await ctl(`
      <form><p id="f">Thanks for your house details.</p><legend id="lg">House</legend></form>
      <form><main><p id="wrapped">A house.</p><button id="wb">House</button></main></form>`);
    assert.equal($("f").textContent, "Thanks for your house details.");
    assert.equal($("lg").textContent, "House");
    assert.equal($("wrapped").textContent, "A дом.");
    assert.equal($("wb").textContent, "House");
  });

  test("a tabindex=0 chip, but not a tabindex on <main> or a long focusable area", async () => {
    const { $ } = await ctl(`
      <span id="chip" tabindex="0">house</span>
      <main tabindex="-1"><p id="p">My house.</p></main>
      <article tabindex="0"><p id="a">Your house.</p></article>
      <div id="scroll" tabindex="0"><table><tr><td>A long table about the house and the garden around it.</td></tr></table></div>`);
    assert.equal($("chip").textContent, "house");
    assert.equal($("p").textContent, "My дом.");
    assert.equal($("a").textContent, "Your дом.");
    assert.match($("scroll").textContent, /дом/);
  });

  test("links in text and long clickable cards are still swapped", async () => {
    const { $ } = await ctl(`
      <p id="p">Read about <a href="#">the house</a> here.</p>
      <div id="card" style="cursor:pointer"><h3>Big news</h3><p id="cp">A house by the sea sold for a record price today.</p></div>`);
    assert.equal($("p").textContent, "Read about the дом here.");
    assert.equal($("cp").textContent, "A дом by the sea sold for a record price today.");
  });

  test("text added later inside a control stays", async () => {
    const { $ } = await ctl(`<div id="tl" role="tablist"></div><div id="late"></div>`);
    $("tl").innerHTML = `<div role="tab">House</div>`;
    $("late").textContent = "A house.";
    await sleep(FLUSH_MS);
    assert.equal($("tl").textContent, "House");
    assert.equal($("late").textContent, "A дом.");
  });

  test("reads computed styles only around matches, once per element", async () => {
    const seen = [];
    const { spans } = await ctl(
      `<div><p>No known words here.</p><p>None here either.</p></div>
       <div id="d"><p>My house.</p><p>Your house.</p></div>`,
      {
        beforeInject(dom) {
          const real = dom.window.getComputedStyle.bind(dom.window);
          dom.window.getComputedStyle = (el, ...rest) => {
            seen.push(el);
            return real(el, ...rest);
          };
        },
      },
    );
    assert.equal(spans().length, 2);
    assert.ok(seen.length > 0);
    assert.equal(new Set(seen).size, seen.length, "no element read twice");
    assert.ok(seen.every((el) => el.id === "d" || el.closest("#d") || el.nodeName === "BODY"), "only #d's chain");
  });
});

describe("a lone capital that is a numeral or code", () => {
  const I = word("я", "I", ["I"], "ru", { language: "Russian" });

  test("World War I, Type I, I-95 and AOI I stay; I think swaps", async () => {
    const { $ } = await load(
      `<p id="a">World War I began in 1914.</p><p id="b">Type I</p><p id="c">Take I-95 north.</p>
       <p id="d">AOI I and AOI II</p><p id="e">I think so, and so do I.</p>
       <p id="f"><b>AOI</b> I</p><p id="g"><span>AOI</span><span>I</span></p>`,
      { words: [I] },
    );
    assert.equal($("a").textContent, "World War I began in 1914.");
    assert.equal($("b").textContent, "Type I");
    assert.equal($("c").textContent, "Take I-95 north.");
    assert.equal($("d").textContent, "AOI I and AOI II");
    assert.equal($("e").textContent, "Я think so, and so do я.", "AOI II in the block before doesn't count; mid-sentence, English's own capital isn't passed on (slice 17)");
    assert.equal($("f").textContent, "AOI I", "the acronym is in a sibling element");
    assert.equal($("g").textContent, "AOII", "the acronym is in the parent's sibling");
  });
});

describe("restoring", () => {
  const ORIGINAL = "Thanks for the house.\n   Thank   you, HOUSES! (thanks)";

  test("turning swapping off restores the text exactly", async () => {
    const { $, spans, set } = await load(`<p id="p">${ORIGINAL}</p>`);
    assert.notEqual($("p").textContent, ORIGINAL);
    await set({ enabled: false });
    assert.equal(spans().length, 0);
    assert.equal($("p").textContent, ORIGINAL);
    assert.equal($("p").childNodes.length, 1, "restored into one text node");
  });

  test("turning it back on swaps again", async () => {
    const { $, set } = await load(`<p id="p">my house</p>`);
    await set({ enabled: false });
    await set({ enabled: true });
    assert.equal($("p").textContent, "my дом");
  });

  test("a word list change re-applies without leaving old swaps behind", async () => {
    const { $, set, spans } = await load(`<p id="p">house and thanks</p>`);
    await set({ words: [word("casa", "house", ["house"], "es")] });
    assert.equal($("p").textContent, "casa and thanks");
    assert.deepEqual(spans().map((s) => s.lang), ["es"]);
  });

  test("starting disabled swaps nothing", async () => {
    const { $, spans } = await load(`<p id="p">my house</p>`, { enabled: false });
    assert.equal(spans().length, 0);
    assert.equal($("p").textContent, "my house");
  });
});

describe("after the rename", () => {
  // Spans the content script made before the rename, with its old class, still in a tab
  // that was open during the update. legacy-name-ok
  const OLD = "slovo-w"; // legacy-name-ok
  const oldSpan = (en, native) => `<span class="${OLD}" data-en="${en}" lang="ru" dir="auto">${native}</span>`;

  test("old spans go back to the page's own text", async () => {
    const { $, doc, spans } = await load(
      `<p id="p">My ${oldSpan("House", "Дом")} is your ${oldSpan("house", "дом")}.</p><p id="q">${oldSpan("thanks", "спасибо")}</p>`,
      { words: [] },
    );
    assert.equal(doc.querySelectorAll(`span.${OLD}`).length, 0);
    assert.equal($("p").textContent, "My House is your house.");
    assert.ok([...$("p").childNodes].every((n) => n.nodeType === 3), "only text: no normalize(), so it may be several nodes (slice 15)");
    assert.equal($("q").textContent, "thanks");
    assert.equal(spans().length, 0);
  });

  test("then the page is swapped as usual, with the new class", async () => {
    const { $, doc, spans } = await load(`<p id="p">My ${oldSpan("house", "дом")} is big.</p>`);
    assert.equal(doc.querySelectorAll(`span.${OLD}`).length, 0);
    assert.equal($("p").textContent, "My дом is big.");
    assert.equal(spans().length, 1);
    assert.equal(spans()[0].localName, "kotiko-w");
    assert.equal(spans()[0].hasAttribute("data-en"), false);
  });

  test("swaps from before the <kotiko-w> element (span.kotiko-w with data-en) go back too", async () => {
    const { $, doc } = await load(
      `<p id="p">My <span class="kotiko-w" data-en="house" lang="ru" dir="auto" title="house = дом · Russian">дом</span>.</p>`,
      { enabled: false },
    );
    assert.equal(doc.querySelectorAll("span.kotiko-w").length, 0);
    assert.equal($("p").textContent, "My house.");
    assert.ok([...$("p").childNodes].every((n) => n.nodeType === 3));
  });

  test("switched off, the old spans are still restored", async () => {
    const { $, doc } = await load(`<p id="p">My ${oldSpan("house", "дом")}.</p>`, { enabled: false });
    assert.equal(doc.querySelectorAll(`span.${OLD}`).length, 0);
    assert.equal($("p").textContent, "My house.");
  });
});

describe("hidden languages", () => {
  test("hiding a language shows only the others", async () => {
    const { $, set, spans } = await load(`<p id="p">thanks thanks, thank you</p>`);
    await set({ hiddenLangs: ["ru", "zh"] });
    assert.ok(spans().length > 0);
    assert.ok(spans().every((s) => s.lang === "ar"));
    assert.equal($("p").textContent, "شكرا شكرا, thank you", "Arabic has no 'thank you' form");
  });

  test("hiding every language restores the page", async () => {
    const { $, spans } = await load(`<p id="p">my house</p>`, { hiddenLangs: ["ru", "zh", "ar"] });
    assert.equal(spans().length, 0);
    assert.equal($("p").textContent, "my house");
  });
});

describe("paused sites", () => {
  test("a paused host is left alone", async () => {
    const { $, spans } = await load(`<p id="p">my house</p>`, {
      url: "https://news.example.com/a",
      pausedHosts: ["news.example.com"],
    });
    assert.equal(spans().length, 0);
    assert.equal($("p").textContent, "my house");
  });

  test("pausing and unpausing the current host", async () => {
    const { $, set } = await load(`<p id="p">my house</p>`, { url: "https://news.example.com/a" });
    await set({ pausedHosts: ["other.example.com", "news.example.com"] });
    assert.equal($("p").textContent, "my house");
    await set({ pausedHosts: ["other.example.com"] });
    assert.equal($("p").textContent, "my дом");
  });

  test("pausing another host changes nothing here", async () => {
    const { $ } = await load(`<p id="p">my house</p>`, {
      url: "https://news.example.com/a",
      pausedHosts: ["example.com"],
    });
    assert.equal($("p").textContent, "my дом");
  });
});

// Research 06 F02 and F03: frameworks keep references to their text nodes. Slice 15
// keeps the site's nodes in place instead of replacing them.
describe("node identity (slice 15)", () => {
  test("F02: a swapped text node stays connected and updatable", async () => {
    const { doc, $, set } = await load(`<div id="r"></div>`, { words: [] });
    const r = $("r");
    const t1 = doc.createTextNode("You have ");
    const t2 = doc.createTextNode("3");
    const t3 = doc.createTextNode(" new messages from your friends");
    r.append(t1, t2, t3);
    await set({ words: [word("сообщение", "messages"), word("друг", "friends")] });
    assert.equal(t3.isConnected, true, "the site's node is still in the page");
    t3.nodeValue = " new alerts";
    await sleep(FLUSH_MS);
    assert.equal(r.textContent, "You have 3 new alerts");
    assert.doesNotThrow(() => r.removeChild(t3));
  });

  test("F02: unwrapping restores the original node objects", async () => {
    const { $, set } = await load(`<p id="p">my house</p>`);
    const p = $("p");
    await set({ enabled: false });
    const restored = p.firstChild;
    await set({ enabled: true });
    await set({ enabled: false });
    assert.equal(p.firstChild, restored, "the same text node after a second round trip");
  });

  test("F03: re-applying doesn't merge the site's own text nodes", async () => {
    const { doc, $, set } = await load(`<div id="r"></div>`);
    const r = $("r");
    const a = doc.createTextNode("Hello ");
    const b = doc.createTextNode("Bob");
    const c = doc.createTextNode(", nice house");
    r.append(a, b, c);
    await sleep(FLUSH_MS);
    await set({ hiddenLangs: ["xx"] }); // any setting change re-applies
    assert.equal(a.isConnected, true);
    assert.equal(b.isConnected, true);
    b.nodeValue = "Alice";
    assert.match(r.textContent, /^Hello Alice, nice /);
  });
});

// Slices 50 and 16: Kotiko swaps words only in the languages the learner reads, each part of
// the page with its own language's words.
describe("pages in the learner's languages", () => {
  const w = (native, lang, base, forms) => ({ id: nextId++, lang, native, base_lang: base, gloss: forms[0], forms, status: "active" });
  const ES = [w("犬", "ja", "es", ["perro", "perros"]), w("house", "en", "es", ["casa"])];
  const EN = [w("perro", "es", "en", ["dog"])];
  const sure = (language, percentage = 95) => () => ({ isReliable: true, languages: [{ language, percentage }] });
  const POPUP = { id: "fake-extension-id", url: "chrome-extension://fake-extension-id/popup.html" };

  test("a Spanish reader's Spanish page is swapped; an English page is left alone", async () => {
    const es = await load(`<p id="p">¿Tienes un perro en casa?</p>`, { lang: "es", words: ES, baseLangs: ["es"] });
    assert.equal(es.$("p").textContent, "¿Tienes un 犬 en house?");
    const en = await load(`<p id="p">The perro is a Spanish word.</p>`, { lang: "en", words: ES, baseLangs: ["es"] });
    assert.equal(en.$("p").textContent, "The perro is a Spanish word.");
  });

  test("a page whose template says English but is surely Spanish is read as Spanish", async () => {
    const { $ } = await load(`<p id="p">Mi perro duerme en la casa.</p>`, { lang: "en", words: ES, baseLangs: ["es"], detect: sure("es") });
    assert.equal($("p").textContent, "Mi 犬 duerme en la house.");
  });

  test("an undeclared page goes by detection", async () => {
    const yes = await load(`<p id="p">Mi perro duerme.</p>`, { lang: null, words: ES, baseLangs: ["es"], detect: sure("es", 70) });
    assert.equal(yes.$("p").textContent, "Mi 犬 duerme.");
    const no = await load(`<p id="p">Mein perro schläft.</p>`, { lang: null, words: ES, baseLangs: ["es"], detect: sure("de", 90) });
    assert.equal(no.$("p").textContent, "Mein perro schläft.");
  });

  test("a short undeclared page goes by its common words", async () => {
    const baseRules = { es: { boundaries: { spaces: true }, stopwords: ["mi", "en", "la", "el"] } };
    const yes = await load(`<p id="p">Mi perro en la casa</p>`, { lang: null, words: ES, baseLangs: ["es"], baseRules });
    assert.equal(yes.$("p").textContent, "Mi 犬 en la house");
    const no = await load(`<p id="p">Mi perro en la casa</p>`, { lang: null, words: ES, baseLangs: ["es"] });
    assert.equal(no.$("p").textContent, "Mi perro en la casa", "no common words to go by");
  });

  test("a bilingual reader gets each part of the page in its own language", async () => {
    const { $ } = await load(`<p id="p">Dijo que su perro <q id="q" lang="en">is a good dog</q>.</p>`, { lang: "es", words: [...ES, ...EN], baseLangs: ["es", "en"] });
    assert.equal($("q").textContent, "is a good perro");
    assert.equal($("p").textContent, "Dijo que su 犬 is a good perro.");
  });

  test("a quote in a language the learner doesn't read is left alone", async () => {
    const { $ } = await load(`<p id="p">A dog said <i id="i" lang="de">dog ist ein Wort</i>.</p>`, { words: EN, baseLangs: ["en"] });
    assert.equal($("i").textContent, "dog ist ein Wort");
    assert.equal($("p").textContent, "A perro said dog ist ein Wort.");
  });

  test("Japanese, written without spaces", async () => {
    const JA = [w("개", "ko", "ja", ["犬"]), w("like", "en", "ja", ["好き"])];
    const { $ } = await load(`<p id="p">犬が好きです。子犬も。</p>`, { lang: "ja", words: JA, baseLangs: ["ja"] });
    assert.equal($("p").textContent, "개がlikeです。子犬も。");
  });

  test("the popup can ask what Kotiko made of the page", async () => {
    const es = await load("<p>Mi perro</p>", { lang: "es", words: ES, baseLangs: ["es"] });
    assert.deepEqual(await es.fake.deliver({ type: "page-status" }, POPUP), { base: "es", reason: "declared", lang: "es", words: 3 });
    const de = await load("<p>Mein Hund</p>", { lang: "de", words: ES, baseLangs: ["es"] });
    assert.deepEqual(await de.fake.deliver({ type: "page-status" }, POPUP), { base: null, reason: "declared_other", lang: "de", words: 0 });
    assert.equal(await de.fake.deliver({ type: "page-status" }), undefined, "never to another tab's content script");
  });

  test("changing the learner's languages judges the page again", async () => {
    const { $, set } = await load(`<p id="p">Mi perro duerme.</p>`, { lang: "es", words: [...ES, ...EN], baseLangs: ["en"] });
    assert.equal($("p").textContent, "Mi perro duerme.");
    await set({ baseLangs: ["es"], baseRules: baseRulesFor(["es"]) });
    await sleep(50); // the page is judged again (an async language check) before the swap
    assert.equal($("p").textContent, "Mi 犬 duerme.");
    await set({ baseLangs: ["en"], baseRules: baseRulesFor(["en"]) });
    await sleep(50);
    assert.equal($("p").textContent, "Mi perro duerme.");
  });
});

// Slice 15: Kotiko changes the page without taking anything away from the site.
describe("framework-safe swapping (slice 15)", () => {
  const POPUP = { id: "fake-extension-id", url: "chrome-extension://fake-extension-id/popup.html" };
  // Every change to `el`'s subtree from now on, as [type, target text].
  function watch(dom, el) {
    const seen = [];
    new dom.window.MutationObserver((rs) => {
      for (const r of rs) seen.push(r.type);
    }).observe(el, { childList: true, subtree: true, characterData: true });
    return seen;
  }

  test("the site's text node keeps the text before the first swap; Kotiko's nodes follow it", async () => {
    const { $ } = await load(`<p id="p">My house is big</p>`);
    const p = $("p");
    assert.equal(p.firstChild.nodeValue, "My ");
    assert.equal(p.childNodes[1].localName, "kotiko-w");
    assert.equal(p.textContent, "My дом is big");
  });

  test("a site that re-renders its text many times is never mistaken for one undoing Kotiko", async () => {
    const { doc, $ } = await load(`<p id="p"></p>`);
    const t = doc.createTextNode("thanks 0");
    $("p").append(t);
    for (let i = 1; i <= 20; i++) {
      t.nodeValue = `thanks ${i}`;
      await sleep(0);
    }
    assert.equal($("p").querySelectorAll("kotiko-w").length, 1, "still swapped after 20 re-renders");
  });

  test("F08: a page that keeps undoing a swap stops being fought, and keeps its own text", async () => {
    const { dom, $ } = await load(`<p id="p">A good house.</p><p id="q">My house too.</p>`, {
      beforeInject: (d) => {
        const p = d.window.document.getElementById("p");
        const original = p.textContent;
        d.window.reverts = 0;
        new d.window.MutationObserver(() => {
          if (p.textContent !== original || p.childNodes.length !== 1) {
            d.window.reverts++;
            p.textContent = original;
          }
        }).observe(p, { childList: true, subtree: true, characterData: true });
      },
    });
    await sleep(100);
    const settled = dom.window.reverts;
    assert.ok(settled <= 8, `stopped after a few reverts, not ${settled}`);
    await sleep(300);
    assert.equal(dom.window.reverts, settled, "no more ping-pong");
    assert.equal($("p").textContent, "A good house.");
    assert.equal($("q").textContent, "My дом too.", "the rest of the page still swaps");
  });

  test("F25: a replaced body is swapped too", async () => {
    const { doc, $ } = await load("<p>old house</p>");
    const next = doc.createElement("body");
    next.innerHTML = `<p id="n">A new house after navigation.</p>`;
    doc.documentElement.replaceChild(next, doc.body);
    await sleep(0);
    assert.equal($("n").textContent, "A new дом after navigation.");
  });

  test("text a site adds is swapped before the next paint (in the observer's callback)", async () => {
    const { dom, doc, $ } = await load(`<div id="feed"></div>`);
    const p = doc.createElement("p");
    p.textContent = "Fresh house news";
    $("feed").append(p);
    await new Promise((r) => dom.window.queueMicrotask(r));
    await Promise.resolve();
    assert.equal(p.textContent, "Fresh дом news");
  });

  test("adding a word rewrites only the text that has it", async () => {
    const { dom, $, set } = await load(`<p id="a">my house</p><p id="b">many thanks</p>`, { words: [WORDS[0]] });
    const swap = $("a").querySelector("kotiko-w");
    const seen = watch(dom, $("a"));
    await set({ words: [WORDS[0], WORDS[1]] });
    await sleep(0);
    assert.equal($("a").querySelector("kotiko-w"), swap, "the same element, untouched");
    assert.deepEqual(seen, [], "no write at all where nothing changed");
    assert.equal($("b").textContent, "many спасибо");
  });

  test("a re-render keeps the same word in the same place", async () => {
    const { doc, $ } = await load(`<p id="p"></p>`);
    const t = doc.createTextNode("thanks a lot");
    $("p").append(t);
    await sleep(0);
    const first = $("p").querySelector("kotiko-w").textContent;
    for (let i = 0; i < 5; i++) {
      t.nodeValue = `thanks a lot ${i}`;
      await sleep(0);
      assert.equal($("p").querySelector("kotiko-w").textContent, first);
    }
  });

  test("an editor that gets focus gets its own text back", async () => {
    const { dom, $ } = await load(`<div id="e">the house</div>`);
    assert.equal($("e").textContent, "the дом");
    $("e").setAttribute("contenteditable", "true");
    $("e").dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true }));
    assert.equal($("e").textContent, "the house");
  });

  test("a hidden tab waits until it's shown to apply new words", async () => {
    const { doc, $, set } = await load(`<p id="p">many thanks</p>`, { words: [WORDS[0]] });
    Object.defineProperty(doc, "hidden", { configurable: true, get: () => true });
    await set({ words: [WORDS[0], WORDS[1]] });
    assert.equal($("p").textContent, "many thanks", "nothing done while hidden");
    Object.defineProperty(doc, "hidden", { configurable: true, get: () => false });
    doc.dispatchEvent(new doc.defaultView.Event("visibilitychange"));
    await sleep(0);
    assert.equal($("p").textContent, "many спасибо");
  });

  test("a page that undoes everything makes Kotiko step back, and the popup can say so", async () => {
    const paras = Array.from({ length: 60 }, (_, i) => `<p id="p${i}">house ${i}</p>`).join("");
    const { fake, doc } = await load(paras, {
      beforeInject: (d) => {
        const w = d.window;
        new w.MutationObserver(() => {
          for (const p of w.document.querySelectorAll("p")) if (p.querySelector("kotiko-w")) p.textContent = p.textContent.replace(/дом/g, "house");
        }).observe(w.document.body, { childList: true, subtree: true });
      },
    });
    for (let i = 0; i < 200 && doc.querySelectorAll("kotiko-w").length; i++) await sleep(10);
    assert.equal(doc.querySelectorAll("kotiko-w").length, 0, "every word put back");
    await sleep(100);
    assert.equal(doc.querySelectorAll("kotiko-w").length, 0, "and it stays that way");
    const status = await fake.deliver({ type: "page-status" }, POPUP);
    assert.ok(status.stoodDown || doc.querySelectorAll("p").length === 60);
  });
});

describe("starting up", () => {
  test("a word saved while the page is still starting up is applied, not missed", async () => {
    const fake = createFakeChrome({ local: { words: [], enabled: true, pausedHosts: [], hiddenLangs: [] }, onSendMessage: () => ({ ok: true }) });
    fake.chrome.i18n = { detectLanguage: async () => ({ isReliable: false, languages: [] }) };
    const dom = createPage({ html: `<p id="p">my house</p>`, chrome: fake.chrome });
    injectContentScripts(dom);
    await fake.chrome.storage.local.set({ words: WORDS });
    for (let i = 0; i < 400 && !fake.calls.sendMessage.some((m) => m.type === "sync"); i++) await sleep(5);
    await sleep(10);
    assert.equal(dom.window.document.getElementById("p").textContent, "my дом");
  });
});

describe("never take the site's nodes (slice 15)", () => {
  test("the content scripts never normalize, replaceChild or replaceWith", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { ROOT } = await import("../helpers/load-script.mjs");
    for (const rel of ["extension/content.js", "extension/content/engine.js", "extension/content/popover.js"]) {
      const code = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(code, /\.normalize\(\s*\)|\.replaceChild\(|\.replaceWith\(/, rel);
    }
  });
});

// Slice 16 §2: places where swapping would corrupt what the user reads or types.
describe("element rules (slice 16)", () => {
  test("code editors and views, editable roles, the site's own opt-outs and login forms are left alone", async () => {
    const { $ } = await load(`
      <p id="out">A house outside.</p>
      <div class="cm-editor"><div id="cm" class="cm-line">const house = 1;</div></div>
      <div class="monaco-editor"><span id="mo">house</span></div>
      <pre><code id="code">house</code></pre>
      <div class="highlight"><span id="hl">house</span></div>
      <code class="language-js" id="lang">house</code>
      <div role="textbox" id="tb">house</div>
      <div translate="no" id="tn">house</div>
      <div class="notranslate" id="nt">house</div>
      <div data-kotiko-skip id="ks">house</div>
      <div data-slovo-skip id="ss">house</div> <!-- legacy-name-ok -->
      <form id="login"><label>house</label><input type="password"><p id="lp">a house</p></form>
      <form id="pay"><p id="pp">a house</p><input autocomplete="cc-number"></form>`);
    assert.equal($("out").textContent, "A дом outside.");
    for (const id of ["cm", "mo", "code", "hl", "lang", "tb", "tn", "nt", "ks", "ss", "lp", "pp"]) assert.match($(id).textContent, /house/, id);
  });

  test("translate=no on <html> or <body> doesn't stop Kotiko (React sites set it there)", async () => {
    const { $ } = await load(`<!doctype html><html lang="en" translate="no"><body class="notranslate"><p id="p">my house</p></body></html>`);
    assert.equal($("p").textContent, "my дом");
  });

  test("text added later inside a code editor stays as written", async () => {
    const { doc, $ } = await load(`<div class="cm-editor"><div id="ed"></div></div>`);
    $("ed").append(doc.createTextNode("let house = 2;"));
    await sleep(0);
    assert.equal($("ed").textContent, "let house = 2;");
  });

  test("a sentence-start capital waits for the rest of the page", async () => {
    const W = [word("яблоко", "apple", ["apple"])];
    const proper = await load(`<p id="a">Apple announced a phone.</p><p id="b">We met at Apple today.</p>`, { words: W });
    assert.equal(proper.$("a").textContent, "Apple announced a phone.", "Apple is a name on this page");
    const food = await load(`<p id="a">Apple pie is sweet.</p><p id="b">I ate an apple.</p>`, { words: W });
    assert.equal(food.$("a").textContent, "Яблоко pie is sweet.");
    assert.equal(food.$("b").textContent, "I ate an яблоко.");
  });
});

describe("a page in a language the learner doesn't read (slice 16 §1)", () => {
  test("a German page is left alone, but its English quote is swapped", async () => {
    const { $ } = await load(`<p id="de">Das Haus ist groß.</p><p id="en" lang="en">my house</p>`, { lang: "de" });
    assert.equal($("de").textContent, "Das Haus ist groß.");
    assert.equal($("en").textContent, "my дом");
  });
});

// Slice 16 §§4-5: sensitive sites, the two settings and the never-swap list.
describe("sensitive sites and page settings (slice 16)", () => {
  const POPUP = { id: "fake-extension-id", url: "chrome-extension://fake-extension-id/popup.html" };
  const SITES = [{ pattern: "chase.com", category: "banking" }, { pattern: "mail.google.com/*compose=*", category: "email" }];
  const PAGE = `<p id="p">my house</p>`;

  test("a sensitive site is left alone, and the popup can say why", async () => {
    const { $, fake } = await load(PAGE, { url: "https://secure.chase.com/", sensitiveSites: SITES });
    assert.equal($("p").textContent, "my house");
    assert.equal((await fake.deliver({ type: "page-status" }, POPUP)).sensitive, "banking");
  });

  test("turning the setting off, or running on that site anyway, swaps again", async () => {
    const off = await load(PAGE, { url: "https://secure.chase.com/", sensitiveSites: SITES, prefs: { sensitiveSites: false } });
    assert.equal(off.$("p").textContent, "my дом");
    const allowed = await load(PAGE, { url: "https://secure.chase.com/", sensitiveSites: SITES });
    await allowed.set({ prefs: { sensitiveAllowed: ["secure.chase.com"] } });
    assert.equal(allowed.$("p").textContent, "my дом");
    assert.equal((await allowed.fake.deliver({ type: "page-status" }, POPUP)).sensitive, undefined);
  });

  test("other sites, and the list arriving late from the background", async () => {
    const other = await load(PAGE, { url: "https://example.com/", sensitiveSites: SITES });
    assert.equal(other.$("p").textContent, "my дом");
    const asked = await load(PAGE, { url: "https://www.chase.com/", sensitiveSites: undefined });
    assert.ok(asked.fake.calls.sendMessage.some((m) => m.type === "sensitiveSites"), "no list in storage: asks the background");
  });

  test("buttons and menus stay as the site wrote them unless the setting is on", async () => {
    const html = `<p id="p">my house</p><button id="b">house</button><nav id="n">house</nav><div role="menuitem" id="m">house</div>`;
    const { $, set } = await load(html);
    assert.equal($("p").textContent, "my дом");
    for (const id of ["b", "n", "m"]) assert.equal($(id).textContent, "house", id);
    await set({ prefs: { swapControls: true } });
    for (const id of ["b", "n", "m"]) assert.equal($(id).textContent, "дом", id);
  });

  test("a word on the never-swap list stays, on every page, until it is taken off", async () => {
    const { $, set } = await load(`<p id="p">my house, thanks</p>`, { prefs: { neverSwap: ["house"] } });
    assert.equal($("p").textContent, "my house, спасибо");
    await set({ prefs: { neverSwap: [] } });
    assert.equal($("p").textContent, "my дом, спасибо");
  });

  test("a theme change in prefs doesn't re-swap the page", async () => {
    const { $, set } = await load(PAGE);
    const before = $("p").querySelector("kotiko-w");
    await set({ prefs: { theme: "dark" } });
    assert.equal($("p").querySelector("kotiko-w"), before);
  });
});

// Slice 17: swapped words in their own language's capitals, whatever the page's.
describe("casing (slice 17)", () => {
  test("an English learner reading Spanish: el lunes -> el Monday, yo creo -> I creo, Perro -> Dog", async () => {
    const W = [word("Monday", "lunes", ["lunes"], "en", { base_lang: "es" }), word("I", "yo", ["yo"], "en", { base_lang: "es" }), word("dog", "perro", ["perro"], "en", { base_lang: "es" })];
    const { $ } = await load(`<p id="a">Nos vemos el lunes.</p><p id="b">Y yo creo que sí.</p><p id="c">Perro grande.</p>`, { words: W, lang: "es", baseLangs: ["es"] });
    assert.equal($("a").textContent, "Nos vemos el Monday.");
    assert.equal($("b").textContent, "Y I creo que sí.");
    assert.equal($("c").textContent, "Dog grande.");
  });

  test("a German page: nouns' capitals stay German; a sentence start still capitalises", async () => {
    const W = [word("perro", "Hund", ["Hund"], "es", { base_lang: "de" })];
    const { $ } = await load(`<p id="a">Der Hund bellt.</p><p id="b">Hund und Katze.</p>`, { words: W, lang: "de", baseLangs: ["de"] });
    assert.equal($("a").textContent, "Der perro bellt.");
    assert.equal($("b").textContent, "Perro und Katze.");
  });

  test("Turkish dotted İ, Georgian never in capitals, Monday in lowercase Spanish", async () => {
    const W = [word("işçi", "worker", ["worker"], "tr"), word("მადლობა", "thanks", ["thanks"], "ka"), word("lunes", "Monday", [{ text: "Monday", case: "proper" }], "es")];
    const { $ } = await load(`<p id="a">Worker rights.</p><p id="b">Thanks a lot. THANK YOU ALL, THANKS AGAIN!</p><p id="c">See you on Monday. Monday works.</p>`, { words: W });
    assert.equal($("a").textContent, "İşçi rights.");
    assert.equal($("b").textContent, "მადლობა a lot. THANK YOU ALL, მადლობა AGAIN!");
    assert.equal($("c").textContent, "See you on lunes. Lunes works.");
  });
});

// Slice 18: which language each word shows.
describe("language precedence (slice 18)", () => {
  const twenty = `<p id="p">${"Many thanks again. ".repeat(20)}</p>`;
  const langs = (spans) => spans().map((s) => s.lang);

  test("20 thanks show the same word, in balanced and in priority mode", async () => {
    const balanced = await load(twenty);
    assert.equal(balanced.spans().length, 20);
    assert.equal(new Set(langs(balanced.spans)).size, 1);
    const priority = await load(twenty, { mixing: { mode: "priority", priority: ["zh", "ru"] } });
    assert.deepEqual([...new Set(langs(priority.spans))], ["zh"]);
  });

  test("adding an unrelated word changes nothing on the page", async () => {
    const { doc, dom, set, fake } = await load("<p>many thanks, my house</p><p>thanks again</p>");
    let writes = 0;
    new dom.window.MutationObserver((r) => (writes += r.length)).observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true });
    const words = await fake.chrome.storage.local.get("words");
    await set({ words: [...words.words, word("кошка", "cat")] });
    await sleep(50);
    assert.equal(writes, 0);
  });

  test("mix within the page: occurrences rotate through every language; a re-render keeps them", async () => {
    const { doc, $, spans } = await load(`<p id="p">Thanks a. Thanks b. Thanks c. Thanks d. Thanks e. Thanks f.</p>`, { mixing: { mode: "mix" } });
    const first = langs(spans);
    assert.equal(new Set(first).size, 3, "ru, zh and ar each appear");
    assert.deepEqual(first.slice(3), first.slice(0, 3), "in rotation");
    // The site re-renders the paragraph with the same text.
    $("p").replaceWith(Object.assign(doc.createElement("p"), { id: "p", textContent: "Thanks a. Thanks b. Thanks c. Thanks d. Thanks e. Thanks f." }));
    await sleep(50);
    assert.deepEqual(langs(spans), first);
  });

  test("focus: only the focused language, including over hidden; a word only in others stays", async () => {
    const { $, spans } = await load(`<p id="p">thanks for the house</p>`, { mixing: { focus: ["zh"] }, hiddenLangs: ["zh"] });
    assert.deepEqual(langs(spans), ["zh"]);
    assert.equal($("p").textContent, "谢谢 for the house", "house is only in Russian");
  });

  test("hiding the winning language moves only that word", async () => {
    const page = await load("<p>thanks</p>");
    const winner = langs(page.spans)[0];
    await page.set({ hiddenLangs: [winner] });
    assert.notEqual(langs(page.spans)[0], winner);
  });

  test("bases es and en: the Spanish text from Spanish records, the English quote from English ones", async () => {
    const W = [word("собака", "dog", ["dog"], "ru"), word("犬", "perro", ["perro"], "ja", { base_lang: "es" }), word("dog", "perro", ["perro"], "en", { base_lang: "es" })];
    const { spans, $ } = await load(`<p id="es">El perro duerme.</p><blockquote id="en" lang="en">The dog sleeps.</blockquote>`, { words: W, lang: "es", baseLangs: ["es", "en"] });
    assert.equal(spans().length, 2);
    assert.ok(["El 犬 duerme.", "El dog duerme."].includes($("es").textContent));
    assert.equal($("en").textContent, "The собака sleeps.");
  });

  test("a word that is the page's own word is not swapped", async () => {
    const { $ } = await load(`<p id="p">no thanks</p>`, { words: [word("no", "no", ["no"], "es"), word("спасибо", "thanks")] });
    assert.equal($("p").textContent, "no спасибо");
  });

  test("nothing about the page's address is stored", async () => {
    const { fake } = await load("<p>thanks</p>", { url: "https://news.example.org/story?id=7" });
    assert.doesNotMatch(JSON.stringify(fake.store), /news\.example|story|id=7/);
  });
});
