# Releases and the stores

How a Kotiko version gets from `main` to the Chrome Web Store, Firefox Add-ons and a GitHub
release, what has to be set up once, and the checklist ticked in every release pull request.
The pipeline is [slice 30](../slices/30-release-pipeline/SPEC.md); the workflow is
[`.github/workflows/release.yml`](../.github/workflows/release.yml).

## Versions

The first public release is **v1.0.0** (DECISIONS 2026-10-05). 0.2.0 was the last version of
the personal tool, so `main` keeps saying 0.2.0 until 1.0.0 is released; the work since is
under `## Unreleased` in the CHANGELOG. `release-please-config.json` pins the next release
with `"release-as": "1.0.0"`, so the release PR proposes 1.0.0 whatever the commits say.
Before launch, builds for slice 54's review are release candidates on the release PR's head:
`v1.0.0-rc.1`, `v1.0.0-rc.2`, and so on (below). The stores get `v1.0.0` only.

**After v1.0.0 ships, remove `"release-as"`** (one line, in the PR that follows the
release); from then on release-please picks the version from the commits: `fix` gives
1.0.1, `feat` 1.1.0, a breaking change 2.0.0.

## How a release happens

1. **The release PR.** On every push to `main`, release-please updates a pull request called
   "chore(main): release X.Y.Z". It bumps the version in `.release-please-manifest.json`,
   `extension/manifest.json` and `server/mix.exs`, and adds a CHANGELOG section listing the
   `feat`, `fix` and `perf` commits since the last release. (The first release PR also
   reformats `extension/manifest.json` with one array item per line: that's how release-please
   writes JSON, and it stays that way afterwards.)
