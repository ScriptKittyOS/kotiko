# 02 · Test harness and CI

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | None |
| **Unblocks** | [50](../50-ui-localization-and-base-language/SPEC.md)'s CI checks, [04](../04-rename-to-mira/SPEC.md), [07](../07-word-model-v2/SPEC.md), [14](../14-matcher-engine/SPEC.md), [30](../30-release-pipeline/SPEC.md); in practice every slice, since each one's test plan runs here |
| **Sources** | [06 section 4 (items 1-8)](../../docs/research/06-adversarial-qa.md); [03 summary, section 3 "Matching engine", slices matcher-module-tests and e2e-fixture-corpus](../../docs/research/03-browser-extension.md); [04 S32, S33, slices ci-pipeline and dependency-automation](../../docs/research/04-architecture-release.md); [02 section 3 "Tests"](../../docs/research/02-linguistics.md) |

## Problem

There are no tests and no CI. `server/` has no `test/` directory and `mix.exs` declares
no test dependencies (`server/mix.exs:18-27`); `extension/` has no `package.json`. Every
one of the 40 failures in research 06 would have been caught by a modest suite
([06 section 4](../../docs/research/06-adversarial-qa.md)), including the critical auth
bypass fixed in 4705cb0.

The research probes showed what works and what doesn't in this environment:

- jsdom runs of the real `content.js` and a Node VM harness for `background.js` worked
  well for logic and DOM identity checks ([06 F02, F03, F10, F11](../../docs/research/06-adversarial-qa.md)).
- A puppeteer-core attempt with headless Chromium in the maintainer's sandbox could not
  reach the network, so any test that loads a real website is out. Tests must serve
  their own pages from a local fixture server.
- The content script is one IIFE (`extension/content.js:4-195`), so its matcher can't be
  tested without a DOM; research 03 recommends pulling it into a pure module.

## Goals

- `mix test` for the server with stubbed HTTP (no real model or Telegram calls).
- `npm test` for the extension's pure modules, DOM behaviour (jsdom) and background logic
  (a fake `chrome` API).
- `npm run e2e`: Playwright with the unpacked extension in Chromium, against a local
  fixture corpus and a fake server, never touching the internet.
- One GitHub Actions workflow running all of it plus formatting, linting, `web-ext lint`,
  `shellcheck`, dependency audits and the shared-spec parity checks, in under 10 minutes.
- Dependabot for mix, npm and GitHub Actions.
- The harness lands first with placeholder tests marked pending, so each later slice only
  adds cases.

## Non-goals

- The matcher rewrite itself: slice [14](../14-matcher-engine/SPEC.md). This slice moves
  today's matcher into a module unchanged so it can be tested, nothing more.
- Shared spec fixtures' content: slice [09](../09-shared-word-spec-and-prompt/SPEC.md). This slice runs them.
- Release workflows: slice [30](../30-release-pipeline/SPEC.md).
- Automated Firefox end-to-end tests: Playwright's Firefox can't load extensions. Firefox
  gets `web-ext lint`, jsdom tests and a manual checklist (Future work).

## User stories

- As a contributor, I want one command per side that tells me in a minute whether I broke something.
- As a maintainer, I want every PR checked automatically before I review it.
- As a slice author, I want a fixture page and a fake server ready, so my test plan is
  just new cases.

## Specification

### 1. Repository layout

```
package.json               root, "private": true, devDependencies only, "type": "module"
package-lock.json
eslint.config.js
playwright.config.mjs
extension/
  lib/                     pure modules, no DOM or chrome APIs where possible
    matcher.js             today's buildMatcher/matchCase/escapeRe, moved verbatim
  content.js               uses globalThis.MiraMatcher (manifest js: ["lib/matcher.js", "content.js"])
test/
  unit/                    node --test, pure modules (matcher, wordspec, lang, url, sync policy)
  dom/                     node --test + jsdom: content script behaviour, node identity
  bg/                      node --test + fake chrome: background.js
  e2e/                     Playwright specs
  perf/                    benchmarks with budgets
  helpers/
    fake-chrome.mjs        storage (local, sync, session) with onChanged, runtime messaging
                           with sender objects, alarms, tabs; deterministic clock hooks
    load-script.mjs        evaluates an extension script in a jsdom window or vm context
    fixture-server.mjs     one local HTTP server: static pages, fake Mira API, fake LLM
  fixtures/
    pages/                 HTML corpus (section 4)
    vendor/                React 18 production UMD builds (MIT, with LICENSE), checked in
    api/                   canned Mira API responses
    llm/                   canned model answers and error responses
server/
  config/test.exs
  test/
    test_helper.exs
    support/
      conn_case.ex         Plug.Test helpers, auth header, JSON decode
      data_case.ex         Ecto sandbox setup, fixtures, clock control
      llm_stub.ex          Req.Test helpers: answer/1, rate_limited/1, stall/1
      telegram_stub.ex     Req.Test stub recording sent messages
    mira/                  one file per module
    fixtures/              db/slovo-0.2.db, openrouter/models-2026-10-01.json
.github/
  workflows/ci.yml
  dependabot.yml
```

