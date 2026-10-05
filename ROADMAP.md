# Roadmap

Last reviewed: 2026-10-05. Horizon: through October 2027.

Where Kotiko is going in the next year, in one page. The detailed, buildable plan is in
[`slices/`](slices/README.md): one spec per piece of work, with its priority and what it
depends on. Decisions already made are in [`slices/DECISIONS.md`](slices/DECISIONS.md).

## Now: the first public release

Everything marked P0 in [`slices/README.md`](slices/README.md#priorities-and-phases), in
four phases that overlap:

1. **Foundations.** Server authentication hardening, tests and CI, the open-source files,
   the rename to Kotiko, a word model whose meanings are stored in the learner's own
   languages, language tags, and the translation files every interface string lives in.
   Slices [01](slices/01-api-auth-hardening/SPEC.md),
   [02](slices/02-test-harness-and-ci/SPEC.md), [03](slices/03-oss-foundations/SPEC.md),
   [04](slices/04-rename-to-kotiko/SPEC.md), [07](slices/07-word-model-v2/SPEC.md),
   [08](slices/08-language-tags/SPEC.md),
   [50](slices/50-ui-localization-and-base-language/SPEC.md).
2. **Correct on every page.** Matching words in any language, including ones written
   without spaces; swapping without breaking sites; leaving alone what shouldn't change;
   capitals per language; which language a word shows in. Slices
   [14](slices/14-matcher-engine/SPEC.md) to [18](slices/18-language-precedence-and-mixing/SPEC.md).
3. **Local first, beautifully.** Words kept in the browser and looked up with your own AI
   key, the server optional; the brand and design system; popup, dashboard, bulk add,
   first-run welcome, the word popover with pronunciation. Slices
   [05](slices/05-brand-identity/SPEC.md), [06](slices/06-design-system/SPEC.md),
   [09](slices/09-shared-word-spec-and-prompt/SPEC.md) to
   [13](slices/13-bulk-add/SPEC.md), [19](slices/19-word-popover/SPEC.md) to
   [22](slices/22-first-run-onboarding/SPEC.md), [24](slices/24-add-flow-safety/SPEC.md)
   to [27](slices/27-accessibility-baseline/SPEC.md),
   [29](slices/29-server-ops-hardening/SPEC.md), [34](slices/34-pronunciation-audio/SPEC.md).
4. **Release.** Privacy policy and store listings, a security review by three independent
   reviewers, the release pipeline, and the OpenSSF Best Practices passing badge on the day
   the repository goes public. Slices [28](slices/28-privacy-and-store-readiness/SPEC.md),
   [54](slices/54-pre-release-security-review/SPEC.md),
   [30](slices/30-release-pipeline/SPEC.md), [53](slices/53-openssf-best-practices/SPEC.md).

## Next: the six months after the release

The P1 slices:

- Reading comfort: density and amount ([31](slices/31-density-and-amount/SPEC.md)), page
  coverage and celebrations ([32](slices/32-page-coverage-and-celebrations/SPEC.md)),
  language colours and reading aids ([37](slices/37-language-colors-and-reading-aids/SPEC.md)),
  per-site rules ([38](slices/38-per-site-rules/SPEC.md)).
- Learning: right-click and keyboard shortcuts
  ([33](slices/33-context-menu-and-shortcuts/SPEC.md)), test yourself and review
  ([35](slices/35-reveal-mode-and-review/SPEC.md)), grammar and word senses
  ([36](slices/36-grammar-and-senses/SPEC.md)).
- More places: sync between devices ([39](slices/39-multi-device-sync/SPEC.md)), frames
  and shadow DOM ([42](slices/42-frames-and-shadow-dom/SPEC.md)), copy, print and page
  translation ([43](slices/43-copy-print-translate-coexistence/SPEC.md)), Firefox for
  Android ([45](slices/45-firefox-android/SPEC.md)).
- The server and docs: Docker and packaged releases
  ([40](slices/40-server-packaging-docker/SPEC.md)), Telegram improvements
  ([41](slices/41-telegram-improvements/SPEC.md)), the docs site
  ([44](slices/44-docs-site/SPEC.md)).
- Project health: the OpenSSF Best Practices badge at silver
  ([53](slices/53-openssf-best-practices/SPEC.md)).

## Later

The P2 slices, when someone wants to pick them up: local stats and a weekly recap
([46](slices/46-local-stats-and-recap/SPEC.md)), several learners on one server and
classrooms ([48](slices/48-multi-user-and-classroom/SPEC.md)), checking words against open
dictionaries ([49](slices/49-dictionary-verification/SPEC.md)), Safari
([51](slices/51-safari-port/SPEC.md)) and video captions
([52](slices/52-video-captions/SPEC.md)).

## What Kotiko will not do

From [DECISIONS.md](slices/DECISIONS.md) and the slice specs:

- No paid tier and no hosted accounts. Kotiko is a free tool you run yourself.
- No word lists or packs added for you, hosted or bundled. Every word is one you chose.
- No telemetry, analytics or ads.
- No bundler and no runtime npm code in the extension: what's in `extension/` is what
  ships, so anyone can read it.
- Never adding a word you didn't choose, from a teacher, a server or anyone else, without
  your say.

## How this page changes

The lead maintainer reviews it every quarter and at each minor release, and updates the
"Last reviewed" date. A change in direction is decided as described in
[GOVERNANCE.md](GOVERNANCE.md) and recorded in DECISIONS.md first; `slices/README.md` stays
the detailed plan.
