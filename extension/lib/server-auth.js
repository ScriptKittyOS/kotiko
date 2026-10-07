// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Signed requests to a Kotiko server (slice 54, D-01). Kotiko never sends the server's
// token: it signs each request with it, and checks the server's signature on each answer,
// so a program that took the server's port while the server was stopped gets neither the
// token nor a request it could play to the server later, and is found out at its first
// answer. The server's side is server/lib/kotiko/request_auth.ex; the scheme and its test
// vectors are in docs/reference/http-api.md ("Signed requests").
//
//   Authorization: Kotiko-HMAC v2 ts=<unix seconds>, nonce=<base64url>, boot=<base64url>, body=<hex>, mac=<base64url>
//   mac = base64url(HMAC-SHA256(token, "kotiko-req-v2\n" + METHOD + "\n" + path + "\n" + ts
//                               + "\n" + nonce + "\n" + boot + "\n" + body))
//   X-Kotiko-Server: v1 mac=<base64url(HMAC-SHA256(token, "kotiko-resp-v1\n" + nonce + "\n" + status))>
//
// `path` is the request target from the server's root: the path and query as sent, without
// the prefix of an address that has one (a reverse proxy that mounts the server under
// /kotiko hands it /api/words). `body` is the hex SHA-256 of the body's UTF-8 bytes.
// `boot` is the server's boot id, from its proof answer, where it comes with
// boot_mac = base64url(HMAC-SHA256(token, "kotiko-boot-v1\n" + proof nonce + "\n" + boot)).
// The server makes a new one at each start and refuses a request signed with another
// (`stale_boot`), so a request caught while it was stopped can't be played to it after a
// restart (security review E-01).
(function () {
  const REQUEST = "kotiko-req-v2";
  const RESPONSE = "kotiko-resp-v1";
  const BOOT = "kotiko-boot-v1";
  const BOOT_ID = /^[A-Za-z0-9_-]{22,64}$/;
  const MAC = /^[A-Za-z0-9_-]{43}$/;
  const NONCE_BYTES = 16;
  const RESPONSE_HEADER = /^v1 mac=([A-Za-z0-9_-]{43})$/;
  const utf8 = (text) => new TextEncoder().encode(text);
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  // Bytes from base64url already checked to be 43 characters (32 bytes).
  function fromB64url(text) {
    const out = [];
    let bits = 0;
    let n = 0;
    for (const c of text) {
      bits = ((bits << 6) | B64URL.indexOf(c)) & 0xffff;
      n += 6;
      if (n >= 8) {
        n -= 8;
        out.push((bits >> n) & 0xff);
      }
    }
    return Uint8Array.from(out);
  }

  // The request target the server sees, for `url` on the server at `base`.
  function target(base, url) {
    const u = new URL(url);
    const prefix = new URL(base).pathname.replace(/\/+$/, "");
    const path = prefix && u.pathname.startsWith(prefix) ? u.pathname.slice(prefix.length) || "/" : u.pathname;
    return path + u.search;
  }

  const canonical = ({ method, path, ts, nonce, boot, bodyHash }) => [REQUEST, method, path, String(ts), nonce, boot, bodyHash].join("\n");

  const hmacKey = (subtle, token, usage) => subtle.importKey("raw", utf8(token), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

  // The Authorization value for one request to the server whose boot id is `boot`, and its
  // nonce (to check the answer with). `ts` and `nonce` are for tests; a request gets the
  // time and 16 random bytes.
  async function sign(token, { method, path, body = "", ts, nonce, boot }, crypto = globalThis.crypto) {
    if (!BOOT_ID.test(String(boot ?? ""))) throw new TypeError("A signed request needs the server's boot id.");
    const n = nonce ?? b64url(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
    const t = String(ts ?? Math.floor(Date.now() / 1000));
    const bodyHash = hex(await crypto.subtle.digest("SHA-256", utf8(body)));
    const key = await hmacKey(crypto.subtle, token, "sign");
    const mac = b64url(await crypto.subtle.sign("HMAC", key, utf8(canonical({ method: method.toUpperCase(), path, ts: t, nonce: n, boot, bodyHash }))));
    return { header: `Kotiko-HMAC v2 ts=${t}, nonce=${n}, boot=${boot}, body=${bodyHash}, mac=${mac}`, nonce: n };
  }

  // Whether a proof answer's `boot` and `boot_mac` are the server's, for the proof's
  // `nonce`: the boot id to sign requests with. subtle.verify compares in constant time.
  async function verifyBoot(token, nonce, boot, bootMac, crypto = globalThis.crypto) {
    if (!BOOT_ID.test(String(boot ?? "")) || !MAC.test(String(bootMac ?? ""))) return false;
    const key = await hmacKey(crypto.subtle, token, "verify");
    return crypto.subtle.verify("HMAC", key, fromB64url(bootMac), utf8([BOOT, nonce, boot].join("\n")));
  }

  // Whether `header` (X-Kotiko-Server) is the server's signature of an answer with `status`
  // to the request `nonce`. subtle.verify compares in constant time.
  async function verifyResponse(token, nonce, status, header, crypto = globalThis.crypto) {
    const m = RESPONSE_HEADER.exec(String(header ?? ""));
    if (!m) return false;
    const key = await hmacKey(crypto.subtle, token, "verify");
    return crypto.subtle.verify("HMAC", key, fromB64url(m[1]), utf8([RESPONSE, nonce, String(status)].join("\n")));
  }

  // What a signed request's 401 says, when its answer isn't signed: a server from before
  // signed requests challenges with `Bearer` alone; today's names `Kotiko-HMAC` and why
  // (`stale_boot`, `stale`, `bad_mac`, ...). Neither is authenticated: it only picks the
  // message, or, for `stale_boot`, a new proof before one more try.
  function challenge(header) {
    const value = String(header ?? "");
    if (!/(^|[\s,])Kotiko-HMAC(\s|,|$)/.test(value)) return { signs: false, reason: null };
    return { signs: true, reason: /Kotiko-HMAC error="([a-z_]{1,32})"/.exec(value)?.[1] ?? null };
  }

  const api = { canonical, target, sign, verifyResponse, verifyBoot, challenge, fromB64url };
  globalThis.KotikoServerAuth = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
