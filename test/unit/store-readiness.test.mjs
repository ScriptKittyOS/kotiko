// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 28: the privacy inventory, the store forms and the policy stay true to the code.
// A permission, a host, a content-script match or a network call added to the extension
// without its line in docs/privacy/inventory.md or store/chrome-web-store.md fails here,
// and so does a manifest that loses its Firefox declarations or its content security
// policy, a policy copy in the package that differs from the published one, or listing
// text that assumes which language the reader reads.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, EXT_DIR, manifest, readExt } from "../helpers/load-script.mjs";
import { problems as privacyCopyProblems } from "../../scripts/sync-privacy.mjs";

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const INVENTORY = read("docs/privacy/inventory.md");
const CWS = read("store/chrome-web-store.md");
const POLICY = read("docs/privacy/en.md");

// Every file in the package, relative to extension/.
function packageFiles(dir = EXT_DIR, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) packageFiles(p, out);
    else out.push(path.relative(EXT_DIR, p).split(path.sep).join("/"));
  }
  return out;
}
const TEXT = /\.(js|json|html|css|md)$/;
const JS = packageFiles().filter((f) => f.endsWith(".js"));

// The rows of the first Markdown table after `heading`, as arrays of cell text.
function table(md, heading) {
  const start = md.indexOf(heading);
  assert.ok(start >= 0, `no "${heading}"`);
  const lines = md.slice(start).split("\n");
  const first = lines.findIndex((l) => l.startsWith("|"));
  const rows = [];
  for (const l of lines.slice(first + 2)) {
    if (!l.startsWith("|")) break;
    rows.push(l.split("|").slice(1, -1).map((c) => c.trim()));
  }
  return rows;
}
const ticked = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

describe("permissions (slice 28 §3)", () => {
  test("every permission, host and content-script match has a justification row, and every row is in the manifest", () => {
    const m = manifest();
    const inManifest = new Set([
      ...(m.permissions ?? []).map((p) => `permissions ${p}`),
      ...(m.optional_permissions ?? []).map((p) => `optional_permissions ${p}`),
      ...(m.host_permissions ?? []).map((p) => `host_permissions ${p}`),
      ...(m.optional_host_permissions ?? []).map((p) => `optional_host_permissions ${p}`),
      ...(m.content_scripts ?? []).flatMap((c) => c.matches.map((p) => `content_scripts.matches ${p}`)),
    ]);
    const rows = table(CWS, "### Permissions and justifications");
    const justified = new Set();
    for (const [where, name, why] of rows) {
      for (const n of ticked(name)) justified.add(`${where} ${n}`);
      assert.ok(why && why.length > 40, `${where} ${name} needs a real justification`);
    }
    assert.deepEqual([...inManifest].filter((p) => !justified.has(p)), [], "in the manifest without a justification in store/chrome-web-store.md");
    assert.deepEqual([...justified].filter((p) => !inManifest.has(p)), [], "justified in store/chrome-web-store.md but no longer in the manifest");
  });

  test("nothing else opens the extension up: no externally_connectable, no web-accessible files, no uninstall address", () => {
    const m = manifest();
    assert.equal(m.externally_connectable, undefined);
    assert.equal(m.web_accessible_resources, undefined, "slice 19 needs none: the card's styles are in the content script");
    for (const f of JS) assert.doesNotMatch(readExt(f), /setUninstallURL/, f);
  });
});

