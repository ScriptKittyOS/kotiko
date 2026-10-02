# 30 · Release pipeline

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [02-test-harness-and-ci](../02-test-harness-and-ci/SPEC.md), [03-oss-foundations](../03-oss-foundations/SPEC.md); the release checklist checks [50](../50-ui-localization-and-base-language/SPEC.md)'s launch locales |
| **Unblocks** | The public release; [40](../40-server-packaging-docker/SPEC.md) (image publishing hooks in here), [44](../44-docs-site/SPEC.md) |
| **Sources** | [04 section 3 "Release plan", S30, S32](../../docs/research/04-architecture-release.md); [03 E6, E7](../../docs/research/03-browser-extension.md); [DECISIONS: store publisher and contact](../DECISIONS.md) |

## Problem

There is no way to ship Kotiko to anyone who doesn't clone the repository. The extension is
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
    steps: download kotiko-chrome-$VERSION.zip; upload and publish (section 4)

  publish-firefox:
    needs: build-extension
    environment: release
    steps: download kotiko-firefox-$VERSION.zip; web-ext sign (section 5)
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
     `kotiko@scriptkittyos.com` from slice 04, `strict_min_version`, and slice 28's
     `data_collection_permissions`).
   - Both: `key` must not be present (fail the build if it is).
4. Zip deterministically: entries sorted by path, fixed timestamp (the tag's commit
   time), fixed permissions, no directory entries, deflate level 9. Rebuilding the same
   tag gives byte-identical zips (verified in CI by building twice).
5. Outputs: `dist/kotiko-chrome-0.3.0.zip`, `dist/kotiko-firefox-0.3.0.zip`.
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
  `ScriptKittyOS/kotiko` (repository renamed in slice 04), not repository-wide secrets, so
  PR workflows and forks can never read them.
