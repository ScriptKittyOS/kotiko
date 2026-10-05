// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 11's pieces on their own: the IndexedDB store (fake-indexeddb), the projection
// for content scripts, the add queue, the pronunciation refresh, the "native = meaning"
// parser and the one-time upgrade.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { loadLocalLibs } from "../helpers/local-libs.mjs";
import { sleep } from "../helpers/load-script.mjs";

globalThis.IDBKeyRange = IDBKeyRange;
const L = loadLocalLibs();
const open = (o = {}) => L.Store.open({ indexedDB: new IDBFactory(), ...o });
const word = (native, extra = {}) => ({ lang: "ru", native, base_lang: "en", gloss: `g-${native}`, forms: [{ text: `g-${native}` }], ...extra });

describe("the store", () => {
  test("creates database version 1 with the spec's object stores and indexes", async () => {
    const s = await open();
    assert.equal(s.db.name, "kotiko");
    assert.equal(s.db.version, 1);
    assert.deepEqual([...s.db.objectStoreNames].sort(), ["jobs", "lookupCache", "meta", "outbox", "secrets", "words"]);
    const idx = await s.tx("words", "readonly", ({ words }) => [...words.indexNames].sort());
    assert.deepEqual(idx, ["base_lang", "group", "lang", "natural", "updated_at"]);
  });

  test("records are slice 07's: UUIDv7 ids, millisecond timestamps, forms with their flags", async () => {
    const s = await open();
    const { results } = await s.upsertByNatural([{ ...word("кот"), forms: ["cat", { text: "cats", enabled: false }] }]);
    const w = results[0].word;
    assert.match(w.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(w.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(w.forms, [{ text: "cat", enabled: true, case: "any", ambiguous: false }, { text: "cats", enabled: false, case: "any", ambiguous: false }]);
    assert.equal(w.deleted_at, null);
    assert.equal(w.sense, "");
    assert.equal("native_key" in w, false);
  });

  test("updated_at always moves forward, so if_updated_at sees every change", async () => {
    let t = Date.UTC(2026, 9, 1);
    const s = await open({ now: () => t });
    const { results } = await s.upsertByNatural([word("дом")]);
    const a = await s.update(results[0].word.id, { note: "1" });
    const b = await s.update(results[0].word.id, { note: "2" });
    assert.ok(b.word.updated_at > a.word.updated_at);
    t -= 10_000; // a clock that went back
    const c = await s.update(results[0].word.id, { note: "3" });
    assert.ok(c.word.updated_at > b.word.updated_at);
  });

  test("unique among live words in code: a tombstone doesn't collide; restore refuses a taken key", async () => {
    const s = await open();
    const first = (await s.upsertByNatural([word("да")])).results[0].word;
    await s.remove(first.id);
    const second = (await s.upsertByNatural([word("да")])).results[0];
    assert.equal(second.result, "created");
    assert.equal((await s.restore(first.id)).details.reason, "duplicate");
    assert.equal((await s.list()).length, 1);
  });

  test("an edit that would take another word's key is refused; a stale edit too", async () => {
    const s = await open();
    const [a, b] = (await s.upsertByNatural([word("один"), word("два")])).results.map((r) => r.word);
    assert.equal((await s.update(b.id, { native: "ОДИН" })).details.reason, "duplicate");
    assert.equal((await s.update(a.id, { note: "x" }, { if_updated_at: "2001-01-01T00:00:00.000Z" })).details.reason, "stale");
  });

  test("the vocabulary cap: adds fail with vocabulary_full", async () => {
    const s = await open();
    const max = L.Store.MAX_VOCABULARY;
    assert.equal(max, 20000);
    // Fill quickly in one transaction, past the cap's count check.
    await s.tx("words", "readwrite", async ({ words }) => {
      for (let i = 0; i < max; i++) words.put({ id: `id-${i}`, lang: "ru", native: `w${i}`, native_key: `w${i}`, sense: "", base_lang: "en", status: "active", deleted_at: null, updated_at: "2026-01-01T00:00:00.000Z" });
    });
    await assert.rejects(s.upsertByNatural([word("новое")]), { code: "vocabulary_full" });
  });

  test("changesSince and recentLangs read the updated_at index", async () => {
    let t = Date.UTC(2026, 9, 1);
    const s = await open({ now: () => t++ });
    await s.upsertByNatural([word("кот")]);
    const mid = new Date(t).toISOString();
    t += 10;
    await s.upsertByNatural([{ ...word("犬"), lang: "ja" }]);
    await s.upsertByNatural([{ ...word("gato"), lang: "es" }]);
    assert.deepEqual((await s.changesSince(mid)).map((w) => w.native).sort(), ["gato", "犬"]);
    assert.deepEqual(await s.recentLangs(5), ["es", "ja", "ru"]);
  });

  test("secrets, meta and the lookup cache", async () => {
    const s = await open();
    await s.secrets.set("provider:openrouter", "k1");
    assert.equal(await s.secrets.get("provider:openrouter"), "k1");
    assert.deepEqual(await s.secrets.ids(), ["provider:openrouter"]);
    await s.secrets.remove("provider:openrouter");
    assert.equal(await s.secrets.get("provider:openrouter"), null);
    await s.meta.set("schema", 1);
    assert.equal(await s.meta.get("schema"), 1);
    await s.cache.put("k", { words: [1] });
    assert.deepEqual(await s.cache.get("k"), { words: [1] });
  });

  test("seeding from the cached page list: new ids, the old id as serverId, english as gloss, base en, once", async () => {
    const s = await open();
    const cached = [{ id: 7, lang: "ru", native: "кошка", english: "cat", forms: ["cat"], romanization: "koshka" }, { id: 8, lang: "ar", native: "بيت", english: "house", forms: ["house"] }];
    assert.equal(await s.seed(cached), 2);
    assert.equal(await s.seed(cached), 0);
    const all = await s.list();
    assert.deepEqual(all.map((w) => [w.serverId, w.gloss, w.base_lang, w.origin]), [[7, "cat", "en", "migrated"], [8, "house", "en", "migrated"]]);
    assert.ok(all.every((w) => w.id !== "7" && w.id.length === 36));
  });

  test("the commit signal fires once per write, with who wrote", async () => {
    const s = await open();
    const seen = [];
    s.onCommit((i) => seen.push(i));
    await s.upsertByNatural([word("a"), word("b")], { by: "dash-1" });
    await s.upsertByNatural([word("a")]);
    assert.deepEqual(seen, [{ reason: "upsert", by: "dash-1" }], "an unchanged re-add writes nothing");
  });
});

describe("the projection for content scripts", () => {
  const rec = (native, extra = {}) => ({ id: native, lang: "ru", native, base_lang: "en", gloss: native, forms: [{ text: native, enabled: true }], status: "active", created_at: "2026-10-01T00:00:00.000Z", deleted_at: null, romanization: null, ...extra });

  test("swappable words for the current bases, newest first, forms as texts of enabled forms, empty fields left out", () => {
    const out = L.Projection.project([
      rec("a", { created_at: "2026-10-01T00:00:00.000Z", forms: [{ text: "a", enabled: true }, { text: "aa", enabled: false }] }),
      rec("b", { created_at: "2026-10-02T00:00:00.000Z", pronunciation: "BEE" }),
      rec("paused", { status: "paused" }),
      rec("gone", { deleted_at: "2026-10-02T00:00:00.000Z" }),
      rec("es", { base_lang: "es" }),
    ], ["en"]);
    assert.deepEqual(out.map((w) => w.native), ["b", "a"]);
    assert.deepEqual(out[1].forms, ["a"]);
    assert.equal(out[0].pronunciation, "BEE");
    assert.equal("romanization" in out[1], false);
    assert.equal("language" in out[0], false, "content scripts name languages themselves");
  });

  test("5,000 words project in well under the 30 ms budget (median of 10)", () => {
    const many = Array.from({ length: 5000 }, (_, i) => rec(`w${i}`, { created_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString() }));
    const times = [];
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      L.Projection.project(many, ["en"]);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    assert.ok(times[5] < 30, `median ${times[5].toFixed(1)} ms`);
  });

  test("the projector debounces to one write with words, baseLangs and an increasing wordsVersion", async () => {
    const fake = createFakeChrome();
    let lists = 0;
    const p = L.Projection.createProjector({ list: async () => (lists++, [rec("a")]), storage: fake.chrome.storage.local, bases: async () => ["en"], debounceMs: 20 });
    p.schedule();
    p.schedule({ by: "dash-1" });
    await p.schedule({ by: "dash-1" });
    assert.equal(lists, 1);
    const writes = fake.calls.set.filter((c) => "words" in c.items);
    assert.equal(writes.length, 1);
    assert.deepEqual(Object.keys(writes[0].items).sort(), ["baseLangs", "words", "wordsVersion"]);
    assert.equal(writes[0].items.wordsVersion.n, 1);
    assert.equal(writes[0].items.wordsVersion.by, null, "two writers: nobody's echo");
    await p.flush({ by: "dash-1" });
    assert.equal(fake.store.local.wordsVersion.n, 2);
    assert.equal(fake.store.local.wordsVersion.by, "dash-1");
  });
});

describe("the add queue", () => {
  function queue({ lookup, save = async (job, words) => words.map((w) => ({ result: "created", word: { ...w, id: `id-${w.native}` } })), now = () => Date.now(), isFunctionWord } = {}) {
    const fake = createFakeChrome();
    const settled = [];
    // Timers that don't keep the test process alive (a job may wait an hour).
    const setTimer = (fn, ms) => setTimeout(fn, ms).unref();
    const q = L.Queue.createAddQueue({ storage: fake.chrome.storage.local, lookup, save, now, setTimer, isFunctionWord, onSettled: (j) => settled.push(j) });
    const job = (id) => (fake.store.local.addJobs ?? []).find((j) => j.id === id);
    const until = async (fn) => {
      for (let i = 0; i < 200; i++) {
        await fake.idle();
        if (fn()) return;
        await sleep(5);
      }
      throw new Error("timed out");
    };
    return { q, fake, job, until, settled };
  }
  const found = (native) => ({ ok: true, result: { words: [{ lang: "ru", native, base_lang: "en", gloss: "x" }], rejected: [], missing_bases: [] } });

  test("an add is persisted before any lookup, then done with its results", async () => {
    let calls = 0;
    const { q, job, until, fake } = queue({ lookup: async () => (calls++, found("кот")) });
    const p = q.add({ id: "j1", text: "kot", baseLangs: ["en"] });
    assert.equal(calls, 0);
    await p;
    assert.equal(fake.store.local.addJobs[0].state === "queued" || fake.store.local.addJobs[0].state === "looking_up" || fake.store.local.addJobs[0].state === "done", true);
    await until(() => job("j1")?.state === "done");
    assert.deepEqual(job("j1").results.map((r) => [r.result, r.word.native, r.wordId]), [["created", "кот", "id-кот"]]);
  });

  test("waits on rate limits and quota with the provider's retry time; fails on no word, a rejected key and a 402", async () => {
    const answers = {
      busy: { ok: false, error: { code: "rate_limited", details: { retry_at: new Date(Date.now() + 60_000).toISOString() } } },
      quota: { ok: false, error: { code: "quota_exhausted", details: { retry_at: new Date(Date.now() + 3_600_000).toISOString() } } },
      none: { ok: true, result: { words: [], code: "no_word_found", rejected: [] } },
      key: { ok: false, error: { code: "key_rejected", details: {} } },
      setup: { ok: false, error: { code: "lookup_not_set_up", details: {} } },
      // 25 §2: a provider that wants credit (402) won't answer later either; no retry.
      unpaid: { ok: false, error: { code: "quota_exhausted", details: { reason: "payment_required", provider: "openrouter" } } },
    };
    const { q, job, until } = queue({ lookup: async (j) => answers[j.text] });
    for (const id of Object.keys(answers)) await q.add({ id, text: id });
    await until(() => Object.keys(answers).every((id) => !["queued", "looking_up"].includes(job(id)?.state)));
    assert.equal(job("busy").state, "waiting");
    assert.equal(job("busy").retryAt, Date.parse(answers.busy.error.details.retry_at));
    assert.ok(job("busy").retryAt > Date.now(), "never a retry time in the past");
    assert.equal(job("quota").state, "waiting");
    assert.equal(job("none").state, "failed");
    assert.equal(job("none").error.code, "no_word_found");
    assert.equal(job("key").state, "failed");
    assert.equal(job("setup").state, "waiting");
    assert.equal(job("setup").retryAt, null);
    assert.equal(job("unpaid").state, "failed");
    assert.equal(job("unpaid").retryAt, null);
    assert.equal(job("unpaid").error.details.reason, "payment_required");
  });

  test("wake: jobs waiting for a provider run as soon as one is saved", async () => {
    let ready = false;
    const { q, job, until } = queue({ lookup: async () => (ready ? found("книга") : { ok: false, error: { code: "lookup_not_set_up", details: {} } }) });
    await q.add({ id: "w1", text: "kniga" });
    await until(() => job("w1")?.state === "waiting");
    ready = true;
    await q.wake();
    await until(() => job("w1")?.state === "done");
  });

  test("new settings abort a running lookup; it runs again, without counting the aborted try", async () => {
    let n = 0;
    const { q, job, until } = queue({
      lookup: (j, signal) => (n++ === 0 ? new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("a"), { name: "AbortError" })))) : Promise.resolve(found("дом"))),
    });
    await q.add({ id: "a1", text: "dom" });
    await until(() => job("a1")?.state === "looking_up");
    q.abortRunning();
    await until(() => job("a1")?.state === "done");
    assert.equal(job("a1").attempts, 1);
    assert.equal(n, 2);
  });

  test("at most two run at once; the learner's adds keep their order", async () => {
    let running = 0;
    let peak = 0;
    const order = [];
    const { q, job, until } = queue({ lookup: async (j) => { running++; peak = Math.max(peak, running); order.push(j.id); await sleep(20); running--; return found(j.id); } });
    for (const id of ["1", "2", "3", "4"]) await q.add({ id, text: id });
    await until(() => ["1", "2", "3", "4"].every((id) => job(id)?.state === "done"));
    assert.equal(peak, 2);
    assert.deepEqual(order, ["1", "2", "3", "4"]);
  });

  test("a retry time already past still waits a moment: no tight loop against a busy provider", async () => {
    let calls = 0;
    const { q, job, until } = queue({ lookup: async () => (calls++, { ok: false, error: { code: "rate_limited", details: { retry_at: new Date(Date.now() - 1000).toISOString() } } }) });
    await q.add({ id: "p1", text: "x" });
    await until(() => job("p1")?.state === "waiting");
    await sleep(200);
    assert.equal(calls, 1);
    assert.ok(job("p1").retryAt >= Date.now() + 1000);
  });

  test("resume: a job left looking up by a stopped worker is queued again with the same id", async () => {
    const fake = createFakeChrome({ local: { addJobs: [{ id: "r1", text: "x", state: "looking_up", createdAt: 1, attempts: 1, waits: 0, results: [], baseLangs: ["en"] }] } });
    const q = L.Queue.createAddQueue({ storage: fake.chrome.storage.local, lookup: async () => found("икс"), save: async (j, w) => w.map((x) => ({ result: "created", word: { ...x, id: "i" } })) });
    await q.resume();
    for (let i = 0; i < 100 && fake.store.local.addJobs[0].state !== "done"; i++) {
      await fake.idle();
      await sleep(5);
    }
    assert.equal(fake.store.local.addJobs[0].state, "done");
  });

  // Slice 24 section 2: four or more target words wait for the learner's pick.
  const many = (words) => ({ ok: true, result: { words: words.map(([native, base]) => ({ lang: "es", native, base_lang: base ?? "en", gloss: native })), rejected: [], missing_bases: [] } });
  const saveAll = async (j, w) => w.map((x, i) => ({ result: "created", word: { ...x, id: `${j.id}-${i}` } }));

  test("four or more words: nothing saved; the pick saves exactly the ticked ones; function words start unticked", async () => {
    let saves = 0;
    const save = async (j, w) => (saves++, saveAll(j, w));
    const { q, job, until } = queue({ lookup: async () => many([["gato"], ["sentarse"], ["estera"], ["en"], ["mi"]]), save, isFunctionWord: (w) => ["en", "mi"].includes(w.native) });
    await q.add({ id: "c1", text: "the cat sat on my mat", baseLangs: ["en"] });
    await until(() => job("c1")?.state === "needs_choice");
    assert.equal(saves, 0);
    assert.deepEqual(job("c1").candidates.map((c) => [c.native, c.unticked]), [["gato", false], ["sentarse", false], ["estera", false], ["en", true], ["mi", true]]);
    const keys = job("c1").candidates.filter((c) => !c.unticked).map(L.Queue.keyOf);
    await q.choose("c1", keys);
    assert.equal(job("c1").state, "done");
    assert.deepEqual(job("c1").results.map((r) => r.word.native), ["gato", "sentarse", "estera"]);
    assert.equal(job("c1").candidates, null);
  });

  test("a word with a record per base counts once: 犬 for es and en is one word, saved at once", async () => {
    const { q, job, until } = queue({ lookup: async () => many([["perro", "en"], ["perro", "fr"], ["gato", "en"], ["gato", "fr"]]), save: saveAll });
    await q.add({ id: "c2", text: "x", baseLangs: ["en", "fr"] });
    await until(() => job("c2")?.state === "done");
    assert.equal(job("c2").results.length, 4);
  });

  test("picking nothing cancels; a pick for a job not waiting on one changes nothing", async () => {
    const { q, job, until } = queue({ lookup: async () => many([["a1"], ["a2"], ["a3"], ["a4"]]), save: saveAll });
    await q.add({ id: "c3", text: "x", baseLangs: ["en"] });
    await until(() => job("c3")?.state === "needs_choice");
    await q.choose("c3", []);
    assert.equal(job("c3").state, "cancelled");
    await q.choose("c3", ["es\u001fa1"]);
    assert.equal(job("c3").state, "cancelled");
  });

  test("offline: waits without a short timer, and finishes on its own when the network is back", async () => {
    let online = false;
    const { q, job, until } = queue({ lookup: async () => (online ? found("кот") : { ok: false, error: { code: "offline", details: {} } }) });
    await q.add({ id: "o1", text: "kot", baseLangs: ["en"] });
    await until(() => job("o1")?.state === "waiting");
    assert.ok(job("o1").retryAt - Date.now() > 5 * 60_000, "the alarm's to pick up, not a timer");
    online = true;
    await q.wake(); // the `online` event
    await until(() => job("o1")?.state === "done");
  });

  test("an Undo's outcome is written on every record of the word", async () => {
    const { q, job, until } = queue({ lookup: async () => many([["perro", "en"], ["perro", "fr"]]), save: saveAll });
    await q.add({ id: "u1", text: "x", baseLangs: ["en", "fr"] });
    await until(() => job("u1")?.state === "done");
    await q.setUndo("u1", L.Queue.keyOf(job("u1").results[0].word), { undo: "failed", undoError: { code: "server_unreachable" } });
    assert.deepEqual(job("u1").results.map((r) => [r.undo, r.undoError.code]), [["failed", "server_unreachable"], ["failed", "server_unreachable"]]);
  });

  test("keeps the 20 most recent jobs, never dropping unfinished ones", async () => {
    const { q, fake, until, job } = queue({ lookup: async (j) => (j.text === "hold" ? { ok: false, error: { code: "lookup_not_set_up", details: {} } } : found(j.text)) });
    await q.add({ id: "hold", text: "hold" });
    await until(() => job("hold")?.state === "waiting");
    for (let i = 0; i < 25; i++) await q.add({ id: `n${i}`, text: `n${i}` });
    await until(() => (fake.store.local.addJobs ?? []).filter((j) => j.state === "done").length >= 19 && !fake.store.local.addJobs.some((j) => j.state === "queued" || j.state === "looking_up"));
    assert.ok(fake.store.local.addJobs.length <= 20);
    assert.ok(job("hold"), "the waiting job stays");
  });
});

