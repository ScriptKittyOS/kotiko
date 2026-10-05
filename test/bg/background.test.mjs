// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// background.js in a vm context with a fake `chrome`, a fake clock and a stubbed fetch
// (or the local fixture server).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { startFixtureServer } from "../helpers/fixture-server.mjs";
import { manifest, readExt, runInVm, sleep } from "../helpers/load-script.mjs";

const WORDS = [
  { id: 2, lang: "ru", language: "Russian", native: "дом", romanization: "dom", english: "house", forms: ["house"], note: null },
  { id: 1, lang: "ar", language: "Arabic", native: "شكرا", romanization: "shukran", english: "thanks", forms: ["thanks"], note: null },
];

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// A fetch stub that records requests and answers with `handler(url, init)`.
function stubFetch(handler) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method ?? "GET", headers: { ...init.headers }, body: init.body, cache: init.cache });
    return handler(String(url), init);
  };
  return { fetch, requests };
}

const EXT_ID = "fake-extension-id";
// Who sends a message: the toolbar popup, a content script in a web page, an extension
// page opened in a tab, and another extension.
const SENDERS = {
  popup: { id: EXT_ID, url: `chrome-extension://${EXT_ID}/popup.html` },
  content: { id: EXT_ID, url: "https://example.com/", tab: { id: 1, url: "https://example.com/" }, frameId: 0 },
  pageInTab: { id: EXT_ID, url: `chrome-extension://${EXT_ID}/popup.html`, tab: { id: 2, url: `chrome-extension://${EXT_ID}/popup.html` } },
  otherExtension: { id: "another-extension", url: "chrome-extension://another-extension/page.html" },
};
const POPUP = SENDERS.popup;

function loadBackground({ local = {}, fetch, alarms = null, globals = {} } = {}) {
  const fake = createFakeChrome({
    runtimeId: EXT_ID,
    local: { serverUrl: "http://127.0.0.1:4999", token: "good-token", ...local },
  });
  if (alarms) for (const a of alarms) fake.alarms.set(a.name, a);
  runInVm("background.js", { chrome: fake.chrome, fetch, Date: fake.clock.Date, ...globals });
  return {
    fake,
    store: fake.store.local,
    // Content-script sender by default, like a page load; pass POPUP for popup actions.
    send: (msg, sender) => fake.deliver(msg, sender),
  };
}

// A server that looks words up and keeps them, as the add queue uses it (slice 24): the
// preview finds `found`, the batch saves it (calling `onSave`); other requests go to `rest`.
function lookupServer(found, rest, onSave = () => {}) {
  return stubFetch(async (url, init) => {
    if (url.endsWith("/api/v1/words") && init.method === "POST") return json(200, { candidates: found.map((w) => ({ ...w, id: undefined })), rejected: [] });
    if (url.endsWith("/api/v1/words/batch")) {
      await onSave();
      return json(200, { results: found.map((word, index) => ({ result: "created", word, index })), rejected: [] });
    }
    if (url.endsWith("/api/v1/llm/status")) return json(404, { error: { code: "not_found" } });
    return rest(url, init);
  });
}
const v1 = (n, native, gloss, extra = {}) => ({ id: `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`, lang: "ru", native, gloss, base_lang: "en", forms: [{ text: gloss, enabled: true }], ...extra });
const JOB = "01900000-0000-7000-8000-00000000f000";

// Waits until an add job (slice 24) reaches one of `states`.
async function settled(fake, store, id, states = ["done", "failed", "waiting", "needs_choice"]) {
  for (let i = 0; i < 200; i++) {
    await fake.idle();
    const j = (store.addJobs ?? []).find((x) => x.id === id);
    if (j && states.includes(j.state)) return j;
    await sleep(5);
  }
  throw new Error(`job ${id} never settled: ${JSON.stringify(store.addJobs)}`);
}

const serverWith = (words) => stubFetch((url, init) => {
  if ((init.method ?? "GET") === "GET") return json(200, { words });
  return json(404, { error: "No such route." });
});

