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
// Any line that reads as a gate line, however it is dressed up, so that only one may exist.
const ANY_GATE_RE = /^[\s>*_\-+#]*gate[*_\s]*:/i;

const realDate = (d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);

/** The lead's closing line in a report's text, or null while the gate is open. */
export function gateLine(text) {
  const lines = text.split(/\r?\n/);
  const end = lines.findIndex((l) => APPENDIX_RE.test(l));
  if (end < 0) return null;
  const gates = lines.slice(0, end).filter((l) => ANY_GATE_RE.test(l));
  if (gates.length !== 1) return null;
  const m = gates[0].match(CLOSED_RE);
  if (!m || !realDate(m[1])) return null;
  return { date: m[1], by: m[2], candidate: m[3] };
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
  let reports = names.filter((n) => REPORT_RE.test(n)).sort();
  if (version && reports.some((n) => n.match(REPORT_RE)[1] === version)) {
    reports = reports.filter((n) => n.match(REPORT_RE)[1] === version);
  }
  return reports.filter((n) => {
    const line = gateLine(readFileSync(join(dir, n), "utf8"));
    return line !== null && core(line.candidate) === n.match(REPORT_RE)[1];
  });
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
    process.exitCode = 1;
  }
}
