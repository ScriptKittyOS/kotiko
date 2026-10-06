# Access continuity

Last reviewed: 2026-10-05. Last continuity check: not yet done (see [Yearly
check](#6-yearly-check)).

How Kotiko keeps going if a key person is unavailable: who controls each account, who can
take over, and what happens in the first week. This file is public and holds no secrets.
Roles are defined in [GOVERNANCE.md](../../GOVERNANCE.md); who holds them is in
[MAINTAINERS.md](../../MAINTAINERS.md).

**Status today.** One maintainer holds every account. No steward is named yet (slice
[53](../../slices/53-openssf-best-practices/SPEC.md), open question 2), so the rules below
are the target, not yet met. The `ScriptKittyOS` GitHub organization already requires
two-factor authentication for its members (organization setting, checked 2026-10-05).

## 1. Inventory

"Not yet" in the holder columns means the account or the person doesn't exist yet.

| Asset | Controls | Primary holder | Backup holder | Recovery material | How to hand it over |
|---|---|---|---|---|---|
| GitHub organization `ScriptKittyOS` (owner role) | Repository settings, teams, Actions secrets, the `release` environment | Ayla Croft (@HackTuah), the only owner | Not yet (steward) | Recovery codes in the private record (section 3) | Add the person as an organization owner |
| Repository `ScriptKittyOS/kotiko` (admin) | Issues, pull requests, branch protection, security advisories | Ayla Croft, through the organization | Not yet | As above | Organization owners have admin on every repository |
| Chrome Web Store publisher account (slice [28](../../slices/28-privacy-and-store-readiness/SPEC.md) §9) | Listing and uploads | Not yet | Not yet | Not yet | Group publisher, or the Google account's recovery held by the steward |
| Google Cloud project for the store API (slice [30](../../slices/30-release-pipeline/SPEC.md) §4) | `CWS_*` credentials | Not yet | Not yet | Not yet | Add as project owner; rotate the credentials |
| addons.mozilla.org add-on (owner and developers) | Listing, signing, `AMO_JWT_*` keys | Not yet | Not yet | Not yet | Add as an owner on AMO |
| `ghcr.io/scriptkittyos` packages | Docker images (slice [40](../../slices/40-server-packaging-docker/SPEC.md)) | Not yet | Not yet | Through the GitHub organization | Organization owners control packages |
| `scriptkittyos.com` registrar, DNS and mailboxes | `security@`, `hello@` | To be recorded by the maintainer | Not yet | Private record | Registrar account transfer or recovery contact |
| `kotiko.org` on Cloudflare (registrar, DNS, proxy, Transform Rules) | Docs site domain and its headers (slice [44](../../slices/44-docs-site/SPEC.md)) | To be recorded by the maintainer | Not yet | Private record | Add as a Cloudflare account member with full access |
| Weblate project (slice [50](../../slices/50-ui-localization-and-base-language/SPEC.md)) | Translations | Not yet | Not yet | Not yet | Add as a project admin |
| bestpractices.dev entry | The OpenSSF badge's answers ([best-practices.md](../best-practices.md)) | Created 2026-10-06 by the lead maintainer: <https://www.bestpractices.dev/en/projects/15259> | Not yet | Through GitHub login | "Additional rights" on the entry |
| Tag-signing keys | Release tags (slice 30) | Each maintainer's own key, never shared, listed in MAINTAINERS.md | Not shared | Each holder's own | A new release manager adds their own key |

## 2. Rules

- Every asset has at least two people with full control: the organization has at least
  two owners (the steward is one); the Chrome Web Store account is a group publisher, or
  its Google account's recovery is held by the steward; AMO lists at least two owners; the
  domain registrar account has the steward as a recovery contact.
- No account depends on one person's phone for two-factor recovery: recovery codes are in
  the private record.

## 3. Private record

Recovery codes and shared account credentials live in an organization password-manager
vault shared with the steward (or a sealed copy held by the steward if no vault is used),
never in the repository. This file says where the record is, not what it holds. Where it
is: to be recorded here once the steward is named.

## 4. Legal rights

The code is Apache-2.0, so anyone may continue it. For what isn't (the name, logo and
illustrations in `brand/`, the domains), the maintainer leaves a written instruction (a
letter or a will clause, kept privately) that transfers or licenses them to the steward or
the organization's remaining owners. Status: not yet written.

## 5. Within one week of confirming that a key person is gone

The steward (or another owner):

1. announces it in GitHub Discussions;
2. grants maintainer rights to an active contributor, or acts as interim lead;
3. checks they can create and close issues, merge a pull request and approve a release;
4. rotates every credential the person held (slice 30 §6).

## 6. Yearly check

Every year, and whenever a role changes hands, the steward performs section 5's checks
without changing anything and records the date and the result here. The OpenSSF
`access_continuity` answer cites the latest date.

| Date | Who | Result |
|---|---|---|
| Not yet done | | |

## Bus factor

Today it is 1: one person has written and can release everything. The plan to raise it:
architecture ([ARCHITECTURE.md](../ARCHITECTURE.md)), the security argument
([assurance case](../security/assurance-case.md)) and coding standards
([CODING_STANDARDS.md](../CODING_STANDARDS.md)) are written down, and every slice in
[`slices/`](../../slices/README.md) is a buildable spec, so a second maintainer can start
without reading every file first.
