# 27 · Accessibility baseline

| | |
|---|---|
| **Status** | Built (2026-10-05), English only; manual screen-reader passes not done yet; see Implementation notes |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week, spread across the UI slices) |
| **Depends on** | [06-design-system](../06-design-system/SPEC.md), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (base languages, `KotikoI18n.t()`) |
| **Unblocks** | Release sign-off for [19](../19-word-popover/SPEC.md), [20](../20-popup-redesign/SPEC.md), [21](../21-dashboard/SPEC.md), [22](../22-first-run-onboarding/SPEC.md), [13](../13-bulk-add/SPEC.md), [32](../32-page-coverage-and-celebrations/SPEC.md), [35](../35-reveal-mode-and-review/SPEC.md) |
| **Sources** | [05 S36, S37, S35](../../docs/research/05-learner-ux.md); [03 D2, D3, D4, D5, D6](../../docs/research/03-browser-extension.md); WCAG 2.2 |

> **Note (2026-10-05):** Spanish copy in this spec (listings, policy, messages, release
> notes, acceptance criteria) is optional, not a must-have. Only English is required at
> launch; see [DECISIONS 2026-10-05](../DECISIONS.md).

## Problem

Kotiko changes text on every page a person reads, so its accessibility reaches beyond its own
UI. Today, read from the code:

- **Good foundations:** popup inputs have labels and visible focus rings
  (`extension/popup.html:78, 113-116`); swapped words carry `lang` (`content.js:94`), so
  screen readers switch voice; `dir="auto"` isolates right-to-left words (`content.js:95`);
  the add result uses `aria-live="polite"` (`popup.html:117`) and `<bdi>` for native words
  (`popup.js:156`).
- **Gaps:** the input border is about 1.3:1 against white (`popup.html:9, 59`), below the 3:1
  that WCAG 1.4.11 asks of control boundaries; the "only" link is visible only on hover or
  focus (`popup.html:99-100`), so touch users never see it; status is red or green text only
  (`popup.html:49-50`); text is a fixed 13 px over a patterned background
  (`popup.html:32-40`); there is no reduced-motion handling (nothing animates yet, but
  slices 06, 22 and 32 add motion).
- **On pages:** the meaning of a swapped word lives in a `title` attribute
  (`content.js:96`) that keyboard and touch users can't reach and screen readers announce
  inconsistently ([03 D2](../../docs/research/03-browser-extension.md)). Swapping text inside
  buttons and links breaks voice control and WCAG 2.5.3 Label in Name
  ([03 D5](../../docs/research/03-browser-extension.md)); [16](../16-what-not-to-swap/SPEC.md)
  now skips controls by default.
- Nothing tests any of this.

## Goals

- Every Kotiko surface (popup, dashboard, welcome page, bulk add, popover, in-page toast,
  celebrations) meets **WCAG 2.2 level AA**, verified by automated checks in CI and a manual
  screen-reader pass before each release.
- Every task can be done with a keyboard alone, with a visible focus indicator that is never
  hidden.
- What a screen reader user hears on a swapped word is a deliberate, documented choice, with a
  setting to change it.
- Motion, color and target sizes follow the rules in [06](../06-design-system/SPEC.md) and are
  enforced.

## Non-goals

- Making third-party websites accessible. Kotiko's duty on pages is not to make them worse.
- The translation infrastructure itself: [50](../50-ui-localization-and-base-language/SPEC.md).
  This slice only requires that every accessible name, description and announcement comes
  from `KotikoI18n.t()` like any other string, and checks the English and Spanish locales.
- Mobile screen readers in depth: [45](../45-firefox-android/SPEC.md) extends this baseline
  to TalkBack.

## User stories

- As a screen reader user who reads English and is learning Spanish, I want to hear
  "gracias" in a Spanish voice where a page said "thanks", and to get the meaning in English
  when I ask for it.
- As a screen reader user who reads Spanish and is learning English, I want to hear "dog"
  in an English voice where a page said "perro", and the rest of the page in my Spanish
  voice, with every label and announcement of Kotiko's in Spanish.
- As a keyboard user, I want to add, find, edit and delete words without a mouse.
- As a person with low vision at 200 % zoom, I want the dashboard to reflow without
  horizontal scrolling.
- As a person who gets motion sick, I want no confetti or sliding when I've asked my system
  to reduce motion.
