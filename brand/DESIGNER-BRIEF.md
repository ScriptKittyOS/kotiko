# Kotiko: brief for the logo and brand artwork

Thank you for working on Kotiko. This brief says what Kotiko is, the story behind the name
and the mascot, the colors already in use, and exactly which files we need. The artwork in
`brand/` is attached for reference.

## 1. What Kotiko is

Kotiko is a free, open-source browser extension for Chrome and Firefox from ScriptKittyOS.
It helps people learn words in other languages while they read the web as usual.

You add a word you're learning, in any language. From then on, Kotiko quietly swaps that
word into the pages you already read: a Spanish learner reading an English news site sees
*perro* where the page says "dog"; a Spanish speaker learning Japanese sees 犬 on Spanish
pages. Hover a swapped word and a small card shows what it means and how it's said.

- **For:** anyone learning words in any language, from any language. Kotiko never assumes
  the reader speaks English; it works for readers of Spanish, Japanese, Arabic and so on.
- **How it feels:** calm and private. No streaks, no points, no ads, no account. Your words
  stay in your browser.
- **Promise (the tagline):** **Read the web in the words you're learning.**

## 2. The story: the name and the mascot

**Kotiko.** In Russian, котик (kotik) means "kitty". Kotiko is that word, slightly bent,
the way a learner bends a word they're still getting to know. That's fitting, because
Kotiko is for learners.

**Mira, the mascot,** is a small black kitten with orange eyes.

Cats have a trick we haven't learned. Ask a cat in Moscow and it says мяу. In Beijing, 喵.
In Madrid, miau. In Tokyo, nyā. In Seoul, yaong. Every language writes it down differently,
and every one of those people knows exactly what the cat wants. People are harder: we split
ourselves into languages and stand on either side of the line. Kotiko takes the words you've
learned and slips them into the pages you already read, one word at a time, until that line
starts to blur.

Mira's name is a clue, if you speak a few languages. In Spanish, *mira* means "look". In
Latin, "wonderful". In Russian, мира means "of the world", and also "of peace".
**Look. The world is wonderful. It's just been waiting for us to understand each other.**

## 3. Personality

| Kotiko is | Kotiko is not |
|---|---|
| Calm, like a good reading lamp | Gamified, loud, streak-driven |
| Warm, a little playful | Childish or cartoonish |
| Precise about language | Academic or fussy |
| Generous: free, open, works offline | Salesy: "upgrade", "pro", "premium" |
| Quietly delightful at rare moments | Celebratory on every click |

Mira is a face, not a narrator: she never talks, so no speech bubbles. She should read as
**cute and lucky, never spooky**. Black cats carry a bad-luck superstition in parts of Europe
and the Americas, so keep her round, soft and friendly.

## 4. What already exists (attached, for reference)

| File | What it is |
|---|---|
| `logo/kotiko-logo.png` | **The logo concept:** Mira peeking over the word "Kotiko" with her paws on the letters. The direction for the logo, to be redrawn as a clean vector. |
| `illustrations/hero-words-moon.png` | Mira peeking over a purple moon, greetings in six languages around her. |
| `logo/icon-*.png` | The current app icon: Mira's face on a purple rounded tile. A placeholder until your logo. |
| `illustrations/kitten-*.png` | Four small moods (curious, happy, sleepy, oops) used in the interface. |

**What's missing:** the final **Kotiko** logo. The concept above shows the idea; everything with the product name needs your finished vector artwork.

## 5. What we need from you

**One logo, not two.** Mira is the face of Kotiko, not a separate brand. The logo is
**Mira's face with the word "Kotiko"**. The concept is
`logo/kotiko-logo.png`: Mira peeking over the word, her paws resting on the letters, in
rounded, friendly lettering. Please refine it into the final vector logo.


**Formats:** a master **SVG** for every mark (flat vector, text converted to outlines, no
embedded fonts), plus PNG exports. Please send the source files too (AI, Figma or similar).