describe("Firefox and the content security policy (slice 28 §4, §5)", () => {
  test("the manifest declares its data collection, needs Firefox 140, and states the extension pages' policy", () => {
    const m = manifest();
    const gecko = m.browser_specific_settings.gecko;
    assert.equal(gecko.id, "kotiko@scriptkittyos.com");
    assert.equal(gecko.strict_min_version, "140.0", "the first desktop Firefox that reads data_collection_permissions");
    assert.deepEqual(gecko.data_collection_permissions, { required: ["authenticationInfo"] });
    assert.equal(m.browser_specific_settings.gecko_android.strict_min_version, "142.0", "the first Android Firefox that reads it");
    // Chrome's default, written out: Firefox's own adds upgrade-insecure-requests, which
    // would turn a LAN or Tailscale http:// server into an https:// one that isn't there.
    assert.deepEqual(m.content_security_policy, { extension_pages: "script-src 'self'; object-src 'self'" });
    assert.match(read("store/firefox-amo.md"), /"required": \["authenticationInfo"\]/);
  });

  // Security review C-11: the Chrome form ticked authentication information while Firefox's
  // manifest declared no data collection. Chrome's form counts data "handled" even on the
  // device (website content: yes) and Firefox's only data that leaves the browser, so the
  // categories that leave it must match: here, the learner's own key and server token.
  test("the Firefox declaration and the Chrome form agree on what leaves the browser", () => {
    const declared = manifest().browser_specific_settings.gecko.data_collection_permissions;
    const firefox = new Set([...(declared.required ?? []), ...(declared.optional ?? [])].filter((c) => c !== "none"));
    const chrome = Object.fromEntries(table(CWS, "### Data usage").map(([name, tick]) => [name, /\*\*Yes\*\*/.test(tick)]));
    // Chrome's categories and Firefox's for the same data; website content is read on the
    // device only (Chrome: handled; Firefox: not transmitted), so it isn't compared.
    const SAME = {
      "Personally identifiable information": "personallyIdentifyingInfo",
      "Health information": "healthInfo",
      "Financial and payment information": "financialAndPaymentInfo",
      "Authentication information": "authenticationInfo",
      "Personal communications": "personalCommunications",
      Location: "locationInfo",
      "Web history": "browsingActivity",
    };
    for (const [cws, gecko] of Object.entries(SAME)) {
      assert.ok(cws in chrome, `store/chrome-web-store.md has no "${cws}" row`);
      assert.equal(firefox.has(gecko), chrome[cws], `Chrome "${cws}" is ${chrome[cws] ? "Yes" : "No"}, Firefox ${gecko} is ${firefox.has(gecko) ? "" : "not "}declared`);
    }
    assert.ok(!(declared.required ?? []).includes("none") || firefox.size === 0, "none stands alone");
  });

  test("the http:// warning: only addresses whose traffic crosses a network unencrypted", async () => {
    const { requireExt } = await import("../helpers/load-script.mjs");
    const { sendsInClear } = requireExt("lib/url.js");
    const cases = {
      "http://localhost:4747": false,
      "localhost:4747": false,
      "http://127.0.0.1:4747": false,
      "http://127.8.9.10:4747": false,
      "http://[::1]:4747": false,
      "http://kotiko.localhost": false,
      "http://100.64.0.1:4747": false,
      "http://100.101.102.103:4747": false,
      "http://100.127.255.254:4747": false,
      "http://my-box.tail1234.ts.net:4747": false,
      "http://[fd7a:115c:a1e0::1]:4747": false,
      "https://home.example": false,
      "https://192.168.1.5:4747": false,
      "http://192.168.1.5:4747": true,
      "192.168.1.5:4747": true,
      "http://10.0.0.2:4747": true,
      "http://100.63.0.1:4747": true,
      "http://100.128.0.1:4747": true,
      "http://raspberrypi.local:4747": true,
      "http://home.example": true,
      "http://[fe80::1]:4747": true,
      "not an address": false,
      "": false,
    };
    for (const [input, want] of Object.entries(cases)) assert.equal(sendsInClear(input), want, input);
  });
});