describe("sync", () => {
  test("writes the server's words, the sync time and clears the error", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { send, store, fake } = loadBackground({ fetch, local: { syncError: "old error" } });
    assert.deepEqual(await send({ type: "sync", force: true }), { ok: true });
    assert.deepEqual(store.words, WORDS);
    assert.equal(store.lastSync, fake.clock.now());
    assert.equal(store.syncError, null);
    assert.deepEqual(requests.map((r) => [r.method, r.url]), [["GET", "http://127.0.0.1:4999/api/words"]]);
    assert.equal(requests[0].headers.Authorization, "Bearer good-token");
    assert.equal(requests[0].cache, "no-store");
  });

  test("trims the token and trailing slashes on the address", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { send } = loadBackground({ fetch, local: { serverUrl: " http://127.0.0.1:4999// ", token: "  tok \n" } });
    await send({ type: "sync", force: true });
    assert.equal(requests[0].url, "http://127.0.0.1:4999/api/words");
    assert.equal(requests[0].headers.Authorization, "Bearer tok");
  });

  test("doesn't rewrite unchanged words, so open tabs don't redo work", async () => {
    const { fetch } = serverWith(WORDS);
    const { send, fake } = loadBackground({ fetch, local: { words: WORDS } });
    await send({ type: "sync", force: true });
    // (The one-time upgrade writes its settings too; none of those writes is `words`.)
    const writes = fake.calls.set.filter((c) => c.area === "local" && "lastSync" in c.items);
    assert.equal(writes.length, 1);
    assert.equal(fake.calls.set.some((c) => "words" in c.items), false);
  });

  test("skips a page-load sync within 5 s of the last one, unless forced", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { send, fake } = loadBackground({ fetch });
    await send({ type: "sync" });
    assert.equal(requests.length, 1);
    fake.clock.advance(4000);
    await send({ type: "sync" });
    assert.equal(requests.length, 1, "too soon");
    await send({ type: "sync", force: true });
    assert.equal(requests.length, 2, "forced");
    fake.clock.advance(5001);
    await send({ type: "sync" });
    assert.equal(requests.length, 3, "after 5 s");
  });

  test("a sync requested during another waits for a fresh run, not the old answer", async () => {
    let calls = 0;
    const { fetch } = stubFetch(async () => {
      calls++;
      await sleep(30);
      return json(200, { words: WORDS });
    });
    const { send } = loadBackground({ fetch });
    await Promise.all([send({ type: "sync", force: true }), send({ type: "sync", force: true })]);
    assert.equal(calls, 2);
  });

  test("five syncs requested during one run cause exactly one follow-up request", async () => {
    let calls = 0;
    const { fetch } = stubFetch(async () => {
      calls++;
      await sleep(40);
      return json(200, { words: WORDS });
    });
    const { send } = loadBackground({ fetch });
    const first = send({ type: "sync", force: true });
    await sleep(10);
    await Promise.all([first, ...Array.from({ length: 5 }, () => send({ type: "sync", force: true }, POPUP))]);
    assert.equal(calls, 2);
  });

  const failures = [
    ["rejected token", {}, () => new Response("unauthorized", { status: 401 }), { code: "server_key_rejected", details: { status: 401 } }],
    ["server error with a message", {}, () => json(500, { error: "Database is locked." }), { code: "internal", details: { status: 500, error: "Database is locked." } }],
    ["server error without one", {}, () => new Response("<h1>Bad gateway</h1>", { status: 502 }), { code: "internal", details: { status: 502 } }],
    ["unreachable", {}, () => Promise.reject(new TypeError("fetch failed")), { code: "server_unreachable", details: { reason: "network" } }],
    ["a missing route", {}, () => new Response("not found", { status: 404 }), { code: "not_kotiko_server", details: { status: 404 } }],
    ["a host check failure", {}, () => new Response("misdirected", { status: 421 }), { code: "server_address_invalid", details: { status: 421 } }],
  ];
  for (const [name, local, handler, expected] of failures) {
    test(`reports ${name} as a sync error and keeps the cached words`, async () => {
      const { fetch, requests } = stubFetch(handler ?? (() => json(200, { words: [] })));
      const { send, store, fake } = loadBackground({ fetch, local: { words: WORDS, ...local } });
      await send({ type: "sync", force: true });
      assert.equal(store.syncError.code, expected.code);
      assert.deepEqual(store.syncError.details, expected.details);
      assert.equal(typeof store.syncError.message, "string");
      assert.equal(store.syncError.at, fake.clock.now());
      assert.deepEqual(store.words, WORDS);
      assert.equal(store.lastSync, undefined);
      if (!handler) assert.equal(requests.length, 0);
    });
  }
});

describe("a profile with no token (slice 11: words in this browser)", () => {
  test("syncing asks no server, reports no error, and pages keep the cached words", async () => {
    const { fetch, requests } = serverWith([]);
    const { send, store, fake } = loadBackground({ fetch, local: { words: WORDS, token: "" } });
    await send({ type: "sync", force: true });
    await sleep(150);
    await fake.idle();
    assert.equal(requests.length, 0);
    assert.equal(store.syncError, undefined);
    assert.equal(store.wordsHome, "local");
    assert.deepEqual(store.words.map((w) => w.native), WORDS.map((w) => w.native));
    assert.deepEqual(store.words.map((w) => w.forms), WORDS.map((w) => w.forms));
  });
});

describe("triggers", () => {
  test("install keeps the one-minute alarm and syncs", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { fake, store } = loadBackground({ fetch });
    await fake.fireInstalled();
    await fake.idle();
    await sleep(10);
    assert.deepEqual(await fake.chrome.alarms.get("kotiko-sync"), {
      name: "kotiko-sync",
      scheduledTime: fake.clock.now() + 60_000,
      periodInMinutes: 1,
    });
    assert.equal(requests.length, 1);
    assert.deepEqual(store.words, WORDS);
  });

  test("an update clears the alarm from before the rename; an install doesn't need to", async () => {
    const OLD_ALARM = "slovo-sync"; // legacy-name-ok
    const { fetch } = serverWith(WORDS);
    const old = { name: OLD_ALARM, scheduledTime: 123, periodInMinutes: 1 };
    const { fake } = loadBackground({ fetch, alarms: [old] });
    await fake.fireInstalled({ reason: "install" });
    await sleep(10);
    assert.ok(await fake.chrome.alarms.get(OLD_ALARM));
    await fake.fireInstalled({ reason: "update", previousVersion: "0.2.0" });
    await sleep(10);
    assert.equal(await fake.chrome.alarms.get(OLD_ALARM), undefined);
    assert.ok(await fake.chrome.alarms.get("kotiko-sync"));
  });

  test("browser start-up does the same", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { fake } = loadBackground({ fetch });
    await fake.fireStartup();
    await sleep(10);
    assert.ok(await fake.chrome.alarms.get("kotiko-sync"));
    assert.equal(requests.length, 1);
  });

  test("the alarm syncs; other alarms don't", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { fake } = loadBackground({ fetch });
    await fake.fireAlarm("something-else");
    await sleep(10);
    assert.equal(requests.length, 0);
    await fake.fireAlarm("kotiko-sync");
    await sleep(10);
    assert.equal(requests.length, 1);
  });

  test("changing the token or address syncs; other settings don't", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { fake } = loadBackground({ fetch });
    await fake.chrome.storage.local.set({ enabled: false, hiddenLangs: ["ru"] });
    await fake.idle();
    await sleep(10);
    assert.equal(requests.length, 0);
    await fake.chrome.storage.local.set({ token: "new-token" });
    await fake.idle();
    await sleep(10);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.Authorization, "Bearer new-token");
  });

  test("ignores messages it doesn't know", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { send } = loadBackground({ fetch });
    assert.equal(await send({ type: "nope" }), undefined);
    assert.equal(await send(null), undefined);
    assert.equal(requests.length, 0);
  });
});

