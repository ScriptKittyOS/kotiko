# Chrome Web Store submission

What to type into each field of the Chrome Web Store developer dashboard for Kotiko, from
[slice 28](../slices/28-privacy-and-store-readiness/SPEC.md) §3. Every data statement here
comes from [`docs/privacy/inventory.md`](../docs/privacy/inventory.md); change that first.
A maintainer checks each field against this file before the first submission and after
any change to the manifest.

Primary sources (checked 2026-10-05):
[Program policies](https://developer.chrome.com/docs/webstore/program-policies),
[Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use),
[User data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
[Privacy practices tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy),
[Images](https://developer.chrome.com/docs/webstore/images),
[Manifest `name`](https://developer.chrome.com/docs/extensions/reference/manifest/name).

## Store listing tab

| Field | Value |
|---|---|
| Name | From the package: `extStoreName` in `extension/_locales/<locale>/messages.json` ("Kotiko: learn languages while you browse"; 75 characters at most) |
| Summary | From the package: `extDescription` (132 characters at most) |
| Description | `description` in [`listing/en.json`](listing/en.json) |
| Category | Education |
| Language | English (other languages as translations reach 100 %; slice 50) |
| Store icon | `brand/logo/store-icon-128.png` (96 px artwork in 16 px of transparent padding; the artist's final replaces it, see [assets.md](assets.md)) |
| Screenshots | `brand/store/screenshots/en/01-page.png` … `05-dark.png`, 1280x800 |
| Small promo tile | `brand/store/promo-small.png`, 440x280 (required) |
| Marquee promo tile | `brand/store/promo-marquee.png`, 1400x560 (optional) |
| Official URL | `https://kotiko.org/` (after the domain is verified in Search Console) |
| Homepage URL | `https://kotiko.org/` |
| Support URL | `https://github.com/ScriptKittyOS/kotiko/issues` |
| Mature content | No |

## Privacy practices tab

### Single purpose

> Kotiko replaces words on the web pages you read, in your own language, with the words you
> are learning in other languages, so you pick up vocabulary while you browse.

### Permissions and justifications

`test/unit/store-readiness.test.mjs` fails when the manifest asks for a permission, a host
or a content-script match that has no row here, or when a row names one the manifest no
longer has. The first column is where it is in the manifest.

| Manifest | Name | Justification (paste into the dashboard) |
|---|---|---|
| permissions | `storage` | Keeps the learner's words, settings and pending word lookups in the browser, so swaps work offline and nothing needs an account. |
| permissions | `unlimitedStorage` | A vocabulary can grow to thousands of words with their meanings and pronunciations, plus a lookup cache; this keeps them from being evicted when the browser runs short of space. |
| permissions | `alarms` | Retries word lookups that are waiting (for example until a free model quota resets) and, for learners who run their own Kotiko server, checks it for new words once a minute. |
| permissions | `scripting` | Starts Kotiko in tabs that were already open when it was installed or updated, so the learner doesn't have to reload them. The files injected are the extension's own content scripts. |
| host_permissions | `<all_urls>` | Kotiko's single purpose is to swap words on any page the learner reads, and it can't know in advance which sites those are. Page text is processed in the browser and never transmitted. Host access also lets the background call the AI service or the self-hosted Kotiko server the learner configured, at whatever address they entered (including a local one). |
| content_scripts.matches | `<all_urls>` | The content script finds the learner's saved words in the page's text and shows the word they are learning in its place, with a card that explains it. It runs on every site because that is the feature; it skips editors, form fields, buttons and sites the learner paused. |
| content_scripts.matches | `https://kotiko.org/connect/*` | Kotiko's own website, the page OpenRouter returns to after the learner chooses "Connect OpenRouter". This small script reads the one-time sign-in code from that page's address and passes it to the extension, which exchanges it for the learner's OpenRouter key; it runs on no other page and sends the code nowhere else. No host access beyond `<all_urls>` above. |

There is no `tabs`, `activeTab`, `contextMenus`, `identity`, `webRequest` or `cookies`
permission, no `externally_connectable` and no `web_accessible_resources`. Slice 33 adds
`contextMenus` with its own row when "Learn this in…" ships.

### Remote code

**No, I am not using remote code.** All JavaScript is in the package. Words, the model
list and pronunciation pages are data, checked against Kotiko's word spec before use;
nothing fetched is evaluated or injected as code. The extension pages' content security
policy is `script-src 'self'; object-src 'self'`.

### Data usage

What Kotiko handles, in the dashboard's categories ("handle" includes data processed only
on the device, per the User Data FAQ):

| Category | Tick? | Why (for the reviewer) |
|---|---|---|
| Personally identifiable information | No | Kotiko asks for no name, email or account. |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | **Yes** | The learner's own API key for the AI service they chose, and the access key of their own Kotiko server. Stored in the extension's IndexedDB, where web pages and content scripts can't read them, and sent only to the service each belongs to. |
| Personal communications | No | |
| Location | No | |
| Web history | No | Kotiko doesn't record the pages you visit. It checks the current page's address in the browser to honour sites the learner paused; it stores only the host names the learner chose to pause, and sends none. |
| User activity | No | No clicks, scrolling or keystrokes are recorded. Text the learner types into Kotiko's own add box is sent to their AI service to look the word up (see the privacy policy). |
| Website content | **Yes** | Page text is read inside the browser to find words to swap. It is never stored or transmitted. |

### Certifications (all three are true)

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single
  purpose.
- I do not use or transfer user data to determine creditworthiness or for lending
  purposes.

The one transfer is the learner's own choice: the text they type to add a word goes to the
AI service they configured with their own key, which is the single purpose's lookup, and
the word alone goes to Wiktionary for its pronunciation. Both are named in the policy.

### Privacy policy URL

`https://kotiko.org/privacy/` (slice 44 publishes `docs/privacy/en.md` there). Until the
docs site is live, the policy can't be linked from the listing, so the first submission
waits for it.

## Distribution tab

- Visibility: Public. Regions: all.
- **Trader status (EU Digital Services Act): non-trader**, if ScriptKittyOS doesn't sell
  products or services (open question 1 in the spec; the maintainer confirms before
  submitting).

## Notes for the reviewer

> No account or key needed to test. On the welcome page that opens after install, type a
> word with its meaning in the language your browser uses, for example "hola = hello" in an
> English browser or "dog = perro" in a Spanish one, press "Make it my first word", then
> "Try it on a page", which opens a Wikipedia search in that language with the word swapped.
> Kotiko needs access to all sites because it swaps words on whatever page you read; page
> text never leaves the browser. Lookups with an AI service use the learner's own key,
> entered on the extension's settings page.

Expect an in-depth review because of `<all_urls>`; it usually takes several days.

## Before each submission

- [ ] `docs/privacy/inventory.md` matches the code (`node --test test/unit/store-readiness.test.mjs`).
- [ ] The permissions table above matches the manifest (same test).
- [ ] The policy's version and date changed if what Kotiko keeps or sends changed.
- [ ] `https://kotiko.org/privacy/` serves the same text as `docs/privacy/en.md`.
- [ ] Screenshots regenerated if the interface changed (`node test/visual/store-screenshots.mjs`).
- [ ] The publisher is the ScriptKittyOS group publisher, contact `hello@scriptkittyos.com`
      (spec §9; the maintainer's to set up).
