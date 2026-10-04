// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// What background.js writes to storage.local.baseRules for content scripts (slice 50 §5),
// built from the same spec files, for page tests: each base's word-boundary rules and its
// capital conventions (slice 16). Stopwords are left out: page tests stub the detector.
import fs from "node:fs";
import path from "node:path";
import { ROOT, requireExt } from "./load-script.mjs";

const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "spec/lang/_generic", f), "utf8"));
const BOUNDARIES = read("boundaries.json");
const CASING = read("casing.json");
const Text = requireExt("lib/text.js");

export function baseRulesFor(bases) {
  return Object.fromEntries(
    bases.map((b) => [b, { boundaries: Text.rulesFor(BOUNDARIES, b), casing: { ...CASING.default, ...(CASING[b] ?? CASING[Text.primary(b)] ?? {}) }, stopwords: [] }]),
  );
}

// The bases a test's words imply when it names none: their base_lang, else English.
export function basesOf(words) {
  const bases = [...new Set((words ?? []).map((w) => w.base_lang ?? "en"))].slice(0, 4);
  return bases.length ? bases : ["en"];
}
