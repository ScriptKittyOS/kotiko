# Verifying a Kotiko release

Each release on GitHub has the two extension zips (the exact files the release workflow
uploads to the Chrome Web Store and Firefox Add-ons; [section 3](#3-the-store-versions) says
what the stores add), the server's SBOM (`kotiko-server-X.Y.Z.cdx.json`) and
`SHA256SUMS`. These steps check that what you downloaded was built by this repository's
release workflow from a tag a maintainer signed. Replace `1.0.0` with the version you have.

You need `git`, `sha256sum` (macOS: `shasum -a 256`) and the [GitHub CLI](https://cli.github.com/)
(`gh`, signed in to any GitHub account).

## 1. The tag

The release manager signs each tag with their own key, listed in `.github/allowed_signers`
(SSH) or `.github/release-keys.asc` (GPG), and in [MAINTAINERS.md](../MAINTAINERS.md).

```sh
git clone https://github.com/ScriptKittyOS/kotiko.git && cd kotiko
git fetch --tags
git -c gpg.ssh.allowedSignersFile=.github/allowed_signers verify-tag v1.0.0
```

The output starts with `Good "git" signature for <maintainer>`. For a GPG-signed tag, import
the release keys first: `gpg --import .github/release-keys.asc`, then `git verify-tag v1.0.0`
shows "Good signature".

Then check that the signed tag carries this tag's name. The signature covers the tag object,
not the name you fetched it under, so a release candidate's signed object could be pushed
again as `v1.0.0`:

```sh
git cat-file tag v1.0.0 | sed -n '/^$/q; s/^tag //p'
```

This prints `v1.0.0`, the name you asked for. Anything else (for example `v1.0.0-rc.2`)
means the tag isn't the release the maintainer signed. The release workflow refuses such a
tag (`scripts/verify-tag.sh`).

Cross-check the key: its fingerprint should match MAINTAINERS.md and the signing keys on the
maintainer's GitHub profile (`https://github.com/<user>.keys` for SSH,
`https://github.com/<user>.gpg` for GPG). A key that appears only in the repository proves
less than one that also appears on the maintainer's profile.

## 2. The files

Download the files from the release page (or with `gh release download v1.0.0 --repo
ScriptKittyOS/kotiko`) into one folder, then:

```sh
sha256sum -c SHA256SUMS
gh attestation verify kotiko-chrome-1.0.0.zip --repo ScriptKittyOS/kotiko
gh attestation verify kotiko-firefox-1.0.0.zip --repo ScriptKittyOS/kotiko
gh attestation verify kotiko-server-1.0.0.cdx.json --repo ScriptKittyOS/kotiko
gh attestation verify SHA256SUMS --repo ScriptKittyOS/kotiko
```

`sha256sum -c` prints `OK` for every file. Each `gh attestation verify` prints
"Verification succeeded!" and shows the workflow (`.github/workflows/release.yml`) and the
tag (`refs/tags/v1.0.0`) it was built from. The attestation is a SLSA build provenance
statement signed through Sigstore with a short-lived certificate for that workflow run, so no
long-lived signing key exists anywhere. To be strict about the workflow and tag, add
`--signer-workflow ScriptKittyOS/kotiko/.github/workflows/release.yml --source-ref refs/tags/v1.0.0`.

You can go further and rebuild the zips yourself from the tag; they come out byte-identical.
See [reproducible-builds.md](reproducible-builds.md).

## 3. The store versions

Install Kotiko only from the store links in the [README](../README.md). The release workflow
uploads the two zips from the GitHub release to the stores unchanged, after checking each
against `SHA256SUMS` (Firefox Add-ons: `scripts/amo-submit.mjs`). The stores then sign what
they distribute, so the package you install isn't byte-identical to the zip: Firefox Add-ons
adds Mozilla's signature files (`META-INF/`) after review, and the Chrome Web Store
repackages the zip as a signed CRX. The extension's own files inside are the same. A zip from
somewhere else, loaded unpacked, gets none of these checks and no automatic updates.

## What the zips contain

Only files from the repository's `extension/` folder (minus developer tools listed in
`extension/.buildignore`), a manifest adjusted for each store (Chrome's has no
`background.scripts` or `browser_specific_settings`; Firefox's has no
`background.service_worker`), and the license texts (`LICENSE`, `NOTICE`, `LICENSES/`). No
third-party code, no minification, no bundling: reviewers and you read the same files as the
repository. The server's third-party dependencies are listed in the SBOM.
