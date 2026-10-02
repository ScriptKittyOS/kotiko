#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Writes spec/fixtures/normalize-results.json: the full output of extension/lib/wordspec.js
// for every fixture in spec/fixtures/normalize/. Each fixture's own `expect` holds the
// parts a reader checks; this file holds everything, and the Elixir pipeline
// (server/test/kotiko/word_spec_test.exs) must produce exactly the same, so the two
// runtimes can't drift. After a deliberate change to the pipeline, run this and review
// the diff.
//
//   node spec/tools/fixture-results.mjs           rewrite the file
//   node spec/tools/fixture-results.mjs --check   exit 1 if it is stale
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const load = (rel) => {
  const module = { exports: {} };
  const file = path.join(ROOT, "extension", rel);
  vm.runInThisContext(`(function (module, exports) {${fs.readFileSync(file, "utf8")}\n})`, { filename: file })(
    module,
    module.exports,
  );
  return module.exports;
};

const spec = load("spec/spec.js");
const Lang = load("lib/lang.js").createLang(spec);
const WS = load("lib/wordspec.js").createWordSpec(spec, Lang);

const dir = path.join(ROOT, "spec/fixtures/normalize");
const results = {};
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const f = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  results[file] = f.input.items ? WS.processRespell(f.input.items, f.raw) : WS.process(f.input, f.raw);
}

const out = path.join(ROOT, "spec/fixtures/normalize-results.json");
const text =
  JSON.stringify(
    {
      description:
        "The full output of every spec/fixtures/normalize/ fixture, which both runtimes must produce exactly (each fixture's own `expect` holds the parts a reader checks). Regenerate with node spec/tools/fixture-results.mjs after a deliberate change, and review the diff.",
      results,
    },
    null,
    1,
  ) + "\n";

if (process.argv.includes("--check")) {
  if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== text) {
    console.error("spec/fixtures/normalize-results.json is stale. Run: node spec/tools/fixture-results.mjs");
    process.exit(1);
  }
  console.log(`spec/fixtures/normalize-results.json matches (${Object.keys(results).length} fixtures).`);
} else {
  fs.writeFileSync(out, text);
  console.log(`Wrote spec/fixtures/normalize-results.json (${Object.keys(results).length} fixtures).`);
}
