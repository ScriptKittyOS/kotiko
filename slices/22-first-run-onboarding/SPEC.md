# 22 · First-run onboarding

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [11-local-first-mode](../11-local-first-mode/SPEC.md), [20-popup-redesign](../20-popup-redesign/SPEC.md), [24-add-flow-safety](../24-add-flow-safety/SPEC.md); uses [06](../06-design-system/SPEC.md), [08](../08-language-tags/SPEC.md), [09](../09-shared-word-spec-and-prompt/SPEC.md), [13](../13-bulk-add/SPEC.md) (its line parser and, from the done state, its sheet), [14](../14-matcher-engine/SPEC.md), [18](../18-language-precedence-and-mixing/SPEC.md), [19](../19-word-popover/SPEC.md), [25](../25-plain-language-errors/SPEC.md), [32](../32-page-coverage-and-celebrations/SPEC.md) (confetti) |
| **Unblocks** | [28-privacy-and-store-readiness](../28-privacy-and-store-readiness/SPEC.md) (store screenshots of the first run) |
| **Sources** | Maintainer: "prompt the user to talk to the LLM and ask how to teach the word hello in whatever language, and then it can say congrats you got your first word with confetti, or some other word, let the user choose. It will be their favorite, they will get a reward and remember it even if it is the only one they see."; [DECISIONS: every word is one the learner chose; own key on a full page](../DECISIONS.md); [05 S1, S2, S3, §3.1](../../docs/research/05-learner-ux.md); [04 §3 local-first](../../docs/research/04-architecture-release.md); [03 C4, C8, D6](../../docs/research/03-browser-extension.md) |

## Problem

A fresh install is a dead end for anyone not already running the server. The worker syncs on
install (`extension/background.js:52-55`), fails with "Paste your API token to connect."
(`background.js:10`), and the popup shows it in red and opens a Connection panel pointing at
`http://localhost:4747` with a placeholder about `.env` (`popup.js:123-134`,
`popup.html:138-151`). Nothing on any page changes. The README estimates ten minutes of setup
with Elixir installed before the first swapped word ([05 S1](../../docs/research/05-learner-ux.md)).

With local-first mode ([11](../11-local-first-mode/SPEC.md)) the server is optional, but a
new learner still has no words, and Mira will never pick words for them
([DECISIONS](../DECISIONS.md)): every word is one the learner chose. So the first run has
one job: help the learner choose their first word, make that moment feel like a reward, and
show the word working, in under a minute.

## Goals

- The welcome tab is a short conversation, not a form: connect your own AI, ask for the first
  word you'd love to learn in your own words, confirm it, celebrate it, see it swap.
- The learner chooses both the word and the language. Nothing is added to their vocabulary
  until they press "Make it my first word".
- First word celebrated in **4 steps plus OpenRouter's own sign-in** with an OpenRouter
  account (one-click connect), and in **3 to 4 steps with no key at all** when the learner types the word with its meaning
  ("hola = hello"), which Mira parses locally with no model and no network.
- A live preview shows the learner's own word swapped into an English sentence by the real
  matcher, before they leave the page.
- The key is entered on this full page, never in the popup
  ([DECISIONS](../DECISIONS.md), [11 §3](../11-local-first-mode/SPEC.md)).
- Skipping is always possible, and nothing about setup has to be redone later.
- Firefox users whose page permission is missing are asked for it in plain words.

## Non-goals

- Provider presets, key storage, the PKCE connect flow and server connection mechanics:
  [11](../11-local-first-mode/SPEC.md).
- Suggesting words to learn, or offering ready-made lists. Never
  ([DECISIONS](../DECISIONS.md)). "hello" appears only as an example of what to ask.
- Adding a list during first run: the done state links to bulk add
  ([13](../13-bulk-add/SPEC.md)), which has its own review step.
- Page milestones and the general celebration rules: [32](../32-page-coverage-and-celebrations/SPEC.md).
- Migrating existing Slovo server users: [11](../11-local-first-mode/SPEC.md) and
  [04](../04-rename-to-mira/SPEC.md); updates never open the welcome page.
- Injecting into tabs that were open before install: [15](../15-framework-safe-swapping/SPEC.md).
- Mobile first run: [45](../45-firefox-android/SPEC.md).

## User stories

