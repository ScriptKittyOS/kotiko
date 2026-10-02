# 19 · Word popover

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [06-design-system](../06-design-system/SPEC.md), [07-word-model-v2](../07-word-model-v2/SPEC.md) (pronunciation fields), [15-framework-safe-swapping](../15-framework-safe-swapping/SPEC.md), [34-pronunciation-audio](../34-pronunciation-audio/SPEC.md) (speak button; built together and shipped in the same release), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (gloss per base, `t()`) |
| **Unblocks** | [35-reveal-mode-and-review](../35-reveal-mode-and-review/SPEC.md), [37-language-colors-and-reading-aids](../37-language-colors-and-reading-aids/SPEC.md), [45-firefox-android](../45-firefox-android/SPEC.md) |
| **Sources** | [DECISIONS 2026-10-02, pronunciation](../DECISIONS.md); [DECISIONS 2026-10-01, base language](../DECISIONS.md); [05 S24, S25, S36, §3.2](../../docs/research/05-learner-ux.md); [03 D2, D3, D4, E4, E5](../../docs/research/03-browser-extension.md); [02 F4](../../docs/research/02-linguistics.md); [01 S6, S8](../../docs/research/01-language-mixing.md) |

## Problem

The moment a learner checks a word is the core learning moment, and today it is a native
tooltip built from the `title` attribute (`extension/content.js:65-71, 96`):

- It appears after about a second, looks different in every browser, can't be styled or
  themed, and can't hold buttons (speak, edit, pause).
- It does nothing on touch screens and can't be reached with a keyboard; screen readers
  handle `title` inconsistently ([03 D2](../../docs/research/03-browser-extension.md)).
- It is a plain string, so right-to-left words, parentheses and "·" can reorder
  ([02 F4](../../docs/research/02-linguistics.md)).
- It leaks: every site can read `span.slovo-w`, `data-en` and `title`
  (`content.js:92-96`) and learn which languages and words the user is studying; session
  replay tools record it ([03 E4](../../docs/research/03-browser-extension.md)).
- Its only pronunciation help is the `romanization`, a model's transliteration with no stress:
  a learner saw "pazhaluysta" for пожалуйста, which is said "pa-ZHAL-sta"
  ([DECISIONS 2026-10-02](../DECISIONS.md)). Nothing says the text came from a model and may be
  wrong.
- The learner has no way to act on a wrong swap from where they see it
  ([05 S25](../../docs/research/05-learner-ux.md)).
- It assumes the reader reads English: the tooltip always shows the English meaning
  (`data-en`), and its text is hard-coded English. A reader of Spanish pages needs to see
  "perro", in a popover whose buttons say "Editar" ([50](../50-ui-localization-and-base-language/SPEC.md)).

## Goals

- One shared popover per page, in a closed shadow root, in the top layer, that opens on
  hover intent, click or tap, and a keyboard command.
- It shows, in this order, the native word with its stress mark, the pronunciation written
  for the reader's base language (07 section 7), the romanization, the language, the gloss
  in the base language of the text the word replaced, note, and the other languages for
  the same base-language form, with correct bidi handling.
- It says when a pronunciation is AI-generated and not checked against a dictionary (49),
  and offers the speak button (34) next to the word.
- Every label, action and toast is in Kotiko's interface language ([50](../50-ui-localization-and-base-language/SPEC.md)),
  and language names come from `Intl.DisplayNames` in that language.
- It offers actions in a fixed slot: speak, edit, pause word, wrong meaning here.
- Nothing about the learner's vocabulary is written into the page DOM beyond the visible
  word itself.
- It never breaks a link, a click or a text selection on the host page.

## Non-goals

- The swap element and the WeakMap that maps it to its entry: [15](../15-framework-safe-swapping/SPEC.md).
  This spec calls that element `<kotiko-w>`; 15 owns its name and attributes.
- Audio: [34](../34-pronunciation-audio/SPEC.md) fills the speak action; it ships in the
  same release.
- What the pronunciation fields contain and how they are generated:
  [07](../07-word-model-v2/SPEC.md) section 7 and [09](../09-shared-word-spec-and-prompt/SPEC.md);
  how they are checked: [49](../49-dictionary-verification/SPEC.md).
- Reveal mode and knew-it buttons: [35](../35-reveal-mode-and-review/SPEC.md) uses the same
  popover with the gloss hidden.
- Grammar fields (part of speech, gender): [36](../36-grammar-and-senses/SPEC.md).
- Mobile tap details inside links on Firefox for Android: [45](../45-firefox-android/SPEC.md).
- Keyboard shortcut registration: [33](../33-context-menu-and-shortcuts/SPEC.md).

