#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0
#
# Copies files as they are at a trusted commit into a folder, so that a pull request's
# required checks run with the base branch's settings and scripts, not the ones the pull
# request brings (security review C-01). Otherwise a pull request could add a secret and,
# in the same change, allow it in .gitleaks.toml, or accept its own vulnerable dependency in
# osv-scanner.toml, and pass. Its edits to these files take effect once it is merged.
#
#   scripts/base-file.sh <commit> <dir> <path>...
#
# Each <path> (relative to the repository's top) is written to <dir>/<path>. A path the
# commit doesn't have stops the script, so a check never runs without its settings. CI runs
# the base commit's own copy of this script (.github/workflows/ci.yml), not the pull
# request's.

set -euo pipefail

die() {
  echo "base-file: $*" >&2
  exit 1
}

[ $# -ge 3 ] || die "usage: base-file.sh <commit> <dir> <path>..."
commit="$1"
dir="$2"
shift 2

git cat-file -e "$commit^{commit}" 2>/dev/null || die "$commit isn't a commit in this repository"
for path in "$@"; do
  case "/$path/" in
    //* | */../* | */./* | *//*) die "$path isn't a plain path inside the repository" ;;
  esac
  [ "$(git cat-file -t "$commit:$path" 2>/dev/null || true)" = blob ] || die "$commit has no file $path"
  mkdir -p "$dir/$(dirname "$path")"
  git cat-file blob "$commit:$path" >"$dir/$path"
done