describe("add and remove relay", () => {
  // Slice 24: a server that looks words up and keeps them goes through the add queue too.
  const UUID = "01900000-0000-7000-8000-00000000d000";
  const v1Word = (native, gloss, extra = {}) => ({ id: `01900000-0000-7000-8000-${String(native.length).padStart(12, "0")}`, lang: "ja", native, gloss, base_lang: "en", forms: [{ text: gloss, enabled: true }], updated_at: "2026-10-05T10:00:00.000Z", ...extra });

  test("add is a job: the server's lookup, then the save under the job's id, then a re-sync", async () => {
    const inu = v1Word("犬", "dog");
    const { fetch, requests } = stubFetch((url, init) => {
      if (url.endsWith("/api/v1/words") && init.method === "POST") return json(200, { candidates: [{ ...inu, id: undefined }], rejected: [] });
      if (url.endsWith("/api/v1/words/batch")) return json(200, { results: [{ result: "created", word: inu, index: 0 }], rejected: [] });
      if (url.endsWith("/api/v1/llm/status")) return json(404, { error: { code: "not_found" } });
      return json(200, { words: WORDS });
    });
    const { send, store, fake } = loadBackground({ fetch });
    assert.deepEqual(await send({ type: "add", id: UUID, text: "dog in japanese" }, POPUP), { ok: true, job: { id: UUID, state: "queued" } });
    const job = await settled(fake, store, UUID);
    assert.equal(job.state, "done");
    assert.deepEqual(job.results.map((r) => [r.result, r.word.native, r.wordId]), [["created", "犬", inu.id]]);
    const posts = requests.filter((r) => r.method === "POST").map((r) => [r.url.replace("http://127.0.0.1:4999", ""), JSON.parse(r.body)]);
    assert.deepEqual(posts[0], ["/api/v1/words", { text: "dog in japanese", preview: true, base_langs: ["en"] }]);
    assert.equal(posts[1][0], "/api/v1/words/batch");
    assert.equal(posts[1][1].client_request_id, UUID, "the job's id is the idempotency key");
    assert.equal(requests[0].headers.Authorization, "Bearer good-token");
  });

  test("a lookup that fails reads as the job's state: a 502 fails with its status, a used-up quota waits for its retry time", async () => {
    const retryAt = "2030-10-03T00:00:00.000Z";
    for (const [answer, want] of [
      [json(502, { error: { code: "http_error", message: "The language model failed" } }), (j) => j.state === "failed" && j.error.details.status === 502],
      [json(429, { error: { code: "quota_exhausted", message: "Used up.", details: { reason: "daily_limit", retry_at: retryAt, provider: "openrouter" } } }), (j) => j.state === "waiting" && j.error.code === "quota_exhausted" && j.error.details.retry_at === retryAt],
    ]) {
      const { fetch } = stubFetch((url, init) => (url.endsWith("/api/v1/words") && init.method === "POST" ? answer.clone() : json(404, { error: { code: "not_found" } })));
      const { send, store, fake } = loadBackground({ fetch });
      await send({ type: "add", id: UUID, text: "x" }, POPUP);
      const job = await settled(fake, store, UUID);
      assert.ok(want(job), JSON.stringify(job));
    }
  });

  test("Undo removes a created word and puts an updated one back, by its v1 id; a word changed since is refused", async () => {
    const created = v1Word("犬", "dog");
    const previous = v1Word("猫", "cat");
    const updated = { ...previous, forms: [...previous.forms, { text: "kitty", enabled: true }], updated_at: "2026-10-05T11:00:00.000Z" };
    let stale = false;
    const { fetch, requests } = stubFetch((url, init) => {
      if (url.endsWith("/api/v1/words") && init.method === "POST") return json(200, { candidates: [created, previous].map((w) => ({ ...w, id: undefined })), rejected: [] });
      if (url.endsWith("/api/v1/words/batch")) return json(200, { results: [{ result: "created", word: created, index: 0 }, { result: "updated", word: updated, previous, index: 1 }], rejected: [] });
      if (init.method === "DELETE") return json(200, { word: { ...created, deleted_at: "x" } });
      if (init.method === "PATCH") return stale ? json(409, { error: { code: "word_conflict", message: "This word changed since.", details: { reason: "stale" } } }) : json(200, { word: previous });
      if (init.method === "POST" && url.endsWith("/restore")) return json(200, { word: created });
      return json(200, { words: WORDS });
    });
    const { send, store, fake } = loadBackground({ fetch });
    await send({ type: "add", id: UUID, text: "dog and cat" }, POPUP);
    await settled(fake, store, UUID);
    assert.deepEqual(await send({ type: "jobs.undo", id: UUID, key: "ja\u001f犬" }, POPUP), { ok: true });
    const del = requests.find((r) => r.method === "DELETE");
    assert.equal(del.url, `http://127.0.0.1:4999/api/v1/words/${created.id}`, "the v1 route, never /api/words/:number");
    assert.equal(store.addJobs[0].results[0].undo, "done");
    assert.deepEqual(await send({ type: "jobs.redo", id: UUID, key: "ja\u001f犬" }, POPUP), { ok: true });
    assert.ok(requests.some((r) => r.url.endsWith(`/api/v1/words/${created.id}/restore`)));
    assert.equal(store.addJobs[0].results[0].undo, null, "back to Added, with its Undo");

    stale = true;
    const res = await send({ type: "jobs.undo", id: UUID, key: "ja\u001f猫" }, POPUP);
    assert.equal(res.code, "word_conflict");
    const patch = JSON.parse(requests.find((r) => r.method === "PATCH").body);
    assert.equal(patch.if_updated_at, updated.updated_at, "only the version the add made");
    assert.deepEqual(patch.forms, previous.forms, "the previous forms exactly");
    assert.deepEqual([store.addJobs[0].results[1].undo, store.addJobs[0].results[1].undoError.code], ["failed", "word_conflict"]);
  });

  test("offline: a lookup that can't reach anything waits as offline, not as a busy model", async () => {
    const { fetch } = stubFetch((url, init) => (init.method === "POST" ? Promise.reject(new TypeError("Failed to fetch")) : json(200, { words: WORDS })));
    const { send, store, fake } = loadBackground({ fetch, globals: { navigator: { onLine: false } } });
    await send({ type: "add", id: UUID, text: "x" }, POPUP);
    const job = await settled(fake, store, UUID);
    assert.deepEqual([job.state, job.error.code], ["waiting", "offline"]);
  });

  test("llmStatus keeps the free lookups left in storage; adds refresh it; an older server clears it", async () => {
    const quota = { used: 12, limit: 50, remaining: 38, resets_at: "2026-10-03T00:00:00.000Z", estimated: false };
    let remaining = 38;
    let route = true;
    const { fetch, requests } = stubFetch((url, init) => {
      if (url.endsWith("/api/v1/llm/status")) {
        if (!route) return json(404, { error: { code: "not_found", message: "No such route." } });
        return json(200, { provider: "openrouter", models: ["a:free"], quota: { ...quota, remaining }, last_result: "ok" });
      }
      if (init.method === "POST") {
        remaining--;
        return json(200, { words: [] , reply: "nothing" });
      }
      return json(200, { words: WORDS });
    });
    const { send, store, fake } = loadBackground({ fetch });
    const res = await send({ type: "llmStatus" }, POPUP);
    assert.equal(res.quota.remaining, 38);
    assert.deepEqual(store.lookupStatus, { provider: "openrouter", quota, at: fake.clock.now() });
    assert.equal(requests.at(-1).headers.Authorization, "Bearer good-token");

    await send({ type: "add", text: "x" }, POPUP);
    await sleep(20);
    await fake.idle();
    assert.equal(store.lookupStatus.quota.remaining, 37);

    route = false;
    assert.equal((await send({ type: "llmStatus" }, POPUP)).code, "server_outdated");
    assert.equal(store.lookupStatus, null);
    assert.equal((await send({ type: "llmStatus" }, SENDERS.content)).error.code, "forbidden");
  });

  test("remove deletes by id, re-syncs and answers ok", async () => {
    let words = WORDS;
    const { fetch, requests } = stubFetch((url, init) => {
      if (init.method === "DELETE") {
        words = words.filter((w) => `${w.id}` !== url.split("/").pop());
        return json(200, { ok: true });
      }
      return json(200, { words });
    });
    const { send, store } = loadBackground({ fetch, local: { words: WORDS } });
    assert.deepEqual(await send({ type: "remove", id: 2 }, POPUP), { ok: true });
    assert.deepEqual(requests.map((r) => [r.method, r.url]), [
      ["DELETE", "http://127.0.0.1:4999/api/words/2"],
      ["GET", "http://127.0.0.1:4999/api/words"],
    ]);
    assert.deepEqual(store.words, [WORDS[1]]);
  });

  test("remove encodes the id into the path", async () => {
    const { fetch, requests } = stubFetch(() => json(404, { error: "No such word." }));
    const { send } = loadBackground({ fetch });
    assert.deepEqual(await send({ type: "remove", id: "1/../x?y" }, POPUP), { error: "No such word.", code: "http_error", details: { status: 404 } });
    assert.equal(requests[0].url, "http://127.0.0.1:4999/api/words/1%2F..%2Fx%3Fy");
  });
});