- As a voice-control user, I want "click Send" to keep working on sites where Kotiko runs.

## Specification

### 1. Standard and scope

The bar is WCAG 2.2 AA for every Kotiko-owned UI. The table lists the criteria that most
affect Kotiko and how each is met; the owning slice implements, this slice verifies.

| Criterion | How Kotiko meets it | Where |
|---|---|---|
| 1.3.1 Info and relationships | Real headings, lists, `fieldset`/`legend`, `role="grid"` for the word list, `<label>` on every field | 20, 21, 22, 13 |
| 1.3.4 Orientation | No locked orientation | all pages |
| 1.4.1 Use of color | Status always has an icon and words; selection has a check or bar; language colors also change underline style and the name is in the popover | 06 §4.2, 37 |
| 1.4.3 / 1.4.11 Contrast | Token pairs computed in CI; control borders ≥ 3:1 | 06 §4.1 |
| 1.4.4 / 1.4.10 Resize and reflow | Sizes in `rem`; dashboard, welcome and bulk add reflow at 320 CSS px with no horizontal page scroll (the word grid scrolls inside its own region); popup usable at 200 % zoom | 21, 22, 13, 20 |
| 1.4.12 Text spacing | No clipping with WCAG text-spacing overrides (line height 1.5, letter spacing 0.12 em, word spacing 0.16 em, paragraph spacing 2 em) | all pages |
| 1.4.13 Content on hover or focus | The popover can be dismissed (Esc), hovered without closing, and stays until the pointer leaves or Esc | 19 |
| 2.1.1 / 2.1.2 Keyboard, no trap | Every action keyboard-operable; popover and sheets release focus with Esc | 19-22, 13 |
| 2.2.1 Timing adjustable | Toasts pause on hover and focus; every Undo offered in a toast is also available without a time limit (recent jobs, Recently deleted, the batch summary) | 24, 21, 13 |
| 2.3.1 Three flashes | Confetti particles never flash; nothing changes luminance more than 3 times a second | 32 |
| 2.4.3 Focus order | Documented per screen (20 §4, 21 §12) | 20, 21 |
| 2.4.7 / 2.4.11 Focus visible, not obscured | 2 px `--focus` ring with 2 px offset; sticky headers and the dashboard's selection bar use `scroll-padding` so a focused row is never covered | 06, 21 |
| 2.5.3 Label in name | Controls on pages aren't swapped by default | 16 |
| 2.5.7 Dragging movements | Every drop target has a "Choose a file" button | 13 |
| 2.5.8 Target size (minimum) | 24 × 24 CSS px everywhere; 44 × 44 on coarse pointers | 06 §10 |
| 3.1.1 / 3.1.2 Language of page and parts | `<html lang>` on every extension page is the interface language ([50](../50-ui-localization-and-base-language/SPEC.md)); every native word has an accurate `lang` (08 tags); learner- or model-supplied text in another language (a gloss in a second base, a native word in a list) carries its own `lang` | all, 15 |
| 3.2.6 Consistent help | Help links (docs, report a problem) live in the same place: dashboard Settings → About and the popup's settings button | 21 |
| 3.3.1 / 3.3.3 Error identification and suggestion | Errors name the field and the fix, with an icon, linked by `aria-describedby` | 25 |
| 3.3.7 Redundant entry | Bulk add and onboarding remember choices already made (batch language, the connected AI) | 13, 22 |
| 3.3.8 Accessible authentication | Key and access-key fields allow paste and password managers; "Show" toggles visibility | 11, 22 |
| 4.1.2 Name, role, value | Native elements first; custom widgets use the ARIA patterns in §3 | all |
| 4.1.3 Status messages | Add results, toasts and milestone messages are `role="status"` (polite) and never move focus; only blocking errors after a user action use `role="alert"` | 24, 25, 32 |

### 2. Swapped words for screen readers

