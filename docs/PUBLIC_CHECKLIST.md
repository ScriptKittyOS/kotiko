# Going public checklist

Tick these in the pull request that makes the repository public (at the first store
release, slice 30).

1. [ ] LICENSE, NOTICE and `reuse lint` pass; CONTRIBUTING, CODE_OF_CONDUCT and SECURITY
   are present.
2. [ ] `gitleaks detect --log-opts="--all"` over the full history finds nothing;
   `server/.env` and `*.db` files were never committed.
3. [ ] No personal data in fixtures or docs (real word lists, Telegram IDs, emails).
4. [ ] Repository settings: private vulnerability reporting, Discussions and Issues on;
   squash merge only, with the PR title as the commit message; branch protection on
   `main` requiring CI and one review; Dependabot alerts on.
5. [ ] Description and topics set: `browser-extension`, `language-learning`, `vocabulary`,
   `elixir`, `self-hosted`, `firefox-addon`, `chrome-extension`.
6. [ ] A pull-request title check (`amannn/action-semantic-pull-request`, pinned by SHA)
   keeps squash commits conventional.
7. [ ] `security@scriptkittyos.com` reaches at least two people.
