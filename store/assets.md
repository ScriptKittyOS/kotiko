# Store artwork and screenshots

What each store needs, what exists, and what waits for the artist. Sizes are from the
stores' own pages, checked 2026-10-05:
[Chrome Web Store images](https://developer.chrome.com/docs/webstore/images),
[AMO listing guide](https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/).
The full artwork list (Edge, social previews, favicons) is in
[slice 05 §6](../slices/05-brand-identity/SPEC.md); this file covers the store listings.

| Asset | Chrome Web Store | Firefox Add-ons | Exists now | Final from |
|---|---|---|---|---|
| Icon | 128x128 PNG: 96x96 artwork with 16 px of transparent padding per side | From the package (`icons` in the manifest); shown at 32 and 64 px | `brand/logo/store-icon-128.png` (placeholder kitten, correct padding) and `extension/icon128.png` | The artist (slice 05) |
| Screenshots | 1280x800 (or 640x400), PNG, square corners, full bleed; at least 1, up to 5 | Same files (1280x800, 1.6:1); no fixed limit | **Done (2026-10-06):** `brand/store/screenshots/en/01-page.png` … `05-dark.png`, 1280x800 24-bit PNGs from the script below, each looked at | This script again after the artwork lands |
| Small promo tile | 440x280, **required** | n/a | No | **Done (2026-10-06):** `brand/store/promo-small.png`, exported from `brand/illustrations/store-promo-tile.png` (the kitten on the moon with "Kotiko"; checked legible at half size) |
| Marquee promo tile | 1400x560, optional | n/a | No | **Done (2026-10-06):** `brand/store/promo-marquee.png`, exported from `brand/illustrations/marquee.png` (every word checked for spelling) |

Text on the promo tiles comes from `promo_small` and `promo_marquee` in
[`listing/en.json`](listing/en.json). No mascot name on any store artwork or text
(DECISIONS 2026-10-01). Finished files go in `brand/store/`:
`promo-small.png`, `promo-marquee.png`, `screenshots/<locale>/01-page.png` … `05-dark.png`.

## Screenshots

`node test/visual/store-screenshots.mjs [outDir] [locale]` makes all five from the real
extension in Chromium, with the browser in that locale, and writes the captioned 1280x800
files to `<outDir>/<locale>/` (bare captures in `raw/`). The captions are the `screenshots`
entries of `store/listing/<locale>.json`, set in the design system's display face on the
canvas color; the script stops if the caption's contrast is under 4.5:1 (it is 15.7:1 with
today's tokens). The page is `test/fixtures/pages/store-article.html`, a text written for
it, so no third-party content or logo appears and no attribution is needed; the script
serves it at `https://www.example.com/articles/…` (a reserved example address, answered by
the browser's route, never the internet) so the popup's page line names a website. The run
takes about a minute: the dashboard shot waits for the background to finish the
pronunciation of the word the popup shot adds.

| # | id | Shows | Caption (en) |
|---|---|---|---|
| 1 | `page` | An article in the reader's language with Spanish, Japanese and Russian swaps, one word's card open | Your words, right in the pages you read |
| 2 | `popup` | The popup just after adding "gato = cat" | Add any word, in your own words |
| 3 | `dashboard` | The word list with its languages | Every word you chose, in one place |
| 4 | `welcome` | The welcome page, asking for the next word | Start with the word you want most |
| 5 | `dark` | The same article in dark mode with a card open | Easy on the eyes, day and night |

Before uploading, look at each file. The popup is opened in a tab of its own, so the script
first opens the article and answers the popup's "which tab is active" question with that
real tab: "This page" then describes the article (it stops if the popup says it's on a
browser page). The welcome shot shows OpenRouter connected, as most learners will see it.
The article shots use placeholder words chosen for an English reader. A listing in another language gets its own
words and article in the script when its translation lands, and the browser in that
locale.

Regenerate the set whenever the interface changes, and before each release that changes
what the listing shows.

## Blocked

- **Artwork** (final icon, both promo tiles): waits for the artist (slice 05). Nothing
  here is drawn by hand in the meantime.
- **Uploading** anything: waits for the ScriptKittyOS publisher accounts (spec §9), which
  the maintainer creates, and for slice 30's upload step.
