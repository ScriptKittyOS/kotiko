// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The welcome tab's rules (slice 22, extension/lib/welcome-model.js): base languages from
// the browser (slice 50 §2) and their chips, what a line in the ask box becomes, the
// languages offered when a script doesn't name one, the preview sentence through the
// matcher pages use, the Wikipedia search, and the per-base data files.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadLocalLibs } from "../helpers/local-libs.mjs";
import { requireExt, ROOT } from "../helpers/load-script.mjs";
import { validate } from "../helpers/json-schema.mjs";

const L = loadLocalLibs();
const { Lang, Local, spec } = L;
const M = requireExt("lib/welcome-model.js");
const Matcher = requireExt("lib/matcher.js");
const plain = (v) => JSON.parse(JSON.stringify(v));
const entry = (text, bases = ["en"]) => M.parseEntry(text, { bases, Lang, Local, spec });

describe("base languages from the browser (50 §2)", () => {
  test("the examples of slice 50: Puerto Rico, Brazil, Japan, Taiwan", () => {
    assert.deepEqual(M.detectBases({ uiLanguage: "es-PR", acceptLanguages: ["es-PR", "es"], Lang }), ["es"]);
    assert.deepEqual(M.detectBases({ uiLanguage: "pt-BR", acceptLanguages: ["pt-BR", "pt", "en-US", "en"], Lang }), ["pt-BR", "en"]);
    assert.deepEqual(M.detectBases({ uiLanguage: "ja", acceptLanguages: ["ja", "ja-JP"], Lang }), ["ja"]);
    assert.deepEqual(M.detectBases({ uiLanguage: "zh-TW", acceptLanguages: [], Lang }), ["zh-Hant"]);
  });

  test("at most three, no duplicates, and the interface language when nothing has segmentation", () => {
    assert.deepEqual(M.detectBases({ uiLanguage: "en-US", acceptLanguages: ["en-US", "en-GB", "es", "fr", "de"], Lang }), ["en", "es", "fr"]);
    assert.deepEqual(M.detectBases({ uiLanguage: "pl", acceptLanguages: ["xx"], Lang, supported: () => false }), ["pl"]);
  });

  test("chips: untick, refuse the last, add, and at most four", () => {
    assert.deepEqual(M.toggleBase(["es", "en"], "en", false), { bases: ["es"] });
    assert.deepEqual(M.toggleBase(["es"], "es", false), { bases: ["es"], error: "last" });
    assert.deepEqual(M.toggleBase(["es"], "fr", true), { bases: ["es", "fr"] });
    assert.deepEqual(M.toggleBase(["es", "en", "fr", "de"], "it", true), { bases: ["es", "en", "fr", "de"], error: "full" });
    assert.deepEqual(M.toggleBase(["es"], "es", true), { bases: ["es"] });
  });

  test("support levels: Full, Good and Basic", () => {
    assert.equal(M.levelOf("es"), "full");
    assert.equal(M.levelOf("pt-BR"), "good");
    assert.equal(M.levelOf("zh-Hant"), "good");
    assert.equal(M.levelOf("pl"), "basic");
  });
});

