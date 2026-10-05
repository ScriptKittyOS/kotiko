// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 12: the JSON backup (lib/backup.js) against spec/export.schema.json and the shared
// fixtures in spec/fixtures/export/; the restore's merge rules; the store's one-transaction
// restore and its Undo; the CSV and Anki files (lib/export-files.js) and their golden
// copies; and that no export can hold a key or a token.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IDBFactory } from "fake-indexeddb";
import { loadLocalLibs } from "../helpers/local-libs.mjs";
import { EXT_DIR, requireExt } from "../helpers/load-script.mjs";
import { register, validate } from "../helpers/json-schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = path.join(ROOT, "spec/fixtures/export");
const L = loadLocalLibs();
globalThis.KotikoStore = L.Store;
const B = requireExt("lib/backup.js");
const F = requireExt("lib/export-files.js");
const P = requireExt("bulk/parse.js");
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const fixture = (name) => fs.readFileSync(path.join(FIX, name), "utf8");
const en = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "_locales/en/messages.json"), "utf8"));
const langName = (tag) => L.Lang.dataName(tag, "en");
const header = (id) => en[`export_csv_col_${id}`].message;
const careful = (p) => en.popover_careful.message.replace("$PRONUNCIATION$", p);
const langs = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "spec/languages.json"), "utf8")).languages;

const EXPORT_SCHEMA = readJson("spec/export.schema.json");
register("word.schema.json", readJson("spec/word.schema.json"));

const DAY = 86_400_000;
const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const openStore = (now = () => T0) => L.Store.open({ indexedDB: new IDBFactory(), now });
const byId = (list) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));

// 2,000 records in 12 scripts, with every field slice 07 has: pronunciations from both
// sources, paused words, notes with commas, quotes and line breaks, and a bilingual pair.
const SCRIPTS = [
  ["ru", "кот"], ["ja", "猫"], ["zh", "狗"], ["ko", "개"], ["ar", "قط"], ["hi", "बिल्ली"],
  ["el", "γάτα"], ["he", "חתול"], ["th", "แมว"], ["ka", "კატა"], ["hy", "կատու"], ["es", "gato"],
];
function manyRecords(n = 2000) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const [lang, stem] = SCRIPTS[i % SCRIPTS.length];
    const base = i % 10 === 9 && lang !== "es" ? "es" : "en";
    const t = iso(T0 - (n - i) * 60_000);
    out.push({
      id: L.Store.uuid7(T0 - i * 1000).replace(/.{4}$/, (i % 65536).toString(16).padStart(4, "0")),
      lang,
      native: `${stem}${i}`,
      base_lang: base,
      sense: "",
      gloss: base === "en" ? `word${i}` : `palabra${i}`,
      forms: [{ text: base === "en" ? `word${i}` : `palabra${i}`, enabled: true, case: "any", ambiguous: false }, { text: `form${i}`, enabled: i % 3 !== 0, case: i % 7 === 0 ? "lower" : "any", ambiguous: i % 11 === 0 }],
      romanization: lang === "es" ? null : `roman${i}`,
      native_vocalized: null,
      pronunciation: lang === "ru" && base === "en" ? "pa-ZHAL-sta" : null,
      pronunciation_careful: lang === "ru" && base === "en" && i % 2 ? "pa-ZHA-lu-sta" : null,
      pronunciation_source: lang === "ru" && base === "en" ? (i % 4 ? "model" : "user") : null,
      note: i % 5 === 0 ? `note ${i}, "quoted"\nsecond line` : null,
      status: i % 13 === 0 ? "paused" : "active",
      origin: ["add", "manual", "bulk", "telegram", "import", "migrated"][i % 6],
      source_text: i % 8 === 0 ? `how do you say ${i}` : null,
      created_at: t,
      updated_at: t,
      deleted_at: null,
      merged_into: null,
    });
  }
  return out;
}

