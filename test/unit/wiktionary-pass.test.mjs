// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The background pass that gives words kept in this browser their pronunciation from
// Wiktionary (extension/lib/wiktionary-pass.js, slice 49 section 4a), on the real store.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { loadLocalLibs } from "../helpers/local-libs.mjs";
import { requireExt } from "../helpers/load-script.mjs";

globalThis.IDBKeyRange = IDBKeyRange;
const L = loadLocalLibs();
const Pronounce = requireExt("lib/pronounce.js").create(L.spec);
const { createPass } = requireExt("lib/wiktionary-pass.js");

const PAGE = '<h2>Russian</h2><h3>Pronunciation</h3><span class="IPA">[ˈɛtə]</span><h3>Pronoun</h3>';
const eto = { lang: "ru", native: "это", base_lang: "en", gloss: "this", forms: [{ text: "this" }], pronunciation: "eh-TO", pronunciation_source: "model" };

async function setup(words, opts = {}) {
  let t = Date.UTC(2026, 9, 4);
  const store = await L.Store.open({ indexedDB: new IDBFactory(), now: () => t });
  await store.upsertByNatural(words, { explicit: true });
  const asked = [];
  const pass = createPass({
    store,
    pronounce: Pronounce,
    fetchPage: async (title) => (asked.push(title), opts.fetchPage ? opts.fetchPage(title) : PAGE),
    now: () => t,
    sleep: async () => {},
    ...opts.pass,
  });
  return { store, pass, asked, advance: (ms) => void (t += ms) };
}

describe("the Wiktionary pass", () => {
  test("a saved word gets Wiktionary's pronunciation and stress mark, once", async () => {
    const { store, pass, asked } = await setup([eto]);
    assert.deepEqual(await pass.tick(), { looked: 1, written: 1, waiting_until: null });
    const [w] = await store.list();
    assert.deepEqual([w.pronunciation, w.pronunciation_source, w.native_vocalized], ["EH-ta", "wiktionary", "э́то"]);
    assert.deepEqual(await pass.tick(), { looked: 0, written: 0, waiting_until: null });
    assert.deepEqual(asked, ["это"]);
  });

  test("the learner's own pronunciation, other languages and bases without a key are left alone", async () => {
    const { pass, asked } = await setup([
      { ...eto, pronunciation_source: "user" },
      { lang: "ja", native: "犬", base_lang: "en", gloss: "dog", forms: [{ text: "dog" }] },
      { ...eto, native: "да", gloss: "oui", forms: [{ text: "oui" }], base_lang: "fr" },
    ]);
    assert.equal((await pass.tick()).looked, 0);
    assert.deepEqual(asked, []);
  });

  test("a word Wiktionary can't help keeps the model's and isn't asked about again", async () => {
    const { store, pass, asked } = await setup([eto], { fetchPage: () => null });
    await pass.tick();
    await pass.tick();
    const [w] = await store.list();
    assert.deepEqual([w.pronunciation, w.pronunciation_source], ["eh-TO", "model"]);
    assert.deepEqual(asked, ["это"]);
  });

  test("when Wiktionary can't be reached it waits ten minutes, then tries again", async () => {
    let fail = true;
    const { store, pass, advance } = await setup([eto], { fetchPage: () => (fail ? Promise.reject(new Error("429")) : PAGE) });
    const first = await pass.tick();
    assert.equal(first.written, 0);
    assert.ok(first.waiting_until);
    fail = false;
    advance(60_000);
    assert.equal((await pass.tick()).looked, 0, "still waiting");
    advance(10 * 60_000);
    assert.equal((await pass.tick()).written, 1);
    assert.equal((await store.list())[0].pronunciation, "EH-ta");
  });

  test("off while the words live on a server (the server's own pass covers them)", async () => {
    const { pass, asked } = await setup([eto], { pass: { enabled: async () => false } });
    assert.equal((await pass.tick()).looked, 0);
    assert.deepEqual(asked, []);
  });
});
