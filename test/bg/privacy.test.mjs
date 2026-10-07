// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 28 §7 in the real background.js (vm, fake chrome, fake-indexeddb): every message
// type refuses senders it doesn't list (enumerated from the router itself, so a new type is
// covered the day it's added), and a secret is only ever sent to the address it was saved
// for. Content scripts can write storage.local, where the settings that say where requests
// go live; an address written there by anything but a Kotiko page must never receive the
// provider key or the server token. The real-browser half is test/e2e/privacy.spec.mjs.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { startFixtureServer } from "../helpers/fixture-server.mjs";
import { runInVm, sleep } from "../helpers/load-script.mjs";

const EXT_ID = "fake-extension-id";
const PAGE = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/dashboard.html`, tab: { id: 3, url: `chrome-extension://${EXT_ID}/dashboard.html` } };
const POPUP = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/popup.html` };
const CONTENT = { id: EXT_ID, url: "https://example.com/", tab: { id: 1, url: "https://example.com/" } };
const DOCS = { id: EXT_ID, url: "https://kotiko.org/connected/", tab: { id: 4, url: "https://kotiko.org/connected/" } };
const OTHER_EXTENSION = { id: "another-extension", url: "chrome-extension://another-extension/page.html" };
const KEY = "sk-or-v1-0123456789abcdef0123456789abcdefa1b2";

// Real requests reach the fixture servers; the built-in local services' addresses (Ollama,
// LM Studio) are answered here, so a test never talks to one running on this computer.
const LOCAL_SERVICES = /^http:\/\/(localhost|127\.0\.0\.1):(11434|1234)\//;
const offline = (url, init) => (LOCAL_SERVICES.test(String(url)) ? Promise.reject(new TypeError("Failed to fetch")) : fetch(url, init));

function loadBackground({ local = {}, fetch: f = offline } = {}) {
  const fake = createFakeChrome({ runtimeId: EXT_ID, local });
  const ctx = runInVm("background.js", { chrome: fake.chrome, fetch: f });
  return {
    fake,
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

describe("who may send what (slice 28 §7 item 4)", () => {
  test("content scripts may only ask for a sync and the sensitive-sites list, and mark a word never to swap; every other type refuses them", async () => {
    const bg = loadBackground();
    await bg.k.ready();
    const [listener] = bg.fake.chrome.runtime.onMessage.listeners;
    const routes = listener.routes;
    assert.ok(routes && Object.keys(routes).length > 30, "the router lists its routes");
    const allowed = (kind) => Object.keys(routes).filter((t) => routes[t].includes(kind)).sort();
    assert.deepEqual(allowed("content"), ["neverSwap", "sensitiveSites", "sync"]);
    assert.deepEqual(allowed("docs"), ["oauth.code"]);
    for (const type of Object.keys(routes)) {
      if (!routes[type].includes("content")) assert.deepEqual(await bg.send({ type }, CONTENT), { error: { code: "forbidden" } }, `content: ${type}`);
      // The docs site's page is a content script too; it gets only its one route.
      if (!routes[type].includes("content") && !routes[type].includes("docs")) assert.deepEqual(await bg.send({ type }, DOCS), { error: { code: "forbidden" } }, `docs: ${type}`);
      assert.deepEqual(await bg.send({ type }, OTHER_EXTENSION), { error: { code: "forbidden" } }, `another extension: ${type}`);
    }
    assert.deepEqual(await (await bg.k.getStore()).secrets.ids(), []);
  });
});

describe("requests go only where a Kotiko page said (slice 28 §7)", () => {
  let srv;
  let evil;
  before(async () => {
    srv = await startFixtureServer();
    evil = await startFixtureServer();
  });
  after(async () => {
    await srv.close();
    await evil.close();
  });

  const chats = (s) => s.state.log.filter((r) => r.path === "/llm/v1/chat/completions");
  const reset = () => {
    srv.state.log.length = 0;
    evil.state.log.length = 0;
  };
  const add = async (bg, text, states = ["done", "waiting", "failed"], ms = 5000) => {
    const res = await bg.send({ type: "add", text }, POPUP);
    return bg.until(() => bg.store.addJobs?.find((j) => j.id === res.job.id && states.includes(j.state)), ms);
  };
  // An add that may first wait: right after a rewrite, the lookup can be refused
  // (address_changed) before the trusted address is put back, and then finishes once the
  // queue wakes. Wait for the end, not the first pause.
  // Under a full parallel run the queue's wake-up can take a few seconds.
  const finished = (bg, text) => add(bg, text, ["done", "failed"], 20_000);
  // Waiting jobs keep a retry timer; cancel them so the test file can end.
  const FINISHED = new Set(["done", "failed", "cancelled"]);
  const settle = async (bg) => {
    await bg.until(async () => {
      const open = (bg.store.addJobs ?? []).filter((j) => !FINISHED.has(j.state));
      for (const j of open) await bg.send({ type: "jobs.cancel", id: j.id }, POPUP);
      return !open.length;
    });
    // A cancel leaves the queue's retry timer; one more pass clears it.
    await bg.k.queue.kick();
  };
  // What a content script can do: write the settings in storage.local.
  const poison = async (bg, patch) => {
    await bg.fake.chrome.storage.local.set(patch);
    await bg.fake.idle();
  };

  test("a hidden address planted for a hosted service, then the key pasted: the key never leaves for it", async () => {
    // The dashboard hides the address field for OpenAI, so the learner can't see a planted one.
    const requests = [];
    // Every request is recorded and refused at once (a 401 isn't retried).
    const record = async (url, init = {}) => {
      requests.push({ url: String(url), auth: init.headers?.Authorization ?? null });
      return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
    };
    const bg = loadBackground({ local: { baseLangs: ["en"] }, fetch: record });
    await bg.k.ready();
    // The learner picks OpenAI in the settings (no address: the field is hidden for it).
    await bg.send({ type: "backend.set", lookup: { kind: "provider", provider: "openai", baseUrl: null } });
    await poison(bg, { lookup: { ...bg.store.lookup, baseUrl: "https://evil.example/v1" } });
    await bg.send({ type: "secrets.set", id: "provider:openai", value: KEY });
    await add(bg, "shukran");
    await bg.send({ type: "backend.test" });
    await bg.fake.idle();
    assert.ok(requests.length >= 1, "the add and the Test did go out, to OpenAI");
    assert.ok(requests.every((r) => !r.url.includes("evil.example")), JSON.stringify(requests));
    assert.ok(requests.filter((r) => r.auth).every((r) => r.url.startsWith("https://api.openai.com/v1/")), "the key goes only to OpenAI's own address");
    assert.equal(bg.store.lookup.baseUrl, null, "the planted address is taken back out of the settings");
    await settle(bg);
  });

  test("a service switched from a content script (to one the learner has a key for) gets nothing; the choice is put back", async () => {
    const requests = [];
    const record = async (url, init = {}) => {
      requests.push({ url: String(url), auth: init.headers?.Authorization ?? null });
      return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
    };
    const bg = loadBackground({ local: { baseLangs: ["en"] }, fetch: record });
    await bg.k.ready();
    // A key saved for OpenAI earlier, but the learner now uses Ollama on this computer.
    await bg.send({ type: "secrets.set", id: "provider:openai", value: KEY });
    await bg.send({ type: "backend.set", lookup: { kind: "provider", provider: "ollama", baseUrl: null } });
    await poison(bg, { lookup: { ...bg.store.lookup, provider: "openai", baseUrl: null } });
    await add(bg, "sobaka");
    await bg.fake.idle();
    assert.ok(requests.every((r) => !r.url.startsWith("https://api.openai.com/")), JSON.stringify(requests));
    await bg.until(() => bg.store.lookup.provider === "ollama");
    await settle(bg);
  });

  test("a keyless local service (Ollama) pointed elsewhere gets no request at all", async () => {
    reset();
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    await bg.send({ type: "backend.set", lookup: { kind: "provider", provider: "ollama", baseUrl: null } });
    await poison(bg, { lookup: { ...bg.store.lookup, baseUrl: evil.llmUrl } });
    await add(bg, "sobaka");
    await bg.send({ type: "backend.test" });
    await bg.fake.idle();
    assert.deepEqual(evil.state.log, []);
    assert.equal(bg.store.lookup.baseUrl, null);
    await settle(bg);
  });

  test("a custom address rewritten: nothing goes there, and the add finishes at the address the page chose", async () => {
    reset();
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    await bg.send({ type: "backend.set", lookup: { kind: "provider", provider: "custom", baseUrl: srv.llmUrl } });
    await bg.send({ type: "secrets.set", id: "provider:custom", value: KEY });
    await poison(bg, { lookup: { ...bg.store.lookup, baseUrl: evil.llmUrl } });
    assert.equal((await finished(bg, "shukran")).state, "done");
    assert.deepEqual(evil.state.log, []);
    assert.ok(chats(srv).length >= 1 && chats(srv).every((r) => r.auth === `Bearer ${KEY}`));
    assert.equal(bg.store.lookup.baseUrl, srv.llmUrl.replace(/\/+$/, ""));

    // A page that names the address (the settings field) moves the route and the key there.
    await bg.send({ type: "backend.set", lookup: { baseUrl: evil.llmUrl } });
    assert.equal((await finished(bg, "kniga")).state, "done");
    assert.ok(chats(evil).length >= 1 && chats(evil).every((r) => r.auth === `Bearer ${KEY}`));
    // Let this background's own work finish, so none of it reaches the next test's log.
    await settle(bg);
  });

  test("a 0.2 token and address planted after the upgrade are removed, never used", async () => {
    reset();
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    await poison(bg, { token: "planted-token", serverUrl: evil.kotikoUrl });
    await bg.send({ type: "sync", force: true }, CONTENT);
    // Wait for the removal itself, not a fixed time (it can lag under a full parallel run).
    await bg.until(() => bg.store.token === undefined && bg.store.serverUrl === undefined);
    await bg.fake.idle();
    // This background has no provider key; an earlier test's late lookup may still land on
    // the shared fixture, so look only for what a planted token or address would cause.
    assert.deepEqual(evil.state.log.filter((r) => r.auth === "Bearer planted-token" || r.path.startsWith("/kotiko/")), []);
    assert.equal(bg.store.token, undefined);
    assert.equal(bg.store.serverUrl, undefined);
    assert.equal(bg.store.wordsHome, "local");
    assert.deepEqual(await (await bg.k.getStore()).secrets.ids(), []);
  });

  test("the upgrade adopts a 0.2 token once and trusts the address it was used with", async () => {
    const bg = loadBackground({ local: { serverUrl: srv.kotikoUrl, token: srv.token, words: [] } });
    await bg.k.ready();
    const store = await bg.k.getStore();
    assert.equal(await store.meta.get("route:server"), srv.kotikoUrl);
    assert.equal(await store.secrets.get("server"), srv.token);
    assert.equal(bg.store.token, undefined);
  });

  test("a server address planted before the token is pasted: the token goes only where a page said", async () => {
    reset();
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    await bg.send({ type: "server.connect", url: srv.kotikoUrl });
    await poison(bg, { server: { url: evil.kotikoUrl } });
    await bg.send({ type: "server.connect", token: srv.token });
    await bg.send({ type: "sync", force: true });
    await bg.fake.idle();
    assert.deepEqual(evil.state.log, []);
    assert.equal(bg.store.server.url, srv.kotikoUrl);
  });
});

describe("after slice 12's delete everything, the routes start over like a new install", () => {
  let srv;
  before(async () => {
    srv = await startFixtureServer();
  });
  after(() => srv.close());

  test("with the bindings gone, the built-in addresses are trusted and a page can connect again", async () => {
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    await bg.send({ type: "server.connect", url: srv.kotikoUrl, token: srv.token });
    // What the wipe leaves: no settings, no secrets, no route bindings.
    const store = await bg.k.getStore();
    for (const key of ["route:server", "route:lookupProvider", "routesBound"]) await store.meta.set(key, null);
    await bg.send({ type: "secrets.remove", id: "server" });
    await bg.fake.chrome.storage.local.clear();
    await bg.fake.idle();
    srv.state.log.length = 0;
    await bg.send({ type: "sync", force: true }, CONTENT);
    assert.deepEqual(srv.state.log, [], "nothing to send without a token");
    await bg.send({ type: "server.connect", url: srv.kotikoUrl, token: srv.token });
    await bg.send({ type: "sync", force: true });
    await bg.fake.idle();
    // Signed with the token, which itself never goes out (slice 54, D-01).
    assert.ok(srv.state.log.some((r) => r.signed));
    assert.ok(!srv.state.log.some((r) => r.auth?.includes(srv.token)));
  });
});

describe("a new install keeps nothing a page planted before its first start (slice 28 §7)", () => {
  test("a 0.2 token, address and word list found on a fresh install are dropped", async () => {
    const requests = [];
    const fetch = async (url, init = {}) => {
      requests.push({ url: String(url), auth: init.headers?.Authorization ?? null });
      return new Response(JSON.stringify({ words: [] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const planted = [{ id: 1, lang: "ru", language: "Russian", native: "дом", english: "house", forms: ["house"], note: null }];
    const bg = loadBackground({ local: { serverUrl: "http://127.0.0.1:6666", token: "planted-token", words: planted }, fetch });
    await bg.fake.fireInstalled({ reason: "install" });
    await bg.until(() => bg.store.wordsHome === "local" && bg.store.server?.url === "http://127.0.0.1:4747");
    const store = await bg.k.getStore();
    assert.deepEqual(await store.secrets.ids(), []);
    assert.deepEqual(await store.list(), []);
    // From then on nothing goes to the planted address.
    const seen = requests.length;
    await bg.send({ type: "sync", force: true }, CONTENT);
    await bg.fake.idle();
    await sleep(50);
    assert.deepEqual(requests.slice(seen).filter((r) => r.url.includes(":6666")), []);
  });
});

// Slice 54, B-01: browsers try [::1] first for `localhost`, where another account on the
// computer can listen while Kotiko's server listens on 127.0.0.1 only; the first request
// carries the token. An address saved as localhost before this version is moved to
// 127.0.0.1 on update, with the route it is bound to, and nothing is sent to localhost.
describe("localhost becomes 127.0.0.1 (slice 54, B-01)", () => {
  let srv;
  before(async () => {
    srv = await startFixtureServer();
  });
  after(() => srv.close());

  test("an install that saved http://localhost:PORT keeps syncing, at 127.0.0.1, after the update", async () => {
    const sent = [];
    const f = (url, init = {}) => {
      sent.push({ url: String(url), auth: init.headers?.Authorization ?? null });
      return fetch(String(url).replace("://localhost:", "://127.0.0.1:"), init);
    };
    const bg = loadBackground({ fetch: f });
    await bg.k.ready();
    const port = new URL(srv.kotikoUrl).port;
    const typed = `http://localhost:${port}/kotiko`;
    // What the version before saved: the address as typed, bound to its route, and the token.
    const store = await bg.k.getStore();
    await bg.k.seed({ wordsHome: "server", server: { url: typed }, keys: { server: true, providers: {} }, lookup: { kind: "provider", provider: "ollama", baseUrl: null, model: null, dataCollection: "allow" } });
    await store.meta.set("route:server", typed);
    await store.meta.set("route:lookup:ollama", "http://localhost:11434/v1");
    await store.meta.set("route:lookupProvider", "ollama");
    await store.secrets.set("server", srv.token);
    bg.fake.fireInstalled({ reason: "update", previousVersion: "1.0.0" });
    await bg.until(() => bg.store.server?.url === `http://127.0.0.1:${port}/kotiko`);
    assert.equal(await store.meta.get("route:server"), `http://127.0.0.1:${port}/kotiko`);
    assert.equal(await store.meta.get("route:lookup:ollama"), "http://127.0.0.1:11434/v1");
    sent.length = 0;
    assert.deepEqual(await bg.send({ type: "sync", force: true }, POPUP), { ok: true });
    await bg.until(() => sent.some((r) => r.auth?.startsWith("Kotiko-HMAC ")) && srv.state.log.some((r) => r.signed));
    assert.ok(!sent.some((r) => r.auth?.includes(srv.token)));
    assert.deepEqual(sent.filter((r) => new URL(r.url).hostname === "localhost"), [], "nothing goes to localhost");
    assert.equal(bg.store.syncError ?? null, null);
  });

  test("a server address typed as localhost is saved, bound and used as 127.0.0.1", async () => {
    const sent = [];
    const f = (url, init = {}) => {
      sent.push({ url: String(url), auth: init.headers?.Authorization ?? null });
      return fetch(String(url).replace("://localhost:", "://127.0.0.1:"), init);
    };
    const bg = loadBackground({ fetch: f });
    await bg.k.ready();
    const port = new URL(srv.kotikoUrl).port;
    const r = await bg.send({ type: "server.connect", url: `localhost:${port}/kotiko`, token: srv.token });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(bg.store.server.url, `http://127.0.0.1:${port}/kotiko`);
    assert.equal(await (await bg.k.getStore()).meta.get("route:server"), `http://127.0.0.1:${port}/kotiko`);
    await bg.send({ type: "sync", force: true }, POPUP);
    await bg.until(() => sent.some((x) => x.auth?.startsWith("Kotiko-HMAC ")) && srv.state.log.some((x) => x.signed));
    assert.ok(!sent.some((x) => x.auth?.includes(srv.token)));
    assert.deepEqual(sent.filter((x) => new URL(x.url).hostname === "localhost"), []);
  });
});

