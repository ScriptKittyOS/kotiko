// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The dashboard's data source (lib/word-source.js) and the background's word routes behind
// it (lib/words-v1.js), with fakes on both sides.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createEvent, createFakeChrome } from "../helpers/fake-chrome.mjs";
import { requireExt } from "../helpers/load-script.mjs";

const { createServerSource, changedKeys } = requireExt("lib/word-source.js");
const { createWordHandlers, checkOps, pool } = requireExt("lib/words-v1.js");

const DAY = 86_400_000;

function source(answer) {
  const sent = [];
  const onChanged = createEvent();
  const src = createServerSource({
    send: async (msg) => {
      sent.push(msg);
      return answer(msg);
    },
    onChanged,
    clientId: "me",
  });
  return { src, sent, onChanged };
}

describe("the server source", () => {
  test("list, deleted, preview, save and the refresh job ask the background", async () => {
    const { src, sent } = source((m) => ({
      "words.list": { words: [{ id: "a" }], cursor: "3" },
      "words.deleted": { entries: [{ id: "b" }] },
      "words.preview": { candidates: [{ native: "犬" }], rejected: [] },
      "words.save": { results: [{ result: "created", word: { id: "c", lang: "ja", native: "犬" } }] },
      "job.refresh": { state: "paused", done: 1, total: 2 },
    })[m.type]);
    assert.deepEqual(await src.list(), [{ id: "a" }]);
    assert.deepEqual(await src.deleted(), [{ id: "b" }]);
    assert.deepEqual((await src.preview("inu", { baseLangs: ["en", "es"], hintLang: "ja" })).candidates, [{ native: "犬" }]);
    assert.equal((await src.save([{ lang: "ja", native: "犬" }], { requestId: "r1" })).results[0].word.id, "c");
    assert.equal((await src.refreshJob("pause")).state, "paused");
    assert.deepEqual(sent.map((m) => m.type), ["words.list", "words.deleted", "words.preview", "words.save", "job.refresh"]);
    assert.deepEqual(sent[2].base_langs, ["en", "es"]);
    assert.equal(sent[2].hint_lang, "ja");
    assert.equal(sent[3].client_request_id, "r1");
    assert.equal(sent[3].clientId, "me");
    assert.equal(sent[4].action, "pause");
  });

  test("errors come back coded (slice 25)", async () => {
    const { src } = source(() => ({ error: "nope", code: "server_unreachable", details: { reason: "network" } }));
    await assert.rejects(src.list(), (e) => e.code === "server_unreachable" && e.details.reason === "network");
    const { src: broken } = source(() => {
      throw new Error("Receiving end does not exist.");
    });
    await assert.rejects(broken.list(), (e) => e.code === "internal");
  });

  test("write answers per operation, even when the whole message fails", async () => {
    const { src, sent } = source(() => ({ results: [{ ok: true, word: { id: "a" } }] }));
    const ops = [{ op: "patch", id: "a", patch: { gloss: "x" } }, { op: "delete", id: "b" }];
    const res = await src.write(ops);
    assert.equal(res.length, 2);
    assert.equal(res[0].ok, true);
    assert.equal(res[1].code, "internal", "a missing answer is a failure, not a success");
    assert.equal(sent[0].clientId, "me");
    const { src: down } = source(() => ({ error: "Can't reach", code: "server_unreachable" }));
    assert.deepEqual((await down.write(ops)).map((r) => r.code), ["server_unreachable", "server_unreachable"]);
  });

  test("live updates: another page's write and a sync that changed words notify; our own echo doesn't", async () => {
    const { src, onChanged } = source(() => ({ results: [{ ok: true, word: { id: "a", lang: "ru", native: "дом" } }] }));
    const seen = [];
    const stop = src.subscribe(({ reason }) => seen.push(reason));
    onChanged.dispatch({ wordsVersion: { newValue: { at: 1, by: "popup" } } }, "local");
    onChanged.dispatch({ wordsVersion: { newValue: { at: 2, by: "me" } } }, "local");
    await src.write([{ op: "patch", id: "a", patch: { gloss: "home" } }], { touch: [{ lang: "ru", native: "дом" }] });
    const before = [{ id: 1, lang: "ru", native: "дом", english: "house" }];
    // The pages' list changes because of our edit: no reload.
    onChanged.dispatch({ words: { oldValue: before, newValue: [{ ...before[0], english: "home" }] } }, "local");
    // A word from Telegram arrives with the next sync: reload.
    onChanged.dispatch({ words: { oldValue: before, newValue: [...before, { id: 2, lang: "ar", native: "بيت", english: "house" }] } }, "local");
    onChanged.dispatch({ recentlyDeleted: { newValue: [] } }, "local");
    onChanged.dispatch({ words: { oldValue: [], newValue: [{ id: 9, lang: "ja", native: "猫" }] } }, "sync");
    assert.deepEqual(seen, ["version", "sync", "deleted"]);
    stop();
    onChanged.dispatch({ wordsVersion: { newValue: { by: "popup" } } }, "local");
    assert.equal(seen.length, 3);
  });

  test("changedKeys compares the pages' list by language and spelling", () => {
    const a = [{ lang: "ru", native: "Дом", english: "house" }, { lang: "ar", native: "بيت", english: "house" }];
    const b = [{ lang: "ru", native: "дом", english: "home" }, { lang: "ar", native: "بيت", english: "house" }, { lang: "ja", native: "猫" }];
    assert.deepEqual([...changedKeys(a, b)].sort(), ["ja\u0001猫", "ru\u0001дом"].sort());
    assert.equal(changedKeys(null, undefined).size, 0);
  });
});