**Default: the target word, in its own voice.** On an English page,
`<kotiko-w lang="es">gracias</kotiko-w>` is read as "gracias" by NVDA, JAWS, VoiceOver and
Orca, switching to a Spanish voice where one is installed; on a Spanish page,
`<kotiko-w lang="en">dog</kotiko-w>` in place of "perro" is read in an English voice and the
reader switches back to Spanish for the text after it. The `lang` on `<kotiko-w>` is always
the word's target `lang`, never inferred from the page. This is listening practice, and
it matches what sighted readers see. The gloss (the meaning in the page's base language,
[50 §3](../50-ui-localization-and-base-language/SPEC.md)) is reachable on demand with the "Show details" command (33's `reveal-word`, Alt+Shift+R by
default) or, in keyboard mode, Enter on a focused word: the popover opens with focus on its
first action and is announced as a dialog, so the screen reader reads the gloss, the
language name (in the interface language) and the note; the popover marks the gloss with
the record's `base_lang` and the native word with its `lang`, so each is read in its own
voice ([19 §7](../19-word-popover/SPEC.md)).

**Setting "Screen readers hear swapped words as":** The word I'm learning (default) ·
The original word · Both. Implemented by [15](../15-framework-safe-swapping/SPEC.md)'s
element, which this slice asks to support an opt-in variant:

- Original: the visible word gets `aria-hidden="true"` on an inner `<span>` and a visually
  hidden sibling carries the page's own text with the text's base-language tag:
  `<span lang="en">thanks</span>` on an English page, `<span lang="es">perro</span>` on a
  Spanish page. The `lang` is the language [16](../16-what-not-to-swap/SPEC.md) resolved
  for that text, so the screen reader returns to the page's voice.
- Both: the hidden sibling reads "gracias, thanks" (or "dog, perro") with each part in its
  own `lang`.
- These variants put the page's original words back into its DOM next to the swap, which
  every other mode avoids ([19 §6](../19-word-popover/SPEC.md)). The setting says so:
  "Sites can read this text."
- While reveal mode ([35](../35-reveal-mode-and-review/SPEC.md)) is on, the original never
  enters the accessibility tree until revealed; the setting is overridden and says why.

**Restored text.** When Kotiko restores a page (off switch, 33's "Show the original" command,
an unswap in 15), the original text node comes back unchanged, so it carries whatever
language the page declared; Kotiko never adds or changes `lang` on page text it didn't
insert.

No `aria-label` is ever put on `<kotiko-w>`: ARIA forbids naming generic elements and most
screen readers ignore it ([03 D4](../../docs/research/03-browser-extension.md)).

**Keyboard mode (off by default):** "Let me Tab to swapped words" adds `tabindex="0"` to
swapped words so Tab reaches them and Enter opens the popover. Off by default because it
adds a tab stop for every swap on a page. When on, swaps are reachable in document order;
the shortcut stays the faster path on long pages.

**Find in page** can't find swapped words ([03 D6](../../docs/research/03-browser-extension.md)).
33's "Show the original text on this tab" command (Alt+Shift+O) restores the page for
searching; onboarding mentions it ([22 §8](../22-first-run-onboarding/SPEC.md)).

### 3. Widget patterns

| Widget | Pattern | Keys |
|---|---|---|
| Popup language chips | Toolbar of toggle buttons (`aria-pressed`) with roving `tabindex` | ←/→ (mirrored in RTL), Home/End, Space/Enter toggles, F focuses |
| Amount, theme | Radio group | Arrows change and apply immediately |
| Master switch, toggles | `role="switch"` + `aria-checked`, label is part of the target | Space |
| Dashboard word list | `role="grid"`, `aria-multiselectable="true"`, `aria-rowcount` and `aria-rowindex` with virtualization, selection announced via `aria-selected` | As [21 §12](../21-dashboard/SPEC.md) |
| Inspector | Labelled `region` on wide screens; modal `dialog` on narrow screens with focus trapped until Esc | Esc returns focus to the row |
| Popover | Non-modal `dialog` | Tab cycles inside, Esc returns focus ([19](../19-word-popover/SPEC.md)) |
| Menus (⋯, language picker) | Menu button with `aria-expanded`, `role="menu"` or a listbox combobox for searchable pickers | ↑/↓, type-ahead, Esc |
| Toasts | `role="status"`, never focused | Esc dismisses the newest |
| Bulk add review table | `role="grid"` with editable cells (Enter edits, Esc cancels) | Arrows move between cells |
| Welcome conversation | Kotiko's lines in a polite `role="log"`, choice groups in `fieldset` | Standard |

### 4. Motion and sensory

- `prefers-reduced-motion: reduce` and Kotiko's own "Reduce motion" setting (dashboard →
  Appearance) apply [06 §9](../06-design-system/SPEC.md)'s reduced rules everywhere,
  including the in-page popover, the swap motion and celebrations
  ([32](../32-page-coverage-and-celebrations/SPEC.md) shows only its message).
