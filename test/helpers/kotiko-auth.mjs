// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The server's side of signed requests (slice 54, D-01), written again with node:crypto
// for the fake servers in tests, apart from the extension's lib/server-auth.js, so the two
// are checked against each other and against the vectors in docs/reference/http-api.md.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SIGNED = /^Kotiko-HMAC v1 ts=(\d{1,12}), nonce=([A-Za-z0-9_-]{22,128}), body=([0-9a-f]{64}), mac=([A-Za-z0-9_-]{43})$/;

export const bodyHash = (body = "") => createHash("sha256").update(body).digest("hex");
const mac = (token, text) => createHmac("sha256", token).update(text).digest("base64url");

export const canonical = ({ method, target, ts, nonce, hash }) => ["kotiko-req-v1", method, target, ts, nonce, hash].join("\n");

// The X-Kotiko-Server value for an answer with `status` to the request `nonce`.
export const serverSignature = (token, nonce, status) => `v1 mac=${mac(token, ["kotiko-resp-v1", nonce, String(status)].join("\n"))}`;

// An Authorization value, as a client that holds `token` makes it.
export function signRequest(token, { method = "GET", target, body = "", ts = Math.floor(Date.now() / 1000), nonce }) {
  const hash = bodyHash(body);
  return `Kotiko-HMAC v1 ts=${ts}, nonce=${nonce}, body=${hash}, mac=${mac(token, canonical({ method, target, ts: String(ts), nonce, hash }))}`;
}

// Checks a request's Authorization against `token`: {ok, nonce} or {ok: false, reason}.
// The time isn't checked (tests run the extension on a fake clock); `seen`, a Set, refuses
// a nonce used before.
export function verifySigned(token, { method, target, body = "", authorization, seen = null }) {
  const m = SIGNED.exec(String(authorization ?? ""));
  if (!m) return { ok: false, reason: "malformed" };
  const [, ts, nonce, hash, got] = m;
  const want = mac(token, canonical({ method, target, ts, nonce, hash }));
  if (!timingSafeEqual(Buffer.from(want), Buffer.from(got))) return { ok: false, reason: "bad_mac" };
  if (hash !== bodyHash(body)) return { ok: false, reason: "body_mismatch" };
  if (seen) {
    if (seen.has(nonce)) return { ok: false, reason: "replayed" };
    seen.add(nonce);
  }
  return { ok: true, nonce, ts: Number(ts) };
}