## User stories

- As a reader, I want to rest my pointer on a swapped word and see its meaning quickly,
  without the page jumping.
- As a keyboard user, I want to select a swapped word and press a shortcut to see the same
  information and act on it.
- As a phone reader, I want to tap a swapped word to see what it means.
- As a learner who sees "like" swapped in "looks like rain", I want to tell Kotiko this is the
  wrong meaning, right there.
- As a privacy-minded user, I want sites not to see what I'm learning.
- As a learner of Russian, I want to see пожа́луйста with its stress mark, read "pa-ZHAL-sta",
  and press the speaker next to it, so I say it the way people do.
- As a Spanish reader, I want that respelling in Spanish spelling ("ja-ra-SHO" for хорошо),
  and to know when it comes from the AI rather than a dictionary.
- As a reader of Spanish and English pages learning Japanese, I want the popover on a
  Spanish page to say "perro" for 犬, and on an English page to say "dog", with the other
  meaning available underneath.

## Specification

### 1. Content and layout

```
            …come in, пожалуйста, and sit down.
                      ┄┄┄┄┄┄┄┄┄┄  ← the swapped word (dotted underline)
            ┌──────────────▲─────────────────────────┐
            │ пожа́луйста                     (speak) │  native_vocalized (stress mark), else native: --t-word-lg, lang="ru"; speak (34)
            │ pa-ZHAL-sta                            │  pronunciation for this base: --t-lead, --ink; stressed syllable semibold
            │ Slowly: pa-ZHA-lu-sta                  │  pronunciation_careful, only when present: --t-small, --ink-2
            │ pozhaluysta · AI-generated             │  romanization, then the source label (49): --t-small, --ink-3
            │ Russian · русский                      │  language: --t-small, --ink-3 (+ color dot, 37)
            │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
            │ please                                 │  gloss in this page's base: --t-lead, --ink (hidden in reveal mode)
            │ Also: bitte · por favor                │  other candidates (18): --t-small
            │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
            │ Edit   Pause word   Wrong meaning here │  actions: quiet buttons, 32 px tall
            └────────────────────────────────────────┘
```

谢谢 on a Spanish page, interface in Spanish, for a learner whose bases are `es` and `en`
(Mandarin has no stress mark, so the first line is the plain native word):

```
            ┌────────────────────────────────────────┐
            │ 谢谢                           (speak) │
            │ shie⁴-shie                             │  pronunciation from the record with base_lang "es" (Spanish key); tone digit raised
            │ xièxie · Generado por IA               │  romanization (pinyin, dictionary tones) and source label
            │ chino · 中文                           │  language name in the interface language
            │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
            │ gracias                                │  gloss from the record with base_lang "es"
            │ "谢谢你" = gracias a ti.               │  note from the same record
            │ En inglés: thanks                      │  other bases' glosses, secondary (never their pronunciations)
            │ También: спасибо (spasibo)             │
            │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
            │ Editar   Pausar palabra   No es este significado │
            └────────────────────────────────────────┘
```

**Which record.** A swap comes from one word record ([07](../07-word-model-v2/SPEC.md)),
the one whose `base_lang` matches the language of the text it replaced (slices 14 and
16 pick the index by that language). The popover shows that record's `gloss`, `note`,
`sense` and pronunciation fields (they are base side: a Spanish page shows the Spanish
respelling). Other records in the same group (same `lang` and `native_key`, other
`base_lang`) are listed on one secondary line, "In {base name}: {gloss}", in the
`--t-small` style, at most two, each in `<bdi lang="{base_lang}">`. A learner with one base
never sees this line.

- Width: content-sized, min 220 px, max 320 px; padding 16; `--r-lg`; `--e-2`
  ([06](../06-design-system/SPEC.md)). An 8 px arrow points at the word.
- Native word, romanization and each "Also" item are in `<bdi>` with their own `lang`, so
  Arabic, Hebrew and mixed strings never reorder the line. The romanization's `lang` is the
  target with a Latin script subtag (`ru-Latn`, `zh-Latn-pinyin`); the pronunciation's is
  the record's `base_lang`, because it is written to be read in that language.
