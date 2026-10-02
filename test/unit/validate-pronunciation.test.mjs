// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The pronunciation fields in a synced word list (slices 07 §7, 19, 26): accepted, capped,
// and dropped one by one when bad, never taking the word with them.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { requireExt } from "../helpers/load-script.mjs";
import { POPOVER_WORDS } from "../helpers/popover-words.mjs";

const { filterWords, LIMITS } = requireExt("lib/validate-words.js");
const base = { id: 1, lang: "ru", native: "пожалуйста", english: "please", forms: ["please"] };

describe("pronunciation fields in the word list", () => {
  test("the fixture words pass untouched (same objects)", () => {
    const { words, dropped } = filterWords(POPOVER_WORDS);
    assert.equal(dropped, 0);
    POPOVER_WORDS.forEach((w, i) => assert.equal(words[i], w));
  });

  test("a legacy word without the new fields is untouched", () => {
    const w = { ...base };
    assert.equal(filterWords([w]).words[0], w);
  });

  const bad = [
    ["a pronunciation over the cap", { pronunciation: "pa-".repeat(40) + "ZHAL" }, "pronunciation"],
    ["a pronunciation with a newline", { pronunciation: "pa-ZHAL\nsta" }, "pronunciation"],
    ["a careful form that isn't text", { pronunciation_careful: 42 }, "pronunciation_careful"],
    ["a reading over the cap", { reading: "い".repeat(LIMITS.maxReading + 1) }, "reading"],
    ["an unknown source", { pronunciation: "pa-ZHAL-sta", pronunciation_source: "dictionary-ish" }, "pronunciation_source"],
    ["a vocalized form of another word", { native_vocalized: "спаси́бо" }, "native_vocalized"],
  ];
  for (const [what, fields, field] of bad) {
    test(`${what}: that field is dropped, the word is kept`, () => {
      const { words, dropped } = filterWords([{ ...base, ...fields }]);
      assert.equal(dropped, 0);
      assert.equal(words.length, 1);
      assert.equal(words[0][field], null);
      assert.equal(words[0].native, "пожалуйста");
    });
  }

  test("a vocalized form of the same word is kept, whatever marks it adds", () => {
    const w = { ...base, native_vocalized: "пожа́луйста" };
    assert.equal(filterWords([w]).words[0], w);
    const ar = { id: 2, lang: "ar", native: "كتاب", native_vocalized: "كِتَاب", english: "book", forms: ["book"] };
    assert.equal(filterWords([ar]).words[0], ar);
  });

  test("verification keeps only its known shape", () => {
    const w = { ...base, verification: { pronunciation: { status: "verified", source: "Wiktionary", extra: "<b>x</b>" }, meaning: { status: "verified" } } };
    assert.deepEqual(filterWords([w]).words[0].verification, { pronunciation: { status: "verified", source: "Wiktionary" } });
    const odd = { ...base, verification: { pronunciation: { status: "trust-me" } } };
    assert.equal(filterWords([odd]).words[0].verification, null);
  });
});
