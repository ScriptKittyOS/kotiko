// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 11 in the real background.js (vm, fake chrome, fake-indexeddb): a fresh install
// keeps words in this browser and looks them up with the learner's own provider (the
// fixture server's fake model); secrets stay out of every storage area; privileged
// messages refuse content scripts; existing server installs upgrade with nothing changed;
// words move between this browser and a server in both directions.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { startFixtureServer, uuidFor } from "../helpers/fixture-server.mjs";
import { runInVm, sleep } from "../helpers/load-script.mjs";

const EXT_ID = "fake-extension-id";
const PAGE = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/dashboard.html`, tab: { id: 3, url: `chrome-extension://${EXT_ID}/dashboard.html` } };
const POPUP = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/popup.html` };
const CONTENT = { id: EXT_ID, url: "https://example.com/", tab: { id: 1, url: "https://example.com/" } };
const KEY = "sk-or-v1-0123456789abcdef0123456789abcdefa1b2";

const LEGACY_WORDS = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  lang: "ru",
  language: "Russian",
  native: `кот${i + 1}`,
  romanization: `kot${i + 1}`,
  english: `word${i + 1}`,
  forms: [`word${i + 1}`],
  note: null,
}));

function loadBackground({ local = {}, sync = {}, fetch: f = fetch, wiktionary } = {}) {
  const fake = createFakeChrome({ runtimeId: EXT_ID, local, sync });
  const ctx = runInVm("background.js", { chrome: fake.chrome, fetch: f, wiktionary });
  const k = ctx.__kotiko;
  return {
    fake,
    ctx,
    k,
    store: fake.store.local,
    send: (msg, sender = PAGE) => fake.deliver(msg, sender),
    // Waits until `fn()` is truthy (the background works on its own schedule).
    async until(fn, ms = 5000) {
      const end = Date.now() + ms;
      for (;;) {
        await fake.idle();
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error("timed out waiting");
        await sleep(20);
      }
    },
  };
}

// Values made in the vm's realm, as plain objects of this one (for deepStrictEqual).
const plain = (v) => JSON.parse(JSON.stringify(v));

// Every string any storage area holds, for the secrets checks.
const everything = (fake) => JSON.stringify([fake.store.local, fake.store.sync, fake.store.session]);

describe("a fresh install keeps words in this browser (slice 11)", () => {
  let srv;
  before(async () => {
    srv = await startFixtureServer();
  });
  after(() => srv.close());

  test("is local with no lookups; a manual 'native = meaning' add needs no network at all", async () => {
    const requests = [];
    const bg = loadBackground({ local: { baseLangs: ["es"] }, fetch: (url) => (requests.push(String(url)), Promise.reject(new TypeError("offline"))) });
    await bg.k.ready();
    assert.equal(bg.store.wordsHome, "local");
    assert.equal(bg.store.lookup.kind, "none");
    const res = await bg.send({ type: "add", text: "犬 = perro" }, POPUP);
    assert.equal(res.ok, true);
    const job = await bg.until(() => bg.store.addJobs?.find((j) => j.id === res.job.id && j.state === "done"));
    assert.equal(job.results[0].result, "created");
    assert.deepEqual([job.results[0].word.lang, job.results[0].word.native, job.results[0].word.gloss, job.results[0].word.base_lang, job.results[0].word.origin], ["zh", "犬", "perro", "es", "manual"]);
    const words = await bg.until(() => bg.store.words?.length && bg.store.words);
    assert.deepEqual(words.map((w) => [w.native, w.forms]), [["犬", ["perro"]]]);
    assert.equal(bg.store.wordsVersion.n >= 1, true);
    assert.deepEqual(requests, [], "no network request at all");
  });

  test("a word that needs a lookup waits for one to be set up, then completes once a key is saved", async () => {
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    const res = await bg.send({ type: "add", text: "shukran" }, POPUP);
    const waiting = await bg.until(() => bg.store.addJobs?.find((j) => j.id === res.job.id && j.state === "waiting"));
    assert.equal(waiting.error.code, "lookup_not_set_up");
    assert.equal(waiting.retryAt, null, "waits for a provider, not a timer");
    await bg.send({ type: "backend.set", lookup: { kind: "provider", provider: "openrouter", baseUrl: srv.llmUrl } });
    assert.deepEqual(await bg.send({ type: "secrets.set", id: "provider:openrouter", value: KEY }), { ok: true, masked: "sk-or-…a1b2" });
    const done = await bg.until(() => bg.store.addJobs?.find((j) => j.id === res.job.id && j.state === "done"));
    assert.equal(done.results[0].word.native, "شكرا");
    assert.equal(done.results[0].word.gloss, "thanks");
    await bg.until(() => bg.store.words?.some((w) => w.native === "شكرا"));
    const chat = srv.state.log.filter((r) => r.path === "/llm/v1/chat/completions");
    assert.ok(chat.length >= 1 && chat.every((r) => r.auth === `Bearer ${KEY}`));
  });

  test("a word added with the learner's own AI gets its pronunciation from Wiktionary (slice 49 §4a)", async () => {
    const asked = [];
    const page = '<h2>Arabic</h2><h3>Pronunciation</h3><span class="IPA">/ʃukˈran/</span><h3>Noun</h3>';
    const bg = loadBackground({ local: { baseLangs: ["en"] }, wiktionary: (url) => (asked.push(url), new Response(page)) });
    await bg.k.ready();
    await bg.send({ type: "backend.set", lookup: { kind: "provider", provider: "openrouter", baseUrl: srv.llmUrl } });
    await bg.send({ type: "secrets.set", id: "provider:openrouter", value: KEY });
    const res = await bg.send({ type: "add", text: "shukran" }, POPUP);
    const done = await bg.until(() => bg.store.addJobs?.find((j) => j.id === res.job.id && j.state === "done"));
    assert.deepEqual([done.results[0].word.pronunciation, done.results[0].word.pronunciation_source], ["shook-RAN", "wiktionary"]);
    assert.deepEqual(asked, ["https://en.wiktionary.org/w/rest.php/v1/page/%D8%B4%D9%83%D8%B1%D8%A7/html"]);
  });

  test("the same job applied twice saves the word once (worker restart, slice 24 idempotency)", async () => {
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    const store = await bg.k.getStore();
    const word = { lang: "ru", native: "кот", base_lang: "en", gloss: "cat", forms: [{ text: "cat" }] };
    const a = await store.upsertByNatural([word], { jobId: "job-1" });
    const b = await store.upsertByNatural([{ ...word, note: "changed" }], { jobId: "job-1" });
    assert.equal(a.applied, false);
    assert.equal(b.applied, true);
    assert.deepEqual(plain(b.results), plain(a.results));
    assert.equal((await store.list()).length, 1);
    assert.equal((await store.list())[0].note, null);
  });

  test("a job left looking up by a stopped worker runs again with the same id and saves once", async () => {
    const id = "01900000-0000-7000-8000-00000000abcd";
    const local = {
      baseLangs: ["en"],
      wordsHome: "local",
      lookup: { kind: "provider", provider: "openrouter", baseUrl: srv.llmUrl, model: null, dataCollection: "allow" },
      addJobs: [{ id, surface: "popup", text: "sobaka", hintLang: null, baseLangs: ["en"], manual: null, state: "looking_up", createdAt: Date.now() - 1000, startedAt: Date.now() - 900, attempts: 1, waits: 0, error: null, results: [], rejected: [], missingBases: [], retryAt: null, seen: false }],
    };
    const bg = loadBackground({ local });
    await bg.k.ready();
    await bg.send({ type: "secrets.set", id: "provider:openrouter", value: KEY });
    const done = await bg.until(() => bg.store.addJobs?.find((j) => j.id === id && j.state === "done"));
    assert.equal(done.results.length, 1);
    assert.equal(done.results[0].word.native, "собака");
    const store = await bg.k.getStore();
    assert.equal((await store.list()).filter((w) => w.native === "собака").length, 1);
  });

  test("with bases es and en, 犬 keeps two records in one group and never merges across bases", async () => {
    const bg = loadBackground({ local: { baseLangs: ["es", "en"] } });
    await bg.k.ready();
    const store = await bg.k.getStore();
    await store.upsertByNatural([{ lang: "ja", native: "犬", base_lang: "es", gloss: "perro", forms: [{ text: "perro" }] }]);
    await store.upsertByNatural([{ lang: "ja", native: "犬", base_lang: "en", gloss: "dog", forms: [{ text: "dog" }] }]);
    const all = await store.list();
    assert.deepEqual(all.map((w) => [w.base_lang, w.gloss]).sort(), [["en", "dog"], ["es", "perro"]]);
    const group = await store.tx("words", "readonly", ({ words }) => new Promise((r) => {
      const q = words.index("group").getAll(["ja", "犬"]);
      q.onsuccess = () => r(q.result);
    }));
    assert.equal(group.length, 2);
    await bg.k.projector.flush();
    assert.deepEqual(bg.store.words.map((w) => w.base_lang).sort(), ["en", "es"]);
    // Removing en drops its records from the projection and keeps them in the store.
    await bg.fake.chrome.storage.local.set({ baseLangs: ["es"] });
    await bg.until(() => bg.store.words.length === 1);
    assert.equal(bg.store.words[0].gloss, "perro");
    assert.equal((await store.list()).length, 2);
    await bg.fake.chrome.storage.local.set({ baseLangs: ["es", "en"] });
    await bg.until(() => bg.store.words.length === 2);
  });

  test("a re-add merges into the word and keeps what the learner wrote", async () => {
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    const store = await bg.k.getStore();
    const [{ word }] = (await store.upsertByNatural([{ lang: "ru", native: "Дом", base_lang: "en", gloss: "house", forms: [{ text: "house" }], note: "Mine." }])).results;
    const again = await store.upsertByNatural([{ lang: "ru", native: "дом", base_lang: "en", gloss: "home", forms: [{ text: "home" }], note: "Model.", romanization: "dom" }]);
    assert.equal(again.results[0].result, "updated");
    assert.equal(again.results[0].word.id, word.id);
    assert.equal(again.results[0].word.note, "Mine.");
    assert.equal(again.results[0].word.romanization, "dom");
    assert.deepEqual(plain(again.results[0].word.forms.map((f) => f.text)), ["house", "home"]);
    // A tombstoned word doesn't block a new one with the same key.
    await store.remove(word.id);
    const fresh = await store.upsertByNatural([{ lang: "ru", native: "дом", base_lang: "en", gloss: "house", forms: [{ text: "house" }] }]);
    assert.equal(fresh.results[0].result, "created");
    assert.notEqual(fresh.results[0].word.id, word.id);
    assert.equal((await store.restore(word.id)).code, "word_conflict");
  });

  test("the dashboard's routes read and write the store (slice 21's protocol)", async () => {
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    const saved = await bg.send({ type: "words.save", words: [{ lang: "ru", native: "кошка", base_lang: "en", gloss: "cat", forms: ["cat", "cats"] }], client_request_id: "c1", clientId: "dash-1" });
    assert.equal(saved.results[0].result, "created");
    const id = saved.results[0].word.id;
    const list = await bg.send({ type: "words.list" });
    assert.deepEqual(list.words.map((w) => w.native), ["кошка"]);
    assert.deepEqual(list.words[0].forms.map((f) => f.text), ["cat", "cats"]);
    assert.equal("native_key" in list.words[0], false, "native_key is for indexing only");
    const stale = await bg.send({ type: "words.write", ops: [{ op: "patch", id, patch: { note: "x" }, if_updated_at: "2000-01-01T00:00:00.000Z" }] });
    assert.equal(stale.results[0].code, "word_conflict");
    const ok = await bg.send({ type: "words.write", ops: [{ op: "patch", id, patch: { note: "Feminine." }, if_updated_at: list.words[0].updated_at }], clientId: "dash-1" });
    assert.equal(ok.results[0].ok, true);
    assert.equal(ok.results[0].word.note, "Feminine.");
    const latin = await bg.send({ type: "words.write", ops: [{ op: "patch", id, patch: { lang: "en" } }] });
    assert.deepEqual([latin.results[0].code, latin.results[0].details.reason], ["invalid_word", "script_mismatch"]);
    const gato = (await bg.send({ type: "words.save", words: [{ lang: "es", native: "gato", base_lang: "en", gloss: "cat" }] })).results[0].word;
    const bad = await bg.send({ type: "words.write", ops: [{ op: "patch", id: gato.id, patch: { lang: "en" } }] });
    assert.deepEqual([bad.results[0].code, bad.results[0].details.reason], ["invalid_word", "target_is_base"]);
    const pron = await bg.send({ type: "words.write", ops: [{ op: "patch", id, patch: { pronunciation: "KOSH-KA" } }] });
    assert.equal(pron.results[0].code, "invalid_word");
    const del = await bg.send({ type: "words.write", ops: [{ op: "delete", id }], clientId: "dash-1" });
    assert.equal(del.results[0].ok, true);
    assert.deepEqual((await bg.send({ type: "words.deleted" })).entries.map((e) => e.id), [id]);
    assert.equal((await bg.send({ type: "words.write", ops: [{ op: "restore", id }] })).results[0].ok, true);
    assert.equal(bg.store.wordsVersion.by !== undefined, true);
    const preview = await bg.send({ type: "words.preview", text: "gato = cat", base_langs: ["en"], hint_lang: "es" });
    assert.deepEqual(preview.candidates.map((c) => [c.lang, c.native, c.gloss]), [["es", "gato", "cat"]]);
    // Saved without a pronunciation, for a base with a respelling key: the refresh has two
    // words to do and waits for a provider (slice 07 section 8).
    assert.deepEqual(await bg.send({ type: "job.refresh" }), { state: "waiting", done: 0, total: 2 });
    assert.equal((await bg.send({ type: "job.refresh", action: "pause" })).state, "paused");
    assert.equal((await bg.send({ type: "job.refresh", action: "resume" })).state, "waiting");
    await bg.send({ type: "job.refresh", action: "pause" });
    await bg.send({ type: "backend.set", lookup: { kind: "provider", provider: "ollama" } });
    assert.equal((await bg.send({ type: "job.refresh" })).state, "paused", "a provider: no longer waiting for one");
  });

  test("the provider's errors become slice 25 codes on the job, and quota waits until the reset", async () => {
    srv.reset();
    const bg = loadBackground({ local: { baseLangs: ["en"], wordsHome: "local", lookup: { kind: "provider", provider: "openrouter", baseUrl: srv.llmUrl } } });
    await bg.k.ready();
    await bg.send({ type: "secrets.set", id: "provider:openrouter", value: KEY });
    srv.state.llmRemaining = 0;
    await bg.k.client.refreshQuota();
    const res = await bg.send({ type: "add", text: "kniga" }, POPUP);
    const job = await bg.until(() => bg.store.addJobs?.find((j) => j.id === res.job.id && j.state === "waiting"));
    assert.equal(job.error.code, "quota_exhausted");
    assert.ok(Date.parse(job.error.details.retry_at) > Date.now());
    assert.equal(job.retryAt, Date.parse(job.error.details.retry_at));
    assert.equal(srv.state.log.filter((r) => r.path === "/llm/v1/chat/completions").length, 0, "no model call with nothing left");
    assert.equal(bg.store.lookupStatus.quota.remaining, 0);
    srv.state.llmRemaining = null;
  });
});

describe("secrets (slice 11 §3)", () => {
  test("the key and the server token are in no storage area a content script can read", async () => {
    const bg = loadBackground({ local: { serverUrl: "http://127.0.0.1:4999", token: "server-token-0123456789abcdef", words: [] }, fetch: () => Promise.reject(new TypeError("offline")) });
    await bg.k.ready();
    await bg.send({ type: "secrets.set", id: "provider:openrouter", value: KEY });
    await bg.fake.idle();
    const all = everything(bg.fake);
    assert.doesNotMatch(all, /server-token-0123456789abcdef/);
    assert.doesNotMatch(all, /sk-or-v1-0123456789abcdef/);
    assert.equal(bg.store.token, undefined);
    assert.deepEqual(bg.store.keys, { server: true, providers: { openrouter: true } });
    assert.deepEqual(await bg.send({ type: "secrets.describe" }), { secrets: { server: "server…cdef", "provider:openrouter": "sk-or-…a1b2" } });
  });

  test("content scripts can't set, describe or remove secrets, change modes, write words or move them", async () => {
    const bg = loadBackground({ local: {} });
    await bg.k.ready();
    const privileged = [
      { type: "secrets.set", id: "provider:openrouter", value: "stolen" },
      { type: "secrets.describe" },
      { type: "secrets.remove", id: "server" },
      { type: "backend.get" },
      { type: "backend.set", lookup: { kind: "none" } },
      { type: "backend.test" },
      { type: "server.connect", url: "http://evil.example", token: "x" },
      { type: "migrate.preview", to: "server" },
      { type: "migrate.run", to: "server" },
      { type: "words.write", ops: [{ op: "delete", id: "x" }] },
      { type: "words.save", words: [{ lang: "ru", native: "a", base_lang: "en", gloss: "a" }] },
      { type: "add", text: "x" },
      { type: "remove", id: "x" },
      { type: "jobs.retry", id: "01900000-0000-7000-8000-000000000001" },
      { type: "oauth.start" },
    ];
    for (const msg of privileged) assert.deepEqual(await bg.send(msg, CONTENT), { error: { code: "forbidden" } }, msg.type);
    // `oauth.code` is accepted only from the docs site's callback page.
    assert.deepEqual(await bg.send({ type: "oauth.code", code: "c" }, CONTENT), { error: { code: "forbidden" } });
    assert.deepEqual(await bg.send({ type: "sync" }, CONTENT), { ok: true }, "content scripts may still sync (a no-op here)");
    assert.equal(bg.store.lookup.kind, "none");
    assert.deepEqual(await (await bg.k.getStore()).secrets.ids(), []);
  });

  test("bad secret ids and values are refused", async () => {
    const bg = loadBackground({ local: {} });
    await bg.k.ready();
    for (const msg of [{ id: "pkce:pending", value: "x" }, { id: "provider:openrouter", value: "" }, { id: "provider:openrouter", value: "two words" }, { id: "provider:openrouter" }]) {
      const res = await bg.send({ type: "secrets.set", ...msg });
      assert.equal(res.error.code, "invalid_message", JSON.stringify(msg));
    }
  });
});

describe("upgrading an existing install (slice 11 §8)", () => {
  let srv;
  before(async () => {
    srv = await startFixtureServer();
  });
  after(() => srv.close());

  test("a server install stays a server install: same words on pages, same requests, the token leaves storage.local", async () => {
    srv.reset();
    await fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify({ words: LEGACY_WORDS }) });
    const before = { serverUrl: srv.kotikoUrl, token: srv.token, words: LEGACY_WORDS, enabled: true, hiddenLangs: [], lastSync: 1 };
    const bg = loadBackground({ local: before });
    bg.fake.fireInstalled({ reason: "update" });
    await bg.k.ready();
    await bg.until(() => bg.store.lastSync > 1);
    assert.equal(bg.store.token, undefined);
    assert.equal(bg.store.serverUrl, undefined);
    assert.equal(bg.store.wordsHome, "server");
    assert.equal(bg.store.lookup.kind, "server");
    assert.deepEqual(bg.store.server, { url: srv.kotikoUrl });
    // Slice 50's upgrade rule: the browser's languages, plus the base every old word has.
    await bg.until(() => bg.store.baseLangs);
    assert.deepEqual([...bg.store.baseLangs], ["en"]);
    assert.deepEqual(bg.store.words, LEGACY_WORDS, "the pages' list is the server's, byte for byte");
    // The 50 cached words are also in the store, for a later move into this browser.
    assert.equal((await (await bg.k.getStore()).list()).length, 50);
    // Adds go to the server, which looks the word up and keeps it, through the add queue
    // (slice 24): its lookup, then the save under the job's id.
    const res = await bg.send({ type: "add", text: "sobaka" }, POPUP);
    const job = await bg.until(() => bg.store.addJobs?.find((j) => j.id === res.job.id && j.state === "done"));
    assert.equal(job.results[0].word.native, "собака");
    assert.ok(srv.state.log.some((r) => r.method === "POST" && r.path === "/kotiko/api/v1/words" && r.auth === `Bearer ${srv.token}`));
    assert.ok(srv.state.log.some((r) => r.method === "POST" && r.path === "/kotiko/api/v1/words/batch"));
    assert.equal(srv.state.log.filter((r) => r.path.startsWith("/llm/")).length, 0, "no model asked from this browser");
    await bg.until(() => bg.store.words.some((w) => w.native === "собака"));
  });

  test("the upgrade resumes after an interruption and is idempotent", async () => {
    const local = { serverUrl: "http://127.0.0.1:4999", token: "tok-0123456789", words: LEGACY_WORDS.slice(0, 3) };
    const fake = createFakeChrome({ runtimeId: EXT_ID, local });
    const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");
    const idb = new IDBFactory();
    // Stop after step 2: the token is copied, storage.local still has it, no schema.
    const first = runInVm("background.js", { chrome: fake.chrome, fetch: () => Promise.reject(new TypeError("offline")), indexedDB: idb, IDBKeyRange });
    await first.__kotiko.ready();
    const store = await first.__kotiko.getStore();
    assert.equal(await store.meta.get("schema"), 1);
    await store.meta.set("schema", null);
    await fake.chrome.storage.local.set({ token: "tok-0123456789", serverUrl: "http://127.0.0.1:4999" });
    await fake.idle();
    const second = runInVm("background.js", { chrome: fake.chrome, fetch: () => Promise.reject(new TypeError("offline")), indexedDB: idb, IDBKeyRange });
    await second.__kotiko.ready();
    await fake.idle();
    assert.equal(fake.store.local.token, undefined);
    assert.equal(fake.store.local.wordsHome, "server");
    const again = await second.__kotiko.getStore();
    assert.equal((await again.list()).length, 3, "seeding twice doesn't double the words");
    assert.equal(await again.secrets.get("server"), "tok-0123456789");
  });

  test("an install without a token becomes local; its cached words keep swapping, and en joins a Spanish browser's bases", async () => {
    const fake = createFakeChrome({ runtimeId: EXT_ID, local: { words: LEGACY_WORDS.slice(0, 2) } });
    fake.chrome.i18n = { getUILanguage: () => "es-MX", getMessage: () => "" };
    const ctx = runInVm("background.js", { chrome: fake.chrome });
    await ctx.__kotiko.ready();
    for (let i = 0; i < 20 && !String(fake.store.local.words?.[0]?.id ?? "").includes("-"); i++) {
      await fake.idle();
      await sleep(30);
    }
    assert.equal(fake.store.local.wordsHome, "local");
    assert.match(fake.store.local.baseLangs[0], /^es/);
    assert.equal(fake.store.local.baseLangs.at(-1), "en");
    assert.deepEqual(fake.store.local.words.map((w) => [w.native, w.gloss, w.base_lang, w.forms]), [["кот1", "word1", "en", ["word1"]], ["кот2", "word2", "en", ["word2"]]]);
  });
});

describe("moving words (slice 11 §6)", () => {
  let srv;
  before(async () => {
    srv = await startFixtureServer();
  });
  after(() => srv.close());

  async function localWithServer(n) {
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    const store = await bg.k.getStore();
    const words = Array.from({ length: n }, (_, i) => ({ lang: "ru", native: `мир${i}`, base_lang: "en", gloss: `world${i}`, forms: [{ text: `world${i}` }] }));
    await store.upsertByNatural(words);
    const res = await bg.send({ type: "server.connect", url: srv.kotikoUrl, token: srv.token });
    assert.deepEqual([res.needsSwitch, res.count, res.wordsHome], [true, n, "local"], "connecting doesn't switch while words are here");
    return { bg, store };
  }

  test("local -> server uploads every word through the batch route, reports counts, then the server owns them", async () => {
    srv.reset();
    await fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify({ v1Words: [] }) });
    const { bg } = await localWithServer(300);
    assert.deepEqual(await bg.send({ type: "migrate.preview", to: "server" }), { to: "server", count: 300, server: srv.kotikoUrl, connected: true });
    const res = await bg.send({ type: "migrate.run", to: "server" });
    assert.deepEqual([res.ok, res.total, res.created], [true, 300, 300]);
    const batches = srv.state.log.filter((r) => r.path === "/kotiko/api/v1/words/batch");
    assert.equal(batches.length, 1);
    assert.equal(bg.store.wordsHome, "server");
    await bg.until(() => bg.store.words?.length === 300 && typeof bg.store.words[0].id === "number");
    assert.equal(srv.state.log.filter((r) => r.path.startsWith("/llm/")).length, 0, "no model calls");
  });

  test("a failure halfway leaves everything as it was: still local, every word intact", async () => {
    srv.reset();
    await fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify({ v1Words: [], failNext: { method: "POST", path: "/words/batch", status: 500, code: "internal" } }) });
    const { bg, store } = await localWithServer(300);
    const res = await bg.send({ type: "migrate.run", to: "server" });
    assert.equal(res.code, "internal");
    assert.equal(bg.store.wordsHome, "local");
    assert.equal((await store.list()).length, 300);
  });

  test("server -> local keeps every word with its id, and pages swap the same words", async () => {
    srv.reset();
    const v1 = [
      { id: uuidFor(1), lang: "ru", native: "спасибо", base_lang: "en", gloss: "thanks", forms: ["thanks", "thank you"] },
      { id: uuidFor(2), lang: "ja", native: "犬", base_lang: "es", gloss: "perro", forms: ["perro"] },
    ];
    await fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify({ v1Words: v1 }) });
    const bg = loadBackground({ local: { serverUrl: srv.kotikoUrl, token: srv.token } });
    await bg.k.ready();
    await bg.send({ type: "sync", force: true }, POPUP);
    const before = bg.store.words.map((w) => w.native).sort();
    assert.deepEqual(await bg.send({ type: "migrate.preview", to: "local" }), { to: "local", count: 2, server: srv.kotikoUrl });
    const res = await bg.send({ type: "migrate.run", to: "local", forget: true });
    assert.deepEqual(res, { ok: true, total: 2 });
    assert.equal(bg.store.wordsHome, "local");
    assert.equal(bg.store.lookup.kind, "none");
    assert.equal(bg.store.keys.server, false, "forgotten");
    const ids = (await (await bg.k.getStore()).list()).map((w) => w.id).sort();
    assert.deepEqual(ids, [uuidFor(1), uuidFor(2)]);
    assert.deepEqual(bg.store.baseLangs.slice().sort(), ["en", "es"]);
    assert.deepEqual(bg.store.words.map((w) => w.native).sort(), ["спасибо", "犬"]);
    assert.ok(before.includes("спасибо"));
    // The server's data is untouched.
    assert.equal(srv.state.v1.filter((w) => !w.deleted_at).length, 2);
  });
});
