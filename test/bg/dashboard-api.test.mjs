// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The dashboard's routes in the real background.js (slice 21, server mode), against the
// fixture server's in-memory /api/v1: reads, edits that reach the pages' word list, delete
// and restore, conflicts, and the error codes the dashboard turns into words (slice 25).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { startFixtureServer, uuidFor } from "../helpers/fixture-server.mjs";
import { runInVm, sleep } from "../helpers/load-script.mjs";

const EXT_ID = "fake-extension-id";
const PAGE = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/dashboard.html`, tab: { id: 3, url: `chrome-extension://${EXT_ID}/dashboard.html` } };
const CONTENT = { id: EXT_ID, url: "https://example.com/", tab: { id: 1, url: "https://example.com/" } };

function loadBackground(local) {
  const fake = createFakeChrome({ runtimeId: EXT_ID, local });
  runInVm("background.js", { chrome: fake.chrome, fetch });
  return { fake, store: fake.store.local, send: (msg, sender = PAGE) => fake.deliver(msg, sender) };
}

describe("dashboard routes against the fixture server", () => {
  let srv;
  before(async () => {
    srv = await startFixtureServer();
  });
  after(() => srv.close());
  const bg = () => loadBackground({ serverUrl: srv.kotikoUrl, token: srv.token });

  test("content scripts can't read or change words", async () => {
    srv.reset();
    const { send } = bg();
    for (const type of ["words.list", "words.write", "words.deleted", "words.preview", "words.save", "job.refresh"]) {
      assert.deepEqual(await send({ type, ops: [{ op: "delete", id: "x" }] }, CONTENT), { error: { code: "forbidden" } }, type);
    }
  });

  test("list reads v1 records; an edit reaches the pages' list; delete and restore round-trip", async () => {
    srv.reset();
    const { send, store } = bg();
    const { words } = await send({ type: "words.list" });
    const dom = words.find((w) => w.native === "дом");
    assert.equal(dom.id, uuidFor(5));
    assert.equal(dom.gloss, "house");
    assert.equal(dom.base_lang, "en");

    const { results } = await send({ type: "words.write", clientId: "d1", ops: [{ op: "patch", id: dom.id, patch: { gloss: "home", forms: ["home", "house"] }, if_updated_at: dom.updated_at }] });
    assert.equal(results[0].ok, true);
    assert.equal(results[0].word.gloss, "home");
    assert.equal(store.wordsVersion.by, "d1");
    // The follow-up sync puts the change where content scripts read it.
    for (let i = 0; i < 50 && store.words?.find((w) => w.native === "дом")?.english !== "home"; i++) await sleep(10);
    assert.equal(store.words.find((w) => w.native === "дом").english, "home");

    const del = await send({ type: "words.write", ops: [{ op: "delete", id: dom.id }] });
    assert.equal(del.results[0].ok, true);
    assert.deepEqual(store.recentlyDeleted.map((e) => e.id), [dom.id]);
    assert.equal((await send({ type: "words.list" })).words.some((w) => w.id === dom.id), false);
    assert.equal((await send({ type: "words.deleted" })).entries[0].word.native, "дом");

    const res = await send({ type: "words.write", ops: [{ op: "restore", id: dom.id }] });
    assert.equal(res.results[0].ok, true);
    assert.deepEqual(store.recentlyDeleted, []);
    assert.ok((await send({ type: "words.list" })).words.some((w) => w.id === dom.id));
  });

  test("a stale edit is a word_conflict carrying the current word; a taken spelling is a duplicate", async () => {
    srv.reset();
    const { send } = bg();
    const { words } = await send({ type: "words.list" });
    const [a, b] = words;
    const stale = await send({ type: "words.write", ops: [{ op: "patch", id: a.id, patch: { note: "x" }, if_updated_at: "2020-01-01T00:00:00.000Z" }] });
    assert.equal(stale.results[0].code, "word_conflict");
    assert.equal(stale.results[0].details.reason, "stale");
    assert.equal(stale.results[0].details.word.id, a.id);
    assert.equal(stale.results[0].details.status, 409);
    const dup = await send({ type: "words.write", ops: [{ op: "patch", id: b.id, patch: { lang: a.lang, native: a.native } }] });
    assert.equal(dup.results[0].code, "word_conflict");
    assert.equal(dup.results[0].details.reason, "duplicate");
  });

  test("an invalid edit says which field and why", async () => {
    srv.reset();
    const { send } = bg();
    const [w] = (await send({ type: "words.list" })).words;
    const res = await send({ type: "words.write", ops: [{ op: "patch", id: w.id, patch: { forms: [] } }] });
    assert.equal(res.results[0].code, "invalid_word");
    assert.deepEqual([res.results[0].details.field, res.results[0].details.reason], ["forms", "no_usable_forms"]);
  });

  test("preview saves nothing; save adds; the refresh job pauses and resumes", async () => {
    srv.reset();
    const { send } = bg();
    const count = (await send({ type: "words.list" })).words.length;
    const preview = await send({ type: "words.preview", text: "kniga", base_langs: ["en"] });
    assert.equal(preview.candidates[0].native, "книга");
    assert.equal((await send({ type: "words.list" })).words.length, count, "nothing saved before the learner accepts");
    const saved = await send({ type: "words.save", words: preview.candidates, client_request_id: "0190a1b2-c3d4-7000-8000-000000000001" });
    assert.equal(saved.results[0].result, "created");
    assert.equal((await send({ type: "words.list" })).words.length, count + 1);

    srv.state.job = { state: "running", done: 40, total: 120 };
    assert.deepEqual(await send({ type: "job.refresh" }), { state: "running", done: 40, total: 120 });
    assert.equal((await send({ type: "job.refresh", action: "pause" })).state, "paused");
    assert.equal((await send({ type: "job.refresh", action: "resume" })).state, "running");
  });

  test("server problems come back as slice 25 codes", async () => {
    srv.reset();
    const { send } = bg();
    srv.state.kotiko = "401";
    assert.equal((await send({ type: "words.list" })).code, "server_key_rejected");
    srv.state.kotiko = null;
    srv.state.failNext = { path: "/words", status: 404, code: "not_found" };
    assert.equal((await send({ type: "words.list" })).code, "server_outdated", "a server without /api/v1");
    srv.state.kotiko = "html";
    assert.equal((await send({ type: "words.list" })).code, "not_kotiko_server");
    srv.state.kotiko = null;
    const off = loadBackground({ serverUrl: "http://127.0.0.1:9", token: "t" });
    assert.equal((await off.send({ type: "words.list" })).code, "server_unreachable");
    // With no token the words live in this browser (slice 11): the list is the store's.
    const unset = loadBackground({ serverUrl: srv.kotikoUrl, token: "" });
    assert.deepEqual(await unset.send({ type: "words.list" }), { words: [], cursor: null });
  });
});
