// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 30 §11: signed release tags. scripts/tag-release.sh checks the release commit and
// signs; scripts/verify-tag.sh (the release workflow's first job) refuses unsigned tags,
// tags signed by keys not in .github/allowed_signers, tags off main and version mismatches.
// Each test runs in throwaway repositories with throwaway keys, isolated from the user's git
// and GPG configuration.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPTS = ["tag-release.sh", "verify-tag.sh", "release-notes.mjs", "check-versions.mjs"];

let base;
let env;
before(() => {
  base = mkdtempSync(join(tmpdir(), "kotiko-tags-"));
  mkdirSync(join(base, "gnupg"), { mode: 0o700 });
  env = {
    PATH: process.env.PATH,
    HOME: base,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
    GNUPGHOME: join(base, "gnupg"),
    LC_ALL: "C",
  };
  for (const k of ["release", "stranger"]) {
    execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", k, "-f", join(base, k)], { env });
  }
});
after(() => {
  spawnSync("gpgconf", ["--kill", "gpg-agent"], { env });
  rmSync(base, { recursive: true, force: true });
});

const run = (cwd, cmd, args) => spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
function ok(cwd, cmd, args) {
  const r = run(cwd, cmd, args);
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const git = (cwd, ...args) => ok(cwd, "git", args).trim();

function writeVersion(dir, version, changelogExtra = "") {
  writeFileSync(join(dir, ".release-please-manifest.json"), JSON.stringify({ ".": version }) + "\n");
  writeFileSync(join(dir, "extension/manifest.json"), JSON.stringify({ manifest_version: 3, version }) + "\n");
  writeFileSync(join(dir, "server/mix.exs"), `defmodule K do\n  def project do\n    [\n      # x-release-please-start-version\n      version: "${version}",\n      # x-release-please-end\n    ]\n  end\nend\n`);
  writeFileSync(join(dir, "CHANGELOG.md"), `# Changelog\n\n## Unreleased\n${changelogExtra}\n## [${version}](https://example.com) (2026-11-02)\n\n- Notes for ${version}.\n\n## 0.1.0\n\n- First.\n`);
}

// origin (bare) and a clone with a released 0.3.0 on main, signing with the "release" key.
let n = 0;
function setup({ signers = ["release"] } = {}) {
  const dir = join(base, `case${++n}`);
  const origin = join(dir, "origin.git");
  const work = join(dir, "work");
  mkdirSync(dir);
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  git(dir, "clone", "-q", origin, work);
  git(work, "switch", "-q", "-c", "main");
  for (const d of ["scripts", "extension", "server", ".github"]) mkdirSync(join(work, d), { recursive: true });
  for (const s of SCRIPTS) copyFileSync(join(ROOT, "scripts", s), join(work, "scripts", s));
  const allowed = signers.map((k) => `${k}@example.com namespaces="git" ${readFileSync(join(base, `${k}.pub`), "utf8").trim()}`);
  writeFileSync(join(work, ".github/allowed_signers"), `# test\n${allowed.join("\n")}\n`);
  writeVersion(work, "0.2.0");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "chore: start");
  writeVersion(work, "0.3.0");
  git(work, "commit", "-q", "-am", "chore(main): release 0.3.0");
  git(work, "push", "-q", "origin", "main");
  git(work, "config", "gpg.format", "ssh");
  git(work, "config", "user.signingkey", join(base, "release"));
  return { dir, origin, work };
}

function tagWith(work, name, key, { at = "HEAD", lightweight = false, unsigned = false } = {}) {
  if (lightweight) return git(work, "tag", name, at);
  if (unsigned) return git(work, "tag", "-a", name, "-m", name, at);
  return git(work, "-c", "gpg.format=ssh", "-c", `user.signingkey=${join(base, key)}`, "tag", "-s", name, "-m", name, at);
}

const verify = (work, tag, ...extra) => run(work, "bash", ["scripts/verify-tag.sh", tag, ...extra]);

