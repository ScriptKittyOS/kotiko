// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 19 §1 and §1a: what the word card shows, from lib/word-card.js (no DOM).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { requireExt } from "../helpers/load-script.mjs";
import { BOOK, CASTLE, DOG, GOOD, PLEASE, THANKS_RU, THANKS_ZH, WATER } from "../helpers/popover-words.mjs";

const { cardFor, parsePronunciation, pronunciationA11y, sourceLabel } = requireExt("lib/word-card.js");

describe("the pronunciation block (19 §1a)", () => {
  test("пожалуйста: stress-marked word, respelling, careful form, romanization and AI label", () => {
    const c = cardFor(PLEASE);
    assert.equal(c.headword, "пожа́луйста");
    assert.equal(c.native, "пожалуйста");
    assert.deepEqual(c.pronunciation, [[{ text: "pa" }, { text: "ZHAL", stressed: true }, { text: "sta" }]]);
    assert.deepEqual(c.careful[0].map((s) => s.text), ["pa", "ZHA", "lu", "sta"]);
    assert.equal(c.romanization, "pozhaluysta");
    assert.equal(c.romanizationLang, "ru-Latn");
    assert.deepEqual(c.label, { kind: "ai" });
  });

  test("谢谢: plain native, tone digits split off, pinyin romanization", () => {
    const c = cardFor(THANKS_ZH);
    assert.equal(c.headword, "谢谢");
    assert.deepEqual(c.pronunciation, [[{ text: "shyeh", tone: 4 }, { text: "shyeh" }]]);
    assert.equal(c.romanizationLang, "zh-Latn-pinyin");
    assert.equal(c.stressMarked, false);
  });

  test("tone digits are only read on tonal targets", () => {
    assert.deepEqual(parsePronunciation("dva2", "ru"), [[{ text: "dva2" }]]);
    assert.deepEqual(parsePronunciation("do1-ze6", "yue"), [[{ text: "do", tone: 1 }, { text: "ze", tone: 6 }]]);
    assert.deepEqual(parsePronunciation("nee2 how3", "zh"), [[{ text: "nee", tone: 2 }], [{ text: "how", tone: 3 }]]);
  });

  test("words are split on spaces, syllables on hyphens; a capital syllable is stressed", () => {
    assert.deepEqual(parsePronunciation("da svi-DA-nya", "ru"), [[{ text: "da" }], [{ text: "svi" }, { text: "DA", stressed: true }, { text: "nya" }]]);
    assert.equal(parsePronunciation(null, "ru"), null);
    assert.equal(parsePronunciation("  ", "ru"), null);
  });

  test("the accessible text is lowercase with the stressed syllable named, and tones as words", () => {
    assert.deepEqual(pronunciationA11y(parsePronunciation("pa-ZHAL-sta", "ru")), { plain: "pa-zhal-sta", stressed: ["zhal"] });
    assert.deepEqual(pronunciationA11y(parsePronunciation("shyeh4-shyeh", "zh"), (n) => `tono ${n}`), { plain: "shyeh tono 4-shyeh", stressed: [] });
  });

  test("Japanese: the kana reading follows the word; no stress", () => {
    const c = cardFor(DOG);
    assert.equal(c.reading, "いぬ");
    assert.equal(c.romanizationLang, "ja-Latn");
    assert.equal(c.stressMarked, false);
  });

  test("no pronunciation: no respelling lines and no label, the romanization stays", () => {
    const c = cardFor(BOOK);
    assert.equal(c.pronunciation, null);
    assert.equal(c.careful, null);
    assert.equal(c.label, null);
    assert.equal(c.romanization, "kitab");
  });

  test("a Latin-script target has no romanization line; the label moves to its own line", () => {
    const c = cardFor({ id: 1, lang: "es", native: "gracias", pronunciation: "GRA-syas", pronunciation_source: "model", english: "thanks" });
    assert.equal(c.romanization, null);
    assert.deepEqual(c.label, { kind: "ai" });
    assert.equal(cardFor({ ...BOOK, romanization: "كتاب" }).romanization, null, "same as the word: not shown");
  });

  test("the careful form only with an everyday one, and only when it differs", () => {
    assert.equal(cardFor({ ...PLEASE, pronunciation_careful: "pa-ZHAL-sta" }).careful, null);
    assert.equal(cardFor({ ...PLEASE, pronunciation: null }).careful, null);
  });

  test("native_vocalized only for ru, uk and be", () => {
    assert.equal(cardFor({ ...BOOK, native_vocalized: "كِتَاب" }).headword, "كتاب", "Arabic vowel marks follow 37's mode");
    assert.equal(cardFor({ ...PLEASE, native_vocalized: null }).headword, "пожалуйста");
  });
});

