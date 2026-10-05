#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The privacy policy has one source per language (slice 28 §2): docs/privacy/<locale>.md,
// which the docs site publishes. This copies each one into extension/privacy/, which the
// bundled extension/privacy.html renders, so the copy in the extension is the published
// text, word for word. English is the reference; other languages are added by translators
// as docs/privacy/<locale>.md and copied the same way. inventory.md is not a policy and
// stays out of the package.
//
//   node scripts/sync-privacy.mjs           copy docs/privacy/<locale>.md into the extension
//   node scripts/sync-privacy.mjs --check   exit 1 if a copy differs, is missing or is extra
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = "docs/privacy";
const EXT = "extension/privacy";
const LOCALE_FILE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\.md$/;

// Each locale's policy file and its text, from docs/privacy.
export function expected(root = ROOT) {
  const files = new Map();
  for (const name of fs.readdirSync(path.join(root, DOCS)).sort()) {
    if (LOCALE_FILE.test(name)) files.set(`${EXT}/${name}`, fs.readFileSync(path.join(root, DOCS, name), "utf8"));
  }
  if (!files.has(`${EXT}/en.md`)) throw new Error(`${DOCS}/en.md is missing`);
  return files;
}

// The differences between the extension's copies and their sources, as messages.
export function problems(root = ROOT) {
  const want = expected(root);
  const out = [];
  for (const [rel, text] of want) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) out.push(`${rel} is missing`);
    else if (fs.readFileSync(file, "utf8") !== text) out.push(`${rel} differs from ${DOCS}/${path.basename(rel)}`);
  }
  for (const name of fs.existsSync(path.join(root, EXT)) ? fs.readdirSync(path.join(root, EXT)) : []) {
    if (!want.has(`${EXT}/${name}`)) out.push(`${EXT}/${name} has no source in ${DOCS}`);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const p = problems();
    for (const line of p) console.error(line);
    if (p.length) {
      console.error("Run `node scripts/sync-privacy.mjs` to update the extension's copies.");
      process.exit(1);
    }
    console.log("The extension's privacy policy matches docs/privacy.");
  } else {
    fs.mkdirSync(path.join(ROOT, EXT), { recursive: true });
    for (const [rel, text] of expected()) fs.writeFileSync(path.join(ROOT, rel), text);
    console.log(`Copied ${expected().size} policy file(s) into ${EXT}.`);
  }
}