describe("a line in the ask box (22 §5)", () => {
  test("a script one language owns names the language; nothing asks a model", () => {
    for (const [text, lang] of [["ありがとう = thanks", "ja"], ["사랑 = love", "ko"], ["γεια = hi", "el"], ["ძაღლი = dog", "ka"], ["ขอบคุณ = thanks", "th"]]) {
      const e = entry(text);
      assert.equal(e.kind, "manual", text);
      assert.equal(e.word.lang, lang, text);
      assert.equal(e.word.base_lang, "en");
      assert.equal(e.word.origin, "manual");
      assert.deepEqual(plain(e.word.forms.map((f) => f.text)), [e.word.gloss]);
    }
  });

  test("Latin, Cyrillic, Arabic, Hebrew and Han alone don't: the learner picks (state D)", () => {
    for (const [text, script] of [["hola = hello", "Latn"], ["дом = house", "Cyrl"], ["شكرا = thanks", "Arab"], ["שלום = hi", "Hebr"], ["犬 = dog", "Hani"]]) {
      const e = entry(text);
      assert.equal(e.kind, "which", text);
      assert.equal(e.script, script, text);
    }
  });

  test("a prefix names the language: \"es: hola = hello\" is a card at once", () => {
    const e = entry("es: hola = hello");
    assert.equal(e.kind, "manual");
    assert.deepEqual([e.word.lang, e.word.native, e.word.gloss], ["es", "hola", "hello"]);
    assert.equal(entry("xx: hola = hello").kind, "which", "an unknown prefix isn't a language");
  });

  test("the meaning's base is never the word's language: a Spanish reader's \"hello = hola\"", () => {
    const e = entry("hello = hola", ["es"]);
    assert.equal(e.kind, "which");
    const chips = M.languageChips(e, { Lang });
    assert.ok(!chips.includes("es"), chips.join());
    assert.equal(chips[0], "en");
    const word = M.manualFor(e, "en", { Lang, Local });
    assert.deepEqual([word.lang, word.native, word.base_lang, word.gloss], ["en", "hello", "es", "hola"]);
    assert.equal(M.manualFor(e, "es", { Lang, Local }), null, "Español can't be the word's language here");
    assert.equal(entry("es: hola = hello", ["es"]).kind, "which");
  });

  test("questions and bare words go to the learner's AI, text verbatim", () => {
    assert.deepEqual(plain(entry("how do you say hello in Japanese")), { kind: "lookup", text: "how do you say hello in Japanese", hint: null });
    assert.deepEqual(plain(entry("  ¿cómo se dice hola en japonés?  ", ["es"])), { kind: "lookup", text: "¿cómo se dice hola en japonés?", hint: null });
    assert.equal(entry("").kind, "empty");
  });

  test("language search: names in the interface language, endonyms and tags", () => {
    const list = M.languageList({ spec, uiLocale: "es", Lang });
    assert.ok(list.length > 150 && list.length < 400, String(list.length));
    assert.equal(M.searchLanguages(list, "jap")[0].tag, "ja");
    assert.equal(M.searchLanguages(list, "日本")[0].tag, "ja");
    assert.equal(M.searchLanguages(list, "ru")[0].tag, "ru", "an exact tag first");
    assert.ok(!M.searchLanguages(list, "esp", { exclude: ["es"] }).some((x) => x.tag === "es"));
    assert.deepEqual(M.searchLanguages(list, "   "), []);
  });

  test("candidates group into words: one per language and native, records per base, at most five", () => {
    const c = (native, base, gloss) => ({ lang: "ja", native, base_lang: base, gloss, forms: [gloss] });
    const groups = M.groupCandidates([c("犬", "es", "perro"), c("犬", "en", "dog"), c("猫", "es", "gato"), ...["a", "b", "c", "d", "e"].map((n) => c(n, "es", n + n))]);
    assert.equal(groups.length, 5);
    assert.deepEqual(groups[0].records.map((r) => r.base_lang), ["es", "en"]);
    assert.equal(M.recordFor(groups[0], "en").gloss, "dog");
  });
});