// Slice 54, C-07: the languages read from the browser's settings stay on the device (the
// policy's "What stays on your device"). A fresh install wrote them, and the list made from
// them, to storage.sync, which the browser syncs to the learner's account, before the learner
// had confirmed anything. Now storage.sync gets `ui` only once the learner confirms, and never
// the browser's languages (`baseLangsDetected`).
describe("the browser's languages stay on the device (slice 54, C-07)", () => {
  test("nothing reaches storage.sync before the learner confirms; then the list, never what was detected", async () => {
    const fake = createFakeChrome({ runtimeId: EXT_ID });
    fake.chrome.i18n = { ...(fake.chrome.i18n ?? {}), getUILanguage: () => "en-US", getAcceptLanguages: async () => ["en-US", "de-CH", "ja", "tr"], getMessage: fake.chrome.i18n?.getMessage ?? (() => "") };
    fake.chrome.tabs.create = async () => {};
    const ctx = runInVm("background.js", { chrome: fake.chrome, fetch: offline });
    await ctx.__kotiko.ready();
    fake.fireInstalled({ reason: "install" });
    const until = async (fn) => {
      for (const end = Date.now() + 5000; !(await fn()); await sleep(20)) if (Date.now() > end) throw new Error("timed out waiting");
    };
    await until(async () => fake.store.local.ui?.baseLangsDetected);
    await fake.idle();
    assert.deepEqual(JSON.parse(JSON.stringify(fake.store.local.ui.baseLangsDetected)), ["en", "de", "ja"], "detected, kept here");
    assert.equal(fake.store.sync.ui, undefined, "nothing synced before the learner confirms");
    // The learner unticks one on the welcome page: still not confirmed, still not synced.
    await fake.deliver({ type: "settings.set", merge: { ui: { baseLangs: ["en", "de"] } }, set: { baseLangs: ["en", "de"] } }, PAGE);
    await fake.idle();
    assert.equal(fake.store.sync.ui, undefined);
    // The first word (or Skip) confirms: now the list follows the learner's other browsers.
    await fake.deliver({ type: "settings.set", merge: { ui: { baseLangs: ["en", "de"], baseLangsConfirmed: true } } }, PAGE);
    await until(async () => fake.store.sync.ui);
    assert.deepEqual(JSON.parse(JSON.stringify(fake.store.sync.ui)), { uiLang: "auto", baseLangs: ["en", "de"], baseLangsConfirmed: true });
    assert.ok(!fake.calls.set.some((c) => c.area === "sync" && c.items.ui?.baseLangsDetected), "the browser's languages never went to storage.sync");
  });
});
