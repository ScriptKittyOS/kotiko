// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The "Connect OpenRouter" return page (slice 11 §4): it is built at exactly the address
// the extension sends OpenRouter to, it can't send the code anywhere (no script, a Content
// Security Policy that forbids loading, connecting and posting, no Referer), and it reads
// as plain instructions without the extension.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureBuilt, read, extensionGlobal, text } from "./helpers.mjs";
import { urlsOf, isThirdParty } from "../scripts/check-dist.mjs";

test("the page is built at the extension's callback address", () => {
  ensureBuilt();
  const PKCE = extensionGlobal("extension/lib/pkce.js", "KotikoPKCE");
  assert.equal(PKCE.CALLBACK_URL, "https://kotiko.org/connect/");
  const u = new URL(PKCE.CALLBACK_URL);
  assert.equal(u.origin, PKCE.DOCS_ORIGIN);
  assert.ok(read(`${u.pathname.slice(1)}index.html`).includes("kotiko-connect-status"));
  // The extension accepts the code only from this page, with a code.
  assert.ok(PKCE.isCallback("https://kotiko.org/connect/?code=abc"));
  assert.ok(!PKCE.isCallback("https://kotiko.org/connect/"));
  assert.ok(!PKCE.isCallback("https://kotiko.org/help/?code=abc"));
});

test("the page has no script and nothing that could carry the code away", () => {
  ensureBuilt();
  const html = read("connect/index.html");
  assert.doesNotMatch(html, /<script/i, "no <script>");
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "no inline event handlers");
  assert.doesNotMatch(html, /<(form|iframe|object|embed|base)\b/i, "no form, frame, object or base");
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1];
  assert.ok(csp, "a Content-Security-Policy");
  const directives = Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ")]));
  assert.equal(directives["default-src"], "'none'", "scripts, connections and frames are refused");
  assert.equal(directives["form-action"], "'none'");
  assert.equal(directives["base-uri"], "'none'");
  for (const k of ["script-src", "connect-src", "frame-src", "worker-src"]) assert.equal(directives[k], undefined, `${k} falls back to 'none'`);
  assert.match(html, /<meta name="referrer" content="no-referrer"/);
  assert.match(html, /<meta name="robots" content="noindex"/);
  for (const { url } of urlsOf(html)) assert.ok(!isThirdParty(url), `${url} stays on kotiko.org`);
});

test("without the extension, the page explains what to do in plain text", () => {
  ensureBuilt();
  const body = text(read("connect/index.html"));
  assert.match(body, /If Kotiko is installed in this browser, it is finishing your sign-in now/);
  assert.match(body, /If this line doesn't change, Kotiko isn't installed or is turned off in this browser/);
  assert.match(body, /This page has no scripts and sends nothing anywhere/);
  const status = read("connect/index.html").match(/<p id="kotiko-connect-status"[^>]*role="status"/);
  assert.ok(status, "the line the extension updates is a live status region");
});
