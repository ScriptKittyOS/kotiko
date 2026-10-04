// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 16 §4: the sensitive-sites list and lib/sensitive.js's patterns.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EXT_DIR, requireExt } from "../helpers/load-script.mjs";

const S = requireExt("lib/sensitive.js");
const { sites } = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "data/sensitive-sites.json"), "utf8"));
const at = (url) => {
  const u = new URL(url);
  return S.match(sites, u);
};

describe("sensitive-sites.json", () => {
  test("every entry has a pattern and a known category, once", () => {
    assert.ok(sites.length > 50);
    const seen = new Set();
    for (const s of sites) {
      assert.equal(typeof s.pattern, "string");
      assert.ok(S.CATEGORIES.includes(s.category), s.pattern);
      assert.match(s.pattern, /^[a-z0-9*.\-/=]+$/, s.pattern);
      assert.ok(!seen.has(s.pattern), `duplicate ${s.pattern}`);
      seen.add(s.pattern);
    }
  });

  const rows = [
    ["https://www.chase.com/", "banking"],
    ["https://secure.chase.com/web/auth", "banking"],
    ["https://www.bancopopular.com/", "banking"],
    ["https://mibanco.bank/", "banking"],
    ["https://onlinebanking.example.de/login", "banking"],
    ["https://banking.example.co.uk/", "banking"],
    ["https://mabanque.bnpparibas/", "banking"],
    ["https://www.paypal.com/myaccount", "payments"],
    ["https://mychart.clevelandclinic.org/", "health"],
    ["https://www.irs.gov/", "government"],
    ["https://suri.hacienda.pr.gov/", "government"],
    ["https://mail.google.com/mail/u/0/#inbox?compose=new", "email"],
    ["https://outlook.live.com/mail/0/deeplink/compose", "email"],
    ["https://mail.google.com/mail/u/0/#inbox", null],
    ["https://notchase.com/", null],
    ["https://www.bankrate.com/", null],
    ["https://banksy.co.uk/", null],
    ["https://en.wikipedia.org/wiki/Bank", null],
    ["https://www.elnuevodia.com/", null],
    ["https://example.com/mychart", null],
  ];
  for (const [url, want] of rows) test(`${url} -> ${want}`, () => assert.equal(at(url), want));

  test("bad input matches nothing", () => {
    assert.equal(S.match(null, { hostname: "chase.com" }), null);
    assert.equal(S.match(sites, { hostname: "" }), null);
    assert.equal(S.match(sites, null), null);
    assert.equal(S.match(sites, { hostname: "CHASE.COM." }), "banking", "case and a final dot");
  });
});
