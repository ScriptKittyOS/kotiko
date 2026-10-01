# 30 · Release pipeline

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [02-test-harness-and-ci](../02-test-harness-and-ci/SPEC.md), [03-oss-foundations](../03-oss-foundations/SPEC.md) |
| **Unblocks** | The public release; [40](../40-server-packaging-docker/SPEC.md) (image publishing hooks in here), [44](../44-docs-site/SPEC.md) |
| **Sources** | [04 section 3 "Release plan", S30, S32](../../docs/research/04-architecture-release.md); [03 E6, E7](../../docs/research/03-browser-extension.md); [DECISIONS: store publisher and contact](../DECISIONS.md) |

## Problem

There is no way to ship Mira to anyone who doesn't clone the repository. The extension is
loaded unpacked (`README.md:56-63`), Firefox users get a temporary add-on that disappears
on restart (`README.md:181-185`), there are no tags or releases, and the version is
defined in two disagreeing places (`extension/manifest.json:4` 0.2.0, `server/mix.exs:7`
0.1.0; slice 03 unifies it).

Doing releases by hand would mean: bump versions, write notes, zip the extension
correctly for each store, upload to the Chrome Web Store, sign and submit to AMO, tag,
publish checksums. Each step is easy to get subtly wrong (a stray file in the zip, a
manifest key one store rejects, a forgotten version bump), and volunteer maintainers
won't do it often if it takes an afternoon.

The manifest also carries keys for both browsers at once: `background.service_worker`
and `background.scripts` (`manifest.json:8-11`), and `browser_specific_settings`
(`manifest.json:22`). Chrome accepts unknown keys with warnings, but each store should get
a clean manifest ([04 S30](../../docs/research/04-architecture-release.md)).

## Goals

- Merging a release PR is the only manual step to publish a version; store submission
  waits behind one approval click.
- Every release produces: a Chrome zip, a Firefox zip, a signed and listed AMO version, a
  Chrome Web Store upload, a CHANGELOG entry, a git tag, a GitHub release with checksums
  and build provenance attestations.
- Builds are reproducible from the tag.
- Store credentials belong to the ScriptKittyOS organization accounts and are usable only
  by the release workflow after approval.

## Non-goals

- Docker images and server release tarballs: slice [40](../40-server-packaging-docker/SPEC.md),
  which adds a job to this workflow.
- Store listing text, screenshots, privacy disclosures: slice [28](../28-privacy-and-store-readiness/SPEC.md).
- The docs site deploy: slice [44](../44-docs-site/SPEC.md).
- Safari: slice [51](../51-safari-port/SPEC.md).

## User stories

- As a maintainer, I want to merge one PR and approve one deployment to ship a version.
- As a user, I want store updates to arrive automatically.
- As a cautious user, I want to verify that the zip I downloaded was built from this
  repository's tag.

## Specification

### 1. Versioning and release PRs (release-please)

- `googleapis/release-please-action` (v4, pinned by SHA) runs on every push to `main`.
- Config `release-please-config.json`:

  ```json
  {
    "release-type": "simple",
    "include-component-in-tag": false,
    "changelog-sections": [
      {"type": "feat", "section": "Features"},
      {"type": "fix", "section": "Bug fixes"},
      {"type": "perf", "section": "Performance"},
      {"type": "deps", "section": "Dependencies", "hidden": true},
      {"type": "docs", "hidden": true}, {"type": "ci", "hidden": true},
      {"type": "chore", "hidden": true}, {"type": "test", "hidden": true}
    ],
    "extra-files": [
      {"type": "json", "path": "extension/manifest.json", "jsonpath": "$.version"},
      {"type": "generic", "path": "server/mix.exs"}
    ]
  }
  ```

  with `.release-please-manifest.json` as the version source (slice 03). `mix.exs`'s
  version line carries `# x-release-please-version`.
- release-please keeps an open "chore(main): release 0.3.0" PR with the CHANGELOG entry
  and the version bumps. A maintainer edits the PR text if needed (highlights at the
  top, written for learners) and merges. That creates tag `v0.3.0` and a draft-free
  GitHub release, and sets `release_created` for the jobs below.
- Pre-1.0: `feat` bumps the minor version, `fix` the patch, `!` breaking changes bump the
  minor (`bump-minor-pre-major: true`).

### 2. Release workflow (`.github/workflows/release.yml`)

