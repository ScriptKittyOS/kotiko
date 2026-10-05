# Kotiko roadmap: slices

Kotiko swaps words on web pages written in the language you read (whatever it is: Spanish,
English, Japanese, or several at once) for the words you're learning, in any language,
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
| [02 Linguistics](../docs/research/02-linguistics.md) | Matching the base language correctly (written with English as the base; [50](50-ui-localization-and-base-language/SPEC.md) generalises it), every kind of target language and script |
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

1. **Foundations**: tests and CI, open-source files, the rename, a sound word model whose
   meanings are stored in the learner's base language, base-language detection and the
   translation files every interface string lives in (50).
2. **Correct on every page**: the matching engine (any base language, including ones
   without spaces), framework-safe swapping, what not to swap (pages in the learner's
   languages are swapped, others left alone), casing per language, language precedence.
3. **Local first, beautifully**: brand, design system, popup, dashboard, bulk add,
   onboarding around the learner's own first word (asked in their own language), the word
   popover with its pronunciation and audio (34), with every string in translation files (English required; other
   languages optional, see [DECISIONS 2026-10-05](DECISIONS.md)).
4. **Release**: privacy, store readiness and listings in English, a security
   review by three independent reviewers who must prove every claim (54), release
   pipeline, and the OpenSSF passing badge on the day the repository goes public (53).

English is not special anywhere: it is one possible base language and one possible target
([DECISIONS](DECISIONS.md), [50](50-ui-localization-and-base-language/SPEC.md)). Nor is
Spanish: Kotiko works in every language the browser can split into words through shared
rules and data, not a pack per language; English and Spanish are simply the two that also
get hand-written extras for readers at launch (respelling keys, welcome words). Only the
English interface is required at launch. Every slice follows 50's cross-cutting rules.

## All slices