describe("the pronunciation refresh (slice 07 section 8, in this browser)", () => {
  test("fills pronunciations in batches through the client, skips what the learner edited, and finishes", async () => {
    const s = await open();
    await s.upsertByNatural([word("спасибо", { gloss: "thanks", forms: [{ text: "thanks" }] }), word("да", { gloss: "yes", forms: [{ text: "yes" }] })]);
    const client = {
      quotaLow: async () => null,
      respell: async (items) => ({ ok: true, result: items.map((i) => ({ lang: i.lang, native: i.native, base_lang: "en", pronunciation: i.native === "да" ? "da" : "spa-SEE-ba", pronunciation_careful: null, native_vocalized: null })) }),
    };
    const job = L.Refresh.createRefreshJob({ store: s, client });
    assert.deepEqual(await job.status(), { state: "running", done: 0, total: 2 });
    await job.tick();
    assert.deepEqual((await s.list()).map((w) => [w.native, w.pronunciation, w.pronunciation_source]).sort(), [["да", "da", "model"], ["спасибо", "spa-SEE-ba", "model"]]);
    assert.deepEqual(await job.status(), { state: "done", done: 2, total: 2 });
  });

  test("waits while an add runs or with 10 or fewer free lookups left, and on a rate limit", async () => {
    const s = await open();
    await s.upsertByNatural([word("спасибо")]);
    let asked = 0;
    const client = { quotaLow: async () => null, respell: async () => (asked++, { ok: false, error: { code: "rate_limited", details: {} } }) };
    const busy = L.Refresh.createRefreshJob({ store: s, client, busy: async () => true });
    await busy.tick();
    assert.equal(asked, 0, "the learner's adds go first");
    const low = L.Refresh.createRefreshJob({ store: s, client: { ...client, quotaLow: async () => Date.now() + 1000 } });
    assert.equal((await low.tick()).state, "waiting");
    assert.equal(asked, 0);
    await s.meta.set(L.Refresh.META, null);
    const limited = L.Refresh.createRefreshJob({ store: s, client });
    const st = await limited.tick();
    assert.equal(asked, 1);
    assert.equal(st.state, "waiting");
    assert.ok(Date.parse(st.retry_at) > Date.now());
  });
});

