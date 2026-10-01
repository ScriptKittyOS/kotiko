# Mira roadmap: slices

Mira swaps English words on web pages for the words you're learning, in any language,
mixed however you like. This folder is the plan for taking it from a working personal tool
to a polished, free, open-source release from ScriptKittyOS.

Each slice is a self-contained piece of work with its own folder and `SPEC.md`, written to
the same [template](TEMPLATE.md). Specs are final: a contributor should be able to pick
one up and build it without guessing. Decisions already made are in
[DECISIONS.md](DECISIONS.md); don't reopen them inside a slice.

## Where this plan came from

Six research reports, each looking at the whole project through one lens, are in
[`docs/research/`](../docs/research/):

| Report | Lens |
|---|---|
| [01 Language mixing](../docs/research/01-language-mixing.md) | Which language wins, density, coverage, celebrations |
| [02 Linguistics](../docs/research/02-linguistics.md) | Matching English correctly, every kind of target language and script |
| [03 Browser and extension](../docs/research/03-browser-extension.md) | Site compatibility, performance, platform, accessibility, stores |
| [04 Architecture and release](../docs/research/04-architecture-release.md) | Local-first vs server, data, security, privacy, open-source hygiene |
| [05 Learner experience](../docs/research/05-learner-ux.md) | Onboarding, daily use, managing words, motivation, errors |
| [06 Adversarial QA](../docs/research/06-adversarial-qa.md) | 40 reproduced or code-derived failures (F01-F40) |

Where reports overlapped, their slices were merged; where they disagreed, the call is
recorded in [DECISIONS.md](DECISIONS.md).

## Priorities and phases

- **P0**: needed before the public release.
- **P1**: soon after release.
- **P2**: later, or when someone wants to pick it up.

Slice numbers follow a sensible build order, not priority. The P0 work groups into four
phases that can overlap:

1. **Foundations**: tests and CI, open-source files, the rename, a sound word model.
2. **Correct on every page**: the matching engine, framework-safe swapping, what not to
   swap, casing, language precedence.
3. **Local first, beautifully**: brand, design system, popup, dashboard, bulk add,
   onboarding, starter packs, the word popover.
4. **Release**: privacy, store readiness, release pipeline.

## All slices

