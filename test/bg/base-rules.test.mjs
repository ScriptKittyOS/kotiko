// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 50 section 5 in the real background.js: for each of the learner's languages, the
// word-boundary rules and common words content scripts need, written to storage.local as
// `baseRules` when the languages change, from the shared data and nothing written by hand
// per language.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { runInVm, sleep } from "../helpers/load-script.mjs";

function loadBackground({ local = {}, sync = {} } = {}) {
  const fake = createFakeChrome({ local, sync });
  fake.chrome.i18n = { getUILanguage: () => "en-US", getMessage: () => "" };
  const fetches = [];
  const ctx = runInVm("background.js", { chrome: fake.chrome, fetch: (u) => (fetches.push(String(u)), Promise.reject(new TypeError("offline"))) });
  const until = async (fn, ms = 5000) => {
    const end = Date.now() + ms;
    for (;;) {
      await fake.idle();
      if (fn()) return;
      if (Date.now() > end) throw new Error("timed out waiting");
      await sleep(5);
    }
  };
  return { fake, k: ctx.__kotiko, fetches, store: fake.store.local, until };
}

describe("base rules for content scripts", () => {
  test("each base gets its boundary rules and common words, in the learner's order", async () => {
    const bg = loadBackground({ sync: { ui: { baseLangs: ["es", "ja", "pl"], baseLangsConfirmed: true } } });
    await bg.until(() => bg.store.baseRules);
    const rules = bg.store.baseRules;
    assert.deepEqual(Object.keys(rules), ["es", "ja", "pl"]);
    assert.ok(rules.es.boundaries.sentence_openers.includes("¿"), "Spanish from the shared table");
    assert.equal(rules.ja.boundaries.spaces, false, "Japanese is written without spaces");
    assert.equal(rules.pl.boundaries.spaces, true, "Polish has no entry: the default");
    assert.ok(rules.es.stopwords.includes("el"), "a Full base's own list");
    assert.ok(rules.ja.stopwords.includes("あの"), "the imported list for Japanese");
    assert.ok(rules.pl.stopwords.includes("albo"), "and for Polish");
    assert.deepEqual(bg.fetches, [], "the packaged lists are read from the extension, not the network");
  });

  test("written again only when the languages change", async () => {
    const bg = loadBackground({ sync: { ui: { baseLangs: ["en"], baseLangsConfirmed: true } } });
    await bg.until(() => bg.store.baseRules);
    const first = bg.store.baseRules;
    await bg.k.mirrorBaseRules();
    assert.equal(bg.store.baseRules, first, "the same languages: not written");
    await bg.fake.chrome.storage.sync.set({ ui: { baseLangs: ["en", "zh-Hant"], baseLangsConfirmed: true } });
    await bg.until(() => bg.store.baseRules?.["zh-Hant"]);
    assert.equal(bg.store.baseRules["zh-Hant"].boundaries.spaces, false);
    assert.ok(bg.store.baseRules["zh-Hant"].stopwords.length > 100, "zh-Hant falls back to zh's list");
  });

  test("an update writes them again", async () => {
    const bg = loadBackground({ sync: { ui: { baseLangs: ["en"], baseLangsConfirmed: true } } });
    await bg.until(() => bg.store.baseRules);
    bg.store.baseRules = { en: { boundaries: {}, stopwords: [] } };
    await bg.fake.fireInstalled({ reason: "update" });
    await bg.until(() => bg.store.baseRules.en.stopwords.length);
    assert.ok(bg.store.baseRules.en.stopwords.includes("the"));
  });
});

// Slice 16 §4: the sensitive-sites list shipped with the extension, for content scripts.
describe("sensitive sites for content scripts", () => {
  const CONTENT = { id: "fake-extension-id", url: "https://example.com/", tab: { id: 1, url: "https://example.com/" } };

  test("copied to storage with the language rules, from the extension's own file", async () => {
    const bg = loadBackground({ sync: { ui: { baseLangs: ["en"], baseLangsConfirmed: true } } });
    await bg.until(() => bg.store.sensitiveSites);
    assert.ok(bg.store.sensitiveSites.some((s) => s.pattern === "chase.com" && s.category === "banking"));
    assert.deepEqual(bg.fetches, [], "never fetched from the network");
  });

  test("a page that opened first can ask for it; other pages and senders can't", async () => {
    const bg = loadBackground({ sync: { ui: { baseLangs: ["en"], baseLangsConfirmed: true } } });
    const r = await bg.fake.deliver({ type: "sensitiveSites" }, CONTENT);
    assert.ok(r.sites.length > 50);
    const other = await bg.fake.deliver({ type: "sensitiveSites" }, { id: "another-extension", url: "https://example.com/", tab: { id: 2 } });
    assert.ok(!other?.sites, "another extension gets nothing");
  });
});
