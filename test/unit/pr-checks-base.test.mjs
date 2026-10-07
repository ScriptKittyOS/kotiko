// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Security review C-01: the required `secrets` and `osv-scanner` checks read their allowlists
// (.gitleaks.toml, .gitleaksignore, osv-scanner.toml) and their check scripts from the pull
// request's own tree, so a pull request could add a secret and allow it in the same change.
// On a pull request they now come from the base commit (scripts/base-file.sh, the base's own
// copy). These tests run the helper in a throwaway repository where a pull request adds a
// token and edits every allowlist and check script to let it through, and check that the
// workflows use the base's copies. With CI's gitleaks version installed (GITLEAKS=/path/to/gitleaks,
// or on PATH) they also scan that pull request both ways.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const TRUSTED = [".gitleaks.toml", ".gitleaksignore", "scripts/check-forbidden-files.mjs", "scripts/check-dco.mjs"];

let base;
let env;
before(() => {
  base = mkdtempSync(join(tmpdir(), "kotiko-pr-checks-"));
  env = {
    PATH: process.env.PATH,
    HOME: base,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
    LC_ALL: "C",
  };
});
after(() => rmSync(base, { recursive: true, force: true }));

const run = (cwd, cmd, args) => spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();

// A fake GitHub token, made at run time so that this file holds no secret-shaped text.
const fakeToken = () => "ghp_" + randomBytes(64).toString("base64").replace(/[^A-Za-z1-9]/g, "").slice(0, 36);

// main with the real settings and scripts, then a pull request that adds a token and edits
// .gitleaks.toml, .gitleaksignore and both check scripts to let it through.
let n = 0;
function repo() {
  const dir = join(base, `case${++n}`);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  for (const f of [...TRUSTED, "scripts/base-file.sh"]) copyFileSync(join(ROOT, f), join(dir, f));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "chore: start");
  const baseSha = git(dir, "rev-parse", "HEAD");
  git(dir, "switch", "-q", "-c", "pr");
  writeFileSync(join(dir, "leak.js"), `const t = "${fakeToken()}";\n`);
  writeFileSync(join(dir, ".gitleaks.toml"), readFileSync(join(dir, ".gitleaks.toml"), "utf8") + "paths = ['''leak\\.js''']\n");
  writeFileSync(join(dir, ".gitleaksignore"), "# tidy\n");
  for (const s of ["scripts/check-forbidden-files.mjs", "scripts/check-dco.mjs"]) writeFileSync(join(dir, s), "process.exit(0);\n");
  writeFileSync(join(dir, "scripts/base-file.sh"), "#!/usr/bin/env bash\nexit 0\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "tidy gitleaks config");
  return { dir, baseSha };
}

test("base-file copies the base commit's settings and scripts, not the pull request's edits", () => {
  const { dir, baseSha } = repo();
  const out = join(dir, "..", `trusted${n}`);
  const r = run(dir, "bash", [join(ROOT, "scripts/base-file.sh"), baseSha, out, ...TRUSTED]);
  assert.equal(r.status, 0, r.stderr);
  for (const f of TRUSTED) {
    assert.equal(readFileSync(join(out, f), "utf8"), readFileSync(join(ROOT, f), "utf8"), `${f} is the base's copy`);
    assert.notEqual(readFileSync(join(out, f), "utf8"), readFileSync(join(dir, f), "utf8"), `${f} isn't the pull request's`);
  }
});