| # | Slice | Pri | Size | Depends on | What it covers |
|---|---|---|---|---|---|
| 01 | [API auth hardening](01-api-auth-hardening/SPEC.md) | P0 | S | – | Deny-by-default auth (**done**, 4705cb0), Host allowlist against DNS rebinding, server-generated long token, warnings for non-local `BIND`, regression tests. 06 F01, F21, F27, F36; 04 security. |
| 02 | [Test harness and CI](02-test-harness-and-ci/SPEC.md) | P0 | M | – | ExUnit with Req.Test stubs; matcher pulled into a pure module with Node and jsdom tests; Playwright end-to-end with the unpacked extension and a fixture corpus (React, Turbo body swap, shadow DOM, iframe, RTL, non-English, 100k nodes); GitHub Actions; format, Credo, `web-ext lint`, ESLint; Dependabot and `mix_audit`. 03, 04, 06 testing sections. |
| 03 | [Open-source foundations](03-oss-foundations/SPEC.md) | P0 | S | – | LICENSE (recommend Apache-2.0), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, issue and PR templates, single version source, CHANGELOG. 04. |
| 04 | [Rename to Mira](04-rename-to-mira/SPEC.md) | P0 | M | 02 | Everywhere: repo, Elixir app and modules (`Slovo` to `Mira`), data directory with a safe migration of existing databases, systemd unit, env var names if any, Firefox add-on ID, extension name and copy, README, bot text. Name-collision check. |
| 05 | [Brand identity](05-brand-identity/SPEC.md) | P0 | M | – | Logo adopted (`brand/logo/`, tile `#8E5EFA`); artist delivers vector, one-color versions and store artwork to the requirements here: one-color and small-size versions, store artwork; what the name means; voice and tone. |
| 06 | [Design system](06-design-system/SPEC.md) | P0 | L | 05 | Color tokens for light and dark built on burnt orange, purples and blue; contrast and color-vision checks; typography including CJK, Arabic and Devanagari; spacing, radius, elevation, motion; components; how Mira stays original rather than generic. |
| 07 | [Word model v2](07-word-model-v2/SPEC.md) | P0 | M | 02 | Stable UUIDs, `created_at`/`updated_at`/`deleted_at` tombstones, merge-not-overwrite atomic upsert returning created/updated/unchanged, `PATCH` edit route, NFC normalisation, unique key ready for senses. 06 F05, F06, F27, F29; 02; 04; 05. |
| 08 | [Language tags](08-language-tags/SPEC.md) | P0 | S | 07 | Canonical BCP 47 handling: `cmn` to `zh`, `iw` to `he`, `zh-TW` to `zh-Hant`, keep pt-BR vs pt-PT when asked, script checks against the native text, names derived from the code (not the first model answer). 01, 02. |
| 09 | [Shared word spec and prompt](09-shared-word-spec-and-prompt/SPEC.md) | P0 | M | 07, 08 | One `spec/` folder: JSON schema for a word, the prompt, validation rules (forms cap, stopwords, reject English "translations", length caps, bare word means lookup, add box means add), and a golden evaluation set across languages. Used by both the extension and the server. 02, 04, 06 F12, F28. |
| 10 | [LLM client resilience](10-llm-client-resilience/SPEC.md) | P0 | M | 09 | Overall deadline, live free-model list from OpenRouter's models API (with fallbacks), quota-aware retries, lookup cache, remaining-quota display, no user text in logs by default. 04, 06 F09, F14, F40. |
| 11 | [Local-first mode](11-local-first-mode/SPEC.md) | P0 | L | 07, 09, 10 | Words stored in the extension; direct calls to any OpenAI-compatible API with the user's key; provider presets (OpenRouter, OpenAI, Anthropic, Gemini, Groq, Ollama, LM Studio); the server becomes optional and connects for sync; migration from the server cache. 04, 05. |
| 12 | [Export, import and delete](12-export-import-and-delete/SPEC.md) | P0 | M | 07 | JSON (canonical), CSV, Anki TSV export; JSON import; "delete all my data" in the extension and server. 04, 05. |
| 13 | [Bulk add](13-bulk-add/SPEC.md) | P0 | M | 09, 24 | Paste a whole list or drop files (TXT, CSV, TSV, JSON, Anki export); parse "native = english" and similar without the model; batch the rest under quota; review table before saving. Maintainer request. |
| 14 | [Matcher engine](14-matcher-engine/SPEC.md) | P0 | M | 02 | Replace the giant regex with a Unicode tokenizer plus Map/trie lookup; correct boundaries for contractions, hyphens, accents, URLs and `<wbr>`; multi-word forms; performance budget. 02, 03, 06 F04, F07, F22, F24. |
| 15 | [Framework-safe swapping](15-framework-safe-swapping/SPEC.md) | P0 | M | 14 | Keep site-owned text nodes (splitText plus a WeakMap), no `normalize()`, orphan cleanup, observe `documentElement`, time-sliced batches, rewrite-loop breaker, re-inject after install or update, orphaned-script handoff. 03, 06 F02, F03, F08, F15, F25. |
| 16 | [What not to swap](16-what-not-to-swap/SPEC.md) | P0 | M | 14 | Skip non-English pages and `lang` subtrees, code editors, `translate=no`, controls (buttons, nav, labels) by default, likely proper nouns and acronyms, sensitive sites option. 01, 02, 03, 05, 06 F13. |
| 17 | [Casing and script display](17-casing-and-script-display/SPEC.md) | P0 | S | 14 | Locale-aware casing (Turkish, Georgian, Dutch, Greek, caseless scripts); never copy English-only capitals; RTL isolation; font fallback and line-height guard. 02, 06 F23. |
| 18 | [Language precedence and mixing](18-language-precedence-and-mixing/SPEC.md) | P0 | M | 14 | Stable seeded weighted choice per (word, page, day); candidate cleanup (drop native equals English, merge identical natives); "Focus" as a real mode; fresh words win; weights and priority order; mix-within-page option. 01, 05. |
| 19 | [Word popover](19-word-popover/SPEC.md) | P0 | M | 06, 15 | Replace the `title` tooltip with one shared popover in a shadow root; hover, tap, keyboard; nothing revealing in page DOM (custom element, no `data-en`/`title`); actions slot (speak, edit, pause, wrong meaning). 03, 05. |
| 20 | [Popup redesign](20-popup-redesign/SPEC.md) | P0 | M | 06 | The popup rebuilt on the design system: add, languages and focus, amount, status, quick links; fewest steps for the common tasks. 05; maintainer. |
| 21 | [Dashboard](21-dashboard/SPEC.md) | P0 | L | 06, 07 | Full extension page with a live view of all words: search, filter, edit, delete with undo, pause, move language, bulk add entry, export, per-language overview. Maintainer request; 05. |
| 22 | [First-run onboarding](22-first-run-onboarding/SPEC.md) | P0 | M | 11, 20, 23 | Welcome tab on install: pick languages, start from a starter pack, optional key or server, live preview; first swapped word within a minute. 05. |
| 23 | [Starter packs](23-starter-packs/SPEC.md) | P0 | M | 09 | Curated packs bundled in the extension, no model calls; preview and untick before import; licensing (CC0 or CC BY 4.0); review process. 04, 05. |
| 24 | [Add flow safety](24-add-flow-safety/SPEC.md) | P0 | M | 07 | Report created/updated/unchanged; per-word undo that restores rather than deletes; results survive the popup closing; manual add without the model; idempotent add with a client id. 05, 06 F05, F09, F30. |
| 25 | [Plain-language errors](25-plain-language-errors/SPEC.md) | P0 | S | – | Error codes from every backend; messages that say what still works and the next step; offline cached words keep working. 05. |
| 26 | [Background sync correctness](26-background-sync-correctness/SPEC.md) | P0 | S | – | Sync generations, abort on credential change, response validation, URL checks, alarm re-creation, sender checks on messages. 03, 06 F10, F11, F31, F32, F39. |
| 27 | [Accessibility baseline](27-accessibility-baseline/SPEC.md) | P0 | M | 06 | WCAG 2.2 AA across popup, dashboard and popover; keyboard and screen reader paths; what screen readers hear on swapped words; reduced motion; target sizes. 03, 05. |
| 28 | [Privacy and store readiness](28-privacy-and-store-readiness/SPEC.md) | P0 | M | 11 | Privacy policy; Chrome Web Store disclosures and single-purpose text; Firefox `data_collection_permissions`, permission checks and CSP; listing assets; token kept out of content-script reach. 03, 04. |
| 29 | [Server ops hardening](29-server-ops-hardening/SPEC.md) | P0 | S | – | `start_permanent`, always `deps.get`, config validation with clear errors, unit file quoting, `chmod 600 .env`, quieter logs, versioned JSON `/health`. 06 F19, F20, F34, F35, F40. |
| 30 | [Release pipeline](30-release-pipeline/SPEC.md) | P0 | M | 02, 03 | release-please, extension zips, Chrome Web Store upload, Firefox signing, checksums and attestations. 04. |
| 31 | [Density and amount](31-density-and-amount/SPEC.md) | P1 | M | 18 | Per-block ratio cap, no adjacent swaps, per-word page cap, an Amount control (Light, Medium, Heavy, Everything). 01, 05. |
| 32 | [Page coverage and celebrations](32-page-coverage-and-celebrations/SPEC.md) | P1 | M | 14, 06 | How much of a page you could read in your languages; popup and badge; milestone moments including confetti; reduced motion; off switch. Maintainer request; 01, 05. |
| 33 | [Context menu and shortcuts](33-context-menu-and-shortcuts/SPEC.md) | P1 | S | 24 | Right-click "Learn this in…" and "Add to Mira" with the page language as a hint; keyboard commands to toggle, reveal, open. 03, 05. |
| 34 | [Pronunciation audio](34-pronunciation-audio/SPEC.md) | P1 | S | 19 | speechSynthesis in the popover and dashboard, hidden when no voice exists. 05. |
| 35 | [Reveal mode and review](35-reveal-mode-and-review/SPEC.md) | P1 | M | 19 | Test yourself (guess before revealing), knew-it signals, light review weighting, "well known" retirement. 05. |
| 36 | [Grammar and senses](36-grammar-and-senses/SPEC.md) | P1 | L | 07, 09 | Part of speech, article, gender, reading, vocalised form; homographs as senses; "did you mean"; variant preferences (pt-BR, sr-Latn, yue); prompt hardening. 02. |
| 37 | [Language colors and reading aids](37-language-colors-and-reading-aids/SPEC.md) | P1 | M | 06, 19 | Optional accessible color per language; ruby romanization above words; vowel-mark mode. 02, 05. |
| 38 | [Per-site rules](38-per-site-rules/SPEC.md) | P1 | M | 18, 31 | Languages and amount per site; sensitive-site defaults. 01, 03, 05. |
| 39 | [Multi-device sync](39-multi-device-sync/SPEC.md) | P1 | M | 11 | Delta sync with tombstones and ETags; settings in `storage.sync`; optional sync through the server. 04. |
| 40 | [Server packaging and Docker](40-server-packaging-docker/SPEC.md) | P1 | M | 04, 29 | Multi-arch Docker image and compose; `mix release`; service files for Linux, macOS and Windows; backup before migrations. 04. |
| 41 | [Telegram improvements](41-telegram-improvements/SPEC.md) | P1 | S | 07 | Pairing code instead of editing `.env`; safe `/remove` with confirmation; pending cleanup; message length limits; error handling. 04, 05, 06 F17, F18, F33, F38. |
| 42 | [Frames and shadow DOM](42-frames-and-shadow-dom/SPEC.md) | P1 | M | 15 | Swap inside iframes and open or closed shadow roots without hurting performance. 03, 06 F26. |
| 43 | [Copy, print and translate coexistence](43-copy-print-translate-coexistence/SPEC.md) | P1 | S | 15 | Copy as English option, print in English, stay out of the way of machine translation. 03. |
| 44 | [Docs site](44-docs-site/SPEC.md) | P1 | M | 28 | GitHub Pages: install guides per mode, privacy, troubleshooting, contributor docs. 04. |
| 45 | [Firefox for Android](45-firefox-android/SPEC.md) | P1 | M | 19, 11 | Tap interactions, mobile layouts, local mode on mobile. 03, 05. |
| 46 | [Local stats and recap](46-local-stats-and-recap/SPEC.md) | P2 | M | 07 | Words seen and added per language, weekly recap, no URLs stored, no guilt mechanics. 05. |
| 47 | [Hosted word packs](47-hosted-word-packs/SPEC.md) | P2 | M | 23 | Packs on GitHub Pages; import or subscribe by URL; remove a pack as a unit. 04. |
| 48 | [Multi-user and classroom](48-multi-user-and-classroom/SPEC.md) | P2 | L | 07, 40 | Users and tokens on one server; families; teachers assigning words. 04. |
| 49 | [Dictionary verification](49-dictionary-verification/SPEC.md) | P2 | L | 09 | Open dictionaries (CC-CEDICT, Wiktionary) to verify model output and work offline. 02, 04. |
| 50 | [UI localization and base language](50-ui-localization-and-base-language/SPEC.md) | P2 | L | 25 | Interface strings in `_locales`; pages in languages other than English. 02, 05. |
| 51 | [Safari port](51-safari-port/SPEC.md) | P2 | L | 45 | macOS and iOS via Xcode conversion. 03. |
| 52 | [Video captions](52-video-captions/SPEC.md) | P2 | M | 15 | Flicker-free swapping in YouTube and similar captions. 03. |

