# Governance

Last reviewed: 2026-10-05.

How decisions are made in Kotiko, who holds which role, and how that changes. Who holds
each role today is in [MAINTAINERS.md](MAINTAINERS.md).

## How decisions are made

1. **Model.** Kotiko is maintainer-led. Day-to-day decisions are made in issues and pull
   requests by lazy consensus: a proposal with no unresolved objection from a maintainer
   after 7 days may proceed. The lead maintainer makes the final call when there is
   disagreement. Decisions that shape the product are recorded in
   [`slices/DECISIONS.md`](slices/DECISIONS.md) with who decided and why; plans live in
   [`slices/`](slices/README.md) as specs.
2. **Proposing a change.** Small fixes: a pull request. Anything that changes behaviour
   users see, data formats or the security model: an issue first, then a spec or a change
   to an existing spec in `slices/`, reviewed like code.
3. **Disputes.** Discussed on the issue; if unresolved after 14 days, the lead maintainer
   decides and records it in DECISIONS.md. Conduct problems follow
   [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md); a report about the lead maintainer goes to
   the steward.
4. **When there are three or more maintainers**, contested decisions go to a simple
   majority of maintainers, with the lead maintainer breaking ties. This switch happens
   automatically when MAINTAINERS.md lists a third maintainer.
5. **Becoming a maintainer.** Sustained, good-quality contribution over at least three
   months (code, review, docs or translation), nominated by a maintainer, with no
   objection from other maintainers within 7 days. Recorded by a pull request to
   MAINTAINERS.md.
6. **Stepping down.** Any time, by pull request. Maintainers inactive for 12 months move
   to "Emeritus" after a heads-up; their access is removed the same day
   ([continuity](docs/governance/continuity.md)).
7. **Changing this document**: a pull request open for at least 7 days, approved by all
   active maintainers (the lead maintainer while there is one).

## Roles

| Role | Responsibilities and required tasks |
|---|---|
| Lead maintainer | Final decisions; keeps DECISIONS.md and [ROADMAP.md](ROADMAP.md) current; owns the OpenSSF Best Practices entry and its reviews ([docs/best-practices.md](docs/best-practices.md)) |
| Maintainer | Reviews and merges pull requests; takes the weekly triage turn (every new issue gets a label and a first response within 7 days); approves the `release` environment; enforces CODE_OF_CONDUCT.md |
| Release manager | Runs releases (slice [30](slices/30-release-pipeline/SPEC.md)) and signs the release tag once signed tags exist; keeps the release checklist current |
| Security response lead | Runs the process in [SECURITY.md](SECURITY.md#what-happens-after-you-report); has a named backup; keeps the [assurance case](docs/security/assurance-case.md) current |
| Steward | Holds recovery access to every account in the [continuity plan](docs/governance/continuity.md) and runs the yearly continuity check; does not need to write code; becomes interim lead if the lead is gone |
| Locale reviewer | Signs off a launch locale before a release (slice [50](slices/50-ui-localization-and-base-language/SPEC.md)); one per locale |
| Contributor | Anyone who opens an issue or pull request; follows [CONTRIBUTING.md](CONTRIBUTING.md) and the code of conduct |

One person may hold several roles. While the project has one maintainer, that person holds
every role except steward.

## Accounts

Maintainers and the steward protect their GitHub and store accounts with two-factor
authentication, using a passkey, a security key or an authenticator app, not SMS.
