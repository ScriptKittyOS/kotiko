# Security policy

## Supported versions

Kotiko is before 1.0. Only the latest minor release gets security fixes.

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