**Making the extension testable without a build step.** Content scripts can't be ES
modules. Each file in `extension/lib/` is written as a classic script that attaches one
namespace to `globalThis` (`globalThis.MiraMatcher = {...}`) and, when `module` exists,
also assigns `module.exports`; tests load it with `load-script.mjs`. The manifest lists
lib files before `content.js` in `content_scripts[].js`, and the background loads them
with `importScripts` (Chrome) or the `background.scripts` array (Firefox). This pattern is
used by slices 08, 09, 14 and 26 for their pure modules.

### 2. Server tests (ExUnit)

- **Dependencies** added to `server/mix.exs`: `{:credo, "~> 1.7", only: [:dev, :test],
  runtime: false}`, `{:mix_audit, "~> 2.1", only: [:dev, :test], runtime: false}`,
  `{:stream_data, "~> 1.1", only: :test}`. `Req.Test` ships with Req (0.7.4 in
  `server/mix.lock:20`), and Plug.Test with Plug.
- **Config**: `config/test.exs` sets `api_token` to a fixed 43-character test token,
  `start_http: false` (the application doesn't start Bandit in test; router tests call
  the plug directly, and the one real-socket test starts Bandit itself on port 0),
  no Telegram token, `llm_url: "http://llm.test"`, and
  `req_options: [plug: {Req.Test, Mira.LLM}]` read by `Mira.LLM.Client` (and
  `{Req.Test, Mira.Telegram}` for the bot). `Mira.Repo` uses
  `pool: Ecto.Adapters.SQL.Sandbox` with a database file in `System.tmp_dir!/0`.
  `config/runtime.exs` wraps environment parsing in `if config_env() != :test`.
