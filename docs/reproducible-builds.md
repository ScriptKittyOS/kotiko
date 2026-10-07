# Reproducible builds

Anyone can rebuild a release's extension zips from its tag and get the same bytes as the
zips on the GitHub release, which are the files the release workflow uploads to the Chrome
Web Store and Firefox Add-ons. (The stores then sign what they distribute, which adds their
signature to the same files: [verify.md](verify.md#3-the-store-versions).) The release
workflow checks this on every release by building twice and comparing; this page is how you
check it yourself.

## Rebuild a release

You need git, Node.js 22.22.2 or newer (the repository's `engines`), and npm.

```sh
git clone https://github.com/ScriptKittyOS/kotiko.git && cd kotiko
git checkout v1.0.0
npm ci
node scripts/build-extension.mjs --version 1.0.0 --out dist/
cd dist
curl -LO https://github.com/ScriptKittyOS/kotiko/releases/download/v1.0.0/SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
```

Both `kotiko-chrome-1.0.0.zip` and `kotiko-firefox-1.0.0.zip` print `OK`. (`--ignore-missing`
skips the SBOM, which isn't reproducible: it records when it was made.) The build also runs
`web-ext lint` on the Firefox files; add `--skip-lint` to leave it out, which doesn't change
the zips.

On Windows, clone with Git's default settings: the repository's `.gitattributes` keeps every
text file's line endings as LF on checkout, so the files match.

## What is fixed

`scripts/build-extension.mjs` makes each zip from nothing but the files in the tagged commit:

- **Which files**: everything in `extension/` except dotfiles, `*.map`, editor leftovers and
  the patterns in `extension/.buildignore`, plus `LICENSE`, `NOTICE` and `LICENSES/`. A
  symlink stops the build.
- **Code only the tests use**: the lines between `// test-only: start` and
  `// test-only: end` in a script (the `globalThis.__kotiko` hook at the end of
  `background.js`) are left out of the zips, so a zip's `background.js` is the source file
  without them. A block left open, or `__kotiko` outside one, stops the build.
- **The manifests**: written from `extension/manifest.json` by fixed rules (Chrome drops
  Firefox's keys, Firefox drops `background.service_worker`), as JSON with two-space
  indentation.
- **Entry order**: sorted by path, comparing UTF-16 code units (not the locale's order).
- **Timestamps**: every entry gets the commit's time (`git log -1 --format=%ct`), stored in
  UTC; `SOURCE_DATE_EPOCH` or `--mtime` overrides it. Your clock and time zone don't matter.
- **Permissions**: every entry is a regular file with mode `0644`, made on Unix; no owner or
  group ids; no directory entries.
- **Compression**: deflate at level 9 by [fflate](https://github.com/101arrowz/fflate), a
  JavaScript library pinned in `package-lock.json`. It doesn't use Node's zlib, so the bytes
  don't depend on the Node version or the CPU (Node's zlib, from Chromium, picks its hashing
  by CPU features and can compress the same input differently on different machines).

What would change the bytes: a different commit, a different fflate version (a lockfile
change shows in the commit), or a change to the build script itself, which is in the tag too.

## The server

The server is released as source (the tag); [slice 40](../slices/40-server-packaging-docker/SPEC.md)
adds a release tarball and Docker image with their own reproducibility notes. Its
dependencies are pinned in `server/mix.lock` and listed per release in the CycloneDX SBOM
(`kotiko-server-X.Y.Z.cdx.json`, from `mix sbom.cyclonedx --only prod`).
