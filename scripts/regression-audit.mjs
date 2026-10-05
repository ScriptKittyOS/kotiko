// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 53 section 4.9: how many bug fixes came with a regression test, for the OpenSSF
// silver criterion regression_tests_added50. Lists the `fix` and `fix!` commits (any scope)
// in the last six months, marks each one that changed a test file in the same commit, and
// prints the ratio and the fixes without one. Not a CI gate: the test policy in
// CONTRIBUTING.md allows explained exceptions. The badge steward runs it at each review.
// No dependencies.
//
// Usage: node scripts/regression-audit.mjs [--ref main] [--since "6 months ago"] [--dir .]
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const FIX = /^fix(\([^)]*\))?!?:/;

// Test files: anything under test/ or server/test/, the shared golden cases both test
// suites run (spec/fixtures/), and *.test.mjs or *_test.exs anywhere.
export function isTestFile(path) {
  return /^(server\/)?test\/|^spec\/fixtures\//.test(path) || /\.test\.mjs$|_test\.exs$/.test(path);
}

// [{hash, subject, files}] for the non-merge commits reachable from ref since `since`.
export function fixCommits({ dir = ".", ref = "main", since = "6 months ago" } = {}) {
  const out = execFileSync(
    "git",
    ["-C", dir, "log", "--no-merges", `--since=${since}`, "--format=%x00%H%x1f%s", "--name-only", ref],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return out
    .split("\0")
    .filter((chunk) => chunk.trim() !== "")
    .map((chunk) => {
      const [header, ...rest] = chunk.split("\n");
      const [hash, subject] = header.split("\x1f");
      return { hash, subject, files: rest.map((f) => f.trim()).filter(Boolean) };
    })
    .filter((c) => FIX.test(c.subject));
}

export function audit(commits) {
  const withTest = commits.filter((c) => c.files.some(isTestFile));
  const without = commits.filter((c) => !c.files.some(isTestFile));
  const ratio = commits.length === 0 ? null : withTest.length / commits.length;
  return { total: commits.length, withTest: withTest.length, without, ratio };
}

export function report({ total, withTest, without, ratio }, { ref, since }) {
  const lines = [`Fix commits on ${ref} since ${since}: ${total}`];
  if (total === 0) {
    lines.push("No fix commits, so the ratio is not defined.");
    return lines.join("\n");
  }
  lines.push(`${withTest} of ${total} changed a test in the same commit (${Math.round(ratio * 100)} %).`);
  if (without.length > 0) {
    lines.push("Without a test change:");
    for (const c of without) lines.push(`  ${c.hash.slice(0, 7)} ${c.subject}`);
  }
  return lines.join("\n");
}

function option(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opts = {
    dir: option(args, "--dir", "."),
    ref: option(args, "--ref", "main"),
    since: option(args, "--since", "6 months ago"),
  };
  console.log(report(audit(fixCommits(opts)), opts));
}
