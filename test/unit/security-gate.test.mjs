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
import { closedReviews, gateLine, gateProblem } from "../../scripts/check-security-gate.mjs";

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

// Security review D-05: an open gate line the script couldn't read (a lookalike letter, an
// invisible character, a fullwidth colon) sat beside the exact closed line, so a reader saw
// "Gate: open" while the gate read closed.
test("D-05: a gate line in lookalike, invisible or fullwidth characters keeps the gate open", (t) => {
  const disguised = [
    "G\u0430te: open (fixes pending)", // Cyrillic а
    "\u200BGate: open (fixes pending)", // a leading zero-width space
    "Gate\uFF1A open (fixes pending)", // a fullwidth colon
    "Gat\u0435: open", // Cyrillic е
    "\u0262ate: open", // a small-capital G
    "Gate\uA789 open", // a modifier-letter colon NFKC leaves alone
    "Ga\u00ADte: open", // a soft hyphen inside the word
    "\u3164Gate: open", // a Hangul filler, an invisible letter
    "\u2022 Gate: open", // a non-ASCII bullet
    "G\u0301ate: open", // a combining accent
  ];
  for (const sneaky of disguised) {
    for (const lead of [`${sneaky}\n\n${CLOSED}`, `${CLOSED}\n\n${sneaky}`]) {
      const text = report(lead);
      assert.equal(gateLine(text), null, JSON.stringify(sneaky));
      assert.deepEqual(closedReviews(gateDir(t, { "review-v1.0.0-rc.1.md": text })), [], JSON.stringify(sneaky));
      assert.match(gateProblem(text), /2 lines above the appendix read as a gate line/, JSON.stringify(sneaky));
    }
  }
  // The closing line itself written with a lookalike doesn't close it either, and says why.
  const lookalike = report(CLOSED.replace("closed", "cl\u043Esed"));
  assert.equal(gateLine(lookalike), null);
  assert.match(gateProblem(lookalike), /characters outside plain ASCII/);
  // The exact closed line alone still closes it; prose that merely starts with "Gate" isn't a gate line.
  const fine = report(`Gatekeeping notes: none.\nGates were checked.\n- \u0441\u043F\u0430\u0441\u0438\u0431\u043E: swapped as expected.\n${CLOSED}`);
  assert.deepEqual(gateLine(fine), { date: "2026-11-02", by: "Ayla Croft", candidate: "v1.0.0-rc.2" });
  assert.equal(gateProblem(fine), null);
  assert.deepEqual(closedReviews(gateDir(t, { "review-v1.0.0-rc.1.md": report(CLOSED) })), ["review-v1.0.0-rc.1.md"]);
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
  assert.match(r.stderr, /review-v1\.0\.0-rc\.1\.md: line 3 is not the exact closed line/, "says why, per report");
  writeFileSync(join(dir, "review-v1.0.0-rc.1.md"), report(`G\u0430te: open\n${CLOSED}`));
  r = gate("--version", "1.0.0");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /2 lines above the appendix read as a gate line \(lines 3, 4\)/);
  writeFileSync(join(dir, "review-v1.0.0-rc.1.md"), report(CLOSED));
  r = gate("--version", "1.0.0");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Security review closed: review-v1\.0\.0-rc\.1\.md/);
  assert.equal(gate("--version", "v1.0.0").status, 2, "a version, not a tag");
});

