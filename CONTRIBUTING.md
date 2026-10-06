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
mix test            # or mix test --cover, with the coverage gate

# extension and end-to-end tests (from the repository root)
npm ci
npm test            # or npm run coverage, with the coverage gate
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
- How to run them is under [Setup](#setup); CI runs them on every pull request, and the
  release workflow runs them again on the tree it releases.

### Coverage gates

CI fails when coverage drops below these numbers, and prints them on every run:

| Part | Command | Gate |
|---|---|---|
| Extension | `npm run coverage` | 90 % of lines and 80 % of branches in `extension/` (Node's built-in coverage) |
| Server | `cd server && mix test --cover` | 90 % of lines (`test_coverage` in `server/mix.exs`; the helpers in `test/support` don't count) |

Elixir's cover tool counts lines, not branches, so the server has no branch number. The
server gate runs on the newest Elixir in the CI matrix only, because line counts differ a
little between compiler versions. A gate is never lowered; raise it when coverage grows.
Coverage comes from tests of behaviour: a test that only runs code without checking what
it does is not accepted.

### Property tests

Besides examples, both halves have property-based tests, which check a rule on many
generated inputs:

- Extension: [fast-check](https://fast-check.dev/) (a dev dependency) in
  `test/unit/properties/`, for the matcher, server address checks, the bulk list reader,
  the backup, casing, the word-list check and the policy page's Markdown.
- Server: StreamData in `server/test/**/*_property_test.exs`, for word validation and
  input preparation, the v1 routes, `.env` parsing, language tags, text cleaning, UUIDv7,
  log redaction and backups; shared generators are in `server/test/support/gen.ex`.

They run as part of `npm test` and `mix test`, so in CI and before every release. Each run
uses a new random seed. When one fails, it prints the seed and the smallest input it found;
replay it with `FC_SEED=<seed> FC_PATH=<path> npm test` (extension; `FC_NUM_RUNS=<n>`
tries more inputs) or `mix test --seed <seed>` (server). Fix the bug and add a plain
regression test with that input, so the case is checked on every run.

### Assertion mode

`npm test` and `npm run coverage` load `test/helpers/assert-mode.mjs`, which turns on the
extension's invariant checks in every test process, jsdom window and vm context: the
matcher checks each scan's matches, the backup each restore plan, and the word-list check
each filtered list, and they throw when an invariant breaks. The shipped extension never
turns them on, and `npm run perf` measures the code as it ships. Add a check to this mode
when a function makes a promise its callers rely on. The end-to-end tests run the real
extension, which has no way to turn the mode on.

## Commits and pull requests

- Code follows [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md); CI checks formatting
  and lint, so run `mix format`, `mix credo` and `npm run lint` before pushing.
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
