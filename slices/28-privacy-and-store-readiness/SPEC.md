# 28 · Privacy and store readiness

| | |
|---|---|
| **Status** | Built (2026-10-05), in English; §6 partly, §9 and the artwork wait for the maintainer and the artist; see Implementation notes |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [11-local-first-mode](../11-local-first-mode/SPEC.md), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (`_locales`, the Weblate `store-listing` component, the glossary); uses [05-brand-identity](../05-brand-identity/SPEC.md) artwork, [12-export-import-and-delete](../12-export-import-and-delete/SPEC.md) deletion, [19-word-popover](../19-word-popover/SPEC.md) DOM changes |
| **Unblocks** | [30-release-pipeline](../30-release-pipeline/SPEC.md), [44-docs-site](../44-docs-site/SPEC.md) |
| **Sources** | [DECISIONS: store publisher; English is not the base language](../DECISIONS.md); [04 summary, S24, S25, S29, S30](../../docs/research/04-architecture-release.md); [03 summary, C4, C5, C6, E4, E6, E7, open questions 6 and 8](../../docs/research/03-browser-extension.md); [06 F36](../../docs/research/06-adversarial-qa.md) |

> **Note (2026-10-05):** Spanish copy in this spec (listings, policy, messages, release
> notes, acceptance criteria) is optional, not a must-have. Only English is required at
> launch; see [DECISIONS 2026-10-05](../DECISIONS.md).

## Problem

Kotiko can't be listed in either store today, and a learner installing it has no written
answer to "what does this do with my data?"

- There is no privacy policy. Both stores require one for an extension that handles
  website content and sends user text to a third party ([03 E6](../../docs/research/03-browser-extension.md)).
- The manifest has no `browser_specific_settings.gecko.data_collection_permissions`
  (`extension/manifest.json:22`). Since 3 November 2025 AMO refuses new add-ons without
  it (Mozilla Extension Workshop, checked 2026-10-01).
- `<all_urls>` is requested for both host permissions and content scripts
  (`manifest.json:7`, `manifest.json:13-14`). That triggers Chrome's in-depth review and
  the strongest install warning, and needs a written justification.
- Firefox's default MV3 extension CSP adds `upgrade-insecure-requests`, which probably
  breaks the README's `http://<tailscale-ip>:4747` setup (`README.md:175-179`; medium
  confidence, [03 C5](../../docs/research/03-browser-extension.md)).
- Firefox users can revoke host permissions at any time, and the README tells them to
  grant them by hand (`README.md:181-185`). Chrome users can also restrict site access to
  "on click". Kotiko never checks, so it silently does nothing.
- The server token sits in `storage.local` (`extension/popup.js:215-219`), readable by
  every content script ([06 F36](../../docs/research/06-adversarial-qa.md)). Slice 11
  moves it; this slice verifies it, because store reviewers and the privacy policy rely on it.
- Swapped words are readable by any page script through `.slovo-w`, `data-en` and
  `title` (`extension/content.js:91-97`) ([03 E4](../../docs/research/03-browser-extension.md)).
- There are no listing texts, screenshots or promo tiles, and the ScriptKittyOS publisher
  accounts the maintainer decided on don't exist yet.
- The descriptions drafted so far say Kotiko swaps "English words", which is wrong since
  the base-language decision: Kotiko swaps words in whatever languages the learner reads
  ([50](../50-ui-localization-and-base-language/SPEC.md)). A learner in Puerto Rico with a
  Spanish browser would see an English-only listing promising English pages.

## Goals

- A plain-language privacy policy, published on the docs site and bundled in the
  extension, that matches what the code does, item by item.
- Complete, accurate Chrome Web Store submission content: single purpose, permission
  justifications, data disclosures, certifications.
- A manifest that AMO accepts: data collection declaration, minimum versions, CSP.
- Kotiko notices when it lacks site access and offers a one-click fix.
- An automated check that no secret is reachable from a content script.
- Listing copy and asset specs ready for slice 05's artwork and slice 30's upload.
- The listing, screenshots and privacy policy exist in **English and Spanish** at launch,
  and every listing and policy text is base-neutral: no sentence assumes the learner reads
  English.
- ScriptKittyOS publisher accounts on both stores, with `hello@scriptkittyos.com` as the
  public contact and at least two maintainers able to publish.

## Non-goals

- Implementing secret storage and the sender checks: slices [11](../11-local-first-mode/SPEC.md)
  and [26](../26-background-sync-correctness/SPEC.md). This slice audits them.