- "Also" lists the other candidates for the same base-language form in the shown languages, merged
  by identical native string ([01 S6](../../docs/research/01-language-mixing.md): "da ·
  Serbian, Croatian") and including same-language synonyms
  ([01 S8](../../docs/research/01-language-mixing.md): "Also: hogar").
- The note is truncated at three lines with "More" that expands in place.
- Speak (34) is a 32 × 32 icon button at the top end of the native word's line, so the
  learner hears the word next to where they read it; hidden when no matching voice exists.
- The actions row is an extension point: [35](../35-reveal-mode-and-review/SPEC.md) adds
  "I knew it" / "Didn't know" above it; [37](../37-language-colors-and-reading-aids/SPEC.md)
  adds the color dot.

### 1a. The pronunciation block

The first lines of the popover, in this order (fields from [07](../07-word-model-v2/SPEC.md)):

1. **The native word with its stress mark.** `native_vocalized` when the target is Russian,
   Ukrainian or Belarusian and the field is present (пожа́луйста, U+0301 from
   [36](../36-grammar-and-senses/SPEC.md)); otherwise `native`. Arabic and Hebrew vowel marks
   follow 37's vowel-mark mode, not this rule. For Japanese, 36's `reading` follows the word
   in `--t-small` (好き すき). When 49 found that the dictionary stresses the word differently,
   this line shows the dictionary's stressed form.
2. **`pronunciation`**, prominent (`--t-lead`, `--ink`). The capitals are data: the line has
   `text-transform: none`, and the stressed syllable is also set in semibold, so stress
   doesn't depend on letter case alone. Mandarin and Cantonese tone digits render as raised
   numbers (`<sup>`), each with visually hidden text "tone 4" (`popover_tone`).
3. **`pronunciation_careful`**, only when present: "Slowly: pa-ZHA-lu-sta" (`--t-small`,
   `--ink-2`).
4. **`romanization`**, smaller (`--t-small`, `--ink-3`), only when present and different from
   the native word (Latin-script targets have none), followed by the **source label**.

When `pronunciation` is null (a base without a respelling key, or a saved word the one-time
refresh hasn't reached yet, 07 section 8), lines 2 and 3 are left out and nothing says why;
the romanization and the speak button remain. A bilingual reader's other records'
pronunciations are never shown: they are written for a different language.

**Source label.** One short text label, never color or an icon alone, at the end of line 4
(or on its own line when there is no romanization). It describes lines 2 and 3, and is
absent when they are:

| State | When | Label (en / es) |
|---|---|---|
| AI-generated | `pronunciation_source: "model"` and no dictionary check (no dictionary installed, or the dictionary has no stress or tone data for the word) | "AI-generated" / "Generado por IA" |
| Checked | 49's pronunciation check is `verified` or `corrected` | "Checked in Wiktionary" / "Revisado en Wiktionary" (the source's name) |
| Differs | 49's check is `differs` (the dictionary stresses another syllable and the respelling hasn't been regenerated yet) | "AI-generated. Wiktionary stresses it differently." / "Generado por IA. Wiktionary marca el acento en otra sílaba." Line 1 shows the dictionary's stress. |
| The learner's own | `pronunciation_source: "user"` | none |

Until slice 49 ships, every model pronunciation is labelled "AI-generated", which is the
honest default.

### 2. Actions

