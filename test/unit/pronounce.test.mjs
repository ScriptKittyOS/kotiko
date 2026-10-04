// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Pronunciations from Wiktionary (extension/lib/pronounce.js, slice 49 section 4a): the
// shared cases in spec/fixtures/pronounce/, which the server runs too, and how pages are
// fetched and cached.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, requireExt } from "../helpers/load-script.mjs";

const spec = requireExt("spec/spec.js");
const P = requireExt("lib/pronounce.js").create(spec);
const FIX = path.join(ROOT, "spec/fixtures/pronounce");
const cases = JSON.parse(fs.readFileSync(path.join(FIX, "cases.json"), "utf8")).cases;

// A cache that already holds the page's sections, so nothing is fetched.
const holding = (blocks) => ({ get: async () => blocks, put: async () => {} });
const noFetch = async () => assert.fail("fetched");

describe("shared cases (spec/fixtures/pronounce/cases.json)", () => {
  for (const c of cases) {
    test(c.name, async () => {
      const r = await P.enrich({ ...c.word }, { fetchPage: noFetch, cache: holding(c.blocks) });
      assert.equal(r.status, c.expect.status);
      for (const [k, v] of Object.entries(c.expect)) if (k !== "status") assert.equal(r.word[k] ?? null, v, k);
      if (r.status === "wiktionary") {
        assert.equal(r.word.pronunciation_source, "wiktionary");
        assert.equal(r.word.pronunciation_careful, null);
      } else {
        assert.deepEqual(r.word, c.word, "a word Wiktionary can't help is returned as it was");
      }
    });
  }
});

describe("reading a page", () => {
  test("the language's section only, one block per Pronunciation heading", () => {
    const html = fs.readFileSync(path.join(FIX, "page.html"), "utf8");
    const want = JSON.parse(fs.readFileSync(path.join(FIX, "page.json"), "utf8"));
    assert.deepEqual(P.blocksFromHtml(html, want.heading), want.blocks);
    assert.deepEqual(P.blocksFromHtml(html, want.missing.heading), want.missing.blocks);
    assert.deepEqual(P.blocksFromHtml(null, "Russian"), []);
  });

  test("section headings from CLDR names, with Wiktionary's own where they differ", () => {
    assert.equal(P.heading("ru"), "Russian");
    assert.equal(P.heading("pt-BR"), "Portuguese");
    assert.equal(P.heading("sr"), "Serbo-Croatian");
    assert.equal(P.heading("no"), "Norwegian Bokmål");
  });
});

describe("fetching", () => {
  const word = { lang: "ru", base_lang: "en", native: "это", pronunciation: "eh-TO", pronunciation_source: "model" };
  const html = '<h2 id="Russian">Russian</h2><h3>Pronunciation</h3><span class="IPA">[ˈɛtə]</span><h3>Pronoun</h3>';
  const memory = () => {
    const m = new Map();
    return { m, get: async (k) => m.get(k), put: async (k, v) => void m.set(k, v) };
  };

  test("asks for the word once, then the cache answers", async () => {
    const cache = memory();
    const asked = [];
    const fetchPage = async (t) => (asked.push(t), html);
    assert.equal((await P.enrich(word, { fetchPage, cache })).word.pronunciation, "EH-ta");
    assert.equal((await P.enrich(word, { fetchPage, cache })).word.pronunciation, "EH-ta");
    assert.deepEqual(asked, ["это"]);
    assert.deepEqual(cache.m.get("wiktionary:ru:это"), [["[ˈɛtə]"]]);
  });

  test("no page is remembered; a failed request is not, and keeps the model's", async () => {
    const cache = memory();
    assert.equal((await P.enrich(word, { fetchPage: async () => null, cache })).status, "no_data");
    assert.deepEqual(cache.m.get("wiktionary:ru:это"), []);
    const other = memory();
    const r = await P.enrich(word, { fetchPage: async () => Promise.reject(new Error("429")), cache: other });
    assert.equal(r.status, "unavailable");
    assert.equal(r.word.pronunciation, "eh-TO");
    assert.equal(other.m.size, 0);
  });
});
