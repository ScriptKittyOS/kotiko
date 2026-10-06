// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// /privacy/ publishes docs/privacy/en.md (slice 28 §2, slice 44 acceptance): its text,
// block by block, is exactly what the extension's privacy.html shows from its own copy of
// the same file (extension/lib/policy.js), so the two can't drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ensureBuilt, read, extensionGlobal, text, ROOT } from "./helpers.mjs";
import { problems as extensionCopyProblems } from "../../scripts/sync-privacy.mjs";

const spanText = (spans) => spans.map((s) => s.text ?? s.strong ?? s.code ?? s.link).join("").replace(/\s+/g, " ").trim();

// The policy as the extension renders it: [type, text] per heading, paragraph and item.
function extensionBlocks() {
  const { parse } = extensionGlobal("extension/lib/policy.js", "KotikoPolicy");
  const md = fs.readFileSync(path.join(ROOT, "extension/privacy/en.md"), "utf8");
  // JSON round trip: the sandbox's arrays come from another realm.
  return JSON.parse(JSON.stringify(parse(md))).flatMap((b) => (b.type === "ul" ? b.items.map((i) => ["li", spanText(i)]) : [[b.type, spanText(b.spans)]]));
}

// The same from the built page: its title, then the content section.
function siteBlocks() {
  const html = read("privacy/index.html");
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1];
  const start = html.indexOf('class="sl-markdown-content"');
  const end = html.indexOf("<footer", start);
  assert.ok(start > 0 && end > start, "the page has a content section");
  const content = html.slice(start, end);
  const blocks = [...content.matchAll(/<(h2|p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => [m[1], text(m[2])]);
  return [["h1", text(h1)], ...blocks];
}

test("the extension's copy of the policy is the published source", () => {
  assert.deepEqual(extensionCopyProblems(), []);
});

test("/privacy/ shows the same blocks, in the same order, as the extension's privacy page", () => {
  ensureBuilt();
  assert.deepEqual(siteBlocks(), extensionBlocks());
});

test("/privacy/ carries the policy's version, date and changelog", () => {
  ensureBuilt();
  const html = read("privacy/index.html");
  const source = fs.readFileSync(path.join(ROOT, "docs/privacy/en.md"), "utf8");
  const version = source.match(/^Version \d+ · .+$/m)[0];
  assert.ok(text(html).includes(version), `shows "${version}"`);
  assert.match(html, /id="changelog"/);
});
