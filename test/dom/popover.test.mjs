// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The word card (slice 19) and its speak button (slice 34) in jsdom, with the content
// scripts loaded as the manifest injects them. The card lives in a closed shadow root;
// the tests reach it by recording attachShadow before the scripts run, as nothing on the
// page can.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { createI18n } from "../helpers/fake-i18n.mjs";
import { createPage, injectContentScripts, sleep } from "../helpers/load-script.mjs";
import { voiceLists } from "../helpers/speech-stub.mjs";
import { BOOK, CASTLE, DOG, GOOD, PLEASE, THANKS_RU, THANKS_ZH, WATER } from "../helpers/popover-words.mjs";

const WORDS = [PLEASE, THANKS_ZH, THANKS_RU, DOG, BOOK, GOOD, WATER, CASTLE];
const PAGE = `
  <p id="p1">Come in, please, and sit down. Thanks for coming.</p>
  <p id="p2">The dog is asleep, and there is water on the table.</p>
  <p id="p3">A good book about an old castle.</p>
  <p id="p4">Read about <a id="link" href="#dog">the dog</a> here.</p>
  <p id="p5">Thanks again.</p>`;
const HOVER_MS = 380; // 300 ms intent plus a check
const BACKGROUND = { id: "fake-extension-id", url: "chrome-extension://fake-extension-id/background.js" };

async function load({ html = PAGE, words = WORDS, locale = "en", voices = voiceLists().macos, local = {} } = {}) {
  const fake = createFakeChrome({
    local: { words, enabled: true, pausedHosts: [], hiddenLangs: [], ...local },
    onSendMessage: () => ({ ok: true }),
  });
  fake.chrome.i18n = createI18n(locale);
  const dom = createPage({ html, chrome: fake.chrome });
  const { window } = dom;
  const roots = [];
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function (init) {
    const root = attach.call(this, init);
    roots.push(root);
    return root;
  };
  const spoken = [];
  if (voices) {
    window.speechSynthesis = {
      getVoices: () => voices,
      speak: (u) => spoken.push(u),
      cancel: () => {},
      addEventListener: () => {},
    };
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
  }
  injectContentScripts(dom);
  await fake.idle();
  // content.js starts swapping a task after it loads (the segmenter's warm-up, slice 15);
  // asking the background for a sync is the last thing it does.
  for (let i = 0; i < 400 && !fake.calls.sendMessage.some((m) => m.type === "sync"); i++) await sleep(5);
  await sleep(0);
  const doc = window.document;
  const shadow = () => roots.at(-1);
  const card = () => shadow()?.querySelector(".k-card");
  const word = (native) => [...doc.querySelectorAll("kotiko-w")].find((w) => w.textContent.toLowerCase() === native.toLowerCase());
  const pointer = (type, target, init = {}) =>
    target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerType: "mouse", clientX: 10, clientY: 10, ...init }));
  return {
    window,
    doc,
    fake,
    spoken,
    shadow,
    card,
    word,
    pointer,
    $: (id) => doc.getElementById(id),
    isOpen: () => !!card() && !card().hidden,
    text: (sel) => shadow()?.querySelector(sel)?.textContent.replace(/\s+/g, " ").trim() ?? null,
    async hover(native) {
      pointer("pointerover", word(native));
      await sleep(HOVER_MS);
    },
    click(target, init = {}) {
      const e = new window.PointerEvent("click", { bubbles: true, cancelable: true, composed: true, pointerType: "mouse", ...init });
      target.dispatchEvent(e);
      return e;
    },
    key(target, key, init = {}) {
      const e = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
      target.dispatchEvent(e);
      return e;
    },
    async set(patch) {
      await fake.chrome.storage.local.set(patch);
      await fake.idle();
    },
  };
}

// The visible lines of the open card, top to bottom, as a reader sees them (the
// screen-reader-only text left out).
function visibleLines(shadow) {
  const lines = [];
  for (const el of shadow.querySelectorAll(".k-scroll > div")) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".sr, .k-speak").forEach((n) => n.remove());
    const t = clone.textContent.replace(/\s+/g, " ").trim();
    if (t) lines.push(t);
  }
  return lines;
}

