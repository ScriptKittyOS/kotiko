// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 09: extension/lib/wordspec.js against the shared fixtures (server/test/kotiko/
// word_spec_test.exs runs the same files), plus unit tests for the pieces.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT, requireExt } from "../helpers/load-script.mjs";
import { validate } from "../helpers/json-schema.mjs";

const spec = requireExt("spec/spec.js");
const Lang = requireExt("lib/lang.js").createLang(spec);
const WS = requireExt("lib/wordspec.js").createWordSpec(spec, Lang);

const FIX = path.join(ROOT, "spec/fixtures");
const read = (...p) => JSON.parse(fs.readFileSync(path.join(...p), "utf8"));
const list = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const results = read(FIX, "normalize-results.json").results;

// `expect` lists only the keys a reader checks; forms may be given as their texts.
function partial(actual, expected, where) {
  if (expected === null || typeof expected !== "object") return assert.deepEqual(actual, expected, where);
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual) && actual.length === expected.length, `${where}: ${JSON.stringify(actual)}`);
    return expected.forEach((e, i) => partial(actual[i], e, `${where}[${i}]`));
  }
  for (const [k, v] of Object.entries(expected)) {
    if (k === "forms" && Array.isArray(v) && v.every((x) => typeof x === "string")) {
      assert.deepEqual(actual[k].map((f) => f.text), v, `${where}.forms`);
    } else partial(actual?.[k], v, `${where}.${k}`);
  }
}

const run = (f) => (f.input.items ? WS.processRespell(f.input.items, f.raw) : WS.process(f.input, f.raw));

describe("spec/fixtures/normalize", () => {
  const files = list(path.join(FIX, "normalize"));
  test("at least 80 fixtures, each with a recorded full output", () => {
    assert.ok(files.length >= 80);
    assert.deepEqual(Object.keys(results).sort(), files);
  });
  for (const file of files) {
    test(file, () => {
      const f = read(FIX, "normalize", file);
      const out = JSON.parse(JSON.stringify(run(f)));
      partial(out, f.expect, f.name);
      assert.deepEqual(out, results[file]);
    });
  }
});

describe("spec/fixtures/pronunciation", () => {
  for (const file of list(path.join(FIX, "pronunciation"))) {
    test(file, () => {
      const f = read(FIX, "pronunciation", file);
      const { word, dropped_fields } = WS.checkWord(f.word);
      partial(word, f.expect.word, f.name);
      assert.deepEqual(dropped_fields, f.expect.dropped_fields);
    });
  }
});

test("input checks (input.json)", () => {
  for (const c of read(FIX, "input.json").cases) {
    const expected = c.error ? { ok: false, code: c.error } : { ok: true, text: c.text };
    assert.deepEqual(WS.prepareInput(c.input), expected, JSON.stringify(c.input));
  }
});

test("base-language data resolution (lang-data.json)", () => {
  for (const c of read(FIX, "lang-data.json").cases) assert.deepEqual(WS.langData(c.base).folders, c.folders, c.base);
});

describe("the related-form check (stem/*.json)", () => {
  for (const file of list(path.join(FIX, "stem"))) {
    test(file, () => {
      const f = read(FIX, "stem", file);
      const data = WS.langData(f.base);
      for (const [form, gloss, related] of f.pairs) {
        assert.equal(WS.related(form, gloss, f.base, data), related, `${form} / ${gloss}`);
      }
    });
  }
});

test("the prompt is the same text in both runtimes (prompt.json)", () => {
  for (const c of read(FIX, "prompt.json").cases) {
    const text = c.respell ? WS.buildRespellSystem(c.respell) : WS.buildSystem(c.request);
    assert.equal(crypto.createHash("sha256").update(text).digest("hex"), c.sha256, c.name);
    for (const s of c.contains ?? []) assert.ok(text.includes(s), `${c.name}: ${s}`);
    for (const s of c.excludes ?? []) assert.ok(!text.includes(s), `${c.name}: ${s}`);
  }
});