describe("against the fixture server", () => {
  let srv;
  before(async () => {
    srv = await startFixtureServer();
  });
  after(() => srv.close());

  test("sync, add and Undo round-trip through the fake Kotiko API", async () => {
    srv.reset();
    const { send, store, fake } = loadBackground({ fetch, local: { serverUrl: srv.kotikoUrl, token: srv.token } });
    await send({ type: "sync", force: true });
    assert.equal(store.syncError, null);
    assert.deepEqual(store.words, srv.state.words);

    await send({ type: "add", id: JOB, text: "sobaka" }, POPUP);
    const job = await settled(fake, store, JOB);
    assert.equal(job.results[0].word.native, "собака");
    assert.equal(store.words[0].native, "собака");

    assert.deepEqual(await send({ type: "jobs.undo", id: JOB, key: "ru\u001fсобака" }, POPUP), { ok: true });
    assert.equal(store.words.some((w) => w.native === "собака"), false);
  });

  test("control switches surface as sync errors", async () => {
    srv.reset();
    const { send, store } = loadBackground({ fetch, local: { serverUrl: srv.kotikoUrl, token: srv.token } });
    for (const [mode, code] of [
      ["401", "server_key_rejected"],
      ["500", "internal"],
      ["html", "not_kotiko_server"],
    ]) {
      srv.state.kotiko = mode;
      await send({ type: "sync", force: true });
      assert.equal(store.syncError?.code, code, mode);
    }
    assert.equal(store.syncError.details.error, undefined);
    srv.state.kotiko = "500";
    await send({ type: "sync", force: true });
    assert.equal(store.syncError.details.error, "Something broke on the fake server.");
    srv.state.kotiko = null;
    await send({ type: "sync", force: true });
    assert.equal(store.syncError, null);
  });
});

