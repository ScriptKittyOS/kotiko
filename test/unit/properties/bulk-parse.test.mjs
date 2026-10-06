// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Properties of reading a pasted list or a dropped file (bulk/parse.js, slice 13 §3) on
// generated input: any bytes, any text, any table.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fc } from "../../helpers/properties.mjs";
import { EXT_DIR, requireExt } from "../../helpers/load-script.mjs";

const P = requireExt("bulk/parse.js");
const langs = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "spec/languages.json"), "utf8")).languages;
const FORMATS = new Set(["kotiko-backup", "json", "anki", "csv", "tsv", "lines"]);
const ERRORS = new Set(["spreadsheet", "apkg", "unreadable"]);

// RFC 4180 as a spreadsheet writes it: a cell with the separator, a quote or a line break
// is quoted, its quotes doubled.
const quote = (cell, sep) => (cell.includes(sep) || cell.includes('"') || cell.includes("\n") ? `"${cell.replaceAll('"', '""')}"` : cell);
const write = (rows, sep) => rows.map((r) => r.map((c) => quote(c, sep)).join(sep)).join("\n");

const cell = fc.oneof(fc.string({ maxLength: 10 }), fc.string({ unit: "grapheme", maxLength: 6 }), fc.constantFrom('"', '""', ",", "\t", "；", "\n", "a,b", 'say "hi"', " padded "));
const page = fc.oneof(
  fc.string({ maxLength: 200 }),
  fc.string({ unit: "grapheme", maxLength: 120 }),
  fc.array(fc.constantFrom("gato = cat", "perro - dog", "1. casa: house", "#separator:tab", "#html:true", "a\tb", '"x","y"', "[", "{", '{"schemaVersion":2}', "[{}]", "", " ", "собака (sobaka) = dog # note", "猫：cat"), { maxLength: 12 }).map((ls) => ls.join("\n")),
);
const filename = fc.constantFrom("", "list.txt", "list.csv", "list.tsv", "words.json", "deck.apkg", "sheet.xlsx", "notes", "x.CSV");

describe("decode", () => {
  test("any bytes: text without a NUL, or an error, never a throw", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        const r = P.decode(bytes);
        if (r.error) return assert.ok(["too_big", "unreadable"].includes(r.error));
        assert.equal(typeof r.text, "string");
        assert.ok(!r.text.includes("\0") && !r.text.includes("\r"));
      }),
    );
  });

  test("UTF-8 and UTF-16 text (with its byte-order mark) comes back as written, line breaks as \\n", () => {
    const text = fc.string({ unit: "binary", maxLength: 80 }).filter((s) => !s.includes("\0"));
    fc.assert(
      fc.property(text, fc.constantFrom("utf8", "utf8bom", "utf16le", "utf16be"), (s, enc) => {
        let bytes;
        if (enc.startsWith("utf8")) bytes = Buffer.concat([Buffer.from(enc === "utf8bom" ? [0xef, 0xbb, 0xbf] : []), Buffer.from(s, "utf8")]);
        else {
          const le = Buffer.from(s, "utf16le");
          if (enc === "utf16be") le.swap16();
          bytes = Buffer.concat([Buffer.from(enc === "utf16le" ? [0xff, 0xfe] : [0xfe, 0xff]), le]);
        }
        const r = P.decode(new Uint8Array(bytes));
        assert.equal(r.warning, null);
        assert.equal(r.text, s.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").normalize("NFC"));
      }),
    );
  });
});

describe("csv", () => {
  test("reads back any table written the RFC 4180 way, for every separator", () => {
    fc.assert(
      fc.property(fc.array(fc.array(cell, { minLength: 1, maxLength: 5 }), { maxLength: 8 }), fc.constantFrom(",", "\t", "；", ";"), (rows, sep) => {
        const want = rows.filter((r) => r.some((c) => c.trim()));
        assert.deepEqual(P.csv(write(rows, sep), sep), want);
      }),
    );
  });
});

