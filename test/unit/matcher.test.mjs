// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The matcher (extension/lib/matcher.js) and the tokenizer under it (extension/lib/text.js),
// slice 14: one index per base language, words found by key in any language.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, requireExt } from "../helpers/load-script.mjs";

const T = requireExt("lib/text.js");
const M = requireExt("lib/matcher.js");
const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, "spec/lang/_generic/boundaries.json"), "utf8"));
const rules = (base) => T.rulesFor(TABLE, base);

let nextId = 1;
const word = (native, lang, base, forms, extra = {}) => ({ id: nextId++, lang, native, base_lang: base, gloss: forms[0] ?? null, forms, status: "active", ...extra });
const index = (words, base) => M.buildIndex(words, { base, rules: rules(base) });
const surfaces = (text, words, base, ctx = {}) => M.scan(text, { base, ...ctx }, index(words, base)).matches.map((m) => m.surface);

// What content.js shows for `text`: each match becomes the case-matched native word of the
// language whose turn it is (one candidate per language, newest first); lone capitals
// that are part of a name or code stay.
function swap(text, words, base = "en") {
  const idx = index(words, base);
  const turns = new Map();
  let out = "";
  let last = 0;
  for (const m of M.scan(text, { base }, idx).matches) {
    if (m.surface.length === 1 && M.skipLetter(text, m.start)) continue;
    const seen = new Set();
    const all = m.entry.candidates.map((c) => c.word).filter((w) => !seen.has(w.lang) && seen.add(w.lang));
    const turn = turns.get(m.entry) ?? 0;
    turns.set(m.entry, turn + 1);
    out += text.slice(last, m.start) + M.matchCase(m.surface, all[turn % all.length].native);
    last = m.end;
  }
  return out + text.slice(last);
}

describe("module shape", () => {
  test("exports the APIs and sets the globals", () => {
    for (const k of ["sameBase", "baseOf", "buildIndex", "buildIndexes", "scan", "matchCase", "skipLetter"]) assert.equal(typeof M[k], "function", k);
    for (const k of ["rulesFor", "keyOf", "tokenize", "shapeOf", "sentenceStart"]) assert.equal(typeof T[k], "function", k);
    assert.equal(globalThis.KotikoMatcher, M);
    assert.equal(globalThis.KotikoText, T);
  });
});

// Slice 14's boundary tables, one fixture per base. Each row lists the surfaces the matcher
// reports, in order; rows that slice 16 later drops (acronyms, names) still report here.
describe("boundary tables", () => {
  const dir = path.join(ROOT, "test/fixtures/boundaries");
  for (const file of fs.readdirSync(dir).sort()) {
    const table = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const toWords = (list) => list.map((w) => word(w.native, w.lang, table.base, w.forms));
    const words = toWords(table.words);
    describe(table.base, () => {
      for (const row of table.rows) {
        test(`${row.id}: ${JSON.stringify(row.input)}`, () => {
          const ws = row.words ? toWords(row.words) : words;
          const got = M.scan(row.input, { base: table.base, before: row.before ?? "", after: row.after ?? "" }, index(ws, table.base)).matches;
          assert.deepEqual(got.map((m) => m.surface), row.matches);
          for (const m of got) assert.equal(row.input.slice(m.start, m.end), m.surface, "offsets point at the surface");
        });
      }
    });
  }
});

describe("the shared boundary table", () => {
  test("the default has every key, so a language without an entry is complete", () => {
    assert.deepEqual(Object.keys(TABLE.default).sort(), Object.keys(T.DEFAULT_RULES).sort());
    assert.deepEqual(TABLE.default, { ...T.DEFAULT_RULES, join: TABLE.default.join });
  });

  test("an entry is found by full tag, then primary language, over the default", () => {
    assert.equal(rules("zh-Hant").spaces, false, "zh-Hant falls back to zh");
    assert.equal(rules("pt-BR").spaces, true, "no entry: the default");
    assert.deepEqual(rules("fr").join, ["hyphen", "invisible"], "keys an entry leaves out come from the default");
    assert.ok(rules("es").sentence_openers.includes("¿"));
    assert.deepEqual(T.rulesFor(null, "fr"), T.DEFAULT_RULES, "no table at all");
  });
});

