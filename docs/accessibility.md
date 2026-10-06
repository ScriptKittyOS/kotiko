# Accessibility

Kotiko changes text on every page a person reads, so its accessibility reaches past its own
windows. This page says what Kotiko promises, what the automated checks cover, and the
manual pass done before each release. The plan behind it is
[slice 27](../slices/27-accessibility-baseline/SPEC.md).

## The promise

- Every Kotiko surface meets **WCAG 2.2 level AA**: the toolbar popup, the dashboard (the
  word list, the inspector, add and bulk add, settings, Your data and its dialogs), the
  welcome tab, the privacy policy, and the word card and toast on web pages.
- Everything can be done with a keyboard alone, with a visible focus ring that is never
  hidden behind something else.
- On other people's pages Kotiko's duty is not to make them worse: a swapped word keeps the
  page's font, size and color (the dotted underline is the only addition), buttons and
  menus aren't swapped unless you ask (so "click Send" keeps working with voice control),
  and focus never moves unless you open a word's card from the keyboard.
- Motion follows your system's "reduce motion" setting, or Kotiko's own (dashboard,
  Settings, Appearance): nothing slides or grows, and there is no confetti.

## What screen readers hear on a swapped word

By default, the word you're learning, in its own language's voice: on an English page,
`<kotiko-w lang="es">gracias</kotiko-w>` is read "gracias" in a Spanish voice where one is
installed, and the reader goes back to its English voice after it. This is listening
practice, and it matches what sighted readers see. The meaning is one command away: **Show
details** (Alt+Shift+R unless you changed it) opens the word's card as a dialog with focus
inside, so the reader reads the meaning (in your language, in its voice), the language's
name and the note. Esc closes it and puts focus back.

Dashboard, Settings, **Reading**:

- **Screen readers hear swapped words as**: the word I'm learning (default), the original
  word, or both. "The original word" puts the page's own word back into the page, hidden
  from sight, tagged with the language Kotiko found that text in (so "thanks" is read in
  English on an English page, "perro" in Spanish on a Spanish page). "Both" reads the word,
  then the original. Either way the page's own text goes back into the page's code, so the
  setting says that sites can read it. (When reveal mode, slice 35, is built, it will
  override this setting while it's on.)
- **Let me Tab to swapped words** (off by default): every swap becomes a Tab stop and Enter
  opens its card. It's off because a long page would get hundreds of stops; Show details is
  the faster path.

Find in page can't find swapped words; "Show the original text on this tab" (slice 33)
restores the page for searching.

## Automated checks (CI)

| Check | Where | What it covers |
|---|---|---|
| axe-core 4.13.0, WCAG 2.0/2.1/2.2 A and AA rules | `test/e2e/a11y.spec.mjs` | Every surface and state in the table below, light and dark: zero violations |
| Keyboard walk | same file, `test/helpers/a11y-checks.mjs` | Tab reaches every control; each shows a focus indicator (outline or ring, else a screenshot difference); none is hidden under a sticky header or bar (2.4.11); modal layers keep Tab inside |
| Target size | same | Every pointer target at least 24 × 24 CSS px (2.5.8), WCAG's inline-link exception aside; the word card's buttons too |
| Text spacing | same | WCAG's 1.4.12 overrides cut no text off, except in the word list's one-line rows (the inspector shows every field whole) |
| Reflow | same | No sideways page scroll at 320 CSS px: dashboard (list, settings, add, bulk add), welcome (arrival, card, preview), privacy policy; the popup at 200 % zoom |
| Reduced motion | same | With the system's preference and with Kotiko's own setting: no animation or transition that moves anything, on the popup, dashboard, welcome tab and word card; no confetti |
| Screen-reader variants and keyboard mode | `test/e2e/screen-reader.spec.mjs`, `test/dom/content.test.mjs` | The accessibility tree for each setting, the hidden text's `lang`, nothing moving on the page, copies unchanged, Tab and Enter on swaps |
| Lint | `test/unit/a11y-lint.test.mjs` | Accessible names, descriptions, tooltips, alt text and placeholders come from `_locales`; icon-only buttons are named; no positive `tabindex`; no `outline: none` without a replacement |
| Contrast tokens | `extension/ui/tools/contrast.mjs` | Every allowed color pair in both themes (text 4.5:1, controls and focus rings 3:1) |

Surfaces and states axe and the keyboard walk cover: popup (first run, no words, words with
two reading languages, focus, add results with a failure and its details, the language
picker, "Add it yourself", off, paused, an unsupported page, no site access, a server
banner, offline, connection settings); dashboard (list, inspector with two meanings and with
a field error, selection bar, toast, menus, the language picker, keyboard shortcuts, no
results, Recently deleted, no words, an unreachable server, the add sheet, bulk add's review,
every settings section, "Delete everything" and the restore preview, and the narrow list and
inspector sheet); welcome (arrival, another language, each AI choice, a refused key,
connected, several results, the card, which language, the meaning form, the celebration and
preview); the privacy policy; the word card and the toast on a light, a dark and a
right-to-left page.

To list everything axe finds, best-practice rules included, without failing:

```sh
A11Y_REPORT=/tmp/a11y.json npx playwright test test/e2e/a11y.spec.mjs
```

## Manual pass before each release

Copy this into the release pull request and fill in the results. Use a fresh profile with
the release build. Add these words first (popup or bulk add): `gracias = thanks` (Spanish,
base English), and for a Spanish-reading profile `dog = perro` (English, base Spanish). The
pages are in `test/fixtures/pages/`; the test fixture server serves them at
`http://127.0.0.1:<port>/pages/<name>` (`node test/helpers/fixture-server.mjs 8123`).

```markdown
### Accessibility (docs/accessibility.md)

| Check | NVDA + Firefox | NVDA + Chrome | VoiceOver + Chrome | Orca + Firefox |
|---|---|---|---|---|
| English page (`popover-light.html`, "Thanks for coming"): the swapped "gracias" is read in a Spanish voice, the rest in English | | | | |
| Alt+Shift+R on it: the card opens as a dialog, the meaning "thanks" is read in an English voice, then the language and the note; Esc returns to the word | | | | |
| Spanish page (`popover-light.html`'s last paragraph, or any Spanish page) with base `es`: "dog" is read in an English voice, the text around it in Spanish; its card reads "perro" in a Spanish voice | | | | |
| Settings → Reading → "The original word": the English page reads "thanks", the Spanish one "perro"; "Both" reads both | | | | |
| "Let me Tab to swapped words": Tab reaches the words in order, Enter opens the card | | | | |
| Popup: add a word, hear the result once (polite), undo it; nothing steals focus | | | | |
| Dashboard: find, edit, pause and delete a word without a mouse; the toast is read, its Undo works; the inspector sheet at narrow width traps focus and Esc returns to the row | | | | |
| Welcome: the first-word flow by keyboard; Kotiko's new lines are read once each | | | | |

- [ ] Windows High Contrast (forced colors): every control, focus ring, switch state, chip state and the swap's underline are visible.
- [ ] Dashboard at 200 % and 400 % zoom: no sideways scroll, nothing cut off, the list scrolls in its own box.
- [ ] Keyboard only: the step counts in slice 20 §3 and slice 21 §13 hold.
- [ ] Voice control (Windows Voice Access or macOS Voice Control) on `controls.html`: "click Send" works with Kotiko on; turning on "Swap words in buttons and menus" shows the warning.
- [ ] Every toast's Undo has an equivalent with no time limit: popup add lines (their own Undo, for as long as the line is listed), dashboard deletes and changes (Ctrl/Cmd+Z, Recently deleted, the inspector), "Don't swap this word" (Settings → Pages → the never-swap list), bulk add (the batch summary's Undo).
```

Before the first public release, at least one screen-reader user and one keyboard-only user
try the welcome tab and a day's use; what they find is filed as issues.