| # | Slice | Pri | Size | Depends on | What it covers |
|---|---|---|---|---|---|
| 01 | [API auth hardening](01-api-auth-hardening/SPEC.md) | P0 | S | – | Deny-by-default auth (**done**, 4705cb0), Host allowlist against DNS rebinding, server-generated long token, warnings for non-local `BIND`, regression tests. 06 F01, F21, F27, F36; 04 security. |
| 02 | [Test harness and CI](02-test-harness-and-ci/SPEC.md) | P0 | M | – | ExUnit with Req.Test stubs; matcher pulled into a pure module with Node and jsdom tests; Playwright end-to-end with the unpacked extension and a fixture corpus (React, Turbo body swap, shadow DOM, iframe, RTL, Spanish, Japanese and mixed-language pages, 100k nodes, a browser launched in `es-PR`); i18n checks; GitHub Actions; format, Credo, `web-ext lint`, ESLint; Dependabot and `mix_audit`. 03, 04, 06 testing sections. |
| 03 | [Open-source foundations](03-oss-foundations/SPEC.md) | P0 | S | – | LICENSE (recommend Apache-2.0), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, issue and PR templates, single version source, CHANGELOG. 04. |
| 04 | [Rename to Kotiko](04-rename-to-kotiko/SPEC.md) | P0 | M | 02 | Everywhere: repo, Elixir app and modules (`Slovo` to `Kotiko`), data directory with a safe migration of existing databases, systemd unit, env var names if any, Firefox add-on ID, extension name and copy, README, bot text. Name-collision check. |
| 05 | [Brand identity](05-brand-identity/SPEC.md) | P0 | M | – | Logo adopted (`brand/logo/`, tile `#8E5EFA`); artist delivers vector, one-color versions and store artwork to the requirements here: one-color and small-size versions, store artwork; what the name means; voice and tone. |
| 06 | [Design system](06-design-system/SPEC.md) | P0 | L | 05 | Color tokens for light and dark built on burnt orange, purples and blue; contrast and color-vision checks; typography including CJK, Arabic and Devanagari; spacing, radius, elevation, motion; components; how Kotiko stays original rather than generic. |
| 07 | [Word model v2](07-word-model-v2/SPEC.md) | P0 | L | 02 | Meaning stored as `gloss` and `forms` in the record's `base_lang` (one record per base; migration from `english`); `romanization` in one named scheme per language, separate from a learner `pronunciation` per base (stressed syllable in capitals, careful form, source), with a one-time background refresh for saved words; stable UUIDs, `created_at`/`updated_at`/`deleted_at` tombstones, merge-not-overwrite atomic upsert returning created/updated/unchanged, `PATCH` edit route, NFC normalisation, unique key ready for senses. 06 F05, F06, F27, F29; 02; 04; 05. |
| 08 | [Language tags](08-language-tags/SPEC.md) | P0 | S | 07 | Canonical BCP 47 handling: `cmn` to `zh`, `iw` to `he`, `zh-TW` to `zh-Hant`, keep pt-BR vs pt-PT when asked, script checks against the native text, names derived from the code (not the first model answer); base tags (`es-PR` to `es`, `zh-TW` to `zh-Hant`) and endonyms. 01, 02. |
| 09 | [Shared word spec and prompt](09-shared-word-spec-and-prompt/SPEC.md) | P0 | M | 07, 08, 50 | One `spec/` folder: JSON schema for a word, the prompt, validation rules per base language (forms cap, stopwords from `spec/lang/<base>/`, reject a native that equals its gloss, length caps, bare word means lookup, add box means add), pronunciation rules and checks (respelling keys, `respell` prompt), the model asked and answering in the learner's language, and a golden evaluation set across target and base languages. Used by both the extension and the server. 02, 04, 06 F12, F28. |
| 10 | [LLM client resilience](10-llm-client-resilience/SPEC.md) | P0 | M | 09, 50 | Overall deadline, live free-model list from OpenRouter's models API (with fallbacks), quota-aware retries, lookup cache, remaining-quota display, no user text in logs by default. 04, 06 F09, F14, F40. |
| 11 | [Local-first mode](11-local-first-mode/SPEC.md) | P0 | L | 07, 09, 10, 50 | Words stored in the extension; direct calls to any OpenAI-compatible API with the user's key; provider presets (OpenRouter, OpenAI, Anthropic, Gemini, Groq, Ollama, LM Studio); the server becomes optional and connects for sync; migration from the server cache. 04, 05. |
| 12 | [Export, import and delete](12-export-import-and-delete/SPEC.md) | P0 | M | 07, 50 | JSON (canonical), CSV, Anki TSV export; JSON import; "delete all my data" in the extension and server. 04, 05. |
| 13 | [Bulk add](13-bulk-add/SPEC.md) | P0 | M | 09, 24, 50 | Paste a whole list or drop files (TXT, CSV, TSV, JSON, Anki export); parse "native = meaning" in any base language without the model; batch the rest under quota; review table before saving. Maintainer request. |
| 14 | [Matcher engine](14-matcher-engine/SPEC.md) | P0 | M | 02, 50 | Replace the giant regex with `Intl.Segmenter` tokens plus a Map/trie index per base language; per-language boundary rules (English contractions, French and Italian elisions, Spanish ¿ ¡, German compounds, Japanese and Chinese without spaces), hyphens, accents, URLs and `<wbr>`; multi-word forms; performance budget. 02, 03, 06 F04, F07, F22, F24. |
| 15 | [Framework-safe swapping](15-framework-safe-swapping/SPEC.md) | P0 | M | 14, 50 | Keep site-owned text nodes (splitText plus a WeakMap), no `normalize()`, orphan cleanup, observe `documentElement`, time-sliced batches, rewrite-loop breaker, re-inject after install or update, orphaned-script handoff. 03, 06 F02, F03, F08, F15, F25. |
| 16 | [What not to swap](16-what-not-to-swap/SPEC.md) | P0 | M | 14, 50 | Swap only pages and `lang` subtrees in one of the learner's base languages, skip the rest; code editors, `translate=no`, controls (buttons, nav, labels) by default, likely proper nouns and acronyms, sensitive sites option. 01, 02, 03, 05, 06 F13. |
| 17 | [Casing and script display](17-casing-and-script-display/SPEC.md) | P0 | S | 14, 50 | Casing rules per base and target language (Turkish, German nouns, Spanish months, Georgian, Dutch, Greek, caseless scripts); never copy capitals only the base language uses; RTL isolation; font fallback and line-height guard. 02, 06 F23. |
| 18 | [Language precedence and mixing](18-language-precedence-and-mixing/SPEC.md) | P0 | M | 14, 50 | Stable seeded weighted choice per (word, page, day); candidate cleanup (drop native equals gloss, merge identical natives); "Focus" as a real mode; fresh words win; weights and priority order; mix-within-page option. 01, 05. |
| 19 | [Word popover](19-word-popover/SPEC.md) | P0 | M | 07, 06, 15, 50, 34 | Replace the `title` tooltip with one shared popover in a shadow root; hover, tap, keyboard; shows the meaning in the page's base language; nothing revealing in page DOM (custom element, no `data-*`/`title`); actions slot (speak, edit, pause, wrong meaning). 03, 05. |
| 20 | [Popup redesign](20-popup-redesign/SPEC.md) | P0 | M | 06, 50 | The popup rebuilt on the design system, in the interface language: add, languages and focus, amount, status (including "this page isn't in a language you read"), quick links; fewest steps for the common tasks. 05; maintainer. |
| 21 | [Dashboard](21-dashboard/SPEC.md) | P0 | L | 06, 07, 50 | Full extension page with a live view of all words (one row per word, with its meanings per base language): search, filter, edit, delete with undo, pause, move language, bulk add entry, export, per-language overview; settings for the languages you read in and Kotiko's own language. Maintainer request; 05. |
| 22 | [First-run onboarding](22-first-run-onboarding/SPEC.md) | P0 | M | 11, 20, 24, 50 | Welcome tab on install as a short conversation in the learner's language: confirm the languages you read in (detected from the browser), connect your own AI (key typed only on full pages), ask for the first word you'd love to learn in any language ("¿cómo se dice hola en japonés?" works), confirm it, confetti, live preview in your own language with the real matcher. "native = meaning" works with no key. Nothing is saved until the learner confirms. Maintainer; 05. |
| 23 | ~~[Starter packs](23-starter-packs/SPEC.md)~~ | – | – | – | **Dropped** (2026-10-01): Kotiko never adds words the learner didn't choose ([DECISIONS](DECISIONS.md)). Replaced by 13, 22 and 12. |
| 24 | [Add flow safety](24-add-flow-safety/SPEC.md) | P0 | M | 07, 50 | Report created/updated/unchanged; per-word undo that restores rather than deletes; results survive the popup closing; manual add without the model; idempotent add with a client id. 05, 06 F05, F09, F30. |
| 25 | [Plain-language errors](25-plain-language-errors/SPEC.md) | P0 | S | 50 | Error codes from every backend; localized messages (English at launch, other languages optional) that say what still works and the next step; offline cached words keep working. 05. |
| 26 | [Background sync correctness](26-background-sync-correctness/SPEC.md) | P0 | S | – | Sync generations, abort on credential change, response validation, URL checks, alarm re-creation, sender checks on messages. 03, 06 F10, F11, F31, F32, F39. |
| 27 | [Accessibility baseline](27-accessibility-baseline/SPEC.md) | P0 | M | 06, 50 | WCAG 2.2 AA across popup, dashboard and popover; keyboard and screen reader paths; what screen readers hear on swapped words; reduced motion; target sizes. 03, 05. |
| 28 | [Privacy and store readiness](28-privacy-and-store-readiness/SPEC.md) | P0 | M | 11, 50 | Privacy policy and store listings in English; Chrome Web Store disclosures and single-purpose text; Firefox `data_collection_permissions`, permission checks and CSP; listing assets; token kept out of content-script reach. 03, 04. |
| 29 | [Server ops hardening](29-server-ops-hardening/SPEC.md) | P0 | S | – | `start_permanent`, always `deps.get`, config validation with clear errors, unit file quoting, `chmod 600 .env`, quieter logs, versioned JSON `/health`. 06 F19, F20, F34, F35, F40. |
| 30 | [Release pipeline](30-release-pipeline/SPEC.md) | P0 | M | 02, 03, 50 | release-please, extension zips, Chrome Web Store upload, Firefox signing, checksums and attestations. 04. |
| 31 | [Density and amount](31-density-and-amount/SPEC.md) | P1 | M | 18, 50 | Per-block ratio cap, no adjacent swaps, per-word page cap, an Amount control (Light, Medium, Heavy, Everything). 01, 05. |
| 32 | [Page coverage and celebrations](32-page-coverage-and-celebrations/SPEC.md) | P1 | M | 14, 06, 50 | How much of a page in a language you read you could read in your target languages, counted per base language; popup and badge; milestone moments including confetti; reduced motion; off switch. Maintainer request; 01, 05. |
| 33 | [Context menu and shortcuts](33-context-menu-and-shortcuts/SPEC.md) | P1 | S | 24, 50 | Right-click "Learn this in…" and "Add to Kotiko" with the page language as a hint; keyboard commands to toggle, reveal, open. 03, 05. |
| 34 | [Pronunciation audio](34-pronunciation-audio/SPEC.md) | P0 | S | 19, 50 | speechSynthesis in the popover and dashboard, hidden when no voice exists; built with the popover (19) and shipped in the same release, with a manual voice check on the release checklist. Maintainer decision; 05. |
| 35 | [Reveal mode and review](35-reveal-mode-and-review/SPEC.md) | P1 | M | 19, 50 | Test yourself (guess before revealing), knew-it signals, light review weighting, "well known" retirement. 05. |
| 36 | [Grammar and senses](36-grammar-and-senses/SPEC.md) | P1 | L | 07, 09, 50 | Part of speech, article, gender, reading, vocalised form; base-side grammar per base language (Spanish gender and plural forms, German nouns); homographs as senses; "did you mean"; variant preferences (pt-BR, sr-Latn, yue); prompt hardening. 02. |
| 37 | [Language colors and reading aids](37-language-colors-and-reading-aids/SPEC.md) | P1 | M | 06, 19 | Optional accessible color per language; ruby readings above words (pinyin for Mandarin, kana for Japanese, the pronunciation elsewhere); vowel-mark mode. 02, 05. |
| 38 | [Per-site rules](38-per-site-rules/SPEC.md) | P1 | M | 18, 31, 50 | Languages and amount per site; sensitive-site defaults. 01, 03, 05. |
| 39 | [Multi-device sync](39-multi-device-sync/SPEC.md) | P1 | M | 11 | Delta sync with tombstones and ETags; settings in `storage.sync`; optional sync through the server. 04. |
| 40 | [Server packaging and Docker](40-server-packaging-docker/SPEC.md) | P1 | M | 04, 29 | Multi-arch Docker image and compose; `mix release`; service files for Linux, macOS and Windows; backup before migrations. 04. |
| 41 | [Telegram improvements](41-telegram-improvements/SPEC.md) | P1 (section 9 P0) | M | 07, 50 | Bot answers in the learner's language and looks up meanings in their base languages (section 9 ships with 50); pairing code instead of editing `.env`; safe `/remove` with confirmation; pending cleanup; message length limits; error handling. 04, 05, 06 F17, F18, F33, F38. |
| 42 | [Frames and shadow DOM](42-frames-and-shadow-dom/SPEC.md) | P1 | M | 15 | Swap inside iframes and open or closed shadow roots without hurting performance. 03, 06 F26. |
| 43 | [Copy, print and translate coexistence](43-copy-print-translate-coexistence/SPEC.md) | P1 | S | 15, 50 | Copy and print the page's original text, stay out of the way of machine translation. 03. |
| 44 | [Docs site](44-docs-site/SPEC.md) | P1 | M | 28, 50 | GitHub Pages: install guides per mode, privacy, troubleshooting, contributor docs; English and Spanish for install, privacy and troubleshooting, more by translators. 04. |
| 45 | [Firefox for Android](45-firefox-android/SPEC.md) | P1 | M | 19, 11 | Tap interactions, mobile layouts, local mode on mobile. 03, 05. |
| 46 | [Local stats and recap](46-local-stats-and-recap/SPEC.md) | P2 | M | 07, 50 | Words seen and added per target and base language, weekly recap, no URLs stored, no guilt mechanics. 05. |
| 47 | ~~[Hosted word packs](47-hosted-word-packs/SPEC.md)~~ | – | – | – | **Dropped** (2026-10-01): no word lists of any kind, hosted or subscribed ([DECISIONS](DECISIONS.md)). Replaced by 13 and 12; classrooms use 48's offered lists. |
| 48 | [Multi-user and classroom](48-multi-user-and-classroom/SPEC.md) | P2 | L | 07, 40, 50 | Users and tokens on one server; families; teachers offering word lists that each student reviews and accepts, never added automatically. 04. |
| 49 | [Dictionary verification](49-dictionary-verification/SPEC.md) | P2 | L | 09, 50 | Open dictionaries (CC-CEDICT, Wiktionary editions per base language) to verify model output and work offline, where a dictionary exists for the language pair. 02, 04. |
| 50 | [Base languages and UI localization](50-ui-localization-and-base-language/SPEC.md) | P0 | L | 02, 08 | The learner's base languages (detected from the browser, confirmed on the welcome tab, several allowed); the word-record shape for them; shared `spec/lang/` data that covers every language (Full for `en` and `es`, Basic for the rest; no pack per language); every string in `_locales` with English and Spanish at launch; translation workflow (Weblate); the cross-cutting rules every slice follows. Maintainer decision; 02, 05. |
| 51 | [Safari port](51-safari-port/SPEC.md) | P2 | L | 45 | macOS and iOS via Xcode conversion. 03. |
| 52 | [Video captions](52-video-captions/SPEC.md) | P2 | M | 15, 50 | Flicker-free swapping in YouTube and similar captions. 03. |
| 53 | [OpenSSF Best Practices badge](53-openssf-best-practices/SPEC.md) | P1 (§4.1, §4.2 and the passing badge P0) | M | 02, 03, 30 | Passing on the day the repository goes public, then silver: full criteria matrix with evidence; HTTP API and settings reference; vulnerability response process; GOVERNANCE, MAINTAINERS, roles and access continuity; roadmap; architecture; security requirements and assurance case; coding standards; test, regression and 80 % coverage policy; additions to 01, 02, 30, 40, 44; DCO question; gold outlook. OpenSSF criteria; 03. |
| 54 | [Pre-release security review](54-pre-release-security-review/SPEC.md) | P0 | M | every other P0 | Gate before the first store upload: three independent reviewers (hostile page and model, network and server, supply chain and release) each report on the whole release candidate; every claim, including "no issue", carries proof (`path:line`, a runnable reproduction or failing test, the observed output); the lead reruns every proof and only confirmed findings count; fixes with regression tests, checked by a fresh reviewer. Maintainer decision. |

