// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 50 §7 rule 1: no English-named base concepts. Fails when code in extension/,
// server/lib/ or spec/ names the base side "english": a field, key or variable such as
// `english`, `english_forms`, `englishForms` or `w.english`. Prose in comments and
// language names ("English", in data and translations) are not identifiers and pass.
// No dependencies. Usage: node scripts/check-base-neutral.mjs [files...]
//
// Allowed, because they only read data written before the word model v2 (slice 07):
//   - whole paths in ALLOWED_PATHS below;
//   - a fallback read of the old field, `x.gloss ?? x.english` (or `||`);
//   - a line containing the marker base-neutral-ok, or the line after a comment line that
//     contains it (for formatters that move trailing comments, like mix format);
//   - lines between base-neutral-ok-start and base-neutral-ok-end markers.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOTS = ["extension/", "server/lib/", "spec/"];
const CODE = /\.(js|mjs|cjs|ex|exs|json|html)$/;
const MARKER = "base-neutral-ok";

// Paths ending in "/" are folders.
const ALLOWED_PATHS = [
  // 07's one-time migration from the v1 table, which had english and english_forms columns.
  "server/lib/kotiko/migrations/word_model_v2.ex",
  // English language data (50 §5).
  "spec/lang/en/",
  "extension/spec/lang/en/",
  // Fixtures that reproduce replies in the old shape, for 09's legacy-key repair.
  "spec/fixtures/",
  "spec/eval/",
  // Today's matcher falls back to the old field; slice 14 replaces the file.
  "extension/lib/matcher.js",
];

// Identifiers: lowercase "english" starting a word (english, english_forms, .english,
// "english"), or English inside a camelCase name (englishForms is caught above, so this
// is glossOrEnglish, toEnglish, …).
const IDENTIFIER = /\benglish|[a-z0-9_$]English/;
// A fallback read: `?? x.english`, `|| row.english`, `?? rec(x)?.english`.
const FALLBACK = /(\?\?|\|\|)\s*[\w$.?()[\]]*\.english\b/g;
const COMMENT_LINE = /^\s*(#|\/\/|\/\*|\*|<!--)/;

const allowedPath = (f) => ALLOWED_PATHS.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p));

// The code part of a line: a trailing // or # comment removed when it starts outside a
// string (a rough check: an even number of quotes before it).
function codeOf(line) {
  for (const m of line.matchAll(/\s(\/\/|#)\s/g)) {
    const before = line.slice(0, m.index);
    const quotes = (before.match(/"/g) ?? []).length + (before.match(/'/g) ?? []).length + (before.match(/`/g) ?? []).length;
    if (quotes % 2 === 0) return before;
  }
  return line;
}

export function findInText(text) {
  const found = [];
  const lines = text.split("\n");
  let open = false;
  lines.forEach((line, i) => {
    if (line.includes(`${MARKER}-start`)) open = true;
    if (line.includes(`${MARKER}-end`)) {
      open = false;
      return;
    }
    if (open || line.includes(MARKER)) return;
    const prev = lines[i - 1] ?? "";
    if (COMMENT_LINE.test(prev) && prev.includes(MARKER) && !prev.includes(`${MARKER}-end`)) return;
    if (COMMENT_LINE.test(line)) return;
    const code = codeOf(line).replace(FALLBACK, "");
    if (IDENTIFIER.test(code)) found.push({ line: i + 1, text: line.trim() });
  });
  return found;
}

function main(args) {
  const files = args.length
    ? args
    : execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", ...ROOTS], { encoding: "utf8" }).split("\n").filter(Boolean);
  const found = [];
  for (const file of files) {
    if (!CODE.test(file) || allowedPath(file)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // deleted in the working tree
    }
    for (const f of findInText(text)) found.push(`${file}:${f.line}: ${f.text.slice(0, 160)}`);
  }
  if (found.length) {
    console.error(`English-named base concepts (slice 50 §7 rule 1). Use gloss, forms, base or base_lang; mark a read of old data with ${MARKER}:\n`);
    for (const f of found) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`No English-named base concepts in ${files.length} files.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