- **Sandbox**: `async: true` by default; concurrency tests (slice 07's 20 parallel adds)
  use `async: false` with `Sandbox.mode(Repo, {:shared, self()})`.
- **Clock**: `Mira.Clock` (`now/0`, `monotonic/0`) with a test implementation that can be
  advanced, so deadline, TTL and tombstone tests don't sleep.
- **Required suites at the end of this slice** (later slices extend them):
  - `router_auth_test.exs`: slice 01's matrix against today's routes.
  - `words_test.exs`: today's upsert behaviour, including a pending test for F05 and F06
    that slice 07 turns green.
  - `llm_test.exs`: today's `try_models` with stubs for 200, 429, timeout, prose-wrapped
    JSON; asserts request counts.
  - `bot_test.exs`: dispatch of a text update and a callback with the Telegram stub.
- **No real network**: `test_helper.exs` sets Req's default `plug` so an unstubbed call
  raises with a clear message.

### 3. Extension tests (Node)

- **Runner**: Node 22's built-in `node --test` (no Jest/Vitest), `--test-concurrency` default.
- **devDependencies** (root `package.json`), pinned exact: `jsdom`, `@playwright/test`,
  `eslint`, `@eslint/js`, `globals`, `eslint-plugin-no-unsanitized`, `web-ext`, `ajv`
  (validates `spec/` fixtures against the schemas), `fake-indexeddb` (slice 11).
- **Scripts**: `"test": "node --test test/unit test/dom test/bg"`,
  `"e2e": "playwright test"`, `"lint": "eslint . && web-ext lint --source-dir extension --self-hosted"`,
  `"perf": "node test/perf/run.mjs"`.
- **`fake-chrome.mjs`** implements what the code uses today: `storage.local/sync/session`
  `get/set/remove` with defaults objects and `onChanged` events fired asynchronously (as
  browsers do), `runtime.sendMessage/onMessage` with a configurable `sender`
  (`{id, url, tab}`), `runtime.id`, `alarms.create/get/clear/onAlarm`, `tabs.query`.
  `globalThis.fetch` is replaced per test or pointed at the fixture server.
- **Required suites now**: `unit/matcher.test.mjs` (today's behaviour, with the F04 and
  F13 cases as `todo` for slice 14); `dom/content.test.mjs` (swap and unwrap restore text
  exactly; F02/F03 node-identity cases as `todo` for slice 15); `bg/background.test.mjs`
  (sync writes words; F10, F11, F31, F32, F39 as `todo` for slice 26).

### 4. End-to-end (Playwright, Chromium)

- **Browser**: Playwright's bundled Chromium, via
  `chromium.launchPersistentContext(tmpDir, {channel: "chromium", headless: true, args:
  ["--disable-extensions-except=<ext>", "--load-extension=<ext>", "--lang=<locale>"]})`.
  Branded Google Chrome dropped `--load-extension` in Chrome 137, so don't use
  `channel: "chrome"`. The extension id is read from the service worker URL.
- **Browser languages are a test parameter** (slice [50](../50-ui-localization-and-base-language/SPEC.md)).
  A helper `launchMira({locale, acceptLanguages})` sets `--lang` (the interface language
  `i18n.getUILanguage()` reports) and writes `intl.accept_languages` into the profile's
  `Default/Preferences` before launch (what `i18n.getAcceptLanguages()` reports). Two
  standard profiles run the required specs: **`en`** (`en-US`, `en`) and **`es-PR`**
  (`es-PR`, `es`), the maintainer's Puerto Rico case. Neither is treated as the default:
  each required spec runs under both.
- **Network isolation**: every test's context routes `**/*` and aborts any request whose
  host isn't `127.0.0.1` or `localhost`, then fails the test, so an accidental external
  dependency is caught locally and in CI. Nothing needs DNS.
- **`fixture-server.mjs`** (Node `http`, random port, started in `globalSetup`):
  - `/pages/*` static fixtures.
  - `/mira/*` a fake Mira server: `GET /health`, `GET/POST/DELETE /api/words`, and later
    `/api/v1/*`, backed by an in-memory list; switchable behaviours via
    `POST /__control` (slow, 401, HTML body, 500).
  - `/llm/v1/*` a fake OpenAI-compatible model: `/models`, `/key`, `/chat/completions`
    answering from `test/fixtures/llm/` by input text; switchable 429 (with and without
    rate-limit headers), stall, prose-wrapped JSON. Slices 10 and 11 extend it.
- **Fixture corpus** (`test/fixtures/pages/`), each page self-contained, no external URLs:

| Page | What it exercises | Asserted by slice |
|---|---|---|
| `basic.html` | Paragraphs with known words, headings, links | 02 smoke |
| `boundaries.html` | Contractions, hyphens, accents, URLs, `<wbr>`, `<mark>`, acronyms, single letters | 14, 16, 17 |
| `react-list.html` | React 18 (vendored UMD) list that re-renders text containing known words every 200 ms, and unmounts | 15 |
| `turbo-swap.html` | Replaces `document.body` after load; also `document.open()` | 15 |
| `self-healing.html` | Page script reverts any change to its paragraph (F08 ping-pong) | 15 |
| `shadow.html` | Open and closed shadow roots, nested custom elements | 42 |
| `iframes.html` | Same-origin, `srcdoc` and `about:blank` frames, a tiny ad-sized frame | 42 |
| `rtl.html` | `dir="rtl"` Arabic and Hebrew page with English and Spanish inserts | 17 |
| `other-lang.html` | `<html lang="de">` with "die", "Gift", "Kind" (not a base in the default test profile); an `lang="en"` island and an `lang="es"` island | 16, 50 |
| `es-news.html` | A Spanish news article with `lang="es"`: "perro", "perros", "¿Dónde está el perro?", "¡Perro!", "Perro" at sentence start, a `lang="en"` quote | 14, 16, 17, 32, 50 |
| `es-undeclared.html` | The same Spanish text with no `lang` attribute (detection path) | 16, 50 |
| `en-news.html` | An English article with the same structure as `es-news.html`, so both bases are tested on equal footing | 14, 16, 32, 50 |
| `ja-news.html` | `lang="ja"` text without spaces ("犬が好きです。"), kana and kanji mixed, furigana `<ruby>` | 14, 17, 50 |
| `fr-elisions.html` | `lang="fr"`: "l'eau", "d'abord", "aujourd'hui", "qu'il" | 14 |
| `de-compounds.html` | `lang="de"`: capitalised nouns, compounds ("Hundehütte"), "Hund" at sentence start and mid-sentence | 14, 17 |
| `mixed-lang-subtrees.html` | An English page with Spanish, Japanese and German `lang` subtrees | 16, 18, 50 |
| `editors.html` | `textarea`, `contenteditable`, `role=textbox`, a CodeMirror-like editor, `translate="no"` | 16 |
| `controls.html` | Buttons, nav, labels, form fields | 16 |
| `big.html` | Script that generates 100,000 text nodes (about 2 MB) at load | 14, 15 perf |
| `captions.html` | A fake caption track updating every 100 ms | 52 |

  Pages for later slices start as files with `test.fixme` specs, so the corpus exists
  from day one.
- **Required specs now**: install, set token and server URL to the fake server, sync,
  open `basic.html` (or `es-news.html` under the `es-PR` profile), see a swapped word,
  toggle off, see the page's original text; popup add against the fake server; nothing
  outside localhost is requested. The fake model in `test/fixtures/llm/` answers both
  English and Spanish questions ("how do you say dog in japanese", "¿cómo se dice perro en
  japonés?") with records for the requested `base_langs`.
- **Full-stack smoke** (`e2e/fullstack.spec.mjs`): starts the real server
  (`MIX_ENV=test mix run --no-halt` with `LLM_URL` pointing at the fake LLM, a temp data
  dir and a fixed token), then adds a word through the popup and sees it on a page. Runs
  in CI on every PR; about 60 s with a warm `_build` cache.
- **Artifacts**: traces and screenshots on failure, uploaded by CI.

### 5. Performance budgets

`test/perf/run.mjs` runs named benchmarks and compares against `test/perf/budgets.json`
(`{"matcher.scan.250kb.10k": {"budget_ms": 50, "ci_factor": 3}}`). In CI the budget is
multiplied by `ci_factor` to absorb noisy runners; a breach fails the job and the
measured numbers are printed either way. Slice 14 adds the matcher budget ([06 section 4 item 7](../../docs/research/06-adversarial-qa.md)),
slice 15 the long-task budget on `big.html`.

### 6. Static checks

- Elixir: `mix format --check-formatted`, `mix compile --warnings-as-errors`,
  `mix credo` (default checks to start; `--strict` once clean), `mix hex.audit`,
  `mix deps.audit`, `mix deps.unlock --check-unused`.
- JavaScript: ESLint flat config with `@eslint/js` recommended, browser and
  webextensions globals, `no-unsanitized/property` and `no-unsanitized/method` as errors
  ([03 E1](../../docs/research/03-browser-extension.md)), `no-restricted-properties` on
  `innerHTML`/`outerHTML`/`insertAdjacentHTML`.
- `web-ext lint --source-dir extension` (catches manifest problems for AMO).
- `shellcheck server/run.sh server/install-service.sh` (flags the unquoted unit values of [06 F35](../../docs/research/06-adversarial-qa.md)).
- Spec parity (slice 09): `node spec/tools/sync-extension.mjs --check`, `ajv` validation
  of fixtures, then the shared fixtures run in both `mix test --only spec` and
  `node --test test/unit/spec-*.test.mjs`.
- Version parity and `reuse lint` (slice 03).
- **Localization and base neutrality** (slice [50](../50-ui-localization-and-base-language/SPEC.md)
  section 8), in the `i18n` job:
  - `node scripts/check-i18n-keys.mjs`: every `extension/_locales/*/messages.json` and
    `server/priv/locales/*/messages.json` is valid JSON; every key exists in `en`;
    placeholders match `en` per key; plural keys cover every `Intl.PluralRules` category
    of their locale; the launch locales (`en`, `es`) have 100% of keys.
  - `node scripts/check-i18n-literals.mjs`: no user-facing string literals outside
    `MiraI18n.t()` in extension HTML and JS, with an allow-list for technical strings.
  - `node scripts/check-base-neutral.mjs`: no `english`-named identifiers for base-side
    concepts in `extension/`, `server/lib/` or `spec/`, with an allow-list for code that
    reads old data (07's legacy API adapter, 09's legacy-key repair, 12's version-1
    import, 11's cache upgrade) and `spec/lang/en/` (50 §7 rule 1).
  - The `en-XA` and RTL pseudo-locales are generated here and used by the e2e job's
    screenshot run.

### 7. CI workflow outline (`.github/workflows/ci.yml`)

```yaml
name: CI
on:
  pull_request:
  push: { branches: [main] }
permissions: { contents: read }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }

jobs:
  server:
    runs-on: ubuntu-24.04
    strategy:
      matrix:
        include:
          - { elixir: "1.15.8", otp: "26.2" }   # minimum supported (mix.exs: ~> 1.15)
          - { elixir: "1.19.2", otp: "28.1" }   # current
    defaults: { run: { working-directory: server } }
    steps:
      - checkout (pinned SHA)
      - erlef/setup-beam (pinned SHA) with matrix versions
      - cache deps and _build keyed on mix.lock + versions
      - mix deps.get
      - mix format --check-formatted        (current version only)
      - mix compile --warnings-as-errors
      - mix credo; mix hex.audit; mix deps.audit; mix deps.unlock --check-unused
      - mix test

  extension:
    runs-on: ubuntu-24.04
    steps:
      - checkout; setup-node 22 with npm cache
      - npm ci
      - npm run lint                        # eslint + web-ext lint
      - npm test
      - npm run perf

  spec:
    runs-on: ubuntu-24.04
    steps:
      - checkout; setup-node 22; setup-beam (current)
      - npm ci
      - node spec/tools/sync-extension.mjs --check
      - node scripts/check-versions.mjs
      - node spec/eval/run-eval.mjs --replay --set all
      - (cd server && mix deps.get && mix test --only spec)
      - node --test test/unit/spec-*.test.mjs
      - pipx run reuse lint

  i18n:
    runs-on: ubuntu-24.04
    steps:
      - checkout; setup-node 22
      - node scripts/check-i18n-keys.mjs
      - node scripts/check-i18n-literals.mjs
      - node scripts/check-base-neutral.mjs

  shell:
    runs-on: ubuntu-24.04
    steps: [checkout, "shellcheck server/*.sh scripts/*.sh"]

  e2e:
    needs: [extension]
    runs-on: ubuntu-24.04
    steps:
      - checkout; setup-node 22; setup-beam (current); restore server cache
      - npm ci
      - npx playwright install --with-deps chromium
      - (cd server && mix deps.get && MIX_ENV=test mix compile)
      - npm run e2e
      - upload-artifact playwright-report and traces (if: failure())
```

All third-party actions are pinned to a full commit SHA with the version in a comment;
Dependabot keeps them current. Required checks for branch protection: `server (1.19.2)`,
`extension`, `spec`, `i18n`, `shell`, `e2e`.

### 8. Dependabot (`.github/dependabot.yml`)

Weekly, Monday: `mix` in `/server`, `npm` in `/`, `github-actions` in `/`. Minor and
patch updates grouped per ecosystem; majors as separate PRs; commit prefix `chore(deps)`
so release-please (slice 30) leaves them out of user-facing notes.

## Acceptance criteria

- [ ] `cd server && mix test` and `npm test` pass on a fresh clone with no network access
      after dependencies are installed.
- [ ] `npm run e2e` passes with outbound network blocked at the OS level (verified once
      with `unshare -n` or a firewall rule), proving no external requests.
- [ ] An unstubbed HTTP call in an ExUnit test fails with a clear message.
- [ ] `extension/lib/matcher.js` loads in the browser (extension works as before) and in Node.
- [ ] The CI workflow runs all jobs on a PR in under 10 minutes with warm caches.
- [ ] Reverting commit 4705cb0 locally makes `router_auth_test.exs` fail.
- [ ] Introducing `el.innerHTML = word.native` makes ESLint fail.
- [ ] Dependabot opens PRs for all three ecosystems.
- [ ] Every page in the corpus table exists, with at least a `fixme` spec.
- [ ] The required e2e specs pass under both the `en` and the `es-PR` browser profiles.
- [ ] Adding a hard-coded `textContent = "Added"` to the popup makes the `i18n` job fail;
      so does a new `word.english` reference outside the allow-list.

## Test plan

This slice is the test plan's infrastructure; its own checks are the acceptance criteria
above, plus a deliberate-breakage run before merging: break auth, break a sync write,
break the matcher, add an external `<script src>` to a fixture, and confirm each is caught
by the expected job.

## Rollout and migration

- No user-facing change. Moving the matcher into `extension/lib/matcher.js` is the only
  runtime change; the e2e smoke covers it.
- Lands before slice 04 (the rename), so the rename is verified by tests.
- Branch protection is switched on once the workflow has been green on `main` for a week.

## Open questions

1. **Minimum Elixir version.** `mix.exs` says `~> 1.15`. Testing 1.15 costs one matrix
   job. Recommendation: keep 1.15/OTP 26 as the floor until slice 40's releases make the
   build environment ours; then raise it.
2. **Root `package.json`.** It makes `npm ci` work from the root but may look like the
   extension has npm dependencies. Recommendation: keep it at the root, `"private": true`,
   with a comment in CONTRIBUTING that the extension ships no npm code.

## Future work

- Firefox end-to-end via `web-ext run` and geckodriver's `installAddon`, once there is a
  maintained way to drive it.
- Mutation testing for `Mira.WordSpec` and the matcher.
- Visual regression snapshots for the popup and dashboard (slices 20, 21) in light and dark.
