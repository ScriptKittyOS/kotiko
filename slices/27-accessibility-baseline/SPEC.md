# 27 · Accessibility baseline

| | |
|---|---|
| **Status** | Proposed |
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