## Critical path to the public release

```
02 tests ─┬─ 04 rename ─────────────────────────────────────────────────────────────────────────┐
          ├─ 07 word model ─ 08 tags ─ 50 base languages + i18n ─ 09 spec ─ 10 llm ─ 11 local ──┤
          └─ 14 matcher (any base) ─┬─ 15 safe swapping ─ 19 popover + 34 audio ────────────────┤
                                    └─ 16 skip rules, 17 casing, 18 precedence ─────────────────┤
05 brand ─ 06 design system ─┬─ 20 popup ───────────────────────────────────────────────────────┤
                             └─ 21 dashboard ─ 13 bulk add ─────────────────────────────────────┴─ 22 onboarding ─┐
03 OSS files, 01 auth, 29 ops, 25 errors, 26 sync, 27 a11y, 12 export, 24 add ────────────────────────────────────┴─ 28 privacy + listings ─ 54 security review ─ 30 release
```

50's base-language setting, `spec/lang/<base>/` data and `_locales` files come early: 09,
14, 16, 17 and 32 build on the data, and every UI slice (20, 21, 22, 24, 25) writes its
strings into `_locales` in English and Spanish as it goes, never as a pass at the end.

## Open questions for the maintainers

Collected from the slices; each slice repeats its own with a recommendation. Everything else
is decided; see [DECISIONS.md](DECISIONS.md).

