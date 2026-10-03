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
