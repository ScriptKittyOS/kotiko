// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
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
// case-matched native word of the language whose turn it is. Lone capitals that are part
// of a name or code stay (skipLetter).
function swap(text, words, hidden = []) {
  const m = M.buildMatcher(words, new Set(hidden));
  if (!m) return text;
  return text.replace(m.re, (en, at) => {
    if (en.length === 1 && M.skipLetter(text, at)) return en;
    const all = m.map.get(M.norm(en));
    const turn = m.turns.get(all) ?? 0;
    m.turns.set(all, turn + 1);
    return M.matchCase(en, all[turn % all.length].native);
  });
}

describe("module shape", () => {
  test("exports the matcher API and sets globalThis.KotikoMatcher", () => {
    for (const k of ["escapeRe", "norm", "languageName", "buildMatcher", "matchCase", "describe", "tooltip", "skipLetter"]) {
      assert.equal(typeof M[k], "function", k);
    }
    assert.equal(globalThis.KotikoMatcher, M);
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
    assert.equal(at("|I'm here"), false, "contractions are slice 14's");
    assert.equal(at("|I"), false, "alone, with no evidence");
    assert.equal(at("Thanks, Dad. |I love you"), false, "Dad ends the previous sentence");
  });

  test("leaves lowercase letters alone", () => {
    assert.equal(at("a NASA report".replace("a", "|a")), false);
    assert.equal(at("|a 2020 study"), false);
    assert.equal(at("Plan |a"), false);
  });

  test("works through swap(): only the pronoun changes", () => {
    const words = [word("я", "I")];
    assert.equal(swap("AOI I and AOI II; I think World War I ended. Type I, I-95.", words), "AOI I and AOI II; Я think World War I ended. Type I, I-95.");
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
    // done early by skipLetter (the "AOI I" report)
    ["single capital after a noun", "Vitamin A.", "Vitamin A.", true],
    ["plan letter", "Plan B and Plan A", "Plan B and Plan A", true],
    ["single-letter forms need opting in", "I think a cat is a pet.", "I think a cat is a pet."],
  ];
  for (const [name, input, expected, done] of cases) {
    test(name, { todo: !done && "slice 14: acronym and single-letter rules" }, () => {
      assert.equal(swap(input, words), expected);
    });
  }
});
