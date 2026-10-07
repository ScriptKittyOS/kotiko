// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Fails when a tracked file still uses a name the project had before Kotiko: Slovo
// (and its Cyrillic spelling), or Mira, the withdrawn working name (now only the mascot's).
// No dependencies. Usage: node scripts/check-old-name.mjs
//
// Allowed:
//   - whole paths in ALLOWED_PATHS below (history, research, slices, brand, the data move);
//   - a line containing the marker legacy-name-ok;
//   - the line after a comment line that contains the marker (for formatters that move
//     trailing comments, like mix format);
//   - lines between legacy-name-ok-start and legacy-name-ok-end markers.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const OLD_NAMES = [/slovo/i, /слово/i, /(?<![a-z])mira/i];
const MARKER = "legacy-name-ok";

// Paths ending in "/" are folders.
const ALLOWED_PATHS = [
  "CHANGELOG.md", // release notes name the old name for good
  // Security reviews append the reviewers' reports unchanged (slice 54), and those name the
  // old data folder (finding B-03).
  "docs/security/review-v1.0.0.md",
  "docs/research/",
  "slices/",
  "brand/", // Mira is the mascot
  // The "Why Kotiko?" story names the mascot (slice 05 section 1) and its copies.
  "docs/story/",
  "extension/story/",
  "LICENSES/",
  "scripts/check-old-name.mjs", // this file
  // The one-time move of the old data folder must name its paths.
  "server/lib/kotiko/data_dir.ex",
  "server/test/kotiko/data_dir_test.exs",
  // Generated from Unicode CLDR: language names such as Mirandese.
  "spec/languages.json",
  "extension/spec/languages.json",
  "extension/spec/spec.js",
  // Imported from stopwords-iso: Russian's common words include слово ("word").
  "spec/lang/_generic/stopwords.json",
  "extension/spec/lang/_generic/stopwords.json",
];

// Generated lines that can contain any letters (package hashes and URLs).
const GENERATED = /^\s*"(integrity|resolved)": /;
const COMMENT_LINE = /^\s*(#|\/\/|\/\*|\*|<!--|--)/;

const allowedPath = (f) => ALLOWED_PATHS.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p));
const hasOldName = (text) => OLD_NAMES.some((re) => re.test(text));

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const found = [];
for (const file of files) {
  if (allowedPath(file)) continue;
  if (hasOldName(file)) found.push(`${file}: the file name`);
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // deleted in the working tree
  }
  if (buf.includes(0)) continue; // binary

  let region = false;
  let coverNext = false;
  buf
    .toString("utf8")
    .split("\n")
    .forEach((line, i) => {
      const covered = coverNext;
      coverNext = false;
      if (line.includes(`${MARKER}-start`)) region = true;
      const inRegion = region;
      if (line.includes(`${MARKER}-end`)) region = false;
      const marked = line.includes(MARKER);
      if (marked && COMMENT_LINE.test(line)) coverNext = true;
      if (inRegion || marked || covered || GENERATED.test(line)) return;
      if (hasOldName(line)) found.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  if (region) found.push(`${file}: ${MARKER}-start without ${MARKER}-end`);
}

if (found.length) {
  console.error(`The old name is still used in ${found.length} place(s):\n`);
  for (const f of found) console.error(`  ${f}`);
  console.error(
    "\nUse Kotiko. If a line must name the old one (compatibility or migration code), add a " +
      `comment containing ${MARKER} on it or on the comment line just above it.`,
  );
  process.exit(1);
}
console.log(`No old names in ${files.length} files.`);
