# Contributing to Kotiko

Kotiko swaps words on web pages, in your own language, for the words you're learning in any
other language. It's
a free, open-source project from ScriptKittyOS, and contributions are welcome.

## Where decisions live

The roadmap is in [`slices/`](slices/README.md): one folder per piece of work, each with a
`SPEC.md` written to the same template. Decisions already made are in
[`slices/DECISIONS.md`](slices/DECISIONS.md); please don't reopen them in a pull request.

To help: pick a slice, comment on its issue so others know, and open a pull request.

## Setup

You need Elixir 1.15 or newer and Node 22.

```bash
# server
cd server
mix deps.get
mix test

# extension and end-to-end tests (from the repository root)
npm ci
npm test
npx playwright install chromium
npm run e2e
```

To try the extension, open `chrome://extensions`, turn on Developer mode, choose
**Load unpacked** and pick the `extension` folder. The [README](README.md) covers running
the server.

## Rules that protect users

- **Text only.** Never put word data or page content into `innerHTML` or similar; use
  `textContent` and DOM methods. ESLint enforces this.
- **No runtime npm dependencies and no bundler in the extension.** What's in `extension/`
  is what ships, so store reviewers can read it as is.
- **No user text in logs** above debug level: no words, no page content, no keys.
- **No external network in tests.** Tests serve their own pages and fake servers.
- **One name.** `node scripts/check-old-name.mjs` (run in CI) fails on the project's names
  from before Kotiko outside history, research and the code that moves old data; mark a
  line that must name them with a `legacy-name-ok` comment.

## Commits and pull requests

- Commit messages and pull request titles follow
  [Conventional Commits](https://www.conventionalcommits.org/): `feat(extension): ...`,
  `fix(server): ...`. Scopes: `server`, `extension`, `spec`, `docs`, `ci`, `release`.
  Mark breaking changes with `!`.
- Changes to the model prompt or validation include the evaluation summary from
  [slice 09](slices/09-shared-word-spec-and-prompt/SPEC.md).
- Before 1.0, a minor release may change the HTTP API only if the old route keeps working
  for one more minor version.

## Licensing

Kotiko is licensed under [Apache-2.0](LICENSE). By submitting a contribution, you license it
under the same terms (section 5 of the license); there is no CLA and no sign-off to add.

New source files start with an SPDX header:

```
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0
```

(`#` for Elixir and shell, `<!-- -->` for HTML, `/* */` for CSS.) Files that can't hold
comments, such as JSON and images, are covered by `REUSE.toml`.

The logo and illustrations in `brand/` are the project's trademark and aren't covered by
the code license.

## Questions

Ask in GitHub Discussions. For security issues, see [SECURITY.md](SECURITY.md).