test("base-file refuses a missing file, a path outside the repository and an unknown commit", () => {
  const { dir, baseSha } = repo();
  const out = join(dir, "..", `refused${n}`);
  const script = join(ROOT, "scripts/base-file.sh");
  assert.match(run(dir, "bash", [script, baseSha, out, "leak.js"]).stderr, /has no file leak\.js/);
  assert.match(run(dir, "bash", [script, baseSha, out, "../x"]).stderr, /isn't a plain path/);
  assert.match(run(dir, "bash", [script, baseSha, out, "/etc/passwd"]).stderr, /isn't a plain path/);
  assert.match(run(dir, "bash", [script, baseSha, out, "scripts/../.gitleaks.toml"]).stderr, /isn't a plain path/);
  assert.match(run(dir, "bash", [script, "0".repeat(40), out, ".gitleaks.toml"]).stderr, /isn't a commit/);
  assert.notEqual(run(dir, "bash", [script, baseSha, out]).status, 0, "usage");
});

// The gitleaks version CI pins; another build may read its settings differently.
const PINNED = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8").match(/GITLEAKS_VERSION: "([^"]+)"/)[1];
const gitleaks = [process.env.GITLEAKS, "gitleaks"].find((bin) => bin && spawnSync(bin, ["version"], { encoding: "utf8" }).stdout?.trim() === PINNED);
// GITLEAKS set (as in CI's secrets job) means the scan must run; otherwise it is optional.
test("a pull request that allows its own token in .gitleaks.toml and .gitleaksignore still fails the scan", { skip: !gitleaks && !process.env.GITLEAKS && `gitleaks ${PINNED} not installed (set GITLEAKS)` }, () => {
  assert.ok(gitleaks, `GITLEAKS=${process.env.GITLEAKS} isn't gitleaks ${PINNED}`);
  const { dir, baseSha } = repo();
  const scan = (...args) => run(dir, gitleaks, ["git", "--log-opts=HEAD", "--redact", "--exit-code", "1", ...args, "."]);
  // What CI ran before: the pull request's own settings let its token through.
  assert.equal(scan("--config", ".gitleaks.toml").status, 0, "the bypass the review found");
  // What CI runs now (ci.yml, job secrets): the base's settings, the tree's copies removed
  // (gitleaks always reads the scanned folder's .gitleaksignore too), inline allows ignored.
  const out = join(dir, "..", `scan${n}`);
  assert.equal(run(dir, "bash", [join(ROOT, "scripts/base-file.sh"), baseSha, out, ...TRUSTED]).status, 0);
  rmSync(join(dir, ".gitleaks.toml"));
  rmSync(join(dir, ".gitleaksignore"));
  const r = scan("--config", join(out, ".gitleaks.toml"), "--gitleaks-ignore-path", join(out, ".gitleaksignore"), "--ignore-gitleaks-allow");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /leaks found: 1/);
});

test("on a pull request, CI's required checks use the base commit's settings and scripts", () => {
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const secrets = ci.slice(ci.indexOf("\n  secrets:"), ci.indexOf("\n  server:"));
  assert.match(secrets, /git show "\$ref:scripts\/base-file\.sh"/, "the base's own copy of the helper");
  for (const f of TRUSTED) assert.ok(secrets.includes(` ${f}`), `${f} comes from the base`);
  assert.match(secrets, /rm -f \.gitleaks\.toml \.gitleaksignore/);
  assert.match(secrets, /--config "\$RUNNER_TEMP\/trusted\/\.gitleaks\.toml" --gitleaks-ignore-path "\$RUNNER_TEMP\/trusted\/\.gitleaksignore" --ignore-gitleaks-allow/);
  assert.match(secrets, /node "\$RUNNER_TEMP\/trusted\/scripts\/check-forbidden-files\.mjs"/);
  assert.match(secrets, /node "\$RUNNER_TEMP\/trusted\/scripts\/check-dco\.mjs"/);
  assert.doesNotMatch(secrets, /node scripts\/check-/, "no check script from the pull request's tree");

  const osv = readFileSync(join(ROOT, ".github/workflows/dependency-scan.yml"), "utf8");
  assert.match(osv, /git show "\$ref:scripts\/base-file\.sh"/);
  assert.match(osv, / osv-scanner\.toml\n/);
  assert.match(osv, /scan source --config "\$RUNNER_TEMP\/trusted\/osv-scanner\.toml"/);
  assert.doesNotMatch(osv, /--config osv-scanner\.toml/);
});