// Research 06 findings fixed by slice 26 (background sync correctness).
describe("sync correctness (slice 26)", () => {
  test("F10: an add during an in-flight sync still lands in the cache", async () => {
    let serverWords = [{ ...WORDS[0], id: 1, native: "old" }];
    const { fetch } = lookupServer([v1(2, "new", "house")], async () => {
      const snapshot = serverWords;
      await sleep(150);
      return json(200, { words: snapshot });
    }, async () => {
      await sleep(20);
      serverWords = [{ ...WORDS[0], id: 2, native: "new" }, ...serverWords];
    });
    const { send, store, fake } = loadBackground({ fetch });
    const syncing = send({ type: "sync", force: true });
    await sleep(5);
    await send({ type: "add", id: JOB, text: "new" }, POPUP);
    await settled(fake, store, JOB);
    await syncing;
    await sleep(200);
    await fake.idle();
    assert.deepEqual(store.words.map((w) => w.native), ["new", "old"]);
  });

  test("F11: saving a new token during an in-flight sync uses the new token", async () => {
    const { fetch } = stubFetch(async (url, init) => {
      const bad = init.headers.Authorization.endsWith("bad");
      await sleep(bad ? 150 : 5);
      return bad ? new Response("unauthorized", { status: 401 }) : json(200, { words: WORDS });
    });
    const { send, store, fake } = loadBackground({ fetch, local: { token: "bad" } });
    send({ type: "sync", force: true });
    await sleep(10);
    await fake.chrome.storage.local.set({ token: "good" });
    await fake.idle();
    await sleep(250);
    assert.equal(store.syncError, null);
    assert.ok(store.lastSync);
  });

  test("F31: a 200 that isn't a Kotiko answer is an error, not an empty sync", async () => {
    const { fetch } = stubFetch(() => new Response("<!doctype html><p>Captive portal</p>", { status: 200, headers: { "content-type": "text/html" } }));
    const { send, store } = loadBackground({ fetch, local: { words: WORDS } });
    await send({ type: "sync", force: true });
    assert.ok(store.syncError, "reports an error");
    assert.equal(store.lastSync, undefined, "doesn't claim a sync");
    assert.deepEqual(store.words, WORDS, "keeps the cached words");
  });

  for (const address of ["localhost:4747", "192.168.1.5:4747"]) {
    test(`F32: a server address without a scheme gets http:// (${address})`, async () => {
      const { fetch, requests } = serverWith(WORDS);
      const { send } = loadBackground({ fetch, local: { serverUrl: address } });
      await send({ type: "sync", force: true });
      assert.equal(requests[0]?.url, `http://${address}/api/words`);
    });
  }

  test("F39: the sync alarm exists without an install or start-up event", async () => {
    const { fetch } = serverWith(WORDS);
    const { fake } = loadBackground({ fetch });
    await sleep(10);
    assert.ok(await fake.chrome.alarms.get("kotiko-sync"), "re-enabling the extension fires neither event");
  });
  test("F10: undo during an in-flight sync removes the word from the cache", async () => {
    let serverWords = WORDS;
    const { fetch } = stubFetch(async (url, init) => {
      if (init.method === "DELETE") {
        await sleep(20);
        serverWords = serverWords.filter((w) => `${w.id}` !== url.split("/").pop());
        return json(200, { ok: true });
      }
      const snapshot = serverWords;
      await sleep(150);
      return json(200, { words: snapshot });
    });
    const { send, store } = loadBackground({ fetch, local: { words: WORDS } });
    const syncing = send({ type: "sync", force: true });
    await sleep(5);
    await send({ type: "remove", id: 2 }, POPUP);
    await syncing;
    await sleep(200);
    assert.deepEqual(store.words.map((w) => w.id), [1]);
  });

  test("F10: an added word is in the cache as soon as it's saved", async () => {
    const added = v1(9, "собака", "dog");
    let gets = 0;
    const { fetch } = lookupServer([added], async () => {
      gets++;
      await sleep(100);
      return json(200, { words: [{ ...WORDS[0], id: 9, native: "собака", english: "dog", forms: ["dog"] }, ...WORDS] });
    });
    const { send, store, fake } = loadBackground({ fetch, local: { words: WORDS } });
    send({ type: "add", id: JOB, text: "dog" }, POPUP);
    for (let i = 0; i < 100 && !store.words.some((w) => w.native === "собака"); i++) await sleep(5);
    assert.deepEqual(store.words.map((w) => w.native), ["собака", "дом", "شكرا"], "merged before the follow-up sync answers");
    assert.equal(store.words[0].english, "dog", "in the cache's shape");
    await sleep(150);
    await fake.idle();
    assert.equal(gets, 1);
    assert.deepEqual(store.words.map((w) => w.id), [9, 2, 1], "then the sync's answer, without a duplicate");
  });

  test("F11: the old request is aborted and its 401 never shows", async () => {
    const seen = [];
    const fetch = (url, init) => {
      const token = init.headers.Authorization.slice("Bearer ".length);
      const entry = { token, aborted: false };
      seen.push(entry);
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          entry.aborted = true;
          reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
        });
        setTimeout(
          () => resolve(token === "bad" ? new Response("unauthorized", { status: 401 }) : json(200, { words: WORDS })),
          token === "bad" ? 100 : 5,
        );
      });
    };
    const { send, store, fake } = loadBackground({ fetch, local: { token: "bad", words: [] } });
    const first = send({ type: "sync", force: true }, POPUP);
    // Change the token only once the first request is really in flight: the token now
    // comes from the secrets store, so how soon that request starts depends on the machine.
    for (let i = 0; i < 200 && seen.length === 0; i++) await sleep(5);
    assert.equal(seen.length, 1, "the first sync started");
    await fake.chrome.storage.local.set({ token: "good" });
    await fake.idle();
    assert.deepEqual(await first, { ok: true });
    await sleep(150);
    assert.deepEqual(seen.map((s) => [s.token, s.aborted]), [["bad", true], ["good", false]]);
    assert.equal(store.syncError, null);
    assert.deepEqual(store.words, WORDS);
    assert.ok(store.lastSync);
    const errors = fake.calls.set.filter((c) => c.area === "local" && c.items.syncError);
    assert.deepEqual(errors, [], "the stale 401 was never written");
  });

  test("F11: a new server address also restarts the sync", async () => {
    const { fetch, requests } = stubFetch(async (url) => {
      await sleep(url.includes(":4999") ? 100 : 5);
      return json(200, { words: url.includes(":4999") ? [] : WORDS });
    });
    const { send, store, fake } = loadBackground({ fetch });
    send({ type: "sync", force: true });
    for (let i = 0; i < 200 && requests.length === 0; i++) await sleep(5);
    assert.equal(requests.length, 1, "the first sync started");
    await fake.chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5000" });
    await fake.idle();
    await sleep(150);
    assert.deepEqual(requests.map((r) => r.url), ["http://127.0.0.1:4999/api/words", "http://127.0.0.1:5000/api/words"]);
    assert.deepEqual(store.words, WORDS);
  });

  test("F31: the fixture server's captive portal is not a word list", async () => {
    const srv = await startFixtureServer();
    try {
      srv.state.kotiko = "html";
      const { send, store } = loadBackground({ fetch, local: { serverUrl: srv.kotikoUrl, token: srv.token, words: WORDS } });
      await send({ type: "sync", force: true });
      assert.equal(store.syncError.code, "not_kotiko_server");
      assert.equal(store.lastSync, undefined);
      assert.deepEqual(store.words, WORDS);
    } finally {
      await srv.close();
    }
  });

  const notWordLists = [
    ["an empty object", {}],
    ["words that aren't a list", { words: "дом" }],
    ["null", null],
  ];
  for (const [name, body] of notWordLists) {
    test(`F31: JSON with ${name} is not a word list`, async () => {
      const { fetch } = stubFetch(() => json(200, body));
      const { send, store } = loadBackground({ fetch, local: { words: WORDS } });
      await send({ type: "sync", force: true });
      assert.equal(store.syncError.code, "not_kotiko_server");
      assert.deepEqual(store.words, WORDS);
    });
  }

  test("E2: invalid words are dropped and counted, the rest are cached", async () => {
    const bad = [
      { ...WORDS[0], id: 10, forms: [3], english: undefined },
      { ...WORDS[0], id: 11, native: "x".repeat(10_240) },
      { ...WORDS[0], id: 12, lang: "" },
    ];
    const { fetch } = serverWith([...WORDS, ...bad]);
    const warnings = [];
    const { send, store } = loadBackground({ fetch, globals: { console: { ...console, warn: (...a) => warnings.push(a) } } });
    await send({ type: "sync", force: true });
    assert.deepEqual(store.words, WORDS);
    assert.equal(store.syncError, null);
    assert.equal(store.syncWarnings.dropped, 3);
    assert.deepEqual(store.syncWarnings.reasons, { bad_forms: 1, bad_native: 1, bad_lang: 1 });
    assert.equal(warnings.length, 1, "logged once for the maintainer");
  });

  test("E2: a clean sync clears earlier warnings", async () => {
    const { fetch } = serverWith(WORDS);
    const { send, store } = loadBackground({ fetch, local: { syncWarnings: { dropped: 1, reasons: { bad_forms: 1 } } } });
    await send({ type: "sync", force: true });
    assert.equal(store.syncWarnings, null);
  });

  test("E2: words from an add are checked before they're merged", async () => {
    const good = v1(20, "кот", "cat");
    const bad = v1(21, "пёс", "dog", { forms: [3], gloss: undefined });
    const { fetch } = lookupServer([good, bad], async () => {
      await sleep(500);
      return json(200, { words: WORDS });
    });
    const { send, store, fake } = loadBackground({ fetch, local: { words: WORDS } });
    await send({ type: "add", id: JOB, text: "two" }, POPUP);
    for (let i = 0; i < 100 && !store.words.some((w) => w.native === "кот"); i++) await sleep(5);
    assert.deepEqual(store.words.map((w) => w.native), ["кот", "дом", "شكرا"]);
    const job = await settled(fake, store, JOB);
    assert.deepEqual(job.results.map((r) => r.word.native), ["кот", "пёс"], "the job keeps the server's answer");
  });

  const addresses = [
    ["localhost:4747/", "http://localhost:4747/api/words"],
    ["[::1]:4747", "http://[::1]:4747/api/words"],
    ["100.101.102.103:4747", "http://100.101.102.103:4747/api/words"],
    ["kotiko.tail1234.ts.net", "https://kotiko.tail1234.ts.net/api/words"],
    ["https://example.test/words-server/", "https://example.test/words-server/api/words"],
  ];
  for (const [address, url] of addresses) {
    test(`F32: the address ${address} is normalised before the request`, async () => {
      const { fetch, requests } = serverWith(WORDS);
      const { send } = loadBackground({ fetch, local: { serverUrl: address } });
      await send({ type: "sync", force: true });
      assert.equal(requests[0]?.url, url);
    });
  }

  for (const address of ["http://user:pw@127.0.0.1:4747", "ftp://127.0.0.1", "http://127.0.0.1:4747/?x=1", "http:/127.0.0.1"]) {
    test(`F32: ${address} is reported as an invalid address, without a request`, async () => {
      const { fetch, requests } = serverWith(WORDS);
      const { send, store } = loadBackground({ fetch, local: { serverUrl: address, words: WORDS } });
      await send({ type: "sync", force: true });
      assert.equal(requests.length, 0);
      assert.equal(store.syncError.code, "server_address_invalid");
      assert.ok(store.syncError.details.hint);
      assert.deepEqual(store.words, WORDS);
    });
  }

  test("a sync that gets no answer in 20 s is reported as a timeout", async () => {
    const timers = [];
    // Shorten the 20 s timer so the test doesn't wait for it.
    const fastTimeout = (fn, ms, ...args) => {
      timers.push(ms);
      return setTimeout(fn, ms >= 20_000 ? 20 : ms, ...args);
    };
    const { fetch } = stubFetch(() => new Promise(() => {}));
    const { send, store } = loadBackground({ fetch, local: { words: WORDS }, globals: { setTimeout: fastTimeout } });
    await send({ type: "sync", force: true });
    assert.ok(timers.includes(20_000));
    assert.equal(store.syncError.code, "server_unreachable");
    assert.deepEqual(store.syncError.details, { reason: "timeout" });
    assert.deepEqual(store.words, WORDS);
  });

  test("F39: re-enabling (a worker start with no alarms) recreates the alarm", async () => {
    const { fetch } = serverWith(WORDS);
    const { fake } = loadBackground({ fetch, alarms: [] });
    await sleep(10);
    assert.deepEqual(await fake.chrome.alarms.get("kotiko-sync"), {
      name: "kotiko-sync",
      scheduledTime: fake.clock.now() + 60_000,
      periodInMinutes: 1,
    });
  });

  test("F39: an existing alarm is kept, not rescheduled, on worker start and start-up", async () => {
    const { fetch } = serverWith(WORDS);
    const existing = { name: "kotiko-sync", scheduledTime: 123, periodInMinutes: 1 };
    const { fake } = loadBackground({ fetch, alarms: [existing] });
    await fake.fireStartup();
    await sleep(10);
    assert.deepEqual(await fake.chrome.alarms.get("kotiko-sync"), existing);
    assert.equal(fake.calls.alarms.length, 0);
  });
});