describe("nothing about the vocabulary in the page DOM (19 §6)", () => {
  test("swaps carry no title or data-*; the host appears on first use with a closed root", async () => {
    const p = await load();
    for (const w of p.doc.querySelectorAll("kotiko-w")) {
      assert.deepEqual(w.getAttributeNames().sort(), ["class", "dir", "lang", "translate"]);
    }
    assert.equal(p.doc.querySelector("kotiko-popover"), null, "nothing before first use");
    await p.hover("пожалуйста");
    const host = p.doc.querySelector("kotiko-popover");
    assert.ok(host);
    assert.equal(host.shadowRoot, null, "page scripts can't open it");
    assert.equal(host.parentNode, p.doc.documentElement, "on <html>, not <body>");
    assert.equal(host.getAttribute("translate"), "no");
    assert.match(host.getAttribute("style"), /all: initial !important/);
    assert.match(host.getAttribute("style"), /display: block !important/);
    assert.equal(host.textContent, "", "no light-DOM text");
    assert.doesNotMatch(p.doc.documentElement.outerHTML, /please|pozhaluysta|pa-ZHAL/);
    assert.equal(p.doc.querySelectorAll("kotiko-popover").length, 1);
  });
});

describe("the card's content (19 §1, §1a)", () => {
  test("пожалуйста: the order of the pronunciation block, then the language and meaning", async () => {
    const p = await load();
    await p.hover("пожалуйста");
    assert.ok(p.isOpen());
    assert.deepEqual(visibleLines(p.shadow()), [
      "пожа́луйста",
      "pa-ZHAL-sta",
      "Slowly: pa-ZHA-lu-sta",
      "pozhaluysta · AI-generated",
      "Russian · русский",
      "please",
    ]);
    assert.equal(p.text(".k-pron .k-stress"), "ZHAL", "the stressed syllable is semibold");
    assert.equal(p.shadow().querySelector(".k-word").getAttribute("lang"), "ru");
    assert.equal(p.shadow().querySelector(".k-pron").getAttribute("lang"), "en", "read in the base language");
    assert.equal(p.shadow().querySelector(".k-rom bdi").getAttribute("lang"), "ru-Latn");
    // The speak button is on the word's line.
    assert.ok(p.shadow().querySelector(".k-head .k-speak"));
  });

  test("accessible text: lowercase with the stressed syllable, and the dialog named by plain native", async () => {
    const p = await load();
    await p.hover("пожалуйста");
    assert.equal(p.shadow().querySelector(".k-pron [aria-hidden=true]").textContent, "pa-ZHAL-sta");
    assert.equal(p.text(".k-pron .sr"), "Pronunciation: pa-zhal-sta, stress on zhal");
    assert.equal(p.text(".k-careful .sr"), "Slowly: pa-zha-lu-sta");
    assert.equal(p.text(".k-rom .sr"), "Romanization: pozhaluysta");
    assert.equal(p.card().getAttribute("role"), "dialog");
    assert.equal(p.card().getAttribute("aria-label"), "пожалуйста, Russian");
  });

  test("谢谢: raised tone digit read as 'tone 4', pinyin, the note and Also", async () => {
    const p = await load();
    await p.hover("谢谢");
    assert.equal(p.text(".k-pron sup"), "4");
    assert.equal(p.text(".k-pron .sr"), "Pronunciation: shyeh tone 4-shyeh");
    assert.deepEqual(visibleLines(p.shadow()).slice(0, 4), ["谢谢", "shyeh4-shyeh", "xièxie · AI-generated", "Chinese · 中文"]);
    assert.match(p.text(".k-note"), /谢谢你/);
    assert.equal(p.text(".k-also"), "Also: спасибо (spasibo)");
    assert.equal(p.shadow().querySelector(".k-also bdi").getAttribute("lang"), "ru");
  });

  test("犬: the kana reading follows the word", async () => {
    const p = await load();
    await p.hover("犬");
    assert.equal(p.text(".k-reading"), "いぬ");
    assert.equal(p.shadow().querySelector(".k-reading").getAttribute("lang"), "ja");
  });

  test("no pronunciation: romanization only, no label", async () => {
    const p = await load();
    await p.hover("كتاب");
    assert.deepEqual(visibleLines(p.shadow()), ["كتاب", "kitab", "Arabic · العربية", "book"]);
    assert.equal(p.shadow().querySelector(".k-label"), null);
  });

  test("checked, the learner's own, and differs", async () => {
    const p = await load();
    await p.hover("хорошо");
    assert.equal(p.text(".k-rom [aria-hidden=true]"), "khorosho");
    assert.equal(p.text(".k-label"), "Checked in Wiktionary");
    p.pointer("pointerout", p.word("хорошо"), { relatedTarget: p.doc.body });
    await sleep(250);
    await p.hover("agua");
    assert.equal(p.shadow().querySelector(".k-label"), null);
    assert.equal(p.shadow().querySelector(".k-rom"), null, "a Latin-script word has no romanization line");
    assert.equal(p.text(".k-pron [aria-hidden=true]"), "A-gwa");
    p.pointer("pointerout", p.word("agua"), { relatedTarget: p.doc.body });
    await sleep(250);
    await p.hover("замок");
    assert.equal(p.text(".k-word"), "за́мок", "the dictionary's stress on the first line");
    assert.equal(p.text(".k-label"), "AI-generated. Wiktionary stresses it differently.");
  });

  test("a Latin-script target's label sits on its own line", async () => {
    const gracias = { id: 40, lang: "es", native: "gracias", pronunciation: "GRA-syas", pronunciation_source: "model", english: "thanks", forms: ["thanks"] };
    const p = await load({ html: `<p>thanks</p>`, words: [gracias] });
    await p.hover("gracias");
    assert.deepEqual(visibleLines(p.shadow()), ["gracias", "GRA-syas", "AI-generated", "Spanish · español", "thanks"]);
  });

  test("other bases: one line, in the record's base language", async () => {
    const es = { ...DOG, id: 30, base_lang: "es", english: undefined, gloss: "perro", forms: ["perro"] };
    const p = await load({ words: [DOG, es] });
    await p.hover("犬");
    assert.equal(p.text(".k-other"), "In Spanish: perro");
    assert.equal(p.shadow().querySelector(".k-other bdi").getAttribute("lang"), "es");
  });

  test("the interface in Spanish: every label and the language line", async () => {
    const p = await load({ locale: "es" });
    await p.hover("пожалуйста");
    assert.deepEqual(visibleLines(p.shadow()).slice(1, 5), ["pa-ZHAL-sta", "Despacio: pa-ZHA-lu-sta", "pozhaluysta · Generado por IA", "ruso · русский"]);
    assert.equal(p.text(".k-pron .sr"), "Pronunciación: pa-zhal-sta, acento en zhal");
    assert.equal(p.text(".k-speak .sr"), "Escuchar пожалуйста en ruso");
    assert.equal(p.shadow().querySelector(".k-root").getAttribute("lang"), "es");
    p.pointer("pointerout", p.word("пожалуйста"), { relatedTarget: p.doc.body });
    await sleep(250);
    await p.hover("谢谢");
    assert.equal(p.text(".k-lang"), "chino · 中文");
    assert.equal(p.text(".k-also"), "También: спасибо (spasibo)");
    assert.equal(p.text(".k-pron .sr"), "Pronunciación: shyeh tono 4-shyeh");
  });
});

