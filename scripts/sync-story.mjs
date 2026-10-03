#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The "Why Kotiko?" story has one source (slice 05 section 1): the English text lives only
// in slices/05-brand-identity/SPEC.md. This script writes it to docs/story/en.md, the
// shared file the docs site and the extension render, and copies every
// docs/story/<locale>.md into extension/story/, which the dashboard's About (slice 22)
// reads. Other locales are written by hand in docs/story/ (Spanish by a native writer from
// 05's brief), never translated here.
//
//   node scripts/sync-story.mjs           write docs/story/en.md and extension/story/
//   node scripts/sync-story.mjs --check   exit 1 if any copy differs from its source
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "slices/05-brand-identity/SPEC.md";
const DOCS = "docs/story";
const EXT = "extension/story";
const HEADING = "**Why Kotiko?**";

const GENERATED =
  "<!-- Generated from slices/05-brand-identity/SPEC.md section 1 by scripts/sync-story.mjs.\n" +
  "     Edit the story there, then run `node scripts/sync-story.mjs`. -->\n";

// The story's paragraphs: the block quote right after the "Why Kotiko?" line, with its
// wrapped lines joined.
export function extractStory(spec) {
  const lines = spec.split("\n");
  const start = lines.findIndex((l) => l.startsWith(HEADING));
  if (start < 0) throw new Error(`${SOURCE} has no ${HEADING} line`);
  const paragraphs = [];
  let current = [];
  let seen = false;
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith(">")) {
      if (seen) break;
      continue;
    }
    seen = true;
    const text = line.replace(/^>\s?/, "").trim();
    if (text) current.push(text);
    else if (current.length) paragraphs.push(current.splice(0).join(" "));
  }
  if (current.length) paragraphs.push(current.join(" "));
  if (paragraphs.length < 2) throw new Error(`${SOURCE}: the story after ${HEADING} is missing`);
  return paragraphs;
}

export function englishFile(spec) {
  return `${GENERATED}\n# Why Kotiko?\n\n${extractStory(spec).join("\n\n")}\n`;
}

// What each file should contain: docs/story/en.md from the spec, and an identical copy of
// every docs/story/<locale>.md in the extension.
export function expected(root = ROOT) {
  const files = new Map();
  const en = englishFile(fs.readFileSync(path.join(root, SOURCE), "utf8"));
  files.set(`${DOCS}/en.md`, en);
  const found = fs.readdirSync(path.join(root, DOCS)).filter((f) => /^[a-z]{2,3}(_[A-Z]{2})?\.md$/.test(f));
  const locales = [...new Set(["en.md", ...found])].sort();
  for (const f of locales) files.set(`${EXT}/${f}`, f === "en.md" ? en : fs.readFileSync(path.join(root, DOCS, f), "utf8"));
  return files;
}

// Problems as "path: why" lines; empty when everything matches.
export function check(root = ROOT) {
  const want = expected(root);
  const problems = [];
  for (const [rel, text] of want) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) problems.push(`${rel}: missing`);
    else if (fs.readFileSync(file, "utf8") !== text) problems.push(`${rel}: differs from its source`);
  }
  const extDir = path.join(root, EXT);
  for (const f of fs.existsSync(extDir) ? fs.readdirSync(extDir) : []) {
    if (!want.has(`${EXT}/${f}`)) problems.push(`${EXT}/${f}: no source in ${DOCS}/`);
  }
  return problems;
}

function write(root = ROOT) {
  const want = expected(root);
  fs.mkdirSync(path.join(root, EXT), { recursive: true });
  for (const f of fs.readdirSync(path.join(root, EXT))) if (!want.has(`${EXT}/${f}`)) fs.rmSync(path.join(root, EXT, f));
  for (const [rel, text] of want) fs.writeFileSync(path.join(root, rel), text);
  return want.size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const problems = check();
    if (problems.length) {
      console.error(`The story copies are stale; run node scripts/sync-story.mjs:\n  ${problems.join("\n  ")}`);
      process.exit(1);
    }
    console.log("The story copies match their sources.");
  } else {
    console.log(`Wrote ${write()} story files.`);
  }
}