describe("the preview (22 §8)", () => {
  const word = (native, base, forms, lang = "ja") => ({ lang, native, base_lang: base, gloss: forms[0], forms: forms.map((text) => ({ text, enabled: true })) });

  test("the shortest sentence of the primary base's file where the matcher finds a form", () => {
    const en = M.pickPreview([word("こんにちは", "en", ["hello"])], "en", { spec, Matcher });
    assert.equal(en.kind, "sentence");
    assert.equal(en.before, "She said hello and waved from the bus.");
    assert.equal(en.parts.map((p) => p.native ?? p.text).join(""), "She said こんにちは and waved from the bus.");
    const es = M.pickPreview([word("こんにちは", "es", ["hola"])], "es", { spec, Matcher });
    assert.equal(es.parts.map((p) => p.native ?? p.text).join(""), "Ella dijo こんにちは y saludó desde el autobús.");
  });

  test("inflected and multi-word forms count; the page's casing is kept", () => {
    const dogs = M.pickPreview([word("犬", "en", ["dog", "dogs"])], "en", { spec, Matcher });
    assert.match(dogs.before, /\bdogs?\b/);
    const thanks = M.pickPreview([word("спасибо", "en", ["thank you"], "ru")], "en", { spec, Matcher });
    assert.equal(thanks.parts.find((p) => p.native).surface, "Thank you");
    assert.equal(thanks.parts.find((p) => p.native).native, "Спасибо", "capitalized like the page's word");
  });

  test("no sentence has the word: the fallback template; a base with no file: the word alone", () => {
    const fb = M.pickPreview([word("縞馬", "en", ["zebra"])], "en", { spec, Matcher });
    assert.equal(fb.kind, "fallback");
    assert.equal(fb.parts.map((p) => p.native ?? p.text).join(""), "Today I learned the word 縞馬.");
    const pl = M.pickPreview([word("犬", "pl", ["pies"])], "pl", { spec, Matcher });
    assert.deepEqual([pl.kind, pl.before, pl.parts[0].native], ["word", "pies", "犬"]);
    assert.equal(M.pickPreview([word("犬", "en", ["dog"])], "es", { spec, Matcher }), null, "no record for that base");
  });

  test("an edited sentence swaps the same way", () => {
    const parts = M.previewText([word("犬", "en", ["dog"])], "en", "My dog and your Dog.", { Matcher });
    assert.deepEqual(parts.filter((p) => p.native).map((p) => p.native), ["犬", "犬"]);
  });

  test("Try it on a page: a Wikipedia full-text search in the base's language", () => {
    assert.equal(M.wikipediaUrl("en", "hello"), "https://simple.wikipedia.org/w/index.php?search=hello&fulltext=1&ns0=1");
    assert.equal(M.wikipediaUrl("es", "por favor"), "https://es.wikipedia.org/w/index.php?search=por%20favor&fulltext=1&ns0=1");
    assert.equal(M.wikipediaUrl("zh-Hant", "狗"), "https://zh.wikipedia.org/w/index.php?search=%E7%8B%97&fulltext=1&ns0=1&variant=zh-tw");
    assert.equal(M.wikipediaUrl("pt-BR", "olá"), "https://pt.wikipedia.org/w/index.php?search=ol%C3%A1&fulltext=1&ns0=1");
  });

  test("AI ready: a provider with its key or no key needed, or a server with its access key", () => {
    assert.equal(M.aiReady({ lookup: { kind: "none" } }), false);
    assert.equal(M.aiReady({ lookup: { kind: "provider", provider: "openrouter" }, keys: { providers: {} } }), false);
    assert.equal(M.aiReady({ lookup: { kind: "provider", provider: "openrouter" }, keys: { providers: { openrouter: true } } }), true);
    assert.equal(M.aiReady({ lookup: { kind: "provider", provider: "ollama" }, keys: {} }), true);
    assert.equal(M.aiReady({ lookup: { kind: "server" }, keys: { server: true } }), true);
  });
});

describe("spec/lang data for the welcome tab", () => {
  const LANG = path.join(ROOT, "spec/lang");
  const read = (...p) => JSON.parse(fs.readFileSync(path.join(LANG, ...p), "utf8"));

  test("every Full base has a valid welcome.json and sentences.json", () => {
    for (const base of ["en", "es"]) {
      assert.deepEqual(validate(read("schema", "welcome.schema.json"), read(base, "welcome.json")), [], `${base}/welcome.json`);
      assert.deepEqual(validate(read("schema", "sentences.schema.json"), read(base, "sentences.json")), [], `${base}/sentences.json`);
    }
  });

  test("sentences are NFC, 6 to 12 words, unique, and the welcome words are in their own base", () => {
    for (const base of ["en", "es"]) {
      const { sentences, fallback } = read(base, "sentences.json");
      assert.equal(new Set(sentences).size, sentences.length, base);
      for (const s of [...sentences, fallback]) assert.equal(s, s.normalize("NFC"), s);
      for (const s of sentences) {
        const n = s.split(/\s+/).length;
        assert.ok(n >= 6 && n <= 12, `${base}: ${s}`);
      }
      const w = read(base, "welcome.json");
      assert.ok(w.ask_prefix.includes(w.hello), base);
      assert.ok(w.no_ai_example.endsWith(`= ${w.hello}`), `${base}: the example's meaning is in ${base}`);
    }
  });

  test("the extension's spec bundle carries them", () => {
    assert.equal(spec.lang.es.welcome.hello, "hola");
    assert.ok(spec.lang.en.sentences.sentences.length >= 90);
  });
});
