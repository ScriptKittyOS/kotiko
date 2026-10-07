# Security policy

## Supported versions

Only the latest release gets security fixes: from 1.0.0 on (the first store release, still pending), the latest 1.x. Release candidates (`vX.Y.Z-rc.N` pre-releases, for review) and versions older than 1.0.0 get none.

## Reporting a vulnerability

Please report privately. Don't open a public issue.

- **Preferred:** GitHub's private vulnerability reporting. Open the repository's
  **Security** tab and choose **Report a vulnerability**.
- **No GitHub account:** email `security@scriptkittyos.com`.

Please include:

- what an attacker can do, and what they need first (network access, a web page the user
  visits, access to the user's machine);
- steps to reproduce, ideally with a request or a small page;
- the Kotiko version, browser and operating system.

We acknowledge reports within 7 days and send a fix or a plan within 30. If you'd like
credit, we'll name you in the release notes.

## What happens after you report

1. **Acknowledge** within 7 days, from a maintainer named in
   [MAINTAINERS.md](MAINTAINERS.md).
2. **Triage**: we reproduce the problem, decide whether it is in scope, and rate it with
   [CVSS v4.0](https://www.first.org/cvss/v4.0/). We tell you the rating and the plan.
3. **Fix privately** in a GitHub draft security advisory with a temporary private fork.
   You can be added to the advisory to review the fix.
4. **Targets** from triage to a released fix: critical 7 days, high 30 days, medium 60
   days, low in the next planned release. If we will miss a target, we tell you why.
5. **CVE**: for medium severity and above, we request a CVE through GitHub when we
   publish the advisory.
6. **Release**: a patch release whose notes have a "Security" section listing the
   advisory, the CVE, the severity and, unless you ask otherwise, your name.
7. **Disclose**: the advisory is published with the release. We ask reporters to keep
   details private until then or for 90 days from the report, whichever comes first.
8. **Afterwards**: the fix includes a regression test, and the
   [assurance case](docs/security/assurance-case.md) is updated if the problem crossed a
   trust boundary.

If the problem is in a dependency, we report it upstream and ship a pinned or patched
version in the meantime.

We also look for problems ourselves: every pull request and every release is checked for
known vulnerabilities in our dependencies and for security weaknesses in our code. What
blocks a merge or a release, how fast findings are fixed, and how a false positive is
accepted are in the
[dependency and static analysis policy](docs/security/dependency-and-static-analysis-policy.md).

The security response lead named in [MAINTAINERS.md](MAINTAINERS.md) runs this process;
[GOVERNANCE.md](GOVERNANCE.md) describes the role.

## Scope

In scope:

- the server: authentication, token handling, request parsing, anything reachable
  over the network;
- the extension's own pages (popup, dashboard, welcome tab) and how they store keys and
  tokens;
- anything Kotiko runs on web pages, including what a page can learn about the user from it.

Out of scope:

- a self-hosted server deliberately exposed without a token or over plain HTTP against
  the documentation's advice;
- problems in Telegram, OpenRouter or other model providers themselves.