describe("message senders (research 03 E3)", () => {
  const ADD = { type: "add", text: "dog" };
  const REMOVE = { type: "remove", id: 2 };
  const FORBIDDEN = { error: { code: "forbidden" } };

  test("a content script can't add or remove words, and the server hears nothing", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { send } = loadBackground({ fetch });
    assert.deepEqual(await send(ADD, SENDERS.content), FORBIDDEN);
    assert.deepEqual(await send(REMOVE, SENDERS.content), FORBIDDEN);
    assert.equal(requests.length, 0);
  });

  test("another extension can't do anything", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { send } = loadBackground({ fetch });
    for (const msg of [ADD, REMOVE, { type: "sync", force: true }]) {
      assert.deepEqual(await send(msg, SENDERS.otherExtension), FORBIDDEN, msg.type);
    }
    assert.equal(requests.length, 0);
  });

  test("a content script in a non-web page (file:, data:) can't sync", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { send } = loadBackground({ fetch });
    const fileSender = { id: EXT_ID, url: "file:///home/me/notes.html", tab: { id: 3 } };
    assert.deepEqual(await send({ type: "sync" }, fileSender), FORBIDDEN);
    assert.equal(requests.length, 0);
  });

  test("content scripts and the popup can sync", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { send } = loadBackground({ fetch });
    assert.deepEqual(await send({ type: "sync" }, SENDERS.content), { ok: true });
    assert.deepEqual(await send({ type: "sync", force: true }, SENDERS.popup), { ok: true });
    assert.equal(requests.length, 2);
  });

  test("the popup, and an extension page in a tab, can add", async () => {
    const { fetch } = lookupServer([v1(3, "дом", "house")], () => json(200, { words: WORDS }));
    const { send } = loadBackground({ fetch });
    for (const sender of [SENDERS.popup, SENDERS.pageInTab]) {
      const res = await send(ADD, sender);
      assert.deepEqual(Object.keys(res), ["ok", "job"]);
      assert.equal(res.job.state, "queued");
    }
  });

  const badPayloads = [
    ["empty text", { type: "add", text: "" }],
    ["text over 200 characters", { type: "add", text: "x".repeat(201) }],
    ["text that isn't a string", { type: "add", text: ["dog"] }],
    ["an id that's an object", { type: "remove", id: { toString: "2" } }],
    ["an id that's a fraction", { type: "remove", id: 1.5 }],
    ["a missing id", { type: "remove" }],
  ];
  for (const [name, msg] of badPayloads) {
    test(`rejects ${name} without calling the server`, async () => {
      const { fetch, requests } = serverWith(WORDS);
      const { send } = loadBackground({ fetch });
      const res = await send(msg, POPUP);
      assert.equal(res.error.code, "invalid_message");
      assert.equal(requests.length, 0);
    });
  }

  test("text of exactly 200 characters is fine", async () => {
    const { fetch } = serverWith(WORDS);
    const { send } = loadBackground({ fetch });
    assert.equal((await send({ type: "add", text: "x".repeat(200) }, POPUP)).ok, true);
  });
});

