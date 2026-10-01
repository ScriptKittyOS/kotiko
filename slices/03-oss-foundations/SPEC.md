# 03 · Open-source foundations

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | S (a day or two) |
| **Depends on** | None |
| **Unblocks** | [30-release-pipeline](../30-release-pipeline/SPEC.md), [44-docs-site](../44-docs-site/SPEC.md); making the repository public |
| **Sources** | [04 S32, S33, section 3 "Release plan", section 4 Q1](../../docs/research/04-architecture-release.md); [04 S15 (version mismatch)](../../docs/research/04-architecture-release.md); [DECISIONS: License Apache-2.0; store publisher and contact; Not a product](../DECISIONS.md) |

## Problem

Mira is meant to be a free open-source tool, but legally and practically it isn't one yet.

- There is no LICENSE file, so all rights are reserved by default and nobody may reuse
  or redistribute the code ([04 S33](../../docs/research/04-architecture-release.md)).
  Read from the tree: the root holds only `README.md`, `.gitignore`, `extension/`,
  `server/`, `docs/`, `brand/` and `slices/`.
- There is no CONTRIBUTING, code of conduct, security policy, or issue and PR templates,
  so a first contributor has no idea how to run tests, how commits are written, or how to
  report a vulnerability privately.
- The version is defined twice and already disagrees: `extension/manifest.json:4` says
  0.2.0 and `server/mix.exs:7` says 0.1.0 ([04 S15](../../docs/research/04-architecture-release.md)).
- There is no CHANGELOG, although the history already follows Conventional Commits
  (`git log`: `feat(server): ...`, `fix(server)!: ...`), which a release tool can turn into one.
- The repository is private. Before it goes public the history must be checked for
  secrets; research 04 verified that `server/.env` was never committed
  (`git log --diff-filter=A`), so no rewrite is expected.

## Goals

- Apache-2.0 applied correctly: LICENSE, NOTICE, per-file SPDX identifiers, and a CI
  check that keeps it that way.
- Every community file a GitHub project is expected to have, written for this project.
- One version number for the whole repository, checked in CI.
- A CHANGELOG generated from commits from now on.
- A checklist that makes flipping the repository to public a safe, boring step.

## Non-goals

- Release automation, tags and store uploads: slice [30](../30-release-pipeline/SPEC.md),
  which consumes the version source defined here.
- CI workflows themselves: slice [02](../02-test-harness-and-ci/SPEC.md). This slice adds
  two small checks to it.
- The docs site: slice [44](../44-docs-site/SPEC.md). The privacy policy: slice [28](../28-privacy-and-store-readiness/SPEC.md).
- The rename: slice [04](../04-rename-to-mira/SPEC.md). Files here use the name Mira.

## User stories

- As a developer who found Mira on GitHub, I want to know at a glance that I may fork and
  reuse it, and under what terms.
- As a first-time contributor, I want one page that gets me from clone to green tests.
- As a security researcher, I want a private way to report a bug in the server's auth.
- As a learner reporting a wrong translation, I want an issue form that asks only what's
  needed and reminds me not to paste my API key.

## Specification

### 1. License (decided: Apache-2.0)

- **`LICENSE`** at the root: the unmodified Apache License 2.0 text from
  `https://www.apache.org/licenses/LICENSE-2.0.txt`, without the appendix filled in.
- **`NOTICE`** at the root. Apache-2.0 section 4(d) requires redistributors to carry it,
  so it holds only what must travel with copies:

  ```
  Mira
  Copyright 2026 ScriptKittyOS and the Mira contributors

  This product includes software developed by ScriptKittyOS
  (https://github.com/ScriptKittyOS).

  This product includes data derived from the Unicode Common Locale Data
  Repository (CLDR), Copyright © 1991-2026 Unicode, Inc., licensed under the
  Unicode License v3. See LICENSES/Unicode-3.0.txt.
  ```

  The CLDR entry is needed because `spec/languages.json` and `spec/lang-aliases.json`
  (slice 08) are generated from CLDR and ship inside the extension. Any later bundled
  third-party asset (for example Noto font subsets from slice 17, under OFL-1.1) adds a
  line here and its license text under `LICENSES/`.
