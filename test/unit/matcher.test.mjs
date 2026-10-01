// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
// SPDX-License-Identifier: Apache-2.0

// Today's matcher (extension/lib/matcher.js), pinned before slice 14 rewrites it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { requireExt } from "../helpers/load-script.mjs";

const M = requireExt("lib/matcher.js");

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

// What content.js puts on the page for `text`, without a DOM: each match becomes the
// case-matched native word of the language whose turn it is.
function swap(text, words, hidden = []) {
  const m = M.buildMatcher(words, new Set(hidden));
  if (!m) return text;
  return text.replace(m.re, (en) => {
    const all = m.map.get(M.norm(en));
    const turn = m.turns.get(all) ?? 0;
    m.turns.set(all, turn + 1);
    return M.matchCase(en, all[turn % all.length].native);
  });
}

describe("module shape", () => {
  test("exports the matcher API and sets globalThis.MiraMatcher", () => {
    for (const k of ["escapeRe", "norm", "languageName", "buildMatcher", "matchCase", "describe", "tooltip"]) {
      assert.equal(typeof M[k], "function", k);
    }
    assert.equal(globalThis.MiraMatcher, M);
  });
});

describe("buildMatcher", () => {
  test("returns null when there is nothing to match", () => {
    assert.equal(M.buildMatcher([], new Set()), null);
    assert.equal(M.buildMatcher([word("дом", "house")], new Set(["ru"])), null);
    assert.equal(M.buildMatcher([word("дом", "", [])], new Set()), null);
  });

  test("falls back to the English word when there are no forms", () => {
    assert.equal(swap("my house", [word("дом", "house", [])]), "my дом");
    assert.equal(swap("my house", [word("дом", "house", null)]), "my дом");
  });

  test("matches every form, case-insensitively, as whole words", () => {
    const words = [word("дом", "house", ["house", "houses"])];
    assert.equal(swap("House, houses and HOUSES; a housemate", words), "Дом, дом and ДОМ; a housemate");
  });

  test("prefers the longest form, and multi-word forms match across any whitespace", () => {
    const words = [word("лёд", "ice"), word("мороженое", "ice cream", ["ice cream"])];
    assert.equal(swap("Ice\n   cream and ice", words), "Мороженое and лёд");
  });

  test("normalises form case and spacing", () => {
    assert.equal(swap("thank you!", [word("спасибо", "thanks", ["  Thank   You "])]), "спасибо!");
  });

  test("keeps one candidate per language, newest (first) wins", () => {
    const m = M.buildMatcher([word("новый", "new"), word("старый", "new")], new Set());
    assert.deepEqual(m.map.get("new").map((w) => w.native), ["новый"]);
  });

  test("rotates between languages for the same English word", () => {
    const words = [word("спасибо", "thanks", ["thanks"], "ru"), word("شكرا", "thanks", ["thanks"], "ar")];
    assert.equal(swap("thanks thanks thanks", words), "спасибо شكرا спасибо");
  });

  test("leaves hidden languages out", () => {
    const words = [word("спасибо", "thanks", ["thanks"], "ru"), word("شكرا", "thanks", ["thanks"], "ar")];
    assert.equal(swap("thanks thanks", words, ["ru"]), "شكرا شكرا");
  });

  test("escapes regular-expression characters in forms", () => {
    const words = [word("нод", "node.js", ["node.js"])];
    assert.equal(swap("node.js and nodexjs", words), "нод and nodexjs");
    assert.doesNotThrow(() => M.buildMatcher([word("си", "c++", ["c++", "(x", "[y", "a|b"])], new Set()));
  });
});

describe("matchCase", () => {
  test("copies the English word's casing onto the native word", () => {
    assert.equal(M.matchCase("house", "дом"), "дом");
    assert.equal(M.matchCase("House", "дом"), "Дом");
    assert.equal(M.matchCase("HOUSE", "дом"), "ДОМ");
    assert.equal(M.matchCase("I", "я"), "Я", "a single capital is not all-caps");
    assert.equal(M.matchCase("HOUSE", "谢谢"), "谢谢");
  });
});

describe("tooltip", () => {
  test("describes the shown word, its note and the other languages", () => {
    const ru = word("спасибо", "thanks", ["thanks"], "ru", { language: "Russian", romanization: "spasibo", note: "Most common." });
    const ar = word("شكرا", "thanks", ["thanks"], "ar", { language: "Arabic" });
    assert.equal(M.tooltip("Thanks", ru, [ru, ar]), "Thanks = спасибо (spasibo) · Russian\nMost common.\n\nشكرا · Arabic");
    assert.equal(M.tooltip("thanks", ar, [ar]), "thanks = شكرا · Arabic");
  });

  test("names languages from their code when the server sent no name", () => {
    assert.equal(M.languageName({ lang: "ja" }), "Japanese");
    assert.equal(M.languageName({ lang: "ja", language: "Nihongo" }), "Nihongo");
    assert.equal(M.languageName({ lang: "not a code!" }), "not a code!");
  });
});

// Research 06 F04: \b only knows ASCII, so apostrophes, hyphens and accents count as
// boundaries. Slice 14 replaces it with Unicode lookarounds.
describe("F04 word boundaries (slice 14)", () => {
  const words = [
    word("можно", "can"),
    word("дон", "don"),
    word("хорошо", "well"),
    word("проход", "pass"),
    word("сумма", "sum"),
    word("кафе", "café", ["café"]),
    word("это", "it"),
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
    test(name, { todo: "slice 14: Unicode word boundaries" }, () => {
      assert.equal(swap(input, words), expected);
    });
  }
});

// Research 06 F13: the i flag makes acronyms match, and single letters are too common.
describe("F13 acronyms and single letters (slice 14)", () => {
  const words = [word("это", "it"), word("нас", "us"), word("кто", "who"), word("ein", "a", ["a", "an"], "de")];
  const cases = [
    ["all-caps acronym IT", "the IT team", "the IT team"],
    ["all-caps acronym US", "the US government", "the US government"],
    ["all-caps acronym WHO", "WHO advice", "WHO advice"],
    ["single capital after a noun", "Vitamin A.", "Vitamin A."],
    ["plan letter", "Plan B and Plan A", "Plan B and Plan A"],
    ["single-letter forms need opting in", "I think a cat is a pet.", "I think a cat is a pet."],
  ];
  for (const [name, input, expected] of cases) {
    test(name, { todo: "slice 14: acronym and single-letter rules" }, () => {
      assert.equal(swap(input, words), expected);
    });
  }
});