describe("opening and closing (19 §3)", () => {
  test("hover intent: 300 ms of rest opens; a moving pointer doesn't", async () => {
    const p = await load();
    const w = p.word("пожалуйста");
    p.pointer("pointerover", w);
    await sleep(150);
    assert.equal(p.isOpen(), false, "not before 300 ms");
    await sleep(HOVER_MS - 150);
    assert.equal(p.isOpen(), true);
  });

  test("a pointer still moving across the word doesn't open it", async () => {
    const p = await load();
    const w = p.word("пожалуйста");
    p.pointer("pointerover", w, { clientX: 0 });
    for (let i = 1; i <= 10; i++) {
      await sleep(35);
      p.pointer("pointermove", w, { clientX: i * 10 });
    }
    assert.equal(p.isOpen(), false);
    await sleep(HOVER_MS);
    assert.equal(p.isOpen(), true, "opens once it rests");
  });

  test("leaving both word and card for 200 ms closes; moving into the card keeps it", async () => {
    const p = await load();
    await p.hover("пожалуйста");
    const host = p.doc.querySelector("kotiko-popover");
    p.pointer("pointerout", p.word("пожалуйста"), { relatedTarget: host });
    p.pointer("pointerover", host);
    await sleep(260);
    assert.equal(p.isOpen(), true, "inside the card");
    p.pointer("pointerout", host, { relatedTarget: p.doc.body });
    await sleep(100);
    assert.equal(p.isOpen(), true, "the 200 ms grace");
    await sleep(160);
    assert.equal(p.isOpen(), false);
  });

  test("click opens pinned: it stays when the pointer leaves; click again or outside closes", async () => {
    const p = await load();
    const w = p.word("пожалуйста");
    p.click(w);
    assert.equal(p.isOpen(), true, "at once");
    p.pointer("pointerout", w, { relatedTarget: p.doc.body });
    await sleep(260);
    assert.equal(p.isOpen(), true, "pinned");
    p.pointer("pointerdown", w);
    p.click(w);
    assert.equal(p.isOpen(), false, "click on the word again");
    p.click(w);
    p.pointer("pointerdown", p.$("p3"));
    assert.equal(p.isOpen(), false, "click outside");
  });

  test("a click inside a link never opens and never blocks navigation; hover still works", async () => {
    const p = await load();
    const w = p.$("link").querySelector("kotiko-w");
    const e = p.click(w);
    assert.equal(e.defaultPrevented, false);
    assert.equal(p.isOpen(), false);
    p.pointer("pointerover", w);
    await sleep(HOVER_MS);
    assert.equal(p.isOpen(), true);
  });

  test("a selection that started on the word doesn't open it", async () => {
    const p = await load();
    const w = p.word("пожалуйста");
    p.window.getSelection().selectAllChildren(p.$("p1"));
    p.click(w);
    assert.equal(p.isOpen(), false);
  });

  test("tap opens on touch; hover events from touch are ignored", async () => {
    const p = await load();
    const w = p.word("谢谢");
    p.pointer("pointerover", w, { pointerType: "touch" });
    await sleep(HOVER_MS);
    assert.equal(p.isOpen(), false);
    p.click(w, { pointerType: "touch" });
    assert.equal(p.isOpen(), true);
  });

  test("a long press inside a link opens; its context menu and click are suppressed", async () => {
    const p = await load();
    const w = p.$("link").querySelector("kotiko-w");
    p.pointer("pointerdown", w, { pointerType: "touch" });
    await sleep(560);
    assert.equal(p.isOpen(), true);
    const menu = new p.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    w.dispatchEvent(menu);
    assert.equal(menu.defaultPrevented, true);
    p.pointer("pointerup", w, { pointerType: "touch" });
    assert.equal(p.click(w, { pointerType: "touch" }).defaultPrevented, true);
    // An ordinary tap on the link afterwards navigates as usual.
    assert.equal(p.click(w, { pointerType: "touch" }).defaultPrevented, false);
  });

  test("a short tap in a link doesn't open, and the context menu elsewhere is left alone", async () => {
    const p = await load();
    const w = p.$("link").querySelector("kotiko-w");
    p.pointer("pointerdown", w, { pointerType: "touch" });
    await sleep(100);
    p.pointer("pointerup", w, { pointerType: "touch" });
    await sleep(500);
    assert.equal(p.isOpen(), false);
    const menu = new p.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    w.dispatchEvent(menu);
    assert.equal(menu.defaultPrevented, false);
  });

  test("Esc closes", async () => {
    const p = await load();
    p.click(p.word("пожалуйста"));
    p.key(p.doc.body, "Escape");
    assert.equal(p.isOpen(), false);
  });

  test("only one card: another word moves it", async () => {
    const p = await load();
    p.click(p.word("пожалуйста"));
    p.click(p.word("犬"));
    assert.equal(p.doc.querySelectorAll("kotiko-popover").length, 1);
    assert.equal(p.text(".k-word"), "犬");
  });

  test("a word inside an editable area doesn't open", async () => {
    const p = await load();
    const w = p.word("пожалуйста");
    p.$("p1").setAttribute("contenteditable", "true");
    p.click(w);
    assert.equal(p.isOpen(), false);
  });
});

