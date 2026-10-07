# 54 · Pre-release security review

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before the first store submission) |
| **Size** | M (about a week, most of it fixing what is found) |
| **Depends on** | Every other P0 slice merged; the gate runs on a frozen release candidate. Uses [28](../28-privacy-and-store-readiness/SPEC.md) §7's exposure audit and [53](../53-openssf-best-practices/SPEC.md) §4.7's security requirements and assurance case as starting points |
| **Unblocks** | [30](../30-release-pipeline/SPEC.md)'s first upload to the Chrome Web Store and Firefox Add-ons |
| **Sources** | [DECISIONS 2026-10-02, "Three independent security reviews before the stores"](../DECISIONS.md); [04 security](../../docs/research/04-architecture-release.md); [06](../../docs/research/06-adversarial-qa.md) |

## Problem

Kotiko reads every page a learner visits, holds their AI provider key and their server's
access key, runs model output through the page, and (with a server) exposes an HTTP API and
a Telegram bot. Each slice has its own security checks, and slice 28 audits secrets and page
exposure, but nobody has yet attacked the whole system at once, from the outside, the way a
hostile page, a hostile model answer or a hostile network would. Once Kotiko is in the
stores, an update takes days to reach users and a store takedown takes the project with it.

The maintainer's requirement: "a full security run with 3 independent reviewers all bringing
reports back and you reviewing them, ensuring they bring proof of any claims."

## Goals

- Three reviewers examine the whole release candidate independently and each writes a
  report.
- Every claim in a report, including "this is safe", carries proof that someone else can
  check (section 4).
- The lead reviewer reproduces or refutes every finding; only proven findings count, and
  rejected ones are listed with the reason.
- Every proven finding of medium severity or higher is fixed, with a regression test,
  before the first store upload; lower ones are fixed or recorded as accepted risks with a
  reason.
- The combined report is kept in the repository and feeds the assurance case (53 §4.7).

## Non-goals

- The OpenSSF gold `security_review` criterion's outside sign-off: the maintainer wants a
  person outside the project for that (53 §8). This review is the release gate, not a
  substitute; its report is that person's starting material.
- A bug bounty, or ongoing scanning in CI (Dependabot, `mix deps.audit` and the rest stay in
  [02](../02-test-harness-and-ci/SPEC.md)).
- Penetration testing of third-party services (OpenRouter, other providers, Telegram,
  the stores).

## User stories

- As the maintainer, I want to know before release that a web page can't steal my key or
  my words, with proof rather than reassurance.
- As a learner installing from a store, I want an extension that was attacked on purpose
  before it reached me.
- As a future outside auditor, I want to read what was tested, how, and what was found.

## Specification

### 1. When it runs

1. All other P0 slices are merged. The maintainer tags a release candidate
   (`vX.Y.Z-rc.1`); that commit is frozen for the review.
2. The three reviews run at the same time, each on a clean checkout of the tag.
3. Fixes land on `main` as normal pull requests. The fixed commit is tagged `-rc.2`, and a
   fresh reviewer (section 6) checks the fixes before the gate closes.
4. A security-relevant change merged after the gate closes and before the upload
   (anything touching the threat areas in section 3) reopens the review for that change.

### 2. The reviewers and their independence

Three reviewers, A, B and C. They may be people or AI agents; with agents, each runs in a
fresh session with no shared context, memory or files beyond the tagged checkout and this
spec. No reviewer sees another's notes or report until all three are in. Each reviewer
covers the **whole scope** in section 3, so overlap between reports is a signal, not waste,
but each starts from a different attacker, so that their blind spots differ:

