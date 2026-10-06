# Contributing to Kotiko

Kotiko swaps words on web pages, in your own language, for the words you're learning in any
other language. It's
a free, open-source project from ScriptKittyOS, and contributions are welcome.

## Where decisions live

The roadmap is in [`slices/`](slices/README.md): one folder per piece of work, each with a
`SPEC.md` written to the same template. Decisions already made are in
[`slices/DECISIONS.md`](slices/DECISIONS.md); please don't reopen them in a pull request.

To help: pick a slice, comment on its issue so others know, and open a pull request.

## Setup

You need Elixir 1.15 or newer and Node 22.

```bash
# server
cd server
mix deps.get
mix test

# extension and end-to-end tests (from the repository root)
npm ci
npm test
npx playwright install chromium
npm run e2e
```

To try the extension, open `chrome://extensions`, turn on Developer mode, choose
**Load unpacked** and pick the `extension` folder. Running the server is covered at
[kotiko.org/server](https://kotiko.org/server/), and everything else, including the docs
site in `site/` (its own `package.json`, build and tests), in
[Developer setup](https://kotiko.org/contribute/setup/).

## Rules that protect users

- **Text only.** Never put word data or page content into `innerHTML` or similar; use
  `textContent` and DOM methods. ESLint enforces this.
- **No runtime npm dependencies and no bundler in the extension.** What's in `extension/`
  is what ships, so store reviewers can read it as is.
- **No user text in logs** above debug level: no words, no page content, no keys.
- **No secrets in the repository.** Keys, tokens and `.env` files stay out of git:
  `.gitignore` covers them anywhere in the tree, and CI's required `secrets` job fails a pull
  request that adds `.env`, database, key or token files or files over 10 MB, even in a
  commit it later undoes (`scripts/check-forbidden-files.mjs`; GitHub's push rulesets work
  only on private repositories), and runs gitleaks over the full history (`.gitleaks.toml`). Write test keys as obvious placeholders containing
  `0123456789` (for example `sk-or-v1-0123456789abcdef…`) so the scan knows they're fake.
- **No external network in tests.** Tests serve their own pages and fake servers.
- **One name.** `node scripts/check-old-name.mjs` (run in CI) fails on the project's names
  from before Kotiko outside history, research and the code that moves old data; mark a
  line that must name them with a `legacy-name-ok` comment.

## Tests

- Every pull request that adds or changes behaviour adds or updates automated tests in
  the same pull request. Major new functionality is not merged without tests.
- Every bug fix adds a regression test that fails without the fix. If that isn't
  practical, say why in the pull request; a maintainer has to agree.
- Tests never use the network: the server stubs HTTP with `Req.Test`, and the extension
  tests serve their own pages.
- How to run them is under [Setup](#setup); CI runs them on every pull request.

## Commits and pull requests

- Code follows [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md); CI checks formatting
  and lint, so run `mix format`, `mix credo --strict` and `npm run lint` before pushing
  (`npm run lint:fix` fixes the JavaScript layout).
- CI scans the dependencies (OSV-Scanner, `mix deps.audit`) and the code (Sobelow,
  CodeQL) for security problems. What fails a pull request, the licenses a new dependency
  may have, and how to accept a false positive are in the
  [dependency and static analysis policy](docs/security/dependency-and-static-analysis-policy.md).
- Maintainers review every pull request; how decisions are made and who maintains what is
  in [GOVERNANCE.md](GOVERNANCE.md) and [MAINTAINERS.md](MAINTAINERS.md).
- Commit messages and pull request titles follow
  [Conventional Commits](https://www.conventionalcommits.org/): `feat(extension): ...`,
  `fix(server): ...`. Scopes: `server`, `extension`, `spec`, `docs`, `ci`, `release`.
  Mark breaking changes with `!`.
- Changes to the model prompt or validation include the evaluation summary for at least two
  models from [slice 09](slices/09-shared-word-spec-and-prompt/SPEC.md)'s runner (how to run
  it within the free quota: [spec/eval/README.md](spec/eval/README.md)).
- Before 1.0, a minor release may change the HTTP API only if the old route keeps working
  for one more minor version.

## Licensing and sign-off

Kotiko is licensed under [Apache-2.0](LICENSE). By submitting a contribution, you license it
under the same terms (section 5 of the license). There is no CLA.

### Developer Certificate of Origin

Every commit must be signed off: a `Signed-off-by:` line with your name and the email of the
commit's author. It certifies the [Developer Certificate of Origin 1.1](https://developercertificate.org/):
that you wrote the change, or otherwise have the right to submit it under the project's
license. Git adds the line for you:

```
git commit -s
```

CI's required `secrets` job checks every commit of a pull request
(`scripts/check-dco.mjs`). If it fails, add the sign-off to every commit of your branch and
push again:

```
git rebase --signoff main
git push --force-with-lease
```

Bots (Dependabot, release-please) and merge commits are exempt. Use your real name or the
name you're known by; anonymous sign-offs can't be accepted.

New source files start with an SPDX header:

```
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0
```

(`#` for Elixir and shell, `<!-- -->` for HTML, `/* */` for CSS.) Files that can't hold
comments, such as JSON and images, are covered by `REUSE.toml`.

The logo and illustrations in `brand/` are the project's trademark and aren't covered by
the code license.

## Questions

Ask in GitHub Discussions. For security issues, see [SECURITY.md](SECURITY.md).
