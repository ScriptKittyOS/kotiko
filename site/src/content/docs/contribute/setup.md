---
title: Developer setup
description: Run Kotiko's extension, server, tests and docs site from a clone of the repository.
---

You need Node 22 and, for the server, Elixir 1.15 or newer.

```bash
git clone https://github.com/ScriptKittyOS/kotiko.git
cd kotiko
```

## The extension

The `extension` folder is what ships: no bundler and no runtime npm dependencies, so store
reviewers can read it as it is.

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Select **Load unpacked** and choose the `extension` folder.
3. After a change, select the reload button on Kotiko's card.

In Firefox, open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on…** and
choose `extension/manifest.json`.

## Tests and checks

From the repository root:

```bash
npm ci
npm run lint            # ESLint and web-ext lint
npm test                # unit, DOM and background tests
npx playwright install chromium
npm run e2e             # end-to-end tests in Chromium with the unpacked extension
```

CI runs more checks (the shared spec, versions, licenses, the old name); the full list is in
`.github/workflows/ci.yml`.

## The server

```bash
cd server
mix deps.get
mix test
cp .env.example .env && chmod 600 .env   # then fill in LLM_API_KEY
./run.sh
```

[Your own Kotiko server](/server/) explains running it, and the
[configuration reference](/server/configuration/) every setting.

## The docs site

This site lives in `site/` (Astro Starlight) with its own `package.json`. It pulls the
privacy policy, the references and the contributor documents from the repository when it
builds, so edit those files, not their copies.

```bash
cd site
npm ci
npm run dev            # http://localhost:4321
npm run build          # writes dist/
npm run check          # links, stable URLs, error anchors, no third-party URLs
npm test               # the site's own tests
npx playwright install chromium
npm run e2e            # accessibility (light and dark) and network checks of every page
```

The site makes no request to any other host, so it never uses web fonts, analytics or
embeds. Store links come from `site/src/config.ts`.

## Layout

```
extension/                   the browser extension, shipped as it is
  background.js              lookups, storage, sync, messages from pages
  content.js, content/       swaps words on the page; the word card
  popup.*, dashboard.*       the toolbar popup and the word list with Settings
  lib/                       shared modules (store, matcher, errors, lookups)
  ui/                        design system: tokens, base, components, icons
  _locales/                  every interface string
server/                      the optional Elixir + SQLite server
spec/                        the word format and prompt the extension and server share
site/                        this docs site
slices/                      one SPEC.md per piece of work; decisions in DECISIONS.md
test/                        unit, DOM, background, e2e and performance tests
```

How the parts fit together is in [Architecture](/contribute/architecture/).
