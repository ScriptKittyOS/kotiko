// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Properties of how a swapped word is written (lib/casing.js, slice 17) on generated words
// in many scripts.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fc } from "../../helpers/properties.mjs";
import { requireExt } from "../../helpers/load-script.mjs";

const C = requireExt("lib/casing.js");

const word = fc.oneof(
  fc.string({ unit: "grapheme", maxLength: 12 }),
  fc.stringMatching(/^[a-zçñäöüß]{1,10}$/),
  fc.stringMatching(/^[а-яё]{1,10}$/),
  fc.stringMatching(/^[α-ωάέήίόύώϊϋΐΰ]{1,10}$/),
  fc.stringMatching(/^[ა-ჰ]{1,8}$/),
  fc.stringMatching(/^[ぁ-ゖ一-龯]{1,6}$/),
  fc.constantFrom("ijs", "ǆungla", "ǈubav", "istanbul", "ıslak", "ἄνθρωπος", "Monday", "COVID", "iPhone"),
);
const lang = fc.constantFrom("en", "es", "de", "tr", "az", "lt", "el", "ru", "ka", "ja", "nl", "sr-Latn", "hr", "xx");
const shape = fc.constantFrom("lower", "title", "upper", "mixed", undefined);

describe("display", () => {
  test("a capital is only passed on at a sentence start or in a shouted line; otherwise the word shows as stored", () => {
    fc.assert(
      fc.property(word, lang, shape, fc.boolean(), fc.boolean(), (native, l, s, sentenceStart, shouting) => {
        const out = C.display({ shape: s, sentenceStart, shouting, native, lang: l });
        const passesOn = (s === "upper" && shouting) || (s === "title" && sentenceStart);
        if (!passesOn || !C.hasCase(native)) assert.equal(out, native);
        else assert.equal(out, s === "upper" ? C.upper(native, l) : C.title(native, l));
      }),
    );
  });

  test("title case changes only the first letter (and its marks), never the rest of the word", () => {
    fc.assert(
      fc.property(word, lang, (native, l) => {
        fc.pre(native.length > 0 && !(l === "nl" && native.startsWith("ij")));
        const out = C.title(native, l);
        const first = native.match(/^\P{M}\p{M}*/u)?.[0] ?? native.charAt(0);
        assert.ok(out.endsWith(native.slice(first.length)), JSON.stringify({ native, out }));
      }),
    );
  });

  test("upper case is idempotent, and in Greek drops accents and breathings but keeps the word's letters", () => {
    fc.assert(
      fc.property(word, lang, (native, l) => {
        const once = C.upper(native, l);
        assert.equal(C.upper(once, l), once);
      }),
    );
    fc.assert(
      fc.property(fc.stringMatching(/^[α-ωάέήίόύώϊϋΐΰἀ-ἇ\u1F70-\u1F7D]{1,10}$/), (native) => {
        const out = C.greekUpper(native).normalize("NFD");
        assert.ok(!/[̀́̓̔͂]/u.test(out), out);
        const letters = (s) => s.normalize("NFD").replace(/\p{M}/gu, "");
        assert.equal(letters(out), letters(native).toUpperCase());
      }),
    );
  });

  test("scripts without case in everyday writing, Georgian included, are never changed", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[ა-ჰぁ-ゖ一-龯ก-๛]{1,8}$/), lang, shape, (native, l, s) => {
        assert.equal(C.hasCase(native), false);
        assert.equal(C.display({ shape: s, sentenceStart: true, shouting: true, native, lang: l }), native);
      }),
    );
  });

  test("Turkish and Azerbaijani capitalise i as İ; every other language as I", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^i[a-z]{0,8}$/), lang, (native, l) => {
        const dotted = ["tr", "az"].includes(l);
        assert.equal(C.title(native, l)[0], dotted ? "İ" : "I");
        assert.equal(C.upper(native, l)[0], dotted ? "İ" : "I");
      }),
    );
  });
});