// Puts records into a store as they are (ids, times and all), as a restore would.
async function storeWith(records, now) {
  const store = await openStore(now);
  await store.tx("words", "readwrite", async ({ words }) => {
    for (const r of records) await new Promise((res, rej) => {
      const q = words.put({ ...r, native_key: L.Merge.nativeKey(r.native) });
      q.onsuccess = res;
      q.onerror = () => rej(q.error);
    });
  });
  return store;
}

describe("the JSON backup (§2)", () => {
  test("the shared fixtures and an export follow spec/export.schema.json", () => {
    for (const name of ["multi-script.json", "bilingual.json", "v1.json"]) {
      const doc = JSON.parse(fixture(name));
      if (doc.schemaVersion === 2) assert.deepEqual(validate(EXPORT_SCHEMA, doc), [], name);
    }
    const doc = B.exportDoc({ words: manyRecords(50), settings: { enabled: true }, version: "0.3.0", now: T0 });
    assert.deepEqual(validate(EXPORT_SCHEMA, doc), []);
    assert.equal(doc.format, "kotiko.words");
    assert.equal(doc.schemaVersion, 2);
    assert.equal(doc.app.source, "extension");
  });

  test("UTF-8 without a BOM, two-space indent, every word that isn't deleted in every status", () => {
    const words = manyRecords(30);
    words[3] = { ...words[3], deleted_at: iso(T0) };
    const text = B.stringify(B.exportDoc({ words, version: "0.3.0", now: T0 }));
    assert.notEqual(text.charCodeAt(0), 0xfeff);
    assert.match(text, /^\{\n {2}"format": "kotiko.words",\n/);
    const doc = JSON.parse(text);
    assert.equal(doc.words.length, 29);
    assert.ok(doc.words.some((w) => w.status === "paused"));
    assert.ok(!doc.words.some((w) => w.id === words[3].id), "tombstones are left out");
    assert.ok(doc.words.every((w) => !("native_key" in w) && !("serverId" in w)), "the store's bookkeeping stays out");
  });

  test("a bilingual learner's 犬 is two entries, exactly as stored; a base no longer theirs is exported too", () => {
    const doc = JSON.parse(fixture("bilingual.json"));
    const out = B.exportDoc({ words: doc.words, version: "x", now: T0 });
    assert.deepEqual(out.words.filter((w) => w.native === "犬").map((w) => [w.base_lang, w.gloss]), [["es", "perro"], ["en", "dog"]]);
  });
});

describe("reading a backup (§5 step 1)", () => {
  test("round-trips every pronunciation field and pronunciation_source byte for byte", () => {
    const doc = JSON.parse(fixture("multi-script.json"));
    const r = B.read(fixture("multi-script.json"));
    assert.equal(r.ok, true);
    assert.deepEqual(r.invalid, []);
    assert.deepEqual(r.dropped, []);
    assert.deepEqual(r.words, doc.words);
    assert.deepEqual(r.words.map((w) => w.pronunciation_source), ["model", "user", "wiktionary", "model", null, null, null, null, null, null, null, null, null]);
    assert.deepEqual(r.settings, doc.settings);
  });

  test("a backup word with PA-ZHAL-STA is restored with pronunciation null and counted; invalid entries are listed, not fatal", () => {
    const r = B.read(fixture("invalid-words.json"));
    assert.equal(r.ok, true);
    const please = r.words.find((w) => w.native === "пожалуйста");
    assert.equal(please.pronunciation, null);
    assert.equal(please.pronunciation_source, null);
    assert.equal(please.romanization, "pozhaluysta", "only the bad field goes");
    assert.deepEqual(r.dropped.map((d) => [d.native, d.field, d.reason]), [["пожалуйста", "pronunciation", "bad_pronunciation"]]);
    assert.equal(r.words.find((w) => w.native === "хорошо").pronunciation, "ha-ra-SHO");
    assert.deepEqual(r.invalid.map((x) => x.reason), ["bad_lang", "target_is_base", "bad_native", "bad_gloss", "not_an_object", "pending"]);
    assert.ok(!r.words.some((w) => w.native === "удалено"), "a tombstone in a file is skipped");
    assert.equal(r.total, 8);
  });

  test("a version 1 backup: gloss is the old english, base en, romanization kept, no pronunciation", () => {
    const r = B.read(fixture("v1.json"));
    assert.equal(r.ok, true);
    assert.equal(r.version, 1);
    assert.equal(r.legacy, 3);
    assert.deepEqual(r.words.map((w) => [w.native, w.gloss, w.base_lang, w.romanization, w.pronunciation]), [
      ["пожалуйста", "please", "en", "pazhaluysta", null],
      ["кошка", "cat", "en", "koshka", null],
      ["水", "water", "en", "mizu", null],
    ]);
    assert.deepEqual(r.words[1].forms.map((f) => f.text), ["cat", "cats"]);
    assert.equal(r.words[2].status, "paused");
    assert.deepEqual(r.bases, ["en"]);
    assert.ok(r.words.every((w) => !("english" in w))); // base-neutral-ok: the v1 field is gone after reading
  });

  test("a newer schemaVersion is refused; other files aren't backups", () => {
    assert.deepEqual(B.read(fixture("newer.json")), { ok: false, code: "backup_newer", details: { version: 3 } });
    assert.equal(B.read("{not json").code, "unreadable");
    assert.equal(B.read("[1,2]").code, "not_backup");
    assert.equal(B.read(JSON.stringify({ format: "something.else", schemaVersion: 2, words: [] })).code, "not_backup");
    assert.equal(B.read(JSON.stringify({ format: "kotiko.words", schemaVersion: 2, words: Array(20_001).fill({}) })).code, "too_many");
    assert.equal(B.read(`\uFEFF${fixture("bilingual.json")}`).ok, true, "a BOM a text editor added is fine");
  });
});

describe("what a restore does (§5 merge rules)", () => {
  const file = () => B.read(fixture("multi-script.json")).words;

  test("into an empty store: every word new, deleted words restored by default", () => {
    const p = B.plan(file(), [], { now: T0 });
    assert.equal(p.counts.new, 13);
    assert.equal(p.restoreDeleted, true);
    assert.deepEqual(p.writes.map((w) => w.record.id), file().map((w) => w.id), "the file's ids are kept");
  });

  test("the same id: identical, newer here (kept), or newer in the file (the file's version)", () => {
    const words = file();
    const here = [
      { ...words[0] },
      { ...words[1], gloss: "thank you", updated_at: iso(T0) },
      { ...words[2], note: "old note", updated_at: "2026-01-01T00:00:00.000Z" },
    ];
    const p = B.plan(words.slice(0, 3), here, { now: T0 });
    assert.deepEqual(p.items.map((i) => i.kind), ["identical", "kept", "merge"]);
    assert.equal(p.writes.length, 1);
    assert.equal(p.writes[0].record.note, words[2].note);
    assert.equal(p.writes[0].previous.note, "old note");
  });

  test("another id with the same natural key merges into the word here and keeps its id (07)", () => {
    const [w] = file();
    const here = [{ ...w, id: "0199b000-0000-7000-8000-000000000001", pronunciation: null, pronunciation_careful: null, pronunciation_source: null, forms: [{ text: "please", enabled: true, case: "any", ambiguous: false }], note: "mine" }];
    const p = B.plan([w], here, { now: T0 });
    assert.deepEqual(p.items, [{ kind: "merge", id: here[0].id }]);
    const rec = p.writes[0].record;
    assert.equal(rec.id, here[0].id);
    assert.equal(rec.note, "mine", "nothing written here is overwritten");
    assert.equal(rec.pronunciation, "pa-ZHAL-sta", "empty fields are filled");
  });

  test("a file's 犬 glossed dog (en) never merges into a local 犬 glossed perro (es)", () => {
    const words = B.read(fixture("bilingual.json")).words;
    const here = [{ ...words[0], id: "0199b000-0000-7000-8000-000000000002" }];
    const p = B.plan([words[1]], here, { now: T0 });
    assert.deepEqual(p.items.map((i) => i.kind), ["create"]);
  });

  test("a word deleted here after the backup was made is skipped unless asked", () => {
    const [w] = file();
    const here = [{ ...w, deleted_at: iso(T0 - DAY), updated_at: iso(T0 - DAY) }, { ...file()[1] }];
    const off = B.plan([w], here, { now: T0 });
    assert.equal(off.restoreDeleted, false, "off unless the store is empty");
    assert.deepEqual(off.items.map((i) => i.kind), ["skipped"]);
    assert.equal(off.counts.deletedLater, 1);
    const on = B.plan([w], here, { restoreDeleted: true, now: T0 });
    assert.deepEqual(on.items.map((i) => i.kind), ["restore"]);
    assert.equal(on.writes[0].record.deleted_at, null);
    assert.equal(on.writes[0].previous.deleted_at, iso(T0 - DAY));
  });
});

describe("restoring into this browser's store (§5 step 3, Undo)", () => {
  test("export, delete everything, import: the store is deep-equal to the original (2,000 words, 12 scripts)", async () => {
    const records = manyRecords(2000);
    assert.equal(new Set(records.map((r) => /\p{Script=Latin}/u.test(r.native) ? "Latn" : r.lang)).size, 12);
    const original = await storeWith(records);
    const before = byId(await original.all());
    const text = B.stringify(B.exportDoc({ words: await original.list(), version: "0.3.0", now: T0 }));
    const fresh = await openStore();
    const r = B.read(text, { now: T0 });
    assert.deepEqual([r.invalid, r.dropped], [[], []]);
    const out = await fresh.importWords(r.words);
    assert.equal(out.counts.new, 2000);
    assert.deepEqual(byId(await fresh.all()), before);
    // A second time: everything already identical, nothing created.
    const again = await fresh.importWords(B.read(text).words);
    assert.deepEqual([again.counts.new, again.counts.merge, again.counts.identical, again.written], [0, 0, 2000, 0]);
    assert.deepEqual(byId(await fresh.all()), before);
  });

  test("a word edited after the backup keeps the edit; Undo puts the store back exactly", async () => {
    let now = Date.parse("2026-10-01T12:00:00.000Z");
    const text = fixture("multi-script.json");
    const words = B.read(text).words;
    // This browser had the same words, but its 犬 has another id and no pronunciation.
    const other = { ...words[3], id: "0199b000-0000-7000-8000-000000000003", pronunciation: null, pronunciation_source: null };
    const store = await storeWith(words.map((w, i) => (i === 3 ? other : w)), () => now);
    now += 1000;
    assert.equal((await store.update(words[0].id, { gloss: "pretty please", forms: [{ text: "pretty please" }] })).ok, true);
    await store.remove(words[1].id);
    const before = byId(await store.all());
    now += 1000;
    const r = await store.importWords(B.read(text).words);
    assert.deepEqual([r.counts.kept, r.counts.merge, r.counts.deletedLater, r.restoreDeleted], [1, 1, 1, false]);
    assert.equal((await store.get(words[0].id)).gloss, "pretty please", "merge, not overwrite");
    assert.notEqual((await store.get(words[1].id)).deleted_at, null, "deleted after the backup: still deleted");
    const merged = await store.get(other.id);
    assert.equal(merged.pronunciation, "ee-noo", "07's merge fills what was empty and keeps the local id");
    assert.notDeepEqual(byId(await store.all()), before);
    now += 1000;
    const undo = await store.undoImport();
    assert.deepEqual([undo.ok, undo.changed], [true, 0]);
    assert.deepEqual(byId(await store.all()), before);
    assert.equal((await store.undoImport()).code, "nothing_to_undo", "only the most recent import, once");
  });

  test("Undo is offered for 24 hours; a word changed since is left alone", async () => {
    let now = T0;
    const store = await openStore(() => now);
    await store.importWords(B.read(fixture("bilingual.json")).words);
    const [w] = await store.list();
    now += 1000;
    await store.update(w.id, { note: "mine now" });
    now += 1000;
    const undo = await store.undoImport();
    assert.deepEqual([undo.undone, undo.changed], [4, 1]);
    assert.equal((await store.get(w.id)).note, "mine now");
    await store.importWords(B.read(fixture("multi-script.json")).words);
    now += DAY + 1;
    assert.equal((await store.undoImport()).code, "nothing_to_undo");
  });

  test("a restore over the vocabulary cap changes nothing", async () => {
    const store = await openStore();
    const words = B.read(fixture("multi-script.json")).words;
    await assert.rejects(store.importWords(words.concat(manyRecords(20_000).slice(0, 19_990))), (e) => e.code === "vocabulary_full");
    assert.equal((await store.all()).length, 0);
  });
});

describe("the spreadsheet (§3)", () => {
  const doc = JSON.parse(fixture("multi-script.json"));

  test("UTF-8 with a BOM, RFC 4180 quoting, CRLF, every script readable, one row per record", () => {
    const text = F.csv(doc.words, { header, langName });
    assert.equal(text.charCodeAt(0), 0xfeff);
    assert.ok(text.includes("\r\n"));
    assert.ok(!/[^\r]\n(?!quietly)/.test(text), "every line ends CRLF; a line break inside a quoted note stays");
    assert.ok(text.includes('"He said ""miau"", then left,\nquietly"'));
    for (const [, native] of doc.words.map((w) => [w.lang, w.native])) assert.ok(text.includes(native));
    assert.equal(text.slice(1).split("\r\n").filter(Boolean).length, doc.words.length + 1);
  });

  test("formula injection: a cell starting with = + - @ tab or CR gets a leading quote", () => {
    const text = F.csv(doc.words, { header, langName });
    assert.ok(text.includes(",'=1+1 is how a formula starts,"));
    assert.ok(text.includes(",'+ said everywhere,"));
    assert.ok(text.includes(",'-ό takes the stress,"));
    assert.ok(text.includes(`"'@ the door, too"`));
    const tab = F.csv([{ ...doc.words[0], note: "\tx" }, { ...doc.words[0], note: "\rx" }], { header, langName });
    assert.ok(tab.includes(",'\tx,"));
    assert.ok(tab.includes(`"'\rx"`));
  });

  test("the header row is the interface language's export_csv_col_* messages, in the spec's column order", () => {
    const first = F.csv([], { header, langName }).slice(1).split("\r\n")[0];
    assert.equal(first, F.CSV_COLUMNS.map(header).join(","));
    assert.equal(F.CSV_COLUMNS.join(","), "native,native_vocalized,pronunciation,pronunciation_careful,romanization,gloss,forms,language,language_code,base_language,base_language_code,note,status,added,pronunciation_source,id");
  });

  test("with bases es and en: one row per record (犬 / perro / es and 犬 / dog / en)", () => {
    const text = F.csv(JSON.parse(fixture("bilingual.json")).words, { header, langName });
    const rows = text.slice(1).split("\r\n").slice(1).filter((l) => l.startsWith("犬,"));
    assert.deepEqual(rows.map((l) => l.split(",").filter((_, i) => [0, 5, 10].includes(i))), [["犬", "perro", "es"], ["犬", "dog", "en"]]);
  });

  test("matches the golden files", () => {
    for (const name of ["multi-script", "bilingual"]) {
      const words = JSON.parse(fixture(`${name}.json`)).words;
      // The `added` column is the local date; the fixtures are at noon UTC, the same day
      // from UTC-11 to UTC+11.
      assert.equal(F.csv(words, { header, langName }), fixture(`${name}.en.csv`), name);
    }
  });

  test("bulk add reads the CSV back with no column mapping, keeping every pronunciation field (slice 13)", async () => {
    const text = F.csv(doc.words, { header, langName });
    const read = P.read(text, { filename: "kotiko-words-2026-10-01.csv" });
    const built = await P.build(read, { base: "en", langs });
    assert.equal(built.decidedBy ?? "headers", "headers");
    const byNative = new Map(built.rows.map((r) => [r.native, r]));
    for (const w of doc.words) {
      const r = byNative.get(w.native);
      assert.ok(r, w.native);
      assert.equal(r.lang, w.lang);
      assert.equal(r.gloss, w.gloss);
      assert.equal(r.romanization || null, w.romanization);
      assert.equal(r.pronunciation || null, w.pronunciation);
      assert.equal(r.pronunciation_careful || null, w.pronunciation_careful);
      assert.equal(r.native_vocalized || null, w.native_vocalized);
      assert.equal(r.pronunciation_source || null, w.pronunciation_source);
      assert.equal(r.base_lang, w.base_lang);
      assert.equal(r.note ?? null, w.note, "a guarded note comes back without its quote");
    }
  });
});

describe("Anki cards (§4)", () => {
  test("headers, one note per record, GUIDs, tabs and newlines as spaces", () => {
    const words = JSON.parse(fixture("multi-script.json")).words;
    const text = F.anki(words, { langName, careful, notetype: "Basic (and reversed card)" });
    const lines = text.split("\n");
    assert.deepEqual(lines.slice(0, 7), ["#separator:tab", "#html:false", "#notetype:Basic (and reversed card)", "#deck column:4", "#tags column:5", "#guid column:6", "#columns:Front\tBack\tLanguage\tDeck\tTags\tGUID"]);
    const rows = lines.slice(7).filter(Boolean);
    assert.equal(rows.length, words.length);
    assert.ok(rows.every((r) => r.split("\t").length === 6));
    assert.ok(rows.some((r) => r.includes("He said")) && !text.includes("left,\nquietly"));
    assert.ok(rows.every((r, i) => r.endsWith(`\tkotiko-${words[i].id}`)));
    assert.ok(rows.every((r, i) => r.split("\t")[3] === `Kotiko::${langName(words[i].lang)}`), "one subdeck per language");
    assert.ok(rows[0].split("\t")[4] === "kotiko lang::ru base::en");
    assert.ok(!F.anki(words, { langName, careful, notetype: null }).includes("#notetype"), "no verified name: Anki asks");
  });

  test("the Front for a base-en пожалуйста; the Back has no pronunciation", () => {
    const [w] = JSON.parse(fixture("multi-script.json")).words;
    const row = F.anki([w], { langName, careful }).split("\n")[6].split("\t");
    assert.equal(row[0], "пожа́луйста (pozhaluysta) · pa-ZHAL-sta · Slowly: pa-ZHA-lu-sta");
    assert.equal(row[1], "please");
  });

  test("two bases: Kotiko::<Base>::<Language> subdecks (Kotiko::Spanish::Japanese, Kotiko::English::Japanese)", () => {
    const words = JSON.parse(fixture("bilingual.json")).words;
    const rows = F.anki(words, { langName, careful }).split("\n").slice(6).filter(Boolean).map((l) => l.split("\t"));
    assert.deepEqual(rows.filter((r) => r[0].startsWith("犬")).map((r) => [r[0], r[1], r[3]]), [["犬 (inu) · i-nu", "perro", "Kotiko::Spanish::Japanese"], ["犬 (inu) · ee-noo", "dog", "Kotiko::English::Japanese"]]);
  });

  test("matches the golden files; every note type name comes from Anki's own files", () => {
    for (const name of ["multi-script", "bilingual"]) {
      assert.equal(F.anki(JSON.parse(fixture(`${name}.json`)).words, { langName, careful, notetype: "Basic (and reversed card)" }), fixture(`${name}.en.anki.txt`), name);
    }
    const table = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "data/anki-notetypes.json"), "utf8"));
    assert.equal(table.names.en, "Basic (and reversed card)");
    assert.ok(Object.values(table.names).every((v) => typeof v === "string" && v.length && v.length < 80 && !/[\t\n]/.test(v)));
  });

  test("file names", () => {
    const at = new Date(2026, 9, 5, 12).getTime();
    assert.deepEqual(["backup", "csv", "anki"].map((k) => F.filename(k, at)), ["kotiko-backup-2026-10-05.json", "kotiko-words-2026-10-05.csv", "kotiko-anki-2026-10-05.txt"]);
  });
});

