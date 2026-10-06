// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Properties of the server address check (lib/url.js, slice 26) on generated input: what
// a learner might type or paste, and what an attacker might plant in storage.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fc } from "../../helpers/properties.mjs";
import { requireExt } from "../../helpers/load-script.mjs";

const U = requireExt("lib/url.js");

const octet = fc.integer({ min: 0, max: 255 });
const ipv4 = fc.tuple(octet, octet, octet, octet).map((p) => p.join("."));
const port = fc.integer({ min: 1, max: 65535 });
const label = fc.stringMatching(/^[a-z0-9]([a-z0-9-]{0,10}[a-z0-9])?$/);
const domain = fc.array(label, { minLength: 1, maxLength: 3 }).chain((ls) => fc.constantFrom("com", "org", "net", "dev", "example").map((tld) => [...ls, tld].join(".")));
const host = fc.oneof(ipv4, domain, fc.constantFrom("localhost", "kotiko.local", "box.localhost", "[::1]", "[fd7a:115c:a1e0::1]", "[2001:db8::1]", "pi.tail1234.ts.net", "100.100.1.2"));
const pathPart = fc.array(fc.stringMatching(/^[a-z0-9_-]{1,8}$/), { maxLength: 3 }).map((ps) => ps.map((p) => `/${p}`).join(""));
// Addresses as typed: with or without a scheme, port, path and trailing slashes, padded.
const typed = fc
  .tuple(fc.constantFrom("", "http://", "https://", "HTTP://", "HtTpS://"), host, fc.option(port), pathPart, fc.constantFrom("", "/", "//"), fc.constantFrom("", " ", "\t"))
  .map(([scheme, h, p, pa, slash, pad]) => `${pad}${scheme}${h}${p === null ? "" : `:${p}`}${pa}${slash}${pad}`);
const anything = fc.oneof(typed, fc.string(), fc.string({ unit: "grapheme" }), fc.webUrl({ withQueryParameters: true, withFragments: true }), fc.anything());

describe("normalizeServerUrl", () => {
  test("never throws, and answers either a clean http(s) address or the one error code", () => {
    fc.assert(
      fc.property(anything, (input) => {
        const r = U.normalizeServerUrl(input);
        if (!r.ok) {
          assert.equal(r.code, "server_address_invalid");
          assert.equal(typeof r.hint, "string");
          assert.ok(r.hint.length > 0);
          return;
        }
        const u = new URL(r.url);
        assert.match(u.protocol, /^https?:$/);
        assert.equal(u.username + u.password + u.search + u.hash, "");
        assert.ok(!r.url.endsWith("/"), "no trailing slash");
        assert.ok(u.hostname.length > 0);
      }),
    );
  });

  test("is idempotent: a normalised address normalises to itself", () => {
    fc.assert(
      fc.property(anything, (input) => {
        const r = U.normalizeServerUrl(input);
        if (r.ok) assert.deepEqual(U.normalizeServerUrl(r.url), r);
      }),
    );
  });

  test("keeps the host, port and path the learner typed", () => {
    fc.assert(
      fc.property(host, fc.option(port), pathPart, (h, p, pa) => {
        const r = U.normalizeServerUrl(`${h}${p === null ? "" : `:${p}`}${pa}/`);
        assert.equal(r.ok, true);
        const u = new URL(r.url);
        assert.equal(u.hostname, new URL(`http://${h}`).hostname);
        assert.equal(u.pathname === "/" ? "" : u.pathname, pa);
        if (p !== null && !(p === 80 && u.protocol === "http:") && !(p === 443 && u.protocol === "https:")) assert.equal(u.port, String(p));
      }),
    );
  });

  test("an address without a scheme gets http only for this machine, IP literals, .local and Tailscale", () => {
    fc.assert(
      fc.property(host, (h) => {
        const r = U.normalizeServerUrl(h);
        assert.equal(r.ok, true);
        assert.equal(r.url.startsWith("http://"), U.isLocalHost(h));
      }),
    );
    fc.assert(
      fc.property(domain, (d) => {
        assert.equal(U.normalizeServerUrl(d).url, `https://${d}`);
      }),
    );
  });

  test("never accepts a user name or password, however it is written", () => {
    fc.assert(
      fc.property(fc.constantFrom("", "http://", "https://"), fc.stringMatching(/^[a-z0-9]{1,8}$/), fc.option(fc.stringMatching(/^[a-z0-9]{1,8}$/)), host, (scheme, user, pass, h) => {
        const r = U.normalizeServerUrl(`${scheme}${user}${pass === null ? "" : `:${pass}`}@${h}`);
        assert.equal(r.ok, false);
      }),
    );
  });

  test("refuses a query or fragment, and any scheme but http and https", () => {
    fc.assert(
      fc.property(typed, fc.constantFrom("?", "#", "?a=1", "#x"), (t, tail) => assert.equal(U.normalizeServerUrl(t.trim() + tail).ok, false)),
    );
    fc.assert(
      fc.property(fc.constantFrom("ftp", "file", "javascript", "data", "ws", "chrome-extension"), host, (scheme, h) => assert.equal(U.normalizeServerUrl(`${scheme}://${h}`).ok, false)),
    );
  });
});

describe("sendsInClear (slice 28 §5)", () => {
  test("only plain http to another machine, outside Tailscale, crosses the network in clear", () => {
    fc.assert(
      fc.property(anything, (input) => {
        const clear = U.sendsInClear(input);
        const r = U.normalizeServerUrl(input);
        if (!r.ok || r.url.startsWith("https://")) return assert.equal(clear, false);
        const h = new URL(r.url).hostname;
        const local = h === "localhost" || h.endsWith(".localhost") || h.endsWith(".ts.net") || /^127\./.test(h) || h === "[::1]" || h.startsWith("[fd7a:115c:a1e0:");
        const tailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h);
        assert.equal(clear, !(local || tailscale));
      }),
    );
  });

  test("loopback and Tailscale IPv4 addresses never warn; the rest of private space does", () => {
    fc.assert(
      fc.property(octet, octet, octet, port, (b, c, d, p) => {
        assert.equal(U.sendsInClear(`http://127.${b}.${c}.${d}:${p}`), false);
        assert.equal(U.sendsInClear(`http://100.${64 + (b % 64)}.${c}.${d}:${p}`), false);
        assert.equal(U.sendsInClear(`http://10.${b}.${c}.${d}:${p}`), true);
        assert.equal(U.sendsInClear(`https://10.${b}.${c}.${d}:${p}`), false);
      }),
    );
  });
});