| Action | What happens | Undo |
|---|---|---|
| Edit | Opens the dashboard at this word with its inspector open ([21](../21-dashboard/SPEC.md)), in a new tab | n/a |
| Pause word | Sets the status of every record in the word's group to paused ([07](../07-word-model-v2/SPEC.md)), so 犬 stops on Spanish and English pages alike; swaps of it on this page revert to the page's own text within 100 ms; a toast in the popover: "Paused 谢谢. It won't be swapped until you resume it." | "Undo" in the popover for 10 s; also resumable in the dashboard |
| Wrong meaning here | Opens a two-choice panel in the popover: "Never swap “like” for 喜欢" (disables that form on the record for this base only; the same word's forms in other bases are untouched) or "Skip it just on this page" (adds the form to a per-page skip set for this page view). | "Undo" for 10 s |

Writes go through background messages (sender-checked,
[26](../26-background-sync-correctness/SPEC.md)); the popover updates optimistically.

### 3. Opening and closing

| Input | Opens | Closes |
|---|---|---|
| Mouse / pen (`pointer: fine`) | Pointer rests on a `<kotiko-w>` for 300 ms (hover intent: the pointer has moved less than 4 px in the last 100 ms) | Pointer leaves both word and popover for 200 ms; Esc; click outside; scroll that moves the word out of view |
| Click on a `<kotiko-w>` not inside a link or button | Immediately, and pinned (stays open while the pointer is away) | Esc; click outside; click on the word again |
| Touch (`pointer: coarse`) | Tap on a `<kotiko-w>` not inside a link or button | Tap outside; Esc on attached keyboards |
| Touch inside a link | Long press (500 ms) opens; `contextmenu` is suppressed only when its target is a `<kotiko-w>` | as above |
| Keyboard | The "Show word" command ([33](../33-context-menu-and-shortcuts/SPEC.md)) with a selection or caret inside a `<kotiko-w>`; or, when keyboard mode is on ([27](../27-accessibility-baseline/SPEC.md)), Enter on a focused `<kotiko-w>` | Esc returns focus to where it was |

- A **click inside a link** never opens the popover and never prevents navigation; hover still
  works there.
- Text selection that starts on a swapped word does not open the popover.
- Moving from the word to the popover keeps it open (the 200 ms grace plus an invisible
  8 px bridge along the arrow).
- Only one popover exists; hovering another word moves it with no close animation.

### 4. Placement

- Below the word, centered on it, flipping above when there is less space below than the
  popover's height plus 8 px; clamped 8 px from viewport edges, the arrow moving to stay over
  the word.
- Multi-line words (wrapped) anchor to the first line box (`getClientRects()[0]`).
- Position updates on scroll and resize in `requestAnimationFrame`; if the word leaves the
  viewport, the popover closes (pinned popovers too).
- The host uses `popover="manual"` so it renders in the top layer above any z-index, overflow
  or transform on the page; where the Popover API is missing (it is supported in Chrome 114+,
  Firefox 125+, Safari 17+), it falls back to `position: fixed; z-index: 2147483647` on the
  host.

### 5. Theme

The popover matches the page, not only the OS: on open, it reads the computed background of
the word's nearest ancestor with a non-transparent background (up to `<html>`), and uses the
dark tokens when that color's relative luminance is below 0.2, else light. If every ancestor
is transparent, it follows `prefers-color-scheme` and `<meta name="color-scheme">`. The
Kotiko theme preference ([06 §2](../06-design-system/SPEC.md)) does not override this: the
popover is part of the page.

### 6. DOM, isolation and privacy

- One host element, `<kotiko-popover>`, created lazily on the first open and appended to
  `document.documentElement` (not `body`, which some sites replace). It carries inline
  `style` with `all: initial !important; position: fixed !important; inset: auto
  !important; ...` so site CSS can't hide or move it, and `translate="no"`.
- A **closed** shadow root holds everything; page scripts can't read its content. Styles come
  from `ui/popover-style.js` ([06 §2](../06-design-system/SPEC.md)) as a constructed
  stylesheet (`adoptedStyleSheets`), with a `<style>` fallback.
- Content is built on demand from the content script's WeakMap entry for the word (from
  [15](../15-framework-safe-swapping/SPEC.md), `KotikoEngine.infoFor(el)`); the page's
  `<kotiko-w>` carries only what 15 puts there: `lang` and `dir` (rendering and screen readers),
  `translate="no"` and `class="notranslate"` (machine translation, [43](../43-copy-print-translate-coexistence/SPEC.md)),
  and `kotiko-*` state classes that carry no word data. No `title`, no `data-*`, no `aria-*`.
- The page can still see the visible foreign word and that a `<kotiko-popover>` exists after
  first use; the privacy policy ([28](../28-privacy-and-store-readiness/SPEC.md)) says so.
- Event listeners are delegated: one `pointerover`, `pointerout`, `pointerdown`, `click`
  and `keydown` listener on `document` in the capture phase, all passive except the
  long-press `contextmenu` suppression. They do nothing unless the target is inside a
  `<kotiko-w>` or the popover.

### 7. Accessibility

- The popover's root is `role="dialog"` with `aria-label="{native}, {language name in the
  interface language}"`. It is non-modal.
- Hover-opened: focus stays on the page; the popover content is not announced (this matches
  how sighted users get it and avoids chatter). Keyboard-opened: focus moves to the popover's
  first action; Tab cycles inside it; Esc closes and returns focus; the dialog is announced.
- Native text carries `lang` so screen readers switch voice; the language name is also
  written out, never conveyed by color.