describe("extraction (06 F28)", () => {
  test("braces inside strings, with escapes, don't end the object", () => {
    const raw = 'x {"intent": "lookup", "words": [], "reply": "a } and a \\" and a {"} y';
    assert.deepEqual(WS.extract(raw), { intent: "lookup", words: [], reply: 'a } and a " and a {' });
  });
  test("an object without words or intent is skipped while scanning", () => {
    assert.deepEqual(WS.extract('{"a": 1} {"words": []}'), { words: [] });
  });
  test("the whole content is taken when it parses, whatever its keys", () => {
    assert.deepEqual(WS.extract('{"items": []}', "items"), { items: [] });
  });
  test("nothing to parse is null", () => {
    for (const raw of ["", "no json", "{", "[1, 2]", null]) assert.equal(WS.extract(raw), null, String(raw));
  });
});

describe("pronunciation pieces", () => {
  const facts = (tag) => WS.targetFacts(tag);
  const key = (base) => WS.langData(base).respelling;
  test("target facts: by tag, by language, or by script", () => {
    assert.equal(facts("ru").stress, "lexical");
    assert.equal(facts("zh-Hant").romanization, "pinyin-tone-marks");
    assert.equal(facts("pt-BR").romanization, null);
    assert.equal(facts("uz-Cyrl").romanization, "unspecified");
    assert.equal(facts("fi").romanization, null);
    assert.equal(facts("fi").stress, "unknown");
  });
  test("syllables, capitals and tone digits", () => {
    assert.ok(WS.validPronunciation("nee2-how3", facts("zh"), key("en")));
    assert.ok(WS.validPronunciation("ma", facts("zh"), key("en")), "one neutral syllable");
    assert.ok(!WS.validPronunciation("nee-how", facts("zh"), key("en")));
    assert.ok(!WS.validPronunciation("nee12-how3", facts("zh"), key("en")));
    assert.ok(WS.validPronunciation("ZDRAST-vuy-tyeh", facts("ru"), key("en")));
    assert.ok(WS.validPronunciation("da svi-DA-nya", facts("ru"), key("en")));
  });
  test("stress agreement counts vowel letters (ru, uk, be)", () => {
    const check = (o) => WS.checkWord({ lang: "ru", base_lang: "en", ...o });
    assert.equal(check({ native: "молоко", native_vocalized: "молоко́", pronunciation: "ma-la-KO" }).word.native_vocalized, "молоко́");
    assert.equal(check({ native: "молоко", native_vocalized: "мо́локо", pronunciation: "ma-la-KO" }).word.native_vocalized, null);
    // A different syllable count compares nothing.
    assert.equal(check({ native: "пожалуйста", native_vocalized: "пожалу́йста", pronunciation: "pa-ZHAL-sta" }).word.native_vocalized, "пожалу́йста");
  });
});