```yaml
on:
  push: { branches: [main] }
permissions: { contents: read }
jobs:
  release-please:
    permissions: { contents: write, pull-requests: write }
    outputs: { created: ..., tag: ..., version: ... }

  build-extension:
    needs: release-please
    if: needs.release-please.outputs.created == 'true'
    permissions: { contents: write, id-token: write, attestations: write }
    steps:
      - checkout at the tag
      - setup-node 22; npm ci
      - npm test; npm run lint          # same checks as CI, on the tagged tree
      - node scripts/build-extension.mjs --version $VERSION --out dist/
      - SHA256SUMS over dist/*
      - actions/attest-build-provenance for each file in dist/
      - upload dist/* and SHA256SUMS to the GitHub release

  publish-chrome:
    needs: build-extension
    environment: release               # required reviewer approval
    steps: download mira-chrome-$VERSION.zip; upload and publish (section 4)

  publish-firefox:
    needs: build-extension
    environment: release
    steps: download mira-firefox-$VERSION.zip; web-ext sign (section 5)
```

Slice 40 adds `build-server` (tarballs) and `publish-image` (GHCR) jobs gated the same
way. A `workflow_dispatch` input `dry_run: true` runs `build-extension` on any ref
without creating a release or publishing, for testing the pipeline.

### 3. Building the extension (`scripts/build-extension.mjs`)

Node 22 plus one dev dependency, `yazl` (a small zip writer that lets us set entry
order, timestamps and permissions). Steps:

1. Copy `extension/` to a temp dir, excluding dotfiles, `*.map`, editor files and
   anything in `.buildignore`.
2. Check `manifest.json` `version` equals `--version` (slice 03's check, again).
3. Write two manifests from the source manifest:
   - **Chrome**: delete `background.scripts`, `browser_specific_settings`, and any key
     Chrome warns about; keep `background.service_worker`.
   - **Firefox**: delete `background.service_worker` (Firefox uses `background.scripts`
     as an event page; it has accepted both keys since Firefox 121, but a single key
     avoids review questions); keep `browser_specific_settings.gecko` (id
     `mira@scriptkittyos.com` from slice 04, `strict_min_version`, and slice 28's
     `data_collection_permissions`).
   - Both: `key` must not be present (fail the build if it is).
4. Zip deterministically: entries sorted by path, fixed timestamp (the tag's commit
   time), fixed permissions, no directory entries, deflate level 9. Rebuilding the same
   tag gives byte-identical zips (verified in CI by building twice).
5. Outputs: `dist/mira-chrome-0.3.0.zip`, `dist/mira-firefox-0.3.0.zip`.
6. Run `web-ext lint --source-dir <firefox tree>` on the Firefox tree; fail on errors.

No minification or bundling, so AMO needs no source code upload and reviewers read the
same files as the repository ([03 E7](../../docs/research/03-browser-extension.md)).

### 4. Chrome Web Store

- **Account**: the ScriptKittyOS organization's Chrome Web Store publisher account,
  public contact `hello@scriptkittyos.com` (maintainer decision). The one-time developer
  registration fee is paid on that account.
- **First submission is manual**: create the item, fill in the listing, privacy practices
  and single-purpose statement from slice 28, upload the first zip by hand. This assigns
  the permanent extension id, recorded in `docs/stores.md`.
- **Automated uploads**: `chrome-webstore-upload-cli` (pinned) with OAuth credentials of
  a Google Cloud project owned by the ScriptKittyOS Google account: `CWS_CLIENT_ID`,
  `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_EXTENSION_ID`. Upload, then publish to
  the default audience. (The CLI tracks the current Chrome Web Store API version, which
  Google has been revising; using it avoids pinning to one API generation.)
- Review can take hours to days; the job succeeds on "submitted". A follow-up scheduled
  workflow (daily) reads the item status and posts it on the release as a comment.
- Staged rollout (percentage) is optional and off by default.

### 5. Firefox Add-ons (AMO)

- **Account**: the ScriptKittyOS organization's AMO developer account, same public
  contact. The add-on is **listed** on addons.mozilla.org.
- **First submission is manual** (listing, categories, privacy policy URL from slice 44,
  `data_collection_permissions` from slice 28).
- **Automated**: `web-ext sign --channel listed --source-dir <firefox tree>
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET" --approval-timeout 0`
  (submit without waiting for review). Credentials are AMO API keys generated on the
  organization account.
- When approved, AMO distributes updates to users automatically; no self-hosted update
  manifest is needed.
- The signed `.xpi` is not attached to the GitHub release (listed versions are signed
  after review); the Firefox zip is attached for transparency.

### 6. Secrets and approvals

- All store credentials are GitHub Actions secrets of the **`release` environment** in
  `ScriptKittyOS/mira` (repository renamed in slice 04), not repository-wide secrets, so
  PR workflows and forks can never read them.
- The environment requires approval from at least one member of
  `@ScriptKittyOS/mira-maintainers`, and only the `main` branch may deploy to it.
- Credentials are created on the organization's accounts (not a maintainer's personal
  Google or Mozilla account), documented in `docs/stores.md` with who can rotate them and
  how. Rotation at least yearly and whenever a maintainer leaves.