1. **Who reads security@scriptkittyos.com?** Ideally at least two people.
   ([03](03-oss-foundations/SPEC.md))
2. **When a bilingual reader adds a word, look up meanings for all their base languages?**
   Recommendation: yes, in one model call, with chips to narrow before saving.
   ([50](50-ui-localization-and-base-language/SPEC.md))
3. **Who signs off the Spanish locale, store listing and welcome flow before release?**
   Recommendation: a named native speaker; a box on the release checklist.
   ([50](50-ui-localization-and-base-language/SPEC.md))
4. **Spanish register.** Recommendation: neutral Latin American Spanish, informal `tú`.
   ([50](50-ui-localization-and-base-language/SPEC.md))
5. **A celebration for the first swap on a real page?** Slice 32 adds `page:first-swap`,
   fired the first time one of the learner's words appears on any page in a language they
   read, so the Puerto Rico learner's confetti never waits on an English page.
   Recommendation: yes. ([32](32-page-coverage-and-celebrations/SPEC.md))
6. **DCO for the silver badge?** Slice 03 decided on no sign-off; silver lists the DCO as a
   SHOULD. Recommendation: keep the decision and mark it unmet with a justification;
   revisit at the first large company contribution or before gold.
   ([53](53-openssf-best-practices/SPEC.md))
7. **Who is the steward?** A trusted second owner of the GitHub organization and the store
   accounts, so the project survives the maintainer being unavailable. Recommendation: name
   them before the public release. ([53](53-openssf-best-practices/SPEC.md))