describe("spec/ data files", () => {
  const LANG = path.join(ROOT, "spec/lang");
  const schema = (name) => read(LANG, "schema", `${name}.schema.json`);
  const folders = fs.readdirSync(LANG, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "schema").map((d) => d.name);

  test("every spec/lang file validates against spec/lang/schema", () => {
    for (const folder of folders) {
      for (const kind of ["stem", "variants", "respelling", "boundaries", "casing"]) {
        const file = path.join(LANG, folder, `${kind}.json`);
        if (!fs.existsSync(file)) continue;
        assert.deepEqual(validate(schema(kind), read(file)), [], `${folder}/${kind}.json`);
      }
    }
  });

  test("stopword lists are NFC, lowercase in their locale, without duplicates", () => {
    for (const folder of folders) {
      const file = path.join(LANG, folder, "stopwords.txt");
      if (!fs.existsSync(file)) continue;
      const words = fs.readFileSync(file, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
      const locale = folder === "_generic" ? "und" : folder;
      for (const w of words) {
        assert.equal(w, w.normalize("NFC"), `${folder}: ${w}`);
        assert.equal(w, w.toLocaleLowerCase(locale), `${folder}: ${w}`);
      }
      assert.equal(new Set(words).size, words.length, `${folder} has duplicates`);
    }
  });

  test("the imported stopword lists are NFC, lowercase in their language, sorted, without duplicates", () => {
    const lists = read(LANG, "_generic", "stopwords.json");
    assert.ok(Object.keys(lists).length >= 50, "about 60 languages");
    for (const [lang, words] of Object.entries(lists)) {
      for (const w of words) {
        assert.equal(w, w.normalize("NFC"), `${lang}: ${w}`);
        assert.equal(w, w.toLocaleLowerCase(lang), `${lang}: ${w}`);
        assert.match(w, /^[\p{L}\p{M}' -]+$/u, `${lang}: ${w}`);
      }
      assert.deepEqual(words, [...new Set(words)].sort(), `${lang} is sorted without duplicates`);
    }
  });

  test("every respelling.json example passes D2 with its own key", () => {
    for (const base of ["en", "es"]) {
      for (const e of WS.langData(base).respelling.examples) {
        assert.deepEqual(WS.checkWord({ ...e, base_lang: base }).dropped_fields, [], `${base}: ${e.native}`);
      }
      assert.ok(WS.langData(base).respelling.prompt_summary.length <= 800);
    }
    assert.equal(WS.langData("fr").respelling, null, "fr has no key and no fallback");
  });

  test("every pronunciation.json entry names a scheme, a stress kind and a tone range or null", () => {
    const pron = read(ROOT, "spec/pronunciation.json");
    for (const [tag, t] of Object.entries(pron.targets)) {
      assert.ok(t.romanization === null || t.romanization === "unspecified" || pron.schemes[t.romanization], tag);
      assert.ok(["lexical", "none", "unknown"].includes(t.stress), tag);
      assert.ok(t.tones === null || (Array.isArray(t.tones) && t.tones.length === 2), tag);
      assert.ok(Array.isArray(t.vocalization_marks), tag);
    }
  });

  test("rules.json, the model output and word schemas", () => {
    for (const [k, v] of Object.entries(read(ROOT, "spec/rules.json"))) {
      assert.ok(Number.isInteger(v) || typeof v === "number" || Array.isArray(v), k);
    }
    const model = read(ROOT, "spec/model-output.schema.json");
    for (const file of list(path.join(FIX, "normalize"))) {
      const f = read(FIX, "normalize", file);
      if (f.input.items || f.expect.error) continue;
      const out = JSON.parse(JSON.stringify(WS.process(f.input, f.raw)));
      for (const w of out.words) {
        assert.deepEqual(validate(read(ROOT, "spec/word.schema.json"), { id: "0190b4a0-0000-7000-8000-000000000000", status: "active", origin: "add", created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", deleted_at: null, ...w }), [], `${file}: ${w.native}`);
      }
    }
    assert.deepEqual(validate(model, { intent: "lookup", words: [{ lang: "ja", native: "犬", base_lang: "es", gloss: "perro", forms: ["perro"] }], reply: null }), []);
  });

  test("no file under spec/ outside lang/en and examples.en treats English as the reader's language", () => {
    const banned = /English speaker|english_forms|stopwords-en|english-irregulars|english-variants/;
    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
    for (const file of walk(path.join(ROOT, "spec"))) {
      const rel = path.relative(ROOT, file);
      if (rel.startsWith(path.join("spec", "lang", "en")) || rel.includes(`spec${path.sep}fixtures`) || rel.includes(`spec${path.sep}eval`)) continue;
      if (rel.endsWith("README.md")) continue;
      assert.ok(!banned.test(fs.readFileSync(file, "utf8")), rel);
    }
    for (const name of ["stopwords-en.txt", "english-irregulars.json", "english-variants.json"]) {
      assert.ok(!fs.existsSync(path.join(ROOT, "spec", name)));
    }
  });
});
