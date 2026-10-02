// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Adds the SPDX header to tracked source files that lack one. Idempotent.
// Usage: node scripts/add-spdx.mjs [--check]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// REUSE-IgnoreStart
const COPY = "SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors";
const LIC = "SPDX-License-Identifier: Apache-2.0";
// REUSE-IgnoreEnd
const styles = {
  hash: (l) => `# ${l}`,
  slash: (l) => `// ${l}`,
  css: (l) => `/* ${l} */`,
  html: (l) => `<!-- ${l} -->`,
};
const styleFor = (f) =>
  /\.(ex|exs|sh)$/.test(f) || /(^|\/)Dockerfile$/.test(f) ? "hash"
  : /\.(js|mjs|cjs)$/.test(f) ? "slash"
  : /\.css$/.test(f) ? "css"
  : /\.html$/.test(f) ? "html"
  : null;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && styleFor(f) && !f.startsWith("test/fixtures/") && !f.endsWith(".formatter.exs") && !f.startsWith("node_modules/"));

const check = process.argv.includes("--check");
const missing = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (src.includes("SPDX-License-Identifier")) continue;
  missing.push(f);
  if (check) continue;
  const c = styles[styleFor(f)];
  const header = `${c(COPY)}\n${c(LIC)}\n`;
  let out;
  if (src.startsWith("#!")) {
    const nl = src.indexOf("\n") + 1;
    out = src.slice(0, nl) + header + src.slice(nl);
  } else if (/^<!doctype/i.test(src)) {
    const nl = src.indexOf("\n") + 1;
    out = src.slice(0, nl) + header + src.slice(nl);
  } else {
    out = header + "\n" + src;
  }
  writeFileSync(f, out);
}
console.log(`${check ? "missing" : "added"}: ${missing.length}`);
for (const f of missing) console.log("  " + f);
if (check && missing.length) process.exit(1);