- No sound anywhere except speech the user asks for ([34](../34-pronunciation-audio/SPEC.md)).
- `prefers-contrast: more` and `forced-colors: active` follow
  [06 §4.3](../06-design-system/SPEC.md); in forced colors, the dotted underline on pages uses
  `CanvasText` so swaps stay visible.

### 5. Pages Kotiko changes

Rules for content scripts, beyond the popover:

- Never move focus on a page except when the user opens the popover by keyboard.
- Never insert announcements on a page except the in-page toast's polite status
  ([19 §8](../19-word-popover/SPEC.md)) and milestone messages, at most one at a time.
- Every label, accessible name, `aria-description`, toast and milestone announcement comes
  from `KotikoI18n.t()` in the interface language ([50](../50-ui-localization-and-base-language/SPEC.md));
  the in-page toast and popover set `lang` on their root to the interface language, so a
  Spanish interface on an English page is read in a Spanish voice.
- Swapped words keep the surrounding text's font, size and color; the underline is the only
  added styling (plus 37's opt-in colors), so the page's own contrast is unchanged.
- Don't swap inside controls by default ([16](../16-what-not-to-swap/SPEC.md)); when the user
  turns that on, the setting warns: "Voice control commands that use button names may stop
  working."

### 6. Testing and the release gate

- **Automated (CI, [02](../02-test-harness-and-ci/SPEC.md)):** axe-core via Playwright on
  `popup.html` (every state from [20](../20-popup-redesign/SPEC.md)), `dashboard.html`
  (list, inspector, settings, bulk add), `welcome.html` (every state from
  [22](../22-first-run-onboarding/SPEC.md)), and the popover and toast on three fixture
  pages (light, dark, RTL), in light and dark themes, in the `en` and `es` interface
  locales; zero violations of WCAG 2.2 A and AA
  rules. A keyboard-traversal script per page asserts every interactive
  element is reachable, has a visible focus ring (screenshot diff of the focused element) and
  is never covered by a sticky element. Reflow test at 320 px. Reduced-motion test with
  `document.getAnimations()`.
- **Lint:** icon-only buttons must have an accessible name; no positive `tabindex`; no
  `outline: none` without a replacement.
- **Manual before each release** (checklist in `docs/accessibility.md`, results in the
  release PR): NVDA + Firefox and NVDA + Chrome on Windows; VoiceOver + Chrome on macOS;
  Orca + Firefox on Linux; Windows High Contrast; 200 % and 400 % zoom on the dashboard;
  keyboard-only run of the step-count tasks in 20 §3 and 21 §13; one voice-control check
  (Windows Voice Access or macOS Voice Control) on a fixture with buttons.
- **People:** before the first public release, at least one screen-reader user and one
  keyboard-only user try the onboarding and daily flow; findings are filed as issues.

## Acceptance criteria

- [ ] axe-core reports zero A/AA violations on every page and state listed in §6, in both
      themes (CI).
- [ ] Every interactive element on every Kotiko page is reachable by Tab or arrow keys and
      shows a focus ring; no focused element is covered (CI script).
- [ ] The dashboard and welcome page have no horizontal page scroll at 320 CSS px.
- [ ] With reduced motion, no transform animation runs on any Kotiko surface, and celebrations
      show only their message.
- [ ] On an English fixture page, NVDA reads a swapped Spanish word with a Spanish voice by
      default, and Alt+Shift+R on it opens the popover and reads the gloss "thanks" in an
      English voice (manual, recorded).
- [ ] On a Spanish fixture page with base `es`, NVDA reads a swapped "dog" with an English
      voice and the surrounding text in Spanish; the popover reads the gloss "perro" in a
      Spanish voice and its buttons in Spanish when the interface is Spanish (manual).
- [ ] The "original word" screen-reader setting makes NVDA read "thanks" instead of
      "gracias" on an English page and "perro" instead of "dog" on a Spanish page, with the
      hidden text's `lang` equal to the page text's language, and is unavailable while
      reveal mode is on.
- [ ] Every accessible name and announcement on Kotiko pages comes from `_locales` (the
      literal-string check from [50](../50-ui-localization-and-base-language/SPEC.md)
      covers `aria-label`, `title` and `alt`), and axe passes in `es`.
- [ ] Every toast's Undo has a non-timed equivalent (manual check against §1 2.2.1).
- [ ] Target sizes: no interactive element under 24 × 24 CSS px (CI measurement).
- [ ] `docs/accessibility.md` exists and the release checklist links it.

## Test plan

As §6. Fixtures: an English page with swapped words in Spanish, Arabic (RTL) and Japanese;
a Spanish page (base `es`) with swapped English and Japanese words; a page with
buttons, links and a form (for 16's skip rules and voice control); a dark page; a page with
sticky headers. Manual results are recorded per release in the release PR template from
[30](../30-release-pipeline/SPEC.md).

## Rollout and migration

The checks land before the UI slices ship, so each UI slice is built against them. The
screen-reader and keyboard-mode settings ship in dashboard Settings → Reading with their
defaults. Changelog: "Kotiko's pages and popover work with keyboards and screen readers, and
respect reduced motion."

## Open questions

1. **What should screen readers hear by default?** Recommendation: the target word in its
   own voice (listening practice, no original text in the page's DOM), with the gloss on
   demand and the setting above. Confirm with at least one screen-reader user before release.
2. **Keyboard mode default.** Recommendation: off; the shortcut covers most needs without
   adding hundreds of tab stops.

## Future work

- An accessibility statement page on the docs site ([44](../44-docs-site/SPEC.md)).
- TalkBack and VoiceOver iOS passes with [45](../45-firefox-android/SPEC.md) and
  [51](../51-safari-port/SPEC.md).

## Implementation notes

Built 2026-10-05, stacked on slices 12, 28 and 25. English only
([DECISIONS 2026-10-05](../DECISIONS.md)): the `es` locale runs, acceptance criteria and copy
above are out of scope; new strings are in `_locales/en` only.

Primary sources: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and its Understanding documents
for [2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html),
[2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
[1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html) ("where ellipses
appear as a result of modifying text style properties, the page can still meet the Text
Spacing requirements, so long as the content is still available", for instance on
activation) and [1.4.13](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html);
the WAI-ARIA APG [modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
(Tab and Shift+Tab wrap inside, Esc closes, focus returns to the invoking element),
[grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/), [listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)
(options hold no interactive content) and [tooltip](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
patterns; HTML's [`inert`](https://html.spec.whatwg.org/multipage/interaction.html#the-inert-attribute);
ACT rule [0ssw9k](https://www.w3.org/WAI/standards-guidelines/act/rules/0ssw9k/) (scrollable
content reachable with the keyboard), which axe's `scrollable-region-focusable` implements.

### The audit

**Tool:** axe-core **4.13.0** (an exact dev dependency; 4.14.0 was published the same day and
was passed over), injected through the DevTools protocol so nothing is added to the
extension; plus Kotiko's own checks in `test/helpers/a11y-checks.mjs` for what axe can't
judge (a Tab walk with a focus-indicator and "not obscured" test, 24 px target measurement,
WCAG text-spacing overrides, 320 px reflow, moving animations under reduced motion). Axe ran
with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa` tags, and with
`best-practice` too for the audit.

**Surfaces × themes:** 52 states (popup 14, dashboard 20, welcome 11, privacy policy 1, the
word card and the toast on a light, a dark and a right-to-left page 6), each in light and
dark (listed in `docs/accessibility.md`). The word card's closed shadow root is opened to
axe for the test only (`exposePopover`); axe can't compute contrast inside the top layer, so
the card's colors rest on `contrast.mjs` and `popover-tokens.mjs --check` (its tokens equal
`tokens.css`).

**Counts.** "Before" is this spec file run against the base branch
(`origin/slice/25-plain-errors`, 85940b5) in report mode; one state (the popup's "Add it
yourself") couldn't be reached there, because Esc in the picker's search field only cleared
it. An instance is one rule or problem on one state in one theme.

| | Before | After |
|---|---|---|
| axe, WCAG A/AA (all "serious") | 46 (target-size 18, scrollable-region-focusable 22, color-contrast 2, nested-interactive 2, list 2) | **0** |
| axe, best practice | 76 (landmark-one-main 24 and page-has-heading-one 22, moderate; region 16 and heading-order 8, moderate; label-title-only 4, serious; aria-allowed-role 2, minor) | 8 (region, moderate) |
| Keyboard walk (2.1.1, 2.4.3, 2.4.7, 2.4.11) | 632 | **0** |
| Targets under 24 × 24 (2.5.8) | 389 | **0** |
| Text cut by WCAG text spacing (1.4.12) | 40 | **0** (one documented exception below) |
| Moving animations under reduced motion | 3 tests failing (the popup's switch, the word card with Kotiko's own setting) | **0** |

The 1,183 instances before come from about 25 root causes; the table below lists them.

### Findings and fixes

| Issue | WCAG | Where | Fix (root) | Test |
|---|---|---|---|---|
| "Kotiko is off" dimmed the languages and page sections to 60 % opacity: tertiary text fell under 4.5:1 | 1.4.3 | popup | The dimming is gone; the switch's "Off" and the state line say it | a11y.spec "off, paused…" (axe) |
| Links and link-styled buttons (Retry, Details, Skip, Edit, Privacy policy, the welcome's AI choices, the toast's Undo) were 18-20 px tall | 2.5.8 | everywhere | A `--target-pad` token (`(--target-min - 1em) / 2`) pads `.link` and `.details > summary` to the minimum without moving text; `.link` gets `min-width` when laid out as a box | a11y.spec target-size + axe |
| Small controls: the language chip on an add result (22 px), the "For pages in" and bulk add checkboxes (13 px), the list's row checkboxes (18 px), the support-level badge (16 px), the settings back link (20 px) | 2.5.8 | popup, dashboard | The label or cell is the target (`.page-chip`, `.bulk-check`, `.bulk-control`, the row's check cell with `pointer-events: none` on the box), min-heights on `.lang-chip`, `.base-level`, `.back-link` | a11y.spec target-size |
| The word list's scroll container (`#gridBody`) wasn't focusable, and Chromium made it an extra, unnamed Tab stop | 2.1.1 (ACT 0ssw9k) | dashboard | The grid itself (the list's one Tab stop) is the scroll container, under a sticky header row; virtualisation reads `#grid.scrollTop` | axe on every dashboard state; keyboard walk |
| The add sheet (`aria-modal`) didn't keep Tab inside: focus went to the page behind it; dialogs and the narrow inspector relied on a hand-made Tab loop (it skipped `select`, `textarea` and links) and left the page behind reachable | 2.4.3, 1.3.1 (the `aria-modal` contract) | dashboard | One `openModal`/`closeModal` for every modal layer: everything else `inert` (backdrops and the toasts excepted), Tab wraps over the layer's real tabbables, layers stack, focus returns to where it was | keyboard walk on the add sheet, dialogs and narrow sheet; "focus goes back" assertions |
| A sticky header covered the focused list on narrow screens; the bulk table's sticky header could cover a focused field | 2.4.11 | dashboard | `scroll-padding` on the page, the grid and the bulk table | keyboard walk "dashboard narrow: list" |
| With "Add it yourself" open, the popup's middle region shrank to nothing, so Tab reached chips and switches you couldn't see | 2.4.11 | popup | `.middle` keeps at least 6 rem | keyboard walk "popup: add it yourself" |
| The language picker's listbox options held buttons | 4.1.2 | popup | A plain list of buttons | axe "popup: language picker" |
| Esc in the picker's search box only cleared it | 2.1.2 (APG dialog: Esc closes) | popup | Esc closes the picker from anywhere in it; focus goes back to the chip | a11y.spec (picker closes, chip focused) |
| The restore preview printed "null" twice in its counts list | 1.3.1 (and a visible bug) | dashboard, Your data | Optional lines are filtered before `replaceChildren` | axe "restore preview dialog" |
| The support-level tip vanished when the pointer moved onto it and couldn't be dismissed | 1.4.13 | dashboard settings | A hover bridge; Esc hides it (and does nothing else) until the pointer or focus leaves | a11y.spec "a tip shown on hover…" |
| Transitions on `transform` (the switch's thumb, the skip link, a pressed button, a hovered shelf card) still ran under reduced motion | 2.3.3 (AAA) and 06 §9 | everywhere | Under reduced motion nothing transitions (`transition: none` in `base.css`, for the media query and `data-motion`) | reduced-motion tests (proved by reverting: the switch fails) |
| The word card ignored Kotiko's own "Reduce motion" setting (it rose 4 px) | 06 §9, 27 §4 | pages | `createPopover({ reduceMotion })` sets `.k-reduce`; content.js passes `prefs.motion` | reduced-motion test, "Kotiko's own setting" (proved by reverting) |
| With WCAG text spacing, the shelf's cards cut their language names (fixed height, one line) | 1.4.12, 1.4.10 | dashboard | Cards have a min-height and names wrap; the word in a row keeps its room before the romanization | text-spacing in every `check()` |
| Esc didn't dismiss toasts (06 §10, 27 §3) | 2.2.1 support | dashboard | Esc dismisses the toast focus is in, else the newest when nothing else takes Esc | dom "Esc dismisses a toast" |
| Best practice: no `<main>` in the popup, no `<h1>` on the welcome tab, an `h3` after the `h1` in the inspector, the bulk textarea named only by its placeholder, `role="dialog"` on an `<aside>` | 1.3.1 (best practice) | popup, welcome, dashboard | `<main>` for the popup's two views, the wordmark as `<h1>`, `h2`, an `aria-label`, a `div` | axe in report mode |

Not fixed, best practice only (axe `region`, moderate): the dashboard's banners, selection
bar and open menus sit outside a landmark. Menus are transient popups; the banners sit above
both views' `<main>`. Recorded rather than wrapped in landmarks with no content of their own.

**1.4.12 exception, by design:** the word list's virtualised rows are one line at a fixed
height, so with text spacing a long romanization in a row ends in an ellipsis. Every field
shows whole in the inspector (activation reveals it, as the Understanding document allows).
The check skips `.wrow` and says why.

### Spec sections

- **§1** as the table above; the criteria not listed there were already met (1.3.4, 2.5.3
  by slice 16, 2.5.7 by 13's "Choose a file" and the base list's Up/Down buttons, 3.3.x by
  25, 13 and 22).
- **§2.** Built: Settings → **Reading** (a new section, 21's planned "Reading") with
  "Screen readers hear swapped words as" (the word I'm learning, default; the original
  word; both; `prefs.screenReader`) and "Let me Tab to swapped words" (`prefs.keyboardSwaps`,
  off). The engine (`content/engine.js`) takes `read` and `tab` on a plan item: the word
  shows in `<kotiko-v aria-hidden="true">` and what's read is in a visually hidden
  `<kotiko-sr>` (custom elements, so a site's `span` CSS can't reach them; `user-select:
  none`, so copies don't double), with `<kotiko-l lang>` parts: the original carries the
  language slice 16 resolved for that text (`baseFor`), and "both" joins the parts with
  `Intl.ListFormat` in the interface language. The setting's help says "Sites can read this
  text". Changing either setting re-swaps in place (they're in the swap's signature and in
  `PAGE_PREFS`). The default markup is unchanged (`class,dir,lang,translate`). Chromium's
  tree for "the original word" is the static texts "Come in, ", "please", ", and sit
  down." (checked through the DevTools protocol). Reveal mode (35) isn't built, so the
  override "while reveal mode is on" has nothing to hook yet.
- **§3.** The widget patterns were already in place (20, 21, 19, 22) except the modal layers,
  the picker and toast Esc above. **Deviation:** bulk add's review table stays a native
  `<table>` of labelled form fields, not an APG `role="grid"` with cell navigation: every cell
  is reachable with Tab and named, which meets 2.1.1 and 4.1.2, and a grid would trade
  native form-field behaviour (typing, screen-reader forms mode) for a custom key model.
  Recorded as a decision; revisit if testers ask for it.
- **§4.** Reduced motion as above. Forced colors: the swap's underline uses `currentColor`,
  which forced colors maps to the text's system color (`CanvasText`, or `LinkText` in a
  link), so it stays visible without a rule of its own.
- **§5.** The popover and toast set `lang` on their root to the interface language (19, kept);
  focus never moves on a page except into a card opened from the keyboard. New: turning on
  "Swap words in buttons and menus" shows "Voice control commands that use button names may
  stop working."
- **§6.** `test/e2e/a11y.spec.mjs` (axe, keyboard walk, targets, text spacing, reflow at
  320 px and the popup at 200 %, reduced motion both ways, the word card),
  `test/e2e/screen-reader.spec.mjs`, `test/unit/a11y-lint.test.mjs` (names from `_locales`
  in HTML and scripts, icon-only buttons named, no positive `tabindex`, no `outline: none`
  without a replacement; each rule proved by planting a violation), and `docs/accessibility.md`
  with the manual checklist, linked from the release checklist in `docs/stores.md`.

### Acceptance criteria

| Criterion | Status | Test or reason |
|---|---|---|
| axe: zero A/AA violations on every page and state, both themes | Met in English; `es` out of scope | `test/e2e/a11y.spec.mjs` |
| Every interactive element reachable by Tab or arrows, with a focus ring, never covered | Met | `tabWalk` in every `check()`, including the "removed from Tab but outside an arrow-key widget" check |
| Dashboard and welcome page: no horizontal scroll at 320 px | Met (already true; now guarded) | a11y.spec "no horizontal page scroll at 320 CSS px" |
| Reduced motion: no transform animation anywhere; celebrations show only their message | Met | a11y.spec reduced motion, system and setting (no confetti asserted) |
| NVDA reads a swapped Spanish word in a Spanish voice; Alt+Shift+R reads the gloss in English | **Not done (manual)**: no screen reader in this environment. The markup it depends on (`lang` on the swap and on the gloss, the card as a dialog with focus inside) is tested | `docs/accessibility.md` checklist; popover.spec, screen-reader.spec |
| Spanish page, base `es`: "dog" in an English voice, gloss "perro" in Spanish | **Not done (manual)**; the `lang` tags are tested | screen-reader.spec, content dom test "a Spanish page" |
| The "original word" setting: NVDA reads "thanks"/"perro", the hidden text's `lang` is the page text's; unavailable in reveal mode | Built and tested in the accessibility tree; **NVDA run not done**; reveal mode doesn't exist yet | screen-reader.spec, content dom tests |
| Every accessible name from `_locales`; axe passes in `es` | Met for names (lint); `es` out of scope | `test/unit/a11y-lint.test.mjs` |
| Every toast's Undo has a non-timed equivalent | Met by reading the code (listed in `docs/accessibility.md`); the manual check stays in the release checklist | — |
| No interactive element under 24 × 24 | Met (with WCAG's inline-link exception; the word card measured inside its root) | a11y.spec target-size |
| `docs/accessibility.md` exists and the release checklist links it | Met | `docs/stores.md` |

### Decisions

- axe-core 4.13.0 rather than the 4.14.0 published the same day: a release with hours of
  use is not what a CI gate should start on.
- axe runs through `page.evaluate` rather than `@axe-core/playwright` (one dependency fewer;
  the wrapper pins its own axe version).
- The CI gate is WCAG A/AA rules only; best-practice rules are reported by `A11Y_REPORT`.
- Target size is measured strictly (24 × 24 for every target, not WCAG's spacing
  exception), as §6 asks; the inline-link exception and "the label is the target" are kept.
- Under reduced motion nothing transitions at all (06 §9 allows "or none"): CSS can't drop
  only `transform` from a transition list, so a global rule is the root fix.
- The Reading settings live in a new "Reading" section, the one 21 planned for 31, 16, 37
  and 43, as §2's rollout says.
- The popup at 200 % zoom is tested at 400 × 300 CSS px (Chrome's popup window is at most
  800 × 600 device px).

### Budgets

- Popup bytes at open: 130,633 → **130,857** of 131,072 (+224: the target-size token, the
  `.link`/`summary` padding, `transition: none`, `<main>`, minus the removed dimming). 215
  bytes are left. Own files 74,214 → 74,120 (under 80 KB). `popup-more` 9,968 → 10,233.
- First paint, median of 10 opens, two runs each, same machine (load about 2.5): base 80
  and 84 ms at 4× CPU, 132 and 126 ms at 6×; this branch 80 and 88 ms at 4×, 128 and 124
  ms at 6×. The same within noise.
- Content scripts: 96,796 → 100,159 bytes (the reader variants, the popover's reduce-motion
  class, the focus and hidden-text CSS). `npm run perf` is within every budget.

### Not done

- The manual passes (NVDA, VoiceOver, Orca, Windows High Contrast, 200/400 % zoom by hand,
  voice control) and the sessions with a screen-reader user and a keyboard-only user: the
  checklist is ready in `docs/accessibility.md`.
- The `es` locale runs (DECISIONS 2026-10-05).
- Screenshot diffs of focus rings in the gallery (06's gallery doesn't exist yet); the walk
  uses computed outlines and box-shadows, and a screenshot difference where there are none.
- Firefox: the Playwright setup is Chromium only.
