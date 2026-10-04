// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Sites Kotiko leaves alone unless the learner says otherwise (slice 16 §4): banking,
// payments, health, government and email compose pages, from extension/data/sensitive-sites.json.
// No DOM; runs in content scripts (globalThis.KotikoSensitive) and in Node tests.
//
//   KotikoSensitive.match(sites, { hostname, pathname, search, hash }) -> category | null
//
// Patterns: "example.com" is that host or a subdomain; "*.bank" any host under .bank;
// "mychart.*" a host with a label "mychart"; "banking*.*" a label starting with "banking";
// "mail.google.com/*compose=*" also matches the rest of the address (* is anything).
(() => {
  const underDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);
  const glob = (s) => new RegExp(`^${s.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\/]/g, "\\$&")).join(".*")}$`, "i");

  function test(pattern, host, rest) {
    const slash = pattern.indexOf("/");
    if (slash > 0) return underDomain(host, pattern.slice(0, slash)) && glob(pattern.slice(slash)).test(rest);
    if (pattern.startsWith("*.")) return underDomain(host, pattern.slice(2));
    if (pattern.endsWith(".*")) {
      const name = pattern.slice(0, -2);
      const labels = host.split(".").slice(0, -1);
      return name.endsWith("*") ? labels.some((l) => l.startsWith(name.slice(0, -1))) : labels.includes(name);
    }
    return underDomain(host, pattern);
  }

  function match(sites, loc) {
    const host = String(loc?.hostname ?? "").toLowerCase().replace(/\.$/, "");
    if (!host || !Array.isArray(sites)) return null;
    const rest = `${loc.pathname ?? ""}${loc.search ?? ""}${loc.hash ?? ""}`;
    for (const s of sites) if (s && typeof s.pattern === "string" && test(s.pattern.toLowerCase(), host, rest)) return s.category ?? "other";
    return null;
  }

  const CATEGORIES = ["banking", "payments", "health", "government", "email"];
  const api = { match, CATEGORIES };
  globalThis.KotikoSensitive = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