2. **Get it ready.** Check out the PR's branch (`release-please--branches--main`) and edit
   `CHANGELOG.md` there, as one commit right before merging (release-please rewrites the
   branch whenever `main` moves):
   - move everything under `## Unreleased` into the new version's section, at the top. Those
     are the plain-language notes learners read; the commit list stays below them;
   - add a `### Security` section if the release fixes a vulnerability, and a
     `### Upgrade notes` section for every breaking change (below);
   - tick the [checklist](#release-checklist) in the PR's description.

   CI doesn't start on its own for PRs that release-please opens with the default token.
   Close and reopen the PR to run it, or set up `RELEASE_PLEASE_TOKEN` (below).
3. **Merge it**, then tag from an up-to-date `main`:

   ```sh
   git switch main && git pull
   scripts/tag-release.sh --dry-run   # every check, no tag
   scripts/tag-release.sh             # signs vX.Y.Z with your key and pushes it
   ```

   The script refuses unless `HEAD` is `origin/main` and is the release commit, the three
   version files agree, `## Unreleased` is empty, and a breaking change has upgrade notes.
   It verifies the new tag against `.github/allowed_signers` before pushing, exactly as the
   workflow will.
4. **The workflow takes over.** It verifies the tag's signature (against the copy of
   `.github/allowed_signers` on `main`, never the tag's own), runs lint and the tests on the
   tagged tree, builds both zips twice and compares them byte for byte, writes the server's
   SBOM and `SHA256SUMS`, attests every file (Sigstore build provenance), and creates the
   GitHub release with the CHANGELOG section and a fixed footer.
5. **Approve the store uploads.** The two store jobs wait for approval in the `release`
   environment (Actions, the run, "Review deployments"). Before asking, the workflow checks
   that slice 54's security review is closed; until it is, the store jobs fail and nobody is
   asked to approve. After approval, Chrome gets the zip and submits it for review; Firefox
   gets the unpacked zip through `web-ext sign --channel listed` and doesn't wait for review.
   Both jobs succeed on "submitted"; review takes hours to days.
6. **Afterwards.** A daily job (`.github/workflows/store-status.yml`) writes the Chrome Web
   Store's review status into the release notes until the version is live. Once AMO
   approves, Firefox users get the update automatically.

### Release candidates

A candidate (`vX.Y.Z-rc.N`, for example the frozen commit slice 54 reviews) gets a GitHub
pre-release with the zips, checksums, SBOM and attestations, and never goes to the stores.
Tag it on the release PR's head, whose version is already bumped:

```sh
git fetch origin release-please--branches--main
git switch --detach origin/release-please--branches--main
scripts/tag-release.sh --rc 1
```

### Trying the pipeline without releasing

Actions, "Release", "Run workflow", pick a branch. A manual run is always a dry run: it runs
the tests, builds both zips twice, writes the SBOM and checksums, and uploads them as a
workflow artifact (`release-files`). It creates no release, no attestation and no store
upload. Locally:

```sh
node scripts/build-extension.mjs --version "$(node -p 'require("./extension/manifest.json").version')" --out dist/
```

## One-time setup

All of these are the maintainer's to do; nothing in the repository can do them.

### Repository settings

- **Settings, Actions, General**: "Allow GitHub Actions to create and approve pull requests"
  (release-please opens the release PR with the workflow's token).
- **Settings, Environments, `release`**:
  - Required reviewers: `@ScriptKittyOS/kotiko-maintainers` (at least one). With a single
    maintainer, leave "Prevent self-review" off.
  - Deployment branches and tags: "Selected branches and tags", add the **tag** rule `v*` and
    no branches. Store jobs run on the release tag, never on a branch, a pull request or a
    fork.
  - Secrets: the six store secrets below. Nothing else in the repository can read them.
- **Settings, Environments, `store-status`**: no reviewers; deployment branches: `main`
  only. Secrets: the read-only Chrome Web Store credentials below.
- **Settings, Rules, Rulesets** (set up 2026-10-05): a tag ruleset for `refs/tags/v*` with
  "Restrict creations", "Restrict updates" and "Restrict deletions", bypassed only by
  repository admins (switch the bypass to the `kotiko-maintainers` team once it exists).
  Only maintainers can start a release; nobody else can create, move or delete a release
  tag. Two more rulesets: `main` takes changes only through pull requests whose CI checks
  pass (no force pushes or deletion, no bypass), and a push ruleset rejects `.env`,
  database, private-key and token files and files over 10 MB on every branch.
- **Settings, Secrets and variables, Actions, Variables** (optional):
  `CHROME_STORE_URL` and `FIREFOX_STORE_URL` (the listing pages, used in release notes once
  the items exist), `CWS_DEPLOY_PERCENTAGE` (a staged rollout, 1 to 100; leave unset to
  publish to everyone).
- **Artifact attestations** need a public repository (or GitHub Enterprise Cloud). The first
  real release goes out when the repository goes public (slice 03's checklist); a tag pushed
  while it is private fails at the `attest` step, and nothing is published.

### Secrets

Every credential belongs to the ScriptKittyOS organization's accounts, never a maintainer's
personal Google or Mozilla account, so others in the organization can rotate them.

| Secret | Environment | Where it comes from | Scope |
|---|---|---|---|
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` | `release` and `store-status` | A Google Cloud project owned by the ScriptKittyOS Google account: enable the **Chrome Web Store API**; set up the OAuth consent screen (Internal if the account is in Google Workspace; otherwise External **and "In production"**, because tokens of an app in "Testing" expire after 7 days); create an OAuth client of type **Web application** with the redirect URI `https://developers.google.com/oauthplayground`. ([Google's guide](https://developer.chrome.com/docs/webstore/using-api)) | The client alone can do nothing; it needs a refresh token |
| `CWS_REFRESH_TOKEN` (release) | `release` | [OAuth 2.0 Playground](https://developers.google.com/oauthplayground): gear icon, "Use your own OAuth credentials", scope `https://www.googleapis.com/auth/chromewebstore`, sign in as the account that owns the publisher, "Exchange authorization code for tokens". ([step by step](https://github.com/fregante/chrome-webstore-upload-keys)) | Upload and publish this publisher's items |
| `CWS_REFRESH_TOKEN` (status) | `store-status` | The same steps with the scope `https://www.googleapis.com/auth/chromewebstore.readonly` | Read item status only; it can't upload or publish |
| `CWS_PUBLISHER_ID` | `release` and `store-status` | Chrome Web Store Developer Dashboard, Settings (also in the dashboard's URL). Not the extension id | Identifier, not a credential |
| `CWS_EXTENSION_ID` | `release` and `store-status` | Assigned when the item is created by the first manual upload; recorded under [Store items](#store-items) | Identifier, not a credential |
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | `release` | addons.mozilla.org, signed in as the organization's developer account: Developer Hub, Tools, [Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/) ("JWT issuer" and "JWT secret") | AMO keys can't be narrowed: they act as that account. Keep them only in `release` |
| `RELEASE_PLEASE_TOKEN` (optional) | repository | A fine-grained personal access token or GitHub App token for `ScriptKittyOS/kotiko` only, with Contents and Pull requests read and write. Without it, the workflow's own token is used and CI on the release PR needs a close and reopen | This repository's contents and pull requests |

The workflows never print these. When a store's secrets are missing, its job ends with a
notice ("Chrome Web Store upload skipped …") and succeeds, so a release without store
credentials still produces the GitHub release.

**Rotation**: at least yearly, and whenever someone with access leaves (slice 53 §4.3).
Who can rotate: the organization's owners. Chrome: in the Google Cloud project, delete the
OAuth client's secret and create a new one (or revoke the refresh token at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions)), then mint new
refresh tokens and replace the secrets. AMO: "Revoke and regenerate credentials" on the API
keys page, then replace both secrets. Run a dry run afterwards; the next release proves the
store credentials.

### Signing keys

Each release manager signs tags with their own key; no signing key exists on GitHub.

- **SSH** (simplest): `git config --global gpg.format ssh` and
  `git config --global user.signingkey ~/.ssh/id_ed25519.pub`, then add a line to
  `.github/allowed_signers` in a pull request:
  `you@example.com namespaces="git" ssh-ed25519 AAAA…`.
- **GPG**: `git config --global user.signingkey <fingerprint>`, then
  `gpg --armor --export <fingerprint> >> .github/release-keys.asc` in a pull request.

List the same key's fingerprint in MAINTAINERS.md. Until a key is added, every release tag
is refused.

### First submission to each store (manual, once)

The first version of each item is uploaded by hand; that creates the item and its id.

- **Chrome Web Store**: ScriptKittyOS publisher account (contact `hello@scriptkittyos.com`),
  developer fee paid on it, 2-step verification on. New item, upload
  `kotiko-chrome-X.Y.Z.zip` from the GitHub release, fill the listing, privacy practices and
  single-purpose statement from slice 28. Check that the dashboard shows no manifest
  warnings. Record the id below and in `CWS_EXTENSION_ID`.
- **Firefox Add-ons**: ScriptKittyOS developer account, same contact. Submit
  `kotiko-firefox-X.Y.Z.zip` as a **listed** add-on, with the listing, categories, privacy
  policy URL (slice 44) and the manifest's `data_collection_permissions` (slice 28; the build
  warns until the manifest has it, and AMO requires it for new add-ons). At least two owners
  on the add-on (slice 53 §4.3).

## Store items

| Store | Id | Listing |
|---|---|---|
| Chrome Web Store | (after the first upload) | |
| Firefox Add-ons | `kotiko@scriptkittyos.com` | (after the first submission) |

## Release checklist

Copy into the release PR's description and tick each box before merging. English is the
only language required at launch ([DECISIONS 2026-10-05](../slices/DECISIONS.md)); other
locales are optional.

```markdown
- [ ] CI is green on this PR (close and reopen it if the checks didn't start).
- [ ] CHANGELOG: the notes under "Unreleased" moved into this version's section, highlights first, written for learners.
- [ ] Security section complete, or no security fixes (advisory ID, CVE, severity, credit; slice 53 §4.2).
- [ ] Upgrade notes for every breaking change: what changed, who is affected, the steps.
- [ ] The English strings are complete (`_locales/en`; the i18n test is green) and the English store listings match this release.
- [ ] README, `docs/` and the docs site describe this release.
- [ ] Best-practices answers still true (slice 53 §7.6).
```

Also for the first public release; the security box again for any release that changes
permissions, messaging, how secrets are stored, the server's API or the bot; the
accessibility box again for any release that changes the popup, the dashboard, the welcome
tab, the word card or what happens on pages; the voice and respelling boxes again for any
release that changes the popover (19), audio (34), the respelling keys or the pronunciation
prompt (07, 09):

```markdown
- [ ] Security review (slice 54): three independent reports on the release candidate, every finding's proof rerun by the lead, no confirmed critical, high or medium finding open, the fixes confirmed by a fresh reviewer, and `docs/security/review-<tag>.md` committed with its "Gate: closed" line. This PR links the combined report. No store job is approved before this box is ticked.
- [ ] Accessibility (slice 27): the manual pass in [docs/accessibility.md](accessibility.md#manual-pass-before-each-release) done (NVDA with Firefox and Chrome, VoiceOver, Orca, Windows High Contrast, zoom, keyboard only, voice control); its results table is in this PR, and each problem is filed as an issue.
- [ ] Voice check (slice 34): [docs/release/voice-check.md](release/voice-check.md) done on Chrome and Firefox on Windows, macOS and Linux; the results table is in this PR, and each disagreement is filed against the respelling or the engine.
- [ ] Spanish respelling key: `spec/lang/es/respelling.json` signed off by readers from Spain, Mexico, the Caribbean and the Southern Cone; until then the docs mark the key "beta" (say which here).
```

### The security gate in the workflow

The `store-gate` job passes only when the tagged tree has a
`docs/security/review-vX.Y.Z[-rc.N].md` with a line starting `Gate: closed` (for example
`Gate: closed 2026-11-02 by <lead>, fixes confirmed on v1.0.0-rc.2`), which slice 54's lead
writes when the review ends. That blocks every store upload until the first review is done.
Later reviews (for releases that touch the areas above) are enforced by the checklist box,
not by the workflow, because no script can tell which releases need one.

## Rollback

Neither store installs an older package over a newer one. A bad release is fixed by a new
patch release: a `fix:` commit, the release PR, merge, tag. On Firefox Add-ons a maintainer
can also disable the bad version in the Developer Hub, so users stay on the previous one
until the fix is approved. On the Chrome Web Store, a staged rollout
(`CWS_DEPLOY_PERCENTAGE`) limits who gets a release before it's raised to 100 %.

## When something goes wrong

- **"isn't signed" or "not in the allowed signers file"**: the tag was made without `-s`, or
  with a key not in `.github/allowed_signers` (or `.github/release-keys.asc`) on `main`.
  Delete the tag (`git push origin :refs/tags/vX.Y.Z` and `git tag -d vX.Y.Z`; the ruleset
  lets maintainers do this), fix the key, run `scripts/tag-release.sh` again. Nothing was
  built or published.
- **release-please doesn't open the next PR**: the last release PR still has the label
  `autorelease: pending`. The workflow moves it to `autorelease: tagged`; if it warned that
  it couldn't find the PR, change the label by hand.
- **A store job failed after approval**: rerun just that job from the run's page. Chrome
  refuses an upload whose version it already has; Firefox refuses a version number AMO has
  seen. Both mean the version is already there.