describe("keyboard (19 §3, §7; 27; 33's reveal-word)", () => {
  test("Enter on a focused word opens with focus inside; Tab stays inside; Esc returns focus", async () => {
    const p = await load();
    // Keyboard mode (27, not built yet) puts tabindex on swapped words.
    const word = p.word("спасибо");
    word.setAttribute("tabindex", "0");
    word.focus();
    p.key(word, "Enter");
    assert.equal(p.isOpen(), true);
    await sleep(10);
    const sh = p.shadow();
    assert.ok(sh.activeElement, "focus moved into the card");
    assert.equal(sh.activeElement.className, "k-speak", "the first action");
    p.key(sh.activeElement, "Tab");
    assert.equal(sh.activeElement.className, "k-speak", "Tab cycles inside");
    p.key(p.doc.body, "Escape");
    assert.equal(p.isOpen(), false);
    assert.equal(p.doc.activeElement, word, "focus is back on the word");
  });

  test("the reveal-word command opens on the selected word with focus; Esc restores the selection", async () => {
    const p = await load();
    const w = p.word("谢谢");
    p.window.getSelection().selectAllChildren(w);
    await p.fake.deliver({ type: "reveal-word" }, BACKGROUND);
    assert.equal(p.isOpen(), true);
    assert.equal(p.text(".k-word"), "谢谢");
    p.key(p.doc.body, "Escape");
    const sel = p.window.getSelection();
    assert.equal(sel.rangeCount, 1);
    assert.equal(sel.toString(), "谢谢");
  });

  test("with nothing selected, the command says so in a toast that never takes focus", async () => {
    const p = await load();
    p.window.getSelection().removeAllRanges();
    await p.fake.deliver({ type: "reveal-word" }, BACKGROUND);
    assert.equal(p.isOpen(), false);
    const toast = p.shadow().querySelector(".k-toast");
    assert.equal(toast.getAttribute("role"), "status");
    assert.equal(toast.getAttribute("aria-live"), "polite");
    assert.equal(toast.textContent, "Select a swapped word first.");
    assert.equal(p.shadow().activeElement, null);
    p.key(p.doc.body, "Escape");
    assert.equal(toast.textContent, "", "Esc dismisses it");
  });

  test("toast messages come from the background only", async () => {
    const p = await load();
    const page = { id: "fake-extension-id", url: "https://evil.example/", tab: { id: 3 } };
    await p.fake.deliver({ type: "toast", message: "Hi from a page" }, page).catch(() => {});
    assert.equal(p.shadow(), undefined, "nothing built");
    await p.fake.deliver({ type: "toast", message: "Learning “dog” in Spanish…" }, BACKGROUND);
    assert.equal(p.text(".k-toast"), "Learning “dog” in Spanish…");
  });
});