test("a release tag signed by an allowed key, on main, with matching versions, verifies", () => {
  const { work } = setup();
  tagWith(work, "v0.3.0", "release");
  const r = verify(work, "v0.3.0");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Good "git" signature for release@example\.com/);
  assert.match(r.stdout, /^version=0\.3\.0$/m);
  assert.match(r.stdout, /^prerelease=false$/m);
});

test("unsigned, lightweight and stranger-signed tags stop before any build", () => {
  const { work } = setup();
  tagWith(work, "v0.3.0", null, { unsigned: true });
  let r = verify(work, "v0.3.0");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /isn't signed/);
  git(work, "tag", "-d", "v0.3.0");

  tagWith(work, "v0.3.0", null, { lightweight: true });
  r = verify(work, "v0.3.0");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /lightweight/);
  git(work, "tag", "-d", "v0.3.0");

  tagWith(work, "v0.3.0", "stranger");
  r = verify(work, "v0.3.0");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not in the allowed signers/);

  r = verify(work, "v0.3.0", "--signers", join(work, "missing"));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no allowed signers/);
});

test("an empty allowed signers file (comments only) refuses every tag", () => {
  const { work } = setup({ signers: [] });
  tagWith(work, "v0.3.0", "release");
  const r = verify(work, "v0.3.0");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no allowed signers/);
});

