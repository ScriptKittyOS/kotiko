#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Writes spec/lang/_generic/stopwords.json from the stopwords-iso package (MIT, pinned in
// package.json): common words for about 60 languages, imported in one step instead of a
// list written by hand for each (slice 50 section 5). The lists are broad, so Kotiko uses
// them only to tell languages apart (slice 16's page detection, 13, 32), never to reject a
// learner's word. Entries are cleaned: NFC, lowercase in their language, letters only
// (with apostrophes, hyphens and spaces), at most 32 characters, no duplicates.
//
//   node spec/tools/import-stopwords.mjs           write the file
//   node spec/tools/import-stopwords.mjs --check   exit 1 if it is stale
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SPEC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(SPEC, "lang/_generic/stopwords.json");
const require = createRequire(import.meta.url);
const source = require("stopwords-iso/stopwords-iso.json");
const aliases = JSON.parse(fs.readFileSync(path.join(SPEC, "lang-aliases.json"), "utf8")).language;

const WORD = /^[\p{L}\p{M}' -]+$/u;

function clean(lang, list) {
  const out = new Set();
  for (const raw of list) {
    let w = String(raw).normalize("NFC").replace(/[’ʼ]/g, "'").trim();
    try {
      w = w.toLocaleLowerCase(lang);
    } catch {
      w = w.toLowerCase();
    }
    if (!w || [...w].length > 32 || !WORD.test(w) || !/\p{L}/u.test(w)) continue;
    out.add(w);
  }
  return [...out].sort();
}

function build() {
  const langs = {};
  for (const code of Object.keys(source).sort()) {
    const lang = aliases[code] ?? code;
    const words = clean(lang, source[code]);
    if (words.length) langs[lang] = [...new Set([...(langs[lang] ?? []), ...words])].sort();
  }
  const keys = Object.keys(langs).sort();
  return `{\n${keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(langs[k])}`).join(",\n")}\n}\n`;
}

const want = build();
if (process.argv.includes("--check")) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
  if (have !== want) {
    console.error("spec/lang/_generic/stopwords.json is stale. Run: node spec/tools/import-stopwords.mjs");
    process.exit(1);
  }
  console.log(`spec/lang/_generic/stopwords.json matches stopwords-iso (${Object.keys(JSON.parse(want)).length} languages).`);
} else {
  fs.writeFileSync(OUT, want);
  console.log(`Wrote spec/lang/_generic/stopwords.json (${Object.keys(JSON.parse(want)).length} languages).`);
}
