// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The README points people at this site (slice 44 §7): every kotiko.org link in it is a
// page the site builds, with its #anchor; every link into the repository is a file that
// exists; every #anchor in the README is one of its own headings.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ensureBuilt, ROOT } from "./helpers.mjs";
import { fileFor, idsOf } from "../scripts/check-dist.mjs";

const README = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const links = [...README.matchAll(/\]\(([^)\s]+)\)|\s(?:href|src)="([^"]+)"/g)].map((m) => m[1] ?? m[2]);

// GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens.
const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");

test("every kotiko.org link in the README is built, anchors included", () => {
  const dist = ensureBuilt();
  const site = links.filter((l) => l.startsWith("https://kotiko.org/"));
  assert.ok(site.length >= 5, "the README links to the site");
  for (const l of site) {
    const u = new URL(l);
    const file = fileFor(dist, u.pathname);
    assert.ok(file, `${l} is built`);
    if (u.hash) assert.ok(idsOf(fs.readFileSync(file, "utf8")).has(u.hash.slice(1)), `${l} has its anchor`);
  }
});

test("every repository link in the README exists, and its own anchors are headings", () => {
  const headings = new Set([...README.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1])));
  for (const l of links) {
    if (/^[a-z]+:/i.test(l)) continue;
    if (l.startsWith("#")) {
      assert.ok(headings.has(l.slice(1)), `${l} is a heading in the README`);
      continue;
    }
    assert.ok(fs.existsSync(path.join(ROOT, l.split("#")[0])), `${l} exists`);
  }
});

test("the README never says Kotiko replaces English words or starts with a server", () => {
  assert.doesNotMatch(README, /English (word|page)s?\b(?! is)/i);
  assert.doesNotMatch(README, /You need Elixir/);
});