describe("keys", () => {
  const en = rules("en");
  test("NFC, curly apostrophes, hyphens and spaces, invisible characters", () => {
    assert.equal(T.keyOf("Re\u0301sume\u0301", "en", en), "résumé");
    assert.equal(T.keyOf("Can’t", "en", en), "can't");
    assert.equal(T.keyOf("ice\u2011cream", "en", en), "ice cream", "a non-breaking hyphen");
    assert.equal(T.keyOf("ice-cream", "en", en), T.keyOf("ice  cream", "en", en));
    assert.equal(T.keyOf("hot\u00addog", "en", en), "hotdog", "a soft hyphen");
  });

  test("width folding only where the table asks for it", () => {
    assert.equal(T.keyOf("ｺｰﾋｰ", "ja", rules("ja")), "コーヒー");
    assert.equal(T.keyOf("ｄｏｇ", "ja", rules("ja")), "dog");
    assert.equal(T.keyOf("ｄｏｇ", "en", en), "ｄｏｇ");
  });

  test("locale lowercasing for Turkish; accents are never folded", () => {
    assert.equal(T.keyOf("İSTANBUL", "tr", rules("tr")), "istanbul");
    assert.equal(T.keyOf("ISTANBUL", "tr", rules("tr")), "ıstanbul");
    assert.notEqual(T.keyOf("si", "es", rules("es")), T.keyOf("sí", "es", rules("es")));
    assert.notEqual(T.keyOf("cafe", "en", en), T.keyOf("café", "en", en));
  });
});

describe("tokens", () => {
  test("case shapes", () => {
    assert.equal(T.shapeOf("dog"), "lower");
    assert.equal(T.shapeOf("Dog"), "title");
    assert.equal(T.shapeOf("DOG"), "upper");
    assert.equal(T.shapeOf("I"), "title", "a lone capital");
    assert.equal(T.shapeOf("iPhone"), "mixed");
    assert.equal(T.shapeOf("犬"), "caseless");
    assert.equal(T.shapeOf("Ελλάδα"), "title");
  });

  test("sentence starts, including Spanish ¿ and ¡ and the block boundary", () => {
    const es = rules("es");
    assert.equal(T.sentenceStart("¿Tienes un perro?", 1, es, "es"), true);
    assert.equal(T.sentenceStart("Un perro", 3, es, "es"), false);
    assert.equal(T.sentenceStart("fin. Otro", 5, es, "es"), true);
    assert.equal(T.sentenceStart("\u2029Otro", 1, es, "es"), true);
    const m = M.scan("¿Tienes un perro?", { base: "es" }, index([word("犬", "ja", "es", ["tienes"])], "es")).matches[0];
    assert.equal(m.sentenceStart, true);
  });

  test("an elision prefix is its own token and is never matched alone", () => {
    const toks = T.tokenize("l'eau", "fr", rules("fr"));
    assert.deepEqual(toks.map((t) => [t.key, t.elision]), [["l'", true], ["eau", false]]);
    assert.deepEqual(surfaces("l'eau", [word("the", "en", "fr", ["l'"])], "fr"), []);
  });

  test("tokenCount counts the words inside the text only", () => {
    const idx = index([word("собака", "ru", "en", ["dog"])], "en");
    assert.equal(M.scan("a big dog", { base: "en", before: "see ", after: " run" }, idx).tokenCount, 3);
    assert.equal(M.scan("犬が好きです", { base: "ja", count: true }, index([], "ja")).tokenCount, 4);
    assert.equal(M.scan("猫が好きです", { base: "ja" }, index([word("개", "ko", "ja", ["犬"])], "ja")).tokenCount, 0, "no first character of a form: not segmented");
    assert.deepEqual(M.scan("---", { base: "en" }, idx), { matches: [], tokenCount: 0 });
  });
});

describe("phrases", () => {
  const words = [word("спасибо", "ru", "en", ["thank you"]), word("благодарить", "ru", "en", ["thank"]), word("большое спасибо", "ru", "en", ["thank you very much"])];

  test("leftmost-longest wins across any whitespace, never across punctuation", () => {
    assert.deepEqual(surfaces("thank you", words, "en"), ["thank you"]);
    assert.deepEqual(surfaces("thank you very much", words, "en"), ["thank you very much"]);
    assert.deepEqual(surfaces("thank you very well", words, "en"), ["thank you"]);
    assert.deepEqual(surfaces("thank\u202fyou", words, "en"), ["thank\u202fyou"]);
    assert.deepEqual(surfaces("thank, you", words, "en"), ["thank"]);
    assert.deepEqual(surfaces("thank", words, "en", { after: " you" }), ["thank"], "a phrase never runs past the text");
  });

  test("por favor beats favor", () => {
    const es = [word("please", "en", "es", ["por favor"]), word("favour", "en", "es", ["favor"])];
    assert.deepEqual(surfaces("hazlo por favor", es, "es"), ["por favor"]);
    assert.deepEqual(surfaces("un favor", es, "es"), ["favor"]);
  });

  test("phrases longer than six words are left out of the index", () => {
    const idx = index([word("x", "ru", "en", ["one two three four five six seven"])], "en");
    assert.equal(idx.entries.size, 0);
    assert.equal(idx.diag.phrases, 1);
  });
});

