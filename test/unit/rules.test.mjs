// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 16's token rules (extension/lib/rules.js) on the matcher's real matches: every row
// of the spec's worked examples, in English, Spanish, German and Japanese.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, requireExt } from "../helpers/load-script.mjs";

const T = requireExt("lib/text.js");
const M = requireExt("lib/matcher.js");
const R = requireExt("lib/rules.js");
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "spec/lang/_generic", f), "utf8"));
const BOUNDARIES = read("boundaries.json");
const CASING = read("casing.json");
const casingFor = (base) => ({ ...CASING.default, ...(CASING[base] ?? CASING[base.split("-")[0]] ?? {}) });

let id = 1;
const word = (base, forms, lang = "ru") => ({ id: id++, lang, native: `n${id}`, base_lang: base, gloss: typeof forms[0] === "string" ? forms[0] : forms[0].text, forms, status: "active" });

// What content.js swaps on a page made of `texts`: the matches the rules keep, then the
// deferred ones the page's evidence settles.
function page(texts, words, base = "en") {
  const index = M.buildIndex(words, { base, rules: T.rulesFor(BOUNDARIES, base) });
  const rules = R.create();
  const C = casingFor(base);
  const out = texts.map(() => []);
  const deferred = [];
  texts.forEach((text, i) => {
    for (const m of M.scan(text, { base }, index).matches) {
      if (m.surface.length === 1 && M.skipLetter(text, m.start)) continue;
      const r = rules.judge(m, { text, casing: C });
      if (r?.keep) out[i].push(m.surface);
      else if (r?.defer) {
        rules.defer(m.key, r.defer, i);
        deferred.push({ i, m, kind: r.defer });
      }
    }
  });
  rules.settle();
  for (const d of deferred) if (rules.decision(d.m.key, d.kind)) out[d.i].push(d.m.surface);
  return out;
}
const swapped = (text, words, base) => page([text], words, base)[0].sort();

describe("English worked examples (slice 16 §3)", () => {
  const W = ["it", "us", "a", "I", "may", "will", "bill", "apple", "dog", "rose", "thank you", "team", "army", "report", "monday"].map((f) => word("en", [f]));
  const rows = [
    ["the IT team", ["team"]],
    ["the US army", ["army"]],
    ["Vitamin A is good", []],
    ["I think a cat is a pet", ["I", "a", "a"]],
    ["World War I began", []],
    ["Can I go?", ["I"]],
    ["So do I. Can I?", ["I", "I"]],
    ["Plan B, Type A", []],
    ["May 2026, on May 3", []],
    ["In May we left", []],
    ["Will Smith said", []],
    ["Will you come?", ["Will"]],
    ["Bill Gates paid a bill", ["a", "bill"]],
    ["She grew a Rose", ["a"]],
    ["THANK YOU FOR READING", ["THANK YOU"]],
    ["Read the WHO report", ["report"]],
    ["iPhone and eBay", []],
  ];
  for (const [text, want] of rows) test(text, () => assert.deepEqual(swapped(text, W), [...want].sort()));

  test("You may go. May I? (sentence start kept: no mid-sentence May on the page)", () => {
    assert.deepEqual(swapped("You may go. May I?", W), ["I", "May", "may"]);
  });

  test("a sentence-start capital waits for the page: Apple elsewhere mid-sentence drops it", () => {
    assert.deepEqual(page(["Apple announced a phone.", "We met at Apple today."], W), [["a"], []]);
    assert.deepEqual(page(["Apple pie is sweet.", "I ate an apple."], W), [["Apple"], ["I", "apple"]]);
  });

  test("a headline capital needs the word in lowercase on the page", () => {
    const D = [word("en", ["dog"])];
    assert.deepEqual(page(["Man Bites Dog", "The dog was fine."], D), [["Dog"], ["dog"]]);
    assert.deepEqual(page(["Man Bites Dog"], D), [[]]);
  });

  test("Monday with the proper flag: swapped as a capital, anywhere", () => {
    const P = [word("en", [{ text: "Monday", case: "proper" }])];
    assert.deepEqual(swapped("See you on Monday", P), ["Monday"]);
  });

  test("an exact form matches only as written; a lower form only lowercase or at a sentence start", () => {
    assert.deepEqual(swapped("the US and us", [word("en", [{ text: "US", case: "exact" }])]), ["US"]);
    const L = [word("en", [{ text: "rose", case: "lower" }])];
    assert.deepEqual(swapped("a rose, a Rose", L), ["rose"]);
    assert.deepEqual(swapped("Rose petals fell", L), ["Rose"]);
  });
});

