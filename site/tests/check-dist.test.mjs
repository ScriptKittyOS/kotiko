// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// scripts/check-dist.mjs: the built site passes, and each kind of problem it looks for is
// caught on a small made-up site.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureBuilt } from "./helpers.mjs";
import { check, urlsOf, isThirdParty, cssUrls, errorCodes, providerIds, stableUrls } from "../scripts/check-dist.mjs";

test("the built site has every stable URL, error anchor and provider page, no broken link and no third-party load", () => {
  assert.deepEqual(check(ensureBuilt()), []);
});

test("it reads slice 25's codes and the provider presets from the repository", () => {
  const codes = errorCodes();
  assert.ok(codes.length >= 20, `${codes.length} codes`);
  for (const c of ["offline", "quota_exhausted", "key_rejected", "internal"]) assert.ok(codes.includes(c));
  assert.ok(providerIds().includes("openrouter"));
  assert.ok(stableUrls().includes("/privacy/"));
  assert.ok(stableUrls().includes("/connect/"));
});

test("only loads count as third-party requests; links people follow don't", () => {
  const found = urlsOf(`
    <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=X">
    <link rel="canonical" href="https://kotiko.org/x/">
    <link rel="alternate" hreflang="es" href="https://kotiko.org/es/">
    <img src="//cdn.example/x.png" srcset="/a.png 1x, https://cdn.example/b.png 2x">
    <a href="https://github.com/ScriptKittyOS/kotiko">code</a>
    <div style="background:url('https://t.example/p.gif')"></div>`);
  const loads = found.filter((u) => u.kind === "fetch" && isThirdParty(u.url)).map((u) => u.url);
  assert.deepEqual(loads.sort(), ["//cdn.example/x.png", "https://cdn.example/b.png", "https://fonts.googleapis.com/css?family=X", "https://t.example/p.gif"].sort());
  assert.ok(found.some((u) => u.kind === "link" && u.url === "https://github.com/ScriptKittyOS/kotiko"));
  assert.ok(!isThirdParty("https://kotiko.org/privacy/"));
  assert.ok(!isThirdParty("/privacy/"));
  assert.ok(!isThirdParty("data:image/png;base64,AA"));
  assert.deepEqual(cssUrls(`@import "https://x.example/a.css"; a{background:url(/i.png)} b{background:url(data:x)}`), ["/i.png", "https://x.example/a.css"]);
});

test("it catches a missing page, a broken link, a missing anchor, an outside load and a wrong CNAME", () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "kotiko-site-"));
  const write = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true });
    fs.writeFileSync(path.join(dist, rel), body);
  };
  // Every required page exists with every required anchor...
  const ids = errorCodes().map((c) => `<h3 id="${c}">x</h3>`).join("");
  for (const u of stableUrls()) write(`${u.split("#")[0]}index.html`, `<h2 id="${u.split("#")[1] ?? "x"}">x</h2>`);
  write("help/errors/index.html", ids);
  for (const id of providerIds()) write(`providers/${id}/index.html`, "ok");
  write("CNAME", "kotiko.org\n");
  assert.deepEqual(check(dist), []);

  // ...then each mistake is reported.
  write("help/errors/index.html", ids.replace('id="offline"', 'id="off-line"'));
  write("start/index.html", `<a href="/nowhere/">x</a> <a href="/privacy/#no-such-part">y</a> <img src="https://tracker.example/p.gif"> <a href="https://elsewhere.example/">fine</a>`);
  write("x.css", "a{background:url(https://cdn.example/x.png)}");
  fs.rmSync(path.join(dist, "connect"), { recursive: true });
  write("CNAME", "example.org\n");
  const problems = check(dist).join("\n");
  assert.match(problems, /\/help\/errors\/#offline: no element with id "offline"/);
  assert.match(problems, /\/start\/: broken link \/nowhere\//);
  assert.match(problems, /\/start\/: link \/privacy\/#no-such-part has no #no-such-part/);
  assert.match(problems, /\/start\/: <img> loads https:\/\/tracker\.example\/p\.gif from another host/);
  assert.match(problems, /\/x\.css: loads https:\/\/cdn\.example\/x\.png from another host/);
  assert.match(problems, /\/connect\/: not built/);
  assert.match(problems, /CNAME: must contain kotiko\.org/);
  assert.doesNotMatch(problems, /elsewhere\.example/);
  fs.rmSync(dist, { recursive: true, force: true });
});
