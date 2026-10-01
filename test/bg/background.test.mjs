// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
// SPDX-License-Identifier: Apache-2.0

// background.js in a vm context with a fake `chrome`, a fake clock and a stubbed fetch
// (or the local fixture server).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { startFixtureServer } from "../helpers/fixture-server.mjs";
import { runInVm, sleep } from "../helpers/load-script.mjs";

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

function loadBackground({ local = {}, fetch } = {}) {
  const fake = createFakeChrome({
    local: { serverUrl: "http://127.0.0.1:4999", token: "good-token", ...local },
  });
  runInVm("background.js", { chrome: fake.chrome, fetch, Date: fake.clock.Date });
  return {
    fake,
    store: fake.store.local,
    send: (msg, sender) => fake.deliver(msg, sender),
  };
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
    const writes = fake.calls.set.filter((c) => c.area === "local");
    assert.equal(writes.length, 1);
    assert.equal("words" in writes[0].items, false);
    assert.ok(writes[0].items.lastSync);
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

  test("shares one request between overlapping syncs", async () => {
    let calls = 0;
    const { fetch } = stubFetch(async () => {
      calls++;
      await sleep(30);
      return json(200, { words: WORDS });
    });
    const { send } = loadBackground({ fetch });
    await Promise.all([send({ type: "sync", force: true }), send({ type: "sync", force: true })]);
    assert.equal(calls, 1);
  });

  const failures = [
    ["no token", { token: "" }, null, "Paste your API token to connect."],
    ["rejected token", {}, () => new Response("unauthorized", { status: 401 }), "The server rejected that API token."],
    ["server error with a message", {}, () => json(500, { error: "Database is locked." }), "Database is locked."],
    ["server error without one", {}, () => new Response("<h1>Bad gateway</h1>", { status: 502 }), "The server answered 502."],
    ["unreachable", {}, () => Promise.reject(new TypeError("fetch failed")), "Can't reach http://127.0.0.1:4999. Is the server running?"],
  ];
  for (const [name, local, handler, message] of failures) {
    test(`reports ${name} as a sync error and keeps the cached words`, async () => {
      const { fetch, requests } = stubFetch(handler ?? (() => json(200, { words: [] })));
      const { send, store } = loadBackground({ fetch, local: { words: WORDS, ...local } });
      await send({ type: "sync", force: true });
      assert.equal(store.syncError, message);
      assert.deepEqual(store.words, WORDS);
      assert.equal(store.lastSync, undefined);
      if (!handler) assert.equal(requests.length, 0);
    });
  }
});

describe("triggers", () => {
  test("install creates the one-minute alarm and syncs", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { fake, store } = loadBackground({ fetch });
    await fake.fireInstalled();
    await fake.idle();
    await sleep(10);
    assert.deepEqual(await fake.chrome.alarms.get("slovo-sync"), {
      name: "slovo-sync",
      scheduledTime: fake.clock.now() + 60_000,
      periodInMinutes: 1,
    });
    assert.equal(requests.length, 1);
    assert.deepEqual(store.words, WORDS);
  });

  test("browser start-up does the same", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { fake } = loadBackground({ fetch });
    await fake.fireStartup();
    await sleep(10);
    assert.ok(await fake.chrome.alarms.get("slovo-sync"));
    assert.equal(requests.length, 1);
  });

  test("the alarm syncs; other alarms don't", async () => {
    const { fetch, requests } = serverWith(WORDS);
    const { fake } = loadBackground({ fetch });
    await fake.fireAlarm("something-else");
    await sleep(10);
    assert.equal(requests.length, 0);
    await fake.fireAlarm("slovo-sync");
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
  test("add posts the text, re-syncs and answers with the server's reply", async () => {
    const added = { id: 3, lang: "ja", language: "Japanese", native: "犬", romanization: "inu", english: "dog", forms: ["dog"], note: null };
    let words = WORDS;
    const { fetch, requests } = stubFetch((url, init) => {
      if (init.method === "POST") {
        words = [added, ...words];
        return json(200, { words: [added] });
      }
      return json(200, { words });
    });
    const { send, store } = loadBackground({ fetch });
    const res = await send({ type: "add", text: "dog in japanese" });
    assert.deepEqual(res, { words: [added] });
    assert.deepEqual(requests.map((r) => r.method), ["POST", "GET"]);
    assert.equal(requests[0].url, "http://127.0.0.1:4999/api/words");
    assert.equal(requests[0].headers["Content-Type"], "application/json");
    assert.equal(requests[0].headers.Authorization, "Bearer good-token");
    assert.deepEqual(JSON.parse(requests[0].body), { text: "dog in japanese" });
    assert.deepEqual(store.words, [added, ...WORDS]);
  });

  test("add passes the server's error back to the popup", async () => {
    const { fetch } = stubFetch(() => json(502, { error: "The language model failed: rate limited" }));
    const { send } = loadBackground({ fetch });
    assert.deepEqual(await send({ type: "add", text: "x" }), { error: "The language model failed: rate limited" });
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
    assert.deepEqual(await send({ type: "remove", id: 2 }), { ok: true });
    assert.deepEqual(requests.map((r) => [r.method, r.url]), [
      ["DELETE", "http://127.0.0.1:4999/api/words/2"],
      ["GET", "http://127.0.0.1:4999/api/words"],
    ]);
    assert.deepEqual(store.words, [WORDS[1]]);
  });

  test("remove encodes the id into the path", async () => {
    const { fetch, requests } = stubFetch(() => json(404, { error: "No such word." }));
    const { send } = loadBackground({ fetch });
    assert.deepEqual(await send({ type: "remove", id: "1/../x?y" }), { error: "No such word." });
    assert.equal(requests[0].url, "http://127.0.0.1:4999/api/words/1%2F..%2Fx%3Fy");
  });
});

