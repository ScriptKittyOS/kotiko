# Going public checklist

Tick these in the pull request that makes the repository public (at the first store
release, slice 30).

1. [ ] LICENSE, NOTICE and `reuse lint` pass; CONTRIBUTING, CODE_OF_CONDUCT and SECURITY
   are present.
2. [x] `gitleaks git --log-opts="--all" --config .gitleaks.toml` over the full history finds
   nothing, and `.env` and `*.db` files were never committed (checked 2026-10-05; CI's
   `secrets` job repeats the scan on every pull request).
3. [ ] No personal data in fixtures or docs (real word lists, Telegram IDs, emails).
4. [ ] Repository settings: private vulnerability reporting, Discussions and Issues on;
   Dependabot alerts and security updates on; secret scanning and push protection on;
   rulesets for `main` (pull requests with passing CI), release tags and secret files
   (all set 2026-10-05). Still to decide: one required review on `main` once a second
   maintainer exists (OpenSSF gold's `two_person_review`).
5. [ ] Description and topics set: `browser-extension`, `language-learning`, `vocabulary`,
   `elixir`, `self-hosted`, `firefox-addon`, `chrome-extension`.
6. [ ] A pull-request title check (`amannn/action-semantic-pull-request`, pinned by SHA)
   keeps squash commits conventional.
7. [ ] `security@scriptkittyos.com` reaches at least two people.
8. [ ] Register on bestpractices.dev and add the badge
   ([slice 53](../slices/53-openssf-best-practices/SPEC.md) section 7; answers in
   [best-practices.md](best-practices.md)).
9. [ ] Organization owners: at least two; two-factor authentication required for the
   organization.
10. [ ] Release setup from [docs/stores.md](stores.md#one-time-setup): the `release` and
    `store-status` environments, the `v*` tag ruleset, a signing key in
    `.github/allowed_signers`, and "Allow GitHub Actions to create and approve pull requests".
    Artifact attestations need the repository to be public, so the first release tag goes out
    after the flip.
