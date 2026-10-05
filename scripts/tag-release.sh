#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0
#
# Signs and pushes a release tag (slice 30 §11). Run by the release manager after merging
# release-please's release PR:
#
#   git switch main && git pull
#   scripts/tag-release.sh            # v0.3.0, from the merged release commit
#   scripts/tag-release.sh --rc 1     # v0.3.0-rc.1, a release candidate (no store upload)
#   scripts/tag-release.sh --dry-run  # every check, no tag
#
# Checks first: a clean tree; HEAD is origin/main (a candidate may instead be the head of
# release-please's branch, whose version is already bumped); for a release, HEAD is the
# commit that changed .release-please-manifest.json; the three version files agree;
# CHANGELOG.md is ready (scripts/release-notes.mjs --check). Then `git tag -s` with your own
# SSH or GPG signing key (git config user.signingkey, gpg.format), checks the signature
# against .github/allowed_signers exactly as the workflow will, and pushes the tag. The push
# starts the release workflow.

set -euo pipefail

die() {
  echo "tag-release: $*" >&2
  exit 1
}

rc=""
dry_run=false
remote="origin"
while [ $# -gt 0 ]; do
  case "$1" in
    --rc) rc="$2"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --remote) remote="$2"; shift 2 ;;
    *) die "unknown option $1 (use --rc N, --dry-run, --remote NAME)" ;;
  esac
done
[ -z "$rc" ] || [[ "$rc" =~ ^[1-9][0-9]*$ ]] || die "--rc takes a number: --rc 1"

top="$(git rev-parse --show-toplevel)"
cd "$top"

[ -z "$(git status --porcelain)" ] || die "the working tree has changes; commit or stash them first"

rc_branch="release-please--branches--main"
git fetch --quiet "$remote" main
git fetch --quiet "$remote" "+refs/heads/$rc_branch:refs/remotes/$remote/$rc_branch" 2>/dev/null || true
git fetch --quiet --tags "$remote"

head="$(git rev-parse HEAD)"
main="$(git rev-parse "$remote/main")"
if [ -z "$rc" ]; then
  [ "$head" = "$main" ] || die "HEAD isn't $remote/main; run: git switch main && git pull"
  # The merged release PR changed the version; any other commit isn't a release commit.
  if git diff --quiet "HEAD^1" HEAD -- .release-please-manifest.json; then
    die "HEAD didn't change .release-please-manifest.json, so it isn't release-please's release commit"
  fi
else
  rc_head="$(git rev-parse --verify --quiet "$remote/$rc_branch" || true)"
  [ "$head" = "$main" ] || [ "$head" = "$rc_head" ] ||
    die "a release candidate is tagged on $remote/main or on $remote/$rc_branch (git switch --detach $remote/$rc_branch)"
fi

node scripts/check-versions.mjs >/dev/null || die "the version files disagree (node scripts/check-versions.mjs)"
version="$(node -p 'require("./.release-please-manifest.json")["."]')"
[ -z "$rc" ] || version="$version-rc.$rc"
tag="v$version"

node scripts/release-notes.mjs --version "$version" --check || die "CHANGELOG.md isn't ready for $tag"

if git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null; then
  die "$tag already exists"
fi

if [ "$dry_run" = true ]; then
  echo "tag-release: ready to tag $tag at $head (dry run, nothing tagged)"
  exit 0
fi

[ -n "$(git config user.signingkey || true)" ] ||
  die "no signing key: set git config user.signingkey (and gpg.format ssh for an SSH key); see docs/stores.md"

git tag -s "$tag" -m "Kotiko $version"
if ! bash scripts/verify-tag.sh "$tag" --main "$remote/main" --rc-branch "$remote/$rc_branch"; then
  git tag -d "$tag" >/dev/null
  die "the new tag didn't verify (is your key in .github/allowed_signers?); it was deleted, nothing was pushed"
fi
git push "$remote" "refs/tags/$tag"
echo "tag-release: pushed $tag; the release workflow takes it from here"