// Security review E-06: reviewer E's disguises (test/security/poc/e-gate-variants.mjs at
// v1.0.0-rc.3). Each put an "open" line a reader sees beside the exact closed line, or hid
// the closed line or the appendix heading from the reader, and the gate read closed.
test("E-06: open lines in list, table, code, markup, entity or prose form keep the gate open", (t) => {
  const W = ["G", "a", "t", "e"].join("");
  const C = `${W}: closed 2026-10-08 by Lead, fixes confirmed on v1.0.0-rc.3`;
  const A = "## Appendix";
  const read = (body) => closedReviews(gateDir(t, { "review-v1.0.0-rc.3.md": body }), { version: "1.0.0" });
  assert.deepEqual(read(`# Review\n${C}\n\n${A}\n`), ["review-v1.0.0-rc.3.md"], "the exact closed line alone closes it");
  const open = {
    "ordered list '1. <W>: open'": `1. ${W}: open\n${C}\n${A}\n`,
    "table row '| <W> | open |'": `| ${W} | open |\n|---|---|\n${C}\n${A}\n`,
    "inline code '`<W>: open`'": `\`${W}: open\`\n${C}\n${A}\n`,
    "strikethrough-tilde '~<W>: open~'": `~${W}: open~\n${C}\n${A}\n`,
    "emoji prefix '🚧 <W>: open'": `🚧 ${W}: open\n${C}\n${A}\n`,
    "arrow prefix '→ <W>: open'": `→ ${W}: open\n${C}\n${A}\n`,
    "HTML tag '<b><W></b>: open'": `<b>${W}</b>: open\n${C}\n${A}\n`,
    "entity 'G&#97;te: open'": `G&#97;te: open\n${C}\n${A}\n`,
    "dollar math '$<W>$: open'": `$${W}$: open\n${C}\n${A}\n`,
    "fake appendix inside an HTML comment, open below it": `${C}\n<!--\n${A}\n-->\n${W}: open\n${A}\n`,
    "fake appendix inside a code fence, open below it": `${C}\n\`\`\`\n${A}\n\`\`\`\n${W}: open\n${A}\n`,
    "'## Appendix' + zero-width as the only heading": `${C}\n${A}\u200B\n${W}: open\n`,
    "closed line inside an HTML comment only": `<!--\n${C}\n-->\n${A}\n`,
    "closed line, then 'Status: still OPEN' prose": `${C}\nStatus: the review is still OPEN; two findings unfixed.\n${A}\n`,
    "open as setext heading text": `${W}\n: open\n${C}\n${A}\n`,
    // More of the same kind.
    "a table with the gate as a column": `| ${W} | Date |\n|---|---|\n| open | today |\n\n${C}\n\n${A}\n`,
    "a named entity for the colon": `${W}&colon; open\n\n${C}\n\n${A}\n`,
    "a word split by an inline comment": `G<!-- -->ate: open\n\n${C}\n\n${A}\n`,
    "a word split by a comment over two lines": `G<!--\n-->ate: open\n\n${C}\n\n${A}\n`,
    "the closed line inside a code fence": `\`\`\`\n${C}\n\`\`\`\n\n${A}\n`,
    "the closed line inside an HTML block": `<div hidden>\n${C}\n</div>\n\n${A}\n`,
    "the closed line struck through by the lines around it": `~~\n${C}\n~~\n\n${A}\n`,
    "'Gate open' prose beside the review": `${C}\n\nThe review stays open until E-01 is fixed.\n\n${A}\n`,
    "a blockquote": `> ${W}: open\n\n${C}\n\n${A}\n`,
    "a heading": `### ${W}: open\n\n${C}\n\n${A}\n`,
  };
  for (const [label, body] of Object.entries(open)) assert.deepEqual(read(body), [], label);
});

test("E-06: ordinary prose about the gate, and the real report's shape, don't count", () => {
  const text = [
    "# Security review: v1.0.0-rc.3",
    "",
    "The gate closes when a fifth reviewer confirms every fix; the store gate reads lines above the appendix.",
    "",
    "| ID | Severity | Status | Fix |",
    "|---|---|---|---|",
    "| E-07 | Info | Open routes answer other spellings | fixed in #40 |",
    "| E-06 | Info | The store gate still reads disguised lines as closed | fixed in #40 |",
    "",
    "<!-- the lead writes the closing line below -->",
    "",
    "```",
    "an example: ## Appendix",
    "```",
    "",
    CLOSED,
    "",
    "## Appendix: the reviewers' reports, unchanged",
    "",
    "Gate: open, says reviewer A's report, quoted.",
  ].join("\n");
  assert.equal(gateProblem(text), null);
  assert.deepEqual(gateLine(text), { date: "2026-11-02", by: "Ayla Croft", candidate: "v1.0.0-rc.2" });
});
