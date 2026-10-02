# 06 · Design system

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | L (several weeks) |
| **Depends on** | [05-brand-identity](../05-brand-identity/SPEC.md) |
| **Unblocks** | [19-word-popover](../19-word-popover/SPEC.md), [20-popup-redesign](../20-popup-redesign/SPEC.md), [21-dashboard](../21-dashboard/SPEC.md), [22-first-run-onboarding](../22-first-run-onboarding/SPEC.md), [27-accessibility-baseline](../27-accessibility-baseline/SPEC.md), [32-page-coverage-and-celebrations](../32-page-coverage-and-celebrations/SPEC.md), [37-language-colors-and-reading-aids](../37-language-colors-and-reading-aids/SPEC.md) |
| **Sources** | Maintainer design bar ([DECISIONS](../DECISIONS.md)); [05 S37 contrast, motion](../../docs/research/05-learner-ux.md); [02 F3, F4 fonts and RTL](../../docs/research/02-linguistics.md); [03 D2, E5 popover and site CSS](../../docs/research/03-browser-extension.md) |

## Problem

Kotiko's interface today is one 300 px popup with its own ad hoc styles
(`extension/popup.html:6-105`). It works, but it can't carry a dashboard, a welcome page, a
popover on every website and a celebration layer, and it has real defects:

- The input border is `#dfe6ef` on `#ffffff` (`popup.html:9, 59`), about 1.3:1, well below
  the 3:1 that WCAG 1.4.11 requires for control boundaries (measured in
  [05 S37](../../docs/research/05-learner-ux.md)).
- Body text is a fixed 13 px (`popup.html:32`) over a graph-paper background with a red margin
  rule (`popup.html:35-40`), which adds visual noise behind small text.
- The only "brand" color is a red (`--margin: #c2363b`, `popup.html:12`) that is also the
  error color (`popup.html:50`) and the focus color (`popup.html:78`), so errors, focus and
  decoration look the same.
- There is no type support beyond `system-ui` (`popup.html:32`) and Georgia for a Cyrillic
  heading (`popup.html:45`); nothing considers CJK glyph selection by language, Arabic line
  height, or Devanagari ascenders.
- There are no motion rules, no reduced-motion handling and no components to reuse.

The maintainer's bar is explicit: "a design that Apple would be jealous of", colors "easy on
every eye and culture", light and dark, burnt orange with purples and blue where it fits, and
nothing that looks like other dashboards or dropdowns. The final logo artwork is pending
([05](../05-brand-identity/SPEC.md)); the UI's brand purple must match its tile exactly, so
the purple ramp is generated from that one color.

## Goals

- One token set (color, type, space, radius, elevation, motion) in CSS custom properties,
  used by every extension page and by the in-page popover.
- Every text and control color pair meets WCAG 2.2 AA in both themes, verified by a script in
  CI, with the computed ratios recorded here.
- Status is never conveyed by color alone; status colors stay distinguishable under simulated
  protanopia, deuteranopia and tritanopia, or carry an icon and words when they can't.
- Typography renders well in Latin, Cyrillic, Greek, CJK (correct glyph shapes per language),
  Arabic and Hebrew, Devanagari and other Indic scripts, Thai and Georgian, with system fonts
  only.
- Eight core components specified to the state level, plus a gallery page that renders them
  all in both themes for screenshot tests.
- A short, enforceable statement of what makes Kotiko look like Kotiko.

## Non-goals

- The logo and wordmark: [05](../05-brand-identity/SPEC.md).
- Screen-specific layouts: [19](../19-word-popover/SPEC.md), [20](../20-popup-redesign/SPEC.md),
  [21](../21-dashboard/SPEC.md), [22](../22-first-run-onboarding/SPEC.md).
- Per-language underline colors on pages: the palette is defined here (§4.5); the feature is
  [37](../37-language-colors-and-reading-aids/SPEC.md).
- Missing-glyph detection and font hints on pages: [17](../17-casing-and-script-display/SPEC.md).
- A full accessibility audit: [27](../27-accessibility-baseline/SPEC.md) checks what this slice
  builds.

## User stories

- As a learner reading at night, I want a dark theme that is soft rather than pure black and
  white, so that my eyes don't tire.
- As a learner with deuteranopia, I want errors and successes to look different by shape and
  words, so that I never have to guess.
- As a learner of Japanese, I want 犬 drawn with Japanese glyph shapes, not Chinese ones, so
  that I learn the right forms.
- As a contributor, I want ready components and tokens, so that a new screen looks like Kotiko
  without design review for every pixel.

## Specification

### 1. What makes Kotiko look like Kotiko

Generic dashboards share a template: a left rail of icons, a row of KPI cards, a chart nobody
asked for, grey on grey, a blue primary, and lately purple gradients, glass and sparkles that
say "AI". Kotiko avoids all of it. Its identity rests on seven rules:

1. **The word is the hero.** A learner's native word is set large, in a face suited to its
   script (§5.1), like a specimen in a type book. Its meaning in the learner's base language
   (the gloss: "dog", "perro") is small and secondary. Counts and
   chrome stay quiet.
2. **One ornament: the dotted underline.** The mark Kotiko draws under swapped words
   (`extension/content.css:2-6`) is the system's only decoration: section dividers, the
   selected-tab indicator and the coverage meter's track use dots. The only other decoration
   is the logo's character, in the few places [05](../05-brand-identity/SPEC.md) allows.