describe("the source label (19 §1a, 49 §4a)", () => {
  const rows = [
    ["model, no dictionary", { pronunciation: "x-Y", pronunciation_source: "model" }, { kind: "ai" }],
    ["no source recorded", { pronunciation: "x-Y", pronunciation_source: null }, { kind: "ai" }],
    ["verified", { pronunciation: "x-Y", pronunciation_source: "model", verification: { pronunciation: { status: "verified", source: "Wiktionary" } } }, { kind: "checked", source: "Wiktionary" }],
    ["corrected", { pronunciation: "x-Y", pronunciation_source: "model", verification: { pronunciation: { status: "corrected", source: "Wiktionary" } } }, { kind: "checked", source: "Wiktionary" }],
    ["differs", { pronunciation: "x-Y", pronunciation_source: "model", verification: { pronunciation: { status: "differs", source: "Wiktionary" } } }, { kind: "differs", source: "Wiktionary" }],
    ["no_data", { pronunciation: "x-Y", pronunciation_source: "model", verification: { pronunciation: { status: "no_data", source: "Wiktionary" } } }, { kind: "ai" }],
    ["written from Wiktionary's IPA (49 §4b)", { pronunciation: "EH-ta", pronunciation_source: "wiktionary" }, { kind: "checked", source: "Wiktionary" }],
    ["the learner's own", { pronunciation: "x-Y", pronunciation_source: "user" }, null],
    ["the learner's own, even when it differs", { pronunciation: "x-Y", pronunciation_source: "user", verification: { pronunciation: { status: "differs", source: "W" } } }, null],
    ["no pronunciation", { pronunciation: null, pronunciation_source: null }, null],
  ];
  for (const [what, fields, label] of rows) {
    test(what, () => assert.deepEqual(sourceLabel(fields), label));
  }

  test("checked, the learner's own and differs on the fixture words", () => {
    assert.deepEqual(cardFor(GOOD).label, { kind: "checked", source: "Wiktionary" });
    assert.equal(cardFor(WATER).label, null);
    const castle = cardFor(CASTLE);
    assert.deepEqual(castle.label, { kind: "differs", source: "Wiktionary" });
    assert.equal(castle.headword, "за́мок", "the first line shows the dictionary's stress");
  });
});

describe("meaning, Also and other bases", () => {
  test("Also lists the other candidates with their romanization, not this word", () => {
    const c = cardFor(THANKS_ZH, { all: [THANKS_ZH, THANKS_RU] });
    assert.deepEqual(c.also, [{ native: "спасибо", lang: "ru", langs: ["ru"], romanization: "spasibo" }]);
    assert.equal(c.gloss, "thanks");
    assert.match(c.note, /谢谢你/);
  });

  test("identical natives merge into one item that lists both languages", () => {
    const sr = { id: 1, lang: "sr-Latn", native: "da", english: "yes" };
    const hr = { id: 2, lang: "hr", native: "da", english: "yes" };
    const de = { id: 3, lang: "de", native: "ja", english: "yes" };
    assert.deepEqual(cardFor(de, { all: [de, sr, hr] }).also, [{ native: "da", lang: "sr-Latn", langs: ["sr-Latn", "hr"], romanization: null }]);
  });

  test("other bases: at most two, never this record's base, gloss from `gloss` or `english`", () => {
    const en = { id: 1, lang: "ja", native: "犬", base_lang: "en", gloss: "dog" };
    const es = { id: 2, lang: "ja", native: "犬", base_lang: "es", gloss: "perro" };
    const fr = { id: 3, lang: "ja", native: "犬", base_lang: "fr", english: "chien" };
    const de = { id: 4, lang: "ja", native: "犬", base_lang: "de", gloss: "Hund" };
    assert.deepEqual(cardFor(es, { others: [en, fr, de] }).otherBases, [{ base: "en", gloss: "dog" }, { base: "fr", gloss: "chien" }]);
    assert.equal(cardFor(es).gloss, "perro");
    assert.equal(cardFor(es).base, "es");
    assert.deepEqual(cardFor(en).otherBases, []);
  });
});

test("a respelling that only repeats the word is hidden; one that marks stress stays", () => {
  const dog = cardFor({ lang: "en", base_lang: "es", native: "dog", pronunciation: "dog", romanization: null, gloss: "perro" });
  assert.equal(dog.pronunciation, null);
  assert.equal(dog.label, null);
  const hotel = cardFor({ lang: "en", base_lang: "es", native: "hotel", pronunciation: "jo-TEL", gloss: "hotel" });
  assert.ok(hotel.pronunciation, "different letters stay");
  const stressOnly = cardFor({ lang: "es", base_lang: "en", native: "hotel", pronunciation: "o-TEL", gloss: "hotel" });
  assert.ok(stressOnly.pronunciation, "letters differ (silent h)");
  const sameButStressed = cardFor({ lang: "en", base_lang: "es", native: "taxi", pronunciation: "TA-xi", gloss: "taxi" });
  assert.ok(sameButStressed.pronunciation, "stress marks teach something even with the same letters");
});
