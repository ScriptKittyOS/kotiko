// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 22 in the real background.js: a new install detects the languages the learner
// reads and opens the welcome tab; an update never does (existing learners keep what they
// have, and a learner with words never gets a first-word celebration); the popup and the
// dashboard open or focus the one welcome tab; milestones are claimed once; the first word
// saved anywhere finishes the first run.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { runInVm, sleep } from "../helpers/load-script.mjs";

const EXT_ID = "fake-extension-id";
const WELCOME = `chrome-extension://${EXT_ID}/welcome.html`;
const PAGE = { id: EXT_ID, url: WELCOME, tab: { id: 7, url: WELCOME } };
const CONTENT = { id: EXT_ID, url: "https://example.com/", tab: { id: 1, url: "https://example.com/" } };

function loadBackground({ local = {}, sync = {}, ui = "en-US", accept = ["en-US", "en"], contexts = null } = {}) {
  const fake = createFakeChrome({ runtimeId: EXT_ID, local, sync });
  const created = [];
  const updated = [];
  fake.chrome.tabs.create = async (o) => void created.push(o);
  fake.chrome.tabs.update = async (id, o) => void updated.push([id, o]);
  fake.chrome.windows = { update: async () => {} };
  fake.chrome.i18n = { getUILanguage: () => ui, getAcceptLanguages: async () => accept, getMessage: () => "" };
  if (contexts) fake.chrome.runtime.getContexts = async () => contexts;
  const fetches = [];
  const ctx = runInVm("background.js", { chrome: fake.chrome, fetch: (u) => (fetches.push(String(u)), Promise.reject(new TypeError("offline"))) });
  const until = async (fn, ms = 5000) => {
    const end = Date.now() + ms;
    for (;;) {
      await fake.idle();
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error("timed out waiting");
      await sleep(5);
    }
  };
  return { fake, ctx, k: ctx.__kotiko, created, updated, fetches, store: fake.store.local, sync: fake.store.sync, send: (m, s = PAGE) => fake.deliver(m, s), until };
}

const plain = (v) => JSON.parse(JSON.stringify(v));

describe("install and update (22 §1)", () => {
  test("a new install opens the welcome tab once, with the browser's languages detected and not yet confirmed", async () => {
    const bg = loadBackground({ ui: "es-PR", accept: ["es-PR", "es"] });
    await bg.fake.fireInstalled({ reason: "install" });
    await bg.until(() => bg.created.length);
    assert.deepEqual(plain(bg.created), [{ url: WELCOME, active: true }]);
    assert.deepEqual(plain(bg.sync.ui), { uiLang: "auto", baseLangs: ["es"], baseLangsDetected: ["es"], baseLangsConfirmed: false });
    assert.deepEqual(plain(bg.store.onboarding), { completedAt: null, skipped: false, version: 2 });
    assert.deepEqual(plain(bg.store.baseLangs), ["es"]);
    assert.deepEqual(plain(await bg.k.currentBases()), ["es"]);
    assert.deepEqual(bg.fetches, [], "detection reads the browser's settings and sends nothing");
  });

  test("a reinstall keeps languages the learner already confirmed (storage.sync outlives it)", async () => {
    const bg = loadBackground({ sync: { ui: { uiLang: "es", baseLangs: ["es", "en"], baseLangsConfirmed: true } }, ui: "en-US", accept: ["en-US"] });
    await bg.fake.fireInstalled({ reason: "install" });
    await bg.until(() => bg.created.length);
    assert.deepEqual(plain(bg.sync.ui), { uiLang: "es", baseLangs: ["es", "en"], baseLangsConfirmed: true, baseLangsDetected: ["en"] });
  });

  test("an update (and a browser update) never opens it; an existing learner is past the first run", async () => {
    const words = [{ id: 1, lang: "ru", native: "дом", english: "house", forms: ["house"] }];
    const bg = loadBackground({ local: { token: "t0ken", serverUrl: "http://127.0.0.1:4999", words } });
    await bg.fake.fireInstalled({ reason: "update", previousVersion: "0.2.0" });
    await bg.fake.fireInstalled({ reason: "chrome_update" });
    await bg.until(() => bg.store.onboarding?.completedAt && bg.store.celebrations);
    assert.deepEqual(bg.created, []);
    assert.equal(bg.store.onboarding.upgraded, true);
    assert.ok(bg.store.celebrations.done["vocab:first"], "no first-word celebration for an old list");
    assert.ok(bg.store.celebrations.done["page:first-swap"]);
    await bg.until(() => bg.sync.ui);
    assert.deepEqual(plain(bg.sync.ui), { uiLang: "auto", baseLangs: ["en"], baseLangsDetected: ["en"], baseLangsConfirmed: false }, "50's upgrade rule, not the welcome tab");
  });

  test("50's upgrade rule: a Spanish browser keeps swapping the old English words", async () => {
    const words = [{ id: 1, lang: "ru", native: "дом", english: "house", forms: ["house"] }];
    const bg = loadBackground({ local: { words }, ui: "es-PR", accept: ["es-PR", "es"] });
    await bg.fake.fireInstalled({ reason: "update", previousVersion: "0.2.0" });
    // The projection mirrors the bases into storage.local too; wait for the rule's own write.
    await bg.until(() => bg.sync.ui && bg.store.baseLangs?.length === 2);
    assert.deepEqual(plain(bg.sync.ui), { uiLang: "auto", baseLangs: ["es", "en"], baseLangsDetected: ["es"], baseLangsConfirmed: false });
    assert.deepEqual(plain(bg.store.baseLangs), ["es", "en"]);
  });

  test("50's upgrade rule leaves a learner's own list alone", async () => {
    const words = [{ id: 1, lang: "ru", native: "дом", english: "house", forms: ["house"] }];
    const ui = { uiLang: "auto", baseLangs: ["es"], baseLangsConfirmed: true };
    const bg = loadBackground({ local: { words }, sync: { ui }, ui: "es-PR", accept: ["es-PR"] });
    await bg.fake.fireInstalled({ reason: "update", previousVersion: "0.3.0" });
    await bg.until(() => bg.store.onboarding?.completedAt);
    await bg.fake.idle();
    assert.deepEqual(plain(bg.sync.ui), ui);
  });

  test("an update with no words: past the first run, but every celebration still ahead", async () => {
    const bg = loadBackground();
    await bg.fake.fireInstalled({ reason: "update", previousVersion: "0.2.0" });
    await bg.until(() => bg.store.onboarding?.completedAt);
    assert.equal(bg.store.celebrations, undefined);
    assert.deepEqual(bg.created, []);
  });
});

