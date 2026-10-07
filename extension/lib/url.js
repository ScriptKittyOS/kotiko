// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Normalises and validates the server address in one place (slice 26, research 06 F32).
// No DOM or extension APIs, so the same file runs in the background worker
// (globalThis.ServerUrl) and in Node tests (module.exports).
//
//   normalizeServerUrl("192.168.1.5:4747/")
//     -> { ok: true, url: "http://192.168.1.5:4747" }
//   normalizeServerUrl("http://user:pw@host")
//     -> { ok: false, code: "server_address_invalid", hint: "..." }
//   sendsInClear("http://192.168.1.5:4747")  -> true  (the token would cross the network unencrypted)
//   pinLoopback("http://localhost:11434/v1") -> "http://127.0.0.1:11434/v1"
//
// Plain-http `localhost` always becomes 127.0.0.1 (slice 54, B-01). Browsers resolve the
// name themselves and try [::1] first, where another account on the computer can listen
// while Kotiko's server (and Ollama, LM Studio) listen on 127.0.0.1 only; the first request
// already carries the token. An https:// address keeps its name, which its certificate
// names, and so does *.localhost, which names a site behind a local proxy.
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

  // "http://localhost:4747/x" -> "http://127.0.0.1:4747/x"; anything else as given.
  const LOCALHOST = /^http:\/\/localhost\.?(?=[:/]|$)/i;
  function pinLoopback(url) {
    return typeof url === "string" ? url.replace(LOCALHOST, "http://127.0.0.1") : url;
  }

  const USER_INFO_HINT =
    "Leave the user name and password out of the address; paste the token in the API token field.";

  function normalizeServerUrl(input) {
    const raw = typeof input === "string" ? input.trim() : "";
    if (!raw) return fail("Enter the server address, for example http://127.0.0.1:4747.");

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
      return fail("That doesn't look like a web address. Try something like http://127.0.0.1:4747.");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return fail("Use an http:// or https:// address.");
    }
    if (u.username || u.password) return fail(USER_INFO_HINT);
    if (u.search || u.hash || /[?#]/.test(raw)) {
      return fail("Remove the part of the address after ? or #.");
    }
    if (!u.hostname) return fail("The address needs a host name, for example 127.0.0.1.");

    // Keep the port and any path (a reverse proxy may mount the server under a prefix).
    const path = u.pathname.replace(/\/+$/, "");
    return { ok: true, url: pinLoopback(`${u.protocol}//${u.host}${path}`) };
  }

  // An address whose requests (and the token in them) cross a network unencrypted: plain
  // http:// to anywhere but this computer (127.0.0.0/8, ::1, localhost) or a Tailscale
  // address (100.64.0.0/10, fd7a:115c:a1e0::/48, *.ts.net), whose traffic WireGuard
  // encrypts (slice 28 §5). The address still works; the settings say so under the field.
  function sendsInClear(input) {
    const n = normalizeServerUrl(input);
    if (!n.ok) return false;
    const u = new URL(n.url);
    if (u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase().replace(/\.$/, "");
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".ts.net")) return false;
    if (IPV4.test(h)) return !(h.split(".")[0] === "127" || isTailscale(h));
    if (h.startsWith("[")) return !(h === "[::1]" || /^\[fd7a:115c:a1e0:/.test(h));
    return true;
  }

  const api = { normalizeServerUrl, isLocalHost, sendsInClear, pinLoopback };
  globalThis.ServerUrl = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