- **`LICENSES/`** holds the full text of every license used in the repository:
  `Apache-2.0.txt`, `Unicode-3.0.txt`, plus `MIT.txt` for the vendored React builds in
  slice 02's test fixtures.
- **SPDX headers.** Every hand-written source file starts with two comment lines:

  ```
  # SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
  # SPDX-License-Identifier: Apache-2.0
  ```

  (`//` for JavaScript, `<!-- -->` for HTML, `/* */` for CSS.) Covered: `.ex`, `.exs`,
  `.js`, `.mjs`, `.sh`, `.css`, `.html`, `Dockerfile`, workflow `.yml`. Not covered by
  headers (they can't hold comments, or headers add noise): JSON, Markdown, images, the
  `extension/spec/` copies and fixtures. Those are declared in a root `REUSE.toml`
  (FSFE REUSE specification 3.3), for example:

  ```toml
  version = 1
  [[annotations]]
  path = ["**/*.json", "**/*.md", "brand/**", "extension/*.png"]
  SPDX-FileCopyrightText = "2026 ScriptKittyOS and the Mira contributors"
  SPDX-License-Identifier = "Apache-2.0"
  [[annotations]]
  path = ["spec/languages.json", "spec/lang-aliases.json", "extension/spec/languages.json", "extension/spec/lang-aliases.json"]
  SPDX-License-Identifier = "Apache-2.0 AND Unicode-3.0"
  ```

  The copyright line names the project, not individuals; contributors keep their own
  copyright (the git history records it). Generated files get the header from their
  generator. The year is the file's creation year and is not bumped yearly.
- **CI check**: `reuse lint` (run with `pipx run reuse lint`) in slice 02's `lint` job.
  A new file without a header or a `REUSE.toml` entry fails the build.
- `server/mix.exs` gets `licenses: ["Apache-2.0"]` in `package` metadata (harmless while
  not published to Hex), and `extension/manifest.json` needs nothing (stores ask separately).
- Badge in the README: license, CI status.

### 2. Contributor terms

**No CLA and no DCO sign-off requirement.** Contributions are accepted under
Apache-2.0 section 5 ("inbound = outbound"): anything intentionally submitted for
inclusion is licensed under the same terms, unless the contributor says otherwise.
CONTRIBUTING states this in two sentences. Rationale: a sign-off check is the most common
reason a first PR goes red for a non-code reason, and for a volunteer project with no
commercial relicensing plans section 5 already gives the project what it needs. If the
maintainers later want a DCO, it can be switched on with the DCO GitHub App without
changing the license.

### 3. Community files

All under `.github/` unless noted; written in plain language, no emojis.

- **`CONTRIBUTING.md`** (root):
  1. What Mira is and where decisions live (`slices/`, `DECISIONS.md`); "pick a slice,
     comment on its issue, open a PR".
  2. Setup: Elixir 1.15+ and Node 22, `cd server && mix deps.get && mix test`,
     `npm ci && npm test`, `npx playwright install chromium && npm run e2e`.
     Loading the unpacked extension.
  3. Rules that protect users: no `innerHTML` with word or page data (text-only rendering,
     [04 S21](../../docs/research/04-architecture-release.md)); no runtime npm dependencies
     in the extension and no bundler (keeps AMO review source-free); no user text in logs
     above debug; no external network in tests.
  3a. Rules that keep Mira working in every language: the cross-cutting checklist in
     [50](../50-ui-localization-and-base-language/SPEC.md) section 7, in short: no
     English-named base concepts (`gloss`, not `english`), every user-facing string
     through `MiraI18n.t()` with the English and Spanish text added together, language
     names from `Intl.DisplayNames`, never assume spaces between words, and examples and
     tests in at least two base languages.
  3b. Translating Mira: through Weblate (link), no Git needed; how to add a base
     language's data under `spec/lang/` (link to its README).
  4. Commits and PR titles in Conventional Commits (`feat(extension): ...`); scopes
     `server`, `extension`, `spec`, `docs`, `ci`, `release`. Breaking changes with `!`.
  5. Prompt or validator changes must include slice 09's eval summary.
  6. The contributor terms from section 2. Licensing of new files (SPDX header).
  7. Where to ask: GitHub Discussions.
- **Contact.** The project's general public contact (README, CONTRIBUTING, store listings
  per slice 30) is `hello@scriptkittyos.com`. Security and code-of-conduct reports go to
  `security@scriptkittyos.com` (maintainer decisions).
