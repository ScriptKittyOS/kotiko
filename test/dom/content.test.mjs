// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
// SPDX-License-Identifier: Apache-2.0

// content.js in jsdom, loaded the way the manifest injects it (lib/matcher.js first).
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

async function load(html, { words = WORDS, url = "https://example.com/", ...local } = {}) {
  const fake = createFakeChrome({
    local: { words, enabled: true, pausedHosts: [], hiddenLangs: [], ...local },
    onSendMessage: () => ({ ok: true }),
  });
  const dom = createPage({ html, url, chrome: fake.chrome });
  injectContentScripts(dom);
  await fake.idle();
  await sleep(0);
  const doc = dom.window.document;
  return {
    dom,
    fake,
    doc,
    $: (id) => doc.getElementById(id),
    spans: () => [...doc.querySelectorAll("span.slovo-w")],
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
