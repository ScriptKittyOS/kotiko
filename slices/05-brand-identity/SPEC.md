# 05 · Brand identity

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week once the final artwork arrives, plus the maintainer's review) |
| **Depends on** | None (the logo itself is pending from the maintainer) |
| **Unblocks** | [06-design-system](../06-design-system/SPEC.md) (final brand purple), [22-first-run-onboarding](../22-first-run-onboarding/SPEC.md), [28-privacy-and-store-readiness](../28-privacy-and-store-readiness/SPEC.md) (listing artwork), [30-release-pipeline](../30-release-pipeline/SPEC.md), [44-docs-site](../44-docs-site/SPEC.md) |
| **Sources** | [DECISIONS: name, logo, design bar, store publisher](../DECISIONS.md); [04 §1 name collision](../../docs/research/04-architecture-release.md); [05 S5, S34](../../docs/research/05-learner-ux.md); [03 E6 store review](../../docs/research/03-browser-extension.md) |

## Problem

The product is now Kotiko, and nothing a user sees says so or says what Kotiko is:

- The popup heading is "Слово" in Georgia (`extension/popup.html:43-47, 109`); the tab title,
  toolbar tooltip and manifest name say "Slovo" (`popup.html:5`,
  `extension/manifest.json:3, 20`). The renaming mechanics are
  [04](../04-rename-to-kotiko/SPEC.md); this slice decides how Kotiko looks and sounds.
- The 0.2 manifest declared only 48 and 128 px icons (`manifest.json:21`), so browsers
  downsample for the 16 and 32 px toolbar, where most people see the icon.
- **The final logo artwork is pending from the maintainer.** The current direction is a cute
  black kitten head on a purple tile ([DECISIONS](../DECISIONS.md)), which ties Kotiko to the
  ScriptKittyOS family; an eye and a speech bubble were rejected earlier, and earlier
  explorations are superseded. Whatever artwork arrives has to work from 16 px on light
  and dark toolbars up to store banners, in one color, and without its tile, and nothing
  checks that today.
