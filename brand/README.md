# Mira brand assets

The Mira logo is a black kitten on brand purple `#8E5EFA`. The artwork is © ScriptKittyOS.
The logo and illustrations are not covered by the code's Apache-2.0 license: they are the
project's trademark, so forks need their own.

## Logo (`logo/`)

| File | Use |
|---|---|
| `icon-16.png`, `icon-32.png` | Browser toolbar. Tuned for small sizes: the kitten fills more of the tile so it stays readable. |
| `icon-48.png`, `icon-128.png` | Extensions page, install prompts, Firefox Add-ons. |
| `icon-512.png`, `icon-1024.png` | Docs, social, anywhere large. |
| `store-icon-128.png` | Chrome Web Store: 96 px artwork inside 16 px of transparent padding. |
| `cat-*.png` | The kitten alone on a transparent background (popup and dashboard headers). On dark surfaces its purple outline keeps it visible; at 16-32 px prefer the tiled icon. |

Generated from `source/mira-original.png` with the background specks removed. The tile
purple `#8E5EFA` is taken from the mockup. Contrast: kitten on tile 4.7:1, tile on white
4.1:1, on near-black `#202124` 3.9:1, on dark gray `#35363A` 2.95:1 (the kitten's outline
carries the edge there).

## Illustrations (`illustrations/`)

Cropped from the mockup (`source/mockup-sheet.png`) as **placeholders** until the artist's
full-resolution files arrive. They are small (about 150 px kittens, a 658 × 202 hero), so
show them at half size or less on high-density screens.

| File | Use |
|---|---|
| `hero-words-moon.png` | Mira on the moon with greetings in six languages: welcome tab, docs, onboarding. |
| `kitten-curious.png` | Empty states ("no words yet"). |
| `kitten-happy.png` | Celebrations and milestones. |
| `kitten-sleepy.png` | Paused, or swapping turned off. |
| `kitten-oops.png` | Gentle errors. |
| `kitten-*-on-purple.png` | The same four on their original purple card. Use these in dark mode, where the black kitten would disappear. |

The transparent kittens were lifted off the purple by color keying, which lightens the inner
ears slightly. The `-on-purple` versions keep the original look.

## Still needed from the artist

- Master vector (SVG) of the logo, and full-resolution illustrations.
- Store artwork at its real sizes: promo tile 440 × 280, marquee 1400 × 560, social
  previews 1280 × 640 and 1200 × 630. The mockup's versions are a different shape and too
  small to use.
- Hand-drawn 16 and 32 px icons, and one-color (black and white) versions.

The full brief is in the "Mira logo: artist brief" doc.
