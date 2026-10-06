# Dependency and static analysis policy

Last reviewed: 2026-10-06.

How Kotiko finds known vulnerabilities in its dependencies and security weaknesses in its
own code, what blocks a merge or a release, how fast findings are fixed, and how a finding
that can't be exploited is accepted. Every rule below is enforced by the CI named next to
it, unless it says "by review".

## Scope

- **Runtime**: what ships to users. The server's Hex dependencies outside `only: :dev`/
  `:test` (in `server/mix.lock`), and code the docs site build puts into its pages. The
  extension ships no npm code at all ([CONTRIBUTING.md](../../CONTRIBUTING.md)).
- **Dev-only**: everything else in the three lockfiles: the dev tools in
  `package-lock.json` (tests, lint, store upload), the site's build tools in
  `site/package-lock.json`, and the server's dev and test dependencies. They never reach a
  user, but they run in CI and on contributors' machines, so they are scanned too.
- **Our code**: the extension, scripts, tests and site (JavaScript), the server (Elixir),
  shell scripts and the GitHub Actions workflows.

## Dependencies (software composition analysis)

What runs:

| Check | Covers | When | Fails on |
| --- | --- | --- | --- |
| OSV-Scanner ([`dependency-scan.yml`](../../.github/workflows/dependency-scan.yml)) | All three lockfiles, runtime and dev-only | Every pull request, every push to `main`, every Monday, and before every release build | Any known vulnerability or malicious-package report in the [OSV database](https://osv.dev), any severity, not accepted in [`osv-scanner.toml`](../../osv-scanner.toml) |
| `mix deps.audit` ([`ci.yml`](../../.github/workflows/ci.yml), server job) | `server/mix.lock` | Every pull request and push to `main` | Any advisory in mix_audit's database |
| `mix hex.audit` (same job) | `server/mix.lock` | Same | A retired Hex package |
| Dependabot ([`dependabot.yml`](../../.github/dependabot.yml)) | mix, both npm lockfiles, Actions | Weekly | Opens update pull requests; nothing to fail |

**Blocks a merge**: any finding above. They run on every pull request, and a pull request
merges only when the required checks of the `main` ruleset pass. A new advisory against a
version already on `main` turns every pull request red until it is fixed or accepted, so
nobody can merge around it. `osv-scanner` and the server job (with both mix audits) are
required checks.

**Blocks a release**: the release workflow ([`release.yml`](../../.github/workflows/release.yml))
runs the same OSV-Scanner job before it builds anything; when it fails, nothing is built,
attested, released or sent to a store. There is no override other than an accepted
exception in `osv-scanner.toml` on the tagged commit.

**Deadlines**, counted from the day the advisory is published (the Monday scan finds those
nobody pushed against):

| Severity (CVSS, as OSV reports it) | Runtime | Dev-only |
| --- | --- | --- |
| Critical | Fixed release within 7 days | Updated or accepted within 7 days |
| High | Fixed release within 30 days | Updated or accepted within 30 days |
| Medium | Fixed release within 60 days | Updated or accepted within 90 days |
| Low or unknown | In the next planned release | Updated or accepted within 90 days |

These are the same targets as a reported vulnerability ([SECURITY.md](../../SECURITY.md)).
"Fixed" means an updated or patched version; if upstream has no fix, we pin, patch or
replace the package, or remove the code path that uses it.

**Licenses** (by review, not CI: OSV-Scanner has no license data for Hex packages). The
rule follows the Apache Software Foundation's
[third-party license policy](https://www.apache.org/legal/resolved.html), the usual
reference for what an Apache-2.0 project may ship:

- **Allowed** in anything Kotiko ships (the extension, the server, the shared spec data,
  the docs site), the ASF's Category A: Apache-2.0, MIT and MIT-0, BSD-2-Clause,
  BSD-3-Clause, ISC, 0BSD, Zlib, BSL-1.0, Unlicense, Unicode-3.0 (data), and CC0-1.0 or
  public domain. On 2026-10-06 every server runtime dependency is Apache-2.0 or MIT, the
  SQLite that exqlite bundles is public domain, and the shipped data is Unicode-3.0 (CLDR)
  and MIT (stopwords-iso); the extension ships no npm code.
- **Allowed only unmodified, and labelled in NOTICE**, the ASF's Category B, each one
  recorded in [slices/DECISIONS.md](../../slices/DECISIONS.md) before it merges: MPL-2.0 and
  EPL-2.0 libraries, OFL-1.1 fonts, and CC-BY-4.0 media or data.
- **Not allowed** in anything Kotiko ships, the ASF's Category X: GPL, LGPL and AGPL (any
  version), SSPL, BUSL, the Commons Clause and other field-of-use or non-commercial terms,
  and code with no license or a custom one.

Dev-only tools (tests, linters, build tools that put none of their code in what ships)
may use any [OSI-approved](https://opensource.org/licenses) license. The reviewer checks the license when a pull request adds a dependency or a
Dependabot update changes one; a violation found later is replaced or approved before the
next release. Each release's server SBOM (`kotiko-server-<version>.cdx.json`) lists the
runtime dependencies and their licenses.

## Our code (static analysis)

What runs, all on every pull request and push to `main`:

| Tool | Covers | Fails on |
| --- | --- | --- |
| Sobelow (`mix sobelow`, settings in [`server/.sobelow-conf`](../../server/.sobelow-conf)) | The server, its mix tasks, migrations and scripts: SQL and command injection, path traversal, unsafe `binary_to_term`, atom exhaustion, insecure configuration | Any finding, at any confidence |
| CodeQL ([`codeql.yml`](../../.github/workflows/codeql.yml), also weekly) | JavaScript everywhere; the workflows (script injection, untrusted checkouts, token permissions) | Alerts appear in the Security tab and in the "Code scanning results" check |
| ESLint with eslint-plugin-no-unsanitized, `web-ext lint` | The extension and scripts: HTML injection sinks, unsafe extension patterns | Any error |
| Credo, ShellCheck | Elixir and shell code quality | Any issue |

**Blocks a merge**: any Sobelow, ESLint, web-ext, Credo or ShellCheck finding (their jobs
are required checks). A CodeQL alert of security severity high or critical, or of severity
error, blocks the merge: the `main` ruleset requires code scanning results from CodeQL at
those thresholds (since 2026-10-06), and requires `osv-scanner`, `analyze (actions)` and
`analyze (javascript-typescript)` as checks.

**Deadlines** for findings on `main` (a new CodeQL query, a new Sobelow release): an
exploitable one is a vulnerability and follows the [SECURITY.md](../../SECURITY.md)
targets (critical 7 days, high 30, medium 60, low in the next planned release). Every
CodeQL alert, of any severity, is fixed or dismissed with a reason before the next release.

## Accepting a finding that can't be exploited

Only when the finding is a false positive, or the vulnerable code can't be reached in the
way Kotiko uses it (for example a dev-only tool that never handles untrusted input). A
reachable finding in runtime code is never accepted; it is fixed.

Each acceptance is a pull request a maintainer reviews, and it is recorded where the
check reads it:

- **Dependency**: an `[[IgnoredVulns]]` entry in [`osv-scanner.toml`](../../osv-scanner.toml)
  with the advisory `id`, a `reason` (why it isn't exploitable, with evidence, and what we
  are waiting for), and an `ignoreUntil` date at most 30 days ahead for critical or high
  and 90 days for the rest. After that date the scan fails again, and renewing it is a new
  review. Remove the entry once the dependency is updated. `mix deps.audit` has no skip
  list: the same advisory goes in its `--ignore-advisory-ids` in `ci.yml`, under a comment
  with the same reason and date.
- **Sobelow**: a `# sobelow_skip ["Check.Name"]` comment directly above the function, under
  a comment saying why the finding is false. Never `ignore` a whole check in
  `.sobelow-conf` without changing this policy.
- **CodeQL**: dismiss the alert in the Security tab as "False positive" or "Used in tests"
  with a comment saying why; GitHub keeps who dismissed it and when.
- **ESLint**: an `eslint-disable-next-line <rule> -- <reason>` comment.

Accepted findings today: none in `osv-scanner.toml`; the Sobelow skips are all
`Traversal.FileModule` on file paths that come from the server's own settings or an
operator's command line, never from a request.

## Running the checks yourself

```bash
cd server && mix sobelow && mix deps.audit && mix hex.audit
# OSV-Scanner: download a release from github.com/google/osv-scanner, then
osv-scanner scan source --config osv-scanner.toml \
  -L package-lock.json -L site/package-lock.json -L server/mix.lock
```

If `mix sobelow --version` doesn't print the version in `server/mix.lock`, a globally
installed Sobelow archive is shadowing the project's; remove it with
`mix archive.uninstall sobelow`.
