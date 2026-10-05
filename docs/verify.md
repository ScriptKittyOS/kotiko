# Verifying a Kotiko release

Each release on GitHub has the two extension zips (the exact packages sent to the Chrome Web
Store and Firefox Add-ons), the server's SBOM (`kotiko-server-X.Y.Z.cdx.json`) and
`SHA256SUMS`. These steps check that what you downloaded was built by this repository's
release workflow from a tag a maintainer signed. Replace `0.3.0` with the version you have.

You need `git`, `sha256sum` (macOS: `shasum -a 256`) and the [GitHub CLI](https://cli.github.com/)
(`gh`, signed in to any GitHub account).

## 1. The tag

The release manager signs each tag with their own key, listed in `.github/allowed_signers`
(SSH) or `.github/release-keys.asc` (GPG), and in [MAINTAINERS.md](../MAINTAINERS.md).

```sh
git clone https://github.com/ScriptKittyOS/kotiko.git && cd kotiko
git fetch --tags
git -c gpg.ssh.allowedSignersFile=.github/allowed_signers verify-tag v0.3.0
```

The output starts with `Good "git" signature for <maintainer>`. For a GPG-signed tag, import
the release keys first: `gpg --import .github/release-keys.asc`, then `git verify-tag v0.3.0`
shows "Good signature".

Cross-check the key: its fingerprint should match MAINTAINERS.md and the signing keys on the
maintainer's GitHub profile (`https://github.com/<user>.keys` for SSH,
`https://github.com/<user>.gpg` for GPG). A key that appears only in the repository proves
less than one that also appears on the maintainer's profile.

## 2. The files

Download the files from the release page (or with `gh release download v0.3.0 --repo
ScriptKittyOS/kotiko`) into one folder, then:

```sh
sha256sum -c SHA256SUMS
gh attestation verify kotiko-chrome-0.3.0.zip --repo ScriptKittyOS/kotiko
gh attestation verify kotiko-firefox-0.3.0.zip --repo ScriptKittyOS/kotiko
gh attestation verify kotiko-server-0.3.0.cdx.json --repo ScriptKittyOS/kotiko
gh attestation verify SHA256SUMS --repo ScriptKittyOS/kotiko
```

`sha256sum -c` prints `OK` for every file. Each `gh attestation verify` prints
"Verification succeeded!" and shows the workflow (`.github/workflows/release.yml`) and the
tag (`refs/tags/v0.3.0`) it was built from. The attestation is a SLSA build provenance
statement signed through Sigstore with a short-lived certificate for that workflow run, so no
long-lived signing key exists anywhere. To be strict about the workflow and tag, add
`--signer-workflow ScriptKittyOS/kotiko/.github/workflows/release.yml --source-ref refs/tags/v0.3.0`.

You can go further and rebuild the zips yourself from the tag; they come out byte-identical.
See [reproducible-builds.md](reproducible-builds.md).

## 3. The store versions

Install Kotiko only from the store links in the [README](../README.md). The stores sign
what they distribute: Firefox Add-ons signs every add-on after review, and the Chrome Web
Store signs its packages. A zip from somewhere else, loaded unpacked, gets none of these
checks and no automatic updates.

## What the zips contain

Only files from the repository's `extension/` folder (minus developer tools listed in
`extension/.buildignore`), a manifest adjusted for each store (Chrome's has no
`background.scripts` or `browser_specific_settings`; Firefox's has no
`background.service_worker`), and the license texts (`LICENSE`, `NOTICE`, `LICENSES/`). No
third-party code, no minification, no bundling: reviewers and you read the same files as the
repository. The server's third-party dependencies are listed in the SBOM.