- The environment requires approval from at least one member of
  `@ScriptKittyOS/kotiko-maintainers`, and only the `main` branch may deploy to it.
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
  gh attestation verify kotiko-chrome-0.3.0.zip --repo ScriptKittyOS/kotiko
  ```

### 8. Release notes

The GitHub release body is the CHANGELOG entry plus a fixed footer: install links for
both stores, server upgrade instructions (`git pull && ./run.sh`, or Docker once slice 40
lands), the compatibility line ("Extension 0.3 works with server 0.2 and 0.3"), and the
verification commands.

**In both launch languages.** The CHANGELOG stays in English (it is written from commit
messages), but the user-facing summary is not: the release PR carries a short
`release-notes/<version>.es.md` with the Spanish version of the user-facing changes,
written or reviewed by a Spanish speaker, and the release body includes it under
"Español". Store "what's new" text (where the store has one) is filled per listing
language from the same two files ([50](../50-ui-localization-and-base-language/SPEC.md),
[28](../28-privacy-and-store-readiness/SPEC.md)).

**Release checklist** (`docs/stores.md`), ticked in the release PR: the `i18n` CI job is
green (both launch locales complete); new strings since the last release were reviewed in
Spanish by a native speaker; the store listings in English and Spanish match the release.

### 9. Compatibility policy

- Extension and server share a version and release together.
- An extension version works with a server of the same minor and one minor older (slice
  07 keeps legacy routes for one minor; slice 29's `/health` lets the extension detect
  the server's API versions and say "Update your Kotiko server" when needed).

### 10. Rollback

Neither store supports rolling back to an older package. A bad release is fixed by a new
patch release (`fix:` commit, release PR, merge). On AMO, a maintainer can also disable
the bad version so users stay on the previous one. Documented in `docs/stores.md`.

### 11. Signed tags, verification, SBOM and release-note rules (P1, from slice 53)

Added by [53](../53-openssf-best-practices/SPEC.md) for the silver badge
(`signed_releases`, `version_tags_signed`, `release_notes_vulns`,
`maintenance_or_update`, `build_repeatable`, `external_dependencies`). Cheapest if built
into the first public release, because it changes how a release starts; 53's Open
question 3 confirms the tag-signing method.

- **Signed tags.** release-please runs with `skip-github-release: true`: it keeps the
  release PR, CHANGELOG and version bumps, but no longer tags. After the release PR
  merges, the release manager runs `scripts/tag-release.sh`, which checks that `HEAD` of
  an up-to-date `main` is the release commit and that the version matches
  `.release-please-manifest.json`, then runs `git tag -s vX.Y.Z -m "Kotiko X.Y.Z"` with
  their own SSH or GPG signing key and pushes the tag.
- **The workflow verifies the tag first.** `release.yml` gains the trigger
  `push: {tags: ["v*"]}` and a first job, `verify-tag`, that runs
  `git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile=.github/allowed_signers verify-tag "$TAG"`
  (GPG keys, if a maintainer uses them, are imported from `.github/release-keys.asc`).
  An unsigned tag or one signed by a key not on the list stops the run before any build.
  Then `gh release create "$TAG" --verify-tag` with the CHANGELOG section as the body, and
  `build-extension` and the publish jobs of section 2 run as before, keyed on the tag.
  Finally the job moves the merged release PR's label from `autorelease: pending` to
  `autorelease: tagged`, which release-please needs before it opens the next release PR.
- **Who may tag.** `.github/allowed_signers` lists each maintainer's signing key; the same
  fingerprints are in MAINTAINERS.md (slice 53 §4.3). A repository ruleset lets only
  maintainers create `v*` tags. Adding or removing a key is a reviewed pull request.
- The "only manual step" in the goals becomes two: merge the release PR, push the signed
  tag. The `release` environment approval stays.
- **Signed files.** Section 7's attestations already sign every zip with Sigstore, keyless,
  so no private key exists on GitHub or anywhere else. Also attest `SHA256SUMS` and the
  SBOM. The stores sign what they distribute (AMO signs every Firefox add-on; the Chrome
  Web Store signs its packages).
- **`docs/verify.md`**, linked from the release notes footer (section 8) and the docs site:
  1. The tag: `git -c gpg.ssh.allowedSignersFile=.github/allowed_signers verify-tag v0.3.0`,
     with the keys cross-checked against MAINTAINERS.md and the maintainers' GitHub
     profiles.
  2. The files: `sha256sum -c SHA256SUMS`, then
     `gh attestation verify kotiko-chrome-0.3.0.zip --repo ScriptKittyOS/kotiko`.
  3. The store versions: install only from the store links in the README.
- **SBOM.** Each release attaches `kotiko-server-<version>.cdx.json`, a CycloneDX SBOM
  from `mix sbom.cyclonedx` (the `sbom` Hex package, dev only). The extension zip contains
  only files from `extension/` and no third-party code; the release notes footer says so,
  and any later bundled asset (fonts from slice 17) is added to NOTICE and listed in a
  second SBOM.
- **Release notes rules.** The release PR's text gets a hand-written **Security** section
  whenever the release fixes a vulnerability (advisory ID, CVE, severity and credit, per
  slice 53 §4.2), and an **Upgrade notes** section for every breaking (`!`) change: what
  changed, who is affected, the steps. `docs/stores.md`'s release checklist gains: "Security
  section complete, or no security fixes"; "Upgrade notes for every breaking change";
  "README, `docs/` and the docs site describe this release"; "Best-practices answers still
  true (slice 53 §7.6)".
- **`docs/reproducible-builds.md`**: how anyone rebuilds the extension zips from a tag and
  compares hashes: the exact Node version, `npm ci`,
  `node scripts/build-extension.mjs --version X.Y.Z --out dist/`, `sha256sum` against
  `SHA256SUMS`; what is fixed (entry order, timestamps from the tag's commit, permissions);
  slice 40's notes for the server tarball and image.

## Acceptance criteria

- [ ] Pushing the signed tag for a merged release PR (section 11) creates the GitHub
      release, both zips, `SHA256SUMS` and attestations without further action.
- [ ] (53) A `v*` tag that is unsigned, or signed by a key not in `.github/allowed_signers`,
      stops the release workflow before any build.
- [ ] (53) Someone outside the project follows `docs/verify.md` for a release and every step
      succeeds; the release has attestations for the zips, `SHA256SUMS` and the SBOM.
- [ ] (53) A release that fixes a vulnerability has a Security section; a release with a
      breaking change has Upgrade notes.
- [ ] Store jobs wait for approval in the `release` environment and can't run from a fork
      or a PR.
- [ ] Building the same tag twice gives byte-identical zips.
- [ ] The Chrome zip's manifest has no `background.scripts`, `browser_specific_settings`
      or `key`; the Firefox zip's has no `background.service_worker` and has the gecko id
      `kotiko@scriptkittyos.com`.
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
