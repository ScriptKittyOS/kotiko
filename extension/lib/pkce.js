// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// "Connect OpenRouter" without copying a key (slice 11 section 4): OAuth PKCE with an S256
// challenge. The background keeps the verifier in the store's secrets (`pkce:pending`, 10
// minutes); the callback page on the docs site (slice 44, site/src/pages/connect/) is where
// Kotiko's content script for that page (content/connect.js) reads `?code=` and sends
// `{type: "oauth.code", code}`, the one extra content-script message this slice allows,
// accepted only from that origin. The code is useless without the verifier, which never
// leaves the background.
//
// The button stays hidden until the docs site is live at kotiko.org; pasting a key is
// always available. No DOM, so it runs in the background (globalThis.KotikoPKCE) and in
// Node tests.
//
//   const { verifier, challenge } = await KotikoPKCE.pair()
//   KotikoPKCE.authUrl({ challenge })   -> https://openrouter.ai/auth?callback_url=…
//   await KotikoPKCE.exchange({ fetch, code, verifier }) -> key | throws {code}
(() => {
  const DOCS_ORIGIN = "https://kotiko.org";
  const CALLBACK_URL = `${DOCS_ORIGIN}/connect/`;
  const AUTH_URL = "https://openrouter.ai/auth";
  const KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
  const PENDING_MS = 10 * 60_000;

  const b64url = (bytes) => {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  async function pair() {
    const raw = new Uint8Array(32);
    globalThis.crypto.getRandomValues(raw);
    const verifier = b64url(raw);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return { verifier, challenge: b64url(new Uint8Array(digest)) };
  }

  function authUrl({ challenge, callbackUrl = CALLBACK_URL }) {
    const u = new URL(AUTH_URL);
    u.searchParams.set("callback_url", callbackUrl);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    u.searchParams.set("key_label", "Kotiko");
    return u.toString();
  }

  // True for the docs site's callback page with a code: the only page whose content
  // script may send `oauth.code`.
  function isCallback(url) {
    try {
      const u = new URL(url);
      return u.origin === DOCS_ORIGIN && u.pathname === new URL(CALLBACK_URL).pathname && u.searchParams.has("code");
    } catch {
      return false;
    }
  }

  async function exchange({ fetch, code, verifier }) {
    const res = await fetch(KEYS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      credentials: "omit",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || typeof body?.key !== "string" || !body.key) {
      throw Object.assign(new Error("OpenRouter didn't give a key."), { code: "key_rejected", details: { status: res.status, provider: "openrouter" } });
    }
    return body.key;
  }

  const api = { pair, authUrl, exchange, isCallback, DOCS_ORIGIN, CALLBACK_URL, PENDING_MS };
  globalThis.KotikoPKCE = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
