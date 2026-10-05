# Firefox Add-ons (AMO) submission

What Kotiko declares to Firefox and types into addons.mozilla.org, from
[slice 28](../slices/28-privacy-and-store-readiness/SPEC.md) §4. Data statements come
from [`docs/privacy/inventory.md`](../docs/privacy/inventory.md).

Primary sources (checked 2026-10-05):
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
    "data_collection_permissions": { "required": ["none"] }
  },
  "gecko_android": { "strict_min_version": "142.0" }
}
```

- **`data_collection_permissions`** is required for every new add-on since 3 November
  2025, and Firefox reads it from version 140 on desktop (142 on Android). 140 is an ESR,
  so ESR users are covered; that is why `strict_min_version` is 140.
- **`required: ["none"]`.** Out of the box Kotiko transmits nothing: a word typed with its
  meaning ("hola = hello") never leaves the browser except, for languages with word stress,
  the word alone to Wiktionary for its pronunciation. What a learner chooses to send
  afterwards is their own input to a service they set up with their own key: the text they
  type to add a word goes to that AI service. Mozilla's categories (personally identifying,
  health, financial, authentication, personal communications, location, browsing
  activity, website content, website activity, search terms, bookmarks, technical and
  interaction) describe data about the user and their browsing; text the user types to
  look up is none of them, and page content never leaves the browser. Confidence: medium.
  The first submission asks the reviewer in its notes (below); if AMO disagrees, the
  declaration changes in the same release as the policy.
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
> Data collection: we declared `required: ["none"]`. Page content never leaves the
> browser. When a learner sets up an AI service with their own key, the text they type into
> Kotiko's add box is sent to that service to look the word up; for languages with word
> stress, the word alone is sent to en.wiktionary.org for its pronunciation. We read
> neither as one of the data categories, since both are the learner's own input to the
> feature, but we'd like your view: if you consider either one `websiteContent` or another
> category, we'll declare it.
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
