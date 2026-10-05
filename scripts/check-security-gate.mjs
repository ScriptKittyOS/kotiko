#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The store uploads wait for the pre-release security review (slice 54; DECISIONS
// 2026-10-02). The review ends with docs/security/review-<tag>.md and a line saying the gate
// is closed:
//
//   Gate: closed 2026-11-02 by <lead>, fixes confirmed on v0.3.0-rc.2
//
// This check passes when the tagged tree has at least one such report. The release workflow
// runs it before asking for the `release` environment's approval, so no store upload can
// happen before the first review is done. Later releases that touch permissions, messaging,
// secrets, the server's API or the bot reopen the review by hand: a box on the release
// checklist (docs/stores.md).
//
//   node scripts/check-security-gate.mjs [--dir docs/security]

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPORT_RE = /^review-v\d+\.\d+\.\d+(?:-rc\.\d+)?\.md$/;
export const CLOSED_RE = /^\s*(?:[-*]\s*)?(?:\*\*)?Gate:(?:\*\*)?\s*closed\b/im;

/** Report files in dir whose text has a "Gate: closed" line. */
export function closedReviews(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return names.filter((n) => REPORT_RE.test(n)).sort().filter((n) => CLOSED_RE.test(readFileSync(join(dir, n), "utf8")));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--dir");
  const dir = i > 0 ? resolve(process.argv[i + 1]) : join(ROOT, "docs/security");
  const closed = closedReviews(dir);
  if (closed.length) {
    console.log(`Security review closed: ${closed.join(", ")}`);
  } else {
    console.error(
      "check-security-gate: no closed security review. Store uploads wait for slice 54's review: " +
        "docs/security/review-<tag>.md with a line starting \"Gate: closed\".",
    );
    process.exitCode = 1;
  }
}