describe("language tags (slice 08)", () => {
  test("on update, languages hidden under an old code stay hidden under the canonical one", async () => {
    const { fake, store } = loadBackground({ fetch: () => Promise.reject(new TypeError("offline")), local: { hiddenLangs: ["cmn", "iw", "zh", "ja", "not a tag"] } });
    await fake.fireInstalled({ reason: "update", previousVersion: "0.2.0" });
    await fake.idle();
    await sleep(10);
    assert.deepEqual(store.hiddenLangs, ["zh", "he", "ja", "not a tag"]);
  });

  test("a fresh install leaves hidden languages alone", async () => {
    const { fake, store } = loadBackground({ fetch: () => Promise.reject(new TypeError("offline")), local: { hiddenLangs: ["cmn"] } });
    await fake.fireInstalled({ reason: "install" });
    await fake.idle();
    await sleep(10);
    assert.deepEqual(store.hiddenLangs, ["cmn"]);
  });
});

describe("loading", () => {
  test("Firefox's background.scripts lists the same libraries, in the same order, as importScripts", () => {
    const listed = manifest().background.scripts;
    const imported = [...readExt("background.js").matchAll(/importScripts\(([^)]*)\)/g)]
      .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    assert.deepEqual(listed, [...imported, "background.js"]);
    assert.equal(manifest().background.service_worker, "background.js");
  });
});

