#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0
#
# Checks a release tag before anything is built from it (slice 30 §11):
#
#   scripts/verify-tag.sh v0.3.0 [--signers FILE] [--keys FILE] [--main REF] [--rc-branch REF]
#
# 1. The name is vX.Y.Z or vX.Y.Z-rc.N.
# 2. It is an annotated tag signed with an SSH key listed in the allowed signers file
#    (default .github/allowed_signers), or with a GPG key from the keys file (default
#    .github/release-keys.asc). Unsigned tags, lightweight tags and other keys fail.
#    The name inside the signed tag object is the tag's name: the signature covers the
#    object, not the ref, so a candidate's object pushed again as refs/tags/vX.Y.Z would
#    otherwise pass as a release (security review C-02).
# 3. Its commit is on main (--main, default origin/main). A release candidate may also sit on
#    release-please's release branch (--rc-branch), whose head carries the next version.
# 4. extension/manifest.json, server/mix.exs and .release-please-manifest.json at that commit
#    all say X.Y.Z.
#
# The release workflow passes the signers and keys files from main, not from the tagged
# commit, so a tag can't vouch for itself. Prints version=… and prerelease=… (also to
# $GITHUB_OUTPUT when set, with commit=…, which the build compares with the commit it checks
# out). Needs git 2.34+ and OpenSSH 8.2+ for SSH signatures.

set -euo pipefail

die() {
  echo "verify-tag: $*" >&2
  exit 1
}

tag="${1:-}"
[ -n "$tag" ] || die "usage: verify-tag.sh <tag> [--signers FILE] [--keys FILE] [--main REF] [--rc-branch REF]"
shift
top="$(git rev-parse --show-toplevel)"
signers="$top/.github/allowed_signers"
keys="$top/.github/release-keys.asc"
main_ref="origin/main"
rc_ref="origin/release-please--branches--main"
while [ $# -gt 0 ]; do
  case "$1" in
    --signers) signers="$2"; shift 2 ;;
    --keys) keys="$2"; shift 2 ;;
    --main) main_ref="$2"; shift 2 ;;
    --rc-branch) rc_ref="$2"; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done

# 1. The name.
if [[ ! "$tag" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)(-rc\.[0-9]+)?$ ]]; then
  die "$tag isn't a release tag (vX.Y.Z or vX.Y.Z-rc.N)"
fi
core="${BASH_REMATCH[1]}"
version="${tag#v}"
prerelease=false
[ -z "${BASH_REMATCH[2]}" ] || prerelease=true

# 2. The signature.
[ "$(git cat-file -t "refs/tags/$tag" 2>/dev/null || true)" = tag ] ||
  die "$tag is missing or lightweight; release tags are annotated and signed (git tag -s)"
object="$(git cat-file tag "refs/tags/$tag")"
if grep -q -- '-----BEGIN SSH SIGNATURE-----' <<<"$object"; then
  if [ ! -s "$signers" ] || ! grep -qv '^[[:space:]]*\(#\|$\)' "$signers"; then
    die "no allowed signers in $signers; add the release manager's key (docs/stores.md)"
  fi
  out="$(git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile="$signers" verify-tag "$tag" 2>&1)" ||
    die "$tag is signed by a key not in the allowed signers file: $out"
  grep -q 'Good "git" signature for ' <<<"$out" || die "unexpected verification output: $out"
  echo "$out"
elif grep -q -- '-----BEGIN PGP SIGNATURE-----' <<<"$object"; then
  [ -s "$keys" ] || die "$tag has a GPG signature but there are no release keys in $keys"
  gnupghome="$(mktemp -d)"
  trap 'rm -rf "$gnupghome"' EXIT
  GNUPGHOME="$gnupghome" gpg --batch --quiet --import "$keys" 2>/dev/null ||
    die "can't import $keys"
  # Only the listed keys are in this keyring, so a good signature means a listed key.
  out="$(GNUPGHOME="$gnupghome" git verify-tag --raw "$tag" 2>&1)" ||
    die "$tag is signed by a key not in $keys, or the signature is bad: $out"
  grep -q '^\[GNUPG:\] GOODSIG ' <<<"$out" || die "no good signature: $out"
  grep '^\[GNUPG:\] \(GOODSIG\|VALIDSIG\) ' <<<"$out"
else
  die "$tag isn't signed; release tags are signed with git tag -s"
fi
# The header ends at the first empty line; the message and signature follow it.
signed_name="$(sed -n '/^$/q; s/^tag //p' <<<"$object")"
[ "$signed_name" = "$tag" ] ||
  die "refs/tags/$tag holds a tag object signed as ${signed_name:-nothing}, not $tag; a release tag is signed under its own name"

# 3. Where the commit is.
commit="$(git rev-parse "$tag^{commit}")"
on_ref() { git rev-parse --verify --quiet "$1^{commit}" >/dev/null && git merge-base --is-ancestor "$commit" "$1"; }
if ! on_ref "$main_ref"; then
  if [ "$prerelease" = true ] && on_ref "$rc_ref"; then
    :
  elif [ "$prerelease" = true ]; then
    die "$tag's commit $commit is on neither $main_ref nor $rc_ref"
  else
    die "$tag's commit $commit isn't on $main_ref"
  fi
fi

# 4. The versions at that commit.
read_version() {
  case "$1" in
    .release-please-manifest.json) git show "$commit:$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)["."]))' ;;
    extension/manifest.json) git show "$commit:$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))' ;;
    server/mix.exs) git show "$commit:$1" | sed -n 's/^[[:space:]]*version:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 ;;
  esac
}
for f in .release-please-manifest.json extension/manifest.json server/mix.exs; do
  v="$(read_version "$f")"
  [ "$v" = "$core" ] || die "$f says ${v:-nothing} at $commit, but the tag is $tag"
done

echo "version=$version"
echo "prerelease=$prerelease"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "version=$version"
    echo "prerelease=$prerelease"
    echo "commit=$commit"
  } >>"$GITHUB_OUTPUT"
fi