describe("the background's word routes", () => {
  function handlers(call, now = () => 1_000 * DAY) {
    const fake = createFakeChrome();
    let synced = 0;
    const h = createWordHandlers({ call, storage: fake.chrome.storage.local, afterWrite: () => synced++, now });
    return { h, store: fake.store.local, synced: () => synced };
  }

  test("only extension pages may call them", () => {
    const { h } = handlers(async () => ({}));
    for (const [name, handler] of Object.entries(h)) assert.deepEqual(handler.from, ["page"], name);
  });

  test("words.list reads active and paused words", async () => {
    const calls = [];
    const { h } = handlers(async (path, init) => (calls.push([init.method, path]), { words: [{ id: "a" }], cursor: "9" }));
    assert.deepEqual(await h["words.list"].run({}), { words: [{ id: "a" }], cursor: "9" });
    assert.deepEqual(calls, [["GET", "/api/v1/words?status=active,paused"]]);
  });

  test("words.write runs each op, keeps per-op errors, records deletes for Recently deleted and refreshes pages", async () => {
    const calls = [];
    const call = async (path, init) => {
      calls.push([init.method, path, init.body]);
      if (path.endsWith("/missing")) throw Object.assign(new Error("gone"), { code: "word_gone", details: { status: 404 } });
      return { word: { id: decodeURIComponent(path.split("/")[4]), deleted_at: init.method === "DELETE" ? "x" : null } };
    };
    const { h, store, synced } = handlers(call);
    const msg = {
      clientId: "dash-1",
      ops: [
        { op: "patch", id: "a/b", patch: { gloss: "home" }, if_updated_at: "2026-10-01T00:00:00.000Z" },
        { op: "delete", id: "d" },
        { op: "patch", id: "missing", patch: { status: "paused" } },
      ],
    };
    assert.equal(checkOps(msg), null);
    const { results } = await h["words.write"].run(msg);
    assert.deepEqual(results.map((r) => r.ok), [true, true, false]);
    assert.equal(results[2].code, "word_gone");
    assert.deepEqual(calls[0], ["PATCH", "/api/v1/words/a%2Fb", { gloss: "home", if_updated_at: "2026-10-01T00:00:00.000Z" }]);
    assert.deepEqual(calls[1].slice(0, 2), ["DELETE", "/api/v1/words/d"]);
    assert.deepEqual(store.recentlyDeleted.map((e) => e.id), ["d"]);
    assert.equal(store.wordsVersion.by, "dash-1");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(synced(), 1);

    await h["words.write"].run({ ops: [{ op: "restore", id: "d" }] });
    assert.deepEqual(store.recentlyDeleted, []);
    assert.deepEqual(calls.at(-1).slice(0, 2), ["POST", "/api/v1/words/d/restore"]);
  });

  test("Recently deleted keeps 30 days", async () => {
    let t = 1_000 * DAY;
    const { h, store } = handlers(async (path) => ({ word: { id: path.split("/")[4] } }), () => t);
    await h["words.write"].run({ ops: [{ op: "delete", id: "old" }] });
    t += 31 * DAY;
    await h["words.write"].run({ ops: [{ op: "delete", id: "new" }] });
    assert.deepEqual(store.recentlyDeleted.map((e) => e.id), ["new"]);
    assert.deepEqual((await h["words.deleted"].run({})).entries.map((e) => e.id), ["new"]);
  });

  test("bad messages are refused before any request", () => {
    const { h } = handlers(async () => ({}));
    assert.ok(checkOps({ ops: [] }));
    assert.ok(checkOps({ ops: [{ op: "drop", id: "a" }] }));
    assert.ok(checkOps({ ops: [{ op: "patch", id: "a" }] }));
    assert.ok(checkOps({ ops: Array.from({ length: 1001 }, () => ({ op: "delete", id: "a" })) }));
    assert.ok(h["words.preview"].check({ text: "", base_langs: ["en"] }));
    assert.ok(h["words.preview"].check({ text: "dog", base_langs: [] }));
    assert.equal(h["words.preview"].check({ text: "dog", base_langs: ["en"] }), null);
    assert.ok(h["words.save"].check({ words: [] }));
    assert.ok(h["job.refresh"].check({ action: "stop" }));
  });

  test("preview, save and the refresh job use the v1 routes", async () => {
    const calls = [];
    const { h, store } = handlers(async (path, init) => (calls.push([init.method, path, init.body]), { ok: 1 }));
    await h["words.preview"].run({ text: "inu", base_langs: ["en"], hint_lang: "ja" });
    await h["words.save"].run({ words: [{ native: "犬" }], client_request_id: "r" });
    await h["words.save"].run({ words: [{ native: "犬" }, { native: "猫" }] });
    await h["job.refresh"].run({});
    await h["job.refresh"].run({ action: "resume" });
    assert.deepEqual(calls, [
      ["POST", "/api/v1/words", { text: "inu", preview: true, base_langs: ["en"], hint_lang: "ja" }],
      ["POST", "/api/v1/words", { word: { native: "犬" }, client_request_id: "r" }],
      ["POST", "/api/v1/words/batch", { words: [{ native: "犬" }, { native: "猫" }], client_request_id: undefined }],
      ["GET", "/api/v1/jobs/pronunciation-refresh", undefined],
      ["POST", "/api/v1/jobs/pronunciation-refresh", { action: "resume" }],
    ]);
    assert.ok(store.wordsVersion);
  });

  test("pool keeps order and runs at most n at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await pool([5, 1, 3, 2, 4], 2, async (x) => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, x));
      running--;
      return x * 10;
    });
    assert.deepEqual(out, [50, 10, 30, 20, 40]);
    assert.equal(peak, 2);
  });
});