describe("toolbar badge (slice 20 §5)", () => {
  function withAction(local = {}) {
    const fake = createFakeChrome({
      runtimeId: EXT_ID,
      local: { serverUrl: "http://127.0.0.1:4999", token: "", ...local },
      tabs: [
        { id: 1, active: true, url: "https://en.wikipedia.org/wiki/Cat" },
        { id: 2, active: false, url: "https://example.com/" },
      ],
    });
    const badges = new Map();
    const titles = new Map();
    fake.chrome.action = {
      setBadgeText: async ({ tabId, text }) => void badges.set(tabId, text),
      setBadgeBackgroundColor: async () => {},
      setTitle: async ({ tabId, title }) => void titles.set(tabId, title),
    };
    fake.chrome.i18n = { getMessage: (k) => ({ badge_off: "off", action_title: "Kotiko", action_title_off: "Kotiko · off", action_title_paused: "Kotiko · paused on {host}", ui_locale: "en" })[k] ?? "" };
    runInVm("background.js", { chrome: fake.chrome, fetch: () => Promise.reject(new TypeError("offline")), Date: fake.clock.Date });
    return { fake, badges, titles };
  }

  test("pausing a site marks its tabs off, and turning Kotiko off marks every tab", async () => {
    const { fake, badges, titles } = withAction();
    await fake.idle();
    await sleep(10);
    assert.equal(badges.get(1), "");
    await fake.chrome.storage.local.set({ pausedHosts: ["en.wikipedia.org"] });
    await fake.idle();
    await sleep(10);
    assert.equal(badges.get(1), "off");
    assert.equal(badges.get(2), "");
    assert.equal(titles.get(1), "Kotiko · paused on en.wikipedia.org");
    await fake.chrome.storage.local.set({ enabled: false, pausedHosts: [] });
    await fake.idle();
    await sleep(10);
    assert.deepEqual([badges.get(1), badges.get(2)], ["off", "off"]);
    assert.equal(titles.get(2), "Kotiko · off");
  });
});
