// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Properties of the check every server word list goes through before it is cached or put
// on a page (lib/validate-words.js, slice 26), on generated responses: what a broken or
// hostile server might send.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fc } from "../../helpers/properties.mjs";
import { requireExt } from "../../helpers/load-script.mjs";

const V = requireExt("lib/validate-words.js");
const CODES = new Set(["server_key_rejected", "server_address_invalid", "server_unreachable", "internal", "not_kotiko_server"]);

const text = (max) => fc.oneof(fc.string({ maxLength: max }), fc.string({ unit: "grapheme", maxLength: max }), fc.constantFrom("", " ", "a\nb", "\u2028", "x".repeat(max + 1)));
const form = fc.oneof(text(45), fc.record({ text: text(45), enabled: fc.boolean() }, { requiredKeys: [] }), fc.anything());
// Words close to valid, so most generated ones are kept or fixed rather than all dropped.
const serverWord = fc.record(
  {
    id: fc.oneof(fc.integer(), fc.uuid(), fc.constant(""), fc.constant(null)),
    lang: fc.oneof(fc.constantFrom("es", "ja", "ru", "pt-BR"), text(40)),
    base_lang: fc.oneof(fc.constantFrom("en", "es"), fc.constant(undefined), fc.integer()),
    native: text(70),
    forms: fc.oneof(fc.array(form, { maxLength: 14 }), fc.constant(null), fc.string()),
    english: fc.oneof(text(45), fc.constant(undefined)), // base-neutral-ok: a 0.2 server's words
    pronunciation: fc.oneof(text(100), fc.constant(null), fc.integer()),
    pronunciation_careful: fc.oneof(text(100), fc.constant(null)),
    reading: fc.oneof(text(70), fc.constant(null)),
    native_vocalized: fc.oneof(text(20), fc.constant(null)),
    pronunciation_source: fc.oneof(fc.constantFrom("model", "user", "wiktionary", "elsewhere"), fc.constant(null)),
    verification: fc.oneof(fc.constant(null), fc.record({ pronunciation: fc.record({ status: fc.constantFrom("verified", "corrected", "differs", "no_data", "maybe"), source: text(45), stressed: text(20) }, { requiredKeys: [] }) }, { requiredKeys: [] }), fc.anything()),
  },
  { requiredKeys: ["id", "lang", "native"] },
);
const list = fc.array(fc.oneof({ weight: 6, arbitrary: serverWord }, { weight: 1, arbitrary: fc.anything() }), { maxLength: 20 });

describe("filterWords", () => {
  test("every word is kept or counted, and every kept word passes the checks again unchanged", () => {
    fc.assert(
      fc.property(list, (words) => {
        const r = V.filterWords(words);
        assert.equal(r.words.length + r.dropped, words.length);
        for (const w of r.words) {
          assert.equal(V.checkWord(w), null);
          assert.equal(V.extraFixes(w), null);
          assert.ok((w.forms ?? []).length <= V.LIMITS.maxForms);
        }
        // Idempotent: a filtered list goes through again untouched.
        const again = V.filterWords(r.words);
        assert.deepEqual(again.words, r.words);
        assert.equal(again.dropped, 0);
        assert.equal(again.droppedForms, 0);
      }),
    );
  });

  test("a clean word is passed on as the very same object", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.constantFrom("es", "ja"), fc.stringMatching(/^[a-z]{1,20}$/), fc.array(fc.stringMatching(/^[a-z]{1,20}$/), { minLength: 1, maxLength: 10 }), (id, lang, native, forms) => {
        const w = { id, lang, native, forms };
        assert.equal(V.filterWords([w]).words[0], w);
      }),
    );
  });
});

describe("validateWordsResponse", () => {
  test("any response, however broken, gives a word list or one of the known errors", () => {
    const response = fc.record(
      {
        status: fc.oneof(fc.constantFrom(200, 401, 404, 421, 500, 502, 503, 504), fc.integer({ min: 100, max: 599 }), fc.anything()),
        contentType: fc.oneof(fc.constantFrom("application/json", "application/json; charset=utf-8", "text/html", ""), fc.anything()),
        body: fc.oneof(list.map((words) => JSON.stringify({ words })), fc.jsonValue().map((v) => JSON.stringify(v)), fc.string(), fc.anything()),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(fc.oneof(response, fc.anything()), (raw) => {
        const r = V.validateWordsResponse(raw);
        if (r.ok) return assert.ok(Array.isArray(r.words));
        assert.ok(CODES.has(r.code), r.code);
        assert.equal(typeof r.message, "string");
        if (r.details.error !== undefined) assert.ok(r.details.error.length <= 200);
      }),
    );
  });
});
