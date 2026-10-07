# 30 · Release pipeline

| | |
|---|---|
| **Status** | Built (2026-10-05); store uploads untested until the maintainer adds the store accounts and secrets; see Implementation notes |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [02-test-harness-and-ci](../02-test-harness-and-ci/SPEC.md), [03-oss-foundations](../03-oss-foundations/SPEC.md); the release checklist checks [50](../50-ui-localization-and-base-language/SPEC.md)'s launch locales, [34](../34-pronunciation-audio/SPEC.md)'s manual voice check and [54](../54-pre-release-security-review/SPEC.md)'s security gate (the first store upload waits on it) |
| **Unblocks** | The public release; [40](../40-server-packaging-docker/SPEC.md) (image publishing hooks in here), [44](../44-docs-site/SPEC.md) |
| **Sources** | [04 section 3 "Release plan", S30, S32](../../docs/research/04-architecture-release.md); [03 E6, E7](../../docs/research/03-browser-extension.md); [DECISIONS: store publisher and contact](../DECISIONS.md) |

> **Note (2026-10-05):** Spanish copy in this spec (listings, policy, messages, release
> notes, acceptance criteria) is optional, not a must-have. Only English is required at
> launch; see [DECISIONS 2026-10-05](../DECISIONS.md).

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
Three more boxes for the first public release. The security box comes back for any release
that changes permissions, messaging, how secrets are stored, the server's API or the bot;
the other two for any release that changes the popover (19), audio (34), the respelling keys
or the pronunciation prompt (07, 09):

- **Security review** ([54](../54-pre-release-security-review/SPEC.md)): three independent
  reports on the release candidate, every finding's proof rerun by the lead, no confirmed
  critical, high or medium finding open, the fixes confirmed by a fresh reviewer, and
  `docs/security/review-<tag>.md` committed. No store job is approved before this box is
  ticked.

- **Voice check** ([34](../34-pronunciation-audio/SPEC.md)'s manual test): the speak button
  tried on Chrome and Firefox on Windows, macOS and Linux with French, Mandarin, Japanese,
  Arabic, Russian, Thai and (with a Spanish base) English words; for the Russian
  pronunciation cases in [09](../09-shared-word-spec-and-prompt/SPEC.md) section 6, whether
  the voice's stress agrees with the popover's respelling. The results table (platform,
  browser, voice, word, agrees or not) goes in the release PR, and each disagreement is
  filed against the respelling or the engine before the box is ticked.
- **Spanish respelling key**: `spec/lang/es/respelling.json` signed off by readers from
  Spain, Mexico, the Caribbean and the Southern Cone
  ([50](../50-ui-localization-and-base-language/SPEC.md) open question 5); until then the
  docs (44) mark the key "beta" and the box says so.

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

## Implementation notes

Built 2026-10-05. What runs where:

| Piece | File |
|---|---|
| release-please config (§1) | `release-please-config.json` |
| Release workflow (§2, §11) | `.github/workflows/release.yml` |
| Daily Chrome Web Store status (§4) | `.github/workflows/store-status.yml`, `scripts/cws-status.mjs` |
| Store zips (§3) | `scripts/build-extension.mjs`, `extension/.buildignore` |
| Signed tags (§11) | `scripts/tag-release.sh`, `scripts/verify-tag.sh`, `.github/allowed_signers` |
| Release notes and their checks (§8, §11) | `scripts/release-notes.mjs` |
| Security-review gate (54) | `scripts/check-security-gate.mjs` |
| Server SBOM (§11) | `{:sbom, "~> 0.11", only: :dev}` in `server/mix.exs` |
| Guides | `docs/stores.md` (setup, secrets, checklist, rollback), `docs/verify.md`, `docs/reproducible-builds.md` |
| Tests | `test/unit/build-extension.test.mjs`, `release-notes.test.mjs`, `release-tags.test.mjs`, `cws-status.test.mjs` |

- **Release-please (§1).** `googleapis/release-please-action` **v5.0.0**, not v4: v5's only
  breaking change is the Node 24 runtime (GitHub is retiring Node 20 actions), and it ships
  release-please 17.6. It runs with `skip-github-release: true` (§11), so it only keeps the
  release PR. Checked locally with release-please 17.6.0's own code: the config passes its
  JSON schema; its updaters set 0.3.0 in `extension/manifest.json` and `server/mix.exs`;
  `fix` gives 0.2.1, `feat` and `!` give 0.3.0 (`bump-minor-pre-major`); the new CHANGELOG
  entry goes between `## Unreleased` and `## 0.2.0`. Two things the spec's config didn't
  say:
  - Hidden sections need a `section` name (the schema requires it). `build`, `refactor` and
    `style` are listed as hidden too.
  - `bootstrap-sha` is the 0.2.0 commit (c4275d8), so the first release PR lists only
    commits since 0.2.0, not the whole history.

  The JSON updater rewrites `extension/manifest.json` with one array item per line on the
  first release PR. That's release-please's JSON writer; reformatting the manifest now would
  collide with slices changing it in parallel.
- **Release notes and `## Unreleased`.** Each slice adds a plain-language entry under
  `## Unreleased`. The release manager moves those into the version's section on the release
  PR's branch, above release-please's commit list. `tag-release.sh` refuses to tag while
  `## Unreleased` has entries, or while a section with `BREAKING CHANGES` has no
  `### Upgrade notes`. The GitHub release body is the CHANGELOG section plus the §8 footer.
  It isn't the release PR's description, because release-please doesn't carry edits there
  into the CHANGELOG. Store links in the footer come from the repository variables
  `CHROME_STORE_URL` and `FIREFOX_STORE_URL` once the items exist.
- **Tags (§11).** `verify-tag` checks out `main`, not the tag, and verifies with main's
  `.github/allowed_signers` (SSH) or `.github/release-keys.asc` (GPG, imported into an empty
  keyring). A tag can't vouch for itself, and an unknown key fails. It also requires the
  tagged commit to be on `main` and the three version files to match the tag.
  - A release candidate may instead sit on release-please's branch, whose version is
    already bumped. That's how slice 54 can freeze `vX.Y.Z-rc.1` before the release PR merges.
  - `tag-release.sh` verifies the new tag the same way before pushing, and deletes it if
    that fails.
  - `allowed_signers` is empty (comments only) until the maintainer adds their key, so
    every tag is refused until then.
- **Order of jobs.** `verify-tag`, then `build`, `attest`, `github-release`, `store-gate`,
  then `publish-chrome` and `publish-firefox`. The GitHub release is created after the build
  and attestations, rather than first, so a failed build leaves no empty release. It's
  created with `gh release create --verify-tag` and all files at once. The merged release
  PR's label then moves from `autorelease: pending` to `autorelease: tagged` (REST labels
  API).
