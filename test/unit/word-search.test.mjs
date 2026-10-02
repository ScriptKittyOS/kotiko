// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 21 §4: the dashboard's search folding, matching and ranking (lib/word-search.js).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { requireExt } from "../helpers/load-script.mjs";
import { dashboardWords } from "../helpers/dashboard-words.mjs";

const { fold, compact, entryFor, createIndex, highlight } = requireExt("lib/word-search.js");
const { groupRecords } = requireExt("lib/dashboard-model.js");

function indexOf(records, bases = ["en", "es"]) {
  const groups = groupRecords(records, { bases });
  const index = createIndex();
  for (const g of groups) index.set(g.id, entryFor(g));
  const ids = groups.map((g) => g.id);
  const find = (q) => index.search(q, ids).map((id) => groups.find((g) => g.id === id).native);
  return { index, groups, ids, find };
}

describe("folding", () => {
  test("case, accents and tone marks fold away", () => {
    assert.equal(fold("Café"), "cafe");
    assert.equal(fold("NIÑO"), "nino");
    assert.equal(fold("xièxie"), "xiexie");
    assert.equal(fold("nǐ hǎo"), "ni hao");
    assert.equal(fold("Ёлка"), "елка");
    assert.equal(fold("łódź"), "lodz");
  });

  test("Arabic and Hebrew vowel points fold away; letters of other scripts stay", () => {
    assert.equal(fold("كِتَاب"), fold("كتاب"));
    assert.equal(fold("שָׁלוֹם"), fold("שלום"));
    assert.equal(fold("が"), "が", "Japanese voicing marks are letters");
    assert.equal(fold("धन्यवाद"), "धन्यवाद");
    assert.equal(fold("고마워"), "고마워");
  });

  test("Turkish casing uses the word's language", () => {
    assert.equal(fold("İstanbul", "tr"), "istanbul");
    assert.equal(fold("ISPARTA", "tr"), "isparta", "dotless ı folds to i");
  });

  test("pronunciations compact without hyphens or spaces", () => {
    assert.equal(compact("spa-SEE-ba"), "spaseeba");
    assert.equal(compact("ef-ha-ree-STOH"), "efhareestoh");
    assert.equal(compact("nee hao"), "neehao");
  });
});

describe("matching (21 acceptance)", () => {
  const { find } = indexOf(dashboardWords(Date.UTC(2026, 9, 2)));

  test("xiexie finds 谢谢 / xièxie; cafe finds café; nino finds niño", () => {
    assert.deepEqual(find("xiexie"), ["谢谢"]);
    assert.deepEqual(find("cafe"), ["café"]);
    assert.deepEqual(find("nino"), ["niño"]);
  });

  test("spaseeba finds спасибо through its pronunciation spa-SEE-ba", () => {
    assert.deepEqual(find("spaseeba"), ["спасибо"]);
    assert.deepEqual(find("spa-see-ba"), ["спасибо"]);
  });

  test("perro finds 犬 through its Spanish record; dog finds it through the English one", () => {
    assert.ok(find("perro").includes("犬"));
    assert.ok(find("dog").includes("犬"));
  });

  test("natives, forms and notes match in any script", () => {
    assert.deepEqual(find("شكرا"), ["شكرا"]);
    assert.ok(find("thank you").includes("спасибо"), "a form");
    assert.deepEqual(find("большое"), ["спасибо"], "the note");
    assert.deepEqual(find("SPASIBO"), ["спасибо"], "the romanization, any case");
    assert.deepEqual(find("спасибо"), ["спасибо"]);
  });

  test("an empty query keeps every key in order", () => {
    const { ids, index } = indexOf(dashboardWords(Date.UTC(2026, 9, 2)));
    assert.deepEqual(index.search("  ", ids), ids);
  });
});

describe("ranking", () => {
  test("exact native matches come first; the rest keep the list's order", () => {
    const r = (id, native, gloss) => ({ id, lang: "es", native, gloss, forms: [gloss], base_lang: "en", created_at: `2026-09-${10 + id}T00:00:00Z` });
    const { find } = indexOf([r(1, "gato", "cat"), r(2, "gatos", "cats"), r(3, "agato", "x"), { ...r(4, "perro", "gato man"), lang: "pt" }]);
    // The list order is newest first (4, 3, 2, 1); "gato" exactly is moved to the front.
    assert.deepEqual(find("gato"), ["gato", "perro", "agato", "gatos"]);
  });
});

describe("highlight", () => {
  test("ranges are in the original text, whatever accents it carries", () => {
    assert.deepEqual(highlight("xièxie", "xie"), [[0, 6]], "touching matches merge");
    assert.deepEqual(highlight("xièxie dog xie", "xie"), [[0, 6], [11, 14]]);
    assert.deepEqual(highlight("Café au lait", "cafe"), [[0, 4]]);
    assert.deepEqual(highlight("spa-SEE-ba", "see"), [[4, 7]]);
  });

  test("decomposed input: the range covers the letters, the mark folds away", () => {
    const s = "café";
    assert.deepEqual(highlight(s, "cafe"), [[0, 4]]);
  });

  test("no query or no match: no ranges", () => {
    assert.deepEqual(highlight("dog", ""), []);
    assert.deepEqual(highlight("dog", "cat"), []);
  });

  test("characters outside the BMP keep both halves", () => {
    assert.deepEqual(highlight("𠀋x", "x"), [[2, 3]]);
  });
});