// Research 06 F13, fixed by these rules: acronyms are left alone; the old test asked
// single-letter forms to need opting in, which slice 16 decided against (an English "a"
// mid-sentence is the word).
describe("F13 acronyms and single letters", () => {
  const W = [word("en", ["it"]), word("en", ["us"]), word("en", ["who"]), word("en", ["a", "an"], "de")];
  const rows = [
    ["the IT team", []],
    ["the US government", []],
    ["WHO advice", []],
    ["Vitamin A.", []],
    ["Plan B and Plan A", []],
    ["I think a cat is a pet.", ["a", "a"]],
  ];
  for (const [text, want] of rows) test(text, () => assert.deepEqual(swapped(text, W), [...want].sort()));
});

describe("Spanish worked examples", () => {
  const W = ["a", "y", "mayo", "rosa", "perro", "equipo", "ejército", "español"].map((f) => word("es", [f], "en"));
  const rows = [
    ["el equipo de TI", ["equipo"]],
    ["el ejército de EE. UU.", ["ejército"]],
    ["Vitamina A", []],
    ["Voy a casa y como", ["a", "y"]],
    ["Plan B", []],
    ["el 3 de mayo, Mayo 2026", ["mayo"]],
    ["Ayer vi a Rosa", ["a"]],
    ["El Perro Andaluz", []],
    ["la Sra. Rosa", []],
    ["¿Hablas español?", ["español"]],
  ];
  for (const [text, want] of rows) test(text, () => assert.deepEqual(swapped(text, W, "es"), [...want].sort()));

  test("Rosa dijo que sí, with Rosa mid-sentence elsewhere", () => {
    assert.deepEqual(page(["Rosa dijo que sí.", "Ayer vi a Rosa."], W, "es"), [[], ["a"]]);
  });
});

describe("German worked examples", () => {
  const W = [word("de", ["Hund"], "en"), word("de", ["Wolf"], "en")];
  test("Der Hund bellt laut: nouns are capitalised, not names", () => assert.deepEqual(swapped("Der Hund bellt laut", W, "de"), ["Hund"]));
  test("Herr Wolf kommt: an honorific makes it a name", () => assert.deepEqual(swapped("Herr Wolf kommt", W, "de"), []));
});

describe("Japanese worked examples", () => {
  const W = [word("ja", ["犬"], "en"), word("ja", ["猫"], "en")];
  test("犬と猫が好き: caseless; one-character words are normal", () => assert.deepEqual(swapped("犬と猫が好き", W, "ja"), ["犬", "猫"]));
});

describe("shouting and Title Case runs", () => {
  test("detection", () => {
    assert.equal(R.shouting("THANK YOU FOR READING"), true);
    assert.equal(R.shouting("THANK YOU"), false, "too short");
    assert.equal(R.titleRun("Man Bites Dog"), true);
    assert.equal(R.titleRun("Ten Things You Should Know About the Dog"), true);
    assert.equal(R.titleRun("Will Smith said"), false);
    assert.equal(R.titleRun("The dog was fine today"), false);
  });

  test("decisions are final on a page view", () => {
    const r = R.create();
    r.defer("may", "start", "n1");
    assert.deepEqual(r.settle(), ["n1"]);
    assert.equal(r.decision("may", "start"), true);
    r.defer("may", "start", "n2");
    assert.deepEqual(r.settle(), [], "already decided: nothing pending");
  });
});
