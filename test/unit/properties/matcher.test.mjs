// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Properties of the matcher (lib/matcher.js, slice 14) on generated vocabularies and
// pages. Assertion mode is on under the tests, so every scan here also runs the matcher's
// own invariant checks.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fc } from "../../helpers/properties.mjs";
import { ROOT, requireExt } from "../../helpers/load-script.mjs";

const T = requireExt("lib/text.js");
const M = requireExt("lib/matcher.js");
const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, "spec/lang/_generic/boundaries.json"), "utf8"));
const rules = (base) => T.rulesFor(TABLE, base);
const BASES = ["en", "es", "fr", "it", "de", "tr", "ja", "zh", "th"];

let nextId = 1;
const word = (native, lang, base, forms) => ({ id: nextId++, lang, native, base_lang: base, gloss: forms[0] ?? null, forms, status: "active" });

// Vocabulary words use the letters a–m only and filler words n–z only, so a filler word is
// never a form and the expected matches are known.
const vocabWord = fc.stringMatching(/^[a-m]{2,8}$/);
const fillerWord = fc.stringMatching(/^[n-z]{2,8}$/);
// Anything a page or a word list might hold: any text, the glue and punctuation the
// tokenizer treats specially, apostrophes, hyphens and invisible characters.
const tricky = fc.oneof(
  fc.string({ unit: "grapheme", maxLength: 12 }),
  fc.constantFrom("c++", "c#", ".net", "u.s.", "I", "I-95", "l'eau", "dell'acqua", "it's", "house's", "ice-cream", "ice cream", "¿qué?", "Ｃafé", "猫", "ภาษา", "\u00AD", "\u200B", "\u2029", "?", "!", " ", "\n", "'s"),
);

describe("scan on any page and any vocabulary", () => {
  test("never throws, and every match covers its own text, in order, without overlaps", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BASES),
        fc.array(fc.array(tricky, { minLength: 1, maxLength: 3 }), { maxLength: 12 }),
        fc.array(tricky, { maxLength: 30 }),
        fc.string({ maxLength: 8 }),
        fc.string({ maxLength: 8 }),
        (base, formLists, pieces, before, after) => {
          const words = formLists.map((forms, i) => word(`nat${i}`, "xx", base, forms));
          const index = M.buildIndex(words, { base, rules: rules(base) });
          // Pages built partly from the forms themselves, so matches actually happen.
          const text = pieces.map((p, i) => (i % 3 === 0 && formLists.length ? formLists[i % formLists.length][0] : p)).join(" ");
          const { matches, tokenCount } = M.scan(text, { base, before, after, count: true }, index);
          assert.ok(Number.isInteger(tokenCount) && tokenCount >= 0);
          let last = 0;
          for (const m of matches) {
            assert.ok(m.start >= last && m.start < m.end && m.end <= text.length);
            assert.equal(text.slice(m.start, m.end), m.surface);
            assert.ok(m.entry.candidates.every((c) => words.includes(c.word)));
            last = m.end;
          }
        },
      ),
    );
  });

  test("finds exactly the vocabulary's words in a page of words separated by spaces", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(vocabWord, { minLength: 1, maxLength: 8 }),
        fc.array(fc.tuple(fc.boolean(), fc.nat(), fillerWord), { minLength: 1, maxLength: 25 }),
        fc.constantFrom("en", "es", "fr", "de"),
        (vocab, slots, base) => {
          const words = vocab.map((v, i) => word(`n${i}`, "xx", base, [v]));
          const tokens = slots.map(([isWord, k, filler]) => (isWord ? vocab[k % vocab.length] : filler));
          const text = tokens.join(" ");
          const { matches, tokenCount } = M.scan(text, { base }, M.buildIndex(words, { base, rules: rules(base) }));
          assert.equal(tokenCount, tokens.length);
          const want = [];
          let at = 0;
          for (const t of tokens) {
            if (vocab.includes(t)) want.push({ start: at, surface: t, native: `n${vocab.indexOf(t)}` });
            at += t.length + 1;
          }
          assert.deepEqual(
            matches.map((m) => ({ start: m.start, surface: m.surface, native: m.entry.candidates[0].word.native })),
            want,
          );
        },
      ),
    );
  });

  test("case and the page's own capitals don't change what is found", () => {
    fc.assert(
      fc.property(fc.uniqueArray(vocabWord, { minLength: 1, maxLength: 6 }), fc.array(fc.oneof(vocabWord, fillerWord), { minLength: 1, maxLength: 20 }), (vocab, tokens) => {
        const index = M.buildIndex(vocab.map((v, i) => word(`n${i}`, "xx", "en", [v])), { base: "en", rules: rules("en") });
        const at = (text) => M.scan(text, { base: "en" }, index).matches.map((m) => [m.start, m.end, m.key]);
        const text = tokens.join(" ");
        assert.deepEqual(at(text.toUpperCase()), at(text));
        assert.deepEqual(at(tokens.map((t) => t[0].toUpperCase() + t.slice(1)).join(" ")), at(text));
      }),
    );
  });

  test("a phrase wins over its first word (leftmost-longest), and both are found apart", () => {
    fc.assert(
      fc.property(vocabWord, vocabWord, fillerWord, (a, b, filler) => {
        fc.pre(a !== b);
        const words = [word("one", "xx", "en", [a]), word("two", "xx", "en", [`${a} ${b}`])];
        const index = M.buildIndex(words, { base: "en", rules: rules("en") });
        const found = (text) => M.scan(text, { base: "en" }, index).matches.map((m) => [m.surface, m.entry.candidates[0].word.native]);
        assert.deepEqual(found(`${filler} ${a} ${b} ${filler}`), [[`${a} ${b}`, "two"]]);
        assert.deepEqual(found(`${a} ${filler} ${b}`), [[a, "one"]]);
        // Across a block boundary (U+2029 in the context) a phrase is never matched.
        assert.deepEqual(M.scan(a, { base: "en", after: `\u2029${b}` }, index).matches.map((m) => m.surface), [a]);
      }),
    );
  });

  test("a word that runs on past the edge of the text is never matched", () => {
    fc.assert(
      fc.property(vocabWord, fc.stringMatching(/^[a-z]{1,4}$/), fc.boolean(), (v, extra, atEnd) => {
        const index = M.buildIndex([word("n", "xx", "en", [v])], { base: "en", rules: rules("en") });
        const ctx = atEnd ? { base: "en", after: extra } : { base: "en", before: extra };
        assert.deepEqual(M.scan(v, ctx, index).matches, []);
      }),
    );
  });

  test("words learned in a base, or whose meaning is in another base, never enter its index", () => {
    fc.assert(
      fc.property(vocabWord, fc.constantFrom("en", "en-GB", "es", "pt-BR", "zh-Hant", "zh-TW"), fc.constantFrom("en", "es", "pt", "zh", "zh-Hans"), (v, wordBase, base) => {
        const words = [word("n", "xx", wordBase, [v]), word("own", base, base, [v])];
        const index = M.buildIndex(words, { base, rules: rules(base) });
        const natives = [...index.entries.values()].flatMap((e) => e.candidates.map((c) => c.word.native));
        assert.deepEqual(natives, M.sameBase(wordBase, base) ? ["n"] : []);
      }),
    );
  });
});