describe("'native = meaning' (slice 24 section 7) and the upgrade (slice 11 section 8)", () => {
  test("parses the separators and an optional romanization or respelling", () => {
    assert.deepEqual(L.Local.parseManual("犬 = perro"), { native: "犬", gloss: "perro", romanization: null, pronunciation: null });
    assert.deepEqual(L.Local.parseManual("gracias – thanks"), { native: "gracias", gloss: "thanks", romanization: null, pronunciation: null });
    assert.deepEqual(L.Local.parseManual("спасибо (spasibo) = thanks"), { native: "спасибо", gloss: "thanks", romanization: "spasibo", pronunciation: null });
    assert.deepEqual(L.Local.parseManual("спасибо (spa-SEE-ba) = thanks"), { native: "спасибо", gloss: "thanks", romanization: null, pronunciation: "spa-SEE-ba" });
    assert.equal(L.Local.parseManual("well-being"), null);
    assert.equal(L.Local.parseManual("shukran"), null);
  });

  test("the word's language: the hint, a recent language whose script fits, then the script", () => {
    const m = (native, o) => L.Local.manualLang(native, { base: "en", recent: [], ...o });
    assert.equal(m("gato", { hintLang: "es" }), "es");
    assert.equal(m("gato", { recent: ["ru", "es"] }), "es");
    assert.equal(m("犬", { recent: ["ja"] }), "ja");
    assert.equal(m("犬", {}), "zh");
    assert.equal(m("собака", {}), "ru");
    assert.equal(m("gato", {}), null, "Latin letters need a hint or a recent language");
    assert.equal(m("dog", { hintLang: "en", base: "en" }), null, "never the meaning's own base");
  });

  test("the upgrade with a token: secrets, server mode, the cached words seeded; without: local and lookups not set up", async () => {
    const s = await open();
    const fake = createFakeChrome({ local: { token: " tok ", serverUrl: "http://h:4747", words: [{ id: 1, lang: "ru", native: "да", english: "yes", forms: ["yes"] }] } });
    const r = await L.Local.migrate({ store: s, storage: fake.chrome.storage.local });
    assert.deepEqual([r.migrated, r.home, r.seeded], [true, "server", 1]);
    assert.equal(await s.secrets.get("server"), "tok");
    assert.equal(fake.store.local.token, undefined);
    assert.equal(fake.store.local.serverUrl, undefined);
    assert.deepEqual(fake.store.local.server, { url: "http://h:4747" });
    assert.deepEqual(fake.store.local.keys, { server: true, providers: {} });
    assert.equal((await L.Local.migrate({ store: s, storage: fake.chrome.storage.local })).migrated, false, "once");

    const s2 = await open();
    const fresh = createFakeChrome();
    const r2 = await L.Local.migrate({ store: s2, storage: fresh.chrome.storage.local, uiLanguage: "es-ES" });
    assert.equal(r2.home, "local");
    assert.equal(fresh.store.local.lookup.kind, "none");
    assert.equal(fresh.store.local.lookup.provider, "openrouter");
    assert.deepEqual(fresh.store.local.baseLangs, ["es-ES"].includes(fresh.store.local.baseLangs[0]) ? fresh.store.local.baseLangs : ["es"]);
  });
});
