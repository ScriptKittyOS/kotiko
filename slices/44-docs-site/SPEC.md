# 44 · Docs site

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | M (about a week) |
| **Depends on** | [28-privacy-and-store-readiness](../28-privacy-and-store-readiness/SPEC.md); uses [05-brand-identity](../05-brand-identity/SPEC.md) and [06-design-system](../06-design-system/SPEC.md) |
| **Unblocks** | The `/connect/` callback for [11](../11-local-first-mode/SPEC.md)'s "Connect OpenRouter"; "Learn more" links from [25](../25-plain-language-errors/SPEC.md) |
| **Sources** | [04 summary, S29, S31, section 3 release plan, docs-site slice](../../docs/research/04-architecture-release.md); [03 B9, D6, D8](../../docs/research/03-browser-extension.md); [05 S34, S39](../../docs/research/05-learner-ux.md) |

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
- a home for the OAuth callback page (slice 11).

The org can host static content safely and for free ([04 S31](../../docs/research/04-architecture-release.md)).

## Goals

- A fast, accessible, static site on GitHub Pages, deployed by CI from the main repo.
- Every URL the extension links to is stable and checked in CI.
- A learner can install and start from the site alone, in each mode, without reading
  anything about servers unless they choose that path.
- No analytics, no cookies, no third-party requests: the site follows the privacy policy
  it hosts.
- Contributors find architecture, the `spec/` folder, tests and the release process.

## Non-goals

- Writing the privacy policy text: slice [28](../28-privacy-and-store-readiness/SPEC.md).
  This slice publishes it.
- Translating the site: slice [50](../50-ui-localization-and-base-language/SPEC.md);
  the tool chosen here supports it.
- Word lists to download or subscribe to: never ([DECISIONS](../DECISIONS.md)). The site
  explains how to add words; it never supplies them.
- A blog or newsletter.

## User stories

- As a newcomer, I want "Install Mira in Firefox" to be three steps with pictures.
- As a learner who got "The free lookups are used up for today", I want the "Learn more"
  link to explain why and what to do.
- As a self-hoster, I want a Docker compose file and a page on reaching my server from my
  laptop over HTTPS.
- As a teacher, I want one page I can send my class that shows how to paste or drop the
  list I hand out into Mira and review it before saving.
- As a contributor, I want to know how the extension and server share `spec/`.

## Specification

### 1. Tool and location

- **Astro Starlight** in a `site/` folder of the main repo. Reasons: Markdown and MDX
  content, built-in client-side search (Pagefind, static, no third party), built-in
  i18n for slice 50, good accessibility defaults, light and dark themes, and it ships
  almost no JavaScript. Node and npm are dev-only; nothing reaches the extension.
- Alternatives considered: VitePress (similar, fine); MkDocs Material (Python; the project
  announced a move to maintenance in favour of a successor, medium confidence). Either
  would do; Starlight is recommended for i18n and search without a service.
- **URL**: `https://scriptkittyos.github.io/mira/` at launch. A custom domain is an open
  question; if one is added later, GitHub Pages redirects the old host.

### 2. Information architecture

```
/                      What Mira is, a before/after sample, three ways to start
/install/              Chrome, Edge, Brave · Firefox · Firefox for Android · Safari (later) · from source
/start/                Your first word, no key needed · Free OpenRouter key · Your own server
/providers/<id>/       One page per slice 11 preset: get a key, paste it, notes (Ollama origins, LM Studio)
/use/                  Adding words · Bulk add · Dashboard · The word popover · Languages and Focus ·
                       Amount · Per-site rules · Shortcuts and right-click · Back up, restore, delete
/server/               Why run one · Docker (slice 40) · Linux service · macOS and Windows ·
                       Telegram (slice 41) · Remote access over HTTPS (Tailscale) · Upgrades and backups ·
                       API reference (v1)
/privacy/              The policy from slice 28, versioned, with its changelog
/help/                 Troubleshooting index
/help/errors/#<code>   One anchored entry per slice 25 error code
/help/faq/             Pages Mira can't run on, Find in page, copying, page translation, other sites' tools
/connect/              Landing page for "Connect OpenRouter" (slice 11)
/contribute/           Dev setup · Architecture · spec/ folder · Tests · Releases · Translating
/changelog/            Generated from CHANGELOG.md at build time
```