describe("the index", () => {
  test("a word is found only in its own base, and never in its own language", () => {
    const ws = [word("perro", "es", "en", ["dog"]), word("dog", "en", "es", ["perro"]), word("dog", "en", "en", ["dog"])];
    assert.deepEqual(surfaces("my dog", ws, "en"), ["dog"]);
    assert.equal(M.scan("my dog", { base: "en" }, index(ws, "en")).matches[0].entry.candidates.length, 1);
    assert.deepEqual(surfaces("mi perro", ws, "es"), ["perro"]);
    assert.deepEqual(surfaces("mi perro", ws, "en"), [], "a Spanish meaning never matches English text");
  });

  test("keeps every candidate, several in one language too, newest first", () => {
    const a = word("новый", "ru", "en", ["new"]);
    const b = word("свежий", "ru", "en", ["new"]);
    const c = word("nuevo", "es", "en", ["new"]);
    const m = M.scan("a new day", { base: "en" }, index([a, b, c], "en")).matches[0];
    assert.deepEqual(m.entry.candidates.map((x) => x.word.native), ["новый", "свежий", "nuevo"]);
  });

  test("forms come from the record; disabled forms are left out; the gloss when there are none", () => {
    const w = word("собака", "ru", "en", [{ text: "dog", enabled: true }, { text: "hound", enabled: false }]);
    assert.deepEqual(surfaces("a dog and a hound", [w], "en"), ["dog"]);
    assert.deepEqual(surfaces("the cat", [{ ...word("кошка", "ru", "en", []), gloss: "cat" }], "en"), ["cat"]);
  });

  test("leaves out words that aren't swapped, and oversized natives and forms, counting them", () => {
    const ws = [
      word("a", "ru", "en", ["dog"], { status: "paused" }),
      word("b", "ru", "en", ["dog"], { deleted_at: "2026-10-01" }),
      word("x".repeat(65), "ru", "en", ["cat"]),
      word("two\nlines", "ru", "en", ["cow"]),
      word("ok", "ru", "en", ["y".repeat(65), "pig"]),
    ];
    const idx = index(ws, "en");
    assert.deepEqual([...idx.entries.keys()], ["pig"]);
    assert.deepEqual({ natives: idx.diag.natives, forms: idx.diag.forms }, { natives: 2, forms: 1 });
  });

  test("keeps the newest 20,000 words", () => {
    const ws = Array.from({ length: M.MAX_WORDS + 3 }, (_, i) => word(`w${i}`, "ru", "en", [`k${i}`]));
    const idx = index(ws, "en");
    assert.equal(idx.entries.size, M.MAX_WORDS);
    assert.equal(idx.diag.words, 3);
    assert.ok(idx.entries.has("k0") && !idx.entries.has(`k${M.MAX_WORDS}`));
  });

  test("symbolic forms are escaped and capped at 200", () => {
    const ws = [word("си", "ru", "en", ["c++", "(x", "[y", "a|b"])];
    assert.deepEqual(surfaces("use C++ and a|b", ws, "en"), ["C++", "a|b"]);
    const many = Array.from({ length: 205 }, (_, i) => word(`s${i}`, "ru", "en", [`x${i}#`]));
    const idx = index(many, "en");
    assert.equal(idx.symbolic.size, 200);
    assert.equal(idx.diag.symbolic, 5);
  });

  test("one index per base, at most four", () => {
    const ws = [word("犬", "ja", "es", ["perro"]), word("犬", "ja", "en", ["dog"])];
    const all = M.buildIndexes(ws, ["es", "en", "fr", "de", "it"], { rules });
    assert.deepEqual([...all.keys()], ["es", "en", "fr", "de"]);
    assert.equal(all.get("es").entries.size, 1);
    assert.equal(all.get("fr").size, 0);
  });
});