describe("the welcome tab from the popup and the dashboard", () => {
  test("opens one, or brings an open one to the front", async () => {
    const bg = loadBackground();
    assert.deepEqual(plain(await bg.send({ type: "welcome.open" })), { ok: true, focused: false });
    assert.deepEqual(plain(bg.created), [{ url: WELCOME, active: true }]);
    const open = loadBackground({ contexts: [{ contextType: "TAB", documentUrl: `${WELCOME}#x`, tabId: 9, windowId: 2 }] });
    assert.deepEqual(plain(await open.send({ type: "welcome.open" })), { ok: true, focused: true });
    assert.deepEqual(open.created, []);
    assert.deepEqual(plain(open.updated), [[9, { active: true }]]);
  });

  test("web pages can't open it or claim milestones", async () => {
    const bg = loadBackground();
    assert.deepEqual(plain(await bg.send({ type: "welcome.open" }, CONTENT)), { error: { code: "forbidden" } });
    assert.deepEqual(plain(await bg.send({ type: "celebrations.claim", key: "vocab:first" }, CONTENT)), { error: { code: "forbidden" } });
  });
});

describe("milestones and the end of the first run", () => {
  test("vocab:first is claimed once, even by two pages at once; celebrate follows the setting", async () => {
    const bg = loadBackground();
    const [a, b] = await Promise.all([bg.send({ type: "celebrations.claim", key: "vocab:first" }), bg.send({ type: "celebrations.claim", key: "vocab:first" })]);
    assert.deepEqual([a.claimed, b.claimed].sort(), [false, true]);
    assert.equal((a.claimed ? a : b).celebrate, true);
    assert.ok(bg.store.celebrations.done["vocab:first"]);
    const off = loadBackground({ local: { prefs: { celebrations: false } } });
    assert.deepEqual(plain(await off.send({ type: "celebrations.claim", key: "vocab:first" })), { claimed: true, reason: null, celebrate: false });
    assert.deepEqual(plain(await bg.send({ type: "celebrations.claim", key: "nope" })).error.code, "invalid_message");
  });

  test("the first word saved anywhere (here, the popup's add) finishes the first run", async () => {
    const bg = loadBackground({ local: { onboarding: { completedAt: null, skipped: false, version: 2 }, baseLangs: ["en"] } });
    await bg.k.ready();
    const r = await bg.send({ type: "add", text: "ありがとう = thanks" }, { id: EXT_ID, url: `chrome-extension://${EXT_ID}/popup.html` });
    assert.equal(r.ok, true);
    await bg.until(() => bg.store.onboarding?.completedAt);
    assert.equal(bg.store.onboarding.skipped, false);
    assert.deepEqual(bg.fetches, []);
  });
});