describe("speak button (34)", () => {
  test("shows when a voice exists and speaks the stored word without its stress mark", async () => {
    const p = await load();
    await p.hover("пожалуйста");
    const btn = p.shadow().querySelector(".k-speak");
    assert.equal(btn.hidden, false);
    assert.equal(p.text(".k-speak .sr"), "Hear пожалуйста in Russian");
    assert.equal(btn.querySelector(".sr bdi").getAttribute("lang"), "ru");
    p.click(btn);
    await sleep(0);
    assert.equal(p.spoken.length, 1);
    assert.equal(p.spoken[0].text, "пожалуйста");
    assert.equal(p.spoken[0].voice.name, "Milena");
    assert.equal(p.isOpen(), true, "pressing the button doesn't close the card");
  });

  test("Japanese is spoken from the reading; S speaks while the card is open", async () => {
    const p = await load();
    await p.hover("犬");
    const e = p.key(p.doc.body, "s");
    await sleep(0);
    assert.equal(e.defaultPrevented, true);
    assert.equal(p.spoken.at(-1).text, "いぬ");
  });

  test("S typed into a field on the page is left alone", async () => {
    const p = await load({ html: `${PAGE}<input id="field">` });
    await p.hover("犬");
    const e = p.key(p.$("field"), "s");
    assert.equal(e.defaultPrevented, false);
    assert.equal(p.spoken.length, 0);
  });

  test("hidden when no voice exists for the language (Thai on Linux)", async () => {
    const thai = { id: 50, lang: "th", native: "ขอบคุณ", romanization: "khop khun", english: "thanks", forms: ["thanks"] };
    const p = await load({ html: `<p>thanks</p>`, words: [thai], voices: voiceLists()["linux-speech-dispatcher"] });
    await p.hover("ขอบคุณ");
    assert.equal(p.shadow().querySelector(".k-speak").hidden, true);
    p.key(p.doc.body, "s");
    assert.equal(p.spoken.length, 0);
  });

  test("no speech engine: no button", async () => {
    const p = await load({ voices: null });
    await p.hover("пожалуйста");
    assert.equal(p.shadow().querySelector(".k-speak").hidden, true);
  });

  test("online voices only when the learner allows them", async () => {
    const chromeos = voiceLists().chromeos;
    let p = await load({ voices: chromeos });
    await p.hover("пожалуйста");
    assert.equal(p.shadow().querySelector(".k-speak").hidden, true, "Google русский is online");
    p = await load({ voices: chromeos, local: { speech: { allowOnline: true } } });
    await p.hover("пожалуйста");
    assert.equal(p.shadow().querySelector(".k-speak").hidden, false);
  });
});