- Replacing the `title` tooltip and data attributes: slice [19](../19-word-popover/SPEC.md).
- Sensitive-site defaults: slices [16](../16-what-not-to-swap/SPEC.md) and [38](../38-per-site-rules/SPEC.md).
- Automating uploads: slice [30](../30-release-pipeline/SPEC.md).
- Drawing the artwork: slice [05](../05-brand-identity/SPEC.md).
- Safari's App Store privacy label: slice [51](../51-safari-port/SPEC.md).
- Translation tooling and locales beyond English and Spanish: [50](../50-ui-localization-and-base-language/SPEC.md);
  community translations of the listing arrive through its `store-listing` component.

## User stories

- As a cautious learner, I want to read in two minutes exactly what leaves my computer.
- As a store reviewer, I want each permission explained in one sentence tied to a
  feature I can test.
- As a Firefox user who revoked site access, I want Kotiko to tell me and fix it in one click.
- As a self-hoster on Tailscale, I want my `http://100.x.y.z` server to keep working in Firefox.
- As a Spanish speaker browsing the Chrome Web Store in Spanish, I want the listing, the
  screenshots and the privacy policy in Spanish, and to see that Kotiko works on Spanish
  pages.

## Specification

### 1. Data inventory (single source of truth)

`docs/privacy/inventory.md` holds this table. The policy, the CWS form and the AMO
declaration are written from it, and a PR that changes what leaves the device must update
it (a checkbox in the PR template from slice 03).

| Data | Stored where | Leaves the device? | To whom, when |
|---|---|---|---|
| Page text and URLs | Not stored; read in memory to swap words | Never | Nobody |
| Your words (the word, its meaning in your language, notes, source text) | Extension (IndexedDB, slice 11) | Only if you connect a server | Your own Kotiko server |
| Text you type to add a word, plus the names of your five most recent languages | Job queue until done | Yes, when you add a word | The model provider you chose (OpenRouter by default), or your server, which forwards it to its provider |
| Text you select and send with "Learn this in…" (slice 33), plus the page's declared language | Job queue until done | Yes, when you use the menu | Same as above. Never the URL |
| API key, server token | Extension (IndexedDB, not readable by page-side scripts) | Only to the service it belongs to | Your provider or your server |
| Settings | `storage.sync` / `storage.local` | Through your browser's own sync, if you use it | Google or Mozilla, under their sync terms |
| Learning stats (slice 46) | Extension | Never | Nobody |
| A word you ask to hear (slice 34) | Not stored | Only if you turn on online voices (off by default) | Your browser's or operating system's speech service (for example Google, Microsoft or Apple) |
| A word you add in a language with word stress, only the word (slice 49 §4b) | Its Wiktionary page's pronunciations, 30 days, in the lookup cache | Yes, when you add the word, and once for words saved earlier | The Wikimedia Foundation (en.wiktionary.org), under its privacy policy |
| Requests for dictionaries (slice 49) and the free-model list | Not stored | The request itself (your IP address) | GitHub Pages; OpenRouter's public models list |
| Telegram messages and voice notes (server add-on) | Your server | Yes | Telegram; your transcription provider |

Kotiko has no analytics, telemetry, crash reporting, ads or remote configuration. It does
not set an uninstall URL (`runtime.setUninstallURL`), because that is a network signal
about the user.

### 2. Privacy policy

Published at `<docs site>/privacy/` (slice 44) and bundled as
`extension/privacy.html`, linked from the settings page and the welcome page. Dated, with
a version, and a changelog at the bottom. Reading level: plain language, short sentences,
no legal boilerplate beyond what the stores require.

