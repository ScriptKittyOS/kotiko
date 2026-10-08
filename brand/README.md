# Kotiko brand assets

The Kotiko logo is Mira, our black kitten mascot, on brand purple `#8E5EFA`. Why the
names: see "Name and story" in `slices/05-brand-identity/SPEC.md`. The artwork is © ScriptKittyOS.
The name, logo and illustrations are not covered by the code's Apache-2.0 license: they are
the project's trademark (see `LICENSES/LicenseRef-KotikoBrand.txt`), so forks need their own.

New artwork with the Kotiko name is on its way. Until then, the files below are
placeholders without lettering.

## Logo (`logo/`)

| File | Use |
|---|---|
| `icon-16.png`, `icon-32.png` | Browser toolbar. Tuned for small sizes: the kitten fills more of the tile so it stays readable. |
| `icon-48.png`, `icon-128.png` | Extensions page, install prompts, Firefox Add-ons. |
| `icon-512.png`, `icon-1024.png` | Docs, social, anywhere large. |
| `store-icon-128.png` | Chrome Web Store: 96 px artwork inside 16 px of transparent padding. |
| `kotiko-logo.png` | **The Kotiko logo (concept):** Mira peeking over the word "Kotiko", paws on the letters, with a transparent background. Used at the top of the README. The designer refines it into the final vector logo (`DESIGNER-BRIEF.md`). |
| `cat-*.png` | The kitten alone on a transparent background (popup and dashboard headers). On dark surfaces its purple outline keeps it visible; at 16-32 px prefer the tiled icon. |

The tile purple `#8E5EFA` passes the contrast checks: kitten on tile 4.7:1, tile on white
4.1:1, on near-black `#202124` 3.9:1, on dark gray `#35363A` 2.95:1 (the kitten's outline
carries the edge there).

## Illustrations (`illustrations/`)

Placeholders until the artist's full-resolution files arrive. They are small (about 150 px
kittens, a 658 × 202 hero), so show them at half size or less on high-density screens.

| File | Use |
|---|---|
| `hero-words-moon.png` | The kitten on the moon with greetings in six languages: welcome tab, docs. |
| `kitten-curious.png` | Empty states ("no words yet"). |
| `kitten-happy.png` | Celebrations and milestones. |
| `kitten-sleepy.png` | Paused, or swapping turned off. |
| `kitten-oops.png` | Gentle errors. |
| `kitten-*-on-purple.png` | The same four on their purple card, for dark mode. |

## Store artwork (`store/`)

| File | Use |
|---|---|
| `promo-small.png` | Chrome Web Store small promo tile, exactly 440 × 280, exported from `illustrations/store-promo-tile.png` (the full-size master: Mira on the moon with "Kotiko"). Re-export from the master if it changes. |
| `promo-marquee.png` | Chrome Web Store marquee, exactly 1400 × 560, exported from `illustrations/marquee.png`. |

## Social (`social/`)

| File | Use |
|---|---|
| `github-social-preview.jpg` | GitHub's social preview, 1280 × 640, under GitHub's 1 MB limit (Settings, General, Social preview). From `illustrations/social-previews-1280-640.png`. |
| `social-card-1200x630.jpg` | The card other sites show for a shared link (Open Graph, 1200 × 630), from its own master `illustrations/social-previews-1280-630.png`. |

Every word in the store and social artwork was checked letter by letter on 2026-10-06
("Kotiko", Welcome, Willkommen, Hola, Ciao, 你好, ようこそ, مرحبا) in the promo tile, marquee and both social masters. The hero illustration's
مرحبا had two dots under its fourth letter (making it ي); it was corrected to one (ب).

## Demo (`demo/`)

| File | Use |
|---|---|
| `kotiko-film.webp` | The film's thumbnail on kotiko.org and in the README, linking to the one-minute launch film on YouTube (https://youtu.be/6hwIcTVvGK8). A frame of the film (the word card open) with a play button. |
| `kotiko-demo.gif` | The README demo: an article, then the same article with the reader's words swapped in, then a word's card. Made from the real extension by `node test/visual/readme-demo.mjs` (needs ImageMagick); run it again when the interface changes. |

## For the designer

`DESIGNER-BRIEF.md` is the brief for the Kotiko logo and store artwork: what Kotiko is, the
story, the palette, the rules and the deliverables.

## Still needed from the artist

- Master vector (SVG) of the logo, and full-resolution illustrations.
- Anything with the Kotiko name: wordmark, logo-plus-name lockup, store promo tile
  (440 × 280), marquee (1400 × 560), social previews (1280 × 640 and 1200 × 630).
- Hand-drawn 16 and 32 px icons, and one-color (black and white) versions.