describe("base tags", () => {
  test("the same base: primary language and script", () => {
    assert.equal(M.sameBase("pt-BR", "pt"), true);
    assert.equal(M.sameBase("es-PR", "es"), true);
    assert.equal(M.sameBase("zh-TW", "zh-Hant"), true);
    assert.equal(M.sameBase("zh-CN", "zh-Hans"), true);
    assert.equal(M.sameBase("zh", "zh-Hant"), false);
    assert.equal(M.sameBase("iw", "he"), true, "the detector's old code for Hebrew");
    assert.equal(M.sameBase("en", "es"), false);
    assert.equal(M.baseOf("es-MX", ["en", "es"]), "es");
    assert.equal(M.baseOf("de", ["en", "es"]), null);
    assert.equal(M.baseOf("", ["en"]), null);
  });
});

describe("match details", () => {
  test("case shape, sentence start, neighbours and gaps", () => {
    const [m] = M.scan("Big dog runs", { base: "en", before: "A " }, index([word("собака", "ru", "en", ["dog"])], "en")).matches;
    assert.deepEqual({ start: m.start, end: m.end, shape: m.shape, sentenceStart: m.sentenceStart, tokens: m.tokens, tokenIndex: m.tokenIndex }, { start: 4, end: 7, shape: "lower", sentenceStart: false, tokens: 1, tokenIndex: 1 });
    assert.deepEqual(m.prevToken, { key: "big", surface: "Big", shape: "title", sentenceStart: false });
    assert.deepEqual(m.nextToken, { key: "runs", surface: "runs", shape: "lower", sentenceStart: false });
    assert.equal(m.prevGap, " ");
    assert.equal(m.nextGap, " ");
    const [p] = M.scan("Thank you!", { base: "en" }, index([word("спасибо", "ru", "en", ["thank you"])], "en")).matches;
    assert.deepEqual({ shape: p.shape, sentenceStart: p.sentenceStart, tokens: p.tokens, prev: p.prevToken, next: p.nextToken, nextGap: p.nextGap }, { shape: "title", sentenceStart: true, tokens: 2, prev: null, next: null, nextGap: "!" });
  });
});

describe("properties", () => {
  test("matches never overlap and always lie inside the text", () => {
    const vocab = ["a", "dog", "big dog", "thank you", "ice cream", "it", "c++", "can't", "house"];
    const ws = vocab.map((f, i) => word(`n${i}`, "ru", "en", [f]));
    const idx = index(ws, "en");
    const pieces = ["a ", "big ", "dog", " ", "thank ", "you", ", ", "ice-", "cream", "C++", "can't", "house's", "\u00ad", ".", "@", "it's"];
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let n = 0; n < 500; n++) {
      const text = Array.from({ length: 1 + Math.floor(rand() * 12) }, () => pieces[Math.floor(rand() * pieces.length)]).join("");
      const { matches } = M.scan(text, { base: "en", before: "x", after: "y" }, idx);
      let end = 0;
      for (const m of matches) {
        assert.ok(m.start >= end && m.end <= text.length && m.start < m.end, `${JSON.stringify(text)}: ${m.surface}`);
        assert.equal(text.slice(m.start, m.end), m.surface);
        end = m.end;
      }
    }
  });
});

describe("matchCase", () => {
  test("copies the page's capitals onto the shown word", () => {
    assert.equal(M.matchCase("house", "дом"), "дом");
    assert.equal(M.matchCase("House", "дом"), "Дом");
    assert.equal(M.matchCase("HOUSE", "дом"), "ДОМ");
    assert.equal(M.matchCase("I", "я"), "Я", "a single capital is not all-caps");
    assert.equal(M.matchCase("HOUSE", "谢谢"), "谢谢");
    assert.equal(M.matchCase("Ámbar", "амбра"), "Амбра", "capitals outside ASCII");
  });
});

