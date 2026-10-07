// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Signed requests (slice 54, D-01): the extension's lib/server-auth.js against the vectors
// in docs/reference/http-api.md (the server checks the same ones in router_signed_test.exs)
// and against the tests' own node:crypto server (helpers/kotiko-auth.mjs).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { requireExt, ROOT } from "../helpers/load-script.mjs";
import { serverSignature, signRequest, verifySigned } from "../helpers/kotiko-auth.mjs";

const Auth = requireExt("lib/server-auth.js");
const TOKEN = "example-token-0123456789abcdef";
const DOC = fs.readFileSync(path.join(ROOT, "docs/reference/http-api.md"), "utf8");
const BODY = '{"base_langs":["es","en"],"ui_lang":null}';
const PUT = {
  header: "Kotiko-HMAC v1 ts=1791331200, nonce=q1aP3n0ZKcB1x5mW0u7S9b, body=40921055f301e073c3aa377b5ac7d8827ce72c5443e994014c2087b2895f51ff, mac=osa_O2pBaygJz8c64WTOrTLSiY_6vV70NHtPyZ2CZpA",
  response: "v1 mac=CAmhh5A5suXJTIJNSarztt97Q-RO5eA9K0baiuiw1u0",
};
const GET = "Kotiko-HMAC v1 ts=1791331200, nonce=dE8gH0iL2nO4pQ6rS8tU0v, body=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855, mac=uHVRpP6SeDO3nxpRjs_zp8V9NYSCV2XP15w9BtwCdPg";

describe("signed requests: lib/server-auth.js", () => {
  test("the documented vectors, which the server checks too", async () => {
    const put = await Auth.sign(TOKEN, { method: "put", path: "/api/v1/profile", body: BODY, ts: 1791331200, nonce: "q1aP3n0ZKcB1x5mW0u7S9b" });
    assert.deepEqual(put, { header: PUT.header, nonce: "q1aP3n0ZKcB1x5mW0u7S9b" });
    const get = await Auth.sign(TOKEN, { method: "GET", path: "/api/v1/words?status=active,paused", ts: 1791331200, nonce: "dE8gH0iL2nO4pQ6rS8tU0v" });
    assert.equal(get.header, GET);
    for (const value of [PUT.header, PUT.response, GET]) assert.ok(DOC.includes(value), value);
    assert.equal(await Auth.verifyResponse(TOKEN, "q1aP3n0ZKcB1x5mW0u7S9b", 200, PUT.response), true);
    assert.equal(serverSignature(TOKEN, "q1aP3n0ZKcB1x5mW0u7S9b", 200), PUT.response);
    assert.equal(signRequest(TOKEN, { method: "PUT", target: "/api/v1/profile", body: BODY, ts: 1791331200, nonce: "q1aP3n0ZKcB1x5mW0u7S9b" }), PUT.header);
  });

  test("a request it signs verifies on the server's side; a changed part doesn't", async () => {
    const { header, nonce } = await Auth.sign(TOKEN, { method: "POST", path: "/api/v1/words", body: '{"text":"кот"}' });
    assert.match(nonce, /^[A-Za-z0-9_-]{22}$/, "16 random bytes");
    const req = { method: "POST", target: "/api/v1/words", body: '{"text":"кот"}', authorization: header };
    assert.deepEqual(verifySigned(TOKEN, req), { ok: true, nonce, ts: Number(/ts=(\d+)/.exec(header)[1]) });
    assert.equal(Math.abs(Number(/ts=(\d+)/.exec(header)[1]) - Date.now() / 1000) < 5, true);
    for (const [part, change] of [
      ["method", { method: "PUT" }],
      ["path", { target: "/api/v1/words/batch" }],
      ["body", { body: '{"text":"пёс"}' }],
      ["token", {}, "another-token-0123456789"],
    ]) {
      const out = verifySigned(part === "token" ? "another-token-0123456789" : TOKEN, { ...req, ...change });
      assert.equal(out.ok, false, part);
    }
    // A new nonce every time.
    assert.notEqual((await Auth.sign(TOKEN, { method: "GET", path: "/" })).nonce, (await Auth.sign(TOKEN, { method: "GET", path: "/" })).nonce);
  });

  test("an answer's signature must be the server's, for this nonce and status", async () => {
    const good = serverSignature(TOKEN, "nonce-0123456789abcdefgh", 200);
    assert.equal(await Auth.verifyResponse(TOKEN, "nonce-0123456789abcdefgh", 200, good), true);
    for (const [label, args] of [
      ["missing", [TOKEN, "nonce-0123456789abcdefgh", 200, null]],
      ["another status", [TOKEN, "nonce-0123456789abcdefgh", 404, good]],
      ["another nonce", [TOKEN, "nonce-0123456789abcdefgX", 200, good]],
      ["another token", ["another-token-0123456789", "nonce-0123456789abcdefgh", 200, good]],
      ["malformed", [TOKEN, "nonce-0123456789abcdefgh", 200, good.replace("v1 ", "v2 ")]],
      ["padded", [TOKEN, "nonce-0123456789abcdefgh", 200, `${good}=`]],
    ]) {
      assert.equal(await Auth.verifyResponse(...args), false, label);
    }
  });

  test("the path is the server's: an address with a prefix (a reverse proxy) signs without it", () => {
    assert.equal(Auth.target("http://127.0.0.1:4747", "http://127.0.0.1:4747/api/words?lang=ru,ar"), "/api/words?lang=ru,ar");
    assert.equal(Auth.target("https://box.example/kotiko", "https://box.example/kotiko/api/v1/words/a%20b"), "/api/v1/words/a%20b");
    assert.equal(Auth.target("https://box.example/kotiko", "https://box.example/kotiko"), "/");
    assert.equal(Auth.target("http://127.0.0.1:4747", "http://127.0.0.1:4747/api/v1/words?"), "/api/v1/words", "an empty query is no query, on both sides");
  });

  test("a 401's challenge tells a server from before signed requests from today's", () => {
    assert.deepEqual(Auth.challenge("Bearer"), { signs: false, reason: null });
    assert.deepEqual(Auth.challenge(null), { signs: false, reason: null });
    assert.deepEqual(Auth.challenge("Bearer, Kotiko-HMAC"), { signs: true, reason: null });
    assert.deepEqual(Auth.challenge('Bearer, Kotiko-HMAC error="stale"'), { signs: true, reason: "stale" });
    assert.deepEqual(Auth.challenge("Bearer, Kotiko-HMACX"), { signs: false, reason: null });
  });
});
