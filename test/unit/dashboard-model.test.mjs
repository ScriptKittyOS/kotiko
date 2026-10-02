// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 21's data rules (lib/dashboard-model.js): grouping, sort, filters, the shelf,
// tombstones, hash routes, the undo stack, the refresh line and the inline checks.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, requireExt } from "../helpers/load-script.mjs";
import { dashboardWords } from "../helpers/dashboard-words.mjs";

const M = requireExt("lib/dashboard-model.js");
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const DAY = 86_400_000;
const rec = (fields, daysAgo = 0) => ({
  id: fields.id ?? `${fields.lang}-${fields.native}-${fields.base_lang ?? "en"}`,
  base_lang: "en",
  status: "active",
  created_at: new Date(NOW - daysAgo * DAY).toISOString(),
  updated_at: new Date(NOW - daysAgo * DAY).toISOString(),
  forms: [fields.gloss],
  ...fields,
});

describe("groups (§3: one row per word, one record per base)", () => {
  test("records sharing lang and native key are one row, primary base first", () => {
    const groups = M.groupRecords([
      rec({ lang: "ja", native: "犬", base_lang: "es", gloss: "perro" }),
      rec({ lang: "ja", native: "犬", gloss: "dog" }),
      rec({ lang: "zh", native: "犬", gloss: "dog" }),
    ], { bases: ["en", "es"] });
    assert.equal(groups.length, 2, "same native in another language is another word");
    const inu = groups.find((g) => g.lang === "ja");
    assert.deepEqual(inu.records.map((r) => r.base_lang), ["en", "es"]);
    assert.deepEqual(M.meaningOf(inu).glosses.map((m) => m.gloss), ["dog", "perro"]);
    assert.equal(inu.id, inu.records[0].id);
  });

  test("the primary base decides the order: a Spanish reader sees perro first", () => {
    const [g] = M.groupRecords([rec({ lang: "ja", native: "犬", gloss: "dog" }), rec({ lang: "ja", native: "犬", base_lang: "es", gloss: "perro" })], { bases: ["es", "en"] });
    assert.deepEqual(M.meaningOf(g).glosses.map((m) => m.gloss), ["perro", "dog"]);
  });

  test("native keys fold case and final sigma like the server (native-key.json)", () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "spec/fixtures/native-key.json"), "utf8"));
    for (const { input, key } of fixture.cases) assert.equal(M.nativeKey(input), key, input);
    assert.equal(M.groupRecords([rec({ lang: "de", native: "Hund", gloss: "dog" }), rec({ lang: "de", native: "hund", gloss: "hound", id: "x" })]).length, 1);
  });

  test("with one base the meaning shows the gloss and counts the other forms", () => {
    const [g] = M.groupRecords([rec({ lang: "ru", native: "спасибо", gloss: "thanks", forms: ["thanks", "thank you", { text: "ta", enabled: false }] })]);
    assert.deepEqual(M.meaningOf(g), { glosses: [{ base: "en", gloss: "thanks" }], more: 1, rest: ["thank you"] });
  });

  test("a group is paused only when every record is", () => {
    const [g] = M.groupRecords([rec({ lang: "ja", native: "犬", gloss: "dog", status: "paused" }), rec({ lang: "ja", native: "犬", base_lang: "es", gloss: "perro" })]);
    assert.equal(g.paused, false);
  });

  test("malformed records are skipped", () => {
    assert.deepEqual(M.groupRecords([null, { lang: "ru" }, { native: "x" }, 7]), []);
  });
});

describe("sort and filters (§3)", () => {
  const groups = M.groupRecords(dashboardWords(NOW), { bases: ["en", "es"] });

  test("newest first by default; oldest reverses it", () => {
    const newest = M.sortGroups(groups, "newest");
    assert.equal(newest[0].native, "спасибо");
    assert.equal(M.sortGroups(groups, "oldest")[0].native, "кошка");
  });

  test("native A-Z collates within each language", () => {
    const ru = M.sortGroups(groups.filter((g) => g.lang === "ru"), "native").map((g) => g.native);
    assert.deepEqual(ru, ["дом", "кошка", "пожалуйста", "собака", "спасибо"]);
  });

  test("meaning A-Z uses the primary base's gloss; language sorts by name in the interface language", () => {
    assert.equal(M.sortGroups(groups, "meaning")[0].records[0].gloss, "book");
    const names = { ar: "árabe", de: "alemán", ru: "ruso" };
    const sorted = M.sortGroups(groups.filter((g) => names[g.lang]), "language", { uiLocale: "es", languageName: (l) => names[l] });
    assert.deepEqual([...new Set(sorted.map((g) => g.lang))], ["de", "ar", "ru"]);
  });

  test("language, status, added and source filters", () => {
    assert.ok(M.filterGroups(groups, { lang: "ru" }).every((g) => g.lang === "ru"));
    assert.deepEqual(M.filterGroups(groups, { status: "paused" }).map((g) => g.native), ["собака"]);
    assert.ok(!M.filterGroups(groups, { status: "active" }).some((g) => g.paused));
    assert.equal(M.filterGroups(groups, {}).length, groups.length, "the default shows active and paused");
    assert.ok(M.filterGroups(groups, { added: "week" }, { now: NOW }).every((g) => NOW - g.created <= 7 * DAY));
    assert.equal(M.filterGroups(groups, { source: "telegram" }).length, 0);
    assert.equal(M.filterGroups(groups, { source: "typed" }).length, groups.length);
  });

  test("Meaning in and Missing a meaning in", () => {
    assert.deepEqual(M.filterGroups(groups, { meaningIn: "es" }).map((g) => g.native), ["犬"]);
    assert.equal(M.filterGroups(groups, { missingIn: "es" }).length, groups.length - 1);
  });
});