**Languages.** The policy ships in English and Spanish at launch: `docs/privacy/en.md` and
`docs/privacy/es.md` on the docs site (slice 44's Starlight i18n), and
`extension/privacy.html` renders the copy for the interface language, falling back to the
source language for untranslated locales. The English text is the source; a change to it
updates the Spanish in the same PR (the second-speaker review from slice 50 applies), and
both carry the same version and date. Other translations come through Weblate and are
marked "translation; the English version is the reference" until a maintainer reviews
them.

Outline:

1. **The short version** (five bullets): page content never leaves your browser; words
   you add are looked up by the model provider you choose; Kotiko has no servers of its own
   and collects nothing; your words live in your browser unless you connect your own
   server; you can export or delete everything at any time.
2. **Who makes Kotiko**: ScriptKittyOS, a free open-source project, with the repo link.
3. **What stays on your device**: section 1's "never leaves" rows.
4. **What leaves your device, and only when you act**: the provider row, with a
   paragraph per preset linking to that provider's privacy policy, and a sentence on
   OpenRouter's training and retention settings and the "don't keep my text" option
   (slice 11, open question 1).
5. **What websites can see**: swapped words are visible in the page, so a site's own
   scripts or session-recording tools can see that you use Kotiko and which words appear.
   Slice 19 removes the original words and Kotiko's attributes from the page; the
   visible words remain. "Pause on this site" (slice 38) stops it.
6. **Your own server** (optional add-on): you are its operator; what it stores; Telegram.
7. **Browser sync**: settings follow your browser account if sync is on.
8. **Keeping and deleting data**: export, delete everything, uninstall (slice 12).
9. **Security**: keys kept away from page scripts; how to report a vulnerability (slice
   03's SECURITY.md).
10. **Children**: Kotiko is not directed at children under 13 and collects nothing from anyone.
11. **Changes**: announced in the changelog and the extension's "What's new" before they
    take effect, as CWS policy requires for changes in data practice.
12. **Contact**: `hello@scriptkittyos.com` for questions about this policy. ScriptKittyOS
    holds no data about you, so there is nothing for it to look up or delete; the policy
    says so and points to Delete everything. Security reports go to the address in
    SECURITY.md.

### 3. Chrome Web Store submission

**Single purpose** (the form's text field; CWS takes one text, so it is in English and
names no reading language):

> Kotiko replaces words on the web pages you read, in your own language, with the words you
> are learning in other languages, so you pick up vocabulary while you browse.

**Permissions and justifications** (final list once slices 11, 15 and 33 land):

| Permission | Justification |
|---|---|
| Host `<all_urls>` and content script on `<all_urls>` | Kotiko's single purpose is to swap words on any page you read; it can't know in advance which sites you read. Page content is processed locally and never transmitted. Host access also lets Kotiko call the model provider or self-hosted server you configure. |
| `storage` | Keeps your words and settings in your browser. |
| `unlimitedStorage` | Large vocabularies (up to 20,000 words) and keeping them safe from storage eviction. |
| `alarms` | Retries word lookups when the free model quota resets, and refreshes from your own server. |
| `scripting` | Starts Kotiko in tabs that were already open when it was installed or updated (slice 15). |
| `contextMenus` | "Learn this in…" on selected text (slice 33). |
| `identity` (only if slice 11's spike chooses `launchWebAuthFlow`) | Signs you in to OpenRouter to create a key without copying it. |

**Remote code**: "No, I am not using remote code." Words, dictionaries and the model
list are data, validated by slice 09's schemas; no code is fetched or evaluated.

**Data usage disclosures** (the form's checkboxes; medium confidence on how CWS reviewers
read "collect" for user-directed transmissions, so the justification text spells it out):

| Category | Tick? | Note |
|---|---|---|
| Website content | Yes | Read locally to swap words; text you select and send with "Learn this in…" goes to your chosen provider. |
| Authentication information | Yes | Your own provider key and server token, stored locally and sent only to that service. |
| Personally identifiable, health, financial, personal communications, location, web history, user activity | No | |

Certifications: data is not sold to third parties, not used or transferred for purposes
unrelated to the single purpose, and not used for creditworthiness or lending. All
three are true.

**EU trader status**: see section 9.

**Review expectations**: in-depth review for `<all_urls>`, typically several days. The
reviewer notes field says: "No account or key needed to test: on the welcome page, type
a word and its meaning in the language the reviewer's browser uses (for example
“hola = hello” in an English browser, or “dog = perro” in a Spanish one), press Make it my
first word, then Try it on a page in that language."

### 4. Firefox (AMO) manifest and submission

```json
"browser_specific_settings": {
  "gecko": {
    "id": "<slice 04's new id>",
    "strict_min_version": "140.0",
    "data_collection_permissions": {
      "required": ["none"],
      "optional": ["websiteContent"]
    }
  },
  "gecko_android": { "strict_min_version": "142.0" }
}
```

- 140 and 142 are the first desktop and Android versions that read
  `data_collection_permissions` (MDN browser-compat-data); 140 is an ESR, so ESR users
  are covered.
- **Why `none` is required and `websiteContent` optional.** Out of the box, with words
  typed with their meaning (“hola = hello”, “dog = perro”), Kotiko transmits nothing. Text typed into the
  add box is the user's own input sent to a provider they configured; it matches none of
  Mozilla's categories, which describe data about the user's browsing. Text selected on
  a page and sent with "Learn this in…" is website content. Kotiko requests the optional
  `websiteContent` consent (`permissions.request({data_collection: ["websiteContent"]})`) the first time
  the user uses that menu item with a remote provider; if refused, the menu still opens
  the popup with the text prefilled, so the user sends it by typing Enter. Confidence:
  medium on the category reading, medium-low on the runtime request API shape. Before the
  first submission, ask in the AMO review notes and adjust (open question 2).
- AMO needs no source submission while the extension has no build step or minified code
  ([03 E7](../../docs/research/03-browser-extension.md)). Slice 30 keeps it that way or
  attaches sources.
- `web-ext lint` must pass with zero errors and zero warnings about the manifest in CI
  (slice 02).

### 5. Extension CSP

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'"
}
```

This is Chrome's MV3 default, stated explicitly. In Firefox it replaces the default that
includes `upgrade-insecure-requests`, so `http://` servers on a LAN or Tailscale address
keep working. Kotiko's own pages load nothing remote, so nothing else is lost.

Because plain HTTP sends the server token in cleartext, the server URL field shows, for
any `http://` address that is not loopback: "This connection isn't encrypted. Use HTTPS
(for example `tailscale serve`) if anyone else shares this network." The connection still
works. Chrome's Local Network Access prompt does not apply to extensions with host access
from Chrome 144 (medium-high confidence, [03 C6](../../docs/research/03-browser-extension.md));
the error copy for a blocked LAN request comes from slice 25.

### 6. Site access check

Both Firefox and Chrome let users withhold host access after install.

- On popup open, the background answers `{allSites, thisSite}` from
  `permissions.contains({origins: ["<all_urls>"]})` and
  `permissions.contains({origins: [tabOrigin + "/*"]})`.
- If `thisSite` is false, the popup's top card reads:

  ```
  +--------------------------------------------+
  | Kotiko can't see this site yet.              |
  | [Allow on all sites]   Allow only here     |
  +--------------------------------------------+
  ```

  Both buttons call `permissions.request` directly in the click handler (a user gesture
  is required). "Allow on all sites" is the primary action because it is Kotiko's purpose.
- `permissions.onAdded` and `onRemoved` update the toolbar badge (slice 20's "off"
  state) and inject into the tab when access arrives (slice 15's injection).
- The provider or server origin is checked the same way before a lookup; if missing, the
  job waits with slice 25's `permission_missing` code and the same button.
- Slice 22's welcome page runs the same check as its first step (step 0).

### 7. Secrets and page exposure audit

A CI end-to-end test (slice 02's Playwright harness) and a release checklist item:

1. Configure a fake provider key and server token through the UI.
2. From a content script test hook, read `storage.local.get(null)`,
   `storage.sync.get(null)`, and attempt `storage.session.get(null)`; assert no value
   contains either secret.
3. From a page-world script, read `document.documentElement.outerHTML` after swaps, on an
   English page and on a Spanish page; assert no original word, no word id, and no Kotiko attribute except what slice 19
   allows.
4. Send every privileged message type from a content script; assert each is refused.
5. Assert the manifest has no `externally_connectable`, and `web_accessible_resources`
   holds only what slice 19 needs, with `use_dynamic_url: true` in Chrome.
6. Grep the built package for `console.log` calls that could print a key.

### 8. Listing copy and assets

**Where the copy lives.** The name and short description come from the manifest's
`__MSG_extName__` and `__MSG_extDescription__` (50's `_locales`), so each store shows them
in the visitor's language wherever a locale exists. The long description, screenshot
captions and promo tile text live in `store/listing/<locale>.json` (the Weblate
`store-listing` component from 50), which slice 30's upload reads per locale. CWS takes a
localized description per locale from the `_locales` folder plus per-locale text in the
dashboard; AMO takes per-locale name, summary and description through its API. Locales
that are not 100% translated are not uploaded; the store falls back to the default
locale for them.

**Name**: "Kotiko" plus a descriptor, final wording after slice 04's name check, for
example "Kotiko: learn languages while you browse" / "Kotiko: aprende idiomas mientras
navegas" (CWS allows 75 characters).

**Short description** (CWS summary, 132 characters max; AMO summary, 250 max):

> en: Swap words on the pages you read for the words you're learning, in any language.
> Free, open source, and private by design.
>
> es: Cambia palabras de las páginas que lees por las que estás aprendiendo, en cualquier
> idioma. Gratis, de código abierto y privado.

Both versions are checked against the character limits in CI (a small script reading
`_locales/*/messages.json`).

**Long description outline** (same in both languages; the glossary from 50 keeps terms
consistent): what it does in one paragraph, saying it works on pages in the learner's own
languages, detected from the browser; three ways to start
(type a word with its meaning, no key needed; a free OpenRouter key; your own server); "What leaves your computer" in
three lines; keyboard and accessibility notes; why it needs access to all sites; links to
docs, privacy, source and issues.

**Assets** (artwork from slice 05; layouts from slice 06):

| Asset | Chrome Web Store | AMO |
|---|---|---|
| Icon | 128x128 PNG (96x96 artwork, 16 px transparent padding) | 128x128 and 64x64 from the manifest |
| Screenshots | 1280x800 PNG, up to 5 | Same files (AMO accepts them; 1.6:1 recommended) |
| Small promo tile | 440x280, required | n/a |
| Marquee | 1400x560, optional | n/a |

Screenshot set, made twice, once per launch locale, with the interface and the page in
that language:

| # | English set (interface `en`, base `en`) | Spanish set (interface `es`, base `es`) |
|---|---|---|
| 1 | English Wikipedia article with Spanish and Japanese swaps, popover open | Spanish Wikipedia article with English and Japanese swaps ("dog" for "perro"), popover open |
| 2 | Popup adding a word | Popup adding "¿cómo se dice gato en japonés?" |
| 3 | Dashboard | Dashboard |
| 4 | Welcome page | Welcome page with "español" detected |
| 5 | Dark mode | Dark mode |

Each locale's listing uploads its own set. Use openly licensed pages (Wikipedia, with
attribution in the listing) and no third-party logos. Captions in each image, short, in
the design system's type, from `store/listing/<locale>.json`. The screenshots are produced
by slice 44's Playwright screenshot script with the browser launched in each locale, so
they are regenerated when the UI changes.

### 9. Publisher accounts and contact

Decided by the maintainer ([DECISIONS](../DECISIONS.md)): both listings are published
under the ScriptKittyOS organization, and the public contact is
`hello@scriptkittyos.com`. No personal address appears on either listing.

**Chrome Web Store**

- A group publisher account for ScriptKittyOS. CWS lets a developer account publish on
  behalf of a Google Group, so every member of the group can manage the item (high
  confidence; the dashboard calls this a group publisher).
- The Google Group (for example `kotiko-publishers@` on the org's Google Workspace, or a
  plain Google Group if the org has none) is private; its members are the maintainers who
  release. At least two people, so a release never depends on one account.
- One-time $5 registration fee, paid once by the account that creates the publisher.
- 2-Step Verification on every member account (CWS requires it to publish).
- Contact email in the account settings: `hello@scriptkittyos.com`, verified through the
  dashboard's confirmation mail. It is shown on the listing.
- The Chrome Web Store API credentials slice 30 uses for uploads belong to one member's
  OAuth client inside the org's Google Cloud project, stored as GitHub Actions secrets,
  and are rotated when that member leaves.

**Firefox Add-ons (AMO)**

- An org Mozilla account (display name "ScriptKittyOS", sign-in address an internal alias
  that forwards to the maintainers) owns the add-on. Maintainers' own Mozilla accounts are
  added as developers and marked as not listed, so the listing shows "ScriptKittyOS" only.
- Two-step authentication on every account with access.
- Listing support email: `hello@scriptkittyos.com`; support site: the docs site (slice 44).
- The AMO API key and secret that `web-ext sign` uses (slice 30) are generated from the
  org account and stored as GitHub Actions secrets.

**Who has access**: the maintainers listed in `MAINTAINERS.md` (slice 03), and nobody
else. Adding or removing someone is a PR to that file plus the change in both dashboards,
noted in the release checklist.

**EU trader declaration (Digital Services Act)**: both stores ask developers whether they
act as a trader; traders must show a postal address and phone number to EU users. Kotiko is
free, has no paid tier, ads or donations inside the product, and is published by an
open-source project, so declare **non-trader** on the Chrome Web Store, and on AMO if it
asks. Confidence: high that CWS asks for this declaration; medium on AMO's current form;
medium that non-trader is right, because it depends on whether ScriptKittyOS itself
trades. If ScriptKittyOS is a registered business that sells other products or services,
the declaration should be checked against that before submitting.

**Edge Add-ons**: optional, same package and contact, decided in slice 30.

## Implementation notes

Built 2026-10-05, in English only ([DECISIONS 2026-10-05](../DECISIONS.md) overrides the
Spanish copy, screenshots and acceptance criteria above). Files are laid out so
translations drop in later: `docs/privacy/<locale>.md`, `store/listing/<locale>.json`,
`extStoreName`/`extDescription` per locale.

Primary sources, checked 2026-10-05: Chrome Web Store
[program policies](https://developer.chrome.com/docs/webstore/program-policies),
[Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use),
[user data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
(handling includes data processed only on the device),
[privacy practices tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy),
[images](https://developer.chrome.com/docs/webstore/images),
[manifest `name`](https://developer.chrome.com/docs/extensions/reference/manifest/name)
(75 characters); Chrome's [storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
(`local` and `sync` are open to content scripts, `session` isn't); Firefox
[add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/),
[built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
(required for new add-ons from 3 November 2025; Firefox 140 desktop, 142 Android),
[MDN `browser_specific_settings`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings),
[MDN extension CSP](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_Security_Policy)
(Firefox's MV3 default is `script-src 'self'; upgrade-insecure-requests;`),
[AMO listing guide](https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/)
(summary 250 characters); AMO's 50-character name limit from
[mozilla/addons#7487](https://github.com/mozilla/addons/issues/7487); Google's
[Gemini API terms](https://ai.google.dev/gemini-api/terms) for the policy's Gemini line.

**§1 Inventory.** `docs/privacy/inventory.md`, written from the code (every `fetch`,
host and storage key was traced; each row names its code). It differs from the table
above where the code does:

- Added: the background pronunciation refresh, which sends saved words without a
  pronunciation (word, meaning, sense, base) to the learner's provider; the model list
  (`/models`) for every provider and OpenRouter's `/key`; the Test button's "hello"; the
  recent-languages names sent with each lookup; `seedSalt` in `storage.sync`; the paused
  host names and add jobs (typed text, 7 days) in `storage.local`; the welcome page's
  "Try it on a page" Wikipedia link; the server's 30-day lookup cache and 24-hour add
  answers; OpenRouter's `HTTP-Referer`/`X-Title` and Wiktionary's `Api-User-Agent`.
- Left out because they aren't built: "Learn this in…" (33) and learning stats (46).
- `test/unit/store-readiness.test.mjs` counts network primitives per file and every host
  named anywhere in the package against the inventory's §4 and §5 tables, so a new
  request or host fails CI until the inventory says what it is.

**§2 Policy.** `docs/privacy/en.md`, version 1, 5 October 2026, following the outline.
`scripts/sync-privacy.mjs` copies each `docs/privacy/<locale>.md` into
`extension/privacy/`; `extension/privacy.html` renders the copy for Kotiko's interface
language (its own setting, else the browser's) with English as the fallback, through
`lib/policy.js` (headings, paragraphs, lists, bold, code, `<https://…>` links, all as text
nodes). Linked from the dashboard's Settings → About and the welcome page's footer
(`privacy_link`). The copy check runs inside `npm test`, so it needs no workflow change;
slice 30 may add `node scripts/sync-privacy.mjs --check` to CI's list.

**§3 Chrome.** `store/chrome-web-store.md`: listing fields, single purpose (as written),
a permissions table that the test checks both ways against the manifest (permissions,
optional ones, hosts, content-script matches), remote code, data usage, certifications,
distribution, reviewer notes. The manifest has no `contextMenus` or `identity` yet, so
neither has a row. The listing name is the new `extStoreName` ("Kotiko: learn languages
while you browse", 40 characters, under Edge's 45); `short_name` and the toolbar title stay
"Kotiko". `extDescription` is the short description above.

**§4 Firefox.** `strict_min_version` 140, `gecko_android` 142 and
`data_collection_permissions: {required: ["none"]}`; `store/firefox-amo.md` explains each
and has the reviewer notes, which ask AMO about open question 2.

**§5 CSP.** `content_security_policy.extension_pages` is `script-src 'self'; object-src
'self'`. The http warning is `ServerUrl.sendsInClear()` in `lib/url.js`, shown under the
server address in the dashboard, the welcome page and the popup's Connection settings
(the popup loads `lib/url.js` on first use, keeping it out of the first paint).

**§7 Audit.** `test/e2e/privacy.spec.mjs` (Chromium) sets a key and a token through the
dashboard and popup, then, inside Kotiko's content-script world through the DevTools
protocol: reads `storage.local`, `storage.sync` and `storage.session` (refused) and the
IndexedDB it can open (the page's, with none of Kotiko's stores), finding neither secret;
sends every privileged message type (enumerated from the router, `onMessage.routes` in
`lib/messages.js`) and gets `forbidden` for each; rewrites the provider address and checks
the key never follows. Page scripts on an English and a Spanish page see the swaps with
only `class,dir,lang,translate` and none of the original words. The unit test checks: no
`externally_connectable`, no `web_accessible_resources`, no `setUninstallURL`, no
`console.log`, and no `console.*` call mentioning a key or token.

**A finding, fixed here.** Content scripts couldn't read the secrets, but could send them
anywhere: the server address, the lookup service and its `baseUrl` live in
`storage.local`, which content scripts can write, and the background sent the token, the
key and the learner's typed words to whatever was there. The lead's review also found
that binding the key to "where the settings point when it's saved" let a planted, hidden
`baseUrl` (no field is shown for hosted services) capture a key pasted afterwards.

The fix binds the destination, not the secret:

- **Trusted values.** The background keeps the trusted destinations in IndexedDB `meta`:
  - `route:server`;
  - `route:lookup:<provider>`, the address for each service;
  - `route:lookupProvider`, the service chosen.
- **Who sets them.** Only Kotiko's pages: `server.connect` with a `url`; `backend.set` with
  a provider or `baseUrl` (a provider without an address means the preset's own); the
  OpenRouter sign-in; `toLocal`'s forget.
- **At upgrade.** Once, during the upgrade: a fresh install trusts only built-in addresses;
  an older install trusts what its settings hold then. Until a page names one, a route
  trusts its built-in address (each preset's own, `http://localhost:4747`).
- **Checking.**
  - Every server request (`connection()`) and every client request (lookups, respell,
    Test, model lists, quota; through the client's new `allow` hook) checks its address
    and service first. A mismatch sends nothing and fails with `address_changed`
    (`error_address_changed`; add jobs wait for it like `lookup_not_set_up`).
  - Secrets are released only for an allowed address (`secretFor`).
  - Writes to `server`/`lookup` from elsewhere are put back (`healRoutes`, also run on any
    refusal).
  - Route changes and the repair run one at a time (`underRoutes`), so the repair never
    writes a stale copy over a page's change.
- **Legacy keys.** 0.2 `token`/`serverUrl` keys are adopted only by the one-time storage
  upgrade. Later writes are removed unused (`dropLegacy`; `connection()` no longer reads
  them). Anything the upgrade adopts on a brand-new install, where nothing older can
  exist, is dropped (`discardPlanted`): token, address and seeded words.
- **Tests updated.** Tests that set the token or address through `storage.local` now go
  through `server.connect`: `background.test.mjs`, `local-mode.test.mjs`, and the
  popover, casing and visual setups via `connectServer` in `test/e2e/fixtures.mjs`. The
  fixture server's log now records the `Host` header.
- **Proof.** `test/bg/privacy.test.mjs` (9 tests) and the e2e cases fail on the previous
  code.

**Still open.** Content scripts can still write the other settings in `storage.local`:
turn Kotiko off, pause sites, edit the cached page list, or add an entry to `addJobs`,
which the queue would look up with the learner's own service and save. None sends
anything to a new destination; fixing them means moving those settings and the queue
out of `storage.local` (slices 11 and 24's design). An install updating from a version
before this one trusts its settings' addresses once, at that moment.

**§8 Listing and assets.** `store/listing/en.json` (description opening with slice 05's
short listing line, five captions, promo text); `store/assets.md` (sizes, what exists,
what waits for the artist); `test/visual/store-screenshots.mjs` makes the five 1280x800
captioned screenshots from the real extension on `test/fixtures/pages/store-article.html`
(an original text, so no attribution or third-party logos), checking caption contrast
(15.7:1). Screenshots aren't committed: they wait for the final artwork.

**Not built.**

- §6 beyond what existed: the popup already shows a blocking banner with "Allow" when
  `<all_urls>` is missing, and the welcome page a step 0. Not built: the per-site check
  (Chrome's "on click"), "Allow only here", injecting when access arrives, the badge on
  `permissions.onRemoved`, and the provider-origin check before a lookup.
- §9: the publisher accounts, two-step sign-in and the trader declaration are the
  maintainer's; the docs site (44) must serve `https://kotiko.org/privacy/` before the
  first submission.
- The policy describes slice 12's export and "Delete everything", built in parallel; it
  must merge before release, or the policy's "Keeping and deleting" section changes.
- Firefox runs: the CSP case on a non-loopback `http://` server and the AMO validator
  upload are manual (the e2e runs Chromium only). `web-ext lint` shows one warning,
  `BACKGROUND_SERVICE_WORKER_IGNORED`, which slice 30's Firefox build can clear.
- Artwork (05) and uploads (30).

## Acceptance criteria

- [ ] The privacy policy exists at both locations, matches `inventory.md` row by row, and
      a maintainer has checked each row against the code.
- [ ] `web-ext lint` passes with no manifest warnings; the AMO validator accepts an
      upload of the CI artifact.
- [ ] The CWS dashboard's privacy tab, permission justifications and single purpose are
      filled with the texts above (checked by the maintainer before the first submission).
- [ ] In Firefox, an `http://` non-loopback server (mock in CI on a non-loopback
      interface) is reachable from the background; without the explicit CSP it is not.
- [ ] With site access revoked in Firefox and set to "on click" in Chrome, the popup shows
      the access card, and one click restores swapping on the current tab without a reload.
- [ ] Section 7's audit passes in Chromium and Firefox.
- [ ] Both publisher accounts exist under ScriptKittyOS, show `hello@scriptkittyos.com`
      as the contact, have at least two maintainers with two-step sign-in, and the trader
      declaration is filled in.
- [ ] The listing assets exist at the listed sizes in `brand/store/` and pass slice 27's
      contrast check for caption text.
- [ ] The listing (name, short and long description, screenshots with captions) and the
      privacy policy exist in English and Spanish; a native Spanish speaker has reviewed the
      Spanish texts (50's release sign-off).
- [ ] No listing, policy or single-purpose text says Kotiko swaps English words or assumes
      the reader reads English (checked by grep for "English" in `store/listing/` and
      `docs/privacy/`, with an allow-list for the language's own name in lists).
- [ ] Viewing the CWS and AMO listings with the browser set to Spanish shows the Spanish
      name, summary and screenshots.

## Test plan

- **Unit**: the message handler that answers the access check; the http warning logic
  (loopback, `localhost`, `::1`, Tailscale `100.64.0.0/10`, LAN, public).
- **End-to-end** (slice 02): section 7's audit; the access card flow with permissions
  removed via the browser's test APIs; the CSP case in Firefox.
- **CI**: `web-ext lint`; character limits for each locale's name and summary; every key
  in `store/listing/en.json` exists in `es.json`; a JSON check that the manifest's permission list matches the
  justification table in this spec (a small script reading both, so a new permission
  can't ship without a justification).
- **Manual, before first submission**: a native Spanish speaker reads the Spanish listing,
  screenshots and policy; read the policy against a fresh install's network
  log (only the provider, after a key is set; nothing on an install that only has words
  typed as “word = meaning”).

## Rollout and migration

- The explicit CSP and `data_collection_permissions` ship in the first store build.
  Existing unpacked installs are unaffected.
- The privacy policy's first version is published with the docs site (slice 44) before
  the store submission; the bundled copy ships in the same release.
- After slice 04 changes the Gecko id, sideloaded Firefox installs become a different
  add-on; the changelog says to export first (slice 12) and import into the store build.

## Open questions

1. **Is ScriptKittyOS a trading business?** Only matters for the trader declaration in
   section 9. Recommendation: non-trader, unless the org sells other products, in which
   case confirm before submitting.
2. **AMO data categories.** Is user-typed text sent to a self-chosen provider
   "collection"? Recommendation: `required: ["none"]`, `optional: ["websiteContent"]` as
   specified, and ask AMO reviewers in the first submission's notes; switch to declaring
   it if they disagree.
3. **"Only on sites I enable" mode** with `optional_host_permissions` ([03 open question 8](../../docs/research/03-browser-extension.md)).
   It softens the install warning but adds a step per site. Recommendation: not at launch;
   revisit if install conversion is poor.

## Future work

- Listings and policy in more languages as community translations reach 100% in Weblate
  (slice 50).
- Safari App Store privacy label (slice 51).
- A short "privacy at a glance" panel inside the welcome page, generated from
  `inventory.md`.
