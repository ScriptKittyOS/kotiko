// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 18: which language a word of the page shows (extension/lib/precedence.js).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { requireExt } from "../helpers/load-script.mjs";

const P = requireExt("lib/precedence.js");
const T = requireExt("lib/text.js");
const keyOf = (s, base) => T.keyOf(s, base);
const PAGE = "https://example.com/news/article";
const NOW = Date.parse("2026-10-04T12:00:00Z");
const OLD = "2026-01-01T00:00:00Z";

let nextId = 1;
const w = (lang, native, gloss, extra = {}) => ({ id: nextId++, lang, native, gloss, base_lang: "en", status: "active", created_at: OLD, ...extra });
const entry = (words, key = words[0]?.gloss) => ({ key, candidates: words.map((x) => ({ word: x, form: x.gloss, case: "any" })) });
function session(words, { mixing = null, hiddenLangs = [], page = PAGE, day = "2026-10-01", salt = "test-salt", now = NOW } = {}) {
  return P.createSession({ salt, pageKey: page, dayKey: day, mixing, eligible: P.eligible({ words, hiddenLangs, mixing }), words, keyOf, now });
}
const pick = (words, opts, surface = words[0].gloss, base = "en") => session(words, opts).choose({ base, entry: entry(words), surface });

describe("golden vectors (slice 18, worked examples)", () => {
  const TH = [w("es", "gracias", "thanks"), w("ru", "спасибо", "thanks"), w("zh", "谢谢", "thanks")];
  const rows = [
    ["2026-10-01", "1ba24251354798", [0.207, 0.7117, 0.5977], "ru", "zh"],
    ["2026-10-02", "155a7786560603", [0.9837, 0.8225, 0.375], "es", "es"],
    ["2026-10-03", "1cd800f758f466", [0.4843, 0.3737, 0.7728], "zh", "zh"],
  ];
  for (const [day, seed, us, equal, zh3] of rows) {
    test(day, () => {
      const s = session(TH, { day });
      assert.equal(s.seedOf("thanks"), seed);
      ["es", "ru", "zh"].forEach((l, i) => assert.equal(Number(s.u(seed, l).toFixed(4)), us[i], l));
      assert.equal(pick(TH, { day }).lang, equal);
      assert.equal(pick(TH, { day, mixing: { weights: { zh: 3 } } }).lang, zh3);
    });
  }

  test("another page the same day: zh", () => {
    const s = session(TH, { page: "https://example.com/news/other" });
    assert.equal(s.seedOf("thanks"), "10fcffe272112b");
    assert.equal(pick(TH, { page: "https://example.com/news/other" }).lang, "zh");
  });

  test("adding Turkish on 2026-10-01: u(tr) 0.1667, ru still wins", () => {
    const four = [...TH, w("tr", "teşekkürler", "thanks")];
    const s = session(four);
    assert.equal(Number(s.u(s.seedOf("thanks"), "tr").toFixed(4)), 0.1667);
    assert.equal(pick(four).lang, "ru");
  });
});

describe("shares and properties over many pages", () => {
  const TH = [w("es", "gracias", "thanks"), w("ru", "спасибо", "thanks"), w("zh", "谢谢", "thanks")];
  const N = 100000;
  function shares(words, mixing) {
    const counts = {};
    const E = P.eligible({ words, mixing });
    for (let i = 0; i < N; i++) {
      const page = P.createSession({ salt: "test-salt", pageKey: `https://example.com/p/${i}`, dayKey: "2026-10-01", mixing, eligible: E, words, keyOf, now: NOW });
      const l = page.choose({ base: "en", entry: entry(words), surface: "thanks" }).lang;
      counts[l] = (counts[l] ?? 0) + 1;
    }
    return counts;
  }
  for (const weights of [{}, { zh: 3 }, { es: 0.33, ru: 1, zh: 3 }]) {
    test(`weights ${JSON.stringify(weights)}: shares within 1 point of w / Σw`, () => {
      const c = shares(TH, { weights });
      const wt = (l) => weights[l] ?? 1;
      const sum = ["es", "ru", "zh"].reduce((t, l) => t + wt(l), 0);
      for (const l of ["es", "ru", "zh"]) assert.ok(Math.abs(c[l] / N - wt(l) / sum) < 0.01, `${l}: ${c[l] / N} vs ${wt(l) / sum}`);
    });
  }

  test("adding a language never moves a choice between the others; hiding one only gives away its own", () => {
    const four = [...TH, w("tr", "teşekkürler", "thanks")];
    let moved = 0;
    for (let i = 0; i < 20000; i++) {
      const page = `https://example.com/q/${i}`;
      const three = pick(TH, { page }).lang;
      const withTr = pick(four, { page }).lang;
      if (withTr !== three) {
        assert.equal(withTr, "tr", "only to the new language");
        moved++;
      }
      const hiddenRu = pick(TH, { page, hiddenLangs: ["ru"] }).lang;
      if (three !== "ru") assert.equal(hiddenRu, three, "hiding ru moves only what ru held");
      else assert.notEqual(hiddenRu, "ru");
    }
    assert.ok(Math.abs(moved / 20000 - 0.25) < 0.015, `about a quarter to Turkish: ${moved / 20000}`);
  });

  test("changing one weight only moves words between that language and the others", () => {
    for (let i = 0; i < 5000; i++) {
      const page = `https://example.com/r/${i}`;
      const a = pick(TH, { page }).lang;
      const b = pick(TH, { page, mixing: { weights: { zh: 3 } } }).lang;
      if (a !== b) assert.equal(b, "zh");
    }
  });
});

