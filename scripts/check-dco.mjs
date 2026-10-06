// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Developer Certificate of Origin (https://developercertificate.org/): every commit a pull
// request adds must carry "Signed-off-by: Name <email>" for its author (`git commit -s`).
// Bots (Dependabot, release-please) and merge commits are exempt. CONTRIBUTING.md explains it.
//
//   node scripts/check-dco.mjs <base-sha> <head-sha>
//
// No dependencies, so CI can run it before `npm ci`.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIELD = "\x1f";
const RECORD = "\x1e";
const FORMAT = ["%H", "%P", "%an", "%ae", "%s", "%(trailers:key=Signed-off-by,valueonly,separator=%x1d)"]
  .join("%x1f") + "%x1e";

export function commits({ base, head, dir = "." }) {
  const out = execFileSync("git", ["-C", dir, "log", `--format=${FORMAT}`, `${base}..${head}`], { encoding: "utf8" });
  return out
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ""))
    .filter(Boolean)
    .map((r) => {
      const [sha, parents, name, email, subject, trailers] = r.split(FIELD);
      return {
        sha,
        merge: parents.trim().split(" ").length > 1,
        name,
        email,
        subject,
        signoffs: trailers.split("\x1d").map((s) => s.trim()).filter(Boolean),
      };
    });
}

export const isBot = (c) => /\[bot\]$/.test(c.name) || /\[bot\]@users\.noreply\.github\.com$/i.test(c.email);

const emailOf = (signoff) => signoff.match(/<([^>]+)>\s*$/)?.[1]?.toLowerCase();

export function unsigned(list) {
  return list.filter(
    (c) => !c.merge && !isBot(c) && !c.signoffs.some((s) => emailOf(s) === c.email.toLowerCase()),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error("Usage: node scripts/check-dco.mjs <base-sha> <head-sha>");
    process.exit(2);
  }
  const list = commits({ base, head });
  const bad = unsigned(list);
  if (bad.length) {
    console.error(`${bad.length} of ${list.length} commits have no Signed-off-by for their author:\n`);
    for (const c of bad) console.error(`  ${c.sha.slice(0, 7)} ${c.subject} (${c.name} <${c.email}>)`);
    console.error(
      "\nSigning off says you can contribute this under the project's license (the Developer" +
        "\nCertificate of Origin, https://developercertificate.org/). To add it to every commit" +
        `\nof this branch:\n\n  git rebase --signoff ${base.slice(0, 12)}\n  git push --force-with-lease\n` +
        "\nand use `git commit -s` from now on. See CONTRIBUTING.md, \"Licensing and sign-off\".",
    );
    process.exit(1);
  }
  console.log(`All ${list.length} commits are signed off (bots and merge commits exempt).`);
}
