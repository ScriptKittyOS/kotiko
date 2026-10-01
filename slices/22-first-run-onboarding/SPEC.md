# 22 · First-run onboarding

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [11-local-first-mode](../11-local-first-mode/SPEC.md), [20-popup-redesign](../20-popup-redesign/SPEC.md), [23-starter-packs](../23-starter-packs/SPEC.md); uses [06](../06-design-system/SPEC.md), [14](../14-matcher-engine/SPEC.md), [24](../24-add-flow-safety/SPEC.md), [25](../25-plain-language-errors/SPEC.md) |
| **Unblocks** | [28-privacy-and-store-readiness](../28-privacy-and-store-readiness/SPEC.md) (store screenshots of the first run) |
| **Sources** | [05 S1, S2, S3, S4, §3.1](../../docs/research/05-learner-ux.md); [04 §3 local-first](../../docs/research/04-architecture-release.md); [03 C4, C8, D6](../../docs/research/03-browser-extension.md); [DECISIONS: local first](../DECISIONS.md) |

## Problem

A fresh install is a dead end for anyone not already running the server. The worker syncs on
install (`extension/background.js:52-55`), fails with "Paste your API token to connect."
(`background.js:10`), and the popup shows it in red and opens a Connection panel pointing at
`http://localhost:4747` with a placeholder about `.env` (`popup.js:123-134`,
`popup.html:138-151`). Nothing on any page changes. The README estimates ten minutes of setup
with Elixir installed before the first swapped word ([05 S1](../../docs/research/05-learner-ux.md)).
With local-first mode ([11](../11-local-first-mode/SPEC.md)) and bundled starter packs
([23](../23-starter-packs/SPEC.md)), the first swapped word can arrive in under a minute, with
no account, no key and no network.

## Goals

- A welcome page opens on install and gets a learner from nothing to a swapped word on a real
  page in **3 steps and under 60 seconds** (median, measured in a usability test).
- The learner chooses by what they want ("start now", "look up any word", "use my server"),
  never by infrastructure terms.
- A live preview shows Mira working on the welcome page itself before the learner leaves it.
- Lookups (a model key or a server) are optional and can be set up later without redoing
  anything.
- Firefox users whose page permission is missing are asked for it in plain words.

## Non-goals

- Provider presets, key storage and server connection mechanics: [11](../11-local-first-mode/SPEC.md).
- Pack content and the pack preview component: [23](../23-starter-packs/SPEC.md).
- Migrating existing Slovo server users: [11](../11-local-first-mode/SPEC.md) and
  [04](../04-rename-to-mira/SPEC.md); updates never open the welcome page.
- Injecting into tabs that were open before install: [15](../15-framework-safe-swapping/SPEC.md).
- Mobile first run: [45](../45-firefox-android/SPEC.md).

## User stories

- As someone who just installed Mira from a store, I want to pick Spanish and see Spanish
  words on a real page within a minute, without creating any account.
- As a learner of Basque (no starter pack), I want to add a few words I know and still see
  them work right away.
- As a learner with an OpenRouter account, I want to paste my key during setup and know it
  works before I leave.
- As a self-hoster, I want to connect my existing Mira server from the same page.

## Specification

### 1. When it opens

- `runtime.onInstalled` with `reason === "install"` opens `extension/welcome.html` in a new
  active tab. Not on `update` or `chrome_update`.
- The popup's first-run card ([20 §2 A](../20-popup-redesign/SPEC.md)) opens or focuses it.
- Dashboard → Settings → About → "Show welcome again" opens it with current choices
  prefilled.
- Completion is stored as `onboarding: {completedAt, version: 1}` in `storage.local`. Until
  then the popup shows the first-run card; nothing else is gated on it.

### 2. Layout

One page, one column (max width 640 px), steps visible together and filled in any order.
No "Next" buttons, no wizard.