describe("cleanup (step 2)", () => {
  test("English base: Spanish no for no is dropped when Russian нет exists; alone, it counts as known", () => {
    const no = w("es", "no", "no");
    const net = w("ru", "нет", "no");
    assert.equal(pick([no, net]).word, net);
    assert.deepEqual(pick([no]), { known: true });
  });

  test("diacritics and capitals don't make a different word: hôtel for hotel", () => {
    assert.deepEqual(pick([w("fr", "hôtel", "hotel")], {}, "Hotel"), { known: true });
  });

  test("Spanish base: English hotel dropped, Japanese ホテル shown", () => {
    const hotel = w("en", "hotel", "hotel", { base_lang: "es" });
    const jp = w("ja", "ホテル", "hotel", { base_lang: "es" });
    assert.equal(pick([hotel, jp], {}, "hotel", "es").word, jp);
  });

  test("other bases, the base's own language, suffixes, paused words and hidden languages are dropped", () => {
    const ok = w("es", "perro", "dog");
    const words = [w("ru", "собака", "dog", { base_lang: "es" }), w("en", "dog", "dog"), w("de", "-chen", "dog"), w("fr", "chien", "dog", { status: "paused" }), w("ja", "犬", "dog"), ok];
    const s = session(words, { hiddenLangs: ["ja"] });
    const c = s.choose({ base: "en", entry: entry(words), surface: "dog" });
    assert.equal(c.word, ok);
    assert.deepEqual(c.others, []);
  });

  test("identical natives: sr and hr da, tagged with the winner, the other in alsoLangs", () => {
    const sr = w("sr-Latn", "da", "yes");
    const hr = w("hr", "da", "yes");
    const c = pick([sr, hr], {}, "yes");
    assert.deepEqual(c.alsoLangs, [c.lang === "hr" ? "sr-Latn" : "hr"]);
  });
});

