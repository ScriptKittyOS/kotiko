// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 07 section 2: the natural key's native_key must be the same in JavaScript and
// Elixir (server/test/kotiko/text_test.exs reads the same file). Slice 11's local store
// will import its own implementation; until then this is the reference function.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../helpers/load-script.mjs";

const nativeKey = (native) => native.normalize("NFC").toLowerCase().replaceAll("ς", "σ");

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "spec/fixtures/native-key.json"), "utf8"));

test("native-key.json has the scripts slice 07 names", () => {
  const notes = fixture.cases.map((c) => c.note).join(" ");
  for (const script of ["Greek", "Turkish", "German", "Cyrillic", "Armenian", "Georgian", "caseless"]) {
    assert.match(notes, new RegExp(script), script);
  }
});

for (const { note, input, key } of fixture.cases) {
  test(`native_key: ${note}`, () => {
    assert.equal(nativeKey(input), key);
    // Idempotent, and the same for any normalisation of the input.
    assert.equal(nativeKey(key), key);
    assert.equal(nativeKey(input.normalize("NFD")), key);
  });
}
