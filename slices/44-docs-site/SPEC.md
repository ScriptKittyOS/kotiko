# 44 · Docs site

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | M (about a week) |
| **Depends on** | [28-privacy-and-store-readiness](../28-privacy-and-store-readiness/SPEC.md); uses [07](../07-word-model-v2/SPEC.md)'s respelling keys (`spec/lang/<base>/respelling.json`), [05-brand-identity](../05-brand-identity/SPEC.md), [06-design-system](../06-design-system/SPEC.md) and [50](../50-ui-localization-and-base-language/SPEC.md)'s locales, glossary and translation workflow |
| **Unblocks** | The `/connect/` callback for [11](../11-local-first-mode/SPEC.md)'s "Connect OpenRouter"; "Learn more" links from [25](../25-plain-language-errors/SPEC.md) |
| **Sources** | [DECISIONS 2026-10-02, pronunciation](../DECISIONS.md); [04 summary, S29, S31, section 3 release plan, docs-site slice](../../docs/research/04-architecture-release.md); [03 B9, D6, D8](../../docs/research/03-browser-extension.md); [05 S34, S39](../../docs/research/05-learner-ux.md) |

## Problem

All documentation is one README written for developers. Setup starts with "You need
Elixir 1.15+" (`README.md:30-32`), troubleshooting assumes you can read server logs
(`README.md:189-204`), and Firefox instructions describe temporary add-ons
(`README.md:181-185`). After slice 11, most users never touch a server, but they still need:

- install steps per browser, and a plain explanation of the three ways to start;
- step-by-step pages for getting a key from each provider;
- a stable public URL for the privacy policy (slice 28 needs it before submission);
- one page per error that the extension's "Learn more" links can point to (slice 25);
- a server guide for those who want Telegram, written for people who use Docker but not Elixir;
- a home for the OAuth callback page (slice 11);
- all of it in the learner's language: a Spanish speaker whose Kotiko is in Spanish would
  otherwise follow a "Learn more" link into English pages.

The org can host static content safely and for free ([04 S31](../../docs/research/04-architecture-release.md)).

## Goals

- A fast, accessible, static site on GitHub Pages, deployed by CI from the main repo.
- Every URL the extension links to is stable and checked in CI.
- A learner can install and start from the site alone, in each mode, without reading
  anything about servers unless they choose that path.
- No analytics, no cookies, no third-party requests: the site follows the privacy policy
  it hosts.
- Contributors find architecture, the `spec/` folder, tests and the release process.
- The pages a learner needs to start and stay safe (install, first word, privacy,
  troubleshooting and errors) exist in English and Spanish at launch, and the extension
  links to the page in its interface language
  ([50](../50-ui-localization-and-base-language/SPEC.md) rule 13).

## Non-goals

- Writing the privacy policy text: slice [28](../28-privacy-and-store-readiness/SPEC.md).
  This slice publishes it.
- Translating contributor and server pages: English only at launch (their readers work in
  English on GitHub anyway); other learner pages and other locales arrive through slice
  [50](../50-ui-localization-and-base-language/SPEC.md)'s translation workflow.
- Word lists to download or subscribe to: never ([DECISIONS](../DECISIONS.md)). The site
  explains how to add words; it never supplies them.
- A blog or newsletter.

## User stories

- As a newcomer, I want "Install Kotiko in Firefox" to be three steps with pictures.
- As a learner who got "The free lookups are used up for today", I want the "Learn more"
  link to explain why and what to do.
- As a self-hoster, I want a Docker compose file and a page on reaching my server from my
  laptop over HTTPS.
- As a teacher, I want one page I can send my class that shows how to paste or drop the
  list I hand out into Kotiko and review it before saving.
- As a contributor, I want to know how the extension and server share `spec/`.
- As a learner in Puerto Rico with Kotiko in Spanish, I want "Más información" to open a
  Spanish page.
- As a Spanish reader who sees "ja-ra-SHO" under хорошо, I want one page that tells me why
  there is a j, what the capitals mean and what "Generado por IA" means.

## Specification

### 1. Tool and location

- **Astro Starlight** in a `site/` folder of the main repo. Reasons: Markdown and MDX
  content, built-in client-side search (Pagefind, static, no third party), built-in
  i18n for slice 50, good accessibility defaults, light and dark themes, and it ships
  almost no JavaScript. Node and npm are dev-only; nothing reaches the extension.
- Alternatives considered: VitePress (similar, fine); MkDocs Material (Python; the project
  announced a move to maintenance in favour of a successor, medium confidence). Either
  would do; Starlight is recommended for i18n and search without a service.