describe("no export holds a key or a token", () => {
  const TOKEN = "kotiko-server-token-0123456789abcdefghij";
  const KEY = "sk-or-v1-0123456789abcdef0123456789abcdefa1b2";
  const local = {
    token: TOKEN,
    serverUrl: `http://me:${TOKEN}@home.example:4747/?token=${TOKEN}`,
    server: { url: `http://me:${KEY}@home.example:4747/?key=${KEY}#${KEY}` },
    keys: { server: true, providers: { openrouter: true } },
    lookup: { kind: "provider", provider: "openrouter", baseUrl: `https://openrouter.ai/api/v1?key=${KEY}`, model: null, dataCollection: "deny", apiKey: KEY },
    prefs: { theme: "dark" },
    mixing: { mode: "mix" },
    hiddenLangs: ["ru"],
    enabled: true,
    seedSalt: "0123456789abcdef0123456789abcdef",
    speech: { allowOnline: true, rate: 1, voices: { ru: "x" }, key: KEY },
  };

  test("settingsOf is an allowlist: addresses lose their credentials, nothing else gets in", () => {
    const s = B.settingsOf({ local, sync: { ui: { uiLang: "auto", baseLangs: ["es", "en"] } } });
    assert.deepEqual(s.server, { url: "http://home.example:4747" });
    assert.deepEqual(s.lookup, { provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: null, dataCollection: "deny" });
    assert.deepEqual(s.ui, { uiLang: "auto", baseLangs: ["es", "en"] });
  });

  test("grep over every generated file: JSON, CSV, Anki", () => {
    const words = JSON.parse(fixture("multi-script.json")).words;
    const files = [
      B.stringify(B.exportDoc({ words: words.map((w) => ({ ...w, serverId: TOKEN })), settings: B.settingsOf({ local, sync: {} }), version: "x", now: T0 })),
      F.csv(words, { header, langName }),
      F.anki(words, { langName, careful }),
    ];
    for (const text of files) {
      assert.ok(!text.includes(TOKEN), "no server token");
      assert.ok(!text.includes(KEY), "no provider key");
      assert.ok(!/sk-or-|apiKey|"token"/.test(text));
    }
  });

  test("restoring settings never changes where requests go, where words live or the lookup kind", () => {
    const s = B.settingsOf({ local: { ...local, lookup: { provider: "openrouter", baseUrl: "https://evil.example/v1", model: "m/one", dataCollection: "deny" }, server: { url: "https://evil.example" } }, sync: { ui: { baseLangs: ["es"] } } });
    const other = B.settingsPatch(s, { current: { lookup: { kind: "provider", provider: "groq", baseUrl: null, model: null } } });
    assert.deepEqual(other.local.lookup, { kind: "provider", provider: "groq", baseUrl: null, model: null, dataCollection: "deny" });
    const same = B.settingsPatch(s, { current: { lookup: { kind: "none", provider: "openrouter", baseUrl: null, model: null } } });
    assert.deepEqual(same.local.lookup, { kind: "none", provider: "openrouter", baseUrl: null, model: "m/one", dataCollection: "deny" });
    for (const p of [other, same]) assert.ok(!("server" in p.local) && !("wordsHome" in p.local) && !("keys" in p.local) && !("token" in p.local));
    assert.deepEqual(same.sync.baseLangs, ["es"]);
  });
});