### 7. Checksums and attestations

- `SHA256SUMS` lists every release file. It is attached to the release.
- `actions/attest-build-provenance` creates a Sigstore-signed SLSA provenance
  attestation for each zip, stored by GitHub.
- Verification, documented in the release notes footer and the docs site:

  ```
  sha256sum -c SHA256SUMS
  gh attestation verify mira-chrome-0.3.0.zip --repo ScriptKittyOS/mira
  ```

### 8. Release notes

The GitHub release body is the CHANGELOG entry plus a fixed footer: install links for
both stores, server upgrade instructions (`git pull && ./run.sh`, or Docker once slice 40
lands), the compatibility line ("Extension 0.3 works with server 0.2 and 0.3"), and the
verification commands.

### 9. Compatibility policy

- Extension and server share a version and release together.
- An extension version works with a server of the same minor and one minor older (slice
  07 keeps legacy routes for one minor; slice 29's `/health` lets the extension detect
  the server's API versions and say "Update your Mira server" when needed).

### 10. Rollback

Neither store supports rolling back to an older package. A bad release is fixed by a new
patch release (`fix:` commit, release PR, merge). On AMO, a maintainer can also disable
the bad version so users stay on the previous one. Documented in `docs/stores.md`.

## Acceptance criteria

- [ ] Merging a release PR creates the tag, the GitHub release, both zips, `SHA256SUMS` and
      attestations without further action.
- [ ] Store jobs wait for approval in the `release` environment and can't run from a fork
      or a PR.
- [ ] Building the same tag twice gives byte-identical zips.
- [ ] The Chrome zip's manifest has no `background.scripts`, `browser_specific_settings`
      or `key`; the Firefox zip's has no `background.service_worker` and has the gecko id
      `mira@scriptkittyos.com`.
- [ ] `web-ext lint` passes on the Firefox tree; Chrome accepts the zip without manifest
      warnings (checked on the first manual upload).
- [ ] `gh attestation verify` succeeds for both zips.
- [ ] `manifest.json`, `mix.exs` and the release-please manifest show the same version
      after a release PR merges.
- [ ] A `dry_run` dispatch on a branch builds artifacts and publishes nothing.

## Test plan

- `scripts/build-extension.mjs` unit tests: manifest transforms, ignored files,
  determinism (two builds, compare hashes), refusal when a `key` is present or versions differ.
- Dry-run the workflow on a fork with fake secrets, then a first real `v0.3.0-rc.1`
  pre-release with store jobs skipped.
- First real release: manual submission to both stores (section 4 and 5), then the next
  patch release fully automated as the end-to-end check.

## Rollout and migration

- Land after slices 02 and 03; the first automated release is the first public one,
  together with flipping the repository to public (slice 03's checklist).
- Users of the unpacked extension: the README explains switching to the store version.
  The Chrome store version has a different id from an unpacked copy, so settings don't
  carry over; slice 12's export and import (or re-entering the server address and token)
  covers it. Firefox users were on temporary add-ons and lose nothing.
- Changelog: the release itself.

## Open questions

1. **Publish automatically after approval, or upload as draft and publish by hand in the
   store dashboards?** Recommendation: automatic after the environment approval; the
   approval is the human check.
2. **Pre-releases.** Recommendation: GitHub pre-releases (`-rc.N` tags) with zips only, no
   store uploads; testers load them unpacked.

## Future work

- Edge Add-ons (same Chrome zip) once there is demand.
- Automatic store listing updates from files in the repository.
- Reproducible-build verification by a second, independent workflow.