- **`CODE_OF_CONDUCT.md`** (root): Contributor Covenant 2.1, unmodified except the
  enforcement contact, `security@scriptkittyos.com`.
- **`SECURITY.md`** (root): supported versions (the latest minor release only, pre-1.0);
  report privately through GitHub's private vulnerability reporting ("Report a
  vulnerability" on the Security tab), which this slice switches on. Email fallback for
  people without a GitHub account: `security@scriptkittyos.com` (maintainer decision).
  GitHub's form stays the preferred channel. What to include;
  acknowledgement within 7 days and a fix or plan within 30; scope (server auth, token
  handling, extension pages, anything that runs on web pages) and out of scope (a
  self-hosted server deliberately exposed without a token, issues in Telegram or model
  providers themselves); credit in the release notes if wanted.
- **Issue forms** (`.github/ISSUE_TEMPLATE/*.yml`):
  - `bug.yml`: Mira version, browser and version, mode (local or server), what happened,
    what you expected, steps, optional site URL, a checkbox "I removed API keys and
    tokens from anything I pasted".
  - `wrong-word.yml`: what you typed, the language you were looking up, the language you
    read in (base language), what Mira saved, what it should be, model if known. Labelled `word-quality`; these feed slice 09's golden set.
  - `site-broken.yml`: URL, what broke, does "Pause on this site" fix it. Label `compat`.
  - `feature.yml`: problem first, then idea; link to an existing slice if there is one.
  - `config.yml`: `blank_issues_enabled: false`; links to Discussions (questions), the
    docs site (setup help), and the security policy.
