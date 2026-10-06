# Code review

Last reviewed: 2026-10-06.

How a change to Kotiko is reviewed: who reviews, what they check, and what a change needs
before it merges. It applies to every pull request, from a maintainer, a contributor or an
agent. The rules contributors follow while writing a change are in
[CONTRIBUTING.md](../CONTRIBUTING.md); this page is the reviewer's side.

## How a review happens

1. **CI first.** A reviewer starts once the required checks on `main` are green. They are
   listed in the `main` ruleset and include the server and extension test suites, lint,
   e2e, the shared spec, the secret, DCO and file checks, the dependency scan and CodeQL.
   A red check is the author's to fix, not the reviewer's to wave through.
2. **One reviewer who isn't the author** reads the whole diff on GitHub and leaves a
   review: *Approve*, or *Request changes* with each problem as a comment on its line.
   While Kotiko has few maintainers, the lead maintainer may merge their own change after
   CI passes. GOVERNANCE.md and MAINTAINERS.md say who the maintainers are, and the aim
   is that every change gets a second person's review.
3. **Every review thread is resolved** before merging (the ruleset enforces this),
   either by a change or by a reply the reviewer accepts.
4. **Merge** with a merge commit. The author or a maintainer merges; nobody bypasses the
   ruleset.

## What the reviewer checks

Each item is a question the change must answer yes to, or explain why not.

**It does what it says.**
- The pull request says what changed and why, links its slice or issue, and the diff
  matches that description. Nothing unrelated is mixed in.
- The behaviour matches the slice's spec. A deviation is written in the spec's
  Implementation notes.

**It is tested.**
- New or changed behaviour has tests in the same pull request. A bug fix has a regression
  test that fails without the fix: check it by reading the test against the fix.
- Tests wait for conditions, never fixed sleeps, and never reach the network or a real
  local service.
- The coverage gates still pass (90 % of lines, 80 % of the extension's branches).

**It keeps users safe.**
- **Trust boundaries hold.** Content scripts never see keys, tokens or where requests go.
  Only Kotiko's own pages change the server or lookup destination. Every message type
  says who may send it (`lib/messages.js`).
- **Input is validated** where it enters, against an allowlist, with its limits. The
  server's checks are in `docs/security/assurance-case.md` section 6.
- **No HTML from data:** text goes in with `textContent`, never `innerHTML` (ESLint also
  enforces this).
- **Privacy:** page text never leaves the device, only the word goes to Wiktionary, and
  every new network call, host or permission is in `docs/privacy/inventory.md` (a test
  checks this).
- No secret or user text reaches a log above debug level.
- A change to authentication, a trust boundary or an input updates the
  [assurance case](security/assurance-case.md) and, if users can tell, the
  [security requirements](security/requirements.md).
- A new dependency meets the license rule and the
  [dependency policy](security/dependency-and-static-analysis-policy.md). The extension
  gets no runtime npm code.

**It works for every learner.**
- Nothing assumes English or one base language. Shared tables are in
  `spec/lang/_generic/`, with per-language entries only where the default visibly fails.
- Every UI string is in `extension/_locales/en`.
- Accessibility holds: keyboard, focus and contrast in both themes (the axe and contrast
  checks run in CI).
- The popup's size and first-paint budgets pass (`npm run perf`).

**It is complete.**
- Docs say what changed: the reference docs for routes and settings (a test checks
  them), the site's guides, and a plain-language `CHANGELOG.md` line under
  `## Unreleased`.
- Every commit is signed off (DCO) and follows Conventional Commits.

## The standard of evidence

A claim in a pull request or a review ("fixed", "faster", "not reachable", "no
regression") carries its proof: the test that fails without the change, or the command
that was run and what it printed. "Should work" is not proof. A reviewer who doubts a
claim reruns its proof. Security findings follow the same rule, as in the pre-release
review (slice [54](../slices/54-pre-release-security-review/SPEC.md)).

## Changes written by agents

An agent's change is reviewed like anyone else's. When a lead agent hands work to other
agents, the lead also reads every diff, checks each acceptance criterion against a test,
and reruns every check before opening the pull request. A maintainer still decides
whether it merges.
