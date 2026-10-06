// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 12 in the real background.js (vm, fake chrome, fake-indexeddb, the fixture
// server): restoring a backup into this browser and into a server, its Undo, and "delete
// everything", which leaves no storage area, database, job or key behind.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { startFixtureServer } from "../helpers/fixture-server.mjs";
import { requireExt, runInVm, sleep } from "../helpers/load-script.mjs";
import { loadLocalLibs } from "../helpers/local-libs.mjs";

const EXT_ID = "fake-extension-id";
const PAGE = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/dashboard.html`, tab: { id: 3, url: `chrome-extension://${EXT_ID}/dashboard.html` } };
const CONTENT = { id: EXT_ID, url: "https://example.com/", tab: { id: 1, url: "https://example.com/" } };
const KEY = "sk-or-v1-0123456789abcdef0123456789abcdefa1b2";
const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../spec/fixtures/export");

loadLocalLibs();
const B = requireExt("lib/backup.js");
const backupWords = (name) => B.read(fs.readFileSync(path.join(FIX, name), "utf8")).words;

function loadBackground({ local = {}, sync = {}, session = {}, fetch: f = fetch } = {}) {
  const fake = createFakeChrome({ runtimeId: EXT_ID, local, sync, session });
  const ctx = runInVm("background.js", { chrome: fake.chrome, fetch: f });
  return {
    fake,
    ctx,
    k: ctx.__kotiko,
    store: fake.store.local,
    send: (msg, sender = PAGE) => fake.deliver(msg, sender),
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

const plain = (v) => JSON.parse(JSON.stringify(v));
const databases = async (bg) => (await bg.ctx.indexedDB.databases()).map((d) => d.name);

describe("restoring a backup into this browser (§5)", () => {
  test("preview counts without writing; restore in one go; the same file again changes nothing; Undo", async () => {
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    const words = backupWords("multi-script.json");
    const store = await bg.k.getStore();
    const preview = await bg.send({ type: "backup.preview", words });
    assert.deepEqual([preview.counts.new, preview.counts.merge, preview.restoreDeleted, preview.home], [13, 0, true, "local"]);
    assert.equal((await store.all()).length, 0, "a preview writes nothing");
    const res = await bg.send({ type: "backup.restore", words, label: "kotiko-backup-2026-09-30.json", pronunciations: false });
    assert.deepEqual([res.ok, res.counts.new], [true, 13]);
    assert.deepEqual(plain(await store.all()).map((w) => w.id).sort(), words.map((w) => w.id).sort(), "the backup's ids are kept");
    await bg.until(() => bg.store.words?.length === 12, 3000);
    assert.equal(typeof bg.store.lastBackupAt, "number", "a restore counts as a backup for the reminder");
    const status = await bg.send({ type: "backup.status" });
    assert.equal(status.lastImport.label, "kotiko-backup-2026-09-30.json");
    const again = await bg.send({ type: "backup.restore", words });
    assert.deepEqual([again.counts.new, again.counts.merge, again.counts.identical], [0, 0, 13]);
    // The second restore wrote nothing, so the first one's Undo is still the one kept.
    const undo = await bg.send({ type: "backup.undo" });
    assert.deepEqual([undo.ok, undo.undone], [true, 13]);
    assert.equal((await store.all()).length, 0);
    assert.equal((await bg.send({ type: "backup.undo" })).code, "nothing_to_undo");
  });

  test("words a page sends are checked again; content scripts can't restore or delete", async () => {
    const bg = loadBackground();
    await bg.k.ready();
    const res = await bg.send({ type: "backup.restore", words: [{ id: "x", lang: "es", native: "perro", base_lang: "es", gloss: "perro", forms: ["perro"] }, { lang: "ru", native: "да", base_lang: "en", gloss: "yes", forms: ["yes"], pronunciation: "PA-ZHAL-STA" }] });
    assert.equal(res.counts.new, 1, "a word in its own base never gets in");
    const [w] = await (await bg.k.getStore()).list();
    assert.equal(w.pronunciation, null);
    assert.match(w.id, /^[0-9a-f-]{36}$/);
    for (const type of ["backup.restore", "backup.preview", "data.deleteAll", "backup.undo", "data.describe"]) {
      const r = await bg.send({ type, words: [], confirm: "delete-everything" }, CONTENT);
      assert.equal(r?.error?.code, "forbidden", type);
    }
    assert.equal((await bg.send({ type: "data.deleteAll" })).error?.code, "invalid_message", "the confirmation is required");
  });
});

describe("delete everything (§6)", () => {
  let srv;
  before(async () => {
    srv = await startFixtureServer();
  });
  after(() => srv.close());

  async function full({ server = false } = {}) {
    const bg = loadBackground({
      local: { baseLangs: ["en"], prefs: { theme: "dark" }, hiddenLangs: ["ja"] },
      sync: { ui: { baseLangs: ["en"], uiLang: "auto" } },
      session: { addDraft: "hola", addHint: "es" },
    });
    await bg.k.ready();
    await bg.send({ type: "secrets.set", id: "provider:openrouter", value: KEY });
    await bg.send({ type: "backup.restore", words: backupWords("multi-script.json") });
    await bg.send({ type: "add", text: "gracias = thanks", hintLang: "es" });
    if (server) await bg.send({ type: "server.connect", url: srv.kotikoUrl, token: srv.token });
    await bg.until(() => bg.store.words?.length >= 12);
    return bg;
  }

  test("every storage area empty, the database gone, no job, alarm or key left; pages get an empty list", async () => {
    const bg = await full();
    assert.ok(bg.fake.alarms.size > 0);
    const described = await bg.send({ type: "data.describe" });
    assert.deepEqual([described.words >= 13, described.providerKey, described.server], [true, true, null]);
    const res = await bg.send({ type: "data.deleteAll", confirm: "delete-everything", sync: true });
    assert.deepEqual(res, { ok: true, server: null });
    assert.ok(bg.fake.calls.set.some((c) => c.area === "local" && Array.isArray(c.items.words) && !c.items.words.length && Object.keys(c.items).length === 1), "the pages' list was emptied first");
    // Nothing comes back on its own: the projection, the alarm, a storage listener.
    await sleep(300);
    await bg.fake.fireAlarm("kotiko-sync");
    await bg.fake.idle();
    assert.deepEqual(plain(bg.fake.store.local), {});
    assert.deepEqual(plain(bg.fake.store.session), {});
    assert.deepEqual(plain(bg.fake.store.sync), {});
    assert.deepEqual(await databases(bg), [], "no kotiko database");
    assert.equal(bg.fake.alarms.size, 0);
    // A page left open asks for something at once: refused, and nothing is set up again.
    assert.equal((await bg.send({ type: "words.list" })).details?.reason, "deleted");
    await bg.fake.idle();
    assert.deepEqual(plain(bg.fake.store.local), {});
    assert.deepEqual(await databases(bg), []);
    // A page opened a moment later (or anything a person asks for) starts afresh: no key, no words.
    await sleep(2100);
    const secrets = await bg.send({ type: "secrets.describe" });
    assert.deepEqual(plain(secrets), { secrets: {} });
    assert.deepEqual(plain((await bg.send({ type: "words.list" })).words), []);
    assert.ok(!JSON.stringify(bg.fake.store).includes(KEY));
  });

  test("storage.sync is kept unless asked", async () => {
    const bg = await full();
    await bg.send({ type: "data.deleteAll", confirm: "delete-everything" });
    assert.deepEqual(plain(bg.fake.store.sync).ui.baseLangs, ["en"]);
    assert.deepEqual(plain(bg.fake.store.local), {});
  });

  test("with the server box ticked: the server's words are gone and its reset_epoch goes up; unticked, untouched", async () => {
    srv.reset();
    const bg = await full({ server: true });
    const count = srv.state.v1.length;
    assert.ok(count > 0);
    await bg.send({ type: "data.deleteAll", confirm: "delete-everything" });
    assert.equal(srv.state.v1.length, count, "unticked: the server is untouched");
    const bg2 = await full({ server: true });
    const res = await bg2.send({ type: "data.deleteAll", confirm: "delete-everything", server: true });
    assert.deepEqual(res.server, { deleted: count, reset_epoch: 1 });
    assert.equal(srv.state.v1.length, 0);
    assert.deepEqual(plain(bg2.fake.store.local), {});
  });

  test("when the server's delete fails, nothing is deleted anywhere", async () => {
    srv.reset();
    const bg = await full({ server: true });
    await fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify({ failNext: { method: "DELETE", path: "/words", status: 500, code: "internal" } }) });
    const res = await bg.send({ type: "data.deleteAll", confirm: "delete-everything", server: true });
    assert.equal(res.error?.code ?? res.code, "internal");
    assert.ok((await (await bg.k.getStore()).count()) >= 13);
    assert.equal(bg.store.prefs.theme, "dark");
    assert.ok(srv.state.v1.length > 0);
  });
});

