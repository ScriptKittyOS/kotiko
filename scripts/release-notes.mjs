#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Release notes from CHANGELOG.md (slice 30 §8 and §11).
//
//   node scripts/release-notes.mjs --version 0.3.0 --check
//     Before tagging (scripts/tag-release.sh): the CHANGELOG has a section for 0.3.0, nothing
//     is left under "## Unreleased", and a breaking change has an "Upgrade notes" section.
//   node scripts/release-notes.mjs --version 0.3.0 --out notes.md
//     The GitHub release body: that section plus the fixed footer (install links, server
//     upgrade, compatibility, how to verify the files). A release candidate (0.3.0-rc.1) gets
//     a short note instead of a section.
//
// Store links come from CHROME_STORE_URL and FIREFOX_STORE_URL (repository variables) when
// set; the repository from GITHUB_REPOSITORY.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "## …" sections in order: [{ heading, body }]. Text before the first one is dropped. */
function sections(text) {
  const out = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^## /.test(line)) {
      cur = { heading: line, lines: [] };
      out.push(cur);
    } else if (cur) cur.lines.push(line);
  }
  return out.map(({ heading, lines }) => ({ heading, body: lines.join("\n").trim() }));
}

/** The body of the version's section: "## [0.3.0](…) (date)", "## 0.3.0 (date)" or "## v0.3.0". */
export function changelogSection(text, version) {
  const re = new RegExp(`^## \\[?v?${escapeRe(version)}\\]?(?:[ (]|$)`);
  return sections(text).find((s) => re.test(s.heading))?.body ?? null;
}

/** What is still under "## Unreleased" ("" when empty or absent). */
export function unreleased(text) {
  return sections(text).find((s) => /^## Unreleased\s*$/i.test(s.heading))?.body ?? "";
}

/** Problems that stop a release from being tagged. */
export function checkChangelog(text, version) {
  const problems = [];
  const v = VERSION_RE.exec(version);
  if (!v) return [`${version} isn't a release version (1.2.3 or 1.2.3-rc.4).`];
  if (v[4] !== undefined) return problems; // release candidates are tagged before the CHANGELOG entry exists
  const section = changelogSection(text, version);
  if (section === null) {
    problems.push(`CHANGELOG.md has no section for ${version}. Merge release-please's release PR first.`);
    return problems;
  }
  if (!section) problems.push(`CHANGELOG.md's section for ${version} is empty.`);
  if (unreleased(text)) {
    problems.push(
      `CHANGELOG.md still has entries under "## Unreleased". Move them into the ${version} section ` +
        "(they're the plain-language notes learners read) in the release PR, then tag.",
    );
  }
  if (/^#{2,4} .*BREAKING CHANGES/m.test(section) && !/^#{2,4} Upgrade notes\b/im.test(section)) {
    problems.push(
      `The ${version} section has breaking changes but no "### Upgrade notes" (what changed, who is affected, the steps; slice 30 §11).`,
    );
  }
  return problems;
}

/** "Extension 0.3 works with server 0.2 and 0.3" (slice 30 §9: same minor and one older). */
export function compatibilityLine(version) {
  const [, major, minor] = VERSION_RE.exec(version).map(Number);
  const cur = `${major}.${minor}`;
  if (minor === 0) return `Extension ${cur} works with server ${cur}.`;
  return `Extension ${cur} works with server ${major}.${minor - 1} and ${cur}.`;
}

export function footer({ version, repo, tag = `v${version}`, chromeUrl, firefoxUrl }) {
  const blob = `https://github.com/${repo}/blob/${tag}`;
  const install = [
    chromeUrl ? `[Chrome Web Store](${chromeUrl})` : "Chrome Web Store (link added after the first review)",
    firefoxUrl ? `[Firefox Add-ons](${firefoxUrl})` : "Firefox Add-ons (link added after the first review)",
  ];
  return [
    "---",
    "",
    "### Install or update",
    "",
    `- **Extension**: ${install.join(" or ")}. Stores update installed copies on their own.`,
    `- **Server** (optional): in your Kotiko folder run \`git pull\`, then restart it (\`./run.sh\`, or \`systemctl --user restart kotiko\`). See [Updating](${blob}/README.md#updating).`,
    `- ${compatibilityLine(version)}`,
    "",
    "### Verify the files",
    "",
    "The zips are the store packages, built from this tag; anyone can rebuild them byte for byte",
    `([how](${blob}/docs/reproducible-builds.md)). They contain only files from \`extension/\` and the`,
    "license texts, no third-party code. The server's dependencies are listed in the attached CycloneDX",
    `SBOM. Full steps, including checking the tag's signature: [docs/verify.md](${blob}/docs/verify.md).`,
    "",
    "```",
    "sha256sum -c SHA256SUMS",
    `gh attestation verify kotiko-chrome-${version}.zip --repo ${repo}`,
    `gh attestation verify kotiko-firefox-${version}.zip --repo ${repo}`,
    "```",
  ].join("\n");
}

export function releaseBody({ changelog, version, repo, chromeUrl, firefoxUrl }) {
  const v = VERSION_RE.exec(version);
  if (!v) throw new Error(`${version} isn't a release version.`);
  let head;
  if (v[4] !== undefined) {
    head = [
      `Release candidate ${v[4]} of Kotiko ${v[1]}.${v[2]}.${v[3]}, for review and testing. It isn't sent to the stores.`,
      "",
      "To try it, unzip a zip and load the folder unpacked (Chrome: `chrome://extensions`, Developer mode,",
      "Load unpacked; Firefox: `about:debugging`, This Firefox, Load Temporary Add-on).",
    ].join("\n");
  } else {
    head = changelogSection(changelog, version);
    if (!head) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  }
  return `${head}\n\n${footer({ version, repo, chromeUrl, firefoxUrl })}\n`;
}

function main(argv) {
  const args = { changelog: resolve(ROOT, "CHANGELOG.md") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--version") args.version = argv[++i];
    else if (a === "--changelog") args.changelog = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--check") args.check = true;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!args.version) throw new Error("Usage: release-notes.mjs --version X.Y.Z [--check] [--out file] [--changelog file]");
  const changelog = readFileSync(args.changelog, "utf8");
  if (args.check) {
    const problems = checkChangelog(changelog, args.version);
    for (const p of problems) console.error(`release-notes: ${p}`);
    return problems.length ? 1 : 0;
  }
  const body = releaseBody({
    changelog,
    version: args.version,
    repo: process.env.GITHUB_REPOSITORY || "ScriptKittyOS/kotiko",
    chromeUrl: process.env.CHROME_STORE_URL || undefined,
    firefoxUrl: process.env.FIREFOX_STORE_URL || undefined,
  });
  if (args.out) writeFileSync(args.out, body);
  else process.stdout.write(body);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`release-notes: ${e.message}`);
    process.exitCode = 1;
  }
}