| # | Deliverable | Notes |
|---|---|---|
| 1 | **The Kotiko mark**: Mira's face on the purple tile | Square master SVG on a 128-unit grid. This is the browser-toolbar and store icon. |
| 2 | **Hand-drawn 16 px and 32 px versions** of the mark | Redrawn for tiny sizes, not just scaled down: simpler shapes, features snapped to whole pixels. The toolbar shows it at 16 px. |
| 3 | **The Kotiko wordmark** | "Kotiko" in a rounded, friendly humanist sans, capital K. A sibling of the "Mira" lettering, but calm enough to be a product name. |
| 4 | **Lock-up**: the mark (without tile) to the left of the wordmark | Cap height about 40 % of the mark's height. A horizontal version, and a stacked one if it suits. |
| 5 | **One-color versions** of the mark and lock-up | A single flat ink, no tile, for print, favicons and high-contrast modes. |
| 6 | **Mark without the tile**, for light and for dark backgrounds | Mira is near-black, so she needs a thin light rim to stay visible on dark backgrounds. |
| 7 | **Store and social artwork** | Chrome small promo tile **440 × 280** (required); marquee **1400 × 560**; GitHub social preview **1280 × 640**; social card **1200 × 630**; Edge logo **300 × 300**. Mark plus "Kotiko" on the brand purple; full bleed. Versions of the first four exist (`illustrations/store-promo-tile.png`, `marquee.png`, `social-previews-*.png`), to redo with the final logo. |
| 8 | **Full-resolution illustrations** (nice to have) | The hero and the four kitten moods as vectors, if you can redraw them in the final style. |

## 6. Colors

### The brand

| Name | Hex | Use |
|---|---|---|
| **Kotiko purple** (tile, `--brand`) | **`#8E5EFA`** | The icon tile and promo backgrounds. Keep it exact: the interface derives its shades from it. |
| Mira's fur | `#120A1A` (near-black plum) | The kitten. Never pure black; a touch of purple keeps her warm. |
| Mira's outline and the "Mira" letters | `#9B6BF9` | The lavender rim around Mira and the letter fill. |
| Letter outline (in the Mira lock-up) | `#4B1293` | Deep violet. |
| Inner ears, nose | `#C47CF2` | Orchid. |
| Eyes | `#F87A32` to `#F9A232` | Orange to amber, with white highlights. Mira's warmth. |

### The interface (for context: how the product around the logo looks)

| Token | Light | Dark | Use |
|---|---|---|---|
| Canvas | `#FAF6F0` (warm paper) | `#14121C` | Page background |
| Surface | `#FFFFFF` | `#1C1928` | Cards and panels |
| Ink | `#1F1A2B` | `#F2EEF8` | Main text. Use for the wordmark's letters on light and dark. |
| Ink, secondary | `#544C63` | `#C4BCD4` | Secondary text |
| Purple text | `#7A46E1` | `#A08AEB` | Links, focus rings, purple text |
| Purple soft | `#EFECFE` | `#2B2148` | Purple backgrounds |
| Burnt orange | `#B4501A` | `#F08A4B` | Accent (echoes Mira's eyes) |
| Blue | `#1F5FC0` | `#8DBBFF` | Information |

**Contrast rules we must keep** (checked automatically before we adopt the artwork):
- The tile purple stays between **`#8A63EA` and `#9370F0`**. Darker purples make the
  near-black kitten disappear on the tile.
- Mira on the tile: at least **3:1** contrast, aiming for 4:1 (today 4.7:1).
- The tile against browser toolbars: at least **3:1** on white and on near-black `#202124`.
  Toolbar colors to test on: `#FFFFFF`, `#DEE1E6`, `#202124`, `#35363A`, `#2B2A33`.
- It must still read in **grayscale**.

## 7. Rules for the mark

**Please do:**
- Keep it flat: at most **4 colors** plus the background, no gradients, glows or thin lines.
- Make it readable at **16 px** on every toolbar color, at normal and high-density scale.
- Leave room in the lower right: browsers draw a small badge there ("42%", "off").
- Keep clear space of one eighth of the tile width on every side.
- Make it work without the tile and in one color.

**Please avoid:**
- An eye as the main symbol (it suggests surveillance, for an extension that reads pages).
- Speech bubbles or chat shapes; four-point sparkles or "AI" glints (the current eye
  highlights are fine at large sizes, but drop them in the small icons).
- Flags, or a letter from a single alphabet as the mark: Kotiko is for every language.
- Text inside the icon, fangs or claws, seasonal costumes, or anything spooky.
- Anything close to existing language-learning or browser-extension logos.

## 8. Words used with the logo

If artwork includes text (promo tiles, social cards), use the tagline **"Read the web in the
words you're learning."** Sentence case, no exclamation marks, no "AI" wording.

## 9. Ownership

The Kotiko name, logo and artwork belong to ScriptKittyOS and are used as its trademark (they
aren't covered by the code's open-source license). Please confirm in your agreement that the
delivered artwork and source files are assigned to ScriptKittyOS.
