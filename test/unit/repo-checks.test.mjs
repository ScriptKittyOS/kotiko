// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// scripts/check-dco.mjs and scripts/check-forbidden-files.mjs over histories built here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commits, unsigned } from "../../scripts/check-dco.mjs";
import { MAX_BYTES, blobs, forbidden, problems } from "../../scripts/check-forbidden-files.mjs";

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "kotiko-repo-checks-"));
  const git = (...args) =>
    execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Ana Contributor");
  git("config", "user.email", "ana@example.invalid");
  git("config", "commit.gpgsign", "false");
  const commit = (file, message, { author, signoff = false } = {}) => {
    writeFileSync(join(dir, file), `${file}\n`);
    git("add", file);
    const args = ["commit", "-q", "-m", message];
    if (signoff) args.push("-s");
    if (author) args.push(`--author=${author}`);
    git(...args);
    return git("rev-parse", "HEAD");
  };
  return { dir, git, commit, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("DCO: signed-off commits pass, unsigned ones are named", () => {
  const r = repo();
  try {
    const base = r.commit("a.txt", "chore: start");
    r.commit("b.txt", "feat: signed", { signoff: true });
    r.commit("c.txt", "fix: not signed");
    const list = commits({ base, head: "HEAD", dir: r.dir });
    assert.equal(list.length, 2);
    assert.deepEqual(unsigned(list).map((c) => c.subject), ["fix: not signed"]);
  } finally {
    r.done();
  }
});

test("DCO: the sign-off must be the author's own", () => {
  const r = repo();
  try {
    const base = r.commit("a.txt", "chore: start");
    r.commit("b.txt", "feat: someone else's work\n\nSigned-off-by: Ana Contributor <ana@example.invalid>", {
      author: "Bo Other <bo@example.invalid>",
    });
    assert.equal(unsigned(commits({ base, head: "HEAD", dir: r.dir })).length, 1);
  } finally {
    r.done();
  }
});

test("DCO: bots and merge commits are exempt", () => {
  const r = repo();
  try {
    const base = r.commit("a.txt", "chore: start");
    r.commit("b.txt", "chore(deps): bump", { author: "dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>" });
    r.git("checkout", "-q", "-b", "side", base);
    r.commit("c.txt", "feat: side", { signoff: true });
    r.git("checkout", "-q", "main");
    r.git("merge", "-q", "--no-ff", "-m", "Merge side", "side");
    const list = commits({ base, head: "HEAD", dir: r.dir });
    assert.equal(list.length, 3);
    assert.deepEqual(unsigned(list), []);
  } finally {
    r.done();
  }
});

test("forbidden names match the .gitignore list, and .env.example is allowed", () => {
  for (const p of [".env", "server/.env", "server/.env.production", "data/kotiko.db", "kotiko.db-wal", "x.sqlite3",
    "server/data/api-token", "id_ed25519", "keys/id_rsa.pub", "cert.pem", "a.p12", "b.pfx", "tls.key"]) {
    assert.ok(forbidden(p), p);
  }
  for (const p of ["server/.env.example", "docs/env.md", "spec/keys.json", "extension/lib/db.js", "monkey.txt"]) {
    assert.equal(forbidden(p), null, p);
  }
});

test("a forbidden file added and removed inside the range is still caught", () => {
  const r = repo();
  try {
    const base = r.commit("a.txt", "chore: start");
    r.commit("kotiko.db", "oops");
    r.git("rm", "-q", "kotiko.db");
    r.git("commit", "-q", "-m", "remove it");
    assert.deepEqual(problems(blobs({ dir: r.dir })), []);
    assert.deepEqual(problems(blobs({ dir: r.dir, base, head: "HEAD" })), ["kotiko.db: database"]);
  } finally {
    r.done();
  }
});

test("files over 10 MB are refused", () => {
  assert.deepEqual(problems([{ path: "big.bin", size: MAX_BYTES + 1 }, { path: "ok.bin", size: MAX_BYTES }]), [
    "big.bin: over 10 MB (10.0 MB)",
  ]);
});