```
┌──────────────────────────────────────────────────────────────────┐
│ (•) Mira                                                         │
│ Read the web in the words you're learning.                       │
│                                                                  │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ Thanks for the coffee. See you tomorrow, my friend.          │ │  live preview (§4)
│ │ Gracias for the café. See you mañana, my amigo.              │ │
│ │         ┄┄┄┄┄         ┄┄┄┄        ┄┄┄┄┄┄    ┄┄┄┄┄             │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ 1  What are you learning?                                        │
│    [ Search 180 languages                              ]         │
│    [Español] [Français] [Deutsch] [Italiano] [Português]         │
│    [日本語] [中文] [한국어] [Русский] [العربية] [हिन्दी] [Türkçe] … │
│                                                                  │
│ 2  Start with common words                                       │
│    [x] 40 Spanish starter words          Preview ▸               │
│                                                                  │
│ 3  Look up new words                         (optional)          │
│    (•) Later. Starter words and words you type as                │
│        “gato = cat” work without it.                             │
│    ( ) With a free OpenRouter key                                │
│    ( ) Another service, or my own Mira server                    │
│                                                                  │
│                         [ Start reading ]                        │
└──────────────────────────────────────────────────────────────────┘
```

Styling per [06](../06-design-system/SPEC.md): `--canvas` background, step numbers in
`--orange-text` `--t-title`, the preview card at `--r-xl` on `--surface` with `--e-1`, body
`--t-lead`. The page is usable at 320 px width.

### 3. Steps

**Step 0, only when needed: page permission (Firefox).** If
`permissions.contains({origins: ["<all_urls>"]})` is false, a card appears above step 1:
"Allow Mira to read pages. Mira needs this to swap words. Page text never leaves your
browser." with **[Allow]** (calls `permissions.request`). Declining shows: "Without it, Mira
can't swap words. You can allow it later from the popup." ([03 C4](../../docs/research/03-browser-extension.md)).

**Step 1: languages.**
- Chips for languages that have a starter pack, by endonym, then "More languages" which
  reveals the search field. Search matches English names, endonyms and tags across the
  languages known to `Intl.DisplayNames` (filtered to about 180 with a script check from
  [08](../08-language-tags/SPEC.md)).
- Multi-select. Selected chips use the "on" chip style with a check; their accessible name is
  "Spanish, Español, selected".
- No preselection: browser languages say what people read, not what they learn.

**Step 2: starter words.**
- For each selected language with a pack: "[x] {n} {Language} starter words · Preview ▸".
  Preview expands [23](../23-starter-packs/SPEC.md)'s checklist inline; unticking updates the
  count and the preview paragraph.
- For a language without a pack: "No starter words for Basque yet. Add a few you know:" and an
  add box that accepts the inline syntax from [24 §7](../24-add-flow-safety/SPEC.md)
  ("etxea = house"), with the language fixed to that language, saving locally with no model.
- "I have a list" link opens bulk add ([13](../13-bulk-add/SPEC.md)) in the dashboard.

**Step 3: lookups (optional).** Three choices, "Later" selected by default:

- **Later.** Copy as in the wireframe. Nothing to fill in.
- **With a free OpenRouter key.** Expands to:
  1. **[Connect OpenRouter]**, [11](../11-local-first-mode/SPEC.md)'s PKCE flow: one click
     opens OpenRouter's sign-in tab, and the key arrives without copying ("Connected" appears
     here when it does); if 11's spike ships paste-only, this button is absent;
  2. or "Paste a key instead": "Get a free key" (opens OpenRouter's key page in a new tab) and a
     password field "Paste your key" (`autocomplete="off"`, `spellcheck="false"`, paste
     allowed, with a Show toggle);
  3. **[Test]**, which runs one tiny lookup through [11](../11-local-first-mode/SPEC.md)'s
     client and shows a checklist: "✓ Key accepted", "✓ Word lookup works (gracias = thanks)".
     Failures use [25](../25-plain-language-errors/SPEC.md) messages (`key_rejected`,
     `quota_exhausted`, `offline`). Testing is optional; an untested key is saved and tested
     on first use.
- **Another service, or my own Mira server.** Expands to [11](../11-local-first-mode/SPEC.md)'s
  provider list (OpenAI, Anthropic, Gemini, Groq, Ollama, LM Studio, custom) and a "Mira
  server" option with address and access key fields, each with the same Test checklist
  ("✓ Server found", "✓ Access key accepted", "✓ Word lookup works").

**Start reading.** The primary button. Always enabled once at least one language is chosen
and at least one word will exist (pack ticked or a word typed); otherwise it reads "Pick a
language first" and moves focus to step 1 when pressed. Pressing it:

1. imports the ticked pack words through the batch upsert
   ([23](../23-starter-packs/SPEC.md), [07](../07-word-model-v2/SPEC.md)) and saves settings,
   optimistically (the page doesn't wait to change);
2. sets `onboarding.completedAt`;
3. replaces the steps with the done state (§5).

### 4. Live preview

- A bundled English sample of two short sentences per pack theme, chosen so that every
  starter pack covers at least four of its words (checked in pack CI,
  [23](../23-starter-packs/SPEC.md)). Default: "Thanks for the coffee. See you tomorrow, my
  friend." Packs may name a better sample sentence in their metadata.
- The welcome page runs the real matcher module ([14](../14-matcher-engine/SPEC.md)) and
  precedence ([18](../18-language-precedence-and-mixing/SPEC.md)) on the sample with the
  currently ticked words, because content scripts don't run on extension pages. It renders
  the "before" line in `--ink-3` and the "after" line in `--ink` with dotted underlines.
- When the selection changes, changed words play the swap motion
  ([06 §9](../06-design-system/SPEC.md)); under reduced motion they change instantly.
- With several languages, the preview uses the same stable choice pages will use, so it is
  honest.
- Before any language is chosen, the after line shows the Spanish example as a demonstration
  with the caption "For example, in Spanish".
- Hovering or focusing a swapped word in the preview opens the real popover component
  ([19](../19-word-popover/SPEC.md)), so the learner learns how to check a word.
- The preview region is a `<figure>` with `<figcaption>` "Preview"; it is not an
  `aria-live` region (changes would be noisy), and the after line is real text.

### 5. Done state

```
┌──────────────────────────────────────────────────────────────────┐
│ (✓) You're set. 40 Spanish words are ready.                      │
│                                                                  │
│     Mira swaps them on English pages as you read. Point at a     │
│     swapped word, or tap it, to see what it means.               │
│                                                                  │
│     [ Try it on a page ]       Open your words                   │
│                                                                  │
│     Pin Mira to your toolbar:                                    │
│     click the puzzle piece, then the pin next to Mira.           │
└──────────────────────────────────────────────────────────────────┘
```

- **Try it on a page** opens a curated English page chosen for the selected languages' packs
  (pack metadata `tryUrl`; default a Simple English Wikipedia article verified to contain at
  least five pack words). The welcome tab stays open behind it.
- Pin instructions are browser-specific: Chrome and Edge as above; Firefox: "click the
  extensions button, then the gear next to Mira, then Pin to Toolbar".
- One extra line when lookups were set to Later: "To look up any new word, add a key later in
  Settings."
- A line about find-in-page ([03 D6](../../docs/research/03-browser-extension.md)): "Swapped
  words won't show up in Find on page. Turn Mira off for a moment from the popup when you need
  to search."

### 6. Steps and timing

Counted as in [20 §3](../20-popup-redesign/SPEC.md). The welcome tab opening itself is not a
step.

| Path | Steps to the first swapped word on a real page |
|---|---|
| Pick a language with a pack, start | 3 (language, Start reading, Try it on a page) |
| Several languages with packs | 2 + one per extra language |
| Language without a pack | 5 (language, type a word, Enter, Start reading, Try it) |
| With an OpenRouter key | +2 (choose option, Connect OpenRouter, plus OpenRouter's own sign-in) or +3 when pasting (choose option, paste, Test) |
| Firefox without permission | +1 (Allow) |

Target: median time from install to the first swap on the opened page under 60 s across five
first-time participants, with none needing help.

### 7. States

| State | Behavior |
|---|---|
| Loading | Packs are bundled; the page renders complete on first paint. Nothing to wait for. |
| Offline | Everything works except Test, which shows `offline` and "Mira will check the key when you're back"; the key is still saved. |
| Key test fails | The checklist marks the failing line with the [25](../25-plain-language-errors/SPEC.md) message; "Start reading" still works. |
| Pack fails to load (corrupt build) | "Starter words for {Language} couldn't be loaded. You can add your own." and the add box. Logged for CI. |
| Closed before finishing | Nothing saved except words already typed in step 2; the popup keeps the first-run card. |
| Reopened later | Choices prefilled from current state; "Start reading" reads "Save changes"; packs already imported show "Added". |

### 8. Copy

| Element | Copy |
|---|---|
| Title / tagline | "Mira" / "Read the web in the words you're learning." |
| Step 1 | "What are you learning?" |
| Step 2 | "Start with common words" |
| Step 3 | "Look up new words" + "(optional)" |
| Later option | "Later. Starter words and words you type as “gato = cat” work without it." |
| Key option | "With a free OpenRouter key" |
| Other option | "Another service, or my own Mira server" |
| Primary | "Start reading" |
| Done | "You're set. {n} {Language} words are ready." (several languages: "{n} words in {k} languages are ready.") |

### 9. Accessibility

Steps are `<section>`s with headings (`h2`), choice groups are `fieldset`s with legends,
focus starts on the "What are you learning?" heading's search field, and the done state moves
focus to its heading. Everything works with keyboard only; see
[27](../27-accessibility-baseline/SPEC.md).

### 10. Privacy

The welcome page makes no network request unless the learner presses Test or Get a key. No
analytics. The privacy line in step 0 is the same as in the store listing
([28](../28-privacy-and-store-readiness/SPEC.md)).

## Acceptance criteria

- [ ] Installing the extension opens `welcome.html` once; updating does not.
- [ ] Choosing Spanish and pressing Start reading then Try it on a page shows swapped Spanish
      words on the opened page, with no network request other than the page itself
      (Playwright request log), in 3 steps.
- [ ] The preview updates within one frame when a pack word is unticked.
- [ ] A language without a pack can be completed by typing "etxea = house", and "house" is
      swapped on a page afterwards.
- [ ] Test with a mock provider returning 401 shows "OpenRouter didn't accept your key…" and
      Start reading still completes.
- [ ] In Firefox with host permission revoked, step 0 appears and Allow triggers the browser
      prompt.
- [ ] The page is fully usable with keyboard only and at 320 px width; axe-core reports no
      violations.
- [ ] Usability test (five participants, recorded in the PR): median under 60 s to the first
      swap.

## Test plan

- **Unit:** language search (English names, endonyms, tags, diacritics); preview rendering
  with the matcher module and fixture packs.
- **End-to-end (Playwright, Chrome and Firefox):** install flow; each path in §6 with step
  counting; offline; Test success and each failure code; reopen with prefilled state.
- **Manual:** the five-person usability test; screen readers per
  [27](../27-accessibility-baseline/SPEC.md); RTL language selection (Arabic, Hebrew) and CJK
  previews.

## Rollout and migration

New page in the first Mira release. Existing users updating from Slovo don't see it; they
keep their server connection ([11](../11-local-first-mode/SPEC.md)). Changelog: "A welcome
page that gets you reading with your first words in under a minute."

## Open questions

1. **Which page does "Try it on a page" open?** Recommendation: a Simple English Wikipedia
   article per pack (CC BY-SA content, stable, plain English), recorded in pack metadata and
   checked at pack review; never a page that tracks users.
2. **Offer a hosted lookup option?** Recommendation: no, per [DECISIONS](../DECISIONS.md)
   (no shared hosted instance); OpenRouter's free key is the easy path.

## Future work

- A 20-second optional tour of the popup after "Start reading".
- Detect the learner's level from a short quiz to pick a bigger pack.