describe("the data inventory (slice 28 §1)", () => {
  test("every network call site is counted in docs/privacy/inventory.md", () => {
    const NET = /\bfetch\(|new XMLHttpRequest\b|new WebSocket\b|\bsendBeacon\(|new EventSource\b|\bimportScripts\(/g;
    const found = {};
    for (const f of JS) {
      const n = (readExt(f).match(NET) ?? []).length;
      if (n) found[`extension/${f}`] = n;
    }
    const listed = Object.fromEntries(table(INVENTORY, "## 5. Network call sites").map(([file, count]) => [ticked(file)[0], Number(count)]));
    assert.deepEqual(found, listed, "a request was added, moved or removed: update section 5 of docs/privacy/inventory.md (and the policy if what leaves the device changed)");
  });

  test("every host named in the package is in docs/privacy/inventory.md", () => {
    const hosts = new Set();
    for (const f of packageFiles().filter((x) => TEXT.test(x))) {
      for (const m of readExt(f).matchAll(/\b(?:https?|wss?):\/\/((?:\$\{[^}]*\}|[A-Za-z0-9.-])+)/g)) hosts.add(m[1].replace(/\$\{[^}]*\}/g, "*"));
    }
    const listed = new Set(table(INVENTORY, "## 4. Hosts in the code").flatMap(([h]) => ticked(h)));
    assert.deepEqual([...hosts].filter((h) => !listed.has(h)).sort(), [], "add these hosts to section 4 of docs/privacy/inventory.md");
  });

  test("no console call can print a key or a token", () => {
    for (const f of JS) {
      const src = readExt(f);
      assert.doesNotMatch(src, /console\.log\(/, `${f}: console.log`);
      for (const m of src.matchAll(/console\.(?:info|debug|warn|error|trace)\(([^;]*)\)/g)) {
        assert.doesNotMatch(m[1], /key|token|secret|authorization|bearer|password/i, `${f}: ${m[0]}`);
      }
    }
  });
});

describe("the privacy policy (slice 28 §2)", () => {
  test("the copy in the package is the published text, word for word", () => {
    assert.deepEqual(privacyCopyProblems(), []);
  });

  test("names every lookup service Kotiko offers, Wiktionary and Telegram, and has a version and a date", () => {
    const presets = JSON.parse(readExt("spec/providers.json")).providers.filter((p) => p.baseUrl);
    for (const p of presets) assert.ok(POLICY.includes(p.label), `the policy doesn't name ${p.label}`);
    for (const name of ["Wiktionary", "Wikimedia", "Telegram", "hello@scriptkittyos.com", "security@scriptkittyos.com"]) assert.ok(POLICY.includes(name), name);
    assert.match(POLICY, /^Version \d+ · \d{1,2} \w+ \d{4}$/m);
    assert.match(POLICY, /## Changelog\n\n- \*\*Version \d+/);
  });

  test("the settings page and the welcome page link to it", () => {
    for (const page of ["dashboard.html", "welcome.html"]) assert.match(readExt(page), /href="privacy\.html"[^>]*data-i18n="privacy_link"/, page);
    assert.ok(fs.existsSync(path.join(EXT_DIR, "privacy.html")));
  });

  test("the renderer turns the policy into headings, paragraphs, lists and links, and never HTML", async () => {
    const { requireExt } = await import("../helpers/load-script.mjs");
    const P = requireExt("lib/policy.js");
    const blocks = P.parse(POLICY);
    assert.equal(blocks[0].type, "h1");
    assert.ok(blocks.some((b) => b.type === "ul") && blocks.filter((b) => b.type === "h2").length >= 10);
    assert.deepEqual(P.inline("See <https://kotiko.org/> and **this** `code`."), [{ text: "See " }, { link: "https://kotiko.org/" }, { text: " and " }, { strong: "this" }, { text: " " }, { code: "code" }, { text: "." }]);
    // Only https links become links; markup is text.
    assert.deepEqual(P.inline("<a href=x>hi</a> <javascript:alert(1)>"), [{ text: "<a href=x>hi</a> <javascript:alert(1)>" }]);
  });
});

describe("the listing (slice 28 §8)", () => {
  const LISTINGS = fs.readdirSync(path.join(ROOT, "store/listing")).filter((f) => f.endsWith(".json"));
  const en = JSON.parse(read("store/listing/en.json"));

  test("English has every part, and other locales only translate what English has", () => {
    assert.ok(en.description.length > 500);
    assert.deepEqual(en.screenshots.map((s) => s.id), ["page", "popup", "dashboard", "welcome", "dark"]);
    for (const s of en.screenshots) assert.ok(s.caption.length > 0 && s.caption.length <= 48, s.id);
    assert.ok(en.promo_small.headline.length <= 30, "legible at half size on a 440x280 tile");
    const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    const enKeys = new Set(keys(en));
    for (const f of LISTINGS) {
      const l = JSON.parse(read(`store/listing/${f}`));
      assert.equal(l.locale, f.replace(/\.json$/, ""));
      assert.deepEqual(keys(l).filter((k) => !enKeys.has(k)), [], f);
    }
  });

  test("no listing, policy or single-purpose text assumes the reader reads English or that Kotiko swaps English words", () => {
    // "English Wiktionary" names the site edition Kotiko asks, not the reader's language.
    const ALLOWED = /English Wiktionary/g;
    const texts = {
      // The comment for translators and slice 30 isn't listing text.
      ...Object.fromEntries(LISTINGS.map((f) => [`store/listing/${f}`, JSON.stringify({ ...JSON.parse(read(`store/listing/${f}`)), _comment: undefined })])),
      ...Object.fromEntries(fs.readdirSync(path.join(ROOT, "docs/privacy")).map((f) => [`docs/privacy/${f}`, read(`docs/privacy/${f}`)])),
      "single purpose": /### Single purpose\n\n> ([\s\S]*?)\n\n/.exec(CWS)[1],
    };
    for (const [name, text] of Object.entries(texts)) assert.doesNotMatch(text.replace(ALLOWED, ""), /\bEnglish\b/, name);
    const messages = JSON.parse(read("extension/_locales/en/messages.json"));
    for (const k of ["extStoreName", "extDescription"]) assert.doesNotMatch(messages[k].message, /English/, k);
  });

  // The Chrome Web Store refused v1.0.0's zip: "The translation of the name of your item is
  // missing in locale es". Every locale the package ships needs each message the manifest
  // names, within the stores' limits (name 45 for Edge, short name 12, description 132).
  test("every locale in the package has the manifest's messages, within the stores' limits", () => {
    const keys = [...new Set(JSON.stringify(manifest()).match(/__MSG_(\w+)__/g) ?? [])].map((m) => m.slice(6, -2));
    assert.ok(keys.includes("extStoreName") && keys.includes("extDescription"));
    const limits = { extStoreName: 45, extName: 12, extDescription: 132 };
    const locales = fs.readdirSync(path.join(EXT_DIR, "_locales"));
    assert.ok(locales.length > 1, "more than one locale ships");
    for (const locale of locales) {
      const messages = JSON.parse(readExt(`_locales/${locale}/messages.json`));
      for (const k of keys) {
        const text = messages[k]?.message;
        assert.ok(typeof text === "string" && text.trim(), `${locale}: ${k} is missing`);
        if (limits[k]) assert.ok([...text].length <= limits[k], `${locale}: ${k} is ${[...text].length} characters, over ${limits[k]}`);
      }
    }
  });

  test("the mascot isn't named in the listing (DECISIONS 2026-10-01)", () => {
    for (const f of LISTINGS) assert.doesNotMatch(read(`store/listing/${f}`).replace(/"_comment":.*\n/, ""), /\bMira\b/, f);
  });
});