describe("modes, freshness, synonyms", () => {
  const es = w("es", "gracias", "thanks", { created_at: "2025-01-01T00:00:00Z" });
  const ru = w("ru", "спасибо", "thanks", { created_at: "2025-02-01T00:00:00Z" });
  const zh = w("zh", "谢谢", "thanks", { created_at: "2025-03-01T00:00:00Z" });

  test("a word added yesterday wins its concept for freshDays, then rejoins the draw", () => {
    const fresh = { ...zh, created_at: "2026-10-03T12:00:00Z" };
    let zhWins = 0;
    for (let i = 0; i < 300; i++) {
      assert.equal(pick([es, ru, fresh], { page: `https://e.com/${i}` }).lang, "zh");
      if (pick([es, ru, fresh], { page: `https://e.com/${i}`, now: NOW + 8 * 86400000 }).lang === "zh") zhWins++;
    }
    assert.ok(zhWins > 60 && zhWins < 140, `back to about a third: ${zhWins}`);
    assert.equal(pick([es, ru, fresh], { mixing: { freshDays: 0 } }).lang, "ru", "freshness off: the 2026-10-01 draw");
  });

  test("priority: the first listed language that has the word, then by first word", () => {
    assert.equal(pick([ru, zh], { mixing: { mode: "priority", priority: ["es", "ru", "zh"] } }).lang, "ru");
    assert.equal(pick([es, ru, zh], { mixing: { mode: "priority", priority: ["zh"] } }).lang, "zh");
    assert.equal(pick([zh, ru], { mixing: { mode: "priority", priority: [] } }).lang, "ru", "unlisted: oldest first word");
  });

  test("weight 0 is a backup: used only when no other language has the word", () => {
    const dogEs = w("es", "perro", "dog");
    const dogRu = w("ru", "собака", "dog");
    const catEs = w("es", "gato", "cat");
    assert.equal(pick([dogEs, dogRu], { mixing: { weights: { es: 0 } } }).lang, "ru");
    assert.equal(pick([catEs], { mixing: { weights: { es: 0 } } }).lang, "es");
  });

  test("focus: only the focused languages, hidden ignored for them; a word only in another language stays", () => {
    const dog = w("es", "perro", "dog");
    const words = [dog, zh];
    assert.equal(session(words, { mixing: { focus: ["zh"] } }).choose({ base: "en", entry: entry([dog]), surface: "dog" }), null);
    assert.equal(pick([es, ru, zh], { mixing: { focus: ["zh"] }, hiddenLangs: ["zh"] }).lang, "zh");
    assert.deepEqual([...P.eligible({ words: [es, ru, zh], mixing: { focus: ["zh", "tr"] } })], ["zh"]);
    assert.deepEqual([...P.eligible({ words: [es, ru], mixing: { focus: ["zh"] }, hiddenLangs: ["ru"] })], ["es"], "a Focus with no words left is ignored");
    assert.deepEqual([...P.eligible({ words: [es, ru, zh], site: { show: ["es", "ru"] }, mixing: { focus: ["zh"] } })].sort(), ["es", "ru"], "a site rule wins over Focus");
  });

  test("synonyms take turns across pages: casa and hogar both appear", () => {
    const casa = w("es", "casa", "home");
    const hogar = w("es", "hogar", "home");
    const seen = new Set();
    for (let i = 0; i < 50; i++) seen.add(pick([casa, hogar], { page: `https://e.com/h/${i}` }).word.native);
    assert.deepEqual([...seen].sort(), ["casa", "hogar"]);
    const c = pick([casa, hogar]);
    assert.equal(c.others.length, 1, "the other one is listed on the card");
  });

  test("mix: equal weights rotate es, ru, zh in a stable order; a re-render keeps its languages", () => {
    const words = [es, ru, zh];
    const s = session(words, { mixing: { mode: "mix" } });
    const at = (i, ordinal = 0) => s.choose({ base: "en", entry: entry(words), surface: "thanks", before: `sentence ${i} `, after: " end", ordinal }).lang;
    const seq = [0, 1, 2, 3, 4, 5].map((i) => at(i));
    assert.deepEqual(new Set(seq.slice(0, 3)).size, 3);
    assert.deepEqual(seq.slice(3), seq.slice(0, 3), "a period of three");
    assert.deepEqual([0, 1, 2].map((i) => at(i)), seq.slice(0, 3), "the same occurrences again: the same languages");
  });

  test("mix with weights 1, 1, 3: five occurrences hold zh three times", () => {
    const words = [es, ru, zh];
    const s = session(words, { mixing: { mode: "mix", weights: { zh: 3 } } });
    const seq = [0, 1, 2, 3, 4].map((i) => s.choose({ base: "en", entry: entry(words), surface: "thanks", before: `${i}`, after: "" }).lang);
    assert.equal(seq.filter((l) => l === "zh").length, 3);
    assert.equal(seq.filter((l) => l === "es").length, 1);
  });
});

describe("concept and page keys", () => {
  test("the concept is the oldest candidate's meaning, before cleanup", () => {
    const old = w("ru", "собака", "dog", { created_at: "2024-01-01T00:00:00Z" });
    const newer = w("es", "perros", "dogs", { created_at: "2026-01-01T00:00:00Z" });
    const s = session([old, newer], { hiddenLangs: ["ru"] });
    assert.equal(s.conceptOf(entry([newer, old], "dogs"), "en"), "dog");
  });

  test("tracking parameters, the fragment and parameter order don't change the page", () => {
    const rows = [
      ["https://example.com/a?utm_source=x&b=2&a=1#top", "https://example.com/a?a=1&b=2"],
      ["https://example.com/a?fbclid=1&gclid=2&si=3&ref=4", "https://example.com/a"],
      ["https://example.com/a?q=dog&utm_medium=social", "https://example.com/a?q=dog"],
      ["https://example.com/a/", "https://example.com/a/"],
      ["not a url", "not a url"],
    ];
    for (const [href, want] of rows) assert.equal(P.pageKey(href), want, href);
  });

  test("the day is the local date", () => {
    assert.equal(P.dayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  });

  test("cyrb53 is bryc's reference: known value", () => {
    assert.equal(P.cyrb53("a"), 7929297801672961);
  });
});
