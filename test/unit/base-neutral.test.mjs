// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// scripts/check-base-neutral.mjs (slice 50 §7 rule 1): English-named base concepts in code
// fail; prose, language names, reads of old data and marked lines pass.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { findInText } from "../../scripts/check-base-neutral.mjs";

const lines = (text) => findInText(text).map((f) => f.line);

describe("check-base-neutral", () => {
  test("finds fields, keys and variables named for English", () => {
    assert.deepEqual(lines("const english = w.gloss;"), [1]);
    assert.deepEqual(lines("return { english: gloss };"), [1]);
    assert.deepEqual(lines("w.english_forms.map(f)"), [1]);
    assert.deepEqual(lines("const englishForms = [];"), [1]);
    assert.deepEqual(lines("const glossOrEnglish = x;"), [1]);
    assert.deepEqual(lines('if (has("english")) x();'), [1]);
    assert.deepEqual(lines('%{"english" => g}'), [1]);
  });

  test("prose, language names and comments pass", () => {
    assert.deepEqual(lines("// the English pages a learner reads"), []);
    assert.deepEqual(lines("const n = 1; // english side, in a trailing comment"), []);
    assert.deepEqual(lines('{"en": {"name": "English"}}'), []);
    assert.deepEqual(lines("# Elixir comment about english"), []);
  });

  test("a fallback read of the old field passes; anything else on the line still counts", () => {
    assert.deepEqual(lines("const g = r.gloss ?? r.english;"), []);
    assert.deepEqual(lines("text(o?.gloss ?? o?.english)"), []);
    assert.deepEqual(lines("rec(x).gloss ?? rec(x).english ?? ''"), []);
    assert.deepEqual(lines("const english = r.gloss ?? r.english;"), [1]);
  });

  test("markers: on the line, on the comment line before it, or around a block", () => {
    assert.deepEqual(lines("w.english_forms // base-neutral-ok"), []);
    assert.deepEqual(lines("# base-neutral-ok: legacy\nforms: w[\"english_forms\"]"), []);
    assert.deepEqual(lines("// base-neutral-ok-start\nenglish: g,\nenglish_forms: f,\n// base-neutral-ok-end\nenglish: g"), [5]);
  });
});