describe("the shelf (§2)", () => {
  test("one card per language, most words first, with this week's adds and the hidden state", () => {
    const groups = M.groupRecords(dashboardWords(NOW));
    const shelf = M.shelf(groups, { now: NOW, hiddenLangs: ["ar"] });
    assert.equal(shelf[0].lang, "ru");
    assert.equal(shelf[0].count, 5);
    assert.equal(shelf[0].week, 2);
    assert.equal(shelf[0].paused, 1);
    assert.equal(shelf.find((e) => e.lang === "ar").hidden, true);
    assert.equal(shelf.reduce((n, e) => n + e.count, 0), groups.length);
  });
});

describe("Recently deleted (§3)", () => {
  test("tombstones within 30 days, grouped, most recently deleted first", () => {
    const entries = [
      { id: "a", at: NOW - 2 * DAY, word: rec({ id: "a", lang: "ru", native: "дом", gloss: "house" }) },
      { id: "b", at: NOW - 31 * DAY, word: rec({ id: "b", lang: "ru", native: "кот", gloss: "cat" }) },
      { id: "c", at: NOW - DAY, word: rec({ id: "c", lang: "ja", native: "犬", gloss: "dog" }) },
      { id: "d", at: NOW - DAY, word: null },
    ];
    const groups = M.deletedGroups(entries, { now: NOW });
    assert.deepEqual(groups.map((g) => g.native), ["犬", "дом"]);
    assert.equal(groups[0].deletedAt, NOW - DAY);
  });
});

describe("routes (§1)", () => {
  test("parses every route", () => {
    assert.deepEqual(M.parseRoute(""), { view: "words", id: null, params: {} });
    assert.deepEqual(M.parseRoute("#words"), { view: "words", id: null, params: {} });
    assert.deepEqual(M.parseRoute("#words/abc-1"), { view: "words", id: "abc-1", params: {} });
    assert.deepEqual(M.parseRoute("#words?lang=es&status=paused&q=thank"), { view: "words", id: null, params: { lang: "es", status: "paused", q: "thank" } });
    assert.deepEqual(M.parseRoute("#add"), { view: "add", params: {} });
    assert.deepEqual(M.parseRoute("#settings"), { view: "settings", section: null, params: {} });
    assert.deepEqual(M.parseRoute("#settings/voices"), { view: "settings", section: "voices", params: {} });
  });

  test("unknown values and keys are dropped; bad escapes survive", () => {
    assert.deepEqual(M.parseRoute("#words?status=sleeping&sort=random&evil=1&q=%E2"), { view: "words", id: null, params: { q: "\ufffd" } });
    assert.deepEqual(M.parseRoute("#words/%E0%A4%A"), { view: "words", id: "%E0%A4%A", params: {} });
  });

  test("formats state back, leaving defaults out, and round-trips", () => {
    const route = { view: "words", id: "x y", params: { lang: "ru", status: "live", sort: "newest", q: "dog & cat" } };
    const hash = M.formatRoute(route);
    assert.equal(hash, "#words/x%20y?lang=ru&q=dog+%26+cat");
    assert.deepEqual(M.parseRoute(hash), { view: "words", id: "x y", params: { lang: "ru", q: "dog & cat" } });
    assert.equal(M.formatRoute({ view: "settings", section: "about" }), "#settings/about");
  });
});

describe("the undo stack (§5)", () => {
  test("last in, first out; capped; entries can be removed when their toast's Undo runs", () => {
    const u = M.createUndoStack(3);
    const [a, b, c, d] = ["a", "b", "c", "d"].map((x) => u.push({ x }));
    assert.equal(u.size, 3, "the oldest falls off");
    u.remove(c);
    assert.equal(u.pop(), d);
    assert.equal(u.pop(), b);
    assert.equal(u.pop(), null);
    assert.ok(a);
  });
});

