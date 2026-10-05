# OpenSSF Best Practices answers

Last reviewed: 2026-10-05.

Kotiko's answers to the [OpenSSF Best Practices badge](https://www.bestpractices.dev)
criteria, kept in the repository so the claims sit next to the code that backs them. The
form on bestpractices.dev is filled from this file; an answer changes here first, by pull
request, then on the form. The plan behind it is slice
[53](../slices/53-openssf-best-practices/SPEC.md).

- **Entry:** not created yet. It is created on the day the repository goes public
  (slice 53 section 7); a private repository can't earn the badge.
- **Criteria version:** the passing criteria as published on
  <https://www.bestpractices.dev/en/criteria/0>, read on 2026-10-05 (67 criteria: 43 MUST,
  10 SHOULD, 14 SUGGESTED, none obsolete). Source of the text:
  [`criteria/criteria.yml`](https://github.com/ossf/best-practices-badge/blob/main/criteria/criteria.yml)
  in the badge's repository.
- **Who keeps it current:** the lead maintainer, as described in [GOVERNANCE.md](../GOVERNANCE.md)
  and slice 53 section 7.6: at every minor release, every six months (January and July),
  when the criteria change, and within 30 days of an answer becoming untrue.

## How to read the tables

| Status | Meaning | Answer on the form |
|---|---|---|
| **Met** | True today; the evidence is in the repository | Met |
| **Met†** | The repository content satisfies it, but it can only be seen and counted once the repository is public (and, where the "Needs" column says so, once a setting is turned on) | Met |
| **Unmet** | Not satisfied; "Needs" says what and who | Unmet, with the text given |
| **N/A** | Doesn't apply; the text says why | N/A, with the text given |

- "Answer" is the text to paste into the form's justification box. Where the form requires a
  URL ("Met URL"), the answer contains one. All URLs use the final repository
  `https://github.com/ScriptKittyOS/kotiko` and resolve once it is public.
- "Evidence" is where a reviewer can check the claim in this repository (path and line on
  the day of review) or a command to rerun.
- Form requirements from the criteria: **[URL]** a Met answer needs a URL; **[J]** a Met
  answer needs a justification; **[N/A J]** an N/A answer needs a justification.

## Passing: summary

| | Met | Met† | Unmet | N/A | Total |
|---|---|---|---|---|---|
| MUST | 25 | 13 | 1 | 4 | 43 |
| SHOULD | 7 | 3 | 0 | 0 | 10 |
| SUGGESTED | 9 | 0 | 4 | 1 | 14 |
| **All** | **41** | **16** | **5** | **5** | **67** |

Passing needs every MUST met or N/A, every SHOULD met or explained, and every SUGGESTED
answered. The one MUST left is `repo_public`. The four unmet SUGGESTED criteria don't block
passing.

What has to happen before the badge, and who does it:

| Item | Criteria | Who |
|---|---|---|
| Make `ScriptKittyOS/kotiko` public (going-public checklist, [PUBLIC_CHECKLIST.md](PUBLIC_CHECKLIST.md)) | `repo_public`, and every Met† | Maintainer, at the first release (slice 30) |
| Turn on private vulnerability reporting, Issues and Discussions (checklist item 4) | `vulnerability_report_private`, `discussion` | Maintainer |
| Make `security@scriptkittyos.com` reach at least two people (checklist item 7) | `vulnerability_report_private`, silver `vulnerability_response_process` | Maintainer |
| Create the entry on bestpractices.dev, fill it from this file, add the README badge (checklist item 8) | All | Maintainer |
| Release tags (`v0.3.0` and on) | `version_tags` (SUGGESTED) | Slice 30's release pipeline |

## Passing: Basics

| Criterion | Level | Status | Answer | Evidence | Needs |
|---|---|---|---|---|---|
| `description_good` | MUST | Met† | The README's first paragraph says what Kotiko does: learn a word in any language and it replaces its equivalent on the web pages you read. https://github.com/ScriptKittyOS/kotiko#readme | `README.md:10-12` | Public repository. The README still says words replace "English"; slice 50 rewords it for every base language |
| `interact` | MUST | Met† | Obtain: README "Setup" (https://github.com/ScriptKittyOS/kotiko#setup-about-10-minutes). Feedback: issue forms for bugs, ideas, broken sites and wrong words (https://github.com/ScriptKittyOS/kotiko/issues/new/choose), security reports per SECURITY.md. Contribute: https://github.com/ScriptKittyOS/kotiko/blob/main/CONTRIBUTING.md | `README.md:28-81`; `.github/ISSUE_TEMPLATE/bug.yml`, `feature.yml`, `site-broken.yml`, `wrong-word.yml`, `config.yml`; `CONTRIBUTING.md:1-13` | Public repository |
| `contribution` | MUST [URL] | Met† | Contributions are GitHub pull requests: pick a slice or issue, comment on it, open a pull request; maintainers review it. https://github.com/ScriptKittyOS/kotiko/blob/main/CONTRIBUTING.md | `CONTRIBUTING.md:13`, `CONTRIBUTING.md:58-73` | Public repository |
| `contribution_requirements` | SHOULD [URL] | Met† | CONTRIBUTING.md lists the requirements: rules that protect users, tests with every change and a regression test with every fix, Conventional Commits, SPDX headers, and the coding standards in docs/CODING_STANDARDS.md. https://github.com/ScriptKittyOS/kotiko/blob/main/CONTRIBUTING.md | `CONTRIBUTING.md:36-73`; `docs/CODING_STANDARDS.md` | Public repository |
| `floss_license` | MUST | Met | Apache-2.0. | `LICENSE`; `README.md:329-334` | – |
| `floss_license_osi` | SUGGESTED | Met | Apache-2.0 is OSI-approved. | `LICENSE` | – |
| `license_location` | MUST [URL] | Met | https://github.com/ScriptKittyOS/kotiko/blob/main/LICENSE (plus LICENSES/ and REUSE.toml for per-file licensing). | `LICENSE`; `LICENSES/`; `REUSE.toml` | URL resolves once public |
| `documentation_basics` | MUST [N/A J] | Met† | The README covers installing the server and extension, starting them, using them (adding words, choosing languages, the Telegram bot), updating, and troubleshooting. Using it securely: the server listens on localhost only by default, the README explains the plain-HTTP risk of other addresses (https://github.com/ScriptKittyOS/kotiko#browse-on-another-machine), and docs/security/requirements.md says what is and isn't protected. | `README.md:28-283` (security: `README.md:242-253`); `docs/security/requirements.md` | Public repository |
| `documentation_interface` | MUST [N/A J] | Met† | The server's HTTP API (every route, field, limit, status code and error) and every setting are documented in https://github.com/ScriptKittyOS/kotiko/tree/main/docs/reference ; a test fails when a route or setting is missing from them. The extension's interface is its UI and the Telegram bot's commands, described in the README; the word record is the JSON schema spec/word.schema.json. | `docs/reference/http-api.md`; `docs/reference/configuration.md`; `server/test/kotiko/docs_test.exs`; `README.md:85-139`; `spec/word.schema.json` | Public repository |
| `sites_https` | MUST | Met | The project site and repository are https://github.com/ScriptKittyOS/kotiko (GitHub serves HTTPS only). There are no other download sites yet; store packages (slice 30) come over HTTPS from the Chrome Web Store and addons.mozilla.org. | Repository URL | – |
| `discussion` | MUST | Met† | GitHub issues and pull requests (searchable, addressable by URL, open to anyone with a free account, no proprietary client). GitHub Discussions for questions. https://github.com/ScriptKittyOS/kotiko/issues | 29 pull requests so far (`gh pr list --state all`); `.github/ISSUE_TEMPLATE/config.yml` | Public repository; maintainer turns Discussions on (checklist item 4; it is off today) |
| `english` | SHOULD | Met | All documentation, issue forms and code comments are in English; reports in English are welcome. | `README.md`; `CONTRIBUTING.md`; `.github/ISSUE_TEMPLATE/` | – |
| `maintained` | MUST | Met | Actively developed: over 100 commits and 29 pull requests since 2026-10-01. | `git log`; `gh pr list --state all` | – |

## Passing: Change control

| Criterion | Level | Status | Answer | Evidence | Needs |
|---|---|---|---|---|---|
| `repo_public` | MUST | Unmet | (When met:) https://github.com/ScriptKittyOS/kotiko | `gh repo view --json visibility` says `PRIVATE` | Maintainer makes the repository public (going-public checklist, at slice 30's first release) |
| `repo_track` | MUST | Met | git records every change with its author and date. https://github.com/ScriptKittyOS/kotiko/commits/main | `git log` | – |
| `repo_interim` | MUST | Met | Every change lands through a pull request with its interim commits, not only releases. https://github.com/ScriptKittyOS/kotiko/pulls?q=is%3Apr | `git log --merges` (31 merges) | – |
| `repo_distributed` | SUGGESTED | Met | git. | – | – |
| `version_unique` | MUST | Met | Each release has a SemVer version (0.1.0, 0.2.0) kept identical in the server, the extension manifest and the release manifest; CI fails if they differ. | `server/mix.exs:11`; `extension/manifest.json:5`; `.release-please-manifest.json`; `scripts/check-versions.mjs` (CI job "versions and licenses") | – |
| `version_semver` | SUGGESTED | Met | Semantic Versioning; release-please derives versions from Conventional Commits. | `CHANGELOG.md:126,134`; `.release-please-manifest.json` | – |
| `version_tags` | SUGGESTED | Unmet | No release has been tagged yet. The release pipeline (release-please) will tag every release from the next one. | `git tag` is empty | Slice 30 |
| `release_notes` | MUST [URL] [N/A J] | Met† | Human-readable release notes for every release, written for users, not a git log: https://github.com/ScriptKittyOS/kotiko/blob/main/CHANGELOG.md | `CHANGELOG.md:6-135` | Public repository |
| `release_notes_vulns` | MUST [N/A J] | N/A | No publicly known vulnerability (with a CVE or similar) has been fixed in a release. The one security fix so far (0.2.0, an authentication bypass found by our own review) was never public; the 0.2.0 notes still name it. Future notes list every advisory and CVE (SECURITY.md, "What happens after you report", step 6). | `CHANGELOG.md:131-132`; `SECURITY.md:25-49` | – |

## Passing: Reporting

| Criterion | Level | Status | Answer | Evidence | Needs |
|---|---|---|---|---|---|
| `report_process` | MUST [URL] | Met† | Bugs are reported as GitHub issues, with a bug form: https://github.com/ScriptKittyOS/kotiko/issues/new/choose | `.github/ISSUE_TEMPLATE/bug.yml`, `site-broken.yml`, `wrong-word.yml` | Public repository |
| `report_tracker` | SHOULD | Met† | GitHub Issues. https://github.com/ScriptKittyOS/kotiko/issues | `.github/ISSUE_TEMPLATE/` | Public repository |
| `report_responses` | MUST | Met† | No bug reports from outside the project so far. Maintainers take a weekly triage turn: every new issue gets a label and a first response within 7 days (GOVERNANCE.md). | `GOVERNANCE.md` (Roles, Maintainer); `gh issue list --state all` is empty | Public repository; then keep answering within 7 days |
| `enhancement_responses` | SHOULD | Met† | No enhancement requests from outside the project so far; the same 7-day triage applies (GOVERNANCE.md). | As above | As above |
| `report_archive` | MUST [URL] | Met† | GitHub Issues keeps every report and reply, searchable: https://github.com/ScriptKittyOS/kotiko/issues?q=is%3Aissue | – | Public repository |
| `vulnerability_report_process` | MUST [URL] | Met† | https://github.com/ScriptKittyOS/kotiko/blob/main/SECURITY.md | `SECURITY.md:7-23` | Public repository |
| `vulnerability_report_private` | MUST [URL] | Met† | Report privately through GitHub's private vulnerability reporting (HTTPS) or by email to security@scriptkittyos.com: https://github.com/ScriptKittyOS/kotiko/blob/main/SECURITY.md | `SECURITY.md:9-13`; `.github/ISSUE_TEMPLATE/config.yml:6-8` | Maintainer turns on private vulnerability reporting once public (GitHub offers it only on public repositories) and makes `security@` reach two people |
| `vulnerability_report_response` | MUST | N/A | No vulnerability reports received in the last 6 months. SECURITY.md commits to acknowledging within 7 days. | `SECURITY.md:22,27-28` | – |

## Passing: Quality

| Criterion | Level | Status | Answer | Evidence | Needs |
|---|---|---|---|---|---|
| `build` | MUST | Met | The server is built with Mix (`mix compile`, run by `server/run.sh`); dependencies are pinned in mix.lock. The extension runs from source with no build step. | `server/mix.exs`; `server/run.sh`; CI job "server" | – |
| `build_common_tools` | SUGGESTED | Met | Mix (Elixir's standard build tool) and npm for development tools. | `server/mix.exs`; `package.json` | – |
| `build_floss_tools` | SHOULD | Met | Elixir, Erlang/OTP, Mix, Node.js and npm are all FLOSS. | – | – |
| `test` | MUST | Met | ExUnit tests for the server, Node's built-in test runner for the extension (unit, DOM and background suites) and Playwright end-to-end tests, all in the repository under Apache-2.0. How to run them: CONTRIBUTING.md "Setup"; CI runs them on every pull request. | `server/test/`; `test/`; `CONTRIBUTING.md:15-34`; `.github/workflows/ci.yml` | – |
| `test_invocation` | SHOULD | Met | `mix test` (server) and `npm test` (extension), the standard commands of each ecosystem. | `package.json` `scripts.test`; `CONTRIBUTING.md:20-30` | – |
| `test_most` | SUGGESTED | Met | Measured 2026-10-05: the server tests cover 86.7 % of executable lines (Elixir's cover tool, test helpers excluded) and the extension tests 91.6 % of lines and 78.6 % of branches of the extension code they load (all but one small file). | `cd server && mix test --cover`; `node --test --experimental-test-coverage --test-coverage-include='extension/**' 'test/{unit,dom,bg}/**/*.test.mjs'` | A coverage gate in CI is planned (slice 02 addition) |
| `test_continuous_integration` | SUGGESTED | Met | GitHub Actions runs every test suite, the linters and the audits on every push to main and every pull request. | `.github/workflows/ci.yml` | – |
| `test_policy` | MUST | Met | Every pull request that adds or changes behaviour adds or updates automated tests in the same pull request; every bug fix adds a regression test (CONTRIBUTING.md "Tests"). | `CONTRIBUTING.md:48-56`; `.github/pull_request_template.md` | – |
| `tests_are_added` | MUST | Met | The most recent major features came with tests, for example bulk add (commit ff493a9: unit, DOM, end-to-end and performance tests) and the add-flow language controls (953cc04: background, DOM and end-to-end tests). | `git show --stat ff493a9 953cc04` | – |
| `tests_documented_added` | SUGGESTED | Met | Documented in CONTRIBUTING.md "Tests" and in the pull request template's checklist. | `CONTRIBUTING.md:48-56`; `.github/pull_request_template.md:9-10` | – |
| `warnings` | MUST | Met | The server compiles with `--warnings-as-errors` on the oldest and newest supported Elixir; Credo, ESLint (with eslint-plugin-no-unsanitized), web-ext lint and ShellCheck run in CI. | `.github/workflows/ci.yml` (jobs server, extension, shell); `eslint.config.js` | – |
| `warnings_fixed` | MUST | Met | CI fails on any compiler warning and any Credo, ESLint or ShellCheck finding. web-ext lint reports two known warnings: Firefox ignores the Chrome service-worker key (intended: the manifest lists both forms), and the Firefox data-collection key is missing (added by slice 28). | `npm run lint`: 0 errors, 2 warnings | Slice 28 adds `data_collection_permissions` |
| `warnings_strict` | SUGGESTED | Unmet | We compile with warnings as errors and ESLint reports unused disable directives as errors, but Credo doesn't yet run in strict mode and ESLint uses the recommended set. Credo `--strict` and stricter ESLint rules are planned (slice 02 addition). | `.github/workflows/ci.yml`; `eslint.config.js` | Slice 02 addition (Credo strict) |

## Passing: Security

| Criterion | Level | Status | Answer | Evidence | Needs |
|---|---|---|---|---|---|
| `know_secure_design` | MUST | Met | The lead maintainer applies the Saltzer and Schroeder principles plus limited attack surface and allowlist input validation; how each is applied is written down in docs/security/assurance-case.md section 4 (for example deny-by-default authentication, loopback bind, one auth plug before routing). | `docs/security/assurance-case.md`; `server/lib/kotiko/router.ex` (`authorize/2`) | – |
| `know_common_errors` | MUST | Met | The common weaknesses for this kind of software and how each is countered (XSS, SQL injection, command injection, path traversal, missing authentication, CSRF, SSRF, unsafe deserialization, resource exhaustion, secrets in logs, DNS rebinding, supply chain) are listed in docs/security/assurance-case.md section 5; the adversarial review in docs/research/06-adversarial-qa.md drove the fixes. | `docs/security/assurance-case.md`; `docs/research/06-adversarial-qa.md` | – |
| `crypto_published` | MUST | Met | Kotiko implements no cryptography. It relies on TLS (Erlang/OTP's `ssl` for the server's outbound requests, the browser for the extension), SHA-256, and the operating system's and browser's secure random sources. | `server/lib/kotiko/token.ex:59`; `server/lib/kotiko/llm/cache.ex:26`; `extension/lib/pkce.js:33-35` | – |
| `crypto_call` | SHOULD | Met | Only library calls: Erlang `:crypto`, `Plug.Crypto.secure_compare`, OTP `ssl`, and the browser's Web Crypto API. | Same; `server/lib/kotiko/router.ex:208` | – |
| `crypto_floss` | MUST | Met | Erlang/OTP (`crypto`, `ssl`, built on OpenSSL) and the Web Crypto API (implemented by Firefox and Chromium) are FLOSS. | – | – |
| `crypto_keylength` | MUST | Met | By default Kotiko's secrets are 256-bit: the server generates the API token from 32 random bytes. A token the person sets themselves must be at least 24 characters, and the server suggests `openssl rand -hex 24` (192 bits). Hashes are SHA-256. TLS key exchange and lengths are left to Erlang/OTP's and the browser's defaults; Kotiko offers no setting that weakens them. | `server/lib/kotiko/token.ex:11,59`; `server/lib/kotiko/config.ex` (`api_token/1`) | – |
| `crypto_working` | MUST | Met | No MD4, MD5, DES, RC4, ECB or disabled certificate checks in Kotiko's code. | `grep -rniE "md5\|md4\|rc4\|:des\b\|verify_none\|\becb\b" server/lib server/config extension --include=*.ex --include=*.exs --include=*.js` finds nothing (2026-10-05) | – |
| `crypto_weaknesses` | SHOULD | Met | No SHA-1 or other weak algorithms or modes in Kotiko's code; SHA-256 is used where a hash is needed. | `grep -rniE "sha1\|sha-1" server/lib extension --include=*.ex --include=*.js` finds nothing (2026-10-05) | – |
| `crypto_pfs` | SHOULD | Met | Kotiko negotiates no keys itself. Its TLS connections use Erlang/OTP (TLS 1.3 and 1.2 by default from OTP 26, the oldest supported) and the browser, which use forward-secret key exchange (TLS 1.3 always; ECDHE for TLS 1.2). | `.github/workflows/ci.yml` (OTP 26.2 and 28.1) | – |
| `crypto_password_storage` | MUST | N/A | Kotiko has no user passwords. The server is protected by one random API token (bearer token) and compares it in constant time; there are no user accounts. | `server/lib/kotiko/router.ex:203-213`; `server/lib/kotiko/token.ex` | – |
| `crypto_random` | MUST | Met | Tokens, ids and nonces come from cryptographically secure generators: `:crypto.strong_rand_bytes` on the server, `crypto.getRandomValues` and `crypto.randomUUID` in the extension (including the PKCE verifier). `Math.random` is used only for non-secret values (instance labels, confetti). | `server/lib/kotiko/token.ex:59`; `server/lib/kotiko/uuid7.ex:19`; `extension/lib/pkce.js:33`; `extension/lib/store.js:83`; `extension/content.js:449`, `extension/lib/word-source.js:53` (non-secret) | – |
| `delivery_mitm` | MUST | Met† | The source is delivered from GitHub over HTTPS (git over HTTPS or SSH). Store packages (from slice 30) are signed and delivered over HTTPS by the Chrome Web Store and addons.mozilla.org. | Repository URL | Public repository |
| `delivery_unsigned` | MUST | Met | No hashes are published or fetched over HTTP. | – | – |
| `vulnerabilities_fixed_60_days` | MUST | Met | No unpatched vulnerabilities of medium or higher severity are publicly known. `mix deps.audit` and `mix hex.audit` run on every pull request. | `.github/workflows/ci.yml` | – |
| `vulnerabilities_critical_fixed` | SHOULD | Met | The one serious issue found so far, an authentication bypass through encoded paths, was fixed the day it was found (commit 4705cb0, 2026-10-01) and has regression tests. | `slices/DECISIONS.md` ("Encoded-path auth bypass fixed immediately"); `server/test/kotiko/router_auth_test.exs` | – |
| `no_leaked_credentials` | MUST | Met | No valid credentials are in the repository or its history. gitleaks over the full history (2026-10-05) found only placeholder keys in tests. | `gitleaks detect --redact --log-opts="--all"`: 8 findings, all fake test keys in `test/dom/welcome.test.mjs`, `test/bg/local-mode.test.mjs`, `test/unit/llm-client.test.mjs` and server tests (`boot_test.exs`, `redact_test.exs`) | A gitleaks job in CI is planned (slice 02 addition) |

## Passing: Analysis

| Criterion | Level | Status | Answer | Evidence | Needs |
|---|---|---|---|---|---|
| `static_analysis` | MUST [J] [N/A J] | Met | Credo (Elixir), ESLint with eslint-plugin-no-unsanitized and web-ext lint (JavaScript and the extension), and ShellCheck (shell) run on every push and pull request, so on every release candidate. | `.github/workflows/ci.yml`; `eslint.config.js`; `server/.credo.exs` | – |
| `static_analysis_common_vulnerabilities` | SUGGESTED | Met | eslint-plugin-no-unsanitized looks for DOM cross-site scripting, and ESLint bans `innerHTML`, `outerHTML` and `insertAdjacentHTML`; web-ext lint flags unsafe extension patterns. A security analyser for Elixir (Sobelow) is planned. | `eslint.config.js:8-13,39-43` | Slice 02 addition (Sobelow, CodeQL) |
| `static_analysis_fixed` | MUST | Met | No static analysis finding is open: CI fails on any, and pull requests are merged only when CI passes. None so far was an exploitable vulnerability. | `.github/workflows/ci.yml` | – |
| `static_analysis_often` | SUGGESTED | Met | On every push to main and every pull request. | `.github/workflows/ci.yml:5-8` | – |
| `dynamic_analysis` | SUGGESTED | Unmet | Not yet: there is no fuzzer or scanner. The tests run the real server and extension (including end-to-end tests against the real server), and property-based tests (StreamData) vary inputs for two parsers, but that is not yet a dynamic analysis of each release. Planned: property tests for the parsers and matcher, or a ZAP baseline scan. | `server/test/kotiko/word_test.exs`, `server/test/kotiko/text_test.exs` (`property`) | Slice 53 section 8 (gold groundwork) |
| `dynamic_analysis_unsafe` | SUGGESTED | N/A | Kotiko is written in Elixir and JavaScript, which are memory-safe. | – | – |
| `dynamic_analysis_enable_assertions` | SUGGESTED | Unmet | The tests assert heavily, but there is no assertion-enabled build or test mode yet. | – | Slice 53 section 8 |
| `dynamic_analysis_fixed` | MUST | N/A | No dynamic analysis tool is run yet, so none has reported a vulnerability. | – | – |

## Silver: where things stand

Silver is the next goal (slice 53 sections 3 to 5). Its form is filled once passing is
earned. Status on this branch, for planning; "Met†" as above.

| Criterion | Status | Evidence or what is needed |
|---|---|---|
| `achieve_passing` | Unmet | The passing badge |
| `contribution_requirements` | Met† | `CONTRIBUTING.md`; `docs/CODING_STANDARDS.md` |
| `dco` (SHOULD) | Unmet, justified | Slice 53 section 6, open question 1 (recommended: keep "inbound = outbound", explain) |
| `governance` | Met† | `GOVERNANCE.md` |
| `code_of_conduct` | Met† | `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1) |
| `roles_responsibilities` | Met† | `GOVERNANCE.md` (Roles); `MAINTAINERS.md`; `.github/CODEOWNERS` |
| `access_continuity` | Unmet | Name a steward, give them owner and recovery access, run the first check (`docs/governance/continuity.md`); maintainer |
| `bus_factor` (SHOULD) | Unmet, justified | One maintainer; text in slice 53 section 4.4 |
| `documentation_roadmap` | Met† | `ROADMAP.md` |
| `documentation_architecture` | Met† | `docs/ARCHITECTURE.md` |
| `documentation_security` | Met† | `docs/security/requirements.md` |
| `documentation_quick_start` | Met† | `README.md` "Setup (about 10 minutes)" |
| `assurance_case` | Met† | `docs/security/assurance-case.md` |
| `documentation_current` | Unmet | Known defects to fix: README says words replace "English" and that `_locales/` holds English and Spanish (slice 50); the process is in place (PR template docs box) |
| `documentation_achievements` | Unmet | The badge in the README (slice 53 section 7.4) |
| `accessibility_best_practices` (SHOULD) | Not assessed here | Slice 27 |
| `internationalization` (SHOULD) | To verify | Interface strings are in `extension/_locales/` and checked by `test/unit/i18n.test.mjs`; confirm at silver time (slice 50) |
| `sites_password_security` | N/A | The project runs no site that stores passwords |
| `maintenance_or_update` | Unmet | A published compatibility and upgrade policy (slice 30 addition, slice 44) |
| `report_tracker` | Met† | GitHub Issues |
| `vulnerability_report_credit` | N/A | No outside reports resolved yet; `SECURITY.md` promises credit |
| `vulnerability_response_process` | Met† | `SECURITY.md` "What happens after you report" |
| `coding_standards` | Met† | `docs/CODING_STANDARDS.md` |
| `coding_standards_enforced` | Unmet | No JavaScript formatter in CI yet (slice 53 open question 4; slice 02 addition) |
| `build_standard_variables` | N/A | No native code is built |
| `build_preserve_debug` (SHOULD) | Met | `mix compile` keeps debug information |
| `build_non_recursive` | Met | One Mix project; the extension isn't built |
| `build_repeatable` | Unmet | Slices 30 and 40 |
| `installation_common` | Unmet | Store packages (slice 30); Docker, releases and uninstall (slice 40) |
| `installation_standard_variables` | N/A | No POSIX-prefix installation |
| `installation_development_quick` | Met | `CONTRIBUTING.md` "Setup" |
| `external_dependencies` | Met | `server/mix.lock`, `package-lock.json`; services in `docs/ARCHITECTURE.md` section 6; SBOM per release planned (slice 30) |
| `dependency_monitoring` | Unmet | npm isn't audited in CI and Dependabot alerts are off (slice 02 addition; going-public checklist) |
| `updateable_reused_components` | Met | Hex and npm lockfiles; nothing vendored |
| `interfaces_current` (SHOULD) | Met | Manifest V3; current Elixir and OTP in CI |
| `automated_integration_testing` | Met | `.github/workflows/ci.yml` |
| `regression_tests_added50` | Met | `node scripts/regression-audit.mjs` (2026-10-05): 8 of 12 fixes changed a test in the same commit (67 %); the other four got tests in later commits |
| `test_statement_coverage80` | Met by measurement | 86.7 % server, 91.6 % extension (see `test_most`); an 80 % CI gate is planned (slice 02 addition) |
| `test_policy_mandated` | Met† | `CONTRIBUTING.md` "Tests" |
| `tests_documented_added` | Met† | Same |
| `warnings_strict` | Unmet | Credo strict (slice 02 addition) |
| `implement_secure_design` | Partly | `docs/security/assurance-case.md` section 4; open gaps listed in its section 7 (database file permissions, no explicit extension CSP) |
| `crypto_weaknesses` | Met | As at passing |
| `crypto_algorithm_agility` (SHOULD) | Met | Algorithms are negotiated by OTP and the browser |
| `crypto_credential_agility` | Unmet | `*_FILE` variants for secrets (slice 40 addition) |
| `crypto_used_network` (SHOULD) | Met | HTTPS outbound; loopback by default with a plain-HTTP warning |
| `crypto_tls12` (SHOULD) | Met | OTP and browser TLS 1.2 and 1.3 |
| `crypto_certificate_verification` | Met | Req verifies certificates by default; no override in `server/lib` |
| `crypto_verification_private` | Met | Verification happens in the TLS handshake, before any header is sent |
| `signed_releases` | Unmet | Slice 30 |
| `version_tags_signed` (SUGGESTED) | Unmet | Slice 30 |
| `input_validation` | Partly | `docs/security/assurance-case.md` section 6; imports (slice 12) and the 200-character cap on every text route remain |
| `hardening` (SHOULD) | Unmet | Extension CSP (slice 28), server headers (slice 01 addition) |
| `static_analysis_common_vulnerabilities` | Unmet | A security analyser for Elixir (slice 02 addition) |
| `dynamic_analysis_unsafe` | N/A | Memory-safe languages |