test("tags with the wrong name, the wrong version or off main are refused", () => {
  const { work } = setup();
  tagWith(work, "release-0.3.0", "release");
  assert.match(verify(work, "release-0.3.0").stderr, /isn't a release tag/);
  tagWith(work, "v0.4.0", "release");
  assert.match(verify(work, "v0.4.0").stderr, /says 0\.3\.0 .* but the tag is v0\.4\.0/);

  git(work, "switch", "-q", "-c", "side");
  writeFileSync(join(work, "side.txt"), "x\n");
  git(work, "add", "side.txt");
  git(work, "commit", "-q", "-m", "side");
  tagWith(work, "v0.3.0", "release");
  assert.match(verify(work, "v0.3.0").stderr, /isn't on origin\/main/);
  tagWith(work, "v0.3.0-rc.1", "release");
  assert.match(verify(work, "v0.3.0-rc.1").stderr, /on neither origin\/main nor/);
});

test("tag-release checks, signs, verifies and pushes; a fresh clone verifies the pushed tag", () => {
  const { dir, origin, work } = setup();
  let r = run(work, "bash", ["scripts/tag-release.sh", "--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ready to tag v0\.3\.0/);
  assert.equal(run(origin, "git", ["rev-parse", "--verify", "--quiet", "refs/tags/v0.3.0"]).status, 1, "dry run tags nothing");

  r = run(work, "bash", ["scripts/tag-release.sh"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /pushed v0\.3\.0/);

  const fresh = join(dir, "fresh");
  git(dir, "clone", "-q", origin, fresh);
  const v = verify(fresh, "v0.3.0");
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, /^version=0\.3\.0$/m);

  r = run(work, "bash", ["scripts/tag-release.sh", "--dry-run"]);
  assert.match(r.stderr, /v0\.3\.0 already exists/);
});

test("tag-release refuses a commit that isn't the release, a dirty tree, leftovers under Unreleased, and a key not on the list", () => {
  let { work } = setup();
  writeFileSync(join(work, "x.txt"), "x\n");
  assert.match(run(work, "bash", ["scripts/tag-release.sh", "--dry-run"]).stderr, /working tree has changes/);
  git(work, "add", "x.txt");
  git(work, "commit", "-q", "-m", "fix: after the release");
  git(work, "push", "-q", "origin", "main");
  assert.match(run(work, "bash", ["scripts/tag-release.sh", "--dry-run"]).stderr, /isn't release-please's release commit/);

  ({ work } = setup());
  git(work, "reset", "-q", "--hard", "HEAD^");
  writeVersion(work, "0.3.0", "\n- Not moved yet.\n");
  git(work, "commit", "-q", "-am", "chore(main): release 0.3.0");
  git(work, "push", "-q", "-f", "origin", "main");
  assert.match(run(work, "bash", ["scripts/tag-release.sh", "--dry-run"]).stderr, /entries under "## Unreleased"/);

  ({ work } = setup());
  git(work, "switch", "-q", "--detach", "HEAD^");
  assert.match(run(work, "bash", ["scripts/tag-release.sh", "--dry-run"]).stderr, /HEAD isn't origin\/main/);

  ({ work } = setup());
  git(work, "config", "user.signingkey", join(base, "stranger"));
  const r = run(work, "bash", ["scripts/tag-release.sh"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /didn't verify/);
  assert.equal(run(work, "git", ["rev-parse", "--verify", "--quiet", "refs/tags/v0.3.0"]).status, 1, "the bad tag is deleted");
});

test("--ssh-key signs the tag with that key, whatever git signs commits with", () => {
  const { work } = setup();
  git(work, "config", "--unset", "user.signingkey");
  git(work, "config", "gpg.format", "openpgp");
  assert.match(run(work, "bash", ["scripts/tag-release.sh"]).stderr, /no signing key: pass --ssh-key FILE/);
  assert.match(run(work, "bash", ["scripts/tag-release.sh", "--ssh-key", join(base, "missing.pub")]).stderr, /isn't a file/);
  const r = run(work, "bash", ["scripts/tag-release.sh", "--ssh-key", join(base, "release.pub")]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /pushed v0\.3\.0/);
  assert.equal(git(work, "config", "gpg.format"), "openpgp", "the repository's own signing settings are untouched");
});

test("a release candidate is tagged on release-please's branch and verifies as a pre-release", () => {
  const { work } = setup();
  git(work, "switch", "-q", "-c", "release-please--branches--main");
  writeVersion(work, "0.4.0");
  git(work, "commit", "-q", "-am", "chore(main): release 0.4.0");
  git(work, "push", "-q", "origin", "release-please--branches--main");
  git(work, "switch", "-q", "--detach", "origin/release-please--branches--main");
  const r = run(work, "bash", ["scripts/tag-release.sh", "--rc", "1"]);
  assert.equal(r.status, 0, r.stderr);
  const v = verify(work, "v0.4.0-rc.1");
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, /^version=0\.4\.0-rc\.1$/m);
  assert.match(v.stdout, /^prerelease=true$/m);
  assert.match(run(work, "bash", ["scripts/tag-release.sh", "--rc", "x"]).stderr, /--rc takes a number/);
});

const hasGpg = spawnSync("gpg", ["--version"]).status === 0;
test("GPG-signed tags verify only against the keys in the release keys file", { skip: !hasGpg && "gpg not installed" }, () => {
  const { work } = setup();
  const gen = (uid) => {
    ok(work, "gpg", ["--batch", "--passphrase", "", "--quick-gen-key", uid, "ed25519", "sign", "never"]);
    return ok(work, "gpg", ["--batch", "--with-colons", "--list-keys", uid]).split("\n").find((l) => l.startsWith("fpr:")).split(":")[9];
  };
  const good = gen("Release <gpg-release@example.com>");
  const other = gen("Other <gpg-other@example.com>");
  writeFileSync(join(work, "keys.asc"), ok(work, "gpg", ["--batch", "--armor", "--export", good]));
  writeFileSync(join(work, "other.asc"), ok(work, "gpg", ["--batch", "--armor", "--export", other]));
  git(work, "-c", "gpg.format=openpgp", "-c", `user.signingkey=${good}`, "tag", "-s", "v0.3.0", "-m", "v0.3.0");
  const r = verify(work, "v0.3.0", "--keys", join(work, "keys.asc"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /GOODSIG/);
  assert.match(verify(work, "v0.3.0", "--keys", join(work, "other.asc")).stderr, /not in .*other\.asc/);
  assert.match(verify(work, "v0.3.0", "--keys", join(work, "none.asc")).stderr, /no release keys/);
});