describe("read and build", () => {
  test("any text and file name gives a known format or a known error, never a throw", async () => {
    await fc.assert(
      fc.asyncProperty(page, filename, fc.constantFrom("en", "es", "ja"), async (text, name, base) => {
        const r = P.read(text, { filename: name });
        if (r.error) return assert.ok(ERRORS.has(r.error), r.error);
        assert.ok(FORMATS.has(r.format), r.format);
        const built = await P.build(r, { base, langs });
        assert.ok(Array.isArray(built.rows));
        assert.ok(built.rows.length <= P.MAX_ROWS);
        for (const row of built.rows) {
          assert.equal(typeof row.native, "string");
          assert.equal(typeof row.gloss, "string");
          assert.ok(Array.isArray(row.forms));
          assert.ok(row.forms.every((f) => typeof f === "string" && f.length > 0));
        }
      }),
    );
  });

  test("a list of word = meaning lines gives one row per line, the word and its meanings in order", async () => {
    const latin = fc.stringMatching(/^[a-zà-ÿ]{2,10}$/);
    const cyrillic = fc.stringMatching(/^[а-я]{2,10}$/);
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(cyrillic, fc.uniqueArray(latin, { minLength: 1, maxLength: 3 })), { minLength: 1, maxLength: 10 }), fc.constantFrom(" = ", " - ", " → ", "：", ": "), fc.boolean(), async (pairs, sep, wordFirst) => {
        const text = pairs.map(([w, ms]) => (wordFirst ? `${w}${sep}${ms.join(", ")}` : `${ms.join(", ")}${sep}${w}`)).join("\n");
        const built = await P.build(P.read(text), { base: "en", target: "ru", langs });
        if (!wordFirst && sep === ": ") return; // "meaning: word" is ambiguous with a language prefix; covered by the examples
        assert.deepEqual(
          built.rows.map((r) => [r.native, r.forms]),
          pairs.map(([w, ms]) => [w, ms]),
        );
        assert.equal(built.decidedBy, "script");
      }),
    );
  });

  test("a JSON array of objects keeps every row and every key as a column", () => {
    const obj = fc.dictionary(fc.constantFrom("native", "gloss", "note", "lang", "extra"), fc.oneof(fc.string({ maxLength: 8 }), fc.integer(), fc.constant(null)), { minKeys: 1 });
    fc.assert(
      fc.property(fc.array(obj, { minLength: 1, maxLength: 10 }), (list) => {
        const r = P.read(JSON.stringify(list));
        assert.equal(r.format, "json");
        assert.equal(r.rows.length, list.length);
        assert.deepEqual(new Set(r.header), new Set(list.flatMap((o) => Object.keys(o))));
        r.rows.forEach((row, i) => r.header.forEach((k, j) => assert.equal(row[j], list[i][k] == null ? "" : String(list[i][k]))));
      }),
    );
  });
});

describe("one line and its parts", () => {
  test("line never throws; it gives one or two sides and keeps the source", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 60 }), page), (raw) => {
        const l = P.line(raw, langs);
        if (l === null) return;
        assert.ok(l.sides.length === 1 || l.sides.length === 2);
        assert.equal(l.source, String(raw).trim());
        for (const s of l.sides) assert.equal(typeof s.text, "string");
        assert.ok(l.lang === null || typeof l.lang === "string");
      }),
    );
  });

  test("ankiText strips sound tags, cloze markup and HTML, and never leaves a tag", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.string({ maxLength: 8 }), fc.constantFrom("<b>", "</b>", "<br>", "<br/>", "[sound:x.mp3]", "{{c1::gato}}", "{{c2::perro::dog}}", "&amp;")), { maxLength: 10 }), (parts) => {
        const out = P.ankiText(parts.join(""), true, null);
        assert.ok(!/<[^>]*>/.test(out));
        assert.ok(!out.includes("[sound:"));
        assert.equal(out, out.trim());
        assert.ok(!/\s{2}/.test(out));
      }),
    );
  });

  test("scriptOf names the script of most letters; languageNamed only answers tags it knows", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 20 }), (s) => {
        const iso = P.scriptOf(s);
        assert.ok(iso === null || /^[A-Z][a-z]{3}$/.test(iso));
        const named = P.languageNamed(s, langs);
        assert.ok(named === null || langs[named.split("-")[0].toLowerCase()] !== undefined, named);
      }),
    );
  });
});