describe("theme follows the page (19 §5)", () => {
  test("a dark page gets the dark card; a light one the light card", async () => {
    let p = await load({ html: `<div style="background: rgb(20, 18, 28); color: white"><p>please</p></div>` });
    await p.hover("пожалуйста");
    assert.equal(p.shadow().querySelector(".k-root").classList.contains("k-dark"), true);
    p = await load({ html: `<div style="background: #fafafa"><p>please</p></div>` });
    await p.hover("пожалуйста");
    assert.equal(p.shadow().querySelector(".k-root").classList.contains("k-dark"), false);
  });

  test("helpers: color parsing and luminance", async () => {
    const p = await load({ html: "<p>x</p>" });
    const { parseColor, luminance, place } = p.window.KotikoPopover;
    assert.deepEqual([...parseColor("rgba(0, 0, 0, 0)")], [0, 0, 0, 0]);
    assert.deepEqual([...parseColor("rgb(20 18 28 / 50%)")], [20, 18, 28, 0.5]);
    assert.ok(luminance([20, 18, 28]) < 0.2);
    assert.ok(luminance([250, 250, 250]) > 0.2);
    // Placement: below and centered; flipped above near the bottom; clamped at the edges.
    const view = { width: 800, height: 600 };
    assert.deepEqual({ ...place({ left: 390, width: 20, top: 100, bottom: 120 }, { width: 240, height: 200 }, view) }, { x: 280, y: 130, side: "below", arrowX: 120 });
    assert.equal(place({ left: 390, width: 20, top: 500, bottom: 520 }, { width: 240, height: 200 }, view).side, "above");
    const edge = place({ left: 2, width: 20, top: 100, bottom: 120 }, { width: 240, height: 200 }, view);
    assert.equal(edge.x, 8);
    assert.equal(edge.arrowX, 16, "the arrow stays over the word");
  });
});

describe("words changing while the card is open (19 §10)", () => {
  test("an edited word re-renders in place; a removed one closes with a message", async () => {
    const p = await load();
    p.click(p.word("пожалуйста"));
    await p.set({ words: WORDS.map((w) => (w === PLEASE ? { ...PLEASE, pronunciation: "pa-ZHAL-sta-ta" } : w)) });
    assert.equal(p.isOpen(), true);
    assert.equal(p.text(".k-pron [aria-hidden=true]"), "pa-ZHAL-sta-ta");
    await p.set({ words: WORDS.filter((w) => w !== PLEASE) });
    assert.equal(p.isOpen(), false);
    assert.equal(p.text(".k-toast"), "That word was removed.");
  });

  test("turning Kotiko off closes it", async () => {
    const p = await load();
    p.click(p.word("пожалуйста"));
    await p.set({ enabled: false });
    assert.equal(p.isOpen(), false);
  });
});

describe("the actions slot (19 §2)", () => {
  test("no actions today: Edit, Pause word and Wrong meaning wait for their backends", async () => {
    const p = await load();
    p.click(p.word("пожалуйста"));
    assert.equal(p.shadow().querySelector(".k-actions"), null);
  });

  test("an action plugged into the slot renders as a button and runs with the swap's info", async () => {
    const p = await load({ html: `<p id="x">please</p>` });
    const ran = [];
    const pop = p.window.KotikoPopover.createPopover({
      infoFor: () => ({ word: PLEASE, all: [PLEASE] }),
      actions: [{ id: "edit", label: () => "Edit", run: (info) => ran.push(info.word.id) }],
    });
    pop.openFor(p.doc.querySelector("kotiko-w"), "click");
    const sh = pop._shadow();
    const b = sh.querySelector(".k-actions .k-action");
    assert.equal(b.textContent, "Edit");
    b.click();
    assert.deepEqual(ran, [PLEASE.id]);
    pop.destroy();
  });
});
