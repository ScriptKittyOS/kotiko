// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// content.js in jsdom, loaded the way the manifest injects it (lib/matcher.js and
// lib/controls.js first).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { createPage, injectContentScripts, sleep } from "../helpers/load-script.mjs";

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

async function load(html, { words = WORDS, url = "https://example.com/", beforeInject, ...local } = {}) {
  const fake = createFakeChrome({
    local: { words, enabled: true, pausedHosts: [], hiddenLangs: [], ...local },
    onSendMessage: () => ({ ok: true }),
  });
  const dom = createPage({ html, url, chrome: fake.chrome });
  beforeInject?.(dom);
  injectContentScripts(dom);
  await fake.idle();
  await sleep(0);
  const doc = dom.window.document;
  return {
    dom,
    fake,
    doc,
    $: (id) => doc.getElementById(id),
    spans: () => [...doc.querySelectorAll("span.kotiko-w")],
    // Changes extension storage and waits for content.js to react.
    async set(patch) {
      await fake.chrome.storage.local.set(patch);
      await fake.idle();
    },
  };
}

describe("swapping", () => {
  test("swaps known words into marked spans", async () => {
    const { $, spans } = await load(`<p id="p">My house is your house.</p>`);
    assert.equal($("p").textContent, "My дом is your дом.");
    const [s] = spans();
    assert.equal(s.dataset.en, "house");
    assert.equal(s.lang, "ru");
    assert.equal(s.dir, "auto");
    assert.equal(s.title, "house = дом · Russian");
  });

  test("keeps the English casing", async () => {
    const { $ } = await load(`<p id="p">House. HOUSE! house?</p>`);
    assert.equal($("p").textContent, "Дом. ДОМ! дом?");
  });

  test("rotates languages and lists the others in the tooltip", async () => {
    const { spans } = await load(`<p>thanks thanks thanks</p>`);
    assert.deepEqual(spans().map((s) => s.lang), ["ru", "zh", "ar"]);
    assert.equal(spans()[0].title, "thanks = спасибо (spasibo) · Russian\n\n谢谢 · Mandarin\nشكرا · Arabic");
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
    const { doc, spans } = await load(`<p>house</p>`, { words: [evil] });
    assert.equal(doc.querySelector("img"), null);
    assert.equal(spans()[0].textContent, "<img src=x onerror=alert(1)>");
  });

  test("asks the background for a sync on load", async () => {
    const { fake } = await load(`<p>house</p>`);
    assert.deepEqual(fake.calls.sendMessage, [{ type: "sync" }]);
  });
});

// DECISIONS "Buttons and menus stay in the learner's own language" and slice 16's control
// rules, done early after a maintainer report: toggles labelled "AOI I" / "AOI II" showed
// "AOI Я" for a learner who saved я ("I").
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
    assert.equal($("e").textContent, "Я think so, and so do Я.", "AOI II in the block before doesn't count");
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
    assert.equal($("p").childNodes.length, 1, "the restored text is one text node again");
    assert.equal($("q").textContent, "thanks");
    assert.equal(spans().length, 0);
  });

  test("then the page is swapped as usual, with the new class", async () => {
    const { $, doc, spans } = await load(`<p id="p">My ${oldSpan("house", "дом")} is big.</p>`);
    assert.equal(doc.querySelectorAll(`span.${OLD}`).length, 0);
    assert.equal($("p").textContent, "My дом is big.");
    assert.equal(spans().length, 1);
    assert.equal(spans()[0].dataset.en, "house");
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
  test("F02: a swapped text node stays connected and updatable", { todo: "slice 15: never detach site nodes" }, async () => {
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

  test("F02: unwrapping restores the original node objects", { todo: "slice 15: never detach site nodes" }, async () => {
    const { $, set } = await load(`<p id="p">my house</p>`);
    const p = $("p");
    await set({ enabled: false });
    const restored = p.firstChild;
    await set({ enabled: true });
    await set({ enabled: false });
    assert.equal(p.firstChild, restored, "the same text node after a second round trip");
  });

  test("F03: re-applying doesn't merge the site's own text nodes", { todo: "slice 15: no normalize() on site elements" }, async () => {
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