describe("language tags", () => {
  const tag = fc.oneof(
    fc.constantFrom("en", "EN", "en-US", "en_GB", "pt-BR", "pt", "zh", "zh-Hans", "zh-Hant", "zh-TW", "zh-HK", "zh-CN", "iw", "he", "in", "id", "sr-Latn", "sr-Cyrl", "sr", "cmn"),
    fc.stringMatching(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/),
  );

  test("sameBase is reflexive and symmetric; baseOf only returns a base of the same language", () => {
    fc.assert(
      fc.property(tag, tag, fc.array(tag, { maxLength: 4 }), (a, b, bases) => {
        assert.equal(M.sameBase(a, a), true);
        assert.equal(M.sameBase(a, b), M.sameBase(b, a));
        const found = M.baseOf(a, bases);
        if (found === null) assert.ok(!bases.some((x) => M.sameBase(a, x)));
        else assert.ok(bases.includes(found) && M.sameBase(a, found));
      }),
    );
  });

  test("an empty tag is no base", () => {
    fc.assert(fc.property(fc.constantFrom("", null, undefined), tag, (none, t) => assert.equal(M.sameBase(none, t), false)));
  });
});

describe("assertion mode", () => {
  test("is on under the tests, and catches an index that breaks the matcher's promises", () => {
    assert.equal(globalThis.__KOTIKO_ASSERT__, true, "npm test loads test/helpers/assert-mode.mjs");
    const index = M.buildIndex([word("n", "xx", "en", ["gato"])], { base: "en", rules: rules("en") });
    index.entries.get("gato").candidates.length = 0;
    assert.throws(() => M.scan("el gato", { base: "en" }, index), /KotikoMatcher invariant: a match has no entry/);
  });
});