- As someone who just installed Mira, I want to ask "how do you say hello in Japanese", see
  the answer, and keep it as my first word, so that I start with a word I care about.
- As a learner who already knows a word, I want to type "hola = hello" and have it work right
  away, without creating any account or key.
- As a learner with an OpenRouter account, I want to connect it with one click on this page
  and know it works before I ask for my word.
- As a learner who asked for one word and got something I didn't expect, I want to try again
  before anything is saved.
- As a self-hoster, I want to connect my existing Mira server from the same page.
- As someone who doesn't want a tour, I want to skip it and use the popup.

## Specification

### 1. When it opens

- `runtime.onInstalled` with `reason === "install"` opens `extension/welcome.html` in a new
  active tab. Not on `update` or `chrome_update`.
- The popup's first-run card ([20 §2 A](../20-popup-redesign/SPEC.md)) opens or focuses it.
- Dashboard → Settings → About → "Show welcome again" opens it with the current connection
  shown as connected.
- State is stored as `onboarding: {completedAt, skipped, version: 2}` in `storage.local`.
  `completedAt` is set when the first word is saved (anywhere, so a learner who adds a word in
  the popup first is also done) or when the learner presses "Skip for now". Until then the
  popup shows the first-run card; nothing else is gated on it.

### 2. Layout

One page, one column (max width 640 px). Mira's lines appear one under another like a short
conversation, each with the small kitten avatar ([05](../05-brand-identity/SPEC.md)); the
learner's parts are controls, not chat bubbles. Both the AI step and the word box are visible
from the start, so a learner who already knows a word never has to connect anything first.
No "Next" buttons, no wizard.

**A. On arrival (nothing connected, no words):**

```
┌──────────────────────────────────────────────────────────────────┐
│ (•) Mira                                          Skip for now   │
│                                                                  │
│ (=^.^=) Hi, I'm Mira. I swap English words on the pages you      │
│         read for words you're learning, one word at a time.      │
│                                                                  │
│ (=^.^=) First, connect your own AI. It looks words up for you.   │
│         [ Connect OpenRouter (free) ]                            │
│         Paste a key instead · Another service or my own model ·  │
│         My Mira server                                           │
│                                                                  │
│ (=^.^=) What's the first word you'd love to learn?               │
│         Ask in your own words, in any language.                  │
│         ┌──────────────────────────────────────────────┐         │
│         │ how do you say hello in Japanese             │ [Ask]   │
│         └──────────────────────────────────────────────┘         │
│         [ Try “hello” ]                                          │
│         No AI yet? Type the word and its meaning,                │
│         like “hola = hello”. That works without one.             │
└──────────────────────────────────────────────────────────────────┘
```

The placeholder cycles every 4 s through "how do you say hello in Japanese", "hola", "dog in
Arabic" and "merci = thank you" (static under reduced motion: the first one). It is a
placeholder only; the box starts empty. **Try “hello”** puts the text "how do you say hello
in " into the box, moves focus there with the caret at the end, and saves nothing; the
learner types the language.

Styling per [06](../06-design-system/SPEC.md): `--canvas` background, Mira's lines in
`--t-lead` on `--canvas`, controls on `--surface`, the word card (§5) at `--r-xl` on
`--surface` with `--e-1`. The page is usable at 320 px width.

### 3. Step 0, only when needed: page permission (Firefox)

If `permissions.contains({origins: ["<all_urls>"]})` is false, a card appears above Mira's
first line: "Allow Mira to read pages. Mira needs this to swap words. Page text never leaves
your browser." with **[Allow]** (calls `permissions.request`). Declining shows: "Without it,
Mira can't swap words. You can allow it later from the popup."
([03 C4](../../docs/research/03-browser-extension.md)).

### 4. Connect your AI