- **`pull_request_template.md`**: what and why, linked slice or issue, checklist (tests
  added or updated; `mix format` and lint pass; UI changes include before and after
  screenshots in light and dark; new user-facing strings added in `en` and `es`; works
  for a non-English base language (slice 50's checklist); prompt changes include eval
  results; no new extension runtime dependency; user-facing change described for the
  changelog).
- **`CODEOWNERS`**: `* @ScriptKittyOS/mira-maintainers` (team to be created), so reviews
  are requested automatically.
- Root **`.editorconfig`** (UTF-8, LF, 2 spaces, final newline) and **`.gitattributes`**
  (`* text=auto eol=lf`, `*.png binary`), so Windows contributors don't produce CRLF diffs.

### 4. One version for everything

- **Source of truth**: `.release-please-manifest.json` (`{".": "0.2.0"}`), maintained by
  release-please (slice 30). Mira releases the extension and the server together with
  one SemVer version; the HTTP API has its own version (`/api/v1`, slice 07).
- `extension/manifest.json` `version` and `server/mix.exs` `version` are updated by
  release-please's `extra-files` (slice 30). In `mix.exs` the line carries the marker
  comment `# x-release-please-version`.
- **Now**: set `server/mix.exs` to `0.2.0` to match the manifest.
- **Check**: `scripts/check-versions.mjs` (no dependencies) reads all three and fails CI
  on any mismatch. The server exposes the version from `Application.spec(:mira, :vsn)`
  (slice 29's `/health`).
- Pre-1.0 policy, stated in CONTRIBUTING: a minor bump may break the HTTP API only with a
  legacy alias kept for one more minor version (slice 07's pattern).

### 5. CHANGELOG

- `CHANGELOG.md` at the root, generated by release-please from Conventional Commits
  (sections Features, Bug Fixes, Breaking Changes; `docs`, `ci`, `chore` hidden).
- Seeded by hand now with one entry summarising history before automation:
  "0.2.0 (2026-10-01): any language, mixed; add words from the popup; OpenRouter free
  models with fallback; deny-by-default API auth (security fix)." and "0.1.0: first
  version (Russian only, Telegram bot)."
- Release-please edits the file; humans edit only the release PR's text.

### 6. Going public checklist

Kept as `docs/PUBLIC_CHECKLIST.md` and ticked in the PR that flips visibility (slice 30
decides when: at the first store release):

1. LICENSE, NOTICE, REUSE pass; CONTRIBUTING, CODE_OF_CONDUCT, SECURITY present.
2. `gitleaks detect --log-opts="--all"` over the full history reports nothing (run once
   locally and as a one-off CI job); `server/.env` and any `*.db` never committed.
3. No personal data in fixtures or docs (real word lists, Telegram IDs, emails).
4. Repository settings: private vulnerability reporting on; Discussions on; Issues on;
   squash merge only with PR title as the commit message; branch protection on `main`
   requiring slice 02's checks and one review; Dependabot alerts on.
5. Description and topics set (`browser-extension`, `language-learning`, `vocabulary`,
   `elixir`, `self-hosted`, `firefox-addon`, `chrome-extension`).
6. A PR-title lint (`amannn/action-semantic-pull-request`, pinned by SHA) so squash
   commits stay conventional.

## Acceptance criteria

- [ ] `LICENSE` is the verbatim Apache-2.0 text; `NOTICE` and `LICENSES/` exist as above.
- [ ] `reuse lint` passes in CI and fails when a new `.ex` file lacks a header.
- [ ] CONTRIBUTING's setup steps work from a fresh clone on Linux (checked by a new
      contributor or in a clean container).
- [ ] The security policy's reporting link opens GitHub's private report form.
- [ ] Opening a new issue offers only the forms; the blank option is gone.
- [ ] `mix.exs` and `manifest.json` both say 0.2.0, and `check-versions.mjs` fails CI if
      either changes alone.
- [ ] `CHANGELOG.md` exists with the seeded entries.
- [ ] The going-public checklist exists and gitleaks reports no findings on full history.

## Test plan

- CI: `reuse lint`, `node scripts/check-versions.mjs` (slice 02's `lint` job).
- One-off: gitleaks over all refs; record the result in the checklist PR.
- Manual: render each issue form on GitHub; follow CONTRIBUTING in a clean
  `elixir:1.19` + Node 22 container.

## Rollout and migration

Can land immediately, before any other slice, while the repository is still private.
Adding SPDX headers to existing files is one mechanical commit (`chore: add SPDX
headers`), done before slice 04's rename so the rename diff stays readable; or after it,
if the rename lands first. No user-facing change; no changelog entry beyond the seed.

## Open questions

1. **Who reads `security@scriptkittyos.com`?** It receives security and conduct reports.
   Recommendation: make sure it reaches at least two people, so a report about a
   maintainer has somewhere to go.
2. **DCO.** Recommendation: none, as in section 2; revisit if a company asks to contribute
   large changes.
3. **Copyright holder wording.** Recommendation: "ScriptKittyOS and the Mira
   contributors", which needs no copyright assignment.

## Future work

- `GOVERNANCE.md` once there is more than one active maintainer.
- OpenSSF Scorecard workflow and badge.
- Translating CONTRIBUTING into Spanish once the docs site's i18n is in place (slices 44, 50).
- Issue forms in Spanish (GitHub forms are single-language; a second set of `*-es.yml`
  forms if Spanish-speaking reporters struggle).
