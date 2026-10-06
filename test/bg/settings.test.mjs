// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// SCR-448 in the real background.js (vm, fake chrome, fake-indexeddb): content scripts can
// write storage.local and storage.sync (Firefox has no way to stop them), so the background
// keeps the real copy of every setting and of the add queue in its own store, and
// storage.local is only a mirror it puts back. One test per thing a subverted content script
// could do before: turn Kotiko off, pause sites, hide languages; edit the pages' word list;
// queue an add; change the bases the server's bot uses; pick another model or data policy.
// And Kotiko's pages still can change what they could.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { startFixtureServer } from "../helpers/fixture-server.mjs";
import { runInVm, sleep } from "../helpers/load-script.mjs";
import { IDBFactory } from "fake-indexeddb";

const EXT_ID = "fake-extension-id";
const PAGE = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/dashboard.html`, tab: { id: 3, url: `chrome-extension://${EXT_ID}/dashboard.html` } };
const POPUP = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/popup.html` };
const CONTENT = { id: EXT_ID, url: "https://example.com/", tab: { id: 1, url: "https://example.com/" } };
const KEY = "sk-or-v1-0123456789abcdef0123456789abcdefa1b2";
const JOB = "01900000-0000-7000-8000-00000000c0de";

const plain = (v) => JSON.parse(JSON.stringify(v));

// Every request the background makes, with its body, passed on to `next`.
function recorder(next = () => Promise.reject(new TypeError("offline"))) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    return next(url, init);
  };
  return { fetch, requests };
}

function loadBackground({ local = {}, sync = {}, fetch, indexedDB = new IDBFactory(), accessLevels = false } = {}) {
  const fake = createFakeChrome({ runtimeId: EXT_ID, local, sync, accessLevels });
  const tabs = [];
  fake.chrome.action = { setBadgeText: async ({ tabId, text }) => void tabs.push([tabId, text]), setBadgeBackgroundColor: async () => {}, setTitle: async () => {} };
  const ctx = runInVm("background.js", { chrome: fake.chrome, fetch, indexedDB });
  return {
    fake,
    k: ctx.__kotiko,
    indexedDB,
    badges: tabs,
    store: fake.store.local,
    send: (msg, sender = PAGE) => fake.deliver(msg, sender),
    // What a content script can do: write storage.local or storage.sync.
    async plant(patch, area = "local") {
      await fake.chrome.storage[area].set(patch);
      await fake.idle();
    },
    async until(fn, ms = 5000) {
      const end = Date.now() + ms;
      for (;;) {
        await fake.idle();
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error("timed out waiting");
        await sleep(10);
      }
    },
  };
}

// Waits until storage.local holds `want` for `key` again (or no key when `want` is undefined).
const putBack = (bg, key, want) => bg.until(() => JSON.stringify(bg.store[key]) === JSON.stringify(want));

describe("what a content script writes to storage.local changes nothing and is put back", () => {
  test("Kotiko off, a paused site, hidden languages: put back, and the toolbar badge never says off", async () => {
    const bg = loadBackground();
    await bg.k.ready();
    await bg.send({ type: "settings.set", set: { hiddenLangs: ["ja"] } });
    await bg.plant({ enabled: false, pausedHosts: ["example.com"], hiddenLangs: ["ru", "ja", "ar"] });
    await putBack(bg, "enabled", undefined);
    await putBack(bg, "pausedHosts", undefined);
    await putBack(bg, "hiddenLangs", ["ja"]);
    assert.deepEqual(plain(await bg.k.area.get({ enabled: true, pausedHosts: [], hiddenLangs: [] })), { enabled: true, pausedHosts: [], hiddenLangs: ["ja"] });
    assert.ok(bg.badges.every(([, text]) => text === ""), "the badge never turned off");
  });

  test("a key Kotiko doesn't keep is removed, and one it keeps but a content script removed comes back", async () => {
    const bg = loadBackground();
    await bg.k.ready();
    await bg.send({ type: "settings.set", set: { enabled: false } });
    await bg.plant({ somethingElse: "x".repeat(1000) });
    await putBack(bg, "somethingElse", undefined);
    await bg.fake.chrome.storage.local.remove("enabled");
    await putBack(bg, "enabled", false);
  });

  test("the pages' word list (words in this browser) comes back as the store has it", async () => {
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    const res = await bg.send({ type: "add", text: "犬 = dog" }, POPUP);
    await bg.until(() => bg.store.addJobs?.find((j) => j.id === res.job.id && j.state === "done"));
    const words = await bg.until(() => bg.store.words?.length === 1 && plain(bg.store.words));
    // The projection the add caused, written now.
    await bg.k.projector.flush();
    await bg.plant({ words: [{ ...words[0], id: "planted", native: "猫", gloss: "dog", forms: ["dog"] }] });
    await putBack(bg, "words", words);
  });

  test("the pages' word list from a server: a planted word never joins the cache an add or a remove rewrites", async () => {
    const srv = await startFixtureServer();
    try {
      const bg = loadBackground({ fetch: (u, i) => fetch(u, i) });
      await bg.k.ready();
      assert.equal((await bg.send({ type: "server.connect", url: srv.kotikoUrl, token: srv.token })).ok, true);
      const synced = await bg.until(() => bg.store.words?.length && plain(bg.store.words));
      await bg.plant({ words: [...synced, { id: 999_999, lang: "ru", native: "подделка", english: "fake", forms: ["fake"] }] });
      await putBack(bg, "words", synced);
      assert.ok(!(await bg.k.area.get({ words: [] })).words.some((w) => w.native === "подделка"));
    } finally {
      await srv.close();
    }
  });
});

describe("the add queue is out of content scripts' reach", () => {
  let srv;
  before(async () => {
    srv = await startFixtureServer();
  });
  after(() => srv.close());

  test("a planted add job is never looked up or saved, and is taken back out", async () => {
    const rec = recorder((u, i) => fetch(u, i));
    const bg = loadBackground({ local: { baseLangs: ["en"] }, fetch: rec.fetch });
    await bg.k.ready();
    await bg.send({ type: "backend.set", lookup: { kind: "provider", provider: "openrouter", baseUrl: srv.llmUrl } });
    await bg.send({ type: "secrets.set", id: "provider:openrouter", value: KEY });
    rec.requests.length = 0;
    const planted = { id: JOB, surface: "popup", text: "shukran", hintLang: null, baseLangs: ["en"], manual: null, state: "queued", createdAt: Date.now(), startedAt: null, attempts: 0, waits: 0, error: null, results: [], rejected: [], missingBases: [], retryAt: null, seen: false };
    await bg.plant({ addJobs: [planted] });
    // Everything that runs the queue: the alarm, a wake, a worker start.
    await bg.fake.fireAlarm("kotiko-sync");
    await bg.k.queue.kick();
    await bg.k.queue.resume();
    await putBack(bg, "addJobs", undefined);
    // Nothing started: the queue reads only its own copy, which has no job.
    assert.equal(bg.k.queue.running(), 0);
    assert.equal(await bg.k.queue.busy(), false);
    assert.deepEqual(rec.requests.filter((r) => r.url.includes("/chat/completions")), [], "no lookup spent");
    assert.deepEqual(plain(await (await bg.k.getStore()).list()), [], "no word saved");
    assert.deepEqual(plain((await bg.k.area.get({ addJobs: [] })).addJobs), []);
  });

  test("a content script can't add one by message either", async () => {
    const bg = loadBackground();
    await bg.k.ready();
    assert.deepEqual(await bg.send({ type: "add", text: "shukran" }, CONTENT), { error: { code: "forbidden" } });
    assert.deepEqual(await bg.send({ type: "settings.set", set: { addJobs: [] } }, PAGE), { error: "addJobs can't be changed here", code: "invalid_message" });
  });
});

describe("the bases your server's bot uses (slice 41 §9)", () => {
  test("bases planted in storage.local and storage.sync are never sent as the profile", async () => {
    const srv = await startFixtureServer();
    try {
      const rec = recorder((u, i) => fetch(u, i));
      const bg = loadBackground({ fetch: rec.fetch });
      await bg.k.ready();
      await bg.send({ type: "settings.set", merge: { ui: { baseLangs: ["es"], uiLang: "auto" } } });
      await bg.send({ type: "server.connect", url: srv.kotikoUrl, token: srv.token });
      await bg.until(() => srv.state.profile?.base_langs?.join() === "es");
      // Firefox: a content script writes both copies, then asks for a sync (which it may).
      await bg.plant({ ui: { uiLang: "ru", baseLangs: ["ru"] } }, "sync");
      await bg.plant({ ui: { uiLang: "ru", baseLangs: ["ru"] }, baseLangs: ["ru"] });
      await bg.send({ type: "sync", force: true }, CONTENT);
      await putBack(bg, "baseLangs", ["es"]);
      await bg.send({ type: "sync", force: true }, CONTENT);
      await bg.fake.idle();
      const sent = rec.requests.filter((r) => r.url.endsWith("/api/v1/profile") && r.method === "PUT").map((r) => r.body);
      assert.ok(sent.length >= 1);
      assert.ok(sent.every((b) => b.base_langs.join() === "es" && b.ui_lang === null), JSON.stringify(sent));
      assert.deepEqual(plain(srv.state.profile.base_langs), ["es"]);
      assert.equal(await bg.k.currentBases().then((b) => b.join()), "es");
    } finally {
      await srv.close();
    }
  });

  test("Chrome 140+: storage.sync is closed to content scripts, so another browser's change is taken; Firefox: it isn't", async () => {
    const chrome = loadBackground({ accessLevels: true });
    await chrome.k.ready();
    await chrome.until(() => chrome.fake.calls.accessLevel.length);
    assert.deepEqual(chrome.fake.calls.accessLevel, [{ area: "sync", accessLevel: "TRUSTED_CONTEXTS" }], "storage.local stays readable for content scripts");
    await chrome.plant({ ui: { uiLang: "auto", baseLangs: ["de"] } }, "sync");
    await chrome.until(async () => (await chrome.k.currentBases()).join() === "de");
    assert.deepEqual(plain(chrome.store.baseLangs), ["de"]);

    const firefox = loadBackground();
    await firefox.k.ready();
    const own = (await firefox.k.currentBases()).join();
    await firefox.plant({ ui: { uiLang: "auto", baseLangs: ["de"] } }, "sync");
    // The listener's own call, awaited: it takes nothing.
    await firefox.k.adoptSync({ ui: { newValue: { uiLang: "auto", baseLangs: ["de"] } } });
    assert.equal((await firefox.k.currentBases()).join(), own);
  });
});

describe("the lookup settings", () => {
  let srv;
  before(async () => {
    srv = await startFixtureServer();
  });
  after(() => srv.close());

  test("a planted model, data policy, lookup kind or words home is never used", async () => {
    const rec = recorder((u, i) => fetch(u, i));
    const bg = loadBackground({ local: { baseLangs: ["en"] }, fetch: rec.fetch });
    await bg.k.ready();
    await bg.send({ type: "backend.set", lookup: { kind: "provider", provider: "openrouter", baseUrl: srv.llmUrl, model: "fake/model-a:free", dataCollection: "deny" } });
    await bg.send({ type: "secrets.set", id: "provider:openrouter", value: KEY });
    const trusted = plain(bg.store.lookup);
    await bg.plant({ lookup: { ...trusted, model: "expensive/model", dataCollection: "allow" }, wordsHome: "server" });
    await putBack(bg, "lookup", trusted);
    await putBack(bg, "wordsHome", "local");
    rec.requests.length = 0;
    const res = await bg.send({ type: "add", text: "shukran" }, POPUP);
    await bg.until(() => bg.store.addJobs?.find((j) => j.id === res.job.id && ["done", "failed"].includes(j.state)), 20_000);
    const chats = rec.requests.filter((r) => r.url.endsWith("/chat/completions"));
    assert.ok(chats.length >= 1);
    assert.ok(chats.every((r) => r.body.model !== "expensive/model" && r.body.provider?.data_collection === "deny"), JSON.stringify(chats.map((r) => [r.body.model, r.body.provider])));
    assert.equal((await (await bg.k.getStore()).list()).length >= 1, true, "saved in this browser, not sent to a server");
  });
});

describe("Kotiko's pages change settings through the background", () => {
  test("set, merge, add and remove, each checked; the mirror follows", async () => {
    const bg = loadBackground();
    await bg.k.ready();
    assert.deepEqual(await bg.send({ type: "settings.set", set: { enabled: false }, add: { pausedHosts: ["a.example", "b.example"], hiddenLangs: ["ja"] } }, POPUP), { ok: true });
    assert.deepEqual(await bg.send({ type: "settings.set", remove: { pausedHosts: ["a.example"] }, merge: { prefs: { theme: "dark" }, speech: { allowOnline: true } } }), { ok: true });
    assert.deepEqual(await bg.send({ type: "settings.set", add: { "prefs.sensitiveAllowed": ["bank.example"] } }), { ok: true });
    await bg.fake.idle();
    assert.deepEqual(plain(await bg.k.area.get(["enabled", "pausedHosts", "hiddenLangs", "prefs", "speech"])), { enabled: false, pausedHosts: ["b.example"], hiddenLangs: ["ja"], prefs: { theme: "dark", sensitiveAllowed: ["bank.example"] }, speech: { allowOnline: true } });
    for (const k of ["enabled", "pausedHosts", "hiddenLangs", "prefs", "speech"]) assert.deepEqual(plain(bg.store[k]), plain((await bg.k.area.get(k))[k]), k);
  });

  test("bases and the interface language: the trusted copy, the pages' copy and storage.sync", async () => {
    const bg = loadBackground();
    await bg.k.ready();
    assert.deepEqual(await bg.send({ type: "settings.set", merge: { ui: { baseLangs: ["es", "en"], uiLang: "es", baseLangsConfirmed: true } } }), { ok: true });
    await bg.fake.idle();
    assert.deepEqual(plain(bg.store.baseLangs), ["es", "en"]);
    assert.deepEqual(plain(bg.fake.store.sync.ui), plain(bg.store.ui));
    assert.equal(bg.store.ui.uiLang, "es");
  });

  test("what they may not change, or not in that shape, is refused and nothing is written", async () => {
    const bg = loadBackground();
    await bg.k.ready();
    const refused = async (change) => {
      const r = await bg.send({ type: "settings.set", ...change });
      assert.equal(r.code, "invalid_message", JSON.stringify(change));
    };
    for (const k of ["lookup", "server", "wordsHome", "keys", "words", "addJobs", "seedSalt", "celebrations", "recentlyDeleted", "token"]) await refused({ set: { [k]: null } });
    await refused({ set: { enabled: "no" } });
    await refused({ set: { baseLangs: [] } });
    await refused({ set: { baseLangs: ["en", "es", "fr", "de", "it"] } });
    await refused({ add: { hiddenLangs: ["not a tag"] } });
    await refused({ merge: { enabled: { a: 1 } } });
    await refused({ add: { enabled: ["x"] } });
    await refused({ add: { "prefs.theme": ["x"] } });
    await refused({ merge: { ui: { token: "x" } } });
    await refused({ set: { prefs: { blob: "x".repeat(70_000) } } });
    assert.deepEqual(await bg.send({ type: "settings.set" }), { error: { code: "invalid_message", message: "nothing to change" } });
    assert.deepEqual(await bg.send({ type: "settings.set", set: { enabled: false } }, CONTENT), { error: { code: "forbidden" } });
    assert.equal("enabled" in bg.store, false);
  });

  test("the word card's \"Don't swap this word\" is the one change a content script may ask for", async () => {
    const bg = loadBackground();
    await bg.k.ready();
    await bg.send({ type: "settings.set", merge: { prefs: { theme: "dark" } } });
    assert.deepEqual(await bg.send({ type: "neverSwap", key: "кот", on: true }, CONTENT), { ok: true });
    await bg.fake.idle();
    assert.deepEqual(plain(bg.store.prefs), { theme: "dark", neverSwap: ["кот"] });
    assert.deepEqual(await bg.send({ type: "neverSwap", key: "кот", on: false }, CONTENT), { ok: true });
    await bg.fake.idle();
    assert.deepEqual(plain(bg.store.prefs.neverSwap), []);
    assert.equal((await bg.send({ type: "neverSwap", key: "", on: true }, CONTENT)).error.code, "invalid_message");
  });

  test("a backup's settings: the background applies what lib/backup.js takes from it", async () => {
    const bg = loadBackground();
    await bg.k.ready();
    await bg.send({ type: "backend.set", lookup: { kind: "provider", provider: "openrouter", model: "a/b" } });
    const r = await bg.send({ type: "settings.restore", settings: { enabled: false, hiddenLangs: ["hy"], prefs: { theme: "dark" }, ui: { baseLangs: ["fr"], uiLang: "fr" }, lookup: { provider: "openai", baseUrl: "https://evil.example/v1", model: "x/y", dataCollection: "deny" }, server: { url: "https://evil.example" } } });
    assert.deepEqual(r, { ok: true });
    await bg.fake.idle();
    assert.equal(bg.store.enabled, false);
    assert.deepEqual(plain(bg.store.hiddenLangs), ["hy"]);
    assert.deepEqual(plain(bg.store.baseLangs), ["fr"]);
    assert.equal(bg.store.ui.uiLang, "fr");
    assert.deepEqual([bg.store.lookup.provider, bg.store.lookup.baseUrl, bg.store.lookup.model, bg.store.lookup.dataCollection], ["openrouter", null, "a/b", "deny"], "never where requests go");
    assert.notEqual(bg.store.server?.url, "https://evil.example");
    assert.equal((await bg.send({ type: "settings.restore", settings: [] })).error.code, "invalid_message");
  });
});

describe("installs and upgrades", () => {
  // An install from before SCR-448: its store exists (schema 1), but nothing in it is the
  // trusted copy yet. `routes: false` is one from before slice 28 too.
  async function olderInstall({ local, routes = true }) {
    const indexedDB = new IDBFactory();
    const first = loadBackground({ indexedDB });
    await first.k.ready();
    const store = await first.k.getStore();
    const rows = await store.meta.entries("area:");
    await store.meta.write([], rows.map((r) => r.key));
    await store.meta.remove("settingsTrusted");
    if (!routes) for (const k of ["routesBound", "route:server", "route:lookupProvider"]) await store.meta.remove(k);
    store.close();
    return loadBackground({ indexedDB, local });
  }

  test("an install from before keeps every setting and its queue, once, then trusts only its own copy", async () => {
    const jobs = [{ id: JOB, surface: "popup", text: "кот = cat", state: "done", createdAt: 1, results: [] }];
    const bg = await olderInstall({ local: { enabled: false, pausedHosts: ["a.example"], prefs: { theme: "dark" }, addJobs: jobs, wordsHome: "local", baseLangs: ["en"], somethingElse: 1 } });
    await bg.k.ready();
    assert.deepEqual(plain(await bg.k.area.get(["enabled", "pausedHosts", "prefs", "addJobs", "baseLangs"])), { enabled: false, pausedHosts: ["a.example"], prefs: { theme: "dark" }, addJobs: jobs, baseLangs: ["en"] });
    await putBack(bg, "somethingElse", undefined);
    await bg.plant({ enabled: true });
    await putBack(bg, "enabled", false);
  });

  test("from before slice 28: an address no page could have set for a hosted service is dropped; a local service's is kept", async () => {
    const hosted = await olderInstall({ routes: false, local: { wordsHome: "local", lookup: { kind: "provider", provider: "openai", baseUrl: "https://evil.example/v1", model: null, dataCollection: "allow" } } });
    await hosted.k.ready();
    assert.equal(hosted.store.lookup.baseUrl, null);
    assert.equal(hosted.store.lookup.provider, "openai");
    const local = await olderInstall({ routes: false, local: { wordsHome: "local", lookup: { kind: "provider", provider: "ollama", baseUrl: "http://192.168.1.5:11434/v1", model: null, dataCollection: "allow" } } });
    await local.k.ready();
    assert.equal(local.store.lookup.baseUrl, "http://192.168.1.5:11434/v1");
    assert.equal(await (await local.k.getStore()).meta.get("route:lookup:ollama"), "http://192.168.1.5:11434/v1");
  });

  test("a new install takes nothing a content script wrote first, not even with a planted 0.2 token", async () => {
    const bg = loadBackground({ local: { token: "planted-token", serverUrl: "https://evil.example", enabled: false, pausedHosts: ["a.example"], addJobs: [{ id: JOB, text: "x", state: "queued" }], lookup: { kind: "provider", provider: "custom", baseUrl: "https://evil.example/v1" } } });
    await bg.fake.fireInstalled({ reason: "install" });
    await bg.until(async () => (await (await bg.k.getStore()).meta.get("migratedFrom")) === "new");
    await bg.until(() => bg.store.enabled === undefined && bg.store.addJobs === undefined && bg.store.token === undefined);
    assert.deepEqual(plain(await bg.k.area.get({ enabled: true, pausedHosts: [], addJobs: [] })), { enabled: true, pausedHosts: [], addJobs: [] });
    assert.equal(bg.store.lookup.baseUrl, null);
    assert.equal(await (await bg.k.getStore()).meta.get("route:lookup:custom"), null);
    assert.deepEqual(plain(await (await bg.k.getStore()).secrets.ids()), []);
  });
});