**Stable URLs.** Paths the extension links to (`/privacy/`, `/help/errors/#…`,
`/connect/`, `/providers/<id>/`) are listed in `site/stable-urls.txt`. CI
fails if a build no longer produces one of them. Renamed pages get a redirect entry in the
Starlight config.

**Error pages.** Slice 25 owns the codes and the short in-extension copy. Each code gets an
entry here with: what happened, what still works, what to do, and a "For self-hosters"
detail block. The extension's link is `<site>/help/errors/#<code>`; a CI check compares
the codes in slice 25's `extension/errors.js` with the anchors on the page.

### 3. Content rules

- Plain English, short sentences, second person, no emojis, matching slice 05's voice.
- Every procedure is numbered steps, one action each, with a screenshot where a button is
  hard to find.
- Each page starts with a one-sentence answer, then detail.
- Platform facts that change (store review times, provider free tiers) carry a "Checked
  on" date.
- Provider pages link to the provider's own pricing and privacy pages rather than
  restating them.

### 4. Design

- Slice 06's tokens mapped onto Starlight's CSS custom properties; slice 05's logo and
  favicon; light and dark follow the system with a toggle.
- Fonts self-hosted from the repo. No Google Fonts or other CDNs.
- A small interactive demo on the home page may reuse the matcher module from slice 14
  (it is plain JS) to swap a sample paragraph as the visitor picks a language. Optional; a
  static before/after image is the fallback.

### 5. Screenshots

Generated, not hand-made: `site/scripts/screenshots.mjs` uses slice 02's Playwright
setup to load the unpacked extension on fixture pages and capture the popup, dashboard,
popover and welcome page in light and dark at fixed sizes. CI regenerates them on
release so the docs match the shipped UI. Slice 28's store screenshots can use the same
script at 1280x800.

### 6. Build, checks and deploy

- GitHub Actions workflow `site.yml`: on pushes to `main` that touch `site/**`,
  `CHANGELOG.md` or `extension/errors.js`, and on every release tag.
- Steps: install, build, then checks: internal and external links (lychee, external
  failures as warnings), `stable-urls.txt`, error anchors, axe accessibility scan of every
  page with Playwright (no serious or critical issues). Then deploy with
  `actions/deploy-pages`.
- Unreleased features: pages may carry `since: 0.6.0` in front matter; when that is newer
  than the latest release tag, the page shows "Coming in the next release" and is left out
  of the navigation.
- The README shrinks to a short description, a screenshot, install links and a link to
  the site; developer setup moves to `/contribute/`.

### 7. Privacy of the site

No analytics, cookies, embedded videos or third-party scripts. GitHub Pages itself sees
visitors' IP addresses under GitHub's privacy statement; the privacy policy says so in the
row for dictionary downloads (slice 28 section 1).

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
      its content section (CI diff).

## Test plan

- CI as in section 6, run on every PR that touches `site/**` (deploy only on `main`).
- A Playwright smoke test that opens `/connect/?code=test` with the unpacked extension and
  asserts the extension receives the code (slice 11's callback).
- Manual review of each page against section 3's rules before launch, and of provider
  pages each release.

## Rollout and migration

- Publish `/privacy/` first, before the store submission (slice 28), even if other pages
  are still drafts.
- Launch the rest with the first store release; the README links to it from that release on.
- Changelog: "New documentation site with install guides, provider guides, troubleshooting
  and the privacy policy."

## Open questions

1. **Custom domain.** Keep `scriptkittyos.github.io/mira` or use something like
   `mira.scriptkittyos.com`? Recommendation: a custom subdomain before launch if the org
   controls DNS, because the extension hard-codes these links and the OAuth callback;
   moving later needs a redirect and an extension update.
2. **Tool.** Starlight as recommended, or VitePress if a maintainer prefers it?
   Recommendation: Starlight.

## Future work

- Translated docs with slice 50.
- A "what's new" page per release with short clips.
- Server API reference generated from route definitions.
