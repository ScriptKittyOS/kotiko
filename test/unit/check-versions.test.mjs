// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// scripts/check-versions.mjs: from 1.0.0 on, SECURITY.md no longer calls Kotiko pre-1.0
// (security review B-08). Runs a copy in a throwaway folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function tree(t, version, security) {
  const dir = mkdtempSync(join(tmpdir(), "kotiko-versions-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const d of ["scripts", "extension", "server"]) mkdirSync(join(dir, d));
  copyFileSync(join(ROOT, "scripts/check-versions.mjs"), join(dir, "scripts/check-versions.mjs"));
  writeFileSync(join(dir, ".release-please-manifest.json"), JSON.stringify({ ".": version }));
  writeFileSync(join(dir, "extension/manifest.json"), JSON.stringify({ version }));
  writeFileSync(join(dir, "server/mix.exs"), `  def project do\n    [\n      version: "${version}",\n`);
  if (security !== undefined) writeFileSync(join(dir, "SECURITY.md"), security);
  return spawnSync("node", [join(dir, "scripts/check-versions.mjs")], { encoding: "utf8" });
}

test("from 1.0.0 on, SECURITY.md can't still say Kotiko is before 1.0", (t) => {
  const stale = "## Supported versions\n\nKotiko is before 1.0. Only the latest minor release gets security fixes.\n";
  assert.equal(tree(t, "0.2.0", stale).status, 0, "true before 1.0");
  const r = tree(t, "1.0.0", stale);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SECURITY\.md still says Kotiko is before 1\.0/);
  assert.equal(tree(t, "1.0.0", readFileSync(join(ROOT, "SECURITY.md"), "utf8")).status, 0, "today's SECURITY.md is fine at 1.0.0");
  assert.equal(tree(t, "1.0.0").status, 0, "no SECURITY.md (other tests' throwaway repositories)");
});