- There is no voice. Copy ranges from friendly (`popup.js:62`) to raw internals ("The server
  answered 500.", `background.js:24`). [25](../25-plain-language-errors/SPEC.md) fixes the
  messages; this slice sets the voice they are written in.

## Goals

- A brand foundation: the name story, the promise, personality, and a voice and tone guide
  that every UI string in slices 13-37 follows.
- Written requirements the maintainer's final artwork must meet, so it can be checked the day
  it arrives.
- A defined set of forms derived from that artwork (small-size drawings, one-color, tile-less
  glyph, wordmark and lock-up) and a complete asset set for the manifest, Chrome, Firefox,
  Edge, GitHub and the docs site, generated from SVG sources.
- Do's and don'ts for using the mark.
- A short, repeatable process for adopting the artwork, including handing its brand color to
  [06](../06-design-system/SPEC.md).

## Non-goals

- Drawing the logo. The maintainer supplies the final artwork; this slice specifies what it
  must satisfy and everything derived from it.
- Color tokens, type and components: [06](../06-design-system/SPEC.md), which takes the
  logo's tile color as its one brand input and regenerates its purple ramp from it.
- Changing names in code: [04](../04-rename-to-kotiko/SPEC.md).
- Listing text, privacy policy and screenshot content:
  [28](../28-privacy-and-store-readiness/SPEC.md). This slice supplies artwork and frames.
- Translating the UI: [50](../50-ui-localization-and-base-language/SPEC.md).

## User stories

- As someone browsing a store, I want an icon that feels friendly and personal, and a name
  and tagline that tell me this is about reading in the languages I'm learning.
- As a daily user with twenty extensions, I want to spot Kotiko in my toolbar at a glance in
  light and dark themes.
- As a learner anywhere, I want the brand to feel warm and welcoming rather than corporate or
  "AI".
- As a contributor writing a new message, I want a short voice guide with examples.

## Specification

### 1. Name and story

The product is **Kotiko**. Its mascot, the black kitten, is named **Mira**
([DECISIONS](../DECISIONS.md)). The story below is the maintainer's and is used as written;
it reads as a cute origin story first, with a second layer for anyone who knows the
languages.

**Single source.** This section is the only copy of the story. The three places that show
the full version, the docs site and website ([44](../44-docs-site/SPEC.md)) and the welcome
tab's About ([22](../22-first-run-onboarding/SPEC.md); Dashboard → Settings → About), render
it from one shared file generated from here (`docs/story/<locale>.md`, also copied into the
extension's locale files) and never keep their own copy, so an edit lands in all of them.

**Why Kotiko?** (docs site, website, welcome tab About)

> In Russian, котик (kotik) means "kitty." Kotiko is that word, slightly bent, the way a
> learner bends a word they're still getting to know. That's fitting, because Kotiko is for
> learners.
>
> Our mascot is a small black kitten named Mira.
>
> Cats have a trick we haven't learned. Ask a cat in Moscow and it says мяу. In Beijing, 喵.
> In Madrid, miau. In Tokyo, nyā. In Seoul, yaong. Every language writes it down
> differently, and every one of those people knows exactly what the cat wants.
>
> People are harder. We split ourselves into languages and then stand on either side of the
> line, sure the other side is saying something we'll never understand. Most of the time,
> we'd understand just fine, if someone swapped in a word or two.
>
> So that's what Kotiko does. It takes the words you've learned and slips them into the
> pages you already read, one word at a time, until the line between your language and
> someone else's starts to blur.
>
> Mira's name is a clue, if you speak a few languages. In Spanish, mira means "look." In
> Latin, it means "wonderful." In Russian, мира means "of the world," and also "of peace."
>
> Look. The world is wonderful. It's just been waiting for us to understand each other.

**Store listing, short version:**

> Kotiko slips the words you've learned into the pages you read, one at a time, until a
> foreign language stops feeling foreign.

Mira is deliberately not named in the store listing (maintainer decision): the rename was
to get out of the crowd of "Mira" products in those stores, so the listing shouldn't bring
the name back. The kitten icon sits right beside the text, so she's still there; she just
isn't named until people install. Her name and its hidden layer live in the docs and the
welcome tab's About, where people who've installed Kotiko find them.

**Checked facts** (2026-10-01): the cat sounds are the real spellings in each language
(Russian мяу, Mandarin 喵, Spanish miau, Japanese ニャー nyā, Korean 야옹 yaong); мира is the
genitive of мир, which means both "world" and "peace"; Latin mira means "wonderful", the
source of the star Mira's name; Russian котик means "kitty".

**Before launch:**

- A native Russian speaker confirms that "Kotiko" reads as cute rather than awkward.
- The Spanish versions of both texts (the listing and docs ship in English and Spanish,
  [50](../50-ui-localization-and-base-language/SPEC.md)) are written by a native Spanish
  writer from a brief, not translated line by line. The brief: for Spanish readers the
  reveal works backwards, because "mira" is simply their word. Open the reveal with the
  Russian and Latin meanings and let the Spanish one land last, as the familiar word they
  suddenly see in a new light. The writer decides how to make that turn feel natural.
- The trademark screen for Kotiko ([04](../04-rename-to-kotiko/SPEC.md)) runs before the
  first store submission. Mira appears only after install (docs, About), never in store
  listings, store artwork text or the extension's name and description.

The publisher is ScriptKittyOS ([DECISIONS](../DECISIONS.md)).

### 2. Promise and personality

Promise: **"Read the web in the words you're learning."** Spanish: **"Lee la web con las
palabras que estás aprendiendo."**

| Kotiko is | Kotiko is not |
|---|---|
| Calm, like a good reading lamp | Gamified, loud, streak-driven |
| Warm, a little playful | Childish or cartoonish |
| Precise about language | Academic or fussy |
| Generous: free, open, works offline | Salesy: "upgrade", "pro", "premium" |
| Quietly delightful at rare moments | Celebratory on every click |

### 3. Voice and tone

Rules, each with an example; slices 13-37 write their copy to these. The rules apply to
every interface language: the English and Spanish launch locales are written to them from
the start, and translators get them in the glossary ([50](../50-ui-localization-and-base-language/SPEC.md) section 9).

1. **Plain words, short sentences.** "Added gracias." not "Your vocabulary item was
   successfully created."
2. **Say what happened, what still works, and what to do next** for anything that went wrong
   (catalog in [25](../25-plain-language-errors/SPEC.md)).
3. **Second person, active voice, no blame.** "That key wasn't accepted." not "You entered an
   invalid key."
4. **Name languages, not codes;** show endonyms where space allows, beside the name in the
   interface language ("العربية · Arabic" in English, "العربية · árabe" in Spanish).
   Never assume the learner reads English: no "English" as a stand-in for "the page's
   language" or "your language".
5. **Sentence case everywhere,** including buttons; never all caps (it breaks caseless scripts
   and shouts).
6. **No exclamation marks** except in milestone moments
   ([32](../32-page-coverage-and-celebrations/SPEC.md)), at most one there.
7. **No jargon in the main line:** no "sync", "token", "API", "LLM", "model", ".env", status
   codes or model ids. "Look up" is the verb for what the model does. Technical detail goes
   behind "Details".
8. **No "AI" framing.** Kotiko looks words up; it doesn't "think" or "generate".
9. **The mascot doesn't talk.** If the logo has a character, it is a face, not a narrator: no
   "Kotiko says…", no first-person voice, no puns in errors. The product speaks plainly.
10. **Honest numbers.** "12 words", never "dozens"; coverage is "could be in your languages",
    never "you can read".
11. **Translatable:** whole sentences, named placeholders, plurals via `Intl.PluralRules`
    ([50](../50-ui-localization-and-base-language/SPEC.md)), no text in images.
12. **Spelling and register per locale:** US spelling in the `en` strings; neutral Latin
    American Spanish with informal `tú` and gender-neutral wording where Spanish allows it
    ("Te damos la bienvenida") in `es` (see Open questions). Other locales follow their
    translators' glossary.

The same moments in both launch locales. The learner's base language decides the meaning
shown after "="; here, an English reader and a Spanish reader:

| Moment | en | es |
|---|---|---|
| Empty word list | "No words yet. Type one above, in any language." | "Todavía no hay palabras. Escribe una arriba, en cualquier idioma." |
| Adding | "Looking up shukran…" | "Buscando shukran…" |
| Added | "Added شكرا (shukran) = thanks · Arabic" | "Agregada شكرا (shukran) = gracias · árabe" |
| Already had it | "Already in your list: Hund = dog · German" | "Ya está en tu lista: Hund = perro · alemán" |
| Offline | "You're offline. Your words still work on pages; new ones will be looked up when you're back." | "Estás sin conexión. Tus palabras siguen funcionando en las páginas; las nuevas se buscarán cuando vuelvas." |
| Milestone | "Half of the words on this page could be in your languages." | "La mitad de las palabras de esta página podrían estar en tus idiomas." |

### 4. The logo: final artwork pending

> **Update, 2026-10-01:** the maintainer supplied the logo (a black kitten with orange eyes and
> a purple outline; `brand/source/kotiko-original.png`). It is in use on a `#8E5EFA` tile at
> every icon size, tuned for 16 and 32 px (`brand/logo/`). An artist is producing the master
> vector, one-color versions and store artwork; the illustrations in `brand/illustrations/`
> are placeholders cropped from the artist's mockup. The requirements below still apply to
> the artist's final files.

The maintainer is supplying the final artwork. The **current direction** is a cute black
kitten head, not too detailed, on a purple tile, for the ScriptKittyOS feel. This slice does
not describe any draft as final and does not fix its colors; it defines what the artwork
must meet and what gets derived from it.

#### 4.1 Requirements for the artwork

The maintainer's delivery should include a master SVG on a square grid (128 units
recommended) and hand-tuned 16 and 32 px drawings (or the derivation in §5 makes them). The
toolbar colors used in every check are #FFFFFF and Chrome's #DEE1E6 (light), and #202124,
#35363A and Firefox's #2B2A33 (dark). It must meet these, each checked as in §7:

| # | Requirement |
|---|---|
| A1 | **Legible at 16 px** on all five toolbar colors, at 100 % and 200 % scale, with hand-tuned 16 and 32 px drawings rather than downscaled art. |
| A2 | **Figure on its background at least 3:1, aiming for 4:1** (for a near-black kitten, that means a medium purple tile, not a dark one). |
| A3 | **Tile against toolbars at least 3:1** for white and for near-black (#202124). The artist brief asks for a tile purple between **#8A63EA and #9370F0**, which gives a near-black figure 4.46-5.14:1 on the tile and the tile 3.61-4.16:1 on white and 3.87-4.46:1 on #202124 (2.90-3.34:1 on #35363A, where the figure's own contrast carries it). A darker purple such as #6C3FD0 fails: a soft-black figure on it is 2.88:1 and the tile on #202124 is 2.50:1. |
| A4 | **Readable in grayscale** (check the master desaturated). |
| A5 | **Flat color preferred;** at most 4 colors plus the background; no gradients, glows or thin lines in any size. |
| A6 | **Works in one color** (a single flat ink, no tile) for print, forced colors and favicons. |
| A7 | **Works without the tile**, on both light and dark surfaces, for Kotiko's own pages and the docs. |
| A8 | **Survives the toolbar badge**, which Chrome and Firefox draw over the lower right of the icon ([20 §5](../20-popup-redesign/SPEC.md), [32](../32-page-coverage-and-celebrations/SPEC.md)). |
| A9 | **Avoids:** an eye as the main symbol (it suggests surveillance on an extension that reads pages); speech bubbles or any chat shape; four-point sparkles or "AI" glints; flags; a letter from a single alphabet as the mark; text inside the icon; thin lines; fangs or claws; anything close to existing products in the same space. |
| A10 | **Culturally comfortable and original:** passes the cultural review and trademark search in §7. If the figure is a black cat, it must read as cute and lucky, never spooky (black cats carry a bad-luck superstition in parts of Europe and the Americas). |
| A11 | **Provides the brand color:** the tile color becomes [06](../06-design-system/SPEC.md)'s `--brand` input; 06 derives darker shades for text, and the tile itself is never altered. |

#### 4.2 Do's and don'ts

**Do:**
- Use the tiled mark for the browser toolbar, store icons and anywhere the icon stands alone.
- Use the tile-less glyph inside Kotiko's own pages and the docs.
- Use the small-size drawings at 16 and 32 px; never downscale the master below 24 px.
- Keep clear space of one eighth of the tile width on every side.
- Keep any face friendly and simple.

**Don't:**
- Don't recolor, stretch, rotate, outline or shadow the mark, or add gradients, glows or
  glass.
- Don't add text, sparkles, glints, accessories or seasonal costumes to the mark.
- Don't crop to a single feature (for example the eyes).
- Don't place a dark figure on a dark or busy background without its tile or rim.
- Don't make the mark speak (no speech bubbles; a chat look was rejected).
- Don't put the mark on websites the learner reads, except inside Kotiko's own popover or
  milestone toast.

### 5. Forms derived from the artwork

Once the artwork arrives, these are produced from it, using only its colors (or
`currentColor`), and committed to `brand/`. The master file is never edited.

| Form | File | What changes from the master |
|---|---|---|
| F1. 16 px drawing | `brand/mark-16.svg` | Redrawn on a 16-unit grid: flat tile; main figure slightly enlarged; features snapped to whole pixels; details under one pixel (highlights, fine lines) dropped. Used for every 16 px slot. |
| F2. 32 px drawing | `brand/mark-32.svg` | Redrawn on a 32-unit grid by the same rules as F1, keeping one-pixel details. Used for 24 and 32 px slots. |
| F3. One color | `brand/mark-mono.svg` | `currentColor` silhouette, no tile; interior features cut out so they read in one ink. |
| F4. Tile-less glyph | `brand/mark-glyph.svg` | Full color without the tile, with a thin rim in a light color from the artwork so a dark figure stays visible on dark surfaces (≥ 3:1 against the dark canvas from 06). |
| F5. Firefox dark-theme icon | `brand/mark-16-dark.svg`, `mark-32-dark.svg` | Only if K1 shows the tile is lost on a dark toolbar: a 1 px light inner rim on the tile, shipped through Firefox's `action.theme_icons`. Chrome has no equivalent, which is why A3 matters. |
| F6. Wordmark and lock-up | `brand/wordmark.svg`, `brand/lockup.svg` | "Kotiko" drawn as outlines (no font dependency), a rounded humanist sans, capital M; letters in ink (#1F1A2B on light, #F2EEF8 on dark, from 06). Lock-up: glyph left, wordmark right, cap height 40 % of the glyph height. Until it exists, headers set "Kotiko" in 06's display stack. |
| F7. Character states (optional) | `brand/character/*.svg` | If the artwork is a character, up to three variants drawn from it: "peek" (for empty states), "content" (milestones), "sleeping" (Kotiko off or paused). Always decorative (`aria-hidden`), at most one per screen, never in error states, motion limited to one 150 ms blink with none under reduced motion ([06 §9](../06-design-system/SPEC.md)). |

### 6. Asset set

PNGs are generated by `brand/build.mjs` (`@resvg/resvg-js`), run in CI by
[30](../30-release-pipeline/SPEC.md). The build strips `<metadata>` from SVGs before rendering,
because some files carry a C2PA provenance manifest whose namespace `@resvg/resvg-js` rejects.

| Asset | Size | Source | Notes |
|---|---|---|---|
| Manifest `icons` | 16, 32, 48, 128 | F1, F2, master, master | |
| `action.default_icon` | 16, 24, 32 | F1, F2 at 0.75, F2 | 24 for Windows at 150 % |
| Firefox `action.theme_icons` | 16, 32 | F5 | Only if needed |
| Chrome Web Store icon | 128 × 128 | Master | 96 × 96 artwork centered, 16 px transparent padding per side |
| Chrome small promo tile | 440 × 280 | Master + F6 | Required. Mark and "Kotiko" on the brand color; legible at half size on light grey; full bleed |
| Chrome marquee | 1400 × 560 | Master + F6 | Optional; prepare it |
| Screenshots (Chrome, Firefox, Edge) | 1280 × 800 | [28](../28-privacy-and-store-readiness/SPEC.md) | Chrome up to 5, Edge up to 6; square corners |
| Firefox AMO icon | 128 × 128 | Master | Shown at 32, 64, 128 |
| Edge logo | 300 × 300 | Master | Minimum 128 |
| Edge small promo tile | 440 × 280 | As Chrome | |
| GitHub social preview | 1280 × 640 | Lock-up | Lock-up and tagline on the brand color |
| Docs favicon | SVG + 32 px PNG | F4, F3 | The SVG favicon switches to F3 in forced colors |
| Large renders | 512 | Master | For the docs and press |
| Safari app icon (later) | 1024 | Master | [51](../51-safari-port/SPEC.md) |

Store sizes checked against Chrome's "Supplying images" and Microsoft's "Publish a Microsoft
Edge extension" documentation in October 2026; re-check at submission.

### 7. Checks

| # | Check | Method |
|---|---|---|
| K1 | Recognizable at 16 px on the five toolbar colors at 100 % and 200 % | Three people pick it from a row of 12 real extension icons in under 2 s on each; decides F5 |
| K2 | Contrast per A2 and A3 | `brand/build.mjs` computes figure-on-tile and tile-on-toolbar ratios and fails below 3:1 (figure on tile, tile on #FFFFFF and #202124) |
| K2b | Grayscale (A4) and color count (A5) | The build renders a desaturated contact sheet and counts distinct fills |
| K3 | Badge | Toolbar screenshots with "42%" and "off" badges, Chrome and Firefox |
| K4 | One color and forced colors | F3 in Windows High Contrast and a one-ink print |
| K5 | Original | WIPO Global Brand Database image search, EUIPO and USPTO design-code searches, and a reverse image search; results dated in `brand/REVIEW.md` |
| K6 | Culturally comfortable | Five reviewers from different regions (East Asia, South Asia, the Middle East, Latin America, Europe) review the mark and any character states; names and notes in `brand/REVIEW.md` |

### 8. Process for adopting the artwork

1. The maintainer adds the master SVG to `brand/` (and any small-size drawing of their own).
2. Run `brand/build.mjs` to produce the contact sheet (`brand/sheet.png`: every size on the
   five toolbar colors, with and without badges, plus a grayscale copy) and the K2 numbers.
3. Run K1, K3-K6 and record them in `brand/REVIEW.md`. Draw F1, F2, F3, F4 and F6 (unless the
   maintainer supplied F1 and F2), and F5 and F7 if needed.
4. Hand the tile color to [06](../06-design-system/SPEC.md): run its `derive-palette.mjs` with
   it, then `contrast.mjs`, and update 06's tables in the same PR (06 §3.1).
5. Maintainer review of the contact sheet, derived forms and any changed UI tokens, in one
   round.
6. Generate the asset set, wire icons into the manifest with [04](../04-rename-to-kotiko/SPEC.md),
   and hand store artwork to [28](../28-privacy-and-store-readiness/SPEC.md).

## Acceptance criteria

- [ ] `brand/` contains the maintainer's master and F1, F2, F3, F4 and F6 (plus F5 and F7 when
      required); derived files use only the master's colors or `currentColor`
      (CI check).
- [ ] The manifest declares icons at 16, 32, 48 and 128 and action icons at 16, 24 and 32,
      with every 16 px slot rendered from F1.
- [ ] `brand/build.mjs` reports K2 contrasts and fails below the thresholds.
- [ ] `brand/REVIEW.md` records K1-K6 with dates and reviewer names.
- [ ] [06](../06-design-system/SPEC.md)'s `--brand` equals the master's tile color, and its
      contrast checks pass after regeneration.
- [ ] Store artwork exists at exactly the sizes in §6 and passes each store's upload
      validator.
- [ ] No UI string contains "Slovo", "Слово", "AI", "LLM", "token" or "sync" in a main line
      (string lint in [02](../02-test-harness-and-ci/SPEC.md)).
- [ ] The voice guide (§3) and do's and don'ts (§4.2) are linked from CONTRIBUTING
      ([03](../03-oss-foundations/SPEC.md)).

## Test plan

- **Automated:** `brand/build.mjs` renders every asset, checks sizes, colors and contrast; the
  string lint.
- **Manual:** toolbar screenshots in Chrome (light, dark), Firefox (light, dark, a colorful
  theme), Edge and Windows High Contrast at 100 % and 200 %, with and without badges; the
  recognition test (K1); a store upload dry run.

## Rollout and migration

Ships with the rename ([04](../04-rename-to-kotiko/SPEC.md)) in the first Kotiko release; the old
`icon48.png` and `icon128.png` are deleted. If the artwork is late, the release can ship with
the current direction's draft icons in the manifest, but store listings wait for the final
artwork. Changelog: "Slovo is now Kotiko, with a new look."

## Open questions

1. **Logo license.** Recommendation: code under Apache-2.0 ([DECISIONS](../DECISIONS.md)); the
   logo and wordmark under CC BY-ND 4.0 plus a trademark note in the README ("forks must use a
   different name and logo"), so forks can't pass as official builds.
4. **Tile purple.** Recommendation: a value between #8A63EA and #9370F0 (A3); whatever the
   artist picks, 06's ramp is regenerated from it.
2. **Spelling and register per launch locale.** Recommendation: US spelling for `en`,
   matching browser UI conventions; neutral Latin American Spanish with `tú` for `es`
   ([50](../50-ui-localization-and-base-language/SPEC.md) open question 4); docs may follow
   the author.
3. **Character states.** If the final logo is a character, should it appear in empty states
   and milestones (F7)? Recommendation: yes, sparingly, under the rules in F7.

## Future work

- A one-time animated version of the mark in the welcome header, under the motion rules.
- Community artwork (stickers, wallpapers) under the same rules.
