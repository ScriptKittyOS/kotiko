// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// lib/word-merge.js against spec/fixtures/merge.json, which Kotiko.WordMerge passes too
// (server/test/kotiko/word_merge_test.exs), and native-key.json.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, requireExt } from "../helpers/load-script.mjs";

const M = requireExt("lib/word-merge.js");
const fixture = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, "spec/fixtures", rel), "utf8"));

describe("merge rules (spec/fixtures/merge.json)", () => {
  for (const c of fixture("merge.json").cases) {
    test(c.name, () => {
      assert.deepEqual(M.changes(c.existing, c.incoming, { explicit: c.opts?.explicit === true }), c.changes);
    });
  }
});

describe("native key (spec/fixtures/native-key.json)", () => {
  for (const c of fixture("native-key.json").cases) {
    test(c.note, () => assert.equal(M.nativeKey(c.input), c.key));
  }
});

test("the natural key holds lang, native key, sense and base", () => {
  assert.deepEqual(M.naturalKey({ lang: "ja", native: "犬", base_lang: "es" }), ["ja", "犬", "", "es"]);
  assert.deepEqual(M.naturalKey({ lang: "el", native: "ΣΑΣ", sense: "you", base_lang: "en" }), ["el", "σασ", "you", "en"]);
});

test("forms get their defaults from strings and objects", () => {
  assert.deepEqual(M.form("dog"), { text: "dog", enabled: true, case: "any", ambiguous: false });
  assert.deepEqual(M.form({ text: "Dog", case: "proper", enabled: false }), { text: "Dog", enabled: false, case: "proper", ambiguous: false });
  assert.deepEqual(M.form({ text: "x", case: "shouting" }).case, "any");
});
