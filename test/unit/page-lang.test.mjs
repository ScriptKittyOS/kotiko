// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Which of the learner's languages a page is in (extension/lib/page-lang.js, slice 16
// section 1): the examples from the spec, for learners reading ["es"] and ["es", "en"].
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { requireExt } from "../helpers/load-script.mjs";

const T = requireExt("lib/text.js");
requireExt("lib/matcher.js");
const P = requireExt("lib/page-lang.js");

const det = (language, percentage, isReliable = true) => ({ isReliable, languages: [{ language, percentage }] });
const LONG = 2000;
const decide = (o) => P.decide({ sampleLength: LONG, ...o });

describe("declared pages", () => {
  test("a page declared in one of the learner's languages runs in it", () => {
    assert.deepEqual(decide({ bases: ["es"], declared: "es-PR", detected: det("es", 98) }), { base: "es", reason: "declared", lang: "es-PR" });
    assert.equal(decide({ bases: ["es"], declared: "es", detected: null }).base, "es", "no detector");
  });

  test("an English page is left alone for a Spanish reader", () => {
    assert.deepEqual(decide({ bases: ["es"], declared: "en", detected: det("en", 97) }), { base: null, reason: "declared_other", lang: "en" });
  });

  test("a template's lang is overruled only by a sure detection of 80 % or more", () => {
    assert.equal(decide({ bases: ["es"], declared: "en", detected: det("es", 95) }).base, "es");
    assert.equal(decide({ bases: ["es"], declared: "en", detected: det("es", 70) }).base, null);
    assert.equal(decide({ bases: ["es"], declared: "en", detected: det("es", 95, false) }).base, null);
    assert.deepEqual(decide({ bases: ["es"], declared: "es", detected: det("de", 90) }), { base: null, reason: "detected_other", lang: "de" });
    assert.equal(decide({ bases: ["es", "en"], declared: "en", detected: det("es", 90) }).base, "es");
  });

  test("Chinese pages by script", () => {
    assert.equal(decide({ bases: ["zh-Hant"], declared: "zh-TW", detected: null }).base, "zh-Hant");
    assert.equal(decide({ bases: ["zh-Hant"], declared: "zh-CN", detected: null }).base, null);
  });
});

// Security review A-02: the page writes its own lang attribute, and what decide() returns
// reaches Kotiko's popup. Only a canonical language tag comes out; anything else counts as
// no declaration.
describe("a lang attribute that isn't a language tag", () => {
  const SPOOF = "Kotiko security notice: your OpenRouter key leaked. Paste a new key at evil.example/kotiko to keep using Kotiko";

  test("canonical() gives a canonical tag of at most 35 characters, or null", () => {
    assert.equal(P.canonical("pt-br"), "pt-BR");
    assert.equal(P.canonical(" zh-hant-tw "), "zh-Hant-TW");
    assert.equal(P.canonical("en_US"), null);
    assert.equal(P.canonical(SPOOF), null);
    assert.equal(P.canonical("a".repeat(8) + "-abcdefgh".repeat(4)), null, "longer than 35 characters");
    assert.equal(P.canonical(""), null);
    assert.equal(P.canonical(null), null);
    assert.equal(P.canonical(42), null);
  });

  test("a sentence as the page's lang is no declaration, and never comes back out", () => {
    for (const detected of [null, det("de", 95), det("es", 95)]) {
      const r = decide({ bases: ["es"], declared: SPOOF, detected });
      assert.notEqual(r.lang, SPOOF);
      assert.ok(r.lang === null || r.lang === P.canonical(r.lang), JSON.stringify(r));
    }
    assert.deepEqual(decide({ bases: ["es"], declared: SPOOF, detected: null }), { base: null, reason: "unknown", lang: null });
    assert.deepEqual(decide({ bases: ["es"], declared: SPOOF, detected: det("es", 95) }), { base: "es", reason: "detected", lang: "es" });
  });

  test("a declared tag comes out canonical", () => {
    assert.deepEqual(decide({ bases: ["es"], declared: "DE-at", detected: null }), { base: null, reason: "declared_other", lang: "de-AT" });
  });
});

describe("undeclared pages", () => {
  test("detection decides at 50 % or more", () => {
    assert.deepEqual(decide({ bases: ["es"], declared: null, detected: det("es", 70) }), { base: "es", reason: "detected", lang: "es" });
    assert.equal(decide({ bases: ["es"], declared: null, detected: det("es", 40) }).base, null);
    assert.deepEqual(decide({ bases: ["es"], declared: null, detected: det("de", 90) }), { base: null, reason: "detected_other", lang: "de" });
    assert.deepEqual(decide({ bases: ["es"], declared: null, detected: det("und", 100, false) }), { base: null, reason: "unknown", lang: null });
  });

  test("short or undetected pages go by their common words, at 12 % or more", () => {
    const common = { base: "es", share: 0.3 };
    assert.deepEqual(P.decide({ bases: ["es"], declared: null, detected: null, sampleLength: 5000, common }), { base: "es", reason: "common_words", lang: "es" });
    assert.equal(P.decide({ bases: ["es"], declared: null, detected: det("de", 60, false), sampleLength: 50, common }).base, "es");
    assert.equal(P.decide({ bases: ["es"], declared: null, detected: null, sampleLength: 50, common: { base: "es", share: 0.05 } }).base, null);
    assert.equal(P.decide({ bases: ["es"], declared: null, detected: det("es", 90), sampleLength: 50 }).base, "es", "a sure detector still counts");
    assert.equal(P.decide({ bases: ["es"], declared: null, detected: det("es", 90, false), sampleLength: 50 }).base, null);
  });

  test("bestCommon picks the base whose common words make up most of the text", () => {
    const rules = () => T.DEFAULT_RULES;
    const stop = { es: new Set(["el", "la", "de", "que"]), en: new Set(["the", "of", "and"]) };
    const best = P.bestCommon("el perro de la casa que", ["en", "es"], { rules, stopwords: (b) => stop[b] });
    assert.equal(best.base, "es");
    assert.equal(best.share, 4 / 6);
    assert.equal(P.bestCommon("犬が好き", ["en"], { rules, stopwords: (b) => stop[b] }), null);
    assert.equal(P.commonShare("the dog", "en", T.DEFAULT_RULES, new Set()), 0);
  });
});