- **URL**: `https://kotiko.org/` (decided: the maintainer owns `kotiko.org`, registered and
  served through Cloudflare). Spanish pages under `https://kotiko.org/es/`. GitHub Pages
  serves the files with `kotiko.org` as its custom domain, so
  `scriptkittyos.github.io/kotiko` redirects to it. The extension hard-codes only
  `https://kotiko.org/...` URLs (docs links, the OpenRouter sign-in callback of slice 11).

### 2. Information architecture

```
/                      What Kotiko is, a before/after sample, three ways to start
/install/              Chrome, Edge, Brave · Firefox · Firefox for Android · Safari (later) · from source
/start/                Your first word, no key needed · Free OpenRouter key · Your own server
/providers/<id>/       One page per slice 11 preset: get a key, paste it, notes (Ollama origins, LM Studio)
/use/                  Adding words · Bulk add · Dashboard · The word popover · How to read pronunciations ·
                       Languages and Focus · Amount · Per-site rules · Shortcuts and right-click ·
                       Back up, restore, delete
/server/               Why run one · Docker (slice 40) · Linux service · macOS and Windows ·
                       Telegram (slice 41) · Remote access over HTTPS (Tailscale) · Upgrades and backups ·
                       API reference (v1)
/privacy/              The policy from slice 28, versioned, with its changelog
/help/                 Troubleshooting index
/help/errors/#<code>   One anchored entry per slice 25 error code
/help/faq/             Pages Kotiko can't run on, Find in page, copying, page translation, other sites' tools
/connect/              Landing page for "Connect OpenRouter" (slice 11)
/contribute/           Dev setup · Architecture · spec/ folder · Tests · Releases · Translating
/changelog/            Generated from CHANGELOG.md at build time
```

**Stable URLs.** Paths the extension links to (`/privacy/`, `/help/errors/#…`,
`/connect/`, `/providers/<id>/`, `/use/pronunciations/`) are listed in `site/stable-urls.txt`. CI
fails if a build no longer produces one of them. Renamed pages get a redirect entry in the
Starlight config.

**Error pages.** Slice 25 owns the codes and the short in-extension copy. Each code gets an
entry here with: what happened, what still works, what to do, and a "For self-hosters"
detail block. The extension's link is `<site>/help/errors/#<code>`; a CI check compares
the codes in slice 25's `extension/errors.js` with the anchors on the page.

**How to read pronunciations** (`/use/pronunciations/`, and `/es/use/pronunciations/`).
One page per base language that has a respelling key, written for readers of that
language: the English page explains the English key, the Spanish page the Spanish key
(each is a different key, [07](../07-word-model-v2/SPEC.md) section 7, not a translation of
the other). It is the page the dashboard's "How to read this" sheet links to
([21](../21-dashboard/SPEC.md)) and the popover's help. Sections, in this order:

1. **Three lines, three jobs.** The popover's pronunciation block with пожалуйста as the
   example: the word with its stress mark (пожа́луйста), the pronunciation ("pa-ZHAL-sta" /
   the Spanish key's spelling), the romanization ("pozhaluysta") and why they differ: the
   romanization is how the word is spelled in Latin letters, for typing and search; the
   pronunciation is how it is said, written in the reader's own spelling.
2. **The key.** A table of every sound: how it is written, an example word in the reader's
   language, and examples from target languages (Spanish page: "j, como en jamón: хорошо
   ja-ra-SHO, house jaus"; English page: "kh, as in Scottish loch: хорошо kha-ra-SHO"). The
   table is generated at build time from `spec/lang/<base>/respelling.json` (`sounds` and
   `targets`), so the page can't drift from what the validator and the prompt use.
3. **Capitals mark the stress.** The syllable in capitals is said louder and longer; one per
   word; short words have none; languages without word stress (Japanese, Korean, French,
   Mandarin, Cantonese, Vietnamese) are all lowercase. Kotiko never uses accent marks for
   stress, so a Spanish reader is told not to read "SI" as the Spanish word.
4. **Tone digits.** For Mandarin and Cantonese, a small raised number after a syllable is its
   tone, as said in the sentence (你好 nee²-how³ / ni²-jao³), with a short line per tone and
   the reason it can differ from the pinyin's marks (tone sandhi). No digit means a neutral
   tone.
5. **The careful form.** "Slowly: pa-ZHA-lu-sta" ("Despacio: …") is the word said slowly
   and clearly, as a teacher would; the first line is how people say it every day. Most
   words have only one.
6. **Where it comes from.** "AI-generated" ("Generado por IA") means the AI wrote the
   pronunciation and no dictionary has checked it; "Checked in Wiktionary" means a
   dictionary agreed on the stress (or tones); "Wiktionary stresses it differently" means
   they disagree and the stress mark shows the dictionary's version; no label means the
   learner wrote it. How to fix one (the dashboard's Pronunciation field) and that the
   speak button ([34](../34-pronunciation-audio/SPEC.md)) is the best check for the sounds.
7. **Other languages you read.** Bases without a key get no written pronunciation yet: the
   stress mark, the romanization and audio still work, and how to help write a key
   (`spec/lang/README.md`).

The Spanish page carries a "beta" note until the Spanish key's review by readers from
Spain, Mexico, the Caribbean and the Southern Cone is signed off
([50](../50-ui-localization-and-base-language/SPEC.md) open question 5), and asks readers
to report a respelling that reads wrong in their variety.

### 3. Languages (i18n plan)

- **Starlight i18n** with English as the root locale at `/` and Spanish under `/es/`:
  `locales: { root: { label: "English", lang: "en" }, es: { label: "Español", lang: "es" } }`.
  Starlight's language picker, `hreflang` links and per-page fallback notice (shown in the
  visitor's locale) come built in. English is the root only because it is the source the
  pages are written in (as with slice 50's `default_locale`).
- **Launch set in Spanish**: `/es/` home, `/es/install/`, `/es/start/`, `/es/privacy/`,
  `/es/help/` and `/es/help/errors/` (every slice 25 code), `/es/help/faq/`,
  `/es/use/pronunciations/`, and the OpenRouter provider page. Other pages fall back to English with Starlight's notice.
- **Extension links** use the interface locale: with Kotiko in Spanish they point to
  `<site>/es/help/errors/#<code>`, else the root. Anchors (error codes) are identical in
  every locale, so one CI check covers both. `stable-urls.txt` lists the Spanish URLs too.
- **Privacy policy**: the Spanish page is a translation of slice 28's policy with the same
  version number and date, and a line saying which version governs if they differ (slice
  28 decides); CI fails if their versions differ.
- **Source and translation**: English Markdown in `site/src/content/docs/`; Spanish in
  `site/src/content/docs/es/`. Spanish pages are written or reviewed by a Spanish speaker
  before launch; after launch the `docs` component on Weblate (50 section 9) handles more
  locales. Front matter `sourceHash` records the English version a translation was made
  from; CI lists translations whose English source changed since, as a warning.
- **Examples for more than one base language**: the docs explain Kotiko with an English
  reader and a Spanish reader side by side ("dog" becomes 犬 on English pages, "perro"
  becomes 犬 on Spanish pages), and never say Kotiko "replaces English words".
- **Screenshots** are generated per locale (section 6) so a Spanish page shows the Spanish
  interface.

### 4. Content rules

- The "Why Kotiko?" page renders the story from its single source in
  [05](../05-brand-identity/SPEC.md) section 1 (`docs/story/<locale>.md`); the site never
  keeps its own copy.

- Plain language in every locale, short sentences, second person, no emojis, matching
  slice 05's voice and slice 50's glossary.
- Every procedure is numbered steps, one action each, with a screenshot where a button is
  hard to find.
- Each page starts with a one-sentence answer, then detail.
- Platform facts that change (store review times, provider free tiers) carry a "Checked
  on" date.
- Provider pages link to the provider's own pricing and privacy pages rather than
  restating them.

### 5. Design

- Slice 06's tokens mapped onto Starlight's CSS custom properties; slice 05's logo and
  favicon; light and dark follow the system with a toggle.
- Fonts self-hosted from the repo. No Google Fonts or other CDNs.
- A small interactive demo on the home page may reuse the matcher module from slice 14
  (it is plain JS) to swap a sample paragraph as the visitor picks a language. Optional; a
  static before/after image is the fallback.

### 6. Screenshots

Generated, not hand-made: `site/scripts/screenshots.mjs` uses slice 02's Playwright
setup to load the unpacked extension on fixture pages and capture the popup, dashboard,
popover and welcome page in light and dark at fixed sizes, once per docs locale (`en` and
`es`, with slice 02's browser-language profiles and a Spanish fixture page for the Spanish
shots). CI regenerates them on
release so the docs match the shipped UI. Slice 28's store screenshots can use the same
script at 1280x800.

### 7. Build, checks and deploy

- GitHub Actions workflow `site.yml`: on pushes to `main` that touch `site/**`,
  `CHANGELOG.md`, `extension/errors.js` or `spec/lang/*/respelling.json`, and on every
  release tag.
- Steps: install, build, then checks: internal and external links (lychee, external
  failures as warnings), `stable-urls.txt`, error anchors, axe accessibility scan of every
  page with Playwright (no serious or critical issues). Then deploy with
  `actions/deploy-pages`.
- Unreleased features: pages may carry `since: 0.6.0` in front matter; when that is newer
  than the latest release tag, the page shows "Coming in the next release" and is left out
  of the navigation.
- The README shrinks to a short description, a screenshot, install links and a link to
  the site; developer setup moves to `/contribute/`.

### 8. Privacy of the site

No analytics, cookies, embedded videos or third-party scripts. GitHub Pages itself sees
visitors' IP addresses under GitHub's privacy statement; the privacy policy says so in the
row for dictionary downloads (slice 28 section 1).

### 9. Additions for the OpenSSF Best Practices badge (from slice 53)

Added by [53](../53-openssf-best-practices/SPEC.md).

- **Quick start** (`documentation_quick_start`): `/start/` (and `/es/start/`) is the
  project's quick start. It is in `stable-urls.txt`, and the README's quick-start link
  points to it once the README shrinks (section 7). The badge answer links to it from then on.
- **One source for project documents** (`documentation_current`): the contributor and
  server pages render the repository's own files instead of copies:
  `docs/ARCHITECTURE.md`, `docs/CODING_STANDARDS.md`, `docs/reference/*.md`,
  `docs/security/*.md`, `GOVERNANCE.md` and `ROADMAP.md` are pulled in at build time, and
  the build fails if one is missing.
- **The badge in the footer** (`documentation_achievements`): the footer links to the
  project's bestpractices.dev entry. To keep section 8's promise of no third-party
  requests, the build downloads the badge image and serves it from the site; if the
  download fails, the footer shows a text link.
- **Hardening headers (gold's `hardened_site`)**: GitHub Pages alone can't send
  Content-Security-Policy, X-Frame-Options or X-Content-Type-Options headers, but
  `kotiko.org` is proxied through Cloudflare, which adds them with a response-header
  Transform Rule (CSP matching section 8's no-third-party policy, `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS). Once a header
  check confirms them, the badge entry's homepage becomes `https://kotiko.org/`; until
  then it stays the GitHub repository, which sends them. A `<meta http-equiv="Content-Security-Policy">` in the
  site's pages is still added as defence in depth, though it doesn't satisfy the
  criterion.

## Acceptance criteria

- [ ] The site builds and deploys from CI; every path in `stable-urls.txt` returns 200.
- [ ] Every slice 25 error code has an anchor on `/help/errors/`, enforced by CI.
- [ ] The axe scan reports no serious or critical issues on any page, in light and dark.
- [ ] A fresh visitor can install from a store and add a first word using only `/install/`
      and `/start/` (checked by someone outside the project, timed under 5 minutes).
- [ ] Each slice 11 preset has a provider page that was followed end to end with a real
      account before launch.
- [ ] The built site makes no request to any host other than its own (checked with
      Playwright's request log on every page).
- [ ] The privacy page matches the extension's bundled `privacy.html` byte for byte in
      its content section (CI diff), in English and in Spanish.
- [ ] Every page in section 3's Spanish launch set exists under `/es/`, and with the
      extension in Spanish every "Learn more" link opens a Spanish page.
- [ ] A Spanish speaker outside the project installs and adds a first word using only
      `/es/install/` and `/es/start/`.
- [ ] `/use/pronunciations/` and `/es/use/pronunciations/` exist, each with all seven
      sections; their key tables are generated from `spec/lang/en/respelling.json` and
      `spec/lang/es/respelling.json` and change when a key file changes; the Spanish page shows the "beta" note until the review box in 30's
      checklist is ticked.
- [ ] (53) `/start/` is in `stable-urls.txt`; the build fails if any `docs/` source it
      imports is missing; the footer badge is served from the site itself.

## Test plan

- CI as in section 7, run on every PR that touches `site/**` (deploy only on `main`).
- A Playwright smoke test that opens `/connect/?code=test` with the unpacked extension and
  asserts the extension receives the code (slice 11's callback).
- Manual review of each page against section 4's rules before launch, and of provider
  pages each release.

## Rollout and migration

- Publish `/privacy/` first, before the store submission (slice 28), even if other pages
  are still drafts.
- Launch the rest with the first store release; the README links to it from that release on.
- Changelog: "New documentation site with install guides, provider guides, troubleshooting
  and the privacy policy."

## Open questions

1. **Custom domain.** Decided: `kotiko.org`, on Cloudflare (DNS proxied, so it can send the
   hardening headers gold's `hardened_site` needs, [53](../53-openssf-best-practices/SPEC.md) §8).
2. **Tool.** Starlight as recommended, or VitePress if a maintainer prefers it?
   Recommendation: Starlight.

## Future work

- More docs locales through Weblate, and Spanish for the remaining learner pages.
- A "what's new" page per release with short clips.
- Server API reference generated from route definitions.
