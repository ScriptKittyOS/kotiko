// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 13 §3: reading a pasted list or a file (extension/bulk/parse.js).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EXT_DIR, requireExt } from "../helpers/load-script.mjs";

const P = requireExt("bulk/parse.js");
const langs = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "spec/languages.json"), "utf8")).languages;
const stop = (base) => new Set(fs.readFileSync(path.join(EXT_DIR, `spec/lang/${base}/stopwords.txt`), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
// The browser's detection, stubbed: English or Spanish text by a few telltale words.
const detect = (text) => {
  const t = text.toLowerCase();
  const es = (t.match(/\b(perro|gato|casa|libro|agua|gracias|hola|rojo|mesa|pájaro|árbol)\b/g) ?? []).length;
  const en = (t.match(/\b(dog|cat|house|book|water|thanks|hello|red|table|bird|tree)\b/g) ?? []).length;
  if (es === en) return { isReliable: false, languages: [] };
  return { isReliable: true, languages: [{ language: es > en ? "es" : "en", percentage: 90 }] };
};
const parse = (text, opts = {}) => P.build(P.read(text, opts), { langs, detect, ...opts });
const pick = (r) => [r.native, r.gloss, r.forms];

describe("one line (§3)", () => {
  const rows = [
    ["gato = cat", "en", "es", ["gato", "cat", ["cat"]]],
    ["dog - perro", "es", "en", ["dog", "perro", ["perro"]]],
    ["perro → dog", "es", "en", ["dog", "perro", ["perro"]]],
    ["собака (sobaka) = perro, perros", "es", "ru", ["собака", "perro", ["perro", "perros"]]],
    ["고양이：猫", "ja", "ko", ["고양이", "猫", ["猫"]]],
    ["고양이 ： 猫", "ja", "ko", ["고양이", "猫", ["猫"]]],
    ["猫＝gato", "es", "ja", ["猫", "gato", ["gato"]]],
    ["Hund = perro", "es", "de", ["Hund", "perro", ["perro"]]],
  ];
  for (const [text, base, target, want] of rows) {
    test(`${text} (base ${base}, learning ${target})`, async () => {
      const { rows: [r] } = await parse(text, { base, target });
      assert.deepEqual(pick(r), want);
    });
  }

  test("parentheses: a romanization, or a respelling as the pronunciation", async () => {
    const { rows } = await parse("спасибо (spasibo) = thanks\nспасибо (spa-SEE-ba) = thanks", { base: "en", target: "ru" });
    assert.deepEqual(rows.map((r) => [r.romanization, r.pronunciation]), [["spasibo", null], [null, "spa-SEE-ba"]]);
  });

  test("hyphens inside words never split; a spaced dash does; 10:30 isn't split at the colon", async () => {
    assert.deepEqual(P.line("well-known = conocido").sides.map((s) => s.text), ["well-known", "conocido"]);
    assert.deepEqual(P.line("bien-estar = wellbeing").sides.map((s) => s.text), ["bien-estar", "wellbeing"]);
    assert.deepEqual(P.line("gato - cat").sides.map((s) => s.text), ["gato", "cat"]);
    assert.deepEqual(P.line("10:30 = once").sides.map((s) => s.text), ["10:30", "once"]);
    assert.equal(P.line("well-known").sides.length, 1);
  });

  test("numbering, notes, a language prefix, ¿¡ and ?!", async () => {
    const a = P.line("12) ¿perro? = dog # a pet", langs);
    assert.deepEqual([a.sides.map((s) => s.text), a.note], [["perro", "dog"], "a pet"]);
    const b = P.line("es: gracias = thanks", langs);
    assert.deepEqual([b.lang, b.sides[0].text], ["es", "gracias"]);
    const c = P.line("ja：猫 = gato", langs);
    assert.deepEqual([c.lang, c.sides[0].text], ["ja", "猫"]);
    assert.equal(P.line("① 犬 = dog").sides[0].text, "犬");
    assert.equal(P.line("   "), null);
    assert.equal(P.line("— — —"), null);
  });
});

describe("orientation, never assuming the meaning is English (§3)", () => {
  const LIST = "dog = perro\ncat = gato\nhouse = casa\nbook = libro\nwater = agua";
  const REVERSED = LIST.split("\n").map((l) => l.split(" = ").reverse().join(" = ")).join("\n");

  test("base es, learning en: the list and its reverse both save dog as the word, perro as the meaning", async () => {
    for (const text of [LIST, REVERSED]) {
      const r = await parse(text, { base: "es", target: "en" });
      assert.deepEqual(pick(r.rows[0]), ["dog", "perro", ["perro"]], text);
      assert.equal(r.decidedBy, "language");
    }
  });

  test("by script first: собака is the word for a Spanish reader, whichever side it's on", async () => {
    const r = await parse("perro = собака\ngato = кошка", { base: "es", target: "ru" });
    assert.deepEqual([r.rows[0].native, r.decidedBy], ["собака", "script"]);
  });

  test("by the base's common words when detection can't tell", async () => {
    const r = await parse("the dog = el perro\nthe cat = el gato\na house = una casa", { base: "es", target: "en", detect: null, stopwords: stop("es") });
    assert.deepEqual([r.rows[0].native, r.decidedBy], ["the dog", "common_words"]);
  });

  test("undecided: the first column is the word, and the learner is asked", async () => {
    const r = await parse("taxi = taxi\nhotel = hotel", { base: "es", target: "en", detect: null });
    assert.equal(r.decidedBy, "undecided");
    assert.deepEqual(r.question, { a: "taxi", b: "taxi" });
    const swapped = await parse("uno = one", { base: "es", target: "en", detect: null, swap: true });
    assert.deepEqual(pick(swapped.rows[0]), ["one", "uno", ["uno"]]);
  });

  test("a bare list in the base's language is words to find in the target; any other bare word needs explaining", async () => {
    const find = await parse("perro\ngato", { base: "es", target: "ja" });
    assert.deepEqual(find.rows.map((r) => [r.lookup, r.native, r.gloss]), [["find", "", "perro"], ["find", "", "gato"]]);
    const explain = await parse("собака\nкошка", { base: "es", target: "ru" });
    assert.deepEqual(explain.rows.map((r) => [r.lookup, r.native]), [["explain", "собака"], ["explain", "кошка"]]);
  });
});

describe("files (§3)", () => {
  test("decoding: UTF-8 with or without a BOM, UTF-16 by BOM, windows-1252 with a warning, binary refused, 5 MB cap", () => {
    const utf8 = new TextEncoder().encode("gato = cat");
    assert.equal(P.decode(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])).text, "gato = cat");
    const u16 = new Uint8Array([0xff, 0xfe, ...[..."ñ = n"].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    assert.equal(P.decode(u16).text, "ñ = n");
    const latin1 = P.decode(new Uint8Array([0x6e, 0x69, 0xf1, 0x6f, 0x20, 0x3d, 0x20, 0x63]));
    assert.deepEqual([latin1.text, latin1.warning], ["niño = c", "not_utf8"]);
    assert.equal(P.decode(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 1])).error, "unreadable");
    assert.equal(P.decode(new Uint8Array(P.MAX_BYTES + 1)).error, "too_big");
    assert.equal(P.decode(new TextEncoder().encode("a = b\r\nc = d\re = f")).text, "a = b\nc = d\ne = f");
  });

  test("a CSV with quoted commas and a header row maps columns from the header", async () => {
    const r = await parse('word,meaning,note\nperro,"dog, hound",a pet\n"gato",cat,', { base: "en", target: "es", filename: "list.csv" });
    assert.deepEqual(r.roles, ["native", "gloss", "note"]);
    assert.deepEqual(r.rows.map((x) => [x.native, x.forms, x.note]), [["perro", ["dog", "hound"], "a pet"], ["gato", ["cat"], null]]);
  });

  test("Word, Pinyin, Pronunciation, Meaning: pinyin is the romanization, the respelling the pronunciation", async () => {
    const r = await parse("Word,Pinyin,Pronunciation,Meaning\n谢谢,xièxie,SHYEH-shyeh,thanks", { base: "en", target: "zh", filename: "zh.csv" });
    assert.deepEqual(r.roles, ["native", "romanization", "pronunciation", "gloss"]);
    assert.deepEqual([r.rows[0].native, r.rows[0].romanization, r.rows[0].pronunciation, r.rows[0].gloss], ["谢谢", "xièxie", "SHYEH-shyeh", "thanks"]);
  });

  test("Spanish headers, and a column named by its language", async () => {
    const es = await parse("palabra;significado\nhouse;casa".replace(";", ",").replace(";", ","), { base: "es", target: "en", filename: "x.csv" });
    assert.deepEqual(es.roles, ["native", "gloss"]);
    const named = await parse("Español,English\nperro,dog", { base: "es", filename: "x.csv" });
    assert.deepEqual([named.roles, named.rows[0].native, named.rows[0].lang], [["gloss", "native:en"], "dog", "en"]);
  });

  test("an unheaded table: a Latin middle column beside non-Latin words is their romanization", async () => {
    const r = await parse("спасибо\tspasibo\tthanks\nпривет\tprivet\thello", { base: "en", target: "ru", filename: "x.tsv" });
    assert.deepEqual(r.roles, ["side0", "romanization", "side1"]);
    assert.deepEqual([r.rows[0].native, r.rows[0].romanization, r.rows[0].gloss], ["спасибо", "spasibo", "thanks"]);
  });

  test("an Anki plain-text export: headers read, HTML and sounds removed, cloze answers kept", async () => {
    const text = "#separator:tab\n#html:true\n#columns:Front\tBack\nperro<br>el perro [sound:perro.mp3]\t<b>dog</b>\n{{c1::gato::animal}}\tcat\n";
    const r = await parse(text, { base: "en", target: "es", filename: "deck.txt" });
    assert.equal(r.format, "anki");
    assert.deepEqual(r.roles, ["native", "gloss"]);
    assert.deepEqual(r.rows.map((x) => [x.native, x.gloss]), [["perro; el perro", "dog"], ["gato", "cat"]]);
  });

  test("JSON: an array of objects by key names; Kotiko's own backup is handed over; anything else is unreadable", async () => {
    const r = await parse(JSON.stringify([{ Term: "gato", Translation: "cat", Notes: "pet" }]), { base: "en", target: "es", filename: "w.json" });
    assert.deepEqual([r.rows[0].native, r.rows[0].gloss, r.rows[0].note], ["gato", "cat", "pet"]);
    assert.equal(P.read(JSON.stringify({ schemaVersion: 2, words: [] }), { filename: "kotiko.json" }).format, "kotiko-backup");
    assert.equal(P.read("{nope", { filename: "w.json" }).error, "unreadable");
    assert.equal(P.read("x", { filename: "words.xlsx" }).error, "spreadsheet");
  });

  test("a line list with commas in its meanings stays a line list", () => {
    assert.equal(P.read("perro = dog, hound\ngato = cat, kitty").format, "lines");
    assert.equal(P.read("perro,dog\ngato,cat\ncasa,house").format, "csv");
  });

  test("Kotiko's CSV export's formula guard is undone", async () => {
    const r = await parse("word,meaning\n'-ito,small\n'=igual,equal", { base: "en", target: "es", filename: "k.csv" });
    assert.deepEqual(r.rows.map((x) => x.native), ["-ito", "=igual"]);
  });

  test("more than 5,000 rows: the first 5,000, with a note", async () => {
    const big = Array.from({ length: 5003 }, (_, i) => `w${i} = m${i}`).join("\n");
    const r = await parse(big, { base: "en", target: "es", detect: null });
    assert.equal(r.rows.length, 5000);
    assert.deepEqual(r.notes, [{ key: "too_many", count: 5003 }]);
  });
});
