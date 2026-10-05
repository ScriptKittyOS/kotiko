// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 53 section 4.9: scripts/regression-audit.mjs over a history built here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit, fixCommits, isTestFile, report } from "../../scripts/regression-audit.mjs";

function repoWith(commits) {
  const dir = mkdtempSync(join(tmpdir(), "kotiko-audit-"));
  const git = (...args) =>
    execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  commits.forEach(([subject, files], i) => {
    for (const f of files) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      writeFileSync(join(dir, f), `${i}\n`);
    }
    git("add", "-A");
    git("commit", "-q", "-m", subject);
  });
  return dir;
}

test("counts the fixes that changed a test in the same commit: 2 of 3", () => {
  const dir = repoWith([
    ["feat(server): a feature", ["server/lib/a.ex", "server/test/a_test.exs"]],
    ["fix(server): with a server test", ["server/lib/a.ex", "server/test/kotiko/a_test.exs"]],
    ["fix!: with an extension test", ["extension/lib/b.js", "test/unit/b.test.mjs"]],
    ["fix(extension): no test", ["extension/lib/b.js"]],
    ["docs: not a fix", ["README.md"]],
  ]);
  try {
    const result = audit(fixCommits({ dir, ref: "main", since: "1 year ago" }));
    assert.equal(result.total, 3);
    assert.equal(result.withTest, 2);
    assert.deepEqual(result.without.map((c) => c.subject), ["fix(extension): no test"]);

    const text = report(result, { ref: "main", since: "1 year ago" });
    assert.match(text, /2 of 3 changed a test in the same commit \(67 %\)/);
    assert.match(text, /[0-9a-f]{7} fix\(extension\): no test/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no fixes means no ratio", () => {
  const text = report(audit([]), { ref: "main", since: "6 months ago" });
  assert.match(text, /ratio is not defined/);
});

test("test files are the test folders and the test file names", () => {
  for (const f of ["test/unit/x.test.mjs", "server/test/kotiko/x_test.exs", "test/e2e/a.mjs", "spec/x.test.mjs", "spec/fixtures/normalize/1.json"]) {
    assert.ok(isTestFile(f), f);
  }
  for (const f of ["extension/lib/x.js", "server/lib/kotiko/test.ex", "docs/test-plan.md", "spec/rules.json"]) {
    assert.ok(!isTestFile(f), f);
  }
});
