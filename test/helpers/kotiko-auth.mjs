// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The server's side of signed requests (slice 54, D-01), written again with node:crypto
// for the fake servers in tests, apart from the extension's lib/server-auth.js, so the two
// are checked against each other and against the vectors in docs/reference/http-api.md.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SIGNED = /^Kotiko-HMAC v2 ts=(\d{1,12}), nonce=([A-Za-z0-9_-]{22,128}), boot=([A-Za-z0-9_-]{22,64}), body=([0-9a-f]{64}), mac=([A-Za-z0-9_-]{43})$/;

// The boot id the fake servers give unless told otherwise (16 bytes 00..0f, as in the
// vectors in docs/reference/http-api.md).
export const TEST_BOOT = "AAECAwQFBgcICQoLDA0ODw";

export const bodyHash = (body = "") => createHash("sha256").update(body).digest("hex");
const mac = (token, text) => createHmac("sha256", token).update(text).digest("base64url");

export const canonical = ({ method, target, ts, nonce, boot, hash }) => ["kotiko-req-v2", method, target, ts, nonce, boot, hash].join("\n");

// What a Kotiko server answers to `POST /api/v1/proof` (slice 54, B-01; E-01's boot id).
export const proofFor = (token, nonce) => mac(token, `kotiko-proof-v1:${nonce}`);
export const bootMac = (token, nonce, boot) => mac(token, ["kotiko-boot-v1", nonce, boot].join("\n"));
export const proofAnswer = (token, nonce, boot = TEST_BOOT) => ({ proof: proofFor(token, nonce), boot, boot_mac: bootMac(token, nonce, boot) });

// The X-Kotiko-Server value for an answer with `status` to the request `nonce`.
export const serverSignature = (token, nonce, status) => `v1 mac=${mac(token, ["kotiko-resp-v1", nonce, String(status)].join("\n"))}`;

// An Authorization value, as a client that holds `token` makes it.
export function signRequest(token, { method = "GET", target, body = "", ts = Math.floor(Date.now() / 1000), nonce, boot = TEST_BOOT }) {
  const hash = bodyHash(body);
  return `Kotiko-HMAC v2 ts=${ts}, nonce=${nonce}, boot=${boot}, body=${hash}, mac=${mac(token, canonical({ method, target, ts: String(ts), nonce, boot, hash }))}`;
}

// Checks a request's Authorization against `token`: {ok, nonce} or {ok: false, reason}.
// The time isn't checked (tests run the extension on a fake clock); `seen`, a Set, refuses
// a nonce used before; `boot`, when given, refuses a request signed for another boot id
// (`stale_boot`), as a restarted server does.
export function verifySigned(token, { method, target, body = "", authorization, seen = null, boot = null }) {
  const m = SIGNED.exec(String(authorization ?? ""));
  if (!m) return { ok: false, reason: "malformed" };
  const [, ts, nonce, signedBoot, hash, got] = m;
  const want = mac(token, canonical({ method, target, ts, nonce, boot: signedBoot, hash }));
  if (!timingSafeEqual(Buffer.from(want), Buffer.from(got))) return { ok: false, reason: "bad_mac" };
  if (boot !== null && signedBoot !== boot) return { ok: false, reason: "stale_boot" };
  if (hash !== bodyHash(body)) return { ok: false, reason: "body_mismatch" };
  if (seen) {
    if (seen.has(nonce)) return { ok: false, reason: "replayed" };
    seen.add(nonce);
  }
  return { ok: true, nonce, ts: Number(ts), boot: signedBoot };
}
