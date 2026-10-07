# Firefox Add-ons (AMO) submission

What Kotiko declares to Firefox and types into addons.mozilla.org, from
[slice 28](../slices/28-privacy-and-store-readiness/SPEC.md) §4. Data statements come
from [`docs/privacy/inventory.md`](../docs/privacy/inventory.md).

Primary sources (checked 2026-10-05; the data declaration again 2026-10-06):
[Add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/),
[Firefox built-in data collection consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/),
[MDN `browser_specific_settings`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings),
[MDN extension content security policy](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_Security_Policy),
[Creating an appealing listing](https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/).

## The manifest

```json
"content_security_policy": { "extension_pages": "script-src 'self'; object-src 'self'" },
"browser_specific_settings": {
  "gecko": {
    "id": "kotiko@scriptkittyos.com",
    "strict_min_version": "140.0",
    "data_collection_permissions": { "required": ["authenticationInfo"] }
  },
  "gecko_android": { "strict_min_version": "142.0" }
}
```

- **`data_collection_permissions`** is required for every new add-on since 3 November
  2025, and Firefox reads it from version 140 on desktop (142 on Android). 140 is an ESR,
  so ESR users are covered; that is why `strict_min_version` is 140.
- **`required: ["authenticationInfo"]`** (security review C-11, 2026-10-06). The
  learner's own API key for the AI service they chose, and the access token of their own
  Kotiko server, leave the browser: each is sent in the `Authorization` header to the
  service it belongs to. Mozilla counts that. Its policy defines data transmission as "any
  data collected, used, transferred, shared, or handled outside the add-on or the local
  browser" ([Add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/)
  §6), with no exception for a service the user chose, and its `authenticationInfo`
  category is "passwords, usernames, personal identification numbers (PINs), security
  questions, and registration information" ([built-in consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)).
  A key is a credential, so `none` would misstate it. This matches the Chrome form's
  "Authentication information: Yes" ([chrome-web-store.md](chrome-web-store.md#data-usage);
  `store-readiness.test.mjs` checks the two agree). Nothing goes to ScriptKittyOS.
  - **Required, not optional, for now.** An optional permission is granted only when the
    extension asks with `browser.permissions.request({ data_collection: ["authenticationInfo"] })`
    in a click handler; until Kotiko asks when a key is first saved, "Connect OpenRouter"
    is pressed or a server is paired (and keeps the key on the device if the learner
    says no), declaring it optional would claim a consent Kotiko never collects. Moving to
    `optional` with that request is the better fit, since lookups without a key work.
  - **Everything else stays undeclared.** A word typed with its meaning ("hola = hello")
    never leaves the browser except, for languages with word stress, the word alone to
    Wiktionary for its pronunciation; with an AI service set up, the text typed into
    Kotiko's add box goes to that service. Text the learner types into Kotiko to look up
    is none of Mozilla's other categories (the nearest, `searchTerms`, is "search terms
    entered into search engines or the browser"), and page content never leaves the
    browser. Confidence: medium. The first submission asks the reviewer in its notes
    (below); if AMO disagrees, the declaration changes in the same release as the policy.
- **No `optional` list yet.** Slice 33's "Learn this in…" would send text selected on a
  page, which is `websiteContent`; it adds `"optional": ["websiteContent"]` and asks with
  `browser.permissions.request({ data_collection: ["websiteContent"] })` the first time the
  learner uses it with a remote service. Declaring it before anything uses it would ask
  learners for a consent nothing needs.
- **`gecko_android` at 142**, the first Firefox for Android that reads the declaration.
  Without the key, `strict_min_version` would apply to Android too, and `web-ext lint`
  warns that Android 140 can't read `data_collection_permissions`. With it, the package
  declares Android support (MDN). Kotiko hasn't been checked on Firefox for Android yet
  (slice 45), so until it is, leave Firefox for Android unticked in the upload's
  compatibility step (confirm the step's current wording at the first upload).
- **The content security policy** is Chrome's Manifest V3 default, written out. Firefox's
  own default for Manifest V3 adds `upgrade-insecure-requests`, which turns
  `http://` requests into `https://` ones and would break a Kotiko server on a home
  network or a Tailscale address (`http://100.x.y.z:4747`). Kotiko's pages load nothing
  remote, so nothing else changes. The settings warn under the server address when a
  plain `http://` address leaves this computer and isn't a Tailscale one.

`web-ext lint` must show no manifest warning except `BACKGROUND_SERVICE_WORKER_IGNORED`:
the one package carries Chrome's `service_worker` beside Firefox's `scripts`. Slice 30's
Firefox build can drop `service_worker` from its copy of the manifest to clear it.

## Listing

| Field | Value |
|---|---|
| Name | From the package: `extStoreName` (AMO allows 50 characters) |
| Summary | From the package: `extDescription` (AMO allows 250) |
| Description | `description` in [`listing/en.json`](listing/en.json) |
| Categories | Language Support; Education |
| Support email | `hello@scriptkittyos.com` |
| Support site | `https://kotiko.org/` |
| Homepage | `https://kotiko.org/` |
| Privacy policy | The text of `docs/privacy/en.md` (AMO hosts it) |
| License | Apache License 2.0 |
| Icon | From the package (`icon128.png`; AMO shows 32 and 64 px) |
| Screenshots | The same 1280x800 files as the Chrome Web Store |
| Author | The ScriptKittyOS account only; maintainers listed as not shown (spec §9) |

## Source code

AMO asks for sources when a package contains minified, concatenated or generated code.
Kotiko has no build step: every file in `extension/` is the source. Two files are
generated from data in the repository and say so in their first lines:
`extension/spec/spec.js` (from `spec/`, by `spec/tools/sync-extension.mjs`) and
`extension/ui/popover-style.js` (its token block, from `extension/ui/tokens.css` and `base.css`, by `extension/ui/tools/popover-tokens.mjs`). Point the
reviewer to the public repository and to those scripts in the notes; if they ask, attach
a zip of the repository at the release tag (slice 30).

## Notes for the reviewer

> No account or key needed to test: on the welcome page that opens after install, type a
> word with its meaning in your browser's language (for example "hola = hello"), press
> "Make it my first word", then "Try it on a page".
>
> Data collection: we declared `required: ["authenticationInfo"]`: a learner who sets up
> an AI service or their own Kotiko server gives Kotiko that service's key, which is sent
> only to that service (never to us). Page content never leaves the browser. With an AI
> service set up, the text the learner types into Kotiko's add box is sent to that service
> to look the word up; for languages with word stress, the word alone is sent to
> en.wiktionary.org for its pronunciation. We read neither as one of the data categories,
> since both are the learner's own input to the feature, but we'd like your view: if you
> consider either one `searchTerms`, `websiteContent` or another category, we'll declare
> it.
>
> `extension/spec/spec.js` is generated from `spec/` in our public repository
> (https://github.com/ScriptKittyOS/kotiko) by `spec/tools/sync-extension.mjs`; nothing is
> minified.

## Before each submission

- [ ] `npm run lint`: no manifest warning but `BACKGROUND_SERVICE_WORKER_IGNORED`, or
      none on the Firefox build.
- [ ] The AMO validator accepts the uploaded zip (Developer Hub, "Submit a new version").
- [ ] `data_collection_permissions` still matches `docs/privacy/inventory.md`.
- [ ] In Firefox, a server on a LAN or Tailscale `http://` address still connects.