describe("the pronunciation refresh line (§3)", () => {
  test("each job state", () => {
    assert.deepEqual(M.refreshLine({ state: "running", done: 40, total: 120 }), { key: "dash_refresh_running", params: { done: 40, total: 120 }, action: "pause" });
    assert.deepEqual(M.refreshLine({ state: "waiting", retry_at: "2026-10-03T00:00:00Z" }, { formatTime: () => "00:00" }), { key: "dash_refresh_waiting", params: { time: "00:00" }, action: "pause" });
    assert.deepEqual(M.refreshLine({ state: "waiting", retry_at: null }), { key: "dash_refresh_no_provider", params: {}, action: "setup" });
    assert.deepEqual(M.refreshLine({ state: "paused", done: 40, total: 120 }), { key: "dash_refresh_paused", params: { done: 40, total: 120 }, action: "resume" });
    assert.equal(M.refreshLine({ state: "done", done: 120, total: 120 }), null);
    assert.equal(M.refreshLine(null), null);
  });
});

describe("inline checks (§5)", () => {
  test("pronunciation: one capital syllable per word for stressed languages", () => {
    assert.equal(M.pronunciationProblem("pa-ZHAL-sta", "ru", "en"), null);
    assert.equal(M.pronunciationProblem("PA-ZHAL-STA", "ru", "en"), "stress");
    assert.equal(M.pronunciationProblem("pa-zhal-sta", "ru", "en"), "stress");
    assert.equal(M.pronunciationProblem("DOM", "ru", "en"), "stress", "one syllable has no capitals");
    assert.equal(M.pronunciationProblem("dom", "ru", "en"), null);
    assert.equal(M.pronunciationProblem("Pa-zhal", "ru", "en"), "stress", "mixed case in a syllable");
    assert.equal(M.pronunciationProblem("a-ri-ga-toh", "ja", "en"), null);
    assert.equal(M.pronunciationProblem("a-RI-ga-toh", "ja", "en"), "stress", "Japanese has no stress capitals");
  });

  test("pronunciation: letters of the base's key, tone digits for tonal targets", () => {
    assert.equal(M.pronunciationProblem("pa-ZHAL-stá", "ru", "en"), "letters");
    assert.equal(M.pronunciationProblem("NEE-nyo", "es", "es"), null);
    assert.equal(M.pronunciationProblem("ni-ÑO", "es", "es"), null);
    assert.equal(M.pronunciationProblem("shyeh4-shyeh", "zh", "en"), null);
    assert.equal(M.pronunciationProblem("pa2-ZHAL", "ru", "en"), "letters");
    assert.equal(M.pronunciationProblem("x".repeat(97), "ru", "en"), "too_long");
    assert.equal(M.pronunciationProblem("anything", "ru", "fr"), null, "no key for this base: the server decides");
    assert.equal(M.pronunciationProblem("", "ru", "en"), null);
  });

  test("the stress mark must agree with the pronunciation's capitals", () => {
    assert.equal(M.stressMismatch("пожа́луйста", "pa-ZHAL-sta"), false);
    assert.equal(M.stressMismatch("по́жалуйста", "pa-ZHAL-sta"), true);
    assert.equal(M.stressMismatch("спаси́бо", "spa-SEE-ba"), false);
    assert.equal(M.stressMismatch("спасибо", "spa-SEE-ba"), false, "no mark: nothing to compare");
  });

  test("forms split on commas, and on 、 ， for Japanese and Chinese bases", () => {
    assert.deepEqual(M.splitForms(" dog, dogs ,, Dog ", "en"), ["dog", "dogs"]);
    assert.deepEqual(M.splitForms("犬、いぬ，イヌ", "ja"), ["犬", "いぬ", "イヌ"]);
    assert.deepEqual(M.splitForms("a、b", "en"), ["a、b"]);
  });
});

describe("small things", () => {
  test("uuid7: version 7, variant 10, the time in the first 48 bits", () => {
    const id = M.uuid7(0x0190a1b2c3d4, (n) => new Uint8Array(n).fill(0xff));
    assert.match(id, /^0190a1b2-c3d4-7fff-bfff-ffffffffffff$/);
    assert.match(M.uuid7(), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("added: relative for a week, capitalized, then a date", () => {
    const now = new Date(2026, 9, 2, 15).getTime();
    assert.equal(M.addedLabel(now - 3600_000, { now, locale: "en" }), "Today");
    assert.equal(M.addedLabel(now - DAY, { now, locale: "es" }), "Ayer");
    assert.equal(M.addedLabel(now - 3 * DAY, { now, locale: "en" }), "3 days ago");
    assert.equal(M.addedLabel(new Date(2026, 8, 20).getTime(), { now, locale: "en" }), "Sep 20");
    assert.equal(M.addedLabel(new Date(2025, 8, 20).getTime(), { now, locale: "en" }), "Sep 20, 2025");
    assert.equal(M.addedLabel(0), "");
  });
});
