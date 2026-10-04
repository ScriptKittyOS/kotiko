// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 17: how a swapped word is written (extension/lib/casing.js). Every row of the
// spec's examples table, with the shape and context the matcher (14) and rules (16) give,
// then each script and transform on its own.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EXT_DIR, requireExt } from "../helpers/load-script.mjs";

const C = requireExt("lib/casing.js");
const u = (cp) => String.fromCodePoint(cp);

// [page surface (base), context, native (lang), display]
const MID = { shape: "lower" };
const START = { shape: "title", sentenceStart: true };
const SHOUT = { shape: "upper", shouting: true };
const TITLE_MID = { shape: "title", sentenceStart: false };
const ROWS = [
  ["worker", MID, "işçi", "tr", "işçi"],
  ["Worker", START, "işçi", "tr", "İşçi"],
  ["WORKERS", SHOUT, "işçi", "tr", "İŞÇİ"],
  ["Ice", START, "ijs", "nl", "IJs"],
  ["Thanks", START, "მადლობა", "ka", "მადლობა"],
  ["THANKS", SHOUT, "მადლობა", "ka", "მადლობა"],
  ["WORD", SHOUT, "λόγος", "el", "ΛΟΓΟΣ"],
  ["Word", START, "λόγος", "el", "Λόγος"],
  ["Monday (proper, mid-sentence)", TITLE_MID, "lunes", "es", "lunes"],
  ["Monday (proper, sentence start)", START, "lunes", "es", "Lunes"],
  ["I (and I think)", TITLE_MID, "yo", "es", "yo"],
  ["I (I think)", START, "yo", "es", "Yo"],
  ["Dog (headline, not first)", TITLE_MID, "perro", "es", "perro"],
  ["dog", MID, "Hund", "de", "Hund"],
  ["Thanks (zh)", START, "谢谢", "zh-Hans", "谢谢"],
  ["Thanks (ar)", START, "شكرا", "ar", "شكرا"],
  ["Jungle", START, `${u(0x1c6)}ungla`, "hr", `${u(0x1c5)}ungla`],
  ["STREET", SHOUT, "straße", "de", "STRASSE"],
  ["lunes (es, el lunes)", MID, "Monday", "en", "Monday"],
  ["yo (es, y yo creo)", MID, "I", "en", "I"],
  ["Perro (es, sentence start)", START, "dog", "en", "Dog"],
  ["Inglés (es, sentence start)", START, "English", "en", "English"],
  ["Hund (de, Der Hund bellt)", TITLE_MID, "perro", "es", "perro"],
  ["Hund (de, Hund und Katze)", START, "perro", "es", "Perro"],
  ["İşçi (tr base, sentence start)", START, "worker", "en", "Worker"],
  ["犬 (ja, start of a sentence)", { shape: "caseless", sentenceStart: true }, "dog", "en", "dog"],
  ["狗 (zh-Hans)", { shape: "caseless" }, "犬", "ja", "犬"],
];

describe("the examples table (slice 17)", () => {
  for (const [surface, ctx, native, lang, want] of ROWS) {
    test(`${surface} -> ${native} (${lang}) = ${want}`, () => assert.equal(C.display({ ...ctx, native, lang }), want));
  }
});

describe("what carries over", () => {
  test("only a shouted line passes all capitals on; a lone acronym-shaped word doesn't", () => {
    assert.equal(C.display({ shape: "upper", shouting: false, native: "дом", lang: "ru" }), "дом");
    assert.equal(C.display({ shape: "upper", shouting: true, native: "дом", lang: "ru" }), "ДОМ");
  });
  test("mixed and lowercase surfaces show the word as stored", () => {
    for (const shape of ["lower", "mixed"]) assert.equal(C.display({ shape, sentenceStart: true, native: "Hund", lang: "de" }), "Hund");
  });
  test("a stored word is never lowercased", () => {
    for (const shape of ["lower", "title", "upper", "mixed", "caseless"]) {
      for (const native of ["Hund", "iPhone", "NASA", "Monday"]) {
        const out = C.display({ shape, sentenceStart: shape === "title", shouting: shape === "upper", native, lang: "en" });
        for (let i = 0; i < native.length; i++) if (native[i] !== native[i].toLowerCase()) assert.notEqual(out[i], native[i].toLowerCase(), `${shape} ${native}`);
      }
    }
  });
});

