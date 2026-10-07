// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 54 §6: the store gate opens only on the lead's own "Gate: closed" line, in its one
// exact form, above the report's "## Appendix" heading. Security review C-05: before, any line
// starting with "Gate: closed" anywhere in a review-v*.md opened it, including inside the
// reviewers' reports appended below and in "**Gate:** closed? No" notes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closedReviews, gateLine } from "../../scripts/check-security-gate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CLOSED = "Gate: closed 2026-11-02 by Ayla Croft, fixes confirmed on v1.0.0-rc.2";

function gateDir(t, files) {
  const dir = mkdtempSync(join(tmpdir(), "kotiko-gate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
const report = (lead, appendix = "") => `# Security review: v1.0.0-rc.1\n\n${lead}\n\n## Appendix: the reviewers' reports, unchanged\n\n${appendix}\n`;

// Reviewer C's three texts (test/security/poc/gate-false-positive.sh at v1.0.0-rc.1).
test("C-05: an open review stays open, whatever its appended reports or notes say", (t) => {
  for (const text of [
    "Gate: open (fixes pending on rc.2)\n",
    "Gate: open\n\n## Appendix: reviewer A report (unchanged)\n- Gate: closed is what the lead writes at the end; not yet.\n",
    "**Gate:** closed? No: two medium findings are still open.\n",
  ]) {
    const dir = gateDir(t, { "review-v1.0.0-rc.1.md": text });
    assert.deepEqual(closedReviews(dir), [], text);
  }
});

test("only the exact closed line, above the appendix, closes the gate", (t) => {
  assert.deepEqual(closedReviews(gateDir(t, { "review-v1.0.0-rc.1.md": report(CLOSED) })), ["review-v1.0.0-rc.1.md"]);
  for (const lead of [
    "Gate: open",
    `**${CLOSED}**`,
    `- ${CLOSED}`,
    `${CLOSED}.`,
    "Gate: closed 2026-11-02 by Ayla Croft",
    "Gate: closed 2026-13-02 by Ayla Croft, fixes confirmed on v1.0.0-rc.2",
    "Gate: closed 2026-11-02 by Ayla Croft, fixes confirmed on v1.0.0",
    "Gate: closed soon, by Ayla Croft, fixes confirmed on v1.0.0-rc.2",
    `Gate: open\n${CLOSED}`,
    `${CLOSED}\nGate: open again: a fix regressed`,
  ]) {
    assert.deepEqual(closedReviews(gateDir(t, { "review-v1.0.0-rc.1.md": report(lead) })), [], lead);
  }
  // The line in an appended report counts for nothing; neither does a report without an appendix heading.
  assert.deepEqual(closedReviews(gateDir(t, { "review-v1.0.0-rc.1.md": report("Gate: open", CLOSED) })), []);
  assert.deepEqual(closedReviews(gateDir(t, { "review-v1.0.0-rc.1.md": `# Review\n\n${CLOSED}\n` })), []);
  // The candidate the fixes were confirmed on is a candidate of the reviewed version.
  assert.deepEqual(closedReviews(gateDir(t, { "review-v1.1.0-rc.1.md": report(CLOSED) })), []);
});

test("gateLine reads the date, the lead and the candidate", () => {
  assert.deepEqual(gateLine(report(CLOSED)), { date: "2026-11-02", by: "Ayla Croft", candidate: "v1.0.0-rc.2" });
  assert.equal(gateLine(report("Gate: open")), null);
});

test("a review opened for the version being released must be closed; older closed reviews don't stand in", (t) => {
  const older = "Gate: closed 2026-11-02 by Ayla Croft, fixes confirmed on v1.0.0-rc.2";
  const dir = gateDir(t, {
    "review-v1.0.0-rc.1.md": report(older),
    "review-v1.1.0-rc.1.md": report("Gate: open"),
  });
  assert.deepEqual(closedReviews(dir, { version: "1.0.1" }), ["review-v1.0.0-rc.1.md"], "no review for 1.0.1: the first review gates it");
  assert.deepEqual(closedReviews(dir, { version: "1.1.0" }), [], "1.1.0's own review is open");
  writeFileSync(join(dir, "review-v1.1.0-rc.1.md"), report("Gate: closed 2027-01-10 by Ayla Croft, fixes confirmed on v1.1.0-rc.3"));
  assert.deepEqual(closedReviews(dir, { version: "1.1.0" }), ["review-v1.1.0-rc.1.md"]);
});

test("the command line: --version, and the exit code", (t) => {
  const dir = gateDir(t, { "review-v1.0.0-rc.1.md": report("Gate: open", CLOSED) });
  const gate = (...args) => spawnSync("node", ["scripts/check-security-gate.mjs", "--dir", dir, ...args], { cwd: ROOT, encoding: "utf8" });
  let r = gate("--version", "1.0.0");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no closed security review/);
  writeFileSync(join(dir, "review-v1.0.0-rc.1.md"), report(CLOSED));
  r = gate("--version", "1.0.0");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Security review closed: review-v1\.0\.0-rc\.1\.md/);
  assert.equal(gate("--version", "v1.0.0").status, 2, "a version, not a tag");
});