- Screen readers spell out words in capitals, so the visible respelling is `aria-hidden`
  and paired with visually hidden text from `popover_pron_a11y` in lowercase ("Pronunciation:
  pa-zhal-sta, stress on zhal"), or `popover_pron_a11y_plain` for targets without stress.
  The romanization gets `popover_romanization_a11y`. The dialog's `aria-label` uses plain
  `native`, never `native_vocalized`, whose combining marks some screen readers announce.
- All actions are buttons with visible labels, 32 px tall, at least 24 px apart from each
  other (WCAG 2.5.8); 44 px on coarse pointers.
- Under reduced motion the popover appears with a 120 ms fade and no movement; otherwise a
  180 ms fade and 4 px rise (`--ease-enter`).
- What screen readers hear on the swapped word itself is decided in
  [27](../27-accessibility-baseline/SPEC.md).

### 8. Standalone toast

The same `<kotiko-popover>` host also renders a toast that works with no popover open, for
messages that start outside the page: [33](../33-context-menu-and-shortcuts/SPEC.md)'s
context-menu add ("Learning “dog” in Spanish…", then "dog → perro · Spanish  Undo"; on a
Spanish page with a Spanish interface, "Aprendiendo “perro” en japonés…", then "perro → 犬 ·
japonés  Deshacer"),
keyboard command feedback ("Select a swapped word first."), and pause or undo confirmations.

- The content script accepts `{type: "toast", jobId}` or `{type: "toast", message}` from the
  background only (sender checks per [26](../26-background-sync-correctness/SPEC.md)); for a
  job it renders the job's current line from `addJobs` ([24 §4](../24-add-flow-safety/SPEC.md))
  and follows it as it changes.
- Position: bottom center of the viewport, 16 px from the edge, above page content in the top
  layer; max width 360 px; [06](../06-design-system/SPEC.md)'s toast component.
- `role="status"`, `aria-live="polite"`, never takes focus; 6 s, or 10 s with an action;
  paused while hovered or focused; Esc dismisses; one toast at a time (a new one replaces the
  old).
- Its Undo calls the background's `undo` message for that job and word.
- Created lazily like the popover; if the content script isn't running in the tab, the
  background falls back as 33 describes.

### 9. Copy

Every string is a key in `extension/_locales/<locale>/messages.json`, looked up with
`KotikoI18n.t()` in the content script ([50 §8](../50-ui-localization-and-base-language/SPEC.md)).
Placeholders are named; language names are `Intl.DisplayNames([uiLocale], {type: "language"})`
on the canonical tag ([08](../08-language-tags/SPEC.md)), never the model's `language` field.

| Key | en | es |
|---|---|---|
| `popover_language_line` | {language} · {endonym} (endonym omitted when equal) | {language} · {endonym} |
| `popover_other_base` | In {base}: {gloss} | En {base}: {gloss} |
| `popover_careful` | Slowly: {pronunciation} | Despacio: {pronunciation} |
| `popover_pron_ai` | AI-generated | Generado por IA |
| `popover_pron_checked` | Checked in {source} | Revisado en {source} |
| `popover_pron_differs` | AI-generated. {source} stresses it differently. | Generado por IA. {source} marca el acento en otra sílaba. |
| `popover_pron_a11y` | Pronunciation: {pronunciation}, stress on {syllable} | Pronunciación: {pronunciation}, acento en {syllable} |
| `popover_pron_a11y_plain` | Pronunciation: {pronunciation} | Pronunciación: {pronunciation} |
| `popover_romanization_a11y` | Romanization: {romanization} | Romanización: {romanization} |
| `popover_tone` | tone {n} | tono {n} |
| `popover_also` | Also: {list} | También: {list} |
| `popover_edit` | Edit | Editar |
| `popover_pause` | Pause word | Pausar palabra |
| `popover_wrong_meaning` | Wrong meaning here | No es este significado |
| `popover_never_swap` | Never swap “{form}” for {native} | No cambiar nunca “{form}” por {native} |
| `popover_skip_page` | Skip it just on this page | Saltarla solo en esta página |
| `popover_paused` | Paused {native}. It won't be swapped until you resume it. | {native} en pausa. No se cambiará hasta que la reanudes. |
| `popover_form_removed` | {native} won't replace “{form}” any more. | {native} ya no reemplazará “{form}”. |
| `popover_skipped` | Skipped on this page. | Saltada en esta página. |
| `popover_last_form` | That's the only meaning saved for {native}. Pause the word instead? | Es el único significado guardado para {native}. ¿Prefieres pausar la palabra? |
| `popover_removed` | That word was removed. | Esa palabra se eliminó. |
| `common_undo` | Undo | Deshacer |

The last-form edge case applies when the form is the record's only enabled form in that
base.

### 10. Edge cases

- **Word removed or edited while open:** the popover updates from the new entry, or closes with
  "That word was removed." if gone.
- **Swap inside a contenteditable or form field:** never happens ([16](../16-what-not-to-swap/SPEC.md));
  if a `<kotiko-w>` becomes editable, the popover doesn't open.
- **Iframes:** each frame's content script owns its own popover ([42](../42-frames-and-shadow-dom/SPEC.md)).
- **Fullscreen video:** the top layer handles it; if the word is outside the fullscreen
  element, the popover doesn't open.
- **Print:** the host has `@media print { display: none }`.
- **Very long notes or many candidates:** max height 60 vh, the middle scrolls.
- **Pages with `pointer-events: none` overlays:** hover won't fire; the keyboard command still
  works.

### 11. Performance

- Zero cost until the first interaction except the delegated listeners.
- Opening builds at most ~50 nodes (the pronunciation block included); budget 4 ms on a
  mid-range laptop.
- No `getComputedStyle` calls on hover except for the theme check at open (memoized per
  ancestor for the page view).

## Acceptance criteria

- [ ] No swapped element on any fixture page has a `title` or any `data-*` attribute; the
      only Kotiko elements in light DOM are `<kotiko-w>` and, after first use, `<kotiko-popover>`.
- [ ] `document.querySelector("kotiko-popover").shadowRoot` is `null` from page script.
- [ ] Hovering a swapped word for 300 ms opens the popover; moving into the popover keeps it
      open; leaving both for 200 ms closes it.
- [ ] Clicking a swapped word inside `<a href>` navigates and does not open the popover.
- [ ] Keyboard command on a selected swapped word opens the popover with focus on its first
      action; Esc returns focus to the selection.
- [ ] An Arabic native with a romanization renders in the correct order inside an English
      sentence and inside a Spanish sentence (visual test).
- [ ] On an English page, a base-`en` пожалуйста record with `native_vocalized`,
      `pronunciation`, `pronunciation_careful` and `romanization` from the model shows, top to
      bottom: "пожа́луйста" with the speak button on its line, "pa-ZHAL-sta" (ZHAL semibold),
      "Slowly: pa-ZHA-lu-sta", "pozhaluysta · AI-generated", then the language line.
- [ ] On a Spanish page with the interface in Spanish, a base-`es` хорошо record shows
      "ja-ra-SHO" and "khorosho · Generado por IA"; the learner's `en` record's respelling
      is not shown.
- [ ] A pronunciation the learner edited (`pronunciation_source: "user"`) shows no label; a
      word verified by a fixture dictionary shows "Checked in Wiktionary"; a `differs` word
      shows the dictionary's stress on the first line and the differs label.
- [ ] 谢谢 shows "shyeh⁴-shyeh" with a raised 4 whose accessible text is "tone 4", and
      "xièxie" below it; a Spanish target (gracias, base `en`) shows "GRA-syas" and no
      romanization line; a word with null `pronunciation` shows no respelling lines and no
      label.
- [ ] The accessible text of the pronunciation line is lowercase with the stressed syllable
      named, in English and Spanish.
- [ ] With bases `es` and `en` and a 犬 group with glosses "perro" and "dog", the popover on
      a Spanish fixture page shows "perro" as the gloss and "En inglés: dog" underneath; on an
      English page it shows "dog" and "In Spanish: perro" (interface in each language).
- [ ] With the browser interface in Spanish, every label, action and toast in the popover
      is Spanish, and the language line reads "chino · 中文".
- [ ] On a dark website with a light OS theme, the popover uses dark tokens.
- [ ] Pause word reverts all swaps of that word on the page within 100 ms, pauses every
      record in its group, and survives reload.
- [ ] "Wrong meaning here" → "Never swap" removes the form from the word in storage, with a
      working Undo.
- [ ] Site CSS `* { display: none !important }` on `kotiko-popover` does not hide it
      (fixture).
- [ ] axe-core finds no violations inside the popover in both themes.
- [ ] A `{type: "toast", jobId}` message from the background shows the job's line in the
      page with no popover open, updates when the job finishes, and its Undo works; the toast
      never takes focus.

## Test plan

- **Unit (jsdom):** placement math (flip, clamp, arrow), hover-intent timing with fake timers,
  theme detection from ancestor backgrounds, bidi markup, record choice by text language
  and the other-bases line, `t()` keys present in `en` and `es`; the pronunciation block for
  every row of the source-label table, stress-marked versus plain native per target, tone
  digit markup, semibold stressed syllable, and the accessible text.
- **End-to-end (Playwright):** fixtures with links, buttons, a React app, a dark page,
  `transform`ed containers, `overflow: hidden` parents, a page with hostile CSS, RTL page,
  slice 50's `es-news.html` and `en-news.html` with a two-base word list (including
  пожалуйста, хорошо, 谢谢 and gracias with pronunciations for both bases), a browser launched
  with `--lang=es`; the speak button with 34's stubbed `speechSynthesis`;
  touch emulation for tap and long press; keyboard path; privacy assertions from page
  context.
- **Manual:** NVDA + Firefox, VoiceOver + Safari later ([51](../51-safari-port/SPEC.md)),
  TalkBack + Firefox for Android.

## Rollout and migration

Ships with [15](../15-framework-safe-swapping/SPEC.md)'s element change, replacing `title`
tooltips in one release, together with 34's speak button. The `cursor: help` hint stays as 15
defines it. Saved words show their pronunciation as 07's one-time refresh reaches them; until
then the popover shows the romanization alone. Changelog: "Point at, tap, or use a shortcut on
any swapped word to see its meaning, how to say it, hear it, and fix it."

## Open questions

1. **Hover delay.** Recommendation: 300 ms, tunable in settings later if learners ask; shorter
   delays fire while the pointer passes over text.
2. **Show other bases' glosses at all?** Recommendation: yes, one small line, only for
   learners with more than one base; it costs nothing for everyone else and helps a
   bilingual reader connect the two meanings.
3. **Edit inline or in the dashboard?** Recommendation: dashboard. Editing every field inside a
   320 px popover on someone else's page is cramped and risky; the popover keeps the two most
   common fixes (pause, wrong meaning) inline.

4. **Show the careful form always, or behind a tap?** Recommendation: always, as one small
   line, only for the few words that have one; a tap target for one line of text costs more
   than it saves.
5. **Where does the source label sit?** Recommendation: at the end of the romanization line,
   which keeps the pronunciation line clean; it moves to its own line for Latin-script
   targets.

## Future work

- "Words on this page" list in the popup for touch users who can't long-press in links.
- Show the sentence the word came from ([07](../07-word-model-v2/SPEC.md) `source_text`) in
  the popover.

## Implementation notes

*2026-10-02, first build, together with [34](../34-pronunciation-audio/SPEC.md)'s speak
button and the part of [15](../15-framework-safe-swapping/SPEC.md) this slice needs, against
today's backend (the legacy `GET /api/words`, one base language, `en`). Requirements above
are unchanged; this records what exists now and what waits for other slices.*

**Built.**

- Files: `extension/content/popover.js` (host, events, placement, theme, toast),
  `extension/lib/word-card.js` (what the card shows, as data: headword, syllables with
  stress and tones, label, Also, other bases), `extension/ui/popover-style.js` (the
  stylesheet as a string) with `extension/ui/tools/popover-tokens.mjs`, which copies the
  tokens from `tokens.css` and the `:lang()` font rules from `base.css` into it (`--check`
  runs in the unit tests; this is 06 §2's token-equality check). Tokens are in px there:
  in a shadow root rem follows the web page's root font size. A `speaker` icon joined
  `icons.js`. Content scripts load `lib/i18n.js`, `lib/speak.js`, `lib/word-card.js`,
  `ui/icons.js`, `ui/popover-style.js` and `content/popover.js` before `content.js`.
- §6: one `<kotiko-popover>` on `<html>`, created on first use, inline `all: initial
  !important` style (a fixture page's `kotiko-popover { display: none !important }` loses),
  `translate="no"`, `popover="manual"` where supported (hidden while neither the card nor
  a toast shows, re-shown on each open so it sits above the page's own top-layer
  elements), a closed shadow root, `adoptedStyleSheets` with a `<style>` fallback.
  Delegated `pointerover`, `pointerout`, `pointerdown`, `click`, `keydown` and
  `contextmenu` listeners on `document`, capture phase. `click` is not passive, only so
  the click a long press inside a link leaves behind can be cancelled.
- §1 and §1a: the order, `native_vocalized` for ru/uk/be, Japanese `reading` after the
  word, the respelling with the stressed syllable semibold and tone digits as `<sup>`, the
  careful form, the romanization (`ru-Latn`, `zh-Latn-pinyin`) and every row of the
  source-label table (a `differs` word shows the dictionary's stressed form on the first
  line), the language line from `Intl.DisplayNames`, the gloss, the note (clamped to three
  lines with "More" when it is over 120 characters; a length heuristic, not a measurement),
  the other bases' line (same `lang` and `native`, other `base_lang`, at most two; nobody
  sees it yet because the legacy route returns base `en` only) and "Also", merged by
  identical native. Accessible text per §7: the visible respelling and romanization are
  `aria-hidden` with lowercase visually hidden text, tones read as "tone 4", and the dialog
  is named by the plain `native`. The orange dotted underline under the word in the card
  repeats the page's mark (06 §1 rule 2).
- §3: hover intent (300 ms, under 4 px in the last 100 ms), 200 ms grace plus a 12 px
  invisible bridge, click pins, a second click or a click outside closes, tap, long press
  (500 ms) inside links with its context menu and click suppressed, Esc, Enter on a focused
  word, selections that start on a word don't open it, editable and outside-fullscreen
  words don't open. Keyboard: 33's `reveal-word` command is registered now (Alt+Shift+R,
  `cmd_reveal_word`); the background sends `{type: "reveal-word"}` to the tab and the card
  opens on the selected or focused word with focus on its first action (the speak button,
  or the card when there is none), Tab cycles inside, Esc returns focus and the selection.
  Nothing selected: the toast "Select a swapped word first." **S** speaks while the card
  is open (not while typing in a page field).
- §4 placement (below, centered, flipped above, clamped 8 px, the arrow follows the word;
  first line box; rAF on scroll and resize; closes when the word leaves the viewport).
  The word-to-card gap is 10 px (the 6 px arrow plus air).
- §5 theme from the nearest ancestor background (alpha under 0.5 counts as transparent);
  all transparent: dark only when the page's `color-scheme` allows dark and the system
  prefers it. Memoized per element, reset when the system preference changes.
- §8 toast: `{type: "toast", message}` from the background only (a sender of this
  extension with no tab), bottom center, `role="status"`, 6 s, paused while hovered or
  focused, Esc dismisses, one at a time. "That word was removed." when the open word is
  deleted; an edited word re-renders in place (§10).
- Data: the server's legacy JSON now carries `base_lang`, `native_vocalized`,
  `pronunciation`, `pronunciation_careful` and `pronunciation_source`;
  `lib/validate-words.js` accepts and caps them (and `reading` and
  `verification.pronunciation` for later), dropping a bad field, never the word. A
  `native_vocalized` that isn't `native` with marks is dropped.
- Copy: the §9 keys the card uses, plus `popover_more`, `popover_dialog_label`,
  `speak_label`, `toast_select_word_first` and `cmd_reveal_word`, in `en` and `es`. **The
  Spanish strings are pending native review** (50 §9).
- Tests: `test/unit/word-card.test.mjs`, `test/unit/popover-style.test.mjs`,
  `test/unit/validate-pronunciation.test.mjs`, `test/dom/popover.test.mjs` (content,
  label states, accessible text, hover, leave, click, links, selection, tap, long press,
  Esc, keyboard and the command, toast and its sender check, speech, theme, placement,
  words changing, the actions slot), `test/e2e/popover.spec.mjs` (hover in the top layer
  over hostile CSS, privacy from page scripts, click and links, touch tap and long press,
  the command with focus and Esc, the dark page, speech, Spanish interface). Screenshots
  for review: `node test/visual/popover-screenshots.mjs [outDir]`. Fixture pages
  `popover-light.html` and `popover-dark.html`; fixture words in
  `test/helpers/popover-words.mjs`. The e2e reads the closed root through the DevTools
  protocol (`test/helpers/closed-shadow.mjs`).

**Not built yet.**

- **Actions (§2).** Edit, Pause word and Wrong meaning here have no backend in the
  extension yet (it talks to the legacy routes only: no `PATCH` client for 07's status and
  forms, no dashboard for Edit). The slot exists (`createPopover({ actions })`, tested
  with a stand-in action) and is hidden while empty; their copy keys wait for them.
  "Skip it just on this page" needs no backend and can be wired when the two-choice panel
  lands.
- The `{type: "toast", jobId}` form and its Undo ([24](../24-add-flow-safety/SPEC.md)'s
  `addJobs`), and 33's context-menu toasts.
- 27's keyboard-mode setting that puts `tabindex` on swaps (Enter already opens a focused
  word), and the screen-reader variants of 27 §2.
- [37](../37-language-colors-and-reading-aids/SPEC.md)'s color dot and vowel-mark mode,
  [35](../35-reveal-mode-and-review/SPEC.md)'s review buttons,
  [36](../36-grammar-and-senses/SPEC.md)'s grammar fields; `reading` shows when a record
  has it, but the server doesn't store it until 36.
- The gloss per page base and the other-bases line in practice: one base (`en`) until
  [50](../50-ui-localization-and-base-language/SPEC.md) and the v1 sync; the interface
  follows the browser's language (no override yet).
- axe-core in Playwright (not a dependency yet), the RTL and Arabic-in-a-Spanish-sentence
  visual tests, the React and `transform`/`overflow` fixtures beyond `popover-light.html`'s
  clipped card, 50's `es-news.html`/`en-news.html` two-base fixtures, and the manual
  NVDA, VoiceOver and TalkBack passes.
- Frames: the content script runs in the top frame only (no `all_frames`), so there is no
  card inside iframes until [42](../42-frames-and-shadow-dom/SPEC.md).
- The privacy policy line about `<kotiko-popover>` ([28](../28-privacy-and-store-readiness/SPEC.md)).