describe("scripts without case in practice", () => {
  // Sample words in 30 scripts that have no case, or whose case prose doesn't use.
  const SAMPLES = {
    Arabic: ["شكرا", "ar"], Hebrew: ["תודה", "he"], Han: ["谢谢", "zh-Hans"], Hiragana: ["ありがとう", "ja"], Katakana: ["コーヒー", "ja"],
    Hangul: ["감사합니다", "ko"], Devanagari: ["धन्यवाद", "hi"], Bengali: ["ধন্যবাদ", "bn"], Gurmukhi: ["ਧੰਨਵਾਦ", "pa"], Gujarati: ["આભાર", "gu"],
    Tamil: ["நன்றி", "ta"], Telugu: ["ధన్యవాదాలు", "te"], Kannada: ["ಧನ್ಯವಾದ", "kn"], Malayalam: ["നന്ദി", "ml"], Sinhala: ["ස්තූතියි", "si"],
    Thai: ["ขอบคุณ", "th"], Lao: ["ຂອບໃຈ", "lo"], Khmer: ["អរគុណ", "km"], Myanmar: ["ကျေးဇူး", "my"], Tibetan: ["ཐུགས་རྗེ་ཆེ།", "bo"],
    Ethiopic: ["አመሰግናለሁ", "am"], Georgian: ["მადლობა", "ka"], Mongolian: ["ᠪᠠᠶᠠᠷᠯᠠᠯᠠ", "mn-Mong"], Thaana: ["ޝުކުރިއްޔާ", "dv"], Syriac: ["ܬܘܕܝ", "syr"],
    Persian: [`مرسی${u(0x200c)}ها`, "fa"], Yi: ["ꆏꀘ", "ii"], Cherokee: ["ᏩᏙ", "chr"], Odia: ["ଧନ୍ୟବାଦ", "or"], Javanese: ["ꦩꦠꦸꦂꦤꦸꦮꦸꦤ꧀", "jv-Java"],
  };
  for (const [script, [native, lang]] of Object.entries(SAMPLES)) {
    test(`${script}: unchanged for every shape`, () => {
      for (const shape of ["lower", "title", "upper", "mixed", "caseless"]) {
        for (const sentenceStart of [false, true]) {
          for (const shouting of [false, true]) assert.equal(C.display({ shape, sentenceStart, shouting, native, lang }), native);
        }
      }
    });
  }

  test("Georgian never gets Mtavruli (U+1C90-U+1CBF)", () => {
    for (const shape of ["title", "upper"]) {
      const out = C.display({ shape, sentenceStart: true, shouting: true, native: "საქართველო", lang: "ka" });
      assert.ok(![...out].some((c) => c.codePointAt(0) >= 0x1c90 && c.codePointAt(0) <= 0x1cbf));
    }
  });

  test("the script is the word's, not the tag's: Serbian in Latin or Cyrillic", () => {
    assert.equal(C.display({ ...START, native: "hvala", lang: "sr" }), "Hvala");
    assert.equal(C.display({ ...START, native: "хвала", lang: "sr" }), "Хвала");
  });
});

describe("transforms", () => {
  test("Greek capitals drop accents and breathings, keep the dialytika, add one to split vowels", () => {
    assert.equal(C.greekUpper("λόγος"), "ΛΟΓΟΣ");
    assert.equal(C.greekUpper("τσάι"), "ΤΣΑΪ", "άι -> ΑΪ");
    assert.equal(C.greekUpper("καΐκι"), "ΚΑΪΚΙ", "an existing dialytika stays");
    assert.equal(C.greekUpper("ἀγάπη"), "ΑΓΑΠΗ", "breathing and tonos gone");
    assert.equal(C.greekUpper("αίμα"), "ΑΙΜΑ", "accent on the ι itself: still a diphthong");
    assert.equal(C.title("όμορφος", "el"), "Όμορφος", "title keeps the tonos");
  });

  test("Turkish, Azerbaijani and Lithuanian use their own locale; others the root", () => {
    assert.equal(C.localeFor("tr"), "tr");
    assert.equal(C.localeFor("az-Latn"), "az");
    assert.equal(C.localeFor("lt"), "lt");
    assert.equal(C.localeFor("en"), "und");
    assert.equal(C.localeFor("es-419"), "und");
    assert.equal(C.title("istanbul", "az"), "İstanbul");
    assert.equal(C.title("istanbul", "en"), "Istanbul");
  });

  test("Dutch IJ, only for Dutch", () => {
    assert.equal(C.title("ijs", "nl"), "IJs");
    assert.equal(C.title("ijs", "en"), "Ijs");
  });

  test("Serbo-Croatian digraph letters title-case to their own forms", () => {
    for (const [from, to] of [[0x1c4, 0x1c5], [0x1c6, 0x1c5], [0x1c7, 0x1c8], [0x1c9, 0x1c8], [0x1ca, 0x1cb], [0x1cc, 0x1cb], [0x1f1, 0x1f2], [0x1f3, 0x1f2]]) {
      assert.equal(C.title(`${u(from)}a`, "hr"), `${u(to)}a`);
    }
    assert.equal(C.upper(`${u(0x1c6)}ungla`, "hr"), `${u(0x1c4)}UNGLA`);
  });

  test("a first grapheme with a combining mark stays whole", () => {
    assert.equal(C.title(`e${u(0x301)}poca`, "es"), `E${u(0x301)}poca`);
  });
});

describe("the code names languages only where the spec allows", () => {
  test("only Greek, Dutch and the locale-casing set", () => {
    const src = fs.readFileSync(path.join(EXT_DIR, "lib/casing.js"), "utf8").replace(/\/\/.*$/gm, "");
    const tags = [...src.matchAll(/"([a-z]{2,3})"/g)].map((m) => m[1]).filter((t) => !["und", "ij"].includes(t)); // root locale; the Dutch letter pair
    assert.deepEqual([...new Set(tags)].sort(), ["az", "el", "lt", "nl", "tr"]);
  });
});
