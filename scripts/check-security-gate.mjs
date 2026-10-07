#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The store uploads wait for the pre-release security review (slice 54; DECISIONS
// 2026-10-02). The review ends with docs/security/review-vX.Y.Z-rc.N.md, in which the lead
// closes the gate with one line of exactly this form, on a line of its own, above the
// "## Appendix" heading under which the reviewers' reports are appended unchanged:
//
//   Gate: closed 2026-11-02 by <lead>, fixes confirmed on v1.0.0-rc.2
//
// The candidate named is one of the reviewed version's (1.0.0 here). Above the appendix the
// report has exactly one line starting "Gate:", so a "Gate: open" line keeps it open. Lines
// below the appendix count for nothing: a reviewer's report may quote the phrase (security
// review C-05).
//
// "One gate line" is judged as a reader sees the text, not byte by byte (security review
// D-05: an open line in a Cyrillic letter, behind a zero-width space or with a fullwidth
// colon sat unseen beside the closed one). Each line is NFKC-normalised, stripped of
// invisible characters (format and default-ignorable code points) and of combining marks;
// then a line whose first four characters, after any leading markup, are g, a, t, e (any
// case) or a character outside ASCII, not followed by a letter or digit, reads as a gate
// line. Any non-ASCII character stands in for any letter, so lookalikes from every
// script count without a confusables table, and a colon-like character after the word
// counts too. That is stricter than a reader (a stray "Gâté:" line keeps the gate open,
// with a message saying which line), which is the safe side. The closed line itself must
// still be the exact ASCII form.
//
// This check passes when the tagged tree has a closed report. With --version X.Y.Z (the
// release workflow passes the tag's), a review opened for that version must itself be
// closed; a version without its own review is gated by the earlier ones. The release
// workflow runs it before asking for the `release` environment's approval, so no store
// upload can happen before the first review is done. Later releases that touch
// permissions, messaging, secrets, the server's API or the bot reopen the review by hand: a
// box on the release checklist (docs/stores.md).
//
//   node scripts/check-security-gate.mjs [--dir docs/security] [--version X.Y.Z]

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPORT_RE = /^review-v(\d+\.\d+\.\d+)(?:-rc\.\d+)?\.md$/;
export const CLOSED_RE = /^Gate: closed (\d{4}-\d{2}-\d{2}) by (.+), fixes confirmed on (v\d+\.\d+\.\d+-rc\.\d+)$/;
export const APPENDIX_RE = /^## Appendix\b/;
// Any line that reads as a gate line, however it is dressed up, so that only one may exist:
// after `visible`, leading markup or punctuation, then four characters that are each the
// letter of "gate" or not ASCII, and no letter or digit right after (D-05).
const ANY_GATE_RE = /^[\s\p{P}>+]*[g\P{ASCII}][a\P{ASCII}][t\P{ASCII}][e\P{ASCII}](?![\p{L}\p{N}])/iu;

/** A line as a reader sees it: NFKC, without invisible characters or combining marks. */
const visible = (line) =>
  line
    .normalize("NFKC")
    .replace(/[\p{Cf}\p{DI}]/gu, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC");
const isGateLine = (line) => ANY_GATE_RE.test(visible(line));

const realDate = (d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);

/** `{ gate }` (date, lead, candidate) when the report's gate is closed, else `{ problem }`. */
function readGate(text) {
  const lines = text.split(/\r?\n/);
  const end = lines.findIndex((l) => APPENDIX_RE.test(l));
  if (end < 0) return { problem: 'no "## Appendix" heading' };
  const gates = lines.slice(0, end).flatMap((l, i) => (isGateLine(l) ? [i + 1] : []));
  if (gates.length === 0) return { problem: 'no "Gate:" line above the appendix' };
  if (gates.length > 1) {
    return { problem: `${gates.length} lines above the appendix read as a gate line (lines ${gates.join(", ")}); keep only the one` };
  }
  const [n] = gates;
  const line = lines[n - 1];
  if (/[^\x20-\x7E]/.test(line)) {
    return { problem: `line ${n} reads as a gate line but has characters outside plain ASCII (a lookalike letter, an invisible or fullwidth character); write it in plain ASCII` };
  }
  const m = line.match(CLOSED_RE);
  if (!m) return { problem: `line ${n} is not the exact closed line` };
  if (!realDate(m[1])) return { problem: `line ${n}: ${m[1]} is not a date` };
  return { gate: { date: m[1], by: m[2], candidate: m[3] } };
}

/** The lead's closing line in a report's text, or null while the gate is open. */
export function gateLine(text) {
  return readGate(text).gate ?? null;
}

/** Why a report's gate is open (one sentence), or null when its closing line is in order. */
export function gateProblem(text) {
  return readGate(text).problem ?? null;
}

const core = (tag) => tag.replace(/^v/, "").replace(/-rc\.\d+$/, "");

/** Report files in dir whose gate is closed; with version, as that version's release sees them. */
export function closedReviews(dir, { version } = {}) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return reviews(dir, names, version)
    .filter((r) => !r.problem)
    .map((r) => r.name);
}

/** Every report the release would read, each with why its gate is open (or no problem). */
function reviews(dir, names, version) {
  let reports = names.filter((n) => REPORT_RE.test(n)).sort();
  if (version && reports.some((n) => n.match(REPORT_RE)[1] === version)) {
    reports = reports.filter((n) => n.match(REPORT_RE)[1] === version);
  }
  return reports.map((name) => {
    const { gate, problem } = readGate(readFileSync(join(dir, name), "utf8"));
    const reviewed = name.match(REPORT_RE)[1];
    if (problem) return { name, problem };
    if (core(gate.candidate) !== reviewed) return { name, problem: `${gate.candidate} is not a candidate of ${reviewed}` };
    return { name, problem: null };
  });
}

/** Why each report's gate is open, as "file: reason" lines. */
export function openReasons(dir, { version } = {}) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return reviews(dir, names, version)
    .filter((r) => r.problem)
    .map((r) => `${r.name}: ${r.problem}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const dir = arg("--dir") ? resolve(arg("--dir")) : join(ROOT, "docs/security");
  const version = arg("--version");
  if (version !== undefined && !/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version)) {
    console.error(`check-security-gate: --version takes X.Y.Z, not ${version}`);
    process.exit(2);
  }
  const closed = closedReviews(dir, { version: version && core(version) });
  if (closed.length) {
    console.log(`Security review closed: ${closed.join(", ")}`);
  } else {
    console.error(
      "check-security-gate: no closed security review. Store uploads wait for slice 54's review: " +
        "docs/security/review-vX.Y.Z-rc.N.md with, above its \"## Appendix\" heading, the one line " +
        "\"Gate: closed YYYY-MM-DD by <lead>, fixes confirmed on vX.Y.Z-rc.N\"" +
        (version ? `, and if ${core(version)} has its own review, that one closed.` : "."),
    );
    for (const reason of openReasons(dir, { version: version && core(version) })) console.error(`  ${reason}`);
    process.exitCode = 1;
  }
}