3. **Paper by day, night sky by night.** Light theme sits on warm paper (#FAF6F0), not white;
   dark theme on a deep violet-black (#14121C), not grey or pure black. Both are tinted from
   the brand purple, which is what makes them feel designed.
4. **Purple leads, orange marks words, one primary action per view.** The brand purple
   (provisionally #8A63EA, §3) is the primary action, links and selection. Burnt orange is the
   accent for the learner's words and rare milestones. Blue is for information only. Never
   gradients on UI, never purple glow or glass, which reads as "AI".
5. **Languages by name, never by flag.** Languages are not countries. Chips show the endonym
   ("Русский", "中文", "العربية") with the name in the interface language beside it
   ("Russian" or "ruso").
6. **One signature motion: the swap.** The base-language word ("dog", "perro") fades out as
   the native word fades in and its
   dotted underline draws in from the start of the word (§9). It appears when a word is added,
   in the onboarding preview and when a word arrives live in the dashboard; never on websites.
7. **Never blocks.** No spinners for lookups, no disabled screens while the model works.
   Every user action shows its result immediately (optimistic), and slow work continues in
   place ([24](../24-add-flow-safety/SPEC.md)).

### 2. Files and theming

- `extension/ui/tokens.css`: all custom properties, light by default, dark under
  `@media (prefers-color-scheme: dark)` and under `:root[data-theme="dark"]`; light forced by
  `:root[data-theme="light"]`.
- `extension/ui/base.css`: reset, typography, focus, reduced motion, forced colors.
- `extension/ui/components.css`: the components in §10.
- `extension/ui/icons.js`: inline SVG icon builder (no icon font, no remote assets).
- `extension/ui/popover-style.js`: the popover's stylesheet as a string, loaded as a content
  script before `content.js`. A CSS file in a page's shadow root would need
  `web_accessible_resources`, which lets any site detect Kotiko. A CI check
  ([02](../02-test-harness-and-ci/SPEC.md)) asserts its token values equal `tokens.css`.
- `extension/ui/gallery.html`: every component in every state, both themes side by side.
  Excluded from release builds by [30](../30-release-pipeline/SPEC.md).

Theme preference `prefs.theme` is `"system"` (default), `"light"` or `"dark"`, set in the
dashboard settings ([21](../21-dashboard/SPEC.md)); pages set `data-theme` on `<html>` before
first paint (a synchronous inline-free script reading a cached value) to avoid a flash.
`color-scheme: light dark` is declared so native controls and scrollbars match.

### 3. Color tokens

> **Update, 2026-10-01:** the maintainer's logo has landed (see
> [`brand/README.md`](../../brand/README.md)) with tile purple **#8E5EFA**, inside the
> range below. When implementing, run the regeneration step with `#8E5EFA` as the brand
> input. The tables below were computed for the provisional `#8A63EA`; derived values will
> shift slightly, and the contrast script must be rerun.

The palette follows the maintainer's preference: purples first, burnt orange as the warm
accent, blue where it fits. **The brand purple is provisional.** The logo's final artwork is
pending from the maintainer ([05](../05-brand-identity/SPEC.md)); until it lands, the brand
purple is **#8A63EA**. The artist brief asks for a tile purple between **#8A63EA and
#9370F0**: in that range a near-black figure keeps 4.46-5.14:1 against the tile, and the tile
keeps 3.61-4.16:1 against a white toolbar and 3.87-4.46:1 against Chrome's dark toolbar
(#202124). A darker purple such as #6C3FD0, considered earlier, fails both: a soft-black
figure on it is 2.88:1 and the tile on #202124 is 2.50:1. Every purple token below is derived
from the one brand input by the rules in §3.1, so when the final logo arrives its tile color
replaces the input, the script regenerates the ramp, and the contrast checks in §4 run again.
No accent is tied to any detail of the current artwork.

**Roles.** Brand purple leads: the logo tile, brand surfaces, primary actions, links and
selection. **Burnt orange** is the accent for the learner's words: underline previews, the
new-word wash, the coverage meter and milestone moments. It is the pairing the maintainer
loves, and it never competes with the primary action because it is never a button fill.
**Blue** is kept for information messages only; links are purple and underlined (blue and
purple look alike to deuteranopes, §4.2).

All values are final for v1 except the purple rows marked "derived", which follow the brand
input. Names are role-based; components never use raw hex.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--brand` | Brand input: logo tile, brand surfaces (welcome header band, store artwork) | #8A63EA | #8A63EA |
| `--on-brand` | Text on `--brand`, large text only (24 px, or 18.66 px bold, and up) | #FFFFFF | #FFFFFF |
| `--canvas` | Page background | #FAF6F0 | #14121C |
| `--surface` | Cards, popup body, popover, inputs | #FFFFFF | #1C1928 |
| `--sunken` | Hover, wells | #F3EDE4 | #110F18 |
| `--selected` | Selected rows and chips (derived) | #EBE8FE | #2D2546 |
| `--ink` | Primary text | #1F1A2B | #F2EEF8 |
| `--ink-2` | Secondary text | #544C63 | #C4BCD4 |
| `--ink-3` | Tertiary text, placeholders, metadata | #6B6379 | #A39BB5 |
| `--border` | Control boundaries (inputs, toggles, secondary buttons) | #8A8299 | #7E7693 |
| `--divider` | Decorative lines and dots, never the only boundary of a control | #E4DCD0 | #2E2940 |
| `--primary` | Primary action fill, toggle on, selected indicator (derived) | #7F56DC | #A18BEC |
| `--primary-hover` | Primary hover and pressed (derived) | #6E43C8 | #B3A1F5 |
| `--on-primary` | Text on primary | #FFFFFF | #16102A |
| `--purple-text` | Links, selected labels, purple icons (derived) | #764DD2 | #A18BEC |
| `--purple-soft` | Purple tint, chips on (derived) | #EFECFE | #2B2148 |
| `--orange` | Word accent fill (meter, highlights) | #B4501A | #F08A4B |
| `--on-orange` | Text on orange | #FFFFFF | #1C0F06 |
| `--orange-text` | Orange text and icons | #A3440F | #F6A672 |
| `--orange-soft` | New-word wash, milestone tint | #FBE6D6 | #3A2418 |
| `--blue` | Info text and icon | #1F5FC0 | #8DBBFF |
| `--blue-soft` | Info tint | #E2ECFA | #1C2740 |
| `--success` | Success text and icon | #0B6E7A | #56C7D9 |
| `--success-soft` | Success tint | #DDF1F3 | #122F36 |
| `--warning` | Warning text and icon | #875800 | #F2C14E |
| `--warning-soft` | Warning tint | #FBEFD3 | #33280F |
| `--danger` | Error text and icon, destructive actions | #A8243A | #FF6F8A |
| `--danger-soft` | Error tint | #FBE3E6 | #3A1A22 |
| `--focus` | Focus ring (derived; equals `--purple-text`) | #764DD2 | #A18BEC |
| `--inverse-bg` / `--inverse-ink` | Toasts | #1F1A2B / #FAF6F0 | #F2EEF8 / #14121C |

The neutrals are tinted toward a violet hue so paper and night both read as Kotiko's. If the
final brand hue moves far (more than 30° in OKLCH), the neutrals are re-tinted too (§3.1).

#### 3.1 Deriving the purple ramp from the brand input

`extension/ui/tools/derive-palette.mjs <brand-hex>` computes the derived tokens in OKLCH and
writes them into `tokens.css` between generated-code markers. Rules, with `h` and `C` the
brand's OKLCH hue and chroma (#8A63EA is L 0.607, C 0.195, h 293.0):

| Token | Rule | Result for #8A63EA |
|---|---|---|
| Light `--primary` | The brand itself if white text on it is ≥ 4.8:1 (a margin over 4.5); otherwise lower L in 0.01 steps until it is | #7F56DC (4.92:1) |
| Light `--primary-hover` | Light primary with L − 0.06 | #6E43C8 |
| Light `--purple-text`, `--focus` | Light primary, L lowered further until it is ≥ 4.5:1 on every light background it sits on (surface, canvas, sunken, selected, purple-soft) | #764DD2 |
| Light `--purple-soft` | L 0.95, C 0.035, hue h | #EFECFE |
| Light `--selected` | L 0.94, C 0.03, hue h | #EBE8FE |
| Dark `--primary`, `--purple-text`, `--focus` | Hue h, chroma min(C, 0.14), L raised from the brand's in 0.01 steps until it is ≥ 6:1 on dark `--surface` | #A18BEC |
| Dark `--primary-hover` | Dark primary with L + 0.06, chroma ≤ 0.12 | #B3A1F5 |
| Dark `--purple-soft` | L 0.28, C 0.07, hue h | #2B2148 |
| Dark `--selected` | L 0.29, C 0.06, hue h | #2D2546 |
| Neutrals (only if h moves > 30°) | Keep each neutral's L and C, set its hue to h | unchanged |

Colors outside the sRGB gamut lose chroma until they fit. After deriving, the script runs
`contrast.mjs` (§4.1) and fails if any pair is below its threshold; the person updating the
brand then adjusts the failing rule's L target, never the threshold.

**When the final logo lands:** (1) take the tile color from the maintainer's artwork;
(2) run `derive-palette.mjs` with it; (3) run `contrast.mjs` and the CVD check (§4.2);
(4) update the tables in this spec from the script's output; (5) re-run the gallery
screenshot tests ([test plan](#test-plan)). Orange, blue, status colors and neutrals don't
change unless step 3 fails.

### 4. Contrast and color vision

#### 4.1 Computed ratios

Computed with the WCAG 2.x relative-luminance formula by `extension/ui/tools/contrast.mjs`
(added by this slice and run in CI; it fails the build if any pair below drops under its
threshold). Text pairs need 4.5:1; non-text (borders, focus rings, button shapes) need 3:1.
Values are for the provisional brand #8A63EA.

| Foreground | Background | Use | Light | Dark |
|---|---|---|---|---|
| `ink` | `canvas` | Body text | 15.72 | 16.20 |
| `ink` | `surface` | Body text | 16.92 | 15.06 |
| `ink` | `sunken` | Body text | 14.54 | 16.61 |
| `ink` | `selected` | Selected row text | 14.11 | 12.54 |
| `ink-2` | `canvas` | Secondary text | 7.53 | 10.14 |
| `ink-2` | `surface` | Secondary text | 8.11 | 9.43 |
| `ink-2` | `selected` | Secondary on selected | 6.76 | 7.85 |
| `ink-3` | `canvas` | Tertiary, placeholder | 5.29 | 6.98 |
| `ink-3` | `surface` | Tertiary, placeholder | 5.70 | 6.49 |
| `ink-3` | `sunken` | Tertiary on sunken | 4.90 | 7.16 |
| `ink-3` | `selected` | Tertiary on selected | 4.75 | 5.40 |
| `on-brand` | `brand` | Large text on the brand surface (3:1 needed) | 4.16 | 4.16 |
| `on-primary` | `primary` | Primary button label | 4.92 | 6.50 |
| `on-primary` | `primary-hover` | Primary button hover | 6.36 | 8.18 |
| `purple-text` | `surface` | Links, selected labels | 5.58 | 6.09 |
| `purple-text` | `canvas` | Links | 5.18 | 6.55 |
| `purple-text` | `sunken` | Links on sunken | 4.80 | 6.71 |
| `purple-text` | `purple-soft` | Chip on | 4.81 | 5.25 |
| `purple-text` | `selected` | Purple on selected | 4.65 | 5.07 |
| `orange-text` | `surface` | Orange text | 6.19 | 8.71 |
| `orange-text` | `canvas` | Orange text | 5.75 | 9.37 |
| `orange-text` | `orange-soft` | Orange text on tint | 5.13 | 7.34 |
| `on-orange` | `orange` | Text on orange | 5.12 | 7.54 |
| `blue` | `surface` | Info text | 6.08 | 8.76 |
| `blue` | `blue-soft` | Info on tint | 5.10 | 7.56 |
| `success` | `surface` | Success text | 5.96 | 8.67 |
| `success` | `success-soft` | Success on tint | 5.09 | 7.11 |
| `warning` | `surface` | Warning text | 6.13 | 10.26 |
| `warning` | `warning-soft` | Warning on tint | 5.37 | 8.62 |
| `danger` | `surface` | Error text | 7.05 | 6.47 |
| `danger` | `danger-soft` | Error on tint | 5.79 | 5.84 |
| `inverse-ink` | `inverse-bg` | Toast text | 15.72 | 16.20 |
| `border` | `surface` | Control boundary | 3.66 | 4.02 |
| `border` | `canvas` | Control boundary | 3.40 | 4.32 |
| `border` | `sunken` | Control boundary | 3.15 | 4.43 |
| `focus` | `surface` | Focus ring | 5.58 | 6.09 |
| `focus` | `canvas` | Focus ring | 5.18 | 6.55 |
| `primary` | `surface` | Primary button shape | 4.92 | 6.09 |
| `primary` | `canvas` | Primary button shape | 4.57 | 6.55 |
| `orange` | `surface` | Meter fill | 5.12 | 6.92 |
| `brand` | `canvas` | Brand tile or band edge | 3.86 | 4.46 |
| `brand` | `surface` | Brand tile or band edge | 4.16 | 4.15 |

White on `--brand` is 4.16:1, so text on a brand surface is large (24 px, or 18.66 px bold,
and up; WCAG's 3:1 for large text); smaller labels on a brand band use `--primary` or sit on
`--surface`. The brand purple keeps at least 3.86:1 against every canvas and surface in both
themes, so it also works as a shape on its own. Pairs not in this table are not allowed. `divider` is
decorative and never the only cue for a control's edge.

#### 4.2 Color vision deficiency

Simulated with Machado, Oliveira and Fernandes (2009) at full severity; differences in OKLab
ΔE × 100 (about 8 is clearly distinct, under 5 is hard to tell apart):

| Pair (light / dark) | Normal | Protan | Deutan | Tritan |
|---|---|---|---|---|
| success vs danger | 24.8 / 28.2 | 13.5 / 17.3 | 10.9 / 11.2 | 28.5 / 33.9 |
| success vs warning | 17.5 / 22.6 | 13.6 / 18.3 | 15.0 / 21.6 | 18.3 / 23.2 |
| warning vs danger | 14.0 / 22.3 | 10.5 / 21.6 | 4.2 / 14.4 | 10.2 / 17.4 |
| danger vs orange-text | 7.9 / 13.8 | 8.3 / 13.4 | 4.7 / 8.5 | 3.3 / 11.5 |
| danger vs purple-text | 25.0 / 20.3 | 25.0 / 14.7 | 24.4 / 18.4 | 22.9 / 21.4 |
| blue vs purple-text | 11.4 / 12.0 | 3.0 / 11.9 | 3.6 / 9.2 | 7.1 / 12.2 |

Consequences, which are rules:

- Success is teal-cyan rather than green so it separates from danger for red-green
  deficiencies (10.9 deutan in light, versus 5.4 for the first green tried).
- Warning and danger, and danger and the orange accent, are close for deuteranopes in light
  mode. So **every status always ships with an icon of a distinct shape and a text label**:
  success a check in a circle, warning a triangle, danger an octagon with a bar, info a
  circle with "i". Status is never color alone (WCAG 1.4.1).
- Blue and purple are close for protanopes and deuteranopes in light mode. They are never
  used to tell two things apart: purple is links and selection, blue is info, and links are
  always underlined; selection also carries a check mark or a 3 px inline-start bar.
- A toggle's on state is shown by thumb position and a check glyph inside the thumb, not only
  the purple track.
- The brand purple and the danger color are far apart for every simulated deficiency, so a
  purple primary button never reads as an error. The derive script re-checks this pair for a
  new brand input.

#### 4.3 Higher contrast and forced colors

- `@media (prefers-contrast: more)`: `--ink-3` becomes `--ink-2`, `--border` becomes
  `--ink-2`, `--divider` becomes `--border`, and soft tints gain a 1 px `--border` outline.
- `@media (forced-colors: active)`: components use system colors (`Canvas`, `CanvasText`,
  `ButtonText`, `ButtonFace`, `Highlight`, `HighlightText`, `LinkText`, `GrayText`); focus
  outlines use `Highlight`; chips and toggles keep their glyphs so state survives; no
  information depends on background color. Box shadows are dropped and replaced by 1 px
  borders. The logo switches to its one-color version ([05](../05-brand-identity/SPEC.md)).

#### 4.4 Culture

Colors avoid fixed cultural meanings where the meaning matters: no red-for-error alone (red is
luck in China and danger elsewhere), no green for success (it carries religious and political
meanings in places), and no color is attached to a language by association with a flag.
Purple and a warm orange are well liked across the major cultures we know of and carry no
strong negative meaning in them; the palette is checked again by the five cultural reviewers
in [05 §7](../05-brand-identity/SPEC.md).

#### 4.5 Language palette (used by 37)

Six hues for optional per-language underlines and chips. Each keeps at least 3:1 against
both pure white and #121212, so it works on light and dark websites, which Kotiko cannot style:

| Slot | Name | Hex | vs #FFFFFF | vs #121212 |
|---|---|---|---|---|
| 1 | Ember | #C8641E | 3.96 | 4.73 |
| 2 | Lapis | #0E66C8 | 5.60 | 3.35 |
| 3 | Lilac | #AF71F2 | 3.25 | 5.77 |
| 4 | Plum | #904E81 | 5.85 | 3.20 |
| 5 | Rose | #ED5790 | 3.30 | 5.68 |
| 6 | Lagoon | #009EAF | 3.23 | 5.81 |

Ember is the burnt-orange accent and Lilac a sibling of the brand purple, so the first two
languages already look like Kotiko. Yellow is not a slot because no yellow keeps 3:1 on white.

Validated as a categorical palette across all pairs (not only neighbours) with the
data-visualization validator: lightness band, chroma floor, worst CVD separation ΔE 9.0
(Rose vs Lagoon, deutan), worst normal-vision separation 15.9 (Rose vs Ember); all checks
pass in both modes. Slots are assigned in this fixed order and never cycled; a seventh
language gets no color unless the user reassigns one ([37](../37-language-colors-and-reading-aids/SPEC.md)).

### 5. Typography

No remote fonts and no bundled fonts in v1: extension pages and the popover use the
operating system's fonts, which cover more scripts than any bundle we could ship and keep
the package small.

#### 5.1 Stacks

```css
--font-ui: system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto,
  "Noto Sans", Ubuntu, Cantarell, "Helvetica Neue", Arial,
  "Noto Sans Arabic", "Geeza Pro", "Noto Sans Hebrew", "Noto Sans Devanagari",
  "Kohinoor Devanagari", "Nirmala UI", "Noto Sans Bengali", "Noto Sans Tamil",
  "Noto Sans Thai", "Thonburi", "Leelawadee UI", "Noto Sans Georgian",
  "Noto Sans Armenian", "Noto Sans Ethiopic", sans-serif,
  "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji";
--font-display: ui-serif, "New York", "Iowan Old Style", Charter, "Source Serif 4",
  "Noto Serif", Georgia, serif;
--font-mono: ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono", "Noto Sans Mono",
  Menlo, Consolas, monospace;
```

Han characters are unified in Unicode, so the right glyph shapes depend on the language.
Every element showing a native word carries an accurate `lang` (as `content.js:94` already
does for swaps), every gloss carries its `base_lang`, and every extension page sets
`<html lang>` to the interface locale ([50](../50-ui-localization-and-base-language/SPEC.md)),
so a Japanese interface or a Japanese gloss gets Japanese glyphs. `base.css` prepends CJK
families by language:

| Selector | Families prepended to `--font-ui` |
|---|---|
| `:lang(ja)` | "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", "Noto Sans CJK JP", "Noto Sans JP" |
| `:lang(zh-Hans)`, `:lang(zh-CN)`, `:lang(zh)` | "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC" |
| `:lang(zh-Hant)`, `:lang(zh-TW)` | "PingFang TC", "Microsoft JhengHei UI", "Noto Sans CJK TC", "Noto Sans TC" |
| `:lang(zh-HK)`, `:lang(yue)` | "PingFang HK", "Noto Sans CJK HK", "Microsoft JhengHei UI" |
| `:lang(ko)` | "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Noto Sans KR" |
| `:lang(ar)`, `:lang(fa)`, `:lang(ur)` | "Noto Naskh Arabic", "Geeza Pro", "Segoe UI", "Tahoma" (Urdu adds "Noto Nastaliq Urdu" first) |

The **display role** (the hero native word, §1 rule 1) uses `--font-display` for Latin,
Cyrillic and Greek words, and the script stacks above for everything else, at the same size.
Serif families rarely cover Arabic or Indic scripts well, and forcing them would fall back
unevenly.

#### 5.2 Rules

- **Interface locales.** Text in every component comes from the active locale and must fit
  any of them: Spanish strings run about 20-30% longer than English, German longer still,
  and the `en-XA` pseudo-locale is 40% longer (50's CI run). Labels wrap rather than
  truncate; no fixed widths on buttons, chips or tabs; icon-only controls keep a translated
  `aria-label`. Components are specified and screenshot-tested in both launch locales
  (`en`, `es`).

- Never `text-transform: uppercase` (caseless scripts, Turkish dotted i); never
  `letter-spacing` on non-Latin text (it breaks Arabic joining and Indic conjuncts).
- No italics for emphasis (CJK and many scripts have none); use weight.
- Line height: 1.45 by default; 1.6 for `:lang(ja, zh, ko)`; 1.7 for Arabic-script, Indic,
  Thai, Lao, Khmer and Myanmar. Display words get 1.2 (Latin) or 1.4 (others).
- Mixed-direction strings put native words in `<bdi>` (as `popup.js:156` does) and inputs
  that accept native text use `dir="auto"`.
- Counts use `font-variant-numeric: tabular-nums`.
- Sizes are in `rem` so the browser's font-size setting scales everything.

#### 5.3 Scale

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `--t-caption` | 12 / 16 | 400 | Metadata only; the smallest size allowed |
| `--t-small` | 13 / 18 | 400 | Secondary lines, chip counts |
| `--t-body` | 14 / 20 | 400 | Default UI text (popup, dashboard) |
| `--t-body-strong` | 14 / 20 | 600 | Labels, buttons |
| `--t-lead` | 16 / 24 | 400 | Onboarding body, inspector fields |
| `--t-word` | 18 / 24 | 500, display | Native words in lists |
| `--t-title` | 20 / 28 | 600 | Section titles |
| `--t-word-lg` | 24 / 30 | 500, display | Native word in the popover |
| `--t-headline` | 32 / 40 | 600 | Page titles (dashboard, welcome) |
| `--t-specimen` | 44 / 52 | 500, display | The selected word in the dashboard inspector; onboarding preview |

### 6. Space

A 4 px base: `--s-0` 0, `--s-1` 2, `--s-2` 4, `--s-3` 6, `--s-4` 8, `--s-5` 12, `--s-6` 16,
`--s-7` 20, `--s-8` 24, `--s-9` 32, `--s-10` 40, `--s-11` 56. Popup gutters 16; dashboard
gutters 24 at ≥ 960 px, 16 below; inline gaps 8; between sections 24 with a dotted rule.

### 7. Radius

`--r-xs` 4 (badges), `--r-sm` 8 (chips, small buttons), `--r-md` 12 (buttons, inputs, list
rows), `--r-lg` 16 (cards, popover, toasts), `--r-xl` 24 (sheets, dialogs, welcome card),
`--r-full` 999 (toggles, avatars of language initials).

### 8. Elevation

Three levels. Light uses shadows tinted with ink; dark uses lighter surfaces and a hairline
highlight, because shadows vanish on dark backgrounds.

| Level | Use | Light | Dark |
|---|---|---|---|
| `--e-1` | Cards on canvas | `0 1px 2px rgb(31 26 43 / .06), 0 1px 1px rgb(31 26 43 / .04)` | surface #1C1928 + `inset 0 1px 0 rgb(255 255 255 / .04)` |
| `--e-2` | Popover, menus | `0 8px 24px rgb(31 26 43 / .12), 0 2px 6px rgb(31 26 43 / .08)` | #252135 + `0 8px 24px rgb(0 0 0 / .5)` + 1px `rgb(255 255 255 / .08)` border |
| `--e-3` | Sheets, dialogs, toasts | `0 24px 48px rgb(31 26 43 / .18)` | #2C2642 + `0 24px 48px rgb(0 0 0 / .6)` |

### 9. Motion

| Token | Value | Use |
|---|---|---|
| `--d-fast` | 120 ms | Hover, press, color changes |
| `--d-base` | 180 ms | Toggles, chips, popover open |
| `--d-slow` | 280 ms | Sheets, toasts, row insert |
| `--d-swap` | 420 ms | The signature swap |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Most transitions |
| `--ease-enter` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | Things arriving |
| `--ease-exit` | `cubic-bezier(0.3, 0, 0.8, 0.15)` | Things leaving (use 70 % of the enter duration) |

**The swap:** over `--d-swap`, the base-language word fades to 0 opacity with a 2 px blur while the
native word fades in from 0, then the dotted underline appears dot by dot from the inline
start (each dot 20 ms apart, capped at 200 ms total). Layout never moves: both words occupy
an inline-grid cell sized to the wider one.

Rules: only `opacity` and `transform` animate (no layout properties); nothing loops; nothing
moves on its own after 2 s; no animation blocks input.

**Reduced motion** (`prefers-reduced-motion: reduce`, and the in-app "Reduce motion" setting
which mirrors it): all `transform` animations are removed; transitions become opacity fades
of at most `--d-fast`, or none; the swap becomes an instant change followed by a 120 ms color
fade; the confetti of [32](../32-page-coverage-and-celebrations/SPEC.md) is replaced by its
static alternative. `base.css` enforces this with a global rule that sets
`animation-duration` and `transition-duration` to at most 120 ms and removes transforms in
keyframes marked `.motion`.

### 10. Components

Each lives in `components.css` with the class names below, and appears in the gallery in
every state. Minimum target size is 24 × 24 CSS px everywhere (WCAG 2.5.8) and 44 × 44 when
`(pointer: coarse)`.

**Button** (`.btn`): heights 32 (popup), 40 (pages); padding 0 14; `--r-md`;
`--t-body-strong`.
- Primary `.btn-primary`: `--primary` fill, `--on-primary` label; hover `--primary-hover`;
  pressed scales to 0.98 (no scale under reduced motion). At most one per view.
- Secondary `.btn-secondary`: `--surface` fill, 1 px `--border`, `--ink` label.
- Quiet `.btn-quiet`: no fill, `--ink-2` label, hover `--sunken`.
- Danger `.btn-danger`: quiet style with `--danger` label; destructive actions are undoable
  instead of confirmed wherever possible.
- Icon button `.btn-icon`: 32 × 32 (24 visual), always has `aria-label` and a tooltip.
- Disabled: 40 % opacity, `cursor: default`, and `aria-disabled` with an explanation nearby;
  avoid disabling at all when the action can run optimistically.
- Never shows a spinner for model work. Operations under 400 ms show nothing; longer local
  operations (import parsing) show inline progress text.

**Input** (`.field`): height 36 (popup), 40 (pages); `--surface` fill; 1 px `--border`;
`--r-md`; placeholder `--ink-3`; label above in `--t-small` `--ink-2`, or a visible
`aria-label` equivalent for the single add box. Focus: 2 px `--focus` outline, 2 px offset.
Error: `--danger` border plus a message below with the danger icon, linked by
`aria-describedby`. Native-word inputs use `dir="auto"` and `spellcheck="false"`.

**Chip** (`.chip`): height 28; `--r-sm`; `--t-small`.
- Language chip: endonym, the name in the interface language in `--ink-3` when space
  allows (`Intl.DisplayNames`, [50](../50-ui-localization-and-base-language/SPEC.md)), count. On:
  `--purple-soft` fill, `--purple-text` label, check glyph. Off: `--surface`, 1 px dashed
  `--border`, `--ink-3` label, hollow circle glyph. Focus mode: filled `--primary` with
  `--on-primary`. `role="switch"` or `aria-pressed` per screen spec.
- Filter chip: same shapes; removable chips have a 24 × 24 remove button labelled
  "Remove {name}".
- Status chip (paused, new): `--sunken` with icon and word.

**Toggle** (`.switch`): track 36 × 20, thumb 16, `--r-full`; off: `--surface` track with
1 px `--border`, thumb `--ink-3`; on: `--primary` track, `--on-primary` thumb with a check glyph.
`role="switch"`, `aria-checked`; the whole row including label is the target.

**Segmented control** (`.segmented`): for small exclusive choices like Amount
([31](../31-density-and-amount/SPEC.md)). `role="radiogroup"`; arrow keys move; selected
segment `--surface` on a `--sunken` track with `--e-1`, label `--ink`; others `--ink-2`.

**List row** (`.row`): min height 44 (popup), 52 (dashboard); leading native word in
`--t-word`, then romanization (`--ink-3`), gloss in the base language (`--ink-2`); trailing meta. Hover
`--sunken`; selected `--selected` plus a 3 px `--primary` bar at the inline start; focus ring
inset. New rows enter with the swap motion and a 2 s `--orange-soft` wash that fades.

**Popover** (`.popover`): `--surface`, `--r-lg`, `--e-2`, padding 16, max width 320, 8 px
arrow; content order and behavior in [19](../19-word-popover/SPEC.md).

**Toast** (`.toast`): `--inverse-bg` / `--inverse-ink`, `--r-lg`, `--e-3`, max width 420,
bottom center (dashboard) or bottom of the popup; one line plus one action ("Undo"); action
as underlined `--inverse-ink` text in weight 600. `role="status"`; never takes focus; 6 s, or 10 s when it has an action;
paused while hovered or focused; at most two stacked; Esc dismisses.

**Empty state** (`.empty`): a small decorative illustration (the logo's character if
[05](../05-brand-identity/SPEC.md) allows one, otherwise a dotted-underline motif;
`aria-hidden`), one sentence in `--t-lead`, one primary action. No sad faces, no exclamation
marks.

**Milestone card** (`.milestone`): `--orange-soft` background, a 4 px `--orange` inline-start
bar, the glyph at 24 px, one line in `--t-body-strong` `--ink`. Used only by
[32](../32-page-coverage-and-celebrations/SPEC.md) and the welcome page's first-word celebration.

**Meter** (`.meter`): 6 px track of `--divider` dots, fill `--orange` (overall) or the
language color; always paired with a numeric label; `role="meter"` with `aria-valuenow`
and `aria-valuetext` ("42 % of this page").

**Dotted rule** (`.rule`): `radial-gradient` dots, 2 px dots every 6 px, `--divider`; the
selected-tab indicator is the same rule in `--primary`.

### 11. Icons

A small custom set on a 20 px grid, 1.5 px stroke, round caps and joins, `currentColor`:
add, search, close, check, chevron, sliders (settings), speaker, pencil, pause, play, undo,
download, upload, file, info, warning, error, success, external link, keyboard, more. No
sparkles, eyes, chat bubbles or flags. Built by `icons.js` into inline SVG with
`aria-hidden="true"`; the accessible name always comes from the control.

## Acceptance criteria

- [ ] `tokens.css` defines every token in §3, §5.3 and §6-§9 for light and dark, and no
      component file contains a raw hex value (lint).
- [ ] `ui/tools/contrast.mjs` reproduces every ratio in §4.1 to two decimals and fails CI if
      any text pair drops below 4.5:1 or any non-text pair below 3:1.
- [ ] Every status message in the extension shows an icon and words; a test asserts no
      element with a status class lacks an icon child.
- [ ] Gallery screenshots in light, dark, `prefers-contrast: more` and `forced-colors: active`
      show every component state with visible focus rings.
- [ ] With `prefers-reduced-motion: reduce`, no element on any extension page has a running
      transform animation (checked with `document.getAnimations()` in Playwright).
- [ ] 犬 renders with Japanese glyph shapes under `lang="ja"` and 门 vs 門 differ correctly
      under `zh-Hans` and `zh-Hant` on macOS and Windows (manual).
- [ ] No extension page or the popover requests a font or any other remote resource
      (Playwright request log is empty of non-extension URLs).
- [ ] `popover-style.js` token values match `tokens.css` (CI check).
- [ ] `derive-palette.mjs #8A63EA` reproduces every "derived" value in §3 exactly; run with
      any other brand input, it either produces a ramp that passes `contrast.mjs` or exits
      non-zero naming the failing pair.
- [ ] `--brand` in `tokens.css` equals the logo tile color in `brand/` (CI compares them once
      the final artwork lands).

## Test plan

- **Unit:** `contrast.mjs` against known WCAG pairs (#777 on #fff = 4.48) plus the full token
  table; a CVD check that recomputes §4.2 and the §4.5 palette; `derive-palette.mjs` with
  #8A63EA and three other inputs (a blue-violet, a red-violet and a very dark purple).
- **Visual regression:** Playwright screenshots of `gallery.html` in four modes (light,
  dark, more contrast, forced colors), at 100 % and 200 % zoom, diffed in CI.
- **Manual:** a script sample page in the gallery with words in 20 scripts (Latin with
  diacritics, Cyrillic, Greek, Armenian, Georgian, Hebrew, Arabic, Urdu, Devanagari, Bengali,
  Tamil, Thai, Lao, Khmer, Myanmar, Ethiopic, Japanese, Simplified and Traditional Chinese,
  Korean) checked on macOS, Windows, Ubuntu and Android Firefox for clipping and line height.
- **CVD:** view the gallery through a simulator (Chrome DevTools rendering emulation) for
  protanopia, deuteranopia, tritanopia and achromatopsia.

## Rollout and migration

The popup, dashboard, welcome page and popover adopt the system as they are rebuilt in 19-22;
nothing is restyled piecemeal. The old graph-paper styles (`popup.html:6-105`) are deleted
with the popup rewrite in [20](../20-popup-redesign/SPEC.md). Changelog: "A new look, with
light and dark themes."

## Open questions

1. **Bundle a font for the display role?** Recommendation: no for v1. System serifs vary, but
   a bundled Latin serif would clash with system CJK and Arabic beside it, and adds size.
   Revisit if screenshots on Windows look uneven.
2. **Theme switch in the popup?** Recommendation: only in dashboard settings; the popup
   follows it. The popup stays small.
3. **Final brand purple.** Pending the maintainer's logo artwork. Recommendation: keep
   #8A63EA as the input until then; when the artwork lands, run the regeneration steps in
   §3.1 in the same PR that adds the logo.

## Future work

- Bundled Noto subsets for scripts often missing on minimal Linux, if
  [17](../17-casing-and-script-display/SPEC.md) shows tofu is common.
- A token export (JSON) for the docs site ([44](../44-docs-site/SPEC.md)) and a server-served
  word manager.

## Implementation notes

*2026-10-02, with the popup rewrite ([20](../20-popup-redesign/SPEC.md)). What exists now,
what waits for the slices that need it. Requirements above are unchanged.*

**Built.**

- `extension/ui/tools/color.mjs` (sRGB, OKLab/OKLCH, WCAG contrast, Machado 2009 CVD
  simulation), `derive-palette.mjs` (§3.1) and `contrast.mjs` (§4.1, §4.2). Development
  tooling only; nothing in the extension loads them. Release builds should leave out
  `extension/ui/tools/` ([30](../30-release-pipeline/SPEC.md)).
- `derive-palette.mjs` writes every theme-dependent token (the fixed values of §3 and §8
  live in the script) between `<generated:…>` markers in `tokens.css`, in three blocks:
  light, dark under `prefers-color-scheme`, and dark under `[data-theme="dark"]`.
  `--check` fails when `tokens.css` is stale. Colors outside sRGB lose chroma in 0.005
  steps: that step size reproduces every "derived" value in §3 for `#8A63EA` exactly
  (with a finer step, purple-soft comes out `#EFECFF`). A unit test checks the
  reproduction, the spec's ratios for `#8A63EA`, and three other inputs.
- `contrast.mjs` reads `tokens.css`, checks every pair below in both themes, fails under
  4.5:1 (text) or 3:1 (non-text and large text), and fails if `primary` and `danger` come
  within ΔE 8 under any simulated deficiency. It runs in CI's "versions and licenses"
  job together with `derive-palette.mjs --check`, and `--markdown` prints these tables.
- `tokens.css` (color, type scale as `font` shorthands used as
  `font: var(--t-body) var(--font-ui)`, space, radius, elevation, motion, target size,
  the §4.5 language palette, reduced motion, more contrast), `base.css` (reset, script
  stacks by `:lang()`, `--font-word` for the display role, line heights, focus, reduced
  motion including `<html data-motion="reduce">`, forced colors), `components.css`
  (button, link, input, switch, language chip, status pill, banner, details, list row,
  toast, empty state, card, skeleton, dotted rule, the word with its dotted underline and
  the swap motion), `icons.js` (§11 set plus `circle`, `target`, `enter`, `back`) and
  `theme.js` (applies `prefs.theme` before first paint from a localStorage copy; the
  setting itself is [21](../21-dashboard/SPEC.md)'s).
- Tests: `test/unit/design-system.test.mjs` (math, derivation, AA, raw-hex lint for
  component and page CSS, no remote resources, no uppercase or letter spacing).

**Brand input `#8E5EFA`** (OKLCH L 0.614, C 0.221, h 292.9; hue shift 0.1°, so the
neutrals keep their values). Derived tokens, light / dark:

| Token | Light | Dark |
|---|---|---|
| `--primary` | #8351EC | #A08AEB |
| `--primary-hover` | #723CD7 | #B2A0F5 |
| `--purple-text`, `--focus` | #7A46E1 | #A08AEB |
| `--purple-soft` | #EFECFE | #2B2148 |
| `--selected` | #EBE8FE | #2D2546 |

Computed ratios for `#8E5EFA`, from `node extension/ui/tools/contrast.mjs --markdown`.
The rows after `brand`/`surface` are pairs the popup added (text and links on the status
tints, the failed-add line, the count on a chip that is on); they extend §4.1's allowed
list.

| Foreground | Background | Use | Needs | Light | Dark |
|---|---|---|---|---|---|
| `ink` | `canvas` | Body text | 4.5 | 15.72 | 16.20 |
| `ink` | `surface` | Body text | 4.5 | 16.92 | 15.06 |
| `ink` | `sunken` | Body text | 4.5 | 14.54 | 16.61 |
| `ink` | `selected` | Selected row text | 4.5 | 14.11 | 12.54 |
| `ink-2` | `canvas` | Secondary text | 4.5 | 7.53 | 10.14 |
| `ink-2` | `surface` | Secondary text | 4.5 | 8.11 | 9.43 |
| `ink-2` | `selected` | Secondary on selected | 4.5 | 6.76 | 7.85 |
| `ink-3` | `canvas` | Tertiary, placeholder | 4.5 | 5.29 | 6.98 |
| `ink-3` | `surface` | Tertiary, placeholder | 4.5 | 5.70 | 6.49 |
| `ink-3` | `sunken` | Tertiary on sunken | 4.5 | 4.90 | 7.16 |
| `ink-3` | `selected` | Tertiary on selected | 4.5 | 4.75 | 5.40 |
| `on-brand` | `brand` | Large text on the brand surface | 3 | 4.09 | 4.09 |
| `on-primary` | `primary` | Primary button label | 4.5 | 4.82 | 6.42 |
| `on-primary` | `primary-hover` | Primary button hover | 4.5 | 6.28 | 8.09 |
| `purple-text` | `surface` | Links, selected labels | 4.5 | 5.54 | 6.01 |
| `purple-text` | `canvas` | Links | 4.5 | 5.15 | 6.47 |
| `purple-text` | `sunken` | Links on sunken | 4.5 | 4.76 | 6.63 |
| `purple-text` | `purple-soft` | Chip on | 4.5 | 4.77 | 5.18 |
| `purple-text` | `selected` | Purple on selected | 4.5 | 4.62 | 5.00 |
| `orange-text` | `surface` | Orange text | 4.5 | 6.19 | 8.71 |
| `orange-text` | `canvas` | Orange text | 4.5 | 5.75 | 9.37 |
| `orange-text` | `orange-soft` | Orange text on tint | 4.5 | 5.13 | 7.34 |
| `on-orange` | `orange` | Text on orange | 4.5 | 5.12 | 7.54 |
| `blue` | `surface` | Info text | 4.5 | 6.08 | 8.76 |
| `blue` | `blue-soft` | Info on tint | 4.5 | 5.10 | 7.56 |
| `success` | `surface` | Success text | 4.5 | 5.96 | 8.67 |
| `success` | `success-soft` | Success on tint | 4.5 | 5.09 | 7.11 |
| `warning` | `surface` | Warning text | 4.5 | 6.13 | 10.26 |
| `warning` | `warning-soft` | Warning on tint | 4.5 | 5.37 | 8.62 |
| `danger` | `surface` | Error text | 4.5 | 7.05 | 6.47 |
| `danger` | `danger-soft` | Error on tint | 4.5 | 5.79 | 5.84 |
| `inverse-ink` | `inverse-bg` | Toast text | 4.5 | 15.72 | 16.20 |
| `border` | `surface` | Control boundary | 3 | 3.66 | 4.02 |
| `border` | `canvas` | Control boundary | 3 | 3.40 | 4.32 |
| `border` | `sunken` | Control boundary | 3 | 3.15 | 4.43 |
| `focus` | `surface` | Focus ring | 3 | 5.54 | 6.01 |
| `focus` | `canvas` | Focus ring | 3 | 5.15 | 6.47 |
| `primary` | `surface` | Primary button shape | 3 | 4.82 | 6.01 |
| `primary` | `canvas` | Primary button shape | 3 | 4.48 | 6.47 |
| `orange` | `surface` | Meter fill | 3 | 5.12 | 6.92 |
| `brand` | `canvas` | Brand tile or band edge | 3 | 3.80 | 4.53 |
| `brand` | `surface` | Brand tile or band edge | 3 | 4.09 | 4.21 |
| `ink` | `warning-soft` | Banner text (state) | 4.5 | 14.82 | 12.65 |
| `ink` | `blue-soft` | Banner text (info) | 4.5 | 14.19 | 12.99 |
| `ink` | `danger-soft` | Banner text (blocking) | 4.5 | 13.89 | 13.59 |
| `ink-2` | `sunken` | Secondary on sunken | 4.5 | 6.96 | 10.40 |
| `ink-2` | `warning-soft` | Banner details | 4.5 | 7.10 | 7.92 |
| `ink-2` | `blue-soft` | Banner details | 4.5 | 6.80 | 8.13 |
| `ink-2` | `danger-soft` | Banner details | 4.5 | 6.65 | 8.51 |
| `purple-text` | `warning-soft` | Link in a banner | 4.5 | 4.85 | 5.05 |
| `purple-text` | `blue-soft` | Link in a banner | 4.5 | 4.65 | 5.19 |
| `purple-text` | `danger-soft` | Link in a banner | 4.5 | 4.55 | 5.43 |
| `danger` | `canvas` | Failed add line | 4.5 | 6.55 | 6.97 |
| `ink-3` | `purple-soft` | Count on a chip that is on | 4.5 | 4.91 | 5.60 |

Color-vision separations (ΔE OKLab × 100), `#8E5EFA`:

| Pair (light / dark) | Normal | Protan | Deutan | Tritan |
|---|---|---|---|---|
| success vs danger | 24.8 / 28.2 | 13.5 / 17.3 | 10.9 / 11.2 | 28.5 / 33.9 |
| success vs warning | 17.5 / 22.6 | 13.6 / 18.3 | 15 / 21.6 | 18.3 / 23.2 |
| warning vs danger | 14 / 22.3 | 10.5 / 21.6 | 4.2 / 14.4 | 10.2 / 17.4 |
| danger vs orange-text | 7.9 / 13.8 | 8.3 / 13.4 | 4.7 / 8.5 | 3.3 / 11.5 |
| danger vs purple-text | 27.1 / 20.4 | 27.3 / 14.6 | 26.5 / 18.5 | 23.4 / 21.4 |
| blue vs purple-text | 13.1 / 12.2 | 5.3 / 12.2 | 5.5 / 9.5 | 7.2 / 12.4 |
| primary vs danger | 27.9 / 20.4 | 29.2 / 14.6 | 27.2 / 18.5 | 24.1 / 21.4 |

**Not built yet.** `ui/popover-style.js` and its token-equality check (with
[19](../19-word-popover/SPEC.md)); `ui/gallery.html` and its four-mode screenshot tests
(the popup's screenshot script, `test/visual/popup-screenshots.mjs`, covers the
components in use for now); the segmented control (with [31](../31-density-and-amount/SPEC.md)),
popover, milestone card and meter (with [19](../19-word-popover/SPEC.md) and
[32](../32-page-coverage-and-celebrations/SPEC.md)); the `--brand` versus `brand/` CI
comparison (waits for the final artwork); the status-icon test across every page (the
popup's DOM test checks its own status lines); the reduced-motion `getAnimations()`
check and the remote-request check in Playwright for every page (the e2e network guard
already fails any non-local request).
