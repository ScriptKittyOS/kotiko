// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
// SPDX-License-Identifier: Apache-2.0

// Normalises and validates the server address in one place (slice 26, research 06 F32).
// No DOM or extension APIs, so the same file runs in the background worker
// (globalThis.ServerUrl) and in Node tests (module.exports).
//
//   normalizeServerUrl("192.168.1.5:4747/")
//     -> { ok: true, url: "http://192.168.1.5:4747" }
//   normalizeServerUrl("http://user:pw@host")
//     -> { ok: false, code: "server_address_invalid", hint: "..." }
(() => {
  const INVALID = "server_address_invalid";
  const fail = (hint) => ({ ok: false, code: INVALID, hint });

  const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

  // 100.64.0.0/10: the range Tailscale hands out.
  function isTailscale(host) {
    if (!IPV4.test(host)) return false;
    const [a, b] = host.split(".").map(Number);
    return a === 100 && b >= 64 && b <= 127;
  }

  // Hosts that are almost always plain HTTP: this machine, IP literals, mDNS names and
  // Tailscale addresses. Anything else (a MagicDNS name, a domain behind a proxy) gets https.
  function isLocalHost(host) {
    const h = host.toLowerCase().replace(/\.$/, "");
    return (
      h === "localhost" ||
      h.endsWith(".localhost") ||
      h.startsWith("[") ||
      IPV4.test(h) ||
      isTailscale(h) ||
      h.endsWith(".local")
    );
  }

  // The host part of an address typed without a scheme: "user@host:port/path" -> "host".
  function hostOf(authority) {
    const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
    if (hostPort.startsWith("[")) return hostPort.slice(0, hostPort.indexOf("]") + 1 || undefined);
    return hostPort.replace(/:\d*$/, "");
  }

  const USER_INFO_HINT =
    "Leave the user name and password out of the address; paste the token in the API token field.";

  function normalizeServerUrl(input) {
    const raw = typeof input === "string" ? input.trim() : "";
    if (!raw) return fail("Enter the server address, for example http://localhost:4747.");

    let withScheme = raw;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      if (raw.split(/[/?#]/, 1)[0].includes("@")) return fail(USER_INFO_HINT);
      // "ftp:host" or "http:/host" look like a scheme with a typo, not a host and port.
      if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(raw)) {
        return fail("Start the address with http:// or https://.");
      }
      const authority = raw.split(/[/?#]/, 1)[0];
      withScheme = `${isLocalHost(hostOf(authority)) ? "http" : "https"}://${raw}`;
    }

    let u;
    try {
      u = new URL(withScheme);
    } catch {
      return fail("That doesn't look like a web address. Try something like http://localhost:4747.");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return fail("Use an http:// or https:// address.");
    }
    if (u.username || u.password) return fail(USER_INFO_HINT);
    if (u.search || u.hash || /[?#]/.test(raw)) {
      return fail("Remove the part of the address after ? or #.");
    }
    if (!u.hostname) return fail("The address needs a host name, for example localhost.");

    // Keep the port and any path (a reverse proxy may mount the server under a prefix).
    const path = u.pathname.replace(/\/+$/, "");
    return { ok: true, url: `${u.protocol}//${u.host}${path}` };
  }

  const api = { normalizeServerUrl, isLocalHost };
  globalThis.ServerUrl = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