describe("restoring into a server (§5 step 3, §7)", () => {
  let srv;
  before(async () => {
    srv = await startFixtureServer();
  });
  after(() => srv.close());

  test("batches of at most 500, the backup's ids kept for new words, combined counts, and Undo", async () => {
    srv.reset();
    await fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify({ v1Words: [] }) });
    const bg = loadBackground({ local: { serverUrl: srv.kotikoUrl, token: srv.token } });
    await bg.k.ready();
    assert.equal(bg.store.wordsHome, "server");
    const base = backupWords("multi-script.json")[0];
    const words = Array.from({ length: 1201 }, (_, i) => ({ ...base, id: `0199c000-0000-7000-8000-${i.toString(16).padStart(12, "0")}`, native: `пожалуйста${i}`, native_vocalized: null }));
    const preview = await bg.send({ type: "backup.preview", words });
    assert.deepEqual([preview.home, preview.counts.new], ["server", 1201]);
    srv.state.log.length = 0;
    const res = await bg.send({ type: "backup.restore", words });
    assert.deepEqual([res.ok, res.home, res.counts.created, res.counts.failed], [true, "server", 1201, 0]);
    const batches = srv.state.log.filter((r) => r.path === "/kotiko/api/v1/words/batch");
    assert.equal(batches.length, 3, "500 + 500 + 201");
    assert.deepEqual(srv.state.v1.map((w) => w.id).sort(), words.map((w) => w.id).sort());
    assert.equal(srv.state.log.filter((r) => r.path.startsWith("/llm/")).length, 0, "no model calls");
    // Restored again with one word edited in the file since: one update, the rest unchanged.
    const edited = words.map((w, i) => (i === 0 ? { ...w, note: "a newer note", updated_at: "2027-01-01T00:00:00.000Z" } : w));
    const again = await bg.send({ type: "backup.restore", words: edited });
    assert.deepEqual([again.counts.created, again.counts.updated, again.counts.identical], [0, 1, 1200]);
    assert.equal(srv.state.v1.find((w) => w.id === words[0].id).note, "a newer note");
    const undo = await bg.send({ type: "backup.undo" });
    assert.deepEqual([undo.ok, undo.undone], [true, 1]);
    assert.equal(srv.state.v1.find((w) => w.id === words[0].id).note, null);
  });
});
