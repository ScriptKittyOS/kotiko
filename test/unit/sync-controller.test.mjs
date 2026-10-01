// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
// SPDX-License-Identifier: Apache-2.0

// extension/lib/sync-controller.js with a fake fetchWords whose answers the test settles
// by hand: follow-up collapse, generation discard, abort on credential change, throttle,
// force, timeout and the serialised writer.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { requireExt, sleep } from "../helpers/load-script.mjs";

const { createSyncController } = requireExt("lib/sync-controller.js");

const tick = () => sleep(0);

// A controller whose fetches stay open until the test settles them (or its short timeout
// ends them, so requests a test leaves open don't keep Node running).
function harness({ creds = { serverUrl: "http://x", token: "t" }, timeoutMs = 300, throttleMs } = {}) {
  let t = 1_000_000;
  const calls = []; // { creds, signal, resolve, reject }
  const writes = [];
  const state = { creds };
  const c = createSyncController({
    now: () => t,
    timeoutMs,
    throttleMs,
    readCreds: async () => ({ ...state.creds }),
    fetchWords: (cr, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ creds: cr, signal, resolve, reject });
      }),
    validate: (raw) => raw,
    writeResult: async (r) => {
      writes.push(r);
    },
  });
  return {
    c,
    calls,
    writes,
    state,
    advance: (ms) => void (t += ms),
    ok: (i, words = []) => calls[i].resolve({ ok: true, words }),
  };
}