- **Build (§3).** The zips are written with **fflate** (pure JavaScript), not yazl:
  - yazl compresses with Node's zlib. Node bundles Chromium's zlib, whose deflate picks its
    hash function by CPU features, so its output isn't canonical and can differ between
    machines ([Chromium zlib](https://chromium.googlesource.com/chromium/src/third_party/zlib/+/27c2f474b71d0d20764f86f60ef8b00da1a16cda)).
    fflate's output depends only on the input and fflate's version, which is pinned in the
    lockfile.
  - Timestamps: the commit time, written in UTC whatever the time zone. The test builds in
    UTC, Los Angeles and Kolkata and compares.
  - Mode 0644 from Unix, no directory entries, sorted by code unit.
  - `LICENSE`, `NOTICE` and `LICENSES/` go into both zips, because Apache-2.0 §4 asks that
    recipients get the license. That's a small addition to "only files from `extension/`".
  - `extension/ui/tools/` (the design-token generators) is left out through `.buildignore`.
  - `web-ext lint` runs on the Firefox tree without `--self-hosted` (listed rules): 0 errors,
    1 warning, `MISSING_DATA_COLLECTION_PERMISSIONS`. Slice 28 adds that key; AMO requires
    it for new add-ons, so the first submission waits on 28.
  - A release candidate `X.Y.Z-rc.N` builds from a manifest saying `X.Y.Z` (browsers only
    accept dotted numbers) and is named `kotiko-chrome-X.Y.Z-rc.N.zip`.
- **Reproducibility in CI.** The release job builds twice and compares with `cmp`. The unit
  tests build the real extension twice and compare SHA-256. Locally: built in four time
  zones (UTC, Los Angeles, Tokyo, Auckland); every pair of zips was byte-identical.
- **Attestations (§7).** `actions/attest` v4.2.2 (upstream now recommends it over
  `attest-build-provenance`, which became a wrapper) attests both zips, the SBOM and
  `SHA256SUMS` in one provenance statement. It runs in its own job, after the build, so the
  job that runs `npm test` never holds `id-token: write`. Manual runs never attest.
  Attestations need a public repository (or Enterprise Cloud). While the repository is
  private, a release candidate goes out without them, with a warning. A real release fails
  at that step, and nothing is published.
- **Stores (§4, §5, §6).**
  - `chrome-webstore-upload-cli` 4.0.2 and `chrome-webstore-upload` 6.0.1, pinned exactly
    in `package.json` and locked. 4.x uses the Chrome Web Store API v2, which needs one more
    value than the spec lists: **`CWS_PUBLISHER_ID`**. 4.0.2 is a day old; its only change
    from 4.0.1 removes a broken `--trusted-testers` flag.
  - Firefox uses the `web-ext` already in the lockfile. Secrets go in as `WEB_EXT_API_KEY`
    and `WEB_EXT_API_SECRET`, not on the command line. It signs the unpacked attested zip
    after checking its checksum.
  - Both store jobs run `npm ci --ignore-scripts`, use no caches, and skip with a notice when
    their secrets are missing.
  - The `release` environment must allow the **tag** pattern `v*`, not the branch `main` the
    spec says: the jobs run on the tag (§11 changed the trigger). A tag ruleset limits who
    can create `v*` tags.
  - Staged rollout is the optional variable `CWS_DEPLOY_PERCENTAGE`, off by default.
- **Security gate (54).** `store-gate` runs before the approval request. It needs a
  `docs/security/review-v*.md` with a line starting `Gate: closed` in the tagged tree, so no
  store upload can happen before the first review closes. One sentence in slice 54 §6 names
  the line. Later reviews, for releases touching permissions, messaging, secrets, the API or
  the bot, are the checklist box: no script can tell which releases need one.
- **Daily status (§4).** It edits the release notes rather than commenting, because GitHub
  releases have no comments. It updates one marked line, only when the status changes, and
  stops once the version is live.
  - It uses its own `store-status` environment, with a refresh token minted for the
    **read-only** scope `chromewebstore.readonly`. The approval-gated `release` environment
    would stop a scheduled job every day, and an ungated copy of the publishing token would
    weaken that gate.
- **Dry run.** A manual run is always a dry run: build, SBOM and checksums as a workflow
  artifact; no release, attestation or upload. The spec's `dry_run` input is gone, because a
  manual run that publishes would only be a second way around the signed tag.
- **SBOM.** `sbom` 0.11 as a dev-only dependency, as the spec says; its README now
  recommends the dependency over the Mix archive. `mix sbom.cyclonedx --only prod` lists 29
  components: the runtime dependencies plus Erlang/OTP and Elixir. The maintainer's server runs with `MIX_ENV=prod` and
  `mix deps.get --only prod`, so it never fetches it.
  `sbom` 0.11 itself needs Elixir 1.17+, while the server supports 1.15+. CI's 1.15 job
  runs in the test environment and never compiles it; a contributor on 1.15 or 1.16 working
  in the dev environment may see Mix warn about it. A Mix archive install was tried in its
  place (lead review) and fails: the archive lacks `hex_core`.
- **English only.** Per DECISIONS 2026-10-05, the release notes, listings and checklist are
  English. The Spanish release-notes file (§8) and the Spanish listing boxes are dropped. The
  Spanish respelling-key sign-off stays as a checklist box: it's reader support, not the
  interface.
- **Also changed.** CI's `shell` job shellchecks `scripts/*.sh`. `docs/release/voice-check.md`
  links the checklist. `docs/PUBLIC_CHECKLIST.md` gains the release setup.
- **Not verified here (needs the maintainer's accounts):** a real tag push, the store
  uploads, `gh attestation verify` on a real release, release-please opening its PR, and
  Chrome's dashboard warnings on the first manual upload.
  - Locally, the built Chrome tree loads in Playwright's Chromium, its service worker
    starts, and `developerPrivate` reports no install warnings or manifest errors. The
    unmodified source manifest reports none in that Chromium either, so this doesn't stand
    in for the store's check.
- **Sources.**
  - release-please: the [action's README](https://github.com/googleapis/release-please-action)
    (inputs, `skip-github-release`, token caveat), the
    [manifest config schema](https://github.com/googleapis/release-please/blob/main/schemas/config.json)
    and its `simple` strategy and `changelog` updater source.
  - Chrome Web Store: [API v2 setup](https://developer.chrome.com/docs/webstore/using-api)
    and [fetchStatus](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/fetchStatus)
    (scopes `chromewebstore` and `chromewebstore.readonly`);
    [chrome-webstore-upload](https://github.com/fregante/chrome-webstore-upload) and its CLI's
    4.0 notes (publisher id).
  - Firefox: the [web-ext command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)
    (`sign`, `--channel listed`, `--approval-timeout 0`, `WEB_EXT_*`).
  - Attestations: the [actions/attest README](https://github.com/actions/attest) (permissions,
    globs, private repositories) and `gh attestation verify`'s flags; SLSA
    [build provenance](https://slsa.dev/spec/v1.0/provenance).
  - Tags: `git verify-tag` with `gpg.ssh.allowedSignersFile`, and `ssh-keygen(1)`
    "ALLOWED SIGNERS".
  - Reproducible zips: [reproducible-builds.org on SOURCE_DATE_EPOCH](https://reproducible-builds.org/docs/source-date-epoch/)
    and on [archives](https://reproducible-builds.org/docs/archives/).
  - Every action is pinned to the commit its release tag points at, checked with
    `gh api repos/<action>/git/ref/tags/<tag>`: release-please-action v5.0.0 `45996ed`,
    attest v4.2.2 `1e69f48`, download-artifact v8.0.1 `3e5f45b`. Checkout, setup-node,
    setup-beam and upload-artifact use CI's existing pins.

### 2026-10-06: security review (slice 54) changes

- Firefox Add-ons now gets the release's own zip, unchanged, through web-ext's AMO client
  (`scripts/amo-submit.mjs`, which checks it against SHA256SUMS first) instead of
  `web-ext sign --source-dir`, which repacked it (finding C-06). Sections 5 and 8's mentions of
  `web-ext sign` describe the original design.
- `verify-tag.sh` also checks the name inside the signed tag object (C-02), the build checks
  out exactly the verified commit, and the release build runs property tests with fixed seeds
  (C-08). The store gate accepts only the exact `Gate: closed` line above `## Appendix` (C-05).

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
- [ ] `docs/stores.md`'s checklist has the security-review, voice-check and Spanish-key
      boxes, and the first public release PR links slice 54's combined report and carries
      the voice-check results table.

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
