#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The Chrome Web Store review status, written into the GitHub release's notes (slice 30 §4).
// Run daily by .github/workflows/store-status.yml:
//
//   node scripts/cws-status.mjs --version 0.3.0 --body release-body.md --out new-body.md
//
// reads the item's status (Chrome Web Store API v2 fetchStatus, through the
// chrome-webstore-upload package), replaces the status block in the release body (or adds it
// at the end) and writes the result to --out. Prints "changed" or "unchanged", so the
// workflow edits the release only when the status moved. Credentials come from the
// environment: CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN (a read-only token is
// enough), CWS_PUBLISHER_ID, CWS_EXTENSION_ID.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const START = "<!-- cws-status -->";
export const END = "<!-- /cws-status -->";

const STATES = {
  PENDING_REVIEW: "in review",
  STAGED: "approved, waiting to be published",
  PUBLISHED: "published",
  PUBLISHED_TO_TESTERS: "published to testers",
  REJECTED: "rejected",
  CANCELLED: "submission cancelled",
};

function describeRevision(rev) {
  if (!rev?.state) return null;
  const channel = rev.distributionChannels?.[0];
  const what = STATES[rev.state] ?? rev.state.toLowerCase().replace(/_/g, " ");
  const version = channel?.crxVersion ? `${channel.crxVersion} ` : "";
  const pct = channel?.deployPercentage != null && channel.deployPercentage < 100 ? ` to ${channel.deployPercentage} % of users` : "";
  return `${version}${what}${pct}`;
}

/** One line for the release page, from a fetchStatus response. */
export function summarize(status, version, now = new Date()) {
  const parts = [];
  if (status.takenDown) parts.push("**taken down** (see the developer dashboard)");
  const submitted = describeRevision(status.submittedItemRevisionStatus);
  const published = describeRevision(status.publishedItemRevisionStatus);
  if (submitted) parts.push(`submitted: ${submitted}`);
  if (published) parts.push(`live: ${published}`);
  if (status.warned) parts.push("the dashboard has a policy warning");
  if (!parts.length) parts.push("no status yet");
  const live = status.publishedItemRevisionStatus?.distributionChannels?.some((c) => c.crxVersion === version);
  const lead = live && status.publishedItemRevisionStatus?.state === "PUBLISHED" ? `${version} is live. ` : "";
  return `**Chrome Web Store** (checked ${now.toISOString().slice(0, 10)}): ${lead}${parts.join("; ")}.`;
}

/** The body with the status block replaced, or appended when there is none. */
export function withStatus(body, line) {
  const block = `${START}\n${line}\n${END}`;
  const i = body.indexOf(START);
  const j = body.indexOf(END);
  if (i >= 0 && j > i) return body.slice(0, i) + block + body.slice(j + END.length);
  return `${body.replace(/\s*$/, "")}\n\n${block}\n`;
}

/** Compares two bodies ignoring the "checked <date>" stamp, so a daily run with no news edits nothing. */
export function sameStatus(a, b) {
  const strip = (s) => s.replace(/\(checked \d{4}-\d{2}-\d{2}\)/g, "");
  return strip(a) === strip(b);
}

async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!args.version || !args.body || !args.out) throw new Error("Usage: cws-status.mjs --version X.Y.Z --body in.md --out out.md");
  const { default: chromeWebstoreUpload } = await import("chrome-webstore-upload");
  const store = chromeWebstoreUpload({
    extensionId: process.env.CWS_EXTENSION_ID,
    publisherId: process.env.CWS_PUBLISHER_ID,
    clientId: process.env.CWS_CLIENT_ID,
    clientSecret: process.env.CWS_CLIENT_SECRET,
    refreshToken: process.env.CWS_REFRESH_TOKEN,
  });
  const status = await store.get();
  const body = readFileSync(args.body, "utf8");
  const next = withStatus(body, summarize(status, args.version));
  writeFileSync(args.out, next);
  console.log(sameStatus(body, next) ? "unchanged" : "changed");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    // The library's errors carry the API's message, never the credentials.
    console.error(`cws-status: ${e.message}`);
    process.exitCode = 1;
  });
}