describe("sync controller", () => {
  test("one request runs once and writes its result", async () => {
    const h = harness();
    const p = h.c.request({ reason: "manual" });
    await tick();
    assert.equal(h.calls.length, 1);
    h.ok(0, ["a"]);
    assert.deepEqual(await p, { ok: true, words: ["a"] });
    assert.deepEqual(h.writes, [{ ok: true, words: ["a"] }]);
  });

  test("requests during a run share exactly one follow-up, which starts after the run", async () => {
    const h = harness();
    const first = h.c.request({ force: true });
    await tick();
    const later = Array.from({ length: 5 }, () => h.c.request({ force: true }));
    await tick();
    assert.equal(h.calls.length, 1, "no second request while the first runs");
    h.ok(0, ["old"]);
    assert.deepEqual(await first, { ok: true, words: ["old"] });
    await tick();
    assert.equal(h.calls.length, 2, "one follow-up");
    h.ok(1, ["new"]);
    for (const p of later) assert.deepEqual(await p, { ok: true, words: ["new"] });
    assert.equal(h.calls.length, 2);
  });

  test("credentialsChanged aborts the running request and never writes its answer", async () => {
    const h = harness({ creds: { serverUrl: "http://x", token: "bad" } });
    const first = h.c.request({ force: true });
    await tick();
    h.state.creds = { serverUrl: "http://x", token: "good" };
    h.c.credentialsChanged();
    await tick();
    assert.equal(h.calls[0].signal.aborted, true);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].creds.token, "good");
    // The old request answering anyway (a fetch that ignores abort) changes nothing.
    h.calls[0].resolve({ ok: false, code: "server_key_rejected" });
    h.ok(1, ["w"]);
    assert.deepEqual(await first, { ok: true, words: ["w"] }, "the first caller gets the new result");
    await tick();
    assert.deepEqual(h.writes, [{ ok: true, words: ["w"] }]);
  });

  test("credentialsChanged also serves a waiting follow-up with the fresh run", async () => {
    const h = harness();
    h.c.request({ force: true });
    await tick();
    const waiting = h.c.request({ force: true });
    h.c.credentialsChanged();
    await tick();
    assert.equal(h.calls.length, 2);
    h.ok(1, ["fresh"]);
    assert.deepEqual(await waiting, { ok: true, words: ["fresh"] });
    await tick();
    assert.equal(h.calls.length, 2, "no extra run for the served follow-up");
  });

  test("a page-load request within the throttle window is skipped unless forced", async () => {
    const h = harness();
    h.c.request({ reason: "page" });
    await tick();
    h.ok(0);
    await tick();
    h.advance(4_999);
    assert.deepEqual(await h.c.request({ reason: "page" }), { ok: true, skipped: true });
    assert.equal(h.calls.length, 1);
    h.c.request({ reason: "page", force: true });
    await tick();
    assert.equal(h.calls.length, 2);
    h.ok(1);
    await tick();
    h.advance(5_001);
    h.c.request({ reason: "page" });
    await tick();
    assert.equal(h.calls.length, 3);
  });

  test("the throttle only applies to page loads", async () => {
    const h = harness();
    h.c.request({ reason: "page" });
    await tick();
    h.ok(0);
    await tick();
    h.c.request({ reason: "alarm" });
    await tick();
    assert.equal(h.calls.length, 2);
  });

  test("a page-load request joins a pending follow-up instead of being skipped", async () => {
    const h = harness();
    h.c.request({ force: true });
    await tick();
    const pending = h.c.request({ force: true });
    const page = h.c.request({ reason: "page" });
    h.ok(0);
    await tick();
    h.ok(1, ["x"]);
    assert.deepEqual(await page, await pending);
  });

  test("no token: writes server_key_rejected (no_token) without a request", async () => {
    const h = harness({ creds: { serverUrl: "http://x", token: "" } });
    const r = await h.c.request({ force: true });
    assert.equal(h.calls.length, 0);
    assert.equal(r.code, "server_key_rejected");
    assert.deepEqual(r.details, { reason: "no_token" });
    assert.deepEqual(h.writes, [r]);
  });

  test("a network error becomes server_unreachable; a coded error keeps its code", async () => {
    const h = harness();
    const a = h.c.request({ force: true });
    await tick();
    h.calls[0].reject(new TypeError("fetch failed"));
    assert.equal((await a).code, "server_unreachable");
    assert.deepEqual((await a).details, { reason: "network" });

    const b = h.c.request({ force: true });
    await tick();
    h.calls[1].reject(Object.assign(new Error("bad address"), { code: "server_address_invalid", details: { hint: "h" } }));
    assert.deepEqual(await b, { ok: false, code: "server_address_invalid", message: "bad address", details: { hint: "h" } });
  });

  test("a request that doesn't answer in time is a timeout, even if fetch ignores the abort", async () => {
    const h = harness({ timeoutMs: 20 });
    const r = h.c.request({ force: true });
    await tick();
    const result = await r;
    assert.equal(h.calls[0].signal.aborted, true);
    assert.equal(result.code, "server_unreachable");
    assert.deepEqual(result.details, { reason: "timeout" });
    assert.deepEqual(h.writes, [result]);
  });

  test("update applies the change, drops the running request's answer and syncs after it", async () => {
    const h = harness();
    const order = [];
    const running = h.c.request({ force: true });
    await tick();
    const updating = h.c.update(async () => order.push("local write"), { reason: "add" });
    await tick();
    assert.deepEqual(order, ["local write"]);
    h.ok(0, ["stale"]);
    await tick();
    assert.equal(h.calls.length, 2, "the follow-up started");
    h.ok(1, ["fresh"]);
    assert.deepEqual(await updating, { ok: true, words: ["fresh"] });
    assert.deepEqual(await running, { ok: true, words: ["fresh"] });
    assert.deepEqual(h.writes, [{ ok: true, words: ["fresh"] }], "the stale answer was never written");
  });

  test("update with nothing running syncs right away", async () => {
    const h = harness();
    const updating = h.c.update(async () => {}, { reason: "remove" });
    await tick();
    await tick();
    assert.equal(h.calls.length, 1);
    h.ok(0, ["w"]);
    assert.deepEqual(await updating, { ok: true, words: ["w"] });
  });

  test("results are written in order through one queue", async () => {
    const writes = [];
    let release;
    const gate = new Promise((r) => (release = r));
    const c = createSyncController({
      readCreds: async () => ({ token: "t" }),
      fetchWords: async () => ({ ok: true, words: ["sync"] }),
      writeResult: async (r) => {
        await gate;
        writes.push(r.words[0]);
      },
    });
    const syncing = c.request({ force: true });
    await tick();
    const local = c.update(async () => writes.push("local"));
    release();
    await syncing;
    await local;
    assert.deepEqual(writes.slice(0, 2), ["sync", "local"]);
  });

  test("request never rejects, even when writing fails", async () => {
    const c = createSyncController({
      readCreds: async () => ({ token: "t" }),
      fetchWords: async () => ({ ok: true, words: [] }),
      writeResult: async () => {
        throw new Error("quota");
      },
    });
    const r = await c.request({ force: true });
    assert.equal(r.code, "internal");
    assert.equal(c.state().running, false);
  });
});