describe("against the fixture server", () => {
  let srv;
  before(async () => {
    srv = await startFixtureServer();
  });
  after(() => srv.close());

  test("sync, add and remove round-trip through the fake Mira API", async () => {
    srv.reset();
    const { send, store } = loadBackground({ fetch, local: { serverUrl: srv.miraUrl, token: srv.token } });
    await send({ type: "sync", force: true });
    assert.equal(store.syncError, null);
    assert.deepEqual(store.words, srv.state.words);

    const res = await send({ type: "add", text: "sobaka" });
    assert.equal(res.words[0].native, "собака");
    assert.equal(store.words[0].native, "собака");

    assert.deepEqual(await send({ type: "remove", id: res.words[0].id }), { ok: true });
    assert.equal(store.words.some((w) => w.native === "собака"), false);
  });

  test("control switches surface as sync errors", async () => {
    srv.reset();
    const { send, store } = loadBackground({ fetch, local: { serverUrl: srv.miraUrl, token: srv.token } });
    for (const [mode, message] of [
      ["401", "The server rejected that API token."],
      ["500", "Something broke on the fake server."],
    ]) {
      srv.state.mira = mode;
      await send({ type: "sync", force: true });
      assert.equal(store.syncError, message, mode);
    }
  });
});

// Research 06 findings for slice 26 (background sync correctness). The assertions
// describe the fixed behaviour; they fail today.
describe("sync correctness (slice 26)", () => {
  test("F10: an add during an in-flight sync still lands in the cache", { todo: "slice 26: chain a sync after the in-flight one" }, async () => {
    let serverWords = [{ ...WORDS[0], id: 1, native: "old" }];
    const { fetch } = stubFetch(async (url, init) => {
      if (init.method === "POST") {
        await sleep(20);
        serverWords = [{ ...WORDS[0], id: 2, native: "new" }, ...serverWords];
        return json(200, { words: [serverWords[0]] });
      }
      const snapshot = serverWords;
      await sleep(150);
      return json(200, { words: snapshot });
    });
    const { send, store } = loadBackground({ fetch });
    const syncing = send({ type: "sync", force: true });
    await sleep(5);
    await send({ type: "add", text: "new" });
    await syncing;
    assert.deepEqual(store.words.map((w) => w.native), ["new", "old"]);
  });

  test("F11: saving a new token during an in-flight sync uses the new token", { todo: "slice 26: abort and restart on credential change" }, async () => {
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

  test("F31: a 200 that isn't a Mira answer is an error, not an empty sync", { todo: "slice 26: validate the response body" }, async () => {
    const { fetch } = stubFetch(() => new Response("<!doctype html><p>Captive portal</p>", { status: 200, headers: { "content-type": "text/html" } }));
    const { send, store } = loadBackground({ fetch, local: { words: WORDS } });
    await send({ type: "sync", force: true });
    assert.ok(store.syncError, "reports an error");
    assert.equal(store.lastSync, undefined, "doesn't claim a sync");
    assert.deepEqual(store.words, WORDS, "keeps the cached words");
  });

  for (const address of ["localhost:4747", "192.168.1.5:4747"]) {
    test(`F32: a server address without a scheme gets http:// (${address})`, { todo: "slice 26: normalise the address" }, async () => {
      const { fetch, requests } = serverWith(WORDS);
      const { send } = loadBackground({ fetch, local: { serverUrl: address } });
      await send({ type: "sync", force: true });
      assert.equal(requests[0]?.url, `http://${address}/api/words`);
    });
  }

  test("F39: the sync alarm exists without an install or start-up event", { todo: "slice 26: ensure the alarm at top level" }, async () => {
    const { fetch } = serverWith(WORDS);
    const { fake } = loadBackground({ fetch });
    await sleep(10);
    assert.ok(await fake.chrome.alarms.get("slovo-sync"), "re-enabling the extension fires neither event");
  });
});
