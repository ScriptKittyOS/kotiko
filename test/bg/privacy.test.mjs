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

function loadBackground({ local = {}, fetch: f = fetch } = {}) {
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
  test("content scripts may only ask for a sync and the sensitive-sites list; every other type refuses them", async () => {
    const bg = loadBackground();
    await bg.k.ready();
    const [listener] = bg.fake.chrome.runtime.onMessage.listeners;
    const routes = listener.routes;
    assert.ok(routes && Object.keys(routes).length > 30, "the router lists its routes");
    const allowed = (kind) => Object.keys(routes).filter((t) => routes[t].includes(kind)).sort();
    assert.deepEqual(allowed("content"), ["sensitiveSites", "sync"]);
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

describe("a secret goes only to the address it was saved for (slice 28 §7)", () => {
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
  const add = async (bg, text) => {
    const res = await bg.send({ type: "add", text }, POPUP);
    return bg.until(() => bg.store.addJobs?.find((j) => j.id === res.job.id && (j.state === "done" || j.state === "waiting" || j.state === "failed")));
  };

  test("a provider address written straight to storage.local gets no key; one a Kotiko page names does", async () => {
    srv.state.log.length = 0;
    evil.state.log.length = 0;
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    // "Another service" (no key required) at the good address, with a key, from the settings page.
    await bg.send({ type: "backend.set", lookup: { kind: "provider", provider: "custom", baseUrl: srv.llmUrl } });
    await bg.send({ type: "secrets.set", id: "provider:custom", value: KEY });
    assert.equal((await add(bg, "shukran")).state, "done");
    assert.ok(chats(srv).length >= 1 && chats(srv).every((r) => r.auth === `Bearer ${KEY}`));

    // What a content script can do: rewrite the settings in storage.local.
    await bg.fake.chrome.storage.local.set({ lookup: { ...bg.store.lookup, baseUrl: evil.llmUrl } });
    await bg.fake.idle();
    await add(bg, "sobaka");
    assert.ok(evil.state.log.length >= 1, "the lookup went to the new address (the settings say so)");
    assert.ok(evil.state.log.every((r) => r.auth === null), "but never with the key");

    // A page that names the address (the settings page's field) moves the key with it. (A
    // background request started before this may still arrive without it, so: some, not all.)
    await bg.send({ type: "backend.set", lookup: { baseUrl: evil.llmUrl } });
    assert.equal((await add(bg, "kniga")).state, "done");
    assert.ok(chats(evil).some((r) => r.auth === `Bearer ${KEY}`));
  });

  test("a preset that needs its key sends nothing at all to a rewritten address", async () => {
    srv.state.log.length = 0;
    evil.state.log.length = 0;
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    await bg.send({ type: "backend.set", lookup: { kind: "provider", provider: "openrouter", baseUrl: srv.llmUrl } });
    await bg.send({ type: "secrets.set", id: "provider:openrouter", value: KEY });
    await bg.fake.chrome.storage.local.set({ lookup: { ...bg.store.lookup, baseUrl: evil.llmUrl } });
    await bg.fake.idle();
    const job = await add(bg, "shukran");
    assert.equal(job.state, "waiting");
    assert.equal(job.error.code, "lookup_not_set_up");
    assert.deepEqual(evil.state.log, []);
    // Changing only the model or the data setting from a page doesn't bless the rewritten address.
    await bg.send({ type: "backend.set", lookup: { dataCollection: "deny" } });
    await bg.send({ type: "jobs.retry", id: job.id }, POPUP);
    await bg.fake.idle();
    await sleep(50);
    assert.deepEqual(evil.state.log, []);
  });

  test("an upgrade binds the token it moves into the store to the address it was used with", async () => {
    const bg = loadBackground({ local: { serverUrl: srv.kotikoUrl, token: srv.token, words: [] } });
    await bg.k.ready();
    const store = await bg.k.getStore();
    assert.equal(await store.meta.get("secretOrigin:server"), new URL(srv.kotikoUrl).origin);
    assert.equal(bg.store.token, undefined);
  });

  test("a token written with an address goes to that address; removing it forgets the binding", async () => {
    const bg = loadBackground({ local: { baseLangs: ["en"] } });
    await bg.k.ready();
    await bg.send({ type: "server.connect", url: srv.kotikoUrl, token: srv.token });
    const store = await bg.k.getStore();
    assert.equal(await store.meta.get("secretOrigin:server"), new URL(srv.kotikoUrl).origin);
    await bg.send({ type: "secrets.remove", id: "server" });
    assert.equal(await store.meta.get("secretOrigin:server"), null);
  });
});