// A maintainer report: toggles labelled "AOI I" / "AOI II" showed "AOI Я" for a learner
// who saved я ("I"). A lone capital next to a code, numeral or name isn't the pronoun.
describe("skipLetter", () => {
  const at = (s) => M.skipLetter(s.replace("|", ""), s.indexOf("|")); // "|" marks the letter

  test("skips a capital next to an acronym or a Roman numeral", () => {
    assert.equal(at("AOI |I"), true);
    assert.equal(at("AOI |I option"), true, "an acronym before, nothing pronoun-like after");
    assert.equal(at("Henry VIII |I"), true);
    assert.equal(at("|I II III"), true);
    assert.equal(at("|I AM SHOUTING"), true, "an all-caps word after");
    assert.equal(at("OK |I will"), true, "accepted: an all-caps word before always counts");
  });

  test("skips a capital after a name or title word", () => {
    assert.equal(at("World War |I"), true);
    assert.equal(at("World War |I began in 1914"), true, "War is mid-sentence");
    assert.equal(at("Type |I"), true);
    assert.equal(at("Vitamin |A."), true);
    assert.equal(at("Plan |B"), true);
  });

  test("skips a capital joined to a code by a hyphen or slash", () => {
    assert.equal(at("Take |I-95 north"), true);
    assert.equal(at("Take the 95-|I"), true);
    assert.equal(at("|I/O errors"), true);
    assert.equal(at("|I 95"), true, "digits after");
    assert.equal(at("Model 3 |I"), true, "digits before, nothing pronoun-like after");
  });

  test("keeps the pronoun", () => {
    assert.equal(at("|I think so"), false);
    assert.equal(at("Can |I go?"), false, "Can starts the sentence");
    assert.equal(at("Yes, |I agree."), false);
    assert.equal(at("Mary and |I went home."), false);
    assert.equal(at("In 2020 |I moved."), false, "a number before, a lowercase word after");
    assert.equal(at("Then |I said: no"), false);
    assert.equal(at("|I'm here"), false);
    assert.equal(at("|I"), false, "alone, with no evidence");
    assert.equal(at("Thanks, Dad. |I love you"), false, "Dad ends the previous sentence");
  });

  test("leaves lowercase letters alone", () => {
    assert.equal(at("|a NASA report"), false);
    assert.equal(at("|a 2020 study"), false);
    assert.equal(at("Plan |a"), false);
  });

  test("works through swap(): only the pronoun changes", () => {
    const words = [word("я", "ru", "en", ["I"])];
    assert.equal(swap("AOI I and AOI II; I think World War I ended. Type I, I-95.", words), "AOI I and AOI II; Я think World War I ended. Type I, I-95.");
  });
});

// Research 06 F04, fixed by slice 14: \b only knew ASCII, so apostrophes, hyphens and
// accents counted as word edges.
describe("F04 word boundaries", () => {
  const words = [
    word("можно", "ru", "en", ["can"]),
    word("дон", "ru", "en", ["don"]),
    word("хорошо", "ru", "en", ["well"]),
    word("проход", "ru", "en", ["pass"]),
    word("сумма", "ru", "en", ["sum"]),
    word("кафе", "ru", "en", ["café"]),
    word("это", "ru", "en", ["it"]),
  ];
  const cases = [
    ["contraction", "I can't go.", "I can't go."],
    ["contraction, capitalised", "Don't.", "Don't."],
    ["contraction with it", "It's late.", "It's late."],
    ["hyphenated compound", "a well-known fact", "a well-known fact"],
    ["accented word containing a form", "passé résumé", "passé résumé"],
    ["form ending in an accent", "a café.", "a кафе."],
    ["inflection of an accented form", "The cafés.", "The cafés."],
    ["plain words still match", "A naïve sum.", "A naïve сумма."],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => assert.equal(swap(input, words), expected));
  }
});

// Research 06 F13: acronyms and single letters. The lone-capital rule (skipLetter) is in;
// the rest is slice 16's token rules.
describe("F13 acronyms and single letters (slice 16)", () => {
  const words = [word("это", "ru", "en", ["it"]), word("нас", "ru", "en", ["us"]), word("кто", "ru", "en", ["who"]), word("ein", "de", "en", ["a", "an"])];
  const cases = [
    ["all-caps acronym IT", "the IT team", "the IT team"],
    ["all-caps acronym US", "the US government", "the US government"],
    ["all-caps acronym WHO", "WHO advice", "WHO advice"],
    ["single capital after a noun", "Vitamin A.", "Vitamin A.", true],
    ["plan letter", "Plan B and Plan A", "Plan B and Plan A", true],
    ["single-letter forms need opting in", "I think a cat is a pet.", "I think a cat is a pet."],
  ];
  for (const [name, input, expected, done] of cases) {
    test(name, { todo: !done && "slice 16: acronym and single-letter rules" }, () => {
      assert.equal(swap(input, words), expected);
    });
  }
});