The learner's own key or model, per [DECISIONS](../DECISIONS.md) and
[11](../11-local-first-mode/SPEC.md). This is one of the two places a key is ever typed (the
other is the dashboard's settings, [21](../21-dashboard/SPEC.md)).

- **Connect OpenRouter (free)**, the primary button: [11 §4](../11-local-first-mode/SPEC.md)'s
  PKCE flow. One click opens OpenRouter's sign-in tab; the key arrives without copying. If
  11's spike ships paste-only, this button is absent and "Paste a key" becomes the primary.
- **Paste a key instead** expands: "Get a free key" (opens OpenRouter's key page in a new tab)
  and a password field "Paste your key" (`autocomplete="off"`, `spellcheck="false"`, paste
  allowed, with a Show toggle). Pasting saves the key through `secrets.set`
  ([11 §3](../11-local-first-mode/SPEC.md)) and runs one tiny check through 11's client; no
  Save button.
- **Another service or my own model** expands [11 §4](../11-local-first-mode/SPEC.md)'s
  provider list (OpenAI, Anthropic, Gemini, Groq, Ollama, LM Studio, custom), each with its
  key field or address and the same automatic check.
- **My Mira server** expands address and access key fields, checked the same way ("Server
  found", "Access key accepted").

**Connected** replaces the step with one line:

```
│ (=^.^=) ✓ Connected to OpenRouter, free models.     Change       │
```

**Check failed** keeps the field and shows the [25](../25-plain-language-errors/SPEC.md)
message under it (`key_rejected`: "OpenRouter didn't accept your key…", `offline`, and so
on). The key stays saved, so a learner who is offline can still finish; Mira checks again on
first use.

**Waiting for OpenRouter** (the sign-in tab is open): "Waiting for OpenRouter… Finish signing
in on the other tab." with "Paste a key instead" still available. If the learner returns
without connecting, nothing changes and the button works again.

### 5. Ask for the first word

The box accepts anything the popup's add box does, with add-box semantics
([09](../09-shared-word-spec-and-prompt/SPEC.md): the add box means add): a question ("how do
you say hello in Japanese"), a word in any language ("hola"), an English word with a language
("dog in Arabic"), or a word with its meaning ("hola = hello", "es: hola = hello",
"спасибо (spasibo) = thanks"). Enter or **Ask** submits. One entry at a time.

**Nothing is saved yet.** The welcome page creates a [24](../24-add-flow-safety/SPEC.md) add
job flagged `preview: true`: the background looks up and validates exactly as for any add,
then stops before the store write and puts the job in 24's `needs_choice` state with its
candidates, whatever their count (for this job, `CONFIRM_AT` is 1). With a Mira server doing
lookups, this uses the `preview` flag on 07's add route that
[24](../24-add-flow-safety/SPEC.md)'s Open question 2 recommends; it is a prerequisite for
the server option on this page.

**Lines with a meaning never touch the model.** "native = english" (and the other one-line
forms) is parsed locally by [13](../13-bulk-add/SPEC.md)'s `extension/bulk/parse.js`, as the
add box does ([24 §7](../24-add-flow-safety/SPEC.md)). This works with no key, no account and
no network, so a learner can see a swap within a minute before setting up anything. The
language comes from, in order: a prefix ("es: hola = hello"); the native word's script when
exactly one language in [08](../08-language-tags/SPEC.md)'s `languages.json` uses it by
default (Hangul is Korean, kana is Japanese, Thai, Georgian, Armenian, Greek, and so on); or
the learner, in one tap (state D below).

**States of the ask step:**

**B. Looking up:**

```
│ (=^.^=) Looking up “how do you say hello in Japanese”…           │
│         ┌──────────────────────────────────────────────┐         │
│         │                                              │ [Ask]   │
│         └──────────────────────────────────────────────┘         │
```

The box clears and stays usable; a new entry replaces the pending one. Deadline and retries
are [10](../10-llm-client-resilience/SPEC.md)'s add-box values.

**C. The word card (one result):**

```
│ (=^.^=) Here it is:                                              │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │  こんにちは                                                   │ │
│ │  konnichiwa                                                  │ │
│ │  hello  ·  Japanese                                          │ │
│ │                                                              │ │
│ │  [ Make it my first word ]      Try another                  │ │
│ └──────────────────────────────────────────────────────────────┘ │
```

Native in `--t-specimen` (the display role, [06 §5](../06-design-system/SPEC.md)) with `lang` and `dir="auto"` ([17](../17-casing-and-script-display/SPEC.md)
fonts), romanization when present, then the English forms and the language name. **Try
another** discards the card and returns focus to the box with the learner's text restored.

**C2. Several results** (the model returned 2 to 5 words, [09](../09-shared-word-spec-and-prompt/SPEC.md)'s
cap):

```
│ (=^.^=) I found a few. Which one is yours?                       │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │  (•) こんにちは  konnichiwa   hello · Japanese                │ │
│ │  ( ) もしもし    moshi moshi  hello (on the phone) · Japanese │ │
│ │                                                              │ │
│ │  [ Make it my first word ]      Try another                  │ │
│ └──────────────────────────────────────────────────────────────┘ │
```

A radio group, first option selected. Only the chosen word is saved; the others are
discarded. One first word, chosen by the learner.

**D. Which language?** (a "native = english" line whose script doesn't name the language):

```
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │  hola                                                        │ │
│ │  hello  ·  Which language is this?                           │ │
│ │  [Español] [Português] [Italiano] [Français] [Deutsch] …     │ │
│ │  [ Search languages                     ]                    │ │
│ │                                                              │ │
│ │  [ Choose a language first ]    Try another                  │ │
│ └──────────────────────────────────────────────────────────────┘ │
```

Chips are the most-learned languages written in that script (a static list in 08's data, by
endonym), no preselection; the search covers about 180 languages (English names, endonyms
and tags). Picking one turns the card into state C and the button into "Make it my first
word".

**E. A bare word or question with no AI connected:**

```
│ (=^.^=) To look up “hola”, connect your AI above.                │
│         Or tell me what it means:                                │
│         hola = [ hello                    ]  [ Add ]             │
```

The meaning field is a one-line form; Add builds the card locally (state C, or D when the
language is needed). If the learner connects instead, the lookup runs as soon as the key is
saved (24's `lookup_not_set_up` waiting rule), with no retyping.

**F. Lookup failed:** the [25](../25-plain-language-errors/SPEC.md) message in Mira's line,
then the same "Or tell me what it means" form as E. Codes: `key_rejected`,
`quota_exhausted`, `rate_limited`, `offline`, `lookup_timeout`, `model_unavailable`. For
`no_word_found`: "I couldn't find a word in that. Try “hello in Japanese”, or type it as
“hola = hello”." For `rejected_english`: "That looks like English. Which language would you
like it in? Try “hello in Spanish”."

### 6. Make it my first word

Pressing **Make it my first word** (one step):

1. saves the chosen word through [24](../24-add-flow-safety/SPEC.md)'s add path (07's
   merge-not-overwrite add, idempotent by the job's `client_request_id`), with `origin: "add"`
   for a looked-up word or `"manual"` for a "native = english" one
   ([07](../07-word-model-v2/SPEC.md));
2. sets `onboarding.completedAt`;
3. claims the first-word milestone (`vocab:first`, [32 §3](../32-page-coverage-and-celebrations/SPEC.md))
   and shows the celebration (§7).

### 7. Celebration

```
┌──────────────────────────────────────────────────────────────────┐
│        .  *    ▪        ·   ▪      •    ▪   ·       *  .         │  confetti (motion allowed)
│ (=^.^=) Congrats, you got your first word!                       │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │  こんにちは  konnichiwa                                       │ │
│ │  hello · Japanese                                            │ │
│ └──────────────────────────────────────────────────────────────┘ │
│         Turn off celebrations                                    │
└──────────────────────────────────────────────────────────────────┘
```

- Confetti is [32 §5](../32-page-coverage-and-celebrations/SPEC.md)'s renderer, full viewport
  on the welcome page: same particles, palette, 1.6 s duration, no sound, nothing loops, Esc
  or any click or key stops it. It fires once in a lifetime (`celebrations.done["vocab:first"]`).
- **Reduced motion** (`prefers-reduced-motion: reduce` or Mira's "Reduce motion" setting): no
  confetti; the message and card fade in over 120 ms. This is the full calm alternative.
- Celebrations are on by default ([DECISIONS](../DECISIONS.md)). **Turn off celebrations**
  sets `prefs.celebrations = false` and shows "Off. You can turn them back on in Settings."
  A learner who turned them off before saving their first word gets the message without
  confetti.
- If [32](../32-page-coverage-and-celebrations/SPEC.md) hasn't shipped yet, this slice ships
  the confetti renderer and `prefs.celebrations` exactly as 32 §5 and §8 specify, and 32
  reuses them.

### 8. Live preview and what's next

Directly below the celebration, without another step:

```
│ (=^.^=) This is how you'll meet it:                              │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ She said hello and waved from the bus.                       │ │
│ │ She said こんにちは and waved from the bus.                    │ │
│ │          ┄┄┄┄┄                                     Edit       │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ (=^.^=) From now on, こんにちは shows up on English pages         │
│         wherever “hello” does. Point at it, or tap it, to see    │
│         what it means. Even if it's the only one you see,        │
│         it's yours.                                              │
│                                                                  │
│         [ Try it on a page ]   Add another word   Open your words│
│                                                                  │
│         Have a list already? Add it in one go.                   │
│         Pin Mira: click the puzzle piece, then the pin next      │
│         to Mira.                                                 │
│         Swapped words won't show up in Find on page. Turn Mira   │
│         off for a moment from the popup when you need to search. │
└──────────────────────────────────────────────────────────────────┘
```

**The sample sentence.** `extension/welcome/sentences.json` holds about 1,000 short, plain
English sentences (6 to 12 words) written for Mira, covering every word in
[09](../09-shared-word-spec-and-prompt/SPEC.md)'s list of about 3,000 common English words at
least once (checked in CI). The page picks the shortest sentence the real matcher
([14](../14-matcher-engine/SPEC.md)) finds one of the word's English forms in, so inflections
and multi-word forms count. If none matches (a rare word), it uses "Today I learned the word
{english}." The sentences are English text for the preview, never words to learn.

- The welcome page runs the matcher module and precedence
  ([18](../18-language-precedence-and-mixing/SPEC.md)) itself, because content scripts don't
  run on extension pages. The "before" line is `--ink-3`, the "after" line `--ink` with the
  dotted underline; the swapped word plays [06 §9](../06-design-system/SPEC.md)'s swap motion
  (instant under reduced motion).
- Hovering, tapping or focusing the swapped word opens the real popover
  ([19](../19-word-popover/SPEC.md)), so the learner learns how to check a word.
- **Edit** turns the before line into a text field; the learner can type any English
  sentence and the after line updates as they type (one frame).
- The preview region is a `<figure>` with `<figcaption>` "Preview"; it is not an `aria-live`
  region, and the after line is real text.

**Try it on a page** opens Simple English Wikipedia's search for the word's first English
form (`https://simple.wikipedia.org/w/index.php?search={english}&fulltext=1&ns0=1`), whose
result snippets contain the word several times. The button's description reads "Opens a
Simple English Wikipedia search for “hello”." The welcome tab stays open behind it.

**Add another word** returns to the box (no celebration for later words; 32's vocabulary
milestones take over). **Open your words** opens the dashboard ([21](../21-dashboard/SPEC.md)).
**Add it in one go** opens bulk add ([13](../13-bulk-add/SPEC.md)) in the dashboard, where
every row is reviewed before saving. Pin instructions are browser-specific: Chrome and Edge as
above; Firefox: "click the extensions button, then the gear next to Mira, then Pin to
Toolbar". When no AI is connected, one more line: "To look up words you don't know yet,
connect your AI in Settings." ([21](../21-dashboard/SPEC.md)).

### 9. Skip for now

The header link sets `onboarding = {completedAt: now, skipped: true}` and closes the tab. The
popup then shows its empty state ([20 §2 B](../20-popup-redesign/SPEC.md)) and the add box
works as usual. "Show welcome again" brings the page back.

### 10. Reopened later

With words already saved: Mira's ask line reads "What would you like to learn next?", no
celebration fires (`vocab:first` is done), and a connected AI shows as the "Connected" line.
The preview uses the newly confirmed word.

### 11. Steps and timing

Counted as in [20 §3](../20-popup-redesign/SPEC.md): a step is one deliberate action (a
click, a key press that commits, or typing one entry). The welcome tab opening itself is not
a step. Steps on another site (OpenRouter's sign-in) are listed separately.

| Path | Steps to the celebrated first word | Then to a swap on a real page |
|---|---|---|
| "ありがとう = thanks" (script names the language), no key | 3 (type, Enter, Make it my first word) | +1 (Try it on a page) |
| "hola = hello", no key | 4 (type, Enter, pick language, Make it) | +1 |
| "es: hola = hello", no key | 3 | +1 |
| Connect OpenRouter, then "how do you say hello in Japanese" | 4 (Connect OpenRouter, type, Enter, Make it), plus OpenRouter's own sign-in and Authorize | +1 |
| Paste a key, then ask | 5 (Paste a key instead, paste, type, Enter, Make it), plus getting the key on OpenRouter's site | +1 |
| Try “hello”, then ask (connected) | 4 (Try “hello”, type the language, Enter, Make it) | +1 |
| Several results | +1 when choosing one other than the first (preselected) | |
| Firefox without permission | +1 (Allow) | |

The preview shows the word swapped at the moment it is celebrated, with no extra step.

Targets, measured in a five-person usability test with first-time participants: median under
**60 s** from install to the first swap in the preview on the no-key "native = english" path,
and under **2 minutes** on the Connect OpenRouter path for participants who already have an
OpenRouter account; none needing help.

### 12. States summary

| State | Behavior |
|---|---|
| Loading | Everything is bundled; the page renders complete on first paint. |
| A. Arrival | §2. Focus on the ask box. |
| Connecting / connected / check failed | §4. |
| B. Looking up | §5. Box usable. |
| C. One result / C2. Several | §5. Nothing saved. |
| D. Which language | §5. |
| E. No AI, bare word | §5; the lookup runs when a key is saved. |
| F. Lookup failed | §5, [25](../25-plain-language-errors/SPEC.md) message plus the meaning form. |
| Offline | Lines with a meaning work fully. Asking shows `offline` and the meaning form; a pasted key is saved and checked later. |
| Celebration | §7; reduced-motion variant. |
| Preview and next | §8. |
| Closed before confirming | Nothing saved. A pending lookup is discarded with the page (the preview job is removed). The popup keeps the first-run card. |
| Skipped | §9. |
| Reopened | §10. |

### 13. Copy

| Element | Copy |
|---|---|
| Greeting | "Hi, I'm Mira. I swap English words on the pages you read for words you're learning, one word at a time." |
| AI step | "First, connect your own AI. It looks words up for you." |
| AI buttons | "Connect OpenRouter (free)" · "Paste a key instead" · "Another service or my own model" · "My Mira server" |
| Connected | "✓ Connected to {Provider}." (OpenRouter: "✓ Connected to OpenRouter, free models.") |
| Ask | "What's the first word you'd love to learn?" / "Ask in your own words, in any language." |
| Hello chip | "Try “hello”" |
| No-AI hint | "No AI yet? Type the word and its meaning, like “hola = hello”. That works without one." |
| Looking up | "Looking up “{text}”…" |
| One result | "Here it is:" |
| Several | "I found a few. Which one is yours?" |
| Language needed | "Which language is this?" / button "Choose a language first" |
| No AI, bare word | "To look up “{text}”, connect your AI above. Or tell me what it means:" |
| Primary | "Make it my first word" · secondary "Try another" |
| Celebration | "Congrats, you got your first word!" |
| Preview intro | "This is how you'll meet it:" |
| What's next | "From now on, {native} shows up on English pages wherever “{english}” does. Point at it, or tap it, to see what it means. Even if it's the only one you see, it's yours." |
| Buttons | "Try it on a page" · "Add another word" · "Open your words" |
| List link | "Have a list already? Add it in one go." |
| Skip | "Skip for now" |
| Reopened ask | "What would you like to learn next?" |

The celebration line is the one exclamation mark [05 §3](../05-brand-identity/SPEC.md)
allows for milestones.

### 14. Accessibility

- Mira's lines are in a `role="log"` container (polite), so each new line is announced once;
  the word card and controls are outside it.
- When a card appears, focus moves to the card (`tabindex="-1"`, accessible name
  "こんにちは, konnichiwa, hello, Japanese"); Tab reaches "Make it my first word". The several-
  results card is a `fieldset` with a legend and a radio group.
- The celebration message is announced through the log; confetti is `aria-hidden`; focus
  moves to "Try it on a page".
- Language chips announce as "Spanish, Español". Everything works with keyboard only, at
  320 px and at 200 % zoom; see [27](../27-accessibility-baseline/SPEC.md).

### 15. Privacy

The welcome page makes no network request until the learner acts: Connect OpenRouter (to
OpenRouter), a pasted key's check and each Ask (to the provider they chose, carrying only
what they typed), and Try it on a page (to Wikipedia, with the word's English form). Lines
with a meaning never leave the browser. No analytics. The permission line in step 0 is the
same as in the store listing ([28](../28-privacy-and-store-readiness/SPEC.md)).

## Acceptance criteria

- [ ] Installing the extension opens `welcome.html` once; updating does not.
- [ ] On a fresh profile with no key, typing "ありがとう = thanks", Enter, then Make it my first
      word saves exactly one word (Japanese, ありがとう, thanks) in 3 steps, with no network
      request from the extension (Playwright request log), and the preview shows it swapped.
- [ ] "hola = hello" shows the language chips; picking Español and confirming saves one
      Spanish word in 4 steps.
- [ ] With the mock provider connected, "how do you say hello in Japanese" shows a word card
      and **nothing is written to the store** until Make it my first word is pressed (store
      and projection unchanged; checked in the test).
- [ ] With the mock provider returning three words, the card shows three options and only the
      chosen one is saved.
- [ ] Try another and closing the tab before confirming leave the vocabulary empty.
- [ ] Try “hello” only fills the ask box; the vocabulary stays empty.
- [ ] Confirming the first word fires confetti once with motion allowed, and only the faded
      message under reduced motion; `celebrations.done["vocab:first"]` is set and a second
      word never fires it.
- [ ] With celebrations turned off before confirming, the message appears without confetti.
- [ ] The preview's after line contains the confirmed native word in a sentence from
      `sentences.json`, produced by the real matcher module; editing the sentence updates it
      within one frame.
- [ ] Try it on a page opens the Simple English Wikipedia search and the word is swapped
      there.
- [ ] With the mock provider returning 401 after a pasted key, the field shows "OpenRouter
      didn't accept your key…" and the "native = english" path still completes.
- [ ] A bare word asked with no AI connected shows the meaning form; connecting afterwards
      looks it up without retyping and shows the card (still unsaved).
- [ ] The key field exists only on `welcome.html` and the dashboard settings; the popup has
      none (static check plus a DOM test).
- [ ] In Firefox with host permission revoked, step 0 appears and Allow triggers the browser
      prompt.
- [ ] Skip for now sets `onboarding.skipped` and the popup shows its empty state.
- [ ] The page is fully usable with keyboard only and at 320 px width; axe-core reports no
      violations.
- [ ] Usability test (five participants, recorded in the PR): medians within §11's targets.

## Test plan

- **Unit:** script-to-language rule against `languages.json` (unique scripts set the
  language, Latin and Cyrillic don't); the welcome page's use of `parse.js` for one line;
  sentence choice (shortest match, inflected forms, multi-word forms, fallback sentence);
  `sentences.json` coverage of 09's common-word list (CI check).
- **Integration:** the `preview: true` add job ends in `needs_choice` for one candidate and
  never writes to the store; confirming writes once with the job's `client_request_id`;
  discarding removes the job.
- **End-to-end (Playwright, Chrome and Firefox):** install flow; every path in §11 with step
  counting; several results; each failure code in §5 F with the mock provider; offline;
  reduced motion (emulated media) and celebrations off; skip; reopen with words; no network
  requests on the no-key path.
- **Manual:** the five-person usability test; screen readers per
  [27](../27-accessibility-baseline/SPEC.md) (log announcements, card focus); RTL words
  (Arabic, Hebrew) and CJK on the card and in the preview; the real OpenRouter connect flow
  once per browser before release.

## Rollout and migration

New page in the first Mira release. Existing users updating from Slovo don't see it; they
keep their server connection and their words ([11](../11-local-first-mode/SPEC.md)), and
their `vocab:first` milestone is marked done silently so they never get a first-word
celebration for an old list. Changelog: "A welcome page that helps you pick your first word,
in any language, and shows it on a page in under a minute."

## Open questions

1. **Which page does "Try it on a page" open?** Recommendation: Simple English Wikipedia's
   search for the word's English form (plain English, no tracking, and the snippets contain
   the word). The alternative, a fixed article, can't contain every learner's word.
2. **Offer a hosted lookup option?** Recommendation: no, per [DECISIONS](../DECISIONS.md)
   (no shared hosted instance; learners bring their own key); OpenRouter's free key is the
   easy path.

## Future work

- A 20-second optional tour of the popup after the first word.
- Let the learner pick which sample sentence to keep as "their" sentence in the popover.
