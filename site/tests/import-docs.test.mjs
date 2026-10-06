// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// scripts/import-docs.mjs: the repository's documents published as pages, with their links
// pointing at the site or at GitHub; a missing source stops the build.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SOURCES, BRAND, rewriteTarget, transform, page, ROOT } from "../scripts/import-docs.mjs";

test("every source and brand file exists", () => {
  for (const s of SOURCES) assert.ok(fs.existsSync(path.join(ROOT, s.from)), s.from);
  for (const b of BRAND) assert.ok(fs.existsSync(path.join(ROOT, b.from)), b.from);
});

test("the privacy policy, the references and the contributor documents are published", () => {
  const from = SOURCES.map((s) => s.from);
  for (const f of ["docs/privacy/en.md", "docs/reference/configuration.md", "docs/reference/http-api.md", "docs/ARCHITECTURE.md", "docs/CODING_STANDARDS.md", "GOVERNANCE.md", "ROADMAP.md", "CONTRIBUTING.md"]) {
    assert.ok(from.includes(f), f);
  }
});

test("links go to the page that publishes their target, else to GitHub", () => {
  assert.equal(rewriteTarget("configuration.md#port", "docs/reference/http-api.md"), "/server/configuration/#port");
  assert.equal(rewriteTarget("../GOVERNANCE.md", "docs/ARCHITECTURE.md"), "/contribute/governance/");
  assert.equal(rewriteTarget("../extension/lib/messages.js", "docs/ARCHITECTURE.md"), "https://github.com/ScriptKittyOS/kotiko/blob/main/extension/lib/messages.js");
  assert.equal(rewriteTarget("slices/README.md", "CONTRIBUTING.md"), "https://github.com/ScriptKittyOS/kotiko/blob/main/slices/README.md");
  assert.equal(rewriteTarget("spec/", "CONTRIBUTING.md"), "https://github.com/ScriptKittyOS/kotiko/tree/main/spec");
  assert.equal(rewriteTarget("#setup", "CONTRIBUTING.md"), "#setup");
  assert.equal(rewriteTarget("https://example.org/a.md", "CONTRIBUTING.md"), "https://example.org/a.md");
  assert.equal(rewriteTarget("mailto:hello@scriptkittyos.com", "CONTRIBUTING.md"), "mailto:hello@scriptkittyos.com");
});

test("the title line and leading comments go; code blocks are left alone", () => {
  const md = "<!-- generated -->\n\n# Title\n\nSee [a](GOVERNANCE.md).\n\n```\n[b](GOVERNANCE.md)\n```\n";
  assert.equal(transform(md, "README.md"), "See [a](/contribute/governance/).\n\n```\n[b](GOVERNANCE.md)\n```\n");
});

test("a missing source stops the build", () => {
  assert.throws(() => page({ from: "docs/nope.md", to: "nope.md", title: "x", description: "x" }), /docs\/nope\.md is missing/);
});
