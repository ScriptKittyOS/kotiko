// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Signed requests (slice 54, D-01; the boot id, security review E-01): the extension's
// lib/server-auth.js against the vectors in docs/reference/http-api.md (the server checks
// the same ones in router_signed_test.exs) and against the tests' own node:crypto server
// (helpers/kotiko-auth.mjs).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { requireExt, ROOT } from "../helpers/load-script.mjs";
import { bootMac, proofFor, serverSignature, signRequest, verifySigned } from "../helpers/kotiko-auth.mjs";

const Auth = requireExt("lib/server-auth.js");
const TOKEN = "example-token-0123456789abcdef";
const DOC = fs.readFileSync(path.join(ROOT, "docs/reference/http-api.md"), "utf8");
const BODY = '{"base_langs":["es","en"],"ui_lang":null}';
const BOOT = "AAECAwQFBgcICQoLDA0ODw";
const PUT = {
  header: "Kotiko-HMAC v2 ts=1791331200, nonce=q1aP3n0ZKcB1x5mW0u7S9b, boot=AAECAwQFBgcICQoLDA0ODw, body=40921055f301e073c3aa377b5ac7d8827ce72c5443e994014c2087b2895f51ff, mac=KYWsYYqoHJ_1CJtht-ji67yNLQd-XNEXFaKUCZeTm1s",
  response: "v1 mac=CAmhh5A5suXJTIJNSarztt97Q-RO5eA9K0baiuiw1u0",
};
const GET = "Kotiko-HMAC v2 ts=1791331200, nonce=dE8gH0iL2nO4pQ6rS8tU0v, boot=AAECAwQFBgcICQoLDA0ODw, body=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855, mac=_SuhCp1q3PZ4gjDHP-zY0KQKrBe1zK5lxuFmBQuRPdk";
const PROOF_NONCE = "q1aP3n0ZKcB1x5mW0u7S9bJ2rV4yT6dE8gH0iL2nO4p";
const PROOF = { proof: "E5CHaF60VqTTPPduGD1yAlfWMF5xf9_hmV2qCufV-ek", boot: BOOT, boot_mac: "U8MycDq8d4O9G5n_qj1tMxNoTFoXHv5cex9_OKZifPY" };

describe("signed requests: lib/server-auth.js", () => {
  test("the documented vectors, which the server checks too", async () => {
    const put = await Auth.sign(TOKEN, { method: "put", path: "/api/v1/profile", body: BODY, ts: 1791331200, nonce: "q1aP3n0ZKcB1x5mW0u7S9b", boot: BOOT });
    assert.deepEqual(put, { header: PUT.header, nonce: "q1aP3n0ZKcB1x5mW0u7S9b" });
    const get = await Auth.sign(TOKEN, { method: "GET", path: "/api/v1/words?status=active,paused", ts: 1791331200, nonce: "dE8gH0iL2nO4pQ6rS8tU0v", boot: BOOT });
    assert.equal(get.header, GET);
    for (const value of [PUT.header, PUT.response, GET, PROOF.proof, PROOF.boot_mac, BOOT]) assert.ok(DOC.includes(value), value);
    assert.equal(await Auth.verifyResponse(TOKEN, "q1aP3n0ZKcB1x5mW0u7S9b", 200, PUT.response), true);
    assert.equal(serverSignature(TOKEN, "q1aP3n0ZKcB1x5mW0u7S9b", 200), PUT.response);
    assert.equal(signRequest(TOKEN, { method: "PUT", target: "/api/v1/profile", body: BODY, ts: 1791331200, nonce: "q1aP3n0ZKcB1x5mW0u7S9b", boot: BOOT }), PUT.header);
    // The proof answer's boot id, signed for the proof's nonce.
    assert.equal(proofFor(TOKEN, PROOF_NONCE), PROOF.proof);
    assert.equal(bootMac(TOKEN, PROOF_NONCE, BOOT), PROOF.boot_mac);
    assert.equal(await Auth.verifyBoot(TOKEN, PROOF_NONCE, BOOT, PROOF.boot_mac), true);
  });

  // Security review E-01: a request caught while the server was stopped could be played to
  // it after a restart, when its ts was ahead of the server's clock. Every request now signs
  // the server's boot id, which a restart changes.
  test("the boot id is signed: a request for another boot doesn't verify as this one", async () => {
    await assert.rejects(Auth.sign(TOKEN, { method: "GET", path: "/" }), /boot id/, "no request without a boot id");
    await assert.rejects(Auth.sign(TOKEN, { method: "GET", path: "/", boot: "short" }), /boot id/);
    const { header } = await Auth.sign(TOKEN, { method: "GET", path: "/api/v1/words", boot: BOOT });
    const req = { method: "GET", target: "/api/v1/words", authorization: header };
    assert.equal(verifySigned(TOKEN, { ...req, boot: BOOT }).ok, true);
    assert.deepEqual(verifySigned(TOKEN, { ...req, boot: "AAECAwQFBgcICQoLDA0OEA" }), { ok: false, reason: "stale_boot" });
    // Changing the boot id in the header breaks the MAC.
    assert.equal(verifySigned(TOKEN, { ...req, authorization: header.replace(BOOT, "AAECAwQFBgcICQoLDA0OEA") }).reason, "bad_mac");
  });

  test("a proof answer's boot id must be the server's, for this nonce", async () => {
    const mac = bootMac(TOKEN, PROOF_NONCE, BOOT);
    for (const [label, args] of [
      ["another token", ["another-token-0123456789", PROOF_NONCE, BOOT, mac]],
      ["another nonce", [TOKEN, `${PROOF_NONCE}x`, BOOT, mac]],
      ["another boot", [TOKEN, PROOF_NONCE, "AAECAwQFBgcICQoLDA0OEA", mac]],
      ["no boot", [TOKEN, PROOF_NONCE, undefined, mac]],
      ["a boot that isn't base64url", [TOKEN, PROOF_NONCE, "AAECAwQFBgcICQoLDA0O+w", mac]],
      ["no mac", [TOKEN, PROOF_NONCE, BOOT, undefined]],
      ["a mac that isn't 43 characters", [TOKEN, PROOF_NONCE, BOOT, `${mac}A`]],
    ]) {
      assert.equal(await Auth.verifyBoot(...args), false, label);
    }
  });

  test("a request it signs verifies on the server's side; a changed part doesn't", async () => {
    const { header, nonce } = await Auth.sign(TOKEN, { method: "POST", path: "/api/v1/words", body: '{"text":"кот"}', boot: BOOT });
    assert.match(nonce, /^[A-Za-z0-9_-]{22}$/, "16 random bytes");
    const req = { method: "POST", target: "/api/v1/words", body: '{"text":"кот"}', authorization: header };
    assert.deepEqual(verifySigned(TOKEN, req), { ok: true, nonce, ts: Number(/ts=(\d+)/.exec(header)[1]), boot: BOOT });
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
    assert.notEqual((await Auth.sign(TOKEN, { method: "GET", path: "/", boot: BOOT })).nonce, (await Auth.sign(TOKEN, { method: "GET", path: "/", boot: BOOT })).nonce);
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
    assert.deepEqual(Auth.challenge('Bearer, Kotiko-HMAC error="stale_boot"'), { signs: true, reason: "stale_boot" });
    assert.deepEqual(Auth.challenge("Bearer, Kotiko-HMACX"), { signs: false, reason: null });
  });
});
