// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Fails when a file that must never be committed is in the tree, or is added by the commits
// of a pull request: .env files, databases, the API token, private keys and certificates, or
// any file over 10 MB. GitHub allows push rulesets only on private repositories, so on this
// public one this check (a required CI job) does that job; .gitignore covers the same names.
//
//   node scripts/check-forbidden-files.mjs                  # the files in HEAD
//   node scripts/check-forbidden-files.mjs <base> <head>    # also every file the range adds
//
// No dependencies, so CI can run it before `npm ci`.
import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_BYTES = 10 * 1024 * 1024;

export function forbidden(path) {
  const name = basename(path);
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return ".env file";
  if (/\.(db|db-wal|db-shm|sqlite|sqlite3)$/.test(name)) return "database";
  if (name === "api-token") return "API token";
  if (/^id_(rsa|ed25519|ecdsa)/.test(name)) return "SSH private key";
  if (/\.(pem|p12|pfx|key)$/.test(name)) return "key or certificate";
  return null;
}

const git = (dir, args, input) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", input, maxBuffer: 1 << 28 });

// Every blob in HEAD, plus every blob the commits base..head introduce, with its size.
export function blobs({ dir = ".", base, head } = {}) {
  const out = [];
  for (const line of git(dir, ["ls-tree", "-r", "-l", "HEAD"]).split("\n").filter(Boolean)) {
    const [meta, path] = line.split("\t");
    const [, type, , size] = meta.split(/\s+/);
    if (type === "blob") out.push({ path, size: Number(size) });
  }
  if (base && head) {
    const objects = git(dir, ["rev-list", "--objects", `${base}..${head}`]);
    const sizes = git(dir, ["cat-file", "--batch-check=%(objecttype) %(objectsize) %(rest)"], objects);
    for (const line of sizes.split("\n").filter(Boolean)) {
      const [type, size, ...rest] = line.split(" ");
      if (type === "blob" && rest.length) out.push({ path: rest.join(" "), size: Number(size) });
    }
  }
  return out;
}

export function problems(list) {
  const seen = new Set();
  const out = [];
  for (const { path, size } of list) {
    const why = forbidden(path) ?? (size > MAX_BYTES ? `over 10 MB (${(size / 1048576).toFixed(1)} MB)` : null);
    if (why && !seen.has(`${path}:${why}`)) {
      seen.add(`${path}:${why}`);
      out.push(`${path}: ${why}`);
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, head] = process.argv.slice(2);
  const found = problems(blobs({ base, head }));
  if (found.length) {
    console.error("These files must not be committed:\n");
    for (const p of found) console.error(`  ${p}`);
    console.error(
      "\nRemove them from the branch's history (not only the latest commit), for example with" +
        "\n`git rebase -i`, and rotate anything secret that was pushed. See CONTRIBUTING.md.",
    );
    process.exit(1);
  }
  console.log("No secret, database or oversized file in the tree" + (base ? " or the new commits." : "."));
}
