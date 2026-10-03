# 53 · OpenSSF Best Practices badge

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) for silver. Inside this slice, §4.1, §4.2 and registering for the passing badge (§7) are P0: they ship with the public release |
| **Size** | M (about a week), spread over several months because some criteria need history (coverage, response times, a second person) |
| **Depends on** | [02](../02-test-harness-and-ci/SPEC.md), [03](../03-oss-foundations/SPEC.md), [30](../30-release-pipeline/SPEC.md); for silver also [27](../27-accessibility-baseline/SPEC.md), [50](../50-ui-localization-and-base-language/SPEC.md), [40](../40-server-packaging-docker/SPEC.md), [44](../44-docs-site/SPEC.md) |
| **Unblocks** | The gold badge (§8); outside security review; the OpenSSF Baseline levels (Future work) |
| **Sources** | OpenSSF Best Practices criteria for [passing](https://www.bestpractices.dev/en/criteria/0), [silver](https://www.bestpractices.dev/en/criteria/1) and [gold](https://www.bestpractices.dev/en/criteria/2) (downloaded 2026-10-02: 67, 55 and 23 criteria, none obsolete); [03 Future work (GOVERNANCE, Scorecard)](../03-oss-foundations/SPEC.md); [04 section 3 "Release plan"](../../docs/research/04-architecture-release.md); [06 Adversarial QA](../../docs/research/06-adversarial-qa.md); maintainer goal: silver now, gold later |

## Problem

People deciding whether to install a browser extension that reads every page they visit,
or to run a server that holds their API keys, have little to go on beyond the README. The
OpenSSF Best Practices badge is a widely recognised, public checklist answer to "is this
project run carefully?". The maintainer's other projects are at or near gold; Kotiko has
no entry at all.

Most of the groundwork is already in the repository (license, community files, CI with
tests, linters and audits, Dependabot, REUSE). What is missing, read from the tree on
2026-10-02 at `4a8a98a` plus the in-progress rename branch:

- **The repository is private** (`ScriptKittyOS/slovo`), so no criterion can be claimed
  yet, and the entry can't be created under the final name until slice 04 renames it.
- **Governance is implicit.** [DECISIONS.md](../DECISIONS.md) records who decided what, but
  nothing says how decisions are made, who holds which role, or what happens if the one
  person who holds every account is gone. `git shortlog` shows one author for all 27
  commits.
- **No statement coverage is measured** in CI (`.github/workflows/ci.yml` runs `mix test`
  and `npm test` only). Reproduced for this slice on a clean export of `4a8a98a`: the
  server suite covers 72.7 % of statements (`mix test --cover`, test support modules
  excluded) and the extension suites 74.9 % (`c8 --all` over `extension/`, with
  `extension/popup.js` at 0 % because only the end-to-end tests touch it). Silver needs
  80 %.
- **No security requirements or assurance case**, and `SECURITY.md` gives response
  times (`SECURITY.md:22`, read from the file) but not the process behind them.
- **No architecture document, roadmap with a time horizon, coding standard, or written
  test policy.** The material exists in pieces (README "Layout", `slices/`, the PR
  template's "Tests added or updated" box at `.github/pull_request_template.md:9`) but not
  where the criteria ask for it.
- **Releases are not signed yet** because there are no releases; slice 30 plans
  attestations but not signed tags or a verification guide.

Counts from the matrices in §2 and §3 (a † marks content that is in the repository today
and counts once the repository is public):

| Level | Category | Met (of which †) | Partly met | Not met | N/A | Total |
|---|---|---|---|---|---|---|
| Passing | MUST | 37 (11†) | 1 | 1 | 4 | 43 |
| Passing | SHOULD | 9 (2†) | 1 | 0 | 0 | 10 |
| Passing | SUGGESTED | 6 | 6 | 1 | 1 | 14 |
| Silver | MUST | 12 (2†) | 18 | 9 | 5 | 44 |
| Silver | SHOULD | 5 | 2 | 3 | 0 | 10 |
| Silver | SUGGESTED | 0 | 0 | 1 | 0 | 1 |

Passing is close: the only MUST gaps are `repo_public` (fixed by going public) and
`documentation_interface` (a reference for the HTTP API and settings, §4.1). Silver needs
real work: 9 MUSTs not met and 18 partly met.

## Goals

- A passing badge within a week of the repository going public under
  `ScriptKittyOS/kotiko`, with every answer backed by a URL in the repository.
- A silver badge after the first public release, without claiming anything the
  repository doesn't show.
- Every new document and check needed for silver specified here or in the slice that owns
  the area, so nothing is invented at form-filling time.
- Groundwork that leaves gold blocked only on time, a second maintainer and an outside
  security review (§8).
- A named person and a schedule for keeping the answers true.

## Non-goals

- Gold. §8 lists what remains and what to prepare now; the badge itself is Future work.
- Rewriting README.md or CONTRIBUTING.md now: another change is editing them for the
  rename. This slice specifies the exact additions; they land after slice 04.
- Changing decisions in [DECISIONS.md](../DECISIONS.md) or slice 03's "no DCO" (§6 and Open
  question 1 put it to the maintainer).
- Accessibility and localization work themselves: [27](../27-accessibility-baseline/SPEC.md)
  and [50](../50-ui-localization-and-base-language/SPEC.md). This slice only points the
  `accessibility_best_practices` and `internationalization` answers at them.
- OpenSSF Scorecard and the OpenSSF Baseline levels (Future work).

## User stories

- As someone deciding whether to trust an extension with every page I read, I want a
  recognised badge on the README that links to the evidence.
- As a security researcher, I want to know exactly what happens after I report a problem.
- As a new contributor, I want to know the style rules, the test rules and who reviews my
  pull request before I start.
- As the maintainer, I want the project to keep going (issues answered, releases shipped)
  if I am unavailable for a long time.
- As a future co-maintainer, I want the architecture and the security argument written
  down so I can review changes without reading every file first.

## Specification

### 1. How the badge works

The [OpenSSF Best Practices badge](https://www.bestpractices.dev) is a free,
self-certified checklist run by the Open Source Security Foundation. A maintainer creates
an entry for the project, answers each criterion on a web form, and the site shows a
badge for the highest level whose criteria are all satisfied. Anyone can read the answers.

- **Levels.** Passing (67 criteria), silver (55), gold (23). Each level requires the one
  below it (`achieve_passing`, `achieve_silver`). Some criteria repeat at a higher level
  with a stronger keyword: `contribution_requirements` is a SHOULD at passing and a MUST at
  silver; `warnings_strict` and `static_analysis_common_vulnerabilities` go from
  SUGGESTED to MUST. The site also offers three separate "Baseline" levels (Future work).
- **Keywords.** Every MUST must be met. A SHOULD must be met or marked unmet with a
  justification that shows the trade-off was understood. A SUGGESTED criterion must be
  answered (met or unmet); justification is optional unless the criterion says otherwise.
- **N/A.** Where a criterion allows it, "N/A" counts as met. Some criteria require a
  justification for N/A (marked "N/A justification" on the form).
- **Justification and URL.** Some criteria require text for "Met" ("Met justification"),
  and some require that text to contain a URL ("Met URL"). Silver requires one or the other
  for almost every criterion. This slice's matrices give the URL to enter.
- **Progress.** The entry shows a percentage per level; the badge image changes by itself
  when a level is reached, so the README link never needs editing after it is added.
- **Self-certification.** Nobody audits the answers before the badge appears, but they are
  public, the site may run automated checks on some of them, and a false answer is visible
  to anyone. The rule in this slice: answer "Met" only when the linked file or setting
  shows it.
- **One implied criterion.** The project must have a public website with a stable URL
  before an entry can be created (§7.1).

### 2. Criteria matrix: passing

Status is as of 2026-10-02 (main at `4a8a98a`). "Met†" means the repository content
satisfies the criterion today, but it only counts once the repository is public
(`repo_public`). Evidence URLs use the final repository name
`https://github.com/ScriptKittyOS/kotiko` and resolve once slice 04 renames the
repository and it goes public.

| Criterion | Level | Today | Evidence for the form | Delivered by |
|---|---|---|---|---|
| `description_good` | MUST | Met† | [`README.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/README.md), first paragraph | –; [44](../44-docs-site/SPEC.md) later |
| `interact` | MUST | Met† | [`README.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/README.md) (setup), [`.github/ISSUE_TEMPLATE/`](https://github.com/ScriptKittyOS/kotiko/tree/main/.github/ISSUE_TEMPLATE), [`CONTRIBUTING.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/CONTRIBUTING.md) | [03](../03-oss-foundations/SPEC.md) |
| `contribution` | MUST | Met† | [`CONTRIBUTING.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/CONTRIBUTING.md) | [03](../03-oss-foundations/SPEC.md) |
| `contribution_requirements` | SHOULD | Partly met | [`CONTRIBUTING.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/CONTRIBUTING.md): user-protection rules and Conventional Commits, but no named style guides | this slice §4.8 |
| `floss_license` | MUST | Met | [`LICENSE`](https://github.com/ScriptKittyOS/kotiko/blob/main/LICENSE) (Apache-2.0) | [03](../03-oss-foundations/SPEC.md) |
| `floss_license_osi` | SUGGESTED | Met | [`LICENSE`](https://github.com/ScriptKittyOS/kotiko/blob/main/LICENSE) (OSI-approved) | [03](../03-oss-foundations/SPEC.md) |
| `license_location` | MUST | Met | [`LICENSE`](https://github.com/ScriptKittyOS/kotiko/blob/main/LICENSE) | [03](../03-oss-foundations/SPEC.md) |
| `documentation_basics` | MUST | Met† | [`README.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/README.md) | [44](../44-docs-site/SPEC.md) later |
| `documentation_interface` | MUST | Partly met | [`README.md#api`](https://github.com/ScriptKittyOS/kotiko/blob/main/README.md#api) lists routes but not every request and response shape; settings only in [`server/.env.example`](https://github.com/ScriptKittyOS/kotiko/blob/main/server/.env.example) | this slice §4.1 (P0); kept current by [07](../07-word-model-v2/SPEC.md) |
| `sites_https` | MUST | Met | github.com is HTTPS-only; the docs site enforces HTTPS | [44](../44-docs-site/SPEC.md) |
| `discussion` | MUST | Met† | GitHub Issues (https://github.com/ScriptKittyOS/kotiko/issues); Discussions linked from [`.github/ISSUE_TEMPLATE/config.yml`](https://github.com/ScriptKittyOS/kotiko/blob/main/.github/ISSUE_TEMPLATE/config.yml) | Going-public checklist, [03](../03-oss-foundations/SPEC.md) §6 item 4 |
| `english` | SHOULD | Met | All documentation is written in English; issue forms in English | – |
| `maintained` | MUST | Met | Commit history (https://github.com/ScriptKittyOS/kotiko/commits/main) | – |
| `repo_public` | MUST | Not met | The repository is private (`ScriptKittyOS/slovo`) | [03](../03-oss-foundations/SPEC.md) §6, [30](../30-release-pipeline/SPEC.md) (P0) |
| `repo_track` | MUST | Met | git history (https://github.com/ScriptKittyOS/kotiko/commits/main) | – |
| `repo_interim` | MUST | Met | Pull requests between releases (https://github.com/ScriptKittyOS/kotiko/pulls?q=is%3Apr) | – |
| `repo_distributed` | SUGGESTED | Met | git | – |
| `version_unique` | MUST | Met | [`.release-please-manifest.json`](https://github.com/ScriptKittyOS/kotiko/blob/main/.release-please-manifest.json), [`CHANGELOG.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/CHANGELOG.md) | [03](../03-oss-foundations/SPEC.md), [30](../30-release-pipeline/SPEC.md) |
| `version_semver` | SUGGESTED | Met | [`CHANGELOG.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/CHANGELOG.md) (0.1.0, 0.2.0; SemVer per slice 03 §4) | [03](../03-oss-foundations/SPEC.md) |
| `version_tags` | SUGGESTED | Not met | No git tags yet (`git tag` is empty) | [30](../30-release-pipeline/SPEC.md) (release-please tags) |
| `release_notes` | MUST | Met† | [`CHANGELOG.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/CHANGELOG.md) | [30](../30-release-pipeline/SPEC.md) |
| `release_notes_vulns` | MUST | N/A | No fixed vulnerability has had a CVE; the rule for future notes is in §5 ([30](../30-release-pipeline/SPEC.md) addition) | [30](../30-release-pipeline/SPEC.md) |
| `report_process` | MUST | Met† | [`.github/ISSUE_TEMPLATE/bug.yml`](https://github.com/ScriptKittyOS/kotiko/blob/main/.github/ISSUE_TEMPLATE/bug.yml) | [03](../03-oss-foundations/SPEC.md) |
| `report_tracker` | SHOULD | Met† | GitHub Issues (https://github.com/ScriptKittyOS/kotiko/issues) | [03](../03-oss-foundations/SPEC.md) |
| `report_responses` | MUST | Met† | No outside reports yet; triage duty in GOVERNANCE.md (§4.3) | this slice §4.3 |
| `enhancement_responses` | SHOULD | Met† | No outside requests yet; same triage duty | this slice §4.3 |
| `report_archive` | MUST | Met† | GitHub Issues (https://github.com/ScriptKittyOS/kotiko/issues), searchable once public | [03](../03-oss-foundations/SPEC.md) |
| `vulnerability_report_process` | MUST | Met† | [`SECURITY.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/SECURITY.md) | [03](../03-oss-foundations/SPEC.md); this slice §4.2 |
| `vulnerability_report_private` | MUST | Met† | [`SECURITY.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/SECURITY.md) (GitHub private vulnerability reporting, which works only on public repositories; email fallback) | Going-public checklist, [03](../03-oss-foundations/SPEC.md) |
| `vulnerability_report_response` | MUST | N/A | No vulnerability reports received in the last 6 months | – |
| `build` | MUST | Met | [`server/mix.exs`](https://github.com/ScriptKittyOS/kotiko/blob/main/server/mix.exs) (Mix builds the server); the extension runs from source | [30](../30-release-pipeline/SPEC.md) adds packaging |
| `build_common_tools` | SUGGESTED | Met | Mix, npm | – |
| `build_floss_tools` | SHOULD | Met | Elixir, Erlang/OTP, Node.js, npm: all FLOSS | – |
| `test` | MUST | Met | [`server/test/`](https://github.com/ScriptKittyOS/kotiko/tree/main/server/test), [`test/`](https://github.com/ScriptKittyOS/kotiko/tree/main/test), [`CONTRIBUTING.md#setup`](https://github.com/ScriptKittyOS/kotiko/blob/main/CONTRIBUTING.md#setup), [`.github/workflows/ci.yml`](https://github.com/ScriptKittyOS/kotiko/blob/main/.github/workflows/ci.yml) | [02](../02-test-harness-and-ci/SPEC.md) |
| `test_invocation` | SHOULD | Met | `mix test`, `npm test` | [02](../02-test-harness-and-ci/SPEC.md) |
| `test_most` | SUGGESTED | Partly met | Measured 2026-10-02 at 4a8a98a: server 72.7 %, extension 74.9 % statements; not measured in CI | [02](../02-test-harness-and-ci/SPEC.md) addition |
| `test_continuous_integration` | SUGGESTED | Met | [`.github/workflows/ci.yml`](https://github.com/ScriptKittyOS/kotiko/blob/main/.github/workflows/ci.yml) | [02](../02-test-harness-and-ci/SPEC.md) |
| `test_policy` | MUST | Met | [`.github/pull_request_template.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/.github/pull_request_template.md) ("Tests added or updated"); every slice has a test plan | this slice §4.9 makes it formal |
| `tests_are_added` | MUST | Met | Commits 639eaf5, cf8f593 and 5a78bcb add tests with the change | – |
| `tests_documented_added` | SUGGESTED | Partly met | PR template checkbox only; [`CONTRIBUTING.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/CONTRIBUTING.md) doesn't state the policy | this slice §4.9 |
| `warnings` | MUST | Met | `mix compile --warnings-as-errors`, Credo, ESLint, `web-ext lint`, ShellCheck in [`.github/workflows/ci.yml`](https://github.com/ScriptKittyOS/kotiko/blob/main/.github/workflows/ci.yml) | [02](../02-test-harness-and-ci/SPEC.md) |
| `warnings_fixed` | MUST | Met | CI fails on any warning | [02](../02-test-harness-and-ci/SPEC.md) |
| `warnings_strict` | SUGGESTED | Partly met | Credo runs without `--strict`; ESLint uses the recommended set plus security rules | [02](../02-test-harness-and-ci/SPEC.md) addition |
| `know_secure_design` | MUST | Met | Deny-by-default auth (4705cb0), Host allowlist, constant-time token check; [`docs/research/04-architecture-release.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/docs/research/04-architecture-release.md) | [01](../01-api-auth-hardening/SPEC.md) |
| `know_common_errors` | MUST | Met | [`docs/research/06-adversarial-qa.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/docs/research/06-adversarial-qa.md) (40 failure modes); ESLint bans HTML strings ([`eslint.config.js`](https://github.com/ScriptKittyOS/kotiko/blob/main/eslint.config.js)) | – |
| `crypto_published` | MUST | Met | TLS from Erlang/OTP and the browser; `:crypto.strong_rand_bytes` | – |
| `crypto_call` | SHOULD | Met | No home-made crypto: `:crypto`, `Plug.Crypto.secure_compare`, OTP `:ssl` | – |
| `crypto_floss` | MUST | Met | Erlang/OTP and OpenSSL | – |
| `crypto_keylength` | MUST | Met | Generated tokens are 256-bit ([`server/lib/kotiko/token.ex`](https://github.com/ScriptKittyOS/kotiko/blob/main/server/lib/kotiko/token.ex)); user tokens need 24+ characters; TLS uses OTP and browser defaults | – |
| `crypto_working` | MUST | Met | No MD4, MD5, DES, RC4 or `verify_none` anywhere in `server/lib` or `extension/` | – |
| `crypto_weaknesses` | SHOULD | Met | No SHA-1 or weak modes in project code | – |
| `crypto_pfs` | SHOULD | Met | Outbound TLS 1.2/1.3 with ECDHE (OTP defaults); the server doesn't terminate TLS itself | – |
| `crypto_password_storage` | MUST | N/A | No passwords for users; one random bearer token. Multi-user tokens are stored as SHA-256 hashes ([48](../48-multi-user-and-classroom/SPEC.md)) | [48](../48-multi-user-and-classroom/SPEC.md) |
| `crypto_random` | MUST | Met | [`server/lib/kotiko/token.ex`](https://github.com/ScriptKittyOS/kotiko/blob/main/server/lib/kotiko/token.ex) (`:crypto.strong_rand_bytes(32)`) | – |
| `delivery_mitm` | MUST | Met | GitHub over HTTPS; stores sign packages | [30](../30-release-pipeline/SPEC.md) |
| `delivery_unsigned` | MUST | Met | No hashes over HTTP; release checksums come over HTTPS with Sigstore attestations | [30](../30-release-pipeline/SPEC.md) |
| `vulnerabilities_fixed_60_days` | MUST | Met | No known unpatched vulnerabilities | – |
| `vulnerabilities_critical_fixed` | SHOULD | Met | The encoded-path auth bypass was fixed the day it was found (4705cb0) | – |
| `no_leaked_credentials` | MUST | Met | gitleaks over full history on 2026-10-02: two hits, both fake keys in tests (`boot_test.exs`, `redact_test.exs`) | [02](../02-test-harness-and-ci/SPEC.md) addition (CI scan); [03](../03-oss-foundations/SPEC.md) checklist item 2 |
| `static_analysis` | MUST | Met | Credo, ESLint, `web-ext lint`, ShellCheck on every PR | [02](../02-test-harness-and-ci/SPEC.md) |
| `static_analysis_common_vulnerabilities` | SUGGESTED | Partly met | `eslint-plugin-no-unsanitized` covers DOM XSS; nothing security-focused for Elixir | [02](../02-test-harness-and-ci/SPEC.md) addition |
| `static_analysis_fixed` | MUST | Met | CI blocks merges on findings; none open | – |
| `static_analysis_often` | SUGGESTED | Met | Every push and PR | [02](../02-test-harness-and-ci/SPEC.md) |
| `dynamic_analysis` | SUGGESTED | Partly met | One StreamData property test (`word_test.exs`); end-to-end runs against the real server; no fuzzer or scanner | §8 (gold groundwork) |
| `dynamic_analysis_unsafe` | SUGGESTED | N/A | Elixir and JavaScript are memory-safe | – |
| `dynamic_analysis_enable_assertions` | SUGGESTED | Partly met | Tests assert heavily; no assertion-rich build mode | §8 (gold groundwork) |
| `dynamic_analysis_fixed` | MUST | N/A | No dynamic-analysis tool has reported findings | – |

### 3. Criteria matrix: silver

Same conventions. Criteria that also appear at passing (`contribution_requirements`,
`report_tracker`, `warnings_strict`, `tests_documented_added`, `crypto_weaknesses`,
`static_analysis_common_vulnerabilities`, `dynamic_analysis_unsafe`) are answered again
on the silver form, now with the silver keyword.

| Criterion | Level | Today | Evidence for the form | Delivered by |
|---|---|---|---|---|
| `achieve_passing` | MUST | Not met | No entry yet | this slice §7 |
| `contribution_requirements` | MUST | Partly met | As at passing | this slice §4.8 |
| `dco` | SHOULD | Not met | [`CONTRIBUTING.md#licensing`](https://github.com/ScriptKittyOS/kotiko/blob/main/CONTRIBUTING.md#licensing): inbound = outbound, no sign-off ([03](../03-oss-foundations/SPEC.md) §2) | Open question 1 |
| `governance` | MUST | Not met | [`slices/DECISIONS.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/slices/DECISIONS.md) records decisions, but no governance model is written | this slice §4.3 |
| `code_of_conduct` | MUST | Met | [`CODE_OF_CONDUCT.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/CODE_OF_CONDUCT.md) (Contributor Covenant 2.1) | [03](../03-oss-foundations/SPEC.md) |
| `roles_responsibilities` | MUST | Not met | No MAINTAINERS file; `CODEOWNERS` from slice 03 not yet added | this slice §4.3; [03](../03-oss-foundations/SPEC.md) |
| `access_continuity` | MUST | Not met | No inventory of accounts and keys, no backup holder | this slice §4.4 |
| `bus_factor` | SHOULD | Not met | One person wrote all 27 commits (`git shortlog`) | this slice §4.4 (justify, then recruit) |
| `documentation_roadmap` | MUST | Partly met | [`slices/README.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/slices/README.md) has priorities and dropped work, no time horizon | this slice §4.5 |
| `documentation_architecture` | MUST | Partly met | [`README.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/README.md) diagram and Layout; [`docs/research/04-architecture-release.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/docs/research/04-architecture-release.md) | this slice §4.6 |
| `documentation_security` | MUST | Partly met | [`SECURITY.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/SECURITY.md) scope; plain-HTTP warning in [`README.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/README.md) | this slice §4.7 |
| `documentation_quick_start` | MUST | Met† | [`README.md#setup-about-10-minutes`](https://github.com/ScriptKittyOS/kotiko/blob/main/README.md#setup-about-10-minutes) | [44](../44-docs-site/SPEC.md) `/start/` replaces it; [22](../22-first-run-onboarding/SPEC.md) |
| `documentation_current` | MUST | Partly met | README still says words replace "English" ([50](../50-ui-localization-and-base-language/SPEC.md)); the rename is in progress; no docs check on PRs | this slice §4.10; [04](../04-rename-to-kotiko/SPEC.md) |
| `documentation_achievements` | MUST | Not met | No badge yet | this slice §7 |
| `accessibility_best_practices` | SHOULD | Partly met | The popup has not been audited | [27](../27-accessibility-baseline/SPEC.md) (P0), [44](../44-docs-site/SPEC.md) |
| `internationalization` | SHOULD | Not met | Popup strings are hard-coded in `extension/popup.js` | [50](../50-ui-localization-and-base-language/SPEC.md) (P0) |
| `sites_password_security` | MUST | N/A | The project runs no site that stores passwords (GitHub, stores and GitHub Pages are third-party) | – |
| `maintenance_or_update` | MUST | Partly met | [`README.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/README.md) (`git pull`, migrations run on start), [`CHANGELOG.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/CHANGELOG.md); compatibility policy not yet published | [30](../30-release-pipeline/SPEC.md) §9 + addition, [44](../44-docs-site/SPEC.md) |
| `report_tracker` | MUST | Met† | GitHub Issues (https://github.com/ScriptKittyOS/kotiko/issues) | [03](../03-oss-foundations/SPEC.md) |
| `vulnerability_report_credit` | MUST | N/A | No outside reports resolved in 12 months (the auth bypass was found by the project's own review); [`SECURITY.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/SECURITY.md) promises credit | this slice §4.2 |
| `vulnerability_response_process` | MUST | Partly met | [`SECURITY.md`](https://github.com/ScriptKittyOS/kotiko/blob/main/SECURITY.md) gives timelines and credit, not the process | this slice §4.2 (P0) |
| `coding_standards` | MUST | Partly met | Formatter and linters exist; no style guide is named | this slice §4.8 |
| `coding_standards_enforced` | MUST | Partly met | `mix format --check-formatted` and Credo in CI; no JavaScript formatter | [02](../02-test-harness-and-ci/SPEC.md) addition |
| `build_standard_variables` | MUST | N/A | The project builds no native binaries (exqlite's NIF is a dependency's prebuilt artifact) | – |
| `build_preserve_debug` | SHOULD | Met | `mix compile` keeps debug info; release stripping is a documented option | [40](../40-server-packaging-docker/SPEC.md) addition |
| `build_non_recursive` | MUST | Met | One Mix project and an unbuilt extension; no recursive builds | – |
| `build_repeatable` | MUST | Not met | No release artifacts yet; reproducibility not verified | [30](../30-release-pipeline/SPEC.md) §3, [40](../40-server-packaging-docker/SPEC.md) addition |
| `installation_common` | MUST | Partly met | Load unpacked, `run.sh`, [`server/install-service.sh`](https://github.com/ScriptKittyOS/kotiko/blob/main/server/install-service.sh) (no uninstall) | [30](../30-release-pipeline/SPEC.md) (stores), [40](../40-server-packaging-docker/SPEC.md) (Docker, release, uninstall) |
| `installation_standard_variables` | MUST | N/A | No POSIX install into a prefix: browsers install the extension, Docker and release tarballs unpack where the user chooses | [40](../40-server-packaging-docker/SPEC.md) |
| `installation_development_quick` | MUST | Met | [`CONTRIBUTING.md#setup`](https://github.com/ScriptKittyOS/kotiko/blob/main/CONTRIBUTING.md#setup): `mix deps.get`, `npm ci`, `npx playwright install` | [03](../03-oss-foundations/SPEC.md) |
| `external_dependencies` | MUST | Met | [`server/mix.lock`](https://github.com/ScriptKittyOS/kotiko/blob/main/server/mix.lock), [`package-lock.json`](https://github.com/ScriptKittyOS/kotiko/blob/main/package-lock.json) | this slice §4.6 (services); [30](../30-release-pipeline/SPEC.md) addition (SBOM) |
| `dependency_monitoring` | MUST | Partly met | [`.github/dependabot.yml`](https://github.com/ScriptKittyOS/kotiko/blob/main/.github/dependabot.yml); `mix deps.audit` and `mix hex.audit` in CI; npm not audited in CI; Dependabot alerts not yet on | [02](../02-test-harness-and-ci/SPEC.md) addition; [03](../03-oss-foundations/SPEC.md) checklist |
| `updateable_reused_components` | MUST | Met | Everything comes through Hex and npm lockfiles; no vendored copies | – |
| `interfaces_current` | SHOULD | Met | Manifest V3; current OTP and Elixir; deprecations fail `--warnings-as-errors` | – |
| `automated_integration_testing` | MUST | Met | [`.github/workflows/ci.yml`](https://github.com/ScriptKittyOS/kotiko/blob/main/.github/workflows/ci.yml) on every push and PR, with pass/fail reports | [02](../02-test-harness-and-ci/SPEC.md) |
| `regression_tests_added50` | MUST | Met | All four fixes in the last six months have tests: 4705cb0 (`router_auth_test.exs`), 091c05b (`llm_test.exs`), 633453a (`config_test.exs`), 5a78bcb (sync tests) | this slice §4.9 keeps it |
| `test_statement_coverage80` | MUST | Not met | 72.7 % server, 74.9 % extension (`popup.js` untested) | [02](../02-test-harness-and-ci/SPEC.md) addition |
| `test_policy_mandated` | MUST | Partly met | PR template checkbox, not a written rule | this slice §4.9 |
| `tests_documented_added` | MUST | Partly met | As at passing | this slice §4.9 |
| `warnings_strict` | MUST | Partly met | As at passing | [02](../02-test-harness-and-ci/SPEC.md) addition |
| `implement_secure_design` | MUST | Partly met | Deny by default, Host allowlist, text-only DOM; content scripts can still read the token in `storage.local` | [01](../01-api-auth-hardening/SPEC.md), [11](../11-local-first-mode/SPEC.md) §3, [28](../28-privacy-and-store-readiness/SPEC.md) §7; argued in §4.7 |
| `crypto_weaknesses` | MUST | Met | As at passing | – |
| `crypto_algorithm_agility` | SHOULD | Met | Algorithms are negotiated by OTP's TLS and the browser; project code fixes none | – |
| `crypto_credential_agility` | MUST | Partly met | The API token lives in its own file `<data dir>/api-token` (0600) and is replaced with `mix kotiko.token`; `LLM_API_KEY` and `TELEGRAM_BOT_TOKEN` sit in `.env` with other settings | [40](../40-server-packaging-docker/SPEC.md) addition (`*_FILE`) |
| `crypto_used_network` | SHOULD | Met | Outbound HTTPS only by default; the server listens on loopback unless `BIND` is set, and warns about plain HTTP | [40](../40-server-packaging-docker/SPEC.md) (HTTPS remote setup) |
| `crypto_tls12` | SHOULD | Met | OTP and browser TLS support 1.2 and 1.3 | – |
| `crypto_certificate_verification` | MUST | Met | Req (Mint) verifies certificates by default; no override in `server/lib` | – |
| `crypto_verification_private` | MUST | Met | Verification happens in the TLS handshake, before the `Authorization` header is sent | – |
| `signed_releases` | MUST | Not met | No releases yet | [30](../30-release-pipeline/SPEC.md) §7 + addition |
| `version_tags_signed` | SUGGESTED | Not met | No tags yet | [30](../30-release-pipeline/SPEC.md) addition |
| `input_validation` | MUST | Partly met | Config validation (`config.ex`), 64 KB body cap, Host allowlist, response checks in [`extension/lib/validate-words.js`](https://github.com/ScriptKittyOS/kotiko/blob/main/extension/lib/validate-words.js); model output and imports pending | [09](../09-shared-word-spec-and-prompt/SPEC.md), [07](../07-word-model-v2/SPEC.md), [12](../12-export-import-and-delete/SPEC.md), [13](../13-bulk-add/SPEC.md); listed in §4.7 |
| `hardening` | SHOULD | Partly met | Host allowlist, body limit, `cache-control: no-store`; no explicit extension CSP or `nosniff` yet | [28](../28-privacy-and-store-readiness/SPEC.md) §5, [01](../01-api-auth-hardening/SPEC.md) addition, [40](../40-server-packaging-docker/SPEC.md) §4 |
| `assurance_case` | MUST | Not met | None | this slice §4.7 |
| `static_analysis_common_vulnerabilities` | MUST | Partly met | As at passing | [02](../02-test-harness-and-ci/SPEC.md) addition |
| `dynamic_analysis_unsafe` | MUST | N/A | Memory-safe languages only | – |

Top gaps for silver, in the order to tackle them:

1. Governance, roles, access continuity (§4.3, §4.4): four MUSTs, mostly writing and
   account housekeeping.
2. Coverage to 80 % with a CI gate ([02](../02-test-harness-and-ci/SPEC.md) addition):
   the biggest engineering item (popup tests, bot and application tests).
3. Security requirements and assurance case (§4.7), plus the response process (§4.2).
4. Signed releases and reproducible builds ([30](../30-release-pipeline/SPEC.md) and
   [40](../40-server-packaging-docker/SPEC.md) additions): need the first real release.
5. Coding standards, test policy, stricter warnings, security static analysis (§4.8, §4.9,
   [02](../02-test-harness-and-ci/SPEC.md) addition).
6. Architecture, roadmap, docs-current process (§4.5, §4.6, §4.10).
7. Accessibility and localization ([27](../27-accessibility-baseline/SPEC.md),
   [50](../50-ui-localization-and-base-language/SPEC.md)): already P0, so silver only
   waits for them.

### 4. New work in this slice

All new files are plain Markdown in the repository, in English, plain language, no
emojis, wrapped like the rest of the docs. Each starts with a "Last reviewed" date. Paths
are from the repository root.

#### 4.1 Interface reference (P0)

For `documentation_interface`. The README's API table lists routes but not every field,
error and limit, and the settings are only described in `server/.env.example`.

- **`docs/reference/http-api.md`**: for every route the server answers: method and path;
  authentication (`Authorization: Bearer <token>`, everything except `GET`/`HEAD /health`);
  request body fields with type, limits (the 64 KB body cap) and an example; response
  fields with types; every status code the route can return (200, 400, 401, 404, 413,
  421, 500) with the error body shape from slice [25](../25-plain-language-errors/SPEC.md);
  response headers that matter (`cache-control: no-store`, `www-authenticate`); a `curl`
  example. A section on versions: today's `/api` routes, slice 07's `/api/v1` and the
  legacy-alias rule from slice 03 §4.
- **`docs/reference/configuration.md`**: every environment variable `Kotiko.Config` reads,
  with default, allowed values, an example, and what happens when it's wrong; the files in
  the data directory (`kotiko.db`, `api-token`, `backups/`) and their permissions; the
  `mix kotiko.token` task.
- **Kept current by tests, not by memory**:
  - `server/test/kotiko/docs_test.exs` asserts that every route in the route list
    `router_auth_test.exs` already uses (one list, moved to a shared helper if needed)
    appears as a `### METHOD /path` heading in `http-api.md`, and that every name in
    `Kotiko.Config`'s known-variable lists (`@prefixed_vars`, `@secret_vars` and the
    unprefixed ones; add `Kotiko.Config.documented_vars/0` returning them) appears in
    `configuration.md`.
  - Slice [07](../07-word-model-v2/SPEC.md) updates `http-api.md` when `/api/v1` lands;
    the test makes that impossible to forget.
- The extension's external interface for users is its UI, documented by
  [44](../44-docs-site/SPEC.md); its file formats are slice
  [12](../12-export-import-and-delete/SPEC.md)'s `spec/export.schema.json`, linked from
  `http-api.md`'s "See also".
- Form answer: `https://github.com/ScriptKittyOS/kotiko/tree/main/docs/reference`.

#### 4.2 Vulnerability response process (P0)

For `vulnerability_response_process` (silver), and so `release_notes_vulns` and
`vulnerability_report_credit` stay true after the first report. A public release invites
reports, so this ships with it. `SECURITY.md` keeps its current sections and gains
**"What happens after you report"** with this text:

> 1. **Acknowledge** within 7 days, from a maintainer named in MAINTAINERS.md.
> 2. **Triage**: we reproduce the problem, decide whether it is in scope, and rate it with
>    CVSS v4.0. We tell you the rating and the plan.
> 3. **Fix privately** in a GitHub draft security advisory with a temporary private fork.
>    You can be added to the advisory to review the fix.
> 4. **Targets** from triage to a released fix: critical 7 days, high 30 days, medium 60
>    days, low in the next planned release. If we will miss a target, we tell you why.
> 5. **CVE**: for medium severity and above, we request a CVE through GitHub when we
>    publish the advisory.
> 6. **Release**: a patch release whose notes have a "Security" section listing the
>    advisory, the CVE, the severity and, unless you ask otherwise, your name.
> 7. **Disclose**: the advisory is published with the release. We ask reporters to keep
>    details private until then or for 90 days from the report, whichever comes first.
> 8. **Afterwards**: the fix includes a regression test, and the assurance case
>    (`docs/security/assurance-case.md`) is updated if the problem crossed a trust boundary.
>
> If the problem is in a dependency, we report it upstream and ship a pinned or patched
> version in the meantime.

Who does this: the "security response lead" role from §4.3, with a named backup.
`security@scriptkittyos.com` must reach both (slice 03's open question 1 and the
going-public checklist item 7).

#### 4.3 Governance, roles and maintainers (P1)

For `governance`, `roles_responsibilities`, and the response criteria at passing.

**`GOVERNANCE.md`** (root):

1. **Model.** Kotiko is maintainer-led. Day-to-day decisions are made in issues and pull
   requests by lazy consensus: a proposal with no unresolved objection from a maintainer
   after 7 days may proceed. The lead maintainer makes the final call when there is
   disagreement. Decisions that shape the product are recorded in `slices/DECISIONS.md`
   with who decided and why; plans live in `slices/` as specs.
2. **Proposing a change.** Small fixes: a pull request. Anything that changes behaviour
   users see, data formats or the security model: an issue first, then a spec or a change
   to an existing spec in `slices/`, reviewed like code.
3. **Disputes.** Discussed on the issue; if unresolved after 14 days, the lead maintainer
   decides and records it in DECISIONS.md. Conduct problems follow CODE_OF_CONDUCT.md; a
   report about the lead maintainer goes to the steward.
4. **When there are three or more maintainers**, contested decisions go to a simple
   majority of maintainers, with the lead maintainer breaking ties. This switch happens
   automatically when MAINTAINERS.md lists a third maintainer.
5. **Becoming a maintainer.** Sustained, good-quality contribution over at least three
   months (code, review, docs or translation), nominated by a maintainer, with no
   objection from other maintainers within 7 days. Recorded by a pull request to
   MAINTAINERS.md.
6. **Stepping down.** Any time, by pull request. Maintainers inactive for 12 months move
   to "Emeritus" after a heads-up; their access is removed the same day (§4.4).
7. **Changing this document**: a pull request open for at least 7 days, approved by all
   active maintainers (the lead maintainer while there is one).

**Roles** (in GOVERNANCE.md, with the tasks each must perform):

| Role | Responsibilities and required tasks |
|---|---|
| Lead maintainer | Final decisions; keeps DECISIONS.md and ROADMAP.md current; owns the badge entry (badge steward) and its reviews (§7.6) |
| Maintainer | Reviews and merges pull requests; takes the weekly triage turn (every new issue gets a label and a first response within 7 days); approves the `release` environment; follows CODE_OF_CONDUCT.md enforcement |
| Release manager | Runs releases per slice 30 and signs the release tag (§5, 30 addition); keeps `docs/stores.md` current |
| Security response lead | Runs §4.2's process; has a named backup; keeps the assurance case current |
| Steward | Holds recovery access to every account in §4.4 and runs the yearly continuity check; does not need to write code; becomes interim lead if the lead is gone |
| Locale reviewer | Signs off a launch locale before a release (slice 50); one per locale |
| Contributor | Anyone who opens an issue or pull request; follows CONTRIBUTING.md and the code of conduct |

**`MAINTAINERS.md`** (root) says who holds which role: name, GitHub handle, roles, areas
(server, extension, docs, a locale), tag-signing key fingerprint (§5, 30 addition), and
since when; plus an Emeritus list. Today one row: the maintainer in every role except
steward, which is Open question 2.

**`CODEOWNERS`**: slice 03 specifies `* @ScriptKittyOS/kotiko-maintainers`; it is not in
the repository yet and is needed here so reviews are requested automatically. The team is
created in the GitHub organization with every maintainer as a member.

#### 4.4 Access continuity and bus factor (P1)

For `access_continuity` (MUST) and `bus_factor` (SHOULD).

**`docs/governance/continuity.md`** (public; no secrets in it):

1. **Inventory**, one row per asset, columns: asset, what it controls, primary holder,
   backup holder, where the recovery material is kept, how to hand it over.

   | Asset | Controls |
   |---|---|
   | GitHub organization `ScriptKittyOS` (owner role) | Repository settings, teams, Actions secrets, `release` environment |
   | Repository `ScriptKittyOS/kotiko` (admin) | Issues, pull requests, branch protection, advisories |
   | Chrome Web Store publisher account (slice 28 §9) | Listing and uploads |
   | Google Cloud project for the store API (slice 30 §4) | `CWS_*` credentials |
   | addons.mozilla.org add-on (owner and developers) | Listing, signing, `AMO_JWT_*` keys |
   | `ghcr.io/scriptkittyos` packages | Docker images (slice 40) |
   | `scriptkittyos.com` registrar, DNS and mailboxes | `security@`, `hello@` |
   | `kotiko.org` on Cloudflare (registrar, DNS, proxy, Transform Rules) | Docs site domain and its hardening headers (slice 44) |
   | Weblate project (slice 50) | Translations |
   | bestpractices.dev entry | This badge's answers |
   | Tag-signing keys | Each maintainer's own key; never shared; listed in MAINTAINERS.md |

2. **Rules.** Every asset has at least two people with full control: the organization has
   at least two owners (the steward is one); the Chrome Web Store account is a group
   publisher or its Google account's recovery is held by the steward; AMO lists at least
   two owners; the domain registrar account has the steward as a recovery contact. No
   account depends on one person's phone for two-factor recovery: recovery codes are in
   the private record below.
3. **Private record.** Recovery codes and shared account credentials live in an
   organization password-manager vault shared with the steward (or a sealed copy held by
   the steward if no vault is used), never in the repository. The public file says where
   it is, not what it holds.
4. **Legal rights.** The code is Apache-2.0, so anyone may continue it. For what isn't
   (the name, logo and illustrations, the domain), the maintainer leaves a written
   instruction (a letter or a will clause, kept privately) that transfers or licenses them
   to the steward or the organization's remaining owners. The public file says that this
   exists.
5. **Within one week of confirming that a key person is gone**: the steward (or another
   owner) announces it in Discussions; grants maintainer rights to an active contributor or
   acts as interim lead; checks they can create and close issues, merge a pull request and
   approve a release; and rotates any credential the person held (slice 30 §6).
6. **Yearly check** (and whenever a role changes hands): the steward performs step 5's
   checks without changing anything and records the date and result in the file.
   `access_continuity` cites the latest date.

**Bus factor.** Today it is 1. On the form, `bus_factor` (a SHOULD) is marked unmet with
this justification: "One active maintainer today. Access continuity is covered separately
(docs/governance/continuity.md): a steward holds recovery access to every account and can
hand the project on within a week. We are working towards a second maintainer:
architecture, assurance case and coding standards are written down, small tasks are
labelled, and every slice in slices/ is a buildable spec." Raising it to 2 is the first
step to gold (§8).

#### 4.5 Roadmap (P1)

For `documentation_roadmap`. **`ROADMAP.md`** (root), one page:

- "Last reviewed" date and the horizon ("through <date + 12 months>").
- **Now**: the public release; one paragraph per phase from
  [slices/README.md](../README.md#priorities-and-phases), with links.
- **Next (the 6 months after release)**: the P1 slices, including this badge to silver.
- **Later**: P2 slices.
- **What Kotiko will not do**, from [DECISIONS.md](../DECISIONS.md) and slice 03: no paid
  tier or hosted accounts; no word lists or packs added for the learner; no telemetry or
  analytics; no ads; no bundler or runtime npm code in the extension; never adding a word
  the learner didn't choose.
- How it changes: reviewed each quarter and at each minor release by the lead maintainer;
  slices/README.md stays the detailed plan.

#### 4.6 Architecture and external dependencies (P1)

For `documentation_architecture`, and the documentation half of `external_dependencies`.
**`docs/ARCHITECTURE.md`**:

1. **Overview**: what runs where, with an ASCII diagram for today (extension plus server)
   and for local-first mode after [11](../11-local-first-mode/SPEC.md) (extension calling a
   model directly; server optional).
2. **Components.** Extension: content script and `lib/` pure modules, background (service
   worker in Chrome, event page in Firefox), extension pages (popup; later dashboard and
   welcome tab), messaging between them. Server: Bandit and the Plug router, `HostCheck`,
   `Config`, `Token`, `LLM` client, `Words` and the SQLite repo, `Bot` and `Telegram`,
   `Transcriber`. The shared `spec/` folder (slice 09).
3. **Data**: the word record (slice 07), where it is stored in each mode, and a link to
   slice 28's data inventory for what leaves the machine.
4. **Main flows**: add a word (popup, Telegram), sync, swapping words on a page.
5. **Trust boundaries**: a short summary and a link to the assurance case (§4.7).
6. **External dependencies**: runtime services (an OpenAI-compatible model API, OpenRouter
   by default; Telegram Bot API, optional; a transcription endpoint such as whisper.cpp,
   optional) and what each receives; platform (supported browsers, Elixir and OTP range
   from CI, Node for development only); libraries, by pointing at `server/mix.exs`,
   `server/mix.lock`, `package.json` and `package-lock.json` (the computer-readable lists),
   and the SBOM attached to each release (30 addition); how they are kept up to date
   (Dependabot, `mix deps.audit`, OSV-Scanner).
7. **Where decisions live**: `slices/`, DECISIONS.md, `docs/research/`.

The PR template's docs box (§4.10) covers it; the lead maintainer reviews it at each minor
release.

#### 4.7 Security requirements and assurance case (P1)

For `documentation_security`, `assurance_case` and the argument behind
`implement_secure_design` and `input_validation`.

**`docs/security/requirements.md`**: "What you can expect" and "What you can't expect",
in plain language. Initial content:

- **You can expect**: the server answers nothing but `/health` without the token; it
  generates a 256-bit token and stores it readable only by you; it listens only on your
  machine unless you change `BIND`, and warns when you do; it answers only to host names
  it knows (DNS rebinding); it sends your words only to the model provider you configured
  and to Telegram if you turned the bot on; it logs no words, page text, keys or tokens
  above debug level; the extension never inserts page or word text as HTML; no telemetry
  or analytics; signed, attested releases and store-reviewed packages; security fixes for
  the latest minor version.
- **You can't expect**: protection from anyone who can read your browser profile or the
  server's data folder (keys are not encrypted at rest); privacy on a network if you use
  plain HTTP to a server on another machine (use HTTPS, for example Tailscale); privacy
  from the model provider you chose (lookups go to it under its terms); that pages can't
  tell Kotiko changed their text; isolation between several people on one server before
  slice 48; a correct answer from the model every time (answers are validated, not
  verified); availability guarantees.

Items that depend on unfinished slices (for example "web pages can't read your key",
slices 11 and 28) are listed only once those slices ship.

**`docs/security/assurance-case.md`**, structured as claims, arguments and evidence:

1. **Top claim**: Kotiko meets `requirements.md` in its supported configurations. Each
   "You can expect" line is a sub-claim with its evidence (code, tests, CI jobs).
2. **Threat model**: assets (the learner's word list, model API keys, the server token,
   which pages a learner reads); attackers (a malicious web page, a script on a page,
   someone on the same network, a malicious or broken model answer, a Telegram user who
   isn't allowed, another user on the server machine, a compromised dependency or GitHub
   Action, a malicious pull request); what each can reach.
3. **Trust boundaries**, with a diagram: web page and content script (the page DOM is
   untrusted); content script and background (message sender checks, slice 26 §6);
   extension pages and background; extension and server (HTTP with bearer token, Host
   check); server and model provider (HTTPS; model output untrusted, slice 09);
   server and Telegram (HTTPS; allowlisted user IDs); server and the file system (data
   folder permissions); CI and the stores (`release` environment approval, slice 30 §6).
4. **Secure design principles**: a table of the eight Saltzer and Schroeder principles plus
   "limited attack surface" and "input validation with allowlists", each with how Kotiko
   applies it and a link. Examples: fail-safe defaults (deny-by-default router, loopback
   bind); complete mediation (one auth plug before routing, tested over encoded paths);
   least privilege (MV3 permissions reviewed in slice 28 §6, systemd sandboxing in slice
   40 §4); open design (the token is the only secret); psychological acceptability (the
   key is typed only on full pages, plain-language warnings).
5. **Common weaknesses countered**: a table over the current CWE Top 25 and OWASP Top 10
   entries that apply, each with the countermeasure and evidence, marked "in place" or
   "planned (slice NN)". At least: CWE-79 XSS (text-only DOM, ESLint rules); CWE-89 SQL
   injection (Ecto parameterised queries); CWE-78 OS command injection (no shell with
   user input); CWE-22 path traversal (no user-controlled paths); CWE-306 and CWE-862
   missing authentication or authorization (deny by default, auth matrix tests); CWE-352
   CSRF (bearer header, no cookies, no CORS); CWE-918 SSRF (model and transcription URLs
   set only by the server's owner); CWE-502 unsafe deserialization (JSON only, no
   `binary_to_term`); CWE-400 resource exhaustion (body cap, deadlines in slice 10);
   CWE-20 input validation (config validation, slice 09 schema, slice 26 response
   validation); CWE-798 hard-coded credentials (none; gitleaks); CWE-532 secrets in logs
   (`Kotiko.Log.Redact`); DNS rebinding (Host allowlist); supply chain (actions pinned by
   SHA, lockfiles, Dependabot, reviews, attestations).
6. **Inputs and how each is validated** (for `input_validation`): every input source
   (HTTP body and headers, environment, data files, model answers, Telegram updates,
   extension messages, server responses in the extension, imported files, page DOM) with
   the allowlist rule and its location.
7. **Residual risks and assumptions**, matching "You can't expect".
8. **Maintenance**: updated in the same pull request as any change that adds an input or
   crosses a trust boundary (PR template box, §4.10); reviewed in full at each minor
   release and after every security report; "Last reviewed" at the top.

#### 4.8 Coding standards (P1)

For `contribution_requirements` and `coding_standards`. **`docs/CODING_STANDARDS.md`**:

- **Elixir**: layout is whatever `mix format` produces (`server/.formatter.exs`); Credo in
  strict mode decides the rest; where both are silent, follow the community
  [Elixir Style Guide](https://github.com/christopheradams/elixir_style_guide). Project
  rules: configuration only through `Kotiko.Config`; no user text in logs above debug;
  HTTP clients take `req_options` so tests can stub them.
- **JavaScript**: layout is whatever Prettier produces (config in the repository, added by
  the 02 addition); ESLint (`eslint.config.js`) decides the rest. This document is the
  JavaScript style guide: classic scripts in `extension/` that attach one namespace to
  `globalThis` (slice 02 §1); no runtime npm code or bundler; DOM built with
  `textContent` and DOM methods only; every user-facing string through the i18n helper
  (slice 50 §7).
- **Shell**: ShellCheck clean; `set -eu`; quote every expansion; the
  [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html) where
  ShellCheck is silent.
- **HTML and CSS**: Prettier layout; slice 06's tokens instead of literal colours; no
  inline scripts or event-handler attributes (extension CSP, slice 28 §5).
- **Markdown**: plain language, short sentences, no emojis; specs follow
  `slices/TEMPLATE.md`.
- **Commits and pull requests**: Conventional Commits, as in CONTRIBUTING.md.
- **Every language**: slice 50 §7's cross-cutting rules.

CONTRIBUTING.md gains one line under "Commits and pull requests" (after slice 04):
"Code follows `docs/CODING_STANDARDS.md`; CI checks formatting and lint, so run
`mix format`, `mix credo --strict` and `npm run lint` before pushing."

#### 4.9 Tests, regressions and coverage policy (P1)

For `test_policy_mandated`, `tests_documented_added` and `regression_tests_added50`.

CONTRIBUTING.md gains a **"Tests"** section (after slice 04), with this text:

> - Every pull request that adds or changes behaviour adds or updates automated tests in
>   the same pull request. Major new functionality is not merged without tests.
> - Every bug fix adds a regression test that fails without the fix. If that isn't
>   practical, say why in the pull request; a maintainer has to agree.
> - CI fails if statement coverage drops below 80 % for the server (`mix test --cover`) or
>   the extension (`npm run coverage`). The numbers appear on every pull request.
> - Tests never use the network: the server stubs HTTP with `Req.Test`, and the extension
>   tests serve their own pages.

The PR template's checklist gains: "Bug fix: a regression test fails without the fix (or
the pull request says why not)".

**`scripts/regression-audit.mjs`** (Node, no dependencies): lists the `fix` and `fix!`
commits on `main` in the last six months (`git log --since="6 months ago"`), marks each
one that changed a test file (`test/`, `server/test/`, `*.test.mjs`, `*_test.exs`) in the
same commit, and prints the ratio and the unmatched commits. It is not a CI gate
(exceptions are allowed by the policy); the badge steward runs it at each review (§7.6)
and pastes the output into the answer sheet.

#### 4.10 Keeping documentation current (P1)

For `documentation_current`.

- PR template box: "Docs updated where behaviour changed (README, `docs/`, the docs site),
  including `docs/security/` when an input or trust boundary changed".
- A `documentation` issue label; doc defects are triaged like bugs.
- Slice 30's release checklist (`docs/stores.md`) gains: "README, `docs/` and the docs site
  describe this release".
- CI checks relative links in Markdown (02 addition), so moved files don't leave dead links.
- Known defects at the time of writing: README describes swaps as replacing English
  ([50](../50-ui-localization-and-base-language/SPEC.md) fixes the wording) and the rename
  is in progress ([04](../04-rename-to-kotiko/SPEC.md)). Both are fixed by those slices,
  before registration.

#### 4.11 Badge answer sheet (P1; the passing part is P0)

**`docs/best-practices.md`**: one row per criterion for passing and silver (gold rows
added as they become true): id, status, the justification text exactly as entered on the
form, and the URL. It starts as a copy of §2 and §3 with the † removed for the items that
became true when the repository went public. The form is filled from this file, changes
to answers go through a pull request first, and reviewers can see the badge's claims
next to the code. The file links to the entry on bestpractices.dev.

### 5. Additions to other slices

Edited in those specs (each marks the addition as coming from this slice):

| Slice | Addition | Criteria |
|---|---|---|
| [02](../02-test-harness-and-ci/SPEC.md) §9 | Statement coverage with an 80 % gate for the server (Elixir's built-in cover, `test_coverage` threshold) and the extension (`c8 --all`), today's numbers and how to close the gap; `mix credo --strict`, `mix test --warnings-as-errors`, stricter ESLint; Prettier check for JavaScript, CSS and HTML; Sobelow and CodeQL; gitleaks with an allowlist for the two fake test keys; OSV-Scanner over both lockfiles; relative-link check | `test_statement_coverage80`, `test_most`, `warnings_strict`, `coding_standards_enforced`, `static_analysis_common_vulnerabilities`, `no_leaked_credentials`, `dependency_monitoring`, `documentation_current` |
| [30](../30-release-pipeline/SPEC.md) §11 | Signed release tags verified by the workflow; attestation of `SHA256SUMS` too; `docs/verify.md`; CycloneDX SBOM per release; "Security" and "Upgrade notes" sections in release notes; `docs/reproducible-builds.md` | `signed_releases`, `version_tags_signed`, `release_notes_vulns`, `maintenance_or_update`, `build_repeatable`, `external_dependencies` |
| [40](../40-server-packaging-docker/SPEC.md) §6 | `*_FILE` variants for every secret; reproducible release tarball check; uninstall for every installer; debug info option documented | `crypto_credential_agility`, `build_repeatable`, `installation_common`, `build_preserve_debug` |
| [44](../44-docs-site/SPEC.md) §9 | `/start/` is the quick start with a stable URL; contributor pages render `docs/` files instead of copying them; hardening headers decision for gold | `documentation_quick_start`, `documentation_current`, gold `hardened_site` |
| [01](../01-api-auth-hardening/SPEC.md) §7 | Hardening headers on every server response (P1) | `hardening` |
| [03](../03-oss-foundations/SPEC.md) Future work | GOVERNANCE and Scorecard bullets now point here | – |

The going-public checklist (`docs/PUBLIC_CHECKLIST.md`, slice 03 §6) gains two items when
it is next edited: "Register on bestpractices.dev and add the badge (slice 53 §7)" and
"Org owners: at least two; two-factor authentication required for the organization".

### 6. The DCO question

Silver's `dco` (a SHOULD) asks for "a legal mechanism where all developers of non-trivial
amounts of project software assert that they are legally authorized to make these
contributions", usually the Developer Certificate of Origin (a `Signed-off-by:` line in
each commit). Slice 03 §2 decided against it: contributions come in under Apache-2.0
section 5 ("inbound = outbound"), stated in CONTRIBUTING.md, with no CLA and no sign-off.
This slice does not change that. The two ways to answer the form:

- **Option A: keep the decision; mark `dco` unmet with a justification.** Proposed text:
  "Contributions are accepted under Apache-2.0 section 5 (inbound = outbound), stated in
  CONTRIBUTING.md. We don't require a sign-off: for a volunteer project with no plans to
  relicense, a failing sign-off check on a first pull request costs more than it adds. We
  will adopt the DCO if an organization asks to contribute substantial code." A SHOULD may
  be unmet with justification, so silver is still reachable. Section 5 licenses the
  contribution but doesn't make the contributor assert they had the right to, so claiming
  "Met" through it would be a stretch; this slice recommends against that.
- **Option B: adopt the DCO.** Install the [DCO GitHub App](https://github.com/apps/dco) on
  the repository and make its check required; turn on the organization setting "Require
  contributors to sign off on web-based commits" so edits in the GitHub web editor pass;
  add a "Sign-off" paragraph to CONTRIBUTING.md (what `Signed-off-by` means, a link to
  <https://developercertificate.org>, `git commit -s`, and how to fix a missing sign-off
  with `git rebase --signoff`); record the change in DECISIONS.md. Existing commits need no
  change. Cost: first pull requests fail more often for a non-code reason; the app's
  "individual remediation commit" lets a contributor fix it without rewriting history.

**Recommendation: Option A now**, revisit at the first substantial outside contribution
from a company or when preparing for gold, where it is still a SHOULD. This is Open
question 1; the coordinator records the answer in DECISIONS.md.

### 7. Applying for the badge

#### 7.1 Can a private repository be registered?

Not usefully. Read from the badge application's source
([coreinfrastructure/best-practices-badge](https://github.com/coreinfrastructure/best-practices-badge),
`projects_controller.rb` and the OmniAuth setup, 2026-10-02): "Log in with GitHub" asks
only for the `user:email` and `read:org` scopes, and the "Select one of your GitHub repos"
list asks GitHub for public repositories only. A private repository's URL can be typed in
by hand, and the form only checks that it is a URL, but then:

- the entry and every answer are public at once, describing a repository nobody can see;
- the site's automatic checks and the "people with push access may edit" rule can't see
  the repository;
- `repo_public` can't be met, so no badge is possible;
- the repository URL can be changed only once every 180 days, so registering
  `ScriptKittyOS/slovo` now would lock in the old name just before slice 04 renames it.

The criteria also state an implied rule: a project needs a public website with a stable
URL before an entry is created. So: prepare `docs/best-practices.md` while private, and
register on the day `ScriptKittyOS/kotiko` goes public.

#### 7.2 Before registering (P0, with the public release)

- Slice 04 has renamed the repository to `ScriptKittyOS/kotiko`.
- Slice 03's going-public checklist is done: repository public, private vulnerability
  reporting on, Issues and Discussions on, branch protection, Dependabot alerts.
- §4.1 and §4.2 are merged, and `docs/best-practices.md` holds the passing answers.

#### 7.3 Creating the entry and earning passing

1. Sign in at <https://www.bestpractices.dev> with "Log in with GitHub", using an account
   with push access to the repository.
2. Start a new project entry and pick `ScriptKittyOS/kotiko` from the list of your
   public repositories.
3. Basics: name "Kotiko"; description from the README's first sentence; homepage URL
   `https://github.com/ScriptKittyOS/kotiko` (it can change later to the docs site, see
   §8 `hardened_site`); repository URL the same; languages "Elixir, JavaScript, Shell";
   license `Apache-2.0`; entry language English.
4. Fill each section from `docs/best-practices.md`. Every "Met†" is now "Met". Give a URL
   for every "Met URL" criterion and text for every N/A that needs it.
5. Passing appears when every MUST is met or N/A and every SHOULD is met or justified.
6. Under "Additional rights", add the steward and every maintainer, so the entry doesn't
   depend on one login.

#### 7.4 The README badge

Within 48 hours of the badge (`documentation_achievements`), add next to the CI and
license badges:

```markdown
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/<id>/badge)](https://www.bestpractices.dev/projects/<id>)
```

The image shows the current level, so it needs no edit when silver arrives. The docs site
footer ([44](../44-docs-site/SPEC.md)) carries the same badge. README.md is not edited by
this slice now; the line is added in the pull request that records the badge.

#### 7.5 Silver

Fill the silver section as the work in §4 and §5 lands, in the order of §3's top gaps.
Before submitting: coverage gates green for at least a month, the continuity check done
and dated, the first signed release out with `docs/verify.md` followed by someone outside
the project, and `scripts/regression-audit.mjs` at 50 % or more.

#### 7.6 Keeping it current

- **Who**: the lead maintainer as badge steward (§4.3); the steward checks that it
  happens.
- **When**:
  - at every minor release, a release-checklist line: "Best-practices answers still true;
    `docs/best-practices.md` updated";
  - a full review every six months (January and July): re-read every answer, run
    `scripts/regression-audit.mjs`, copy the current coverage numbers, check the
    continuity check is less than a year old, update "Last reviewed" in `docs/`;
  - when the criteria change (watch the releases of the badge repository);
  - when something stops being true: fix it within 30 days or change the answer. A
    badge that is wrong for longer than that is worse than a lower badge.
- **How**: answers change in `docs/best-practices.md` by pull request first, then on the
  form.

### 8. Gold outlook

What will still be open after silver, and what to prepare now so that gold needs only
time, people and an outside review:

| Gold criterion | After silver | Prepare now |
|---|---|---|
| `achieve_silver` | Met | – |
| `bus_factor` (MUST) | Not met: one maintainer | §4.3 and §4.4's path to a co-maintainer; small tasks labelled; pair on a release |
| `contributors_unassociated` | Not met: needs two unassociated significant contributors in the past year | Welcome translators and contributors through Weblate and good-first issues; record contributions |
| `copyright_per_file` | Met already: SPDX copyright headers, `reuse lint` in CI | Keep `reuse lint` required |
| `license_per_file` | Met already: SPDX license headers | Same |
| `repo_distributed` | Met: git | – |
| `small_tasks` | Easy | Create `good first issue` and `help wanted` labels; link them from CONTRIBUTING.md; label S-size slices' first tasks |
| `require_2FA` | Easy | Turn on "Require two-factor authentication" for the ScriptKittyOS organization (going-public checklist) |
| `secure_2FA` (SHOULD) | Easy | GOVERNANCE.md asks maintainers to use passkeys, security keys or an authenticator app, not SMS |
| `code_review_standards` | Easy | `docs/CODE_REVIEW.md`: what reviewers check (tests and coverage, the security rules in CONTRIBUTING, the assurance case for new inputs, i18n rules, docs), and what blocks a merge |
| `two_person_review` | Not met: needs a second reviewer for at least 50 % of changes | The going-public checklist turns on branch protection with one review; when a co-maintainer exists, make that review required for everyone, including the lead. Automated or AI review doesn't count |
| `build_reproducible` | Partly: 30 builds byte-identical zips, but gold wants independent parties to reproduce | `docs/reproducible-builds.md` (30 addition) with exact toolchain versions so anyone can rebuild and compare hashes; slice 30's Future work "independent workflow" |
| `test_invocation` | Met | – |
| `test_continuous_integration` | Met | – |
| `test_statement_coverage90` | Not met | Ratchet the 80 % gate upward as coverage grows (02 addition); never lower it |
| `test_branch_coverage80` | Extension likely met (c8 shows 84.7 % branches today); server unknown | Erlang's cover tool measures lines, not branches. If no FLOSS Elixir branch-coverage tool exists at gold time, answer for the server with N/A and that justification; check again then |
| `crypto_used_network` (MUST) | Likely met: plain HTTP only when the owner sets `BIND` | Slice 01 Future work "optional built-in HTTPS" would remove the argument |
| `crypto_tls12` (MUST) | Met | – |
| `hardened_site` | Depends on the homepage | GitHub (the repository) sends the required headers; GitHub Pages can't set CSP or X-Frame-Options. Either keep the repository as the homepage URL or host the docs site where headers can be set (44 addition) |
| `security_review` | Not met | The criterion allows a review by project members, but the maintainer wants an outside sign-off. Requirements and assurance case (§4.7) and [54](../54-pre-release-security-review/SPEC.md)'s pre-release report are the reviewer's starting point; candidates: a security-experienced developer from another ScriptKittyOS project, or a funded audit (for example through OSTIF) |
| `hardening` (MUST) | Likely met after 28 §5 and the 01 addition | Keep the assurance case's hardening list current |
| `dynamic_analysis` (MUST) | Not met | Property-based tests (StreamData for the server's parsers, `fast-check` as a dev dependency for `url.js`, `validate-words.js` and the matcher) that run in CI; or an OWASP ZAP baseline scan against the test server |
| `dynamic_analysis_enable_assertions` (SHOULD) | Partly | Run the property tests and end-to-end suites with assertion-heavy checks enabled (for example invariants in the matcher behind a test-only flag) |

## Acceptance criteria

- [ ] `docs/reference/http-api.md` and `docs/reference/configuration.md` exist, and
      `docs_test.exs` fails when a route or a known variable is missing from them (P0).
- [ ] `SECURITY.md` contains §4.2's process, and `security@scriptkittyos.com` reaches two
      named people (P0).
- [ ] The entry on bestpractices.dev for `ScriptKittyOS/kotiko` shows passing within a
      week of the repository going public, and README links the badge within 48 hours of
      it (P0).
- [ ] `GOVERNANCE.md`, `MAINTAINERS.md`, `.github/CODEOWNERS`, `ROADMAP.md`,
      `docs/ARCHITECTURE.md`, `docs/governance/continuity.md`,
      `docs/security/requirements.md`, `docs/security/assurance-case.md`,
      `docs/CODING_STANDARDS.md` and `docs/best-practices.md` exist with the content in §4
      and a "Last reviewed" date.
- [ ] Every account in §4.4's inventory has two people with full control, checked by the
      steward and dated in `continuity.md`.
- [ ] CONTRIBUTING.md has the "Tests" section and the coding-standards line; the PR
      template has the regression-test and docs boxes.
- [ ] `scripts/regression-audit.mjs` prints the ratio for the last six months and is 50 %
      or more when silver is submitted.
- [ ] The additions in §5 are done in slices 02, 30, 40, 44 and 01 (their own acceptance
      criteria).
- [ ] Every silver criterion in `docs/best-practices.md` is Met, N/A with justification, or
      (for `dco` and `bus_factor` only) unmet with the justification in this spec; the entry
      shows silver.
- [ ] The answer sheet has been reviewed at least once on the §7.6 schedule after silver.

## Test plan

- Automated: `docs_test.exs` (§4.1); slice 02's coverage, lint, Prettier, Sobelow, CodeQL,
  gitleaks, OSV-Scanner and link jobs; slice 30's tag-signature and reproducibility checks.
- `scripts/regression-audit.mjs`: a unit test over a fixture git history (a temporary
  repository built in the test with three `fix` commits, two touching tests) expecting
  "2 of 3".
- Manual: someone outside the project follows `docs/verify.md` on the first signed
  release; the steward performs the continuity check; a second person reads
  `requirements.md` and the assurance case against the code and files issues for anything
  the documents claim that the code doesn't do.
- Before submitting each level: walk the form against `docs/best-practices.md` and open
  every URL.

## Rollout and migration

- **With the public release (P0)**: §4.1, §4.2, register and earn passing (§7.2 to 7.4).
- **The months after**: §4.3 to §4.11 and the additions in §5, then silver (§7.5). None of
  it changes the product's behaviour, except coverage work (more tests) and the server
  headers from 01's addition.
- README and CONTRIBUTING changes wait for slice 04's rename to merge, then land in one
  pull request per document.
- Changelog: none for documents; the release that adds signed tags and SBOMs says so in its
  notes ("Releases are now signed; see docs/verify.md").

## Open questions

1. **DCO (§6).** Keep slice 03's decision and mark `dco` unmet with a justification, or
   adopt the DCO with the GitHub DCO app? Recommendation: keep the decision for now (Option
   A); revisit at the first large company contribution or before gold.
2. **Who is the steward?** Someone trusted who would answer within a week, does not need to
   code, and becomes a second owner of the organization and the store accounts.
   Recommendation: a person already trusted with another ScriptKittyOS project, named
   before the public release so `security@` and the organization have two people from day
   one.
3. **Signed tags: maintainer key or keyless?** Option 1 (specified in 30's addition): the
   release manager signs the tag with their own SSH or GPG key and pushes it; the
   workflow verifies it against `.github/allowed_signers`. Option 2: the workflow signs
   the tag with Sigstore `gitsign` using its own identity, keeping "merge the release PR"
   as the only manual step. Recommendation: Option 1, because a human signature also
   serves gold's review story and the maintainer already signs commits.
4. **Prettier for JavaScript formatting.** It reformats the existing files once.
   Recommendation: yes, in one mechanical commit after slice 04 merges, with
   `printWidth: 100` to match the current code.
5. **Homepage URL on the badge entry.** The repository, or the docs site once slice 44
   ships? Recommendation: the repository until the docs site can send hardening headers
   (§8 `hardened_site`).

## Future work

- Gold (§8), once there is a second maintainer and an outside review.
- The OpenSSF Baseline levels 1 to 3 on the same site, which reuse much of this evidence.
- OpenSSF Scorecard workflow and badge (moved here from slice 03's Future work).
- A Spanish version of GOVERNANCE.md and the security requirements once the docs site's
  translation workflow exists (slices 44, 50).
- SLSA build level 3 for the release workflow.
