// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Store listings come from src/config.ts (one value per store). While a value is null the
// install and home pages say "Coming soon to …" and link to no store.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ensureBuilt, read, text, SITE } from "./helpers.mjs";

function configured() {
  const src = fs.readFileSync(path.join(SITE, "src/config.ts"), "utf8");
  const value = (k) => {
    const m = src.match(new RegExp(`^\\s*${k}:\\s*(null|"[^"]*")`, "m"));
    assert.ok(m, `src/config.ts sets stores.${k}`);
    return m[1] === "null" ? null : JSON.parse(m[1]);
  };
  return { chrome: value("chrome"), firefox: value("firefox") };
}

const NAMES = { chrome: "the Chrome Web Store", firefox: "Firefox Add-ons" };

for (const page of ["install/index.html", "index.html"]) {
  test(`${page} follows the store settings`, () => {
    ensureBuilt();
    const html = read(page);
    const body = text(html);
    for (const [id, url] of Object.entries(configured())) {
      if (url === null) {
        assert.ok(body.includes(`Coming soon to ${NAMES[id]}`), `${page} says the ${NAMES[id]} listing is coming`);
        assert.doesNotMatch(html, id === "chrome" ? /chromewebstore\.google\.com|chrome\.google\.com\/webstore/ : /addons\.mozilla\.org/, `${page} links to no ${NAMES[id]} page`);
      } else {
        assert.ok(html.includes(`href="${url}"`), `${page} links to ${url}`);
      }
    }
  });
}

test("the install page always offers the GitHub release", () => {
  ensureBuilt();
  const html = read("install/index.html");
  assert.match(html, /id="from-source"/);
  assert.match(html, /href="https:\/\/github\.com\/ScriptKittyOS\/kotiko\/releases"/);
});