## Critical path to the public release

```
02 tests ─┬─ 04 rename ─────────────────────────────────────────────┐
          ├─ 07 word model ─ 08 tags ─ 09 spec ─ 10 llm ─ 11 local ─┼─ 22 onboarding ─┐
          └─ 14 matcher ─┬─ 15 safe swapping ─ 19 popover ──────────┤                  │
                         ├─ 16 skip rules, 17 casing, 18 precedence ┤                  ├─ 28 privacy ─ 30 release
05 brand ─ 06 design system ─┬─ 20 popup ───────────────────────────┤                  │
                             └─ 21 dashboard ─ 13 bulk add ─────────┘                  │
03 OSS files, 01 auth, 29 ops, 25 errors, 26 sync, 27 a11y, 12 export, 23 packs, 24 add ┘
```

## Open questions for the maintainers

Collected from the slices; each slice repeats its own with a recommendation. Already
decided: license (Apache-2.0), celebrations (on by default), store publisher
(ScriptKittyOS, hello@scriptkittyos.com) and the logo (a black kitten on `#8E5EFA`); see [DECISIONS.md](DECISIONS.md).

1. **Swap inside buttons and menus?** Recommended off by default. ([16](16-what-not-to-swap/SPEC.md))
2. **Supported server platforms.** Docker and Linux officially; macOS and Windows best effort? ([40](40-server-packaging-docker/SPEC.md))