| Reviewer | Starts as | First questions |
|---|---|---|
| A | A hostile web page, and a hostile or confused model answer | Can page script read the key, the token, the word list or Kotiko's DOM? Can a page or a model answer inject markup or script into the popover, popup, dashboard or welcome tab? Can a page make Kotiko send a privileged message, fetch an address, or spend the learner's quota? |
| B | A network neighbour, a malicious local process, a Telegram stranger | Can anyone but the owner reach the server's API (auth, Host allowlist, DNS rebinding, `BIND`)? Can the bot be driven by a stranger? Are inputs (imports, bulk files, API bodies) bounded and validated? Is anything sent in clear text by default? |
| C | A supply-chain and release attacker | Dependencies, lockfiles, CI workflows (`pull_request_target`, token scopes, pinned actions), the extension package (what's inside the zip, CSP, permissions, `web_accessible_resources`), secrets in the repository or its history, privacy claims against what the code actually sends |

The lead reviewer (the maintainer, or the agent the maintainer runs the gate with) is none
of the three.

### 3. Scope

The tagged release candidate: `extension/` (background, content scripts, popup, dashboard,
welcome tab, popover, `lib/`), `server/` (HTTP API, auth, the Telegram bot, the database and
its migrations, config), `spec/` data the runtimes load, `scripts/`, `.github/`, the built
extension zips for Chrome and Firefox, and the store listing and privacy policy text (28)
read against the code.

Threat areas every reviewer checks, each answered in the report with proof either way:

1. Secrets: provider key, server token, Telegram token; where stored, who can read them,
   whether they reach logs, errors, exports or the page.
2. Page isolation: what page script can observe or change (DOM attributes, the popover's
   shadow root, events, timing), and what Kotiko trusts from the page.
3. Injection: page text, model output, imported files and server responses into the DOM
   (markup and script), into prompts (prompt injection that adds words or exfiltrates data),
   into SQL, into CSV and Anki exports (formula injection), into logs.
4. Messaging: every `runtime.onMessage` and port handler; sender checks; what a content
   script can ask the background to do.
5. Network: which origins the extension and server contact, with which permissions;
   URL validation (slices 11 and 26); SSRF through a configurable provider or server
   address; TLS defaults.
6. Server: deny-by-default auth, the Host allowlist, body limits, rate limits, the bot's
   owner check and pairing, file permissions on `.env` and the database.
7. Resource exhaustion: huge pages, huge vocabularies, huge imports, quota-burning loops.
8. Supply chain and build: dependencies and their audits, CI permissions, what ships in
   the zips, reproducibility (30).
9. Privacy: every claim in the privacy policy and listings (28) checked against what the
   code sends, stores and logs.

### 4. Proof

A finding without proof is not a finding. Each one in a report has:

| Field | What it holds |
|---|---|
| ID | `A-03`, `B-11`, … |
| Title and severity | Critical, high, medium, low or informational, with one sentence on why (what an attacker gains, what they need) |
| Location | `path:line` at the tagged commit, for every place involved |
| Proof | At least one of: a reproduction a reader can run (commands, a proof-of-concept page under `test/security/poc/`, a request), a failing test, or for a configuration issue the exact setting and its effect |
| Observed | The actual output, screenshot or log from running the proof, not a prediction of it |
| Fix | A suggested fix, and the test that would catch a regression |

"Checked, no issue" answers need proof too: what was checked, how (the test, the request,
the grep), and what came back. "Looks fine" or "probably safe" is recorded as **not
checked**.

Reviewers write proofs against a local test server and a test profile, never a real key, a
real Telegram bot or the maintainer's data; fake providers come from slice 02's harness.

### 5. The lead review

The lead reviewer reads the three reports after all are in, then for each finding:

1. Reruns the proof on the tagged commit. A finding is **confirmed** only when the lead
   sees the observed result themselves; **rejected** when the proof fails or doesn't show
   what it claims (with the reason); **needs proof** when it's plausible but unproven, in
   which case the lead tries to prove or disprove it, and it ends confirmed or rejected.
2. Merges duplicates across reports (keeping every reviewer's ID), and settles the severity.
3. Compares coverage: a threat area that only one reviewer checked, or that two reviewers
   answered differently, is checked again by the lead with proof.

The output is `docs/security/review-<tag>.md`: scope and commit, the reviewers and how they
were kept independent, a table of every finding (confirmed, rejected or accepted, with
severity and the fix's pull request), the threat-area coverage matrix (area by reviewer:
checked with proof, not checked), and the three original reports appended unchanged under
a `## Appendix` heading (nothing of the lead's own goes below that heading). While
the repository is private it holds full details; when it goes public, unfixed low findings
are summarised without exploit steps (SECURITY.md's disclosure rules, 03).

### 6. Fixing and closing

- Every confirmed critical, high or medium finding is fixed before the upload. Each fix
  comes with a regression test that fails before the fix (the reviewer's proof, turned
  into a test where possible) and passes after.
- Low and informational findings are fixed or recorded in the report as accepted risks
  with a reason, and as issues.
- A fourth reviewer, fresh and independent like the first three, reruns every confirmed
  finding's proof against `-rc.2` and confirms it no longer works, then the lead closes the
  gate with a line in the report and a box on 30's release checklist. The line has exactly
  this form, on a line of its own, above the `## Appendix` heading:
  `Gate: closed YYYY-MM-DD by <lead>, fixes confirmed on vX.Y.Z-rc.N` (for example
  `Gate: closed 2026-11-02 by Ayla Croft, fixes confirmed on v1.0.0-rc.2`), naming a
  candidate of the reviewed version. Until then the report says `Gate: open`; the part
  above the appendix has only one line starting `Gate:`, read as a reader sees it (after
  NFKC, without invisible characters, with any non-ASCII character standing in for a letter
  of "Gate"; security review D-05), and the closed line is plain ASCII. 30's release workflow checks for
  the closed line before any store upload (`scripts/check-security-gate.mjs`): anything
  else, including the phrase inside an appended report, keeps the gate open (security
  review C-05).
- Confirmed findings feed 53 §4.7's assurance case and, for issues in shipped code, 53
  §4.2's vulnerability process.

## Acceptance criteria

- [ ] Three reports exist, written independently from the same tagged commit, each covering
      all nine threat areas.
- [ ] Every finding and every "no issue" answer in them carries proof as section 4
      defines; anything without it is marked not checked or rejected.
- [ ] The lead reran every finding's proof, and the combined report lists each as
      confirmed, rejected (with reason) or accepted risk.
- [ ] No confirmed critical, high or medium finding is open; each fix has a regression test
      that fails without it.
- [ ] A fresh reviewer confirmed the fixes on the final candidate.
- [ ] `docs/security/review-<tag>.md` is committed, and 30's release checklist box is ticked.

## Test plan

- The proofs themselves: each confirmed finding's proof becomes a test (unit, jsdom,
  Playwright or ExUnit, slice 02) or a script under `test/security/` that CI runs.
- Before the run, a dry run of the process on one threat area (secrets) checks that
  reviewers can start the test server and the extension from the checkout alone.

## Rollout and migration

- Runs once before the first store submission, then again before any release that changes
  permissions, messaging, storage of secrets, the server's API or the bot, and at least once
  a year.
- Changelog: none for the review itself; fixes get their own entries.

## Open questions

1. **People or agents?** Recommendation: three AI agents in separate sessions for this
   gate, with the maintainer as the final reader of the lead's report; the outside human
   review stays the goal for gold (53 §8).
2. **Should the reports be published when the repository goes public?** Recommendation:
   yes, after fixes, with unfixed low findings summarised; openness is part of the badge.

## Future work

- An outside review by a security-experienced person or a funded audit (OSTIF), which also
  meets gold's `security_review`.
- Fuzzing and property tests from 53 §8's `dynamic_analysis` row, seeded with this review's
  proofs.
