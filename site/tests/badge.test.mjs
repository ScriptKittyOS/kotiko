// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The OpenSSF Best Practices badge in the footer: every page links to the entry and shows
// the level set in src/config.ts, drawn in CSS rather than loaded from another host.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ensureBuilt, read, text, SITE } from "./helpers.mjs";

const level = fs.readFileSync(path.join(SITE, "src/config.ts"), "utf8").match(/level:\s*"(passing|silver|gold)"/)?.[1];

test("config.ts names a badge level", () => {
  assert.ok(level, "src/config.ts sets openssf.level");
});

for (const page of ["index.html", "install/index.html", "privacy/index.html"]) {
  test(`${page} shows the ${level} badge linked to the entry`, () => {
    ensureBuilt();
    const html = read(page);
    const badge = html.match(/<a class="kotiko-badge[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    assert.ok(badge, "the footer has the badge");
    assert.equal(badge[1], "https://www.bestpractices.dev/projects/15259");
    assert.equal(text(badge[2]), `OpenSSF Best Practices ${level}`);
    assert.match(badge[0], new RegExp(`aria-label="OpenSSF Best Practices: ${level}"`));
    assert.doesNotMatch(html, /bestpractices\.dev\/projects\/15259\/badge/, "no image loaded from bestpractices.dev");
  });
}
