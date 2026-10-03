# 22 · First-run onboarding

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [11-local-first-mode](../11-local-first-mode/SPEC.md), [20-popup-redesign](../20-popup-redesign/SPEC.md), [24-add-flow-safety](../24-add-flow-safety/SPEC.md), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (base-language detection, `t()`, `spec/lang/`); uses [06](../06-design-system/SPEC.md), [07](../07-word-model-v2/SPEC.md) (pronunciation fields), [08](../08-language-tags/SPEC.md), [09](../09-shared-word-spec-and-prompt/SPEC.md), [13](../13-bulk-add/SPEC.md) (its line parser and, from the done state, its sheet), [14](../14-matcher-engine/SPEC.md), [18](../18-language-precedence-and-mixing/SPEC.md), [19](../19-word-popover/SPEC.md), [34](../34-pronunciation-audio/SPEC.md) (speak button), [25](../25-plain-language-errors/SPEC.md), [32](../32-page-coverage-and-celebrations/SPEC.md) (confetti) |
| **Unblocks** | [28-privacy-and-store-readiness](../28-privacy-and-store-readiness/SPEC.md) (store screenshots of the first run) |
| **Sources** | Maintainer: "prompt the user to talk to the LLM and ask how to teach the word hello in whatever language, and then it can say congrats you got your first word with confetti, or some other word, let the user choose. It will be their favorite, they will get a reward and remember it even if it is the only one they see."; [DECISIONS: every word is one the learner chose; own key on a full page; English is not the base language](../DECISIONS.md); [05 S1, S2, S3, §3.1](../../docs/research/05-learner-ux.md); [04 §3 local-first](../../docs/research/04-architecture-release.md); [03 C4, C8, D6](../../docs/research/03-browser-extension.md) |

## Problem

A fresh install is a dead end for anyone not already running the server. The worker syncs on
install (`extension/background.js:52-55`), fails with "Paste your API token to connect."
(`background.js:10`), and the popup shows it in red and opens a Connection panel pointing at
`http://localhost:4747` with a placeholder about `.env` (`popup.js:123-134`,
`popup.html:138-151`). Nothing on any page changes. The README estimates ten minutes of setup
with Elixir installed before the first swapped word ([05 S1](../../docs/research/05-learner-ux.md)).

With local-first mode ([11](../11-local-first-mode/SPEC.md)) the server is optional, but a
new learner still has no words, and Kotiko will never pick words for them
([DECISIONS](../DECISIONS.md)): every word is one the learner chose. So the first run has
one job: help the learner choose their first word, make that moment feel like a reward, and
show the word working, in under a minute.

And it has to do that in the learner's own language. The maintainer's test: someone in
Puerto Rico with an all-Spanish browser installs Kotiko. As first planned, they would get an English
welcome, be asked for a word as if they read English, get an English meaning, and see a
preview on an English sentence; on their own Spanish pages nothing would ever swap, and
the confetti would be "waiting on English to be done"
([DECISIONS](../DECISIONS.md), [50](../50-ui-localization-and-base-language/SPEC.md)).

## Goals

- The welcome tab is a short conversation, not a form: see the languages you read, connect
  your own AI, ask for the first word you'd love to learn in your own words, confirm it,
  celebrate it, see it swap.
- The whole page is in Kotiko's interface language (the browser's, [50 §8](../50-ui-localization-and-base-language/SPEC.md)),
  complete in English and Spanish at launch, and the learner's base languages are detected
  from the browser and confirmed here with no extra step when the guess is right
  ([50 §2](../50-ui-localization-and-base-language/SPEC.md)).
- The first-word conversation works in the learner's language: "¿Cómo se dice hola en
  japonés?" gets こんにちは with the meaning "hola", and the preview swaps it into a Spanish
  sentence.
- The learner chooses both the word and the language. Nothing is added to their vocabulary
  until they press "Make it my first word".
- First word celebrated in **4 steps plus OpenRouter's own sign-in** with an OpenRouter
  account (one-click connect), and in **3 to 4 steps with no key at all** when the learner types the word with its meaning
  ("hola = hello"; for a Spanish reader, "hello = hola"), which Kotiko parses locally with no
  model and no network.
- A live preview shows the learner's own word swapped into a sentence in their primary base
  language by the real matcher, before they leave the page.
- The key is entered on this full page, never in the popup
  ([DECISIONS](../DECISIONS.md), [11 §3](../11-local-first-mode/SPEC.md)).
- Skipping is always possible, and nothing about setup has to be redone later.
- Firefox users whose page permission is missing are asked for it in plain words.

## Non-goals

- Provider presets, key storage, the PKCE connect flow and server connection mechanics:
  [11](../11-local-first-mode/SPEC.md).
- Suggesting words to learn, or offering ready-made lists. Never
  ([DECISIONS](../DECISIONS.md)). "hello" (in the learner's language: "hola") appears only
  as an example of what to ask.
- Editing base languages beyond the first-run confirmation, and the support levels per
  base: [21](../21-dashboard/SPEC.md) and [50](../50-ui-localization-and-base-language/SPEC.md).
- Adding a list during first run: the done state links to bulk add
  ([13](../13-bulk-add/SPEC.md)), which has its own review step.
- Page milestones and the general celebration rules: [32](../32-page-coverage-and-celebrations/SPEC.md).
- Migrating existing Slovo server users: [11](../11-local-first-mode/SPEC.md) and
  [04](../04-rename-to-kotiko/SPEC.md); updates never open the welcome page.
- Injecting into tabs that were open before install: [15](../15-framework-safe-swapping/SPEC.md).
- Mobile first run: [45](../45-firefox-android/SPEC.md).

## User stories

- As someone who just installed Kotiko, I want to ask "how do you say hello in Japanese", see
  the answer, and keep it as my first word, so that I start with a word I care about.
- As a learner who already knows a word, I want to type "hola = hello" and have it work right
  away, without creating any account or key.
- As a learner with an OpenRouter account, I want to connect it with one click on this page
  and know it works before I ask for my word.
- As a learner who asked for one word and got something I didn't expect, I want to try again
  before anything is saved.
- As a self-hoster, I want to connect my existing Kotiko server from the same page.
- As someone who doesn't want a tour, I want to skip it and use the popup.
- As a learner in Puerto Rico with an all-Spanish browser, I want the welcome in Spanish,
  to ask "¿cómo se dice hola en japonés?", and to see こんにちは in a Spanish sentence, with
  confetti for my first word.
- As a reader of Spanish and English, I want to see both languages already ticked, and my
  first word's meaning in both.
- As a learner whose browser lists Japanese because I'm learning it, I want to untick it
  before I start.

## Specification

### 1. When it opens

- `runtime.onInstalled` with `reason === "install"` opens `extension/welcome.html` in a new
  active tab. Not on `update` or `chrome_update`.
- The popup's first-run card ([20 §2 A](../20-popup-redesign/SPEC.md)) opens or focuses it.
- Dashboard → Settings → About shows the full "Why Kotiko?" story from its single source in
  [05](../05-brand-identity/SPEC.md) section 1 (the only place in the extension where the
  mascot Mira is named), and "Show welcome again" opens it with the current connection
  shown as connected.
- State is stored as `onboarding: {completedAt, skipped, version: 2}` in `storage.local`.
  `completedAt` is set when the first word is saved (anywhere, so a learner who adds a word in
  the popup first is also done) or when the learner presses "Skip for now". Until then the
  popup shows the first-run card; nothing else is gated on it.

### 2. Layout

One page, one column (max width 640 px). Kotiko's lines appear one under another like a short
conversation, each with the small kitten avatar ([05](../05-brand-identity/SPEC.md)); the
learner's parts are controls, not chat bubbles. Both the AI step and the word box are visible
from the start, so a learner who already knows a word never has to connect anything first.
No "Next" buttons, no wizard.

**A. On arrival (nothing connected, no words):**

```
┌──────────────────────────────────────────────────────────────────┐
│ (•) Kotiko                                          Skip for now   │
│                                                                  │
│ (=^.^=) Hi, I'm Kotiko. I swap words on the pages you read for     │
│         words you're learning, one word at a time.               │
│                                                                  │
│ (=^.^=) The pages you read are in: [✓ English] [+ Another]       │
│                                                                  │
│ (=^.^=) First, connect your own AI. It looks words up for you.   │
│         [ Connect OpenRouter (free) ]                            │
│         Paste a key instead · Another service or my own model ·  │
│         My Kotiko server                                           │
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

**The same arrival for the Puerto Rico learner** (browser `es-PR, es`; interface in
Spanish; detected bases `["es"]`):

```
┌──────────────────────────────────────────────────────────────────┐
│ (•) Kotiko                                     Omitir por ahora    │
│                                                                  │
│ (=^.^=) Hola, soy Kotiko. Cambio palabras en las páginas que lees  │
│         por palabras que estás aprendiendo, una a la vez.        │
│                                                                  │
│ (=^.^=) Las páginas que lees están en: [✓ español] [+ Otro]      │
│                                                                  │
│ (=^.^=) Primero, conecta tu propia IA. Busca palabras por ti.    │
│         [ Conectar OpenRouter (gratis) ]                         │
│         Pegar una clave · Otro servicio o mi propio modelo ·     │
│         Mi servidor de Kotiko                                      │
│                                                                  │
│ (=^.^=) ¿Cuál es la primera palabra que te encantaría aprender?  │
│         Pregunta con tus propias palabras, en cualquier idioma.  │
│         ┌──────────────────────────────────────────────┐         │
│         │ ¿cómo se dice hola en japonés?               │[Preguntar]
│         └──────────────────────────────────────────────┘         │
│         [ Prueba con “hola” ]                                    │
│         ¿Aún no tienes IA? Escribe la palabra y su significado,  │
│         como “hello = hola”. Funciona sin IA.                    │
└──────────────────────────────────────────────────────────────────┘
```

The placeholder cycles every 4 s through four examples from the interface locale's
`welcome_placeholder_1`…`_4` keys (static under reduced motion: the first one). English:
"how do you say hello in Japanese", "hola", "dog in Arabic", "merci = thank you". Spanish:
"¿cómo se dice hola en japonés?", "hello", "perro en árabe", "merci = gracias". It is a
placeholder only; the box starts empty.

**Try “hello”** suggests the word "hello" in the learner's **primary base** (the first of
`s:ui.baseLangs`): "hello" for `en`, "hola" for `es`, "bonjour" for `fr`, "こんにちは" for
`ja`. The word and the question prefix come from `spec/lang/<base>/welcome.json`
(`{"hello": "hola", "ask_prefix": "¿cómo se dice hola en ", "no_ai_example": "hello = hola"}`),
shipped for every Full base ([50 §5](../50-ui-localization-and-base-language/SPEC.md));
for a base without the file, the chip uses the interface locale's `welcome_try_hello` and
`welcome_ask_prefix` keys. Pressing it puts the prefix into the box ("how do you say hello
in " / "¿cómo se dice hola en " / "「こんにちは」は"), moves focus there with the caret at
the end, and saves nothing; the learner types the language ("japonés?"). The meanings'
language is set by the base languages, not by the language of the question, so a Polish
reader with an English interface who types "how do you say hello in Japanese" still gets
the meaning "cześć".

Styling per [06](../06-design-system/SPEC.md): `--canvas` background, Kotiko's lines in
`--t-lead` on `--canvas`, controls on `--surface`, the word card (§5) at `--r-xl` on
`--surface` with `--e-1`. The page is usable at 320 px width.

### 2b. The languages you read

The line "The pages you read are in:" shows `s:ui.baseLangsDetected`
([50 §2](../50-ui-localization-and-base-language/SPEC.md): the browser's interface
language and accept-languages, reduced to base tags, at most three) as checked chips, by
name in the interface language with the endonym as a tooltip when they differ.

- **Right guess, no step.** Nothing needs to be pressed. `baseLangsConfirmed` becomes true
  when the learner saves their first word or presses Skip for now, with the chips as they
  are.
- **Untick** a chip to remove that language (at least one must stay ticked; unticking the
  last is refused with "Kotiko needs at least one language you read."). A learner whose
  browser lists a language they are learning unticks it here.
- **+ Another** opens a searchable list of languages (names in the interface language,
  endonyms and tags, about 180) and adds the pick as a ticked chip; at most four
  ([50 §2](../50-ui-localization-and-base-language/SPEC.md)). Order is the chips' order;
  the first ticked chip is the primary base.
- A chip whose base is at the Basic support level carries a small "basic" tag with 50's
  `base_level_basic` explanation on focus or hover.
- Changes write `s:ui.baseLangs` at once. A card already on screen (states C and C2) is
  looked up again for the new set of bases, since its meanings depend on them.
- The interface language is **not** chosen here; it follows the browser
  ([50 §8](../50-ui-localization-and-base-language/SPEC.md)). If the browser's language has
  no Kotiko translation, the page is in English (the manifest's source locale) and the base
  chips still show the browser's language, so a Polish reader sees "The pages you read are
  in: [✓ polski]".

### 3. Step 0, only when needed: page permission (Firefox)

If `permissions.contains({origins: ["<all_urls>"]})` is false, a card appears above Kotiko's
first line: "Allow Kotiko to read pages. Kotiko needs this to swap words. Page text never leaves
your browser." with **[Allow]** (calls `permissions.request`). Declining shows: "Without it,
Kotiko can't swap words. You can allow it later from the popup."
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
- **My Kotiko server** expands address and access key fields, checked the same way ("Server
  found", "Access key accepted").

**Connected** replaces the step with one line:

```
│ (=^.^=) ✓ Connected to OpenRouter, free models.     Change       │
```

**Check failed** keeps the field and shows the [25](../25-plain-language-errors/SPEC.md)
message under it (`key_rejected`: "OpenRouter didn't accept your key…", `offline`, and so
on). The key stays saved, so a learner who is offline can still finish; Kotiko checks again on
first use.

**Waiting for OpenRouter** (the sign-in tab is open): "Waiting for OpenRouter… Finish signing
in on the other tab." with "Paste a key instead" still available. If the learner returns
without connecting, nothing changes and the button works again.

### 5. Ask for the first word

The box accepts anything the popup's add box does, with add-box semantics
([09](../09-shared-word-spec-and-prompt/SPEC.md): the add box means add), in any language
the learner writes in: a question ("how do you say hello in Japanese", "¿cómo se dice hola
en japonés?"), a word in any language ("hola", "hello"), a word in the learner's own
language with a target language ("dog in Arabic", "perro en árabe"), or a word with its
meaning ("hola = hello", "es: hola = hello", "hello = hola", "спасибо (spasibo) = gracias").
Enter or **Ask** submits. One entry at a time.

**Which meanings are asked for.** The lookup carries `base_langs` = the ticked chips
([09](../09-shared-word-spec-and-prompt/SPEC.md)'s request contract, [50 §3](../50-ui-localization-and-base-language/SPEC.md)).
The learner's text is sent verbatim; the model writes gloss, forms and note in each base,
and any base equal to the word's own language is dropped. One model call, one card.

**Nothing is saved yet.** The welcome page creates a [24](../24-add-flow-safety/SPEC.md) add
job flagged `preview: true`: the background looks up and validates exactly as for any add,
then stops before the store write and puts the job in 24's `needs_choice` state with its
candidates, whatever their count (for this job, `CONFIRM_AT` is 1). With a Kotiko server doing
lookups, this uses the `preview` flag on 07's add route that
[24](../24-add-flow-safety/SPEC.md)'s Open question 2 recommends; it is a prerequisite for
the server option on this page.

**Lines with a meaning never touch the model.** "native = meaning" (and the other one-line
forms) is parsed locally by [13](../13-bulk-add/SPEC.md)'s `extension/bulk/parse.js`, as the
add box does ([24 §7](../24-add-flow-safety/SPEC.md)). This works in any base language with
no key, no account and no network, so a learner can see a swap within a minute before
setting up anything. The meaning is the gloss in the **primary base** (one record; with
several bases, the card shows a "Meaning in: [español ▾]" chip to pick another ticked
base). The word's language comes from, in order: a prefix ("es: hola = hello", "en: hello =
hola"); the native word's script when exactly one language in
[08](../08-language-tags/SPEC.md)'s `languages.json` uses it by default (Hangul is Korean,
kana is Japanese, Thai, Georgian, Armenian, Greek, and so on); or the learner, in one tap
(state D below). The word's language can't be the base its meaning is in
([50 §1](../50-ui-localization-and-base-language/SPEC.md)), so a Spanish reader's "hello =
hola" never offers Español as the word's language.

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
│ │  こんにちは                                         (speak)  │ │
│ │  kon-nee-chee-wa                                             │ │
│ │  konnichiwa · AI-generated                                   │ │
│ │  hello  ·  Japanese                                          │ │
│ │                                                              │ │
│ │  [ Make it my first word ]      Try another                  │ │
│ └──────────────────────────────────────────────────────────────┘ │
```

The same card in Spanish, for "¿cómo se dice hola en japonés?" (base `es`):

```
│ (=^.^=) Aquí está:                                               │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │  こんにちは                                         (altavoz)│ │
│ │  kon-ni-chi-ua                                               │ │
│ │  konnichiwa · Generado por IA                                │ │
│ │  hola  ·  japonés                                            │ │
│ │                                                              │ │
│ │  [ Que sea mi primera palabra ]   Probar otra                │ │
│ └──────────────────────────────────────────────────────────────┘ │
```

With two bases ticked (español and English), the meaning line becomes two lines,
"hola · en páginas en español" and "hello · en páginas en inglés", and confirming saves
both records ([50 §3](../50-ui-localization-and-base-language/SPEC.md)).

The card's top lines are the popover's pronunciation block ([19](../19-word-popover/SPEC.md)
section 1a), so the first word is learned the way every later one is shown: the native in
`--t-specimen` (the display role, [06 §5](../06-design-system/SPEC.md)) with `lang` and
`dir="auto"` ([17](../17-casing-and-script-display/SPEC.md) fonts), written with its stress
mark where the target has one (a Russian first word shows приве́т, not привет), and the
speak button ([34](../34-pronunciation-audio/SPEC.md)) on that line, shown only when a voice
exists; then the `pronunciation` for the primary base (07 section 7: "kon-nee-chee-wa" for
`en`, "kon-ni-chi-ua" for `es`; for приве́т, "pree-VYET" and "pri-VIET", with the stressed
syllable also in semibold); the careful form when there is one ("Slowly: …"); the
romanization with the source label ("AI-generated" / "Generado por IA"; no label for a
"native = meaning" word the learner typed, which has no pronunciation unless they gave
one); then the gloss in each base (each in `<bdi lang>`) and the language name from
`Intl.DisplayNames` in the interface language. With two bases, the pronunciation shown is
the primary base's. A card with no pronunciation (a base without a respelling key) keeps
the stress-marked word, the romanization and the speak button. **Try another**
discards the card and returns focus to the box with the learner's text restored.

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

A radio group, first option selected. Options show the romanization to stay on one line;
the selected option's pronunciation, source label and speak button appear under the
group, as on card C. Only the chosen word is saved; the others are discarded. One first
word, chosen by the learner.

**D. Which language?** (a "native = meaning" line whose script doesn't name the language):

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

For a Spanish reader typing "hello = hola", the chips read [English] [Português]
[Italiano] [Français] [Deutsch] …, with Español left out because the meaning is in Spanish.

Chips are the most-learned languages written in that script (a static list in 08's data, by
endonym), minus the base the meaning is in, no preselection; the search covers about 180
languages (names in the interface language, endonyms and tags). Picking one turns the card
into state C and the button into "Make it my first word".

**E. A bare word or question with no AI connected:**

```
│ (=^.^=) To look up “hola”, connect your AI above.                │
│         Or tell me what it means:                                │
│         hola = [ hello                    ]  [ Add ]             │
```

In Spanish: "Para buscar “hello”, conecta tu IA arriba. O dime qué significa: hello =
[ hola ] [Agregar]". The meaning field's placeholder is "meaning in {primary base}"
("significado en español").

The meaning field is a one-line form; Add builds the card locally (state C, or D when the
language is needed). If the learner connects instead, the lookup runs as soon as the key is
saved (24's `lookup_not_set_up` waiting rule), with no retyping.

**F. Lookup failed:** the [25](../25-plain-language-errors/SPEC.md) message in Kotiko's line,
then the same "Or tell me what it means" form as E. Codes: `key_rejected`,
`quota_exhausted`, `rate_limited`, `offline`, `lookup_timeout`, `model_unavailable`. For
`no_word_found`: "I couldn't find a word in that. Try “hello in Japanese”, or type it as
“hola = hello”." / "No encontré ninguna palabra ahí. Prueba “hola en japonés”, o escríbela
como “hello = hola”." For `rejected_same_as_gloss` (the word is already in a language the
learner reads, [09](../09-shared-word-spec-and-prompt/SPEC.md)): "That looks like a word in
{base} already. Which language would you like it in? Try “hello in Spanish”." / "Eso
parece una palabra en {base}. ¿En qué idioma la quieres? Prueba “hola en inglés”." The
examples come from the primary base's `welcome.json`.

### 6. Make it my first word

Pressing **Make it my first word** (one step):

1. saves the chosen word through [24](../24-add-flow-safety/SPEC.md)'s add path (07's
   merge-not-overwrite add, idempotent by the job's `client_request_id`), with `origin: "add"`
   for a looked-up word or `"manual"` for a "native = meaning" one
   ([07](../07-word-model-v2/SPEC.md)); one record per ticked base the card has a meaning
   for;
2. sets `onboarding.completedAt` and `s:ui.baseLangsConfirmed = true`;
3. claims the first-word milestone (`vocab:first`, [32 §3](../32-page-coverage-and-celebrations/SPEC.md))
   and shows the celebration (§7).

### 7. Celebration

```
┌──────────────────────────────────────────────────────────────────┐
│        .  *    ▪        ·   ▪      •    ▪   ·       *  .         │  confetti (motion allowed)
│ (=^.^=) Congrats, you got your first word!                       │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │  こんにちは  kon-nee-chee-wa                        (speak)  │ │
│ │  hello · Japanese                                            │ │
│ └──────────────────────────────────────────────────────────────┘ │
│         Turn off celebrations                                    │
└──────────────────────────────────────────────────────────────────┘
```

In Spanish: "¡Felicidades, ya tienes tu primera palabra!", the card "こんにちは kon-ni-chi-ua /
hola · japonés", and "Desactivar celebraciones". The speak button stays on the
celebration card, so the learner can hear the word they just chose.

- Confetti is [32 §5](../32-page-coverage-and-celebrations/SPEC.md)'s renderer, full viewport
  on the welcome page: same particles, palette, 1.6 s duration, no sound, nothing loops, Esc
  or any click or key stops it. It fires once in a lifetime (`celebrations.done["vocab:first"]`).
- **Reduced motion** (`prefers-reduced-motion: reduce` or Kotiko's "Reduce motion" setting): no
  confetti; the message and card fade in over 120 ms. This is the full calm alternative.
- Celebrations are on by default ([DECISIONS](../DECISIONS.md)). **Turn off celebrations**
  sets `prefs.celebrations = false` and shows "Off. You can turn them back on in Settings."
  A learner who turned them off before saving their first word gets the message without
  confetti.
- The first swap on a real page happens on a page in one of the learner's base languages
  (§8, Try it on a page); [32](../32-page-coverage-and-celebrations/SPEC.md) counts it in
  that base, so the Puerto Rico learner's first page milestone fires on a Spanish page.
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
│ (=^.^=) From now on, こんにちは shows up on pages in English      │
│         wherever “hello” does. Point at it, or tap it, to see    │
│         what it means. Even if it's the only one you see,        │
│         it's yours.                                              │
│                                                                  │
│         [ Try it on a page ]   Add another word   Open your words│
│                                                                  │
│         Have a list already? Add it in one go.                   │
│         Pin Kotiko: click the puzzle piece, then the pin next      │
│         to Kotiko.                                                 │
│         Swapped words won't show up in Find on page. Turn Kotiko   │
│         off for a moment from the popup when you need to search. │
└──────────────────────────────────────────────────────────────────┘
```

The same step in Spanish:

```
│ (=^.^=) Así es como te la vas a encontrar:                       │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ Ella dijo hola y saludó desde el autobús.                    │ │
│ │ Ella dijo こんにちは y saludó desde el autobús.                │ │
│ │           ┄┄┄┄┄                                    Editar     │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ (=^.^=) Desde ahora, こんにちは aparece en páginas en español     │
│         donde diga “hola”. Señálala o tócala para ver qué        │
│         significa. Aunque sea la única que veas, es tuya.        │
│                                                                  │
│    [ Probar en una página ]   Agregar otra   Abrir tus palabras  │
```

**The sample sentence** is in the learner's primary base, the language the word will
actually meet them in. Each base has its own sentences in
`spec/lang/<base>/sentences.json` ([50 §5](../50-ui-localization-and-base-language/SPEC.md)),
short plain sentences (6 to 12 words, or about 10 to 25 characters for Chinese and
Japanese) written by speakers for Kotiko:

| Base level | Sentences | Coverage check (CI) |
|---|---|---|
| Full (`en`, `es` at launch) | about 1,000 | every word in the base's list of about 3,000 common words (`spec/lang/<base>/common.txt`) appears at least once |
| Basic | none | |

Examples: `en` "She said hello and waved from the bus."; `es` "Ella dijo hola y saludó
desde el autobús."; `ja` "彼女は手を振って「こんにちは」と言った。".

The page picks the shortest sentence in which the real matcher ([14](../14-matcher-engine/SPEC.md),
with the base's tokenizer, so Japanese without spaces works) finds one of the word's forms
in that base, so inflections and multi-word forms count. If none matches, it uses the
base's `fallback` template from the same file (`en` "Today I learned the word {gloss}.",
`es` "Hoy aprendí la palabra {gloss}."). A Basic base with no file shows the word alone,
"{gloss} → {native}", swapped with the same motion. With two or more bases, a second
before/after pair for the next base appears under the first. The sentences are text for
the preview, never words to learn.

- The welcome page runs the matcher module and precedence
  ([18](../18-language-precedence-and-mixing/SPEC.md)) itself, because content scripts don't
  run on extension pages. The "before" line is `--ink-3`, the "after" line `--ink` with the
  dotted underline; the swapped word plays [06 §9](../06-design-system/SPEC.md)'s swap motion
  (instant under reduced motion).
- Hovering, tapping or focusing the swapped word opens the real popover
  ([19](../19-word-popover/SPEC.md)), so the learner learns how to check a word.
- **Edit** turns the before line into a text field (`lang` set to the base); the learner
  can type any sentence in that language and the after line updates as they type (one
  frame).
- The preview region is a `<figure>` with `<figcaption>` "Preview"; it is not an `aria-live`
  region, and the after line is real text.

**Try it on a page** opens a Wikipedia full-text search, in the primary base's language,
for the word's first form in that base, whose result snippets contain the word several
times: `https://{wiki}.wikipedia.org/w/index.php?search={form}&fulltext=1&ns0=1`. `{wiki}`
is the base's `wikipedia` field in [08](../08-language-tags/SPEC.md)'s `languages.json`
(`simple` for `en`, because plain English snippets read best; `es` for `es`; `zh` plus
`&variant=zh-tw` for `zh-Hant`; the primary subtag otherwise). The button's description
reads "Opens a Wikipedia search for “hello”." / "Abre una búsqueda de Wikipedia de “hola”."
The page is in a base language, so the swap appears there, and slice 32 counts it. The
welcome tab stays open behind it.

**Add another word** returns to the box (no celebration for later words; 32's vocabulary
milestones take over). **Open your words** opens the dashboard ([21](../21-dashboard/SPEC.md)).
**Add it in one go** opens bulk add ([13](../13-bulk-add/SPEC.md)) in the dashboard, where
every row is reviewed before saving. Pin instructions are browser-specific: Chrome and Edge as
above; Firefox: "click the extensions button, then the gear next to Kotiko, then Pin to
Toolbar" (each a localized key). When no AI is connected, one more line: "To look up words you don't know yet,
connect your AI in Settings." ([21](../21-dashboard/SPEC.md)).

### 9. Skip for now

The header link sets `onboarding = {completedAt: now, skipped: true}` and closes the tab. The
popup then shows its empty state ([20 §2 B](../20-popup-redesign/SPEC.md)) and the add box
works as usual. "Show welcome again" brings the page back.

### 10. Reopened later

With words already saved: Kotiko's ask line reads "What would you like to learn next?", no
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
| Spanish reader: "hello = hola", no key | 4 (type, Enter, pick English, Que sea mi primera palabra) | +1 |
| Spanish reader: Connect OpenRouter, then "¿cómo se dice hola en japonés?" | 4, plus OpenRouter's sign-in | +1 |
| Bases detected wrong (untick one, or add one) | +1 per chip changed | |
| Connect OpenRouter, then "how do you say hello in Japanese" | 4 (Connect OpenRouter, type, Enter, Make it), plus OpenRouter's own sign-in and Authorize | +1 |
| Paste a key, then ask | 5 (Paste a key instead, paste, type, Enter, Make it), plus getting the key on OpenRouter's site | +1 |
| Try “hello”, then ask (connected) | 4 (Try “hello”, type the language, Enter, Make it) | +1 |
| Several results | +1 when choosing one other than the first (preselected) | |
| Firefox without permission | +1 (Allow) | |

The preview shows the word swapped at the moment it is celebrated, with no extra step.

Targets, measured in a five-person usability test with first-time participants (at least
two of them using a browser in Spanish, and at least one whose base is neither English nor
Spanish): median under
**60 s** from install to the first swap in the preview on the no-key "native = meaning" path,
and under **2 minutes** on the Connect OpenRouter path for participants who already have an
OpenRouter account; none needing help.

### 12. States summary

| State | Behavior |
|---|---|
| Loading | Everything is bundled; the page renders complete on first paint. |
| A. Arrival | §2. Focus on the ask box. Base chips preselected (§2b). |
| Bases changed | §2b. A card on screen is looked up again. |
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

Every string is a key in `extension/_locales/<locale>/messages.json`, read with
`KotikoI18n.t()` ([50 §8](../50-ui-localization-and-base-language/SPEC.md)); both columns
ship at launch. `{lang}` and `{base}` are names from `Intl.DisplayNames` in the interface
language. `{hello}` and `{example}` come from the primary base's `welcome.json`.

| Key | en | es |
|---|---|---|
| `welcome_greeting` | Hi, I'm Kotiko. I swap words on the pages you read for words you're learning, one word at a time. | Hola, soy Kotiko. Cambio palabras en las páginas que lees por palabras que estás aprendiendo, una a la vez. |
| `welcome_bases` | The pages you read are in: | Las páginas que lees están en: |
| `welcome_bases_add` | Another | Otro |
| `welcome_bases_last` | Kotiko needs at least one language you read. | Kotiko necesita al menos un idioma que leas. |
| `welcome_ai_step` | First, connect your own AI. It looks words up for you. | Primero, conecta tu propia IA. Busca palabras por ti. |
| `welcome_ai_buttons` | Connect OpenRouter (free) · Paste a key instead · Another service or my own model · My Kotiko server | Conectar OpenRouter (gratis) · Pegar una clave · Otro servicio o mi propio modelo · Mi servidor de Kotiko |
| `welcome_connected` | ✓ Connected to {provider}. (OpenRouter: "✓ Connected to OpenRouter, free models.") | ✓ Conectado a {provider}. (OpenRouter: "✓ Conectado a OpenRouter, modelos gratis.") |
| `welcome_ask` | What's the first word you'd love to learn? / Ask in your own words, in any language. | ¿Cuál es la primera palabra que te encantaría aprender? / Pregunta con tus propias palabras, en cualquier idioma. |
| `welcome_try_hello` | Try “{hello}” | Prueba con “{hello}” |
| `welcome_no_ai_hint` | No AI yet? Type the word and its meaning, like “{example}”. That works without one. | ¿Aún no tienes IA? Escribe la palabra y su significado, como “{example}”. Funciona sin IA. |
| `welcome_looking_up` | Looking up “{text}”… | Buscando “{text}”… |
| `welcome_one_result` | Here it is: | Aquí está: |
| `welcome_several` | I found a few. Which one is yours? | Encontré varias. ¿Cuál es la tuya? |
| `welcome_meaning_on_pages` | {gloss} · on pages in {base} | {gloss} · en páginas en {base} |
| `welcome_which_language` | Which language is this? / button "Choose a language first" | ¿En qué idioma está? / botón "Primero elige un idioma" |
| `welcome_no_ai_word` | To look up “{text}”, connect your AI above. Or tell me what it means: | Para buscar “{text}”, conecta tu IA arriba. O dime qué significa: |
| `welcome_confirm` | Make it my first word · secondary "Try another" | Que sea mi primera palabra · secundario "Probar otra" |
| `welcome_celebration` | Congrats, you got your first word! | ¡Felicidades, ya tienes tu primera palabra! |
| `welcome_preview_intro` | This is how you'll meet it: | Así es como te la vas a encontrar: |
| `welcome_whats_next` | From now on, {native} shows up on pages in {base} wherever “{form}” does. Point at it, or tap it, to see what it means. Even if it's the only one you see, it's yours. | Desde ahora, {native} aparece en páginas en {base} donde diga “{form}”. Señálala o tócala para ver qué significa. Aunque sea la única que veas, es tuya. |
| `welcome_buttons` | Try it on a page · Add another word · Open your words | Probar en una página · Agregar otra · Abrir tus palabras |
| `welcome_list_link` | Have a list already? Add it in one go. | ¿Ya tienes una lista? Agrégala de una vez. |
| `welcome_skip` | Skip for now | Omitir por ahora |
| `welcome_reopened_ask` | What would you like to learn next? | ¿Qué te gustaría aprender ahora? |
| `celebrations_off` | Turn off celebrations | Desactivar celebraciones |

With two or more bases, `welcome_whats_next` names them all ("on pages in Spanish and
English", joined with `Intl.ListFormat(uiLocale, {type: "conjunction"})`). The Spanish copy
uses `tú` and gender-neutral wording per [50 §8](../50-ui-localization-and-base-language/SPEC.md)
("la tuya" and "Señálala" refer to la palabra, not the learner).

The celebration line is the one exclamation mark [05 §3](../05-brand-identity/SPEC.md)
allows for milestones.

### 14. Accessibility

- Kotiko's lines are in a `role="log"` container (polite), so each new line is announced once;
  the word card and controls are outside it.
- When a card appears, focus moves to the card (`tabindex="-1"`, accessible name
  "こんにちは, pronunciation: kon-nee-chee-wa, hello, Japanese", built like 19's
  `popover_pron_a11y`, so a stressed syllable is announced as "stress on …"); Tab reaches "Make it my first word". The several-
  results card is a `fieldset` with a legend and a radio group.
- The celebration message is announced through the log; confetti is `aria-hidden`; focus
  moves to "Try it on a page".
- Language chips announce as "Spanish, Español" (in Spanish, "inglés, English"); base chips
  are checkboxes named in the interface language. Everything works with keyboard only, at
  320 px and at 200 % zoom; see [27](../27-accessibility-baseline/SPEC.md).

### 15. Privacy

The welcome page makes no network request until the learner acts: Connect OpenRouter (to
OpenRouter), a pasted key's check and each Ask (to the provider they chose, carrying only
what they typed and the ticked base languages), and Try it on a page (to Wikipedia in the
base's language, with the word's form in that base). Base-language detection reads the
browser's settings locally and sends nothing. Lines
with a meaning never leave the browser. No analytics. The permission line in step 0 is the
same as in the store listing ([28](../28-privacy-and-store-readiness/SPEC.md)).

## Acceptance criteria

- [ ] Installing the extension opens `welcome.html` once; updating does not.
- [ ] **Puerto Rico** ([50](../50-ui-localization-and-base-language/SPEC.md)): in a profile
      with interface and accept languages `es-PR, es`, the welcome tab is entirely Spanish
      and shows "[✓ español]" as the only base; "Prueba con “hola”" inserts "¿cómo se dice
      hola en "; typing "japonés?" with the mock provider returns こんにちは with gloss
      "hola"; confirming fires confetti, the preview reads "Ella dijo こんにちは y saludó
      desde el autobús.", and Try it on a page opens es.wikipedia.org where こんにちは
      replaces "hola". No English string appears in the flow (literal-string check plus a
      DOM text scan against the `en` catalog).
- [ ] With bases `es` and `en` ticked, the card shows "hola" and "hello", and confirming
      saves two records from one model call.
- [ ] Unticking a detected base before confirming removes it from `s:ui.baseLangs`;
      unticking the last is refused.
- [ ] A Spanish reader's "hello = hola" shows language chips without Español, and saves
      `{lang: "en", native: "hello", base_lang: "es", gloss: "hola"}` with no network
      request.
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
- [ ] The card for a mock answer пожалуйста (base `en`) shows пожа́луйста with a speak
      button (stubbed Russian voice), "pa-ZHAL-sta", "Slowly: pa-ZHA-lu-sta" and
      "pozhaluysta · AI-generated"; with no Russian voice the speak button is absent; with
      base `es` the Spanish-key respelling and "Generado por IA" show.
- [ ] Try another and closing the tab before confirming leave the vocabulary empty.
- [ ] Try “hello” only fills the ask box; the vocabulary stays empty.
- [ ] Confirming the first word fires confetti once with motion allowed, and only the faded
      message under reduced motion; `celebrations.done["vocab:first"]` is set and a second
      word never fires it.
- [ ] With celebrations turned off before confirming, the message appears without confetti.
- [ ] The preview's after line contains the confirmed native word in a sentence from the
      primary base's `sentences.json`, produced by the real matcher module (English,
      Spanish, and a Japanese base with no spaces); editing the sentence updates it within
      one frame.
- [ ] Try it on a page opens the Wikipedia search in the primary base's language (Simple
      English for `en`, Spanish for `es`) and the word is swapped there.
- [ ] With the mock provider returning 401 after a pasted key, the field shows "OpenRouter
      didn't accept your key…" and the "native = meaning" path still completes.
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
  language, Latin and Cyrillic don't; the meaning's base is excluded); the welcome page's
  use of `parse.js` for one line in `en` and `es`; base chips (preselect, untick, add, cap,
  last-chip refusal); sentence choice per base (shortest match, inflected forms, multi-word
  forms, Japanese without spaces, fallback template, Basic base with no file); each Full
  base's `sentences.json` coverage of its `common.txt` (CI check); every Full base
  has a valid `welcome.json`.
- **Integration:** the `preview: true` add job ends in `needs_choice` for one candidate and
  never writes to the store; confirming writes once with the job's `client_request_id`;
  discarding removes the job.
- **End-to-end (Playwright, Chrome and Firefox):** install flow in English and in Spanish
  (`--lang=es-PR` and accept-languages set), including the Puerto Rico journey above; every path in §11 with step
  counting; several results; each failure code in §5 F with the mock provider; offline;
  reduced motion (emulated media) and celebrations off; skip; reopen with words; no network
  requests on the no-key path.
- **Manual:** a native Spanish speaker reviews the whole Spanish flow in context; the
  five-person usability test; screen readers per
  [27](../27-accessibility-baseline/SPEC.md) (log announcements, card focus); RTL words
  (Arabic, Hebrew) and CJK on the card and in the preview; the real OpenRouter connect flow
  once per browser before release.

## Rollout and migration

New page in the first Kotiko release. Existing users updating from Slovo don't see it; they
keep their server connection and their words ([11](../11-local-first-mode/SPEC.md)), and
their `vocab:first` milestone is marked done silently so they never get a first-word
celebration for an old list. Their base languages follow
[50 §2](../50-ui-localization-and-base-language/SPEC.md)'s upgrade rule (detected languages
plus English, since their words have English meanings). Changelog: "A welcome page that helps you pick your first word,
in any language, and shows it on a page in under a minute."

## Implementation notes

*2026-10-02, first build (branch `slice/22-welcome`), on [11](../11-local-first-mode/SPEC.md)'s
local mode, [20](../20-popup-redesign/SPEC.md)'s popup and [21](../21-dashboard/SPEC.md)'s
dashboard, before [13](../13-bulk-add/SPEC.md), [14](../14-matcher-engine/SPEC.md),
[24](../24-add-flow-safety/SPEC.md), [44](../44-docs-site/SPEC.md) and most of
[50](../50-ui-localization-and-base-language/SPEC.md). Requirements above are unchanged;
this records what exists now and what waits. No live call to any provider was made: every
lookup in the tests goes to the fixture server's fake model.*

**Built.**

- `extension/welcome.html|css|js`: one column (max 640 px of text beside a 40 px kitten),
  Kotiko's lines one under another, the learner's parts as controls, no Next buttons.
  Bundled scripts only (spec data, `lib/lang.js`, `lib/wordspec.js`, `lib/local-mode.js`,
  the matcher, `lib/i18n.js`, the icons, `lib/speak.js`, `lib/word-card.js`, the popover,
  `ui/confetti.js`, `lib/welcome-model.js`), so the page is complete on first paint. The
  rules are plain functions in `extension/lib/welcome-model.js` (also loaded by the
  background for detection).
- **When it opens (§1).** `runtime.onInstalled` with `reason: "install"` only: the background
  detects the bases, writes `onboarding: {completedAt: null, skipped: false, version: 2}`
  and opens `welcome.html` in a new active tab. `update` and `chrome_update` never open
  it; an update from before this slice sets `onboarding` done (`upgraded: true`) and, when
  the learner has words, marks `vocab:first` and `page:first-swap` done silently (rollout).
  `welcome.open` (extension pages only) brings an open welcome tab to the front with
  `runtime.getContexts` and `tabs.update`, or opens one; the popup's first-run card and
  the dashboard's About use it. The first word saved anywhere (the projection's `words`
  becoming non-empty) sets `completedAt`.
- **Bases (§2b, slice 50 §2 as far as 22 needs).** Detection at install: interface language
  plus `i18n.getAcceptLanguages()` (else `navigator.languages`) through 08's `baseTagOf`,
  deduplicated by same base, kept when `Intl.Segmenter` supports them, at most three.
  Stored where 50 says: `storage.sync` `ui: {uiLang, baseLangs, baseLangsDetected,
  baseLangsConfirmed}`, mirrored to `storage.local.baseLangs` (what the projection and the
  dashboard read). A reinstall keeps a list the learner already confirmed. Chips are
  `role="checkbox"` buttons named in the interface language ("Spanish, Español" when the
  endonym differs, endonym as tooltip), a "basic" tag with its explanation for Basic
  bases, untick (the last refused with `welcome_bases_last`), "+ Another" as a combobox
  over the languages this browser can segment (about 245 here; names in the interface
  language, endonyms and tags), at most four. Every change writes both copies at once; a
  card on screen is looked up (or, for a typed word, rebuilt) for the new bases.
  `toLocal` (11) now keeps `ui.baseLangs` in step with the local list. Not built: the
  dashboard's "Languages you read in", 50's upgrade rule beyond 11's, and per-base data
  other than `en` and `es`.
- **Connect your AI (§4).** "Connect OpenRouter (free)" is absent, as 11 decided, until the
  docs site serves the PKCE callback (44); **Paste an OpenRouter key (free)** is the primary
  button. The key field is `type="password"`, `autocomplete="off"`, `spellcheck="false"`,
  with Show; pasting (or Enter, or leaving the field) saves through `secrets.set`, makes
  OpenRouter the provider (`backend.set`) and runs 11's one-request check (`backend.test`);
  the field is cleared and shows "Saved key: sk-or-…a1b2". "Another service or my own
  model" lists 11's other presets: a local model is checked as soon as it is picked; an
  address or key is checked when entered. "My Kotiko server" sends the address and access
  key to `server.connect` and shows 25's server messages. "Skip: I'll type meanings myself"
  closes the step with a line that says how. Connected collapses the step to one line
  ("Connected to OpenRouter, free models." / "Connected to {provider}." / "Connected to your
  Kotiko server.") with Change; a failed check keeps the field with the message
  (`welcome_key_rejected`: "OpenRouter didn't accept your key. Check it and paste it
  again.", 25's others through `lib/lookup-status.js`), and the key stays saved.
- **Ask (§5).** The placeholder cycles every 4 s through `welcome_placeholder_1…4` (still
  under reduced motion). Try “hello” and the hints come from `spec/lang/<base>/welcome.json`
  (`en`, `es`; schema in `spec/lang/schema/`), else the interface locale's keys; the chip
  only fills the box. A line is read by `KotikoWelcomeModel.parseEntry`: a language prefix
  ("es: hola = hello"), then 24 §7's "native = meaning" syntax (11's `parseManual`; 13's
  `bulk/parse.js` doesn't exist yet), whose language comes from the prefix or from a script
  exactly one segmentable language uses by default (kana, Hangul, Thai, Georgian, Armenian,
  Greek…; Latin, Cyrillic, Arabic, Hebrew, Devanagari and Han ask), never the meaning's
  base. Those words are built on the page with 11's `manualWord`: no model, no network.
  State D offers six of the most-learned languages in that script (a static list in
  `welcome-model.js`; 08's data has none) minus the meaning's base, and the search.
  Anything else is looked up with `words.preview` (11's route: the learner's provider, or
  with a server 07's `preview: true` through `lib/words-v1.js`), with the ticked bases;
  a newer entry replaces a pending one. **Deviation:** 24's add queue with a
  `preview: true` job and `needs_choice` isn't built, so the page uses that stateless
  preview: nothing is written anywhere until "Make it my first word" (tested against the
  store, the projection and `addJobs`), and closing the tab leaves nothing behind. States
  B, C, C2 (a radio group; the chosen word's respelling, label and speak button below),
  D, E (the meaning form; connecting afterwards runs the lookup with no retyping) and F
  (`no_word_found`, `rejected_same_as_gloss`, offline and 25's lookup codes, then the
  meaning form) as specified. A typed word with several bases has a "Meaning in" select.
- **The card** is the popover's pronunciation block (`lib/word-card.js`): the stress-marked
  headword in the display role with its `lang` and `dir="auto"`, the speak button (34, shown
  only when a voice exists), the respelling with the stressed syllable in semibold, "Slowly:
  …", the romanization with "AI-generated" (no label for a typed word), the meaning (one
  base: "hello · Japanese"; several: "{gloss} · on pages in {base}" per base and the
  language). It takes focus, named "{word}, Pronunciation: …, stress on …, {meanings},
  {language}" from 19's keys.
- **Make it my first word (§6)** saves the chosen records with `words.save` and a fresh
  `client_request_id` (origin `add` for a looked-up word, `manual` for a typed one, one
  record per base the card has), sets `onboarding.completedAt` and
  `ui.baseLangsConfirmed`, and, for a learner with no words yet, claims `vocab:first`
  (`celebrations.claim`, below).
- **Celebration (§7).** "Congrats, you got your first word!" with a small card (word,
  respelling, speak button, meaning) and Turn off celebrations ("Off. You can turn them
  back on in Settings."). Confetti is 32's renderer (`ui/confetti.js`, see 32's notes),
  only when the claim succeeded, celebrations are on and motion isn't reduced; otherwise the
  section fades in over 120 ms. The ask step steps aside during the celebration; "Add
  another word" brings it back ("What would you like to learn next?", "Add this word", no
  celebration).
- **Preview (§8).** `pickPreview` runs the matcher pages use today (`lib/matcher.js`, with
  the same swap rules as `content.js`, minus the DOM) over `spec/lang/<base>/sentences.json`
  (98 sentences each for `en` and `es`, 6 to 12 words, written for this slice and checked
  for NFC and length) and picks the shortest sentence with a match, else the base's
  `fallback`, else "{gloss} → {native}" for a base with no file; a second pair for a second
  base. The before line is `--ink-3`, the after line real text with `<kotiko-w>` elements
  (the dotted underline, 06's swap motion, none under reduced motion) inside a `<figure>`
  with "Preview" as its caption, not a live region. The real popover (19) opens on them.
  Edit turns the before line into a field in the base's language; the after line updates
  on the next animation frame. Try it on a page links to the Wikipedia full-text search of
  the base (`simple` for `en`, the primary subtag otherwise, `zh` with `variant` for
  Chinese; 08's `languages.json` has no `wikipedia` field yet, so the mapping is in
  `welcome-model.js`), with "Opens a Wikipedia search for “hello”." as its description.
  Add another word, Open your words (the options page), Have a list already (the
  dashboard's `#add`; 13's bulk add doesn't exist yet), the pin tip by browser, the Find on
  page tip and, with no AI, "To look up words you don't know yet, connect your AI in
  Settings."
- **Skip for now (§9)** sets `onboarding = {completedAt, skipped: true}` and
  `baseLangsConfirmed`, then closes its own tab. **Reopened (§10)**: with words, the next
  question and no celebration; a connected AI shows as connected.
- **Step 0 (§3)**: `permissions.contains({origins: ["<all_urls>"]})`, Allow calls
  `permissions.request`, and a refusal shows `welcome_permission_declined`. Chrome grants
  host access at install, so it never shows there; the Firefox run is still to do.
- **Popup (20 §2 A).** Until `onboarding.completedAt`, the first-run card reads "Finish
  setting up Kotiko / Choose your first word, in any language. It takes under a minute."
  and Get started opens or focuses the welcome tab (`welcome.open`). After Skip with no
  words it is 11's card ("Add your first word", Set up lookups). The popup has no key field.
- **Dashboard (21).** Settings → About: "Show welcome again" and the "Why Kotiko?" story;
  Settings → Learning: 32's Celebrations switch (`prefs.celebrations`).
- **The story's single source (05 §1).** `scripts/sync-story.mjs` writes
  `docs/story/en.md` from 05's block quote and copies every `docs/story/<locale>.md`
  unchanged into `extension/story/` (a bundled file rather than `messages.json`, so the
  mascot's name stays out of the locale files); `--check` runs in CI's "versions and
  licenses" job and in `test/unit/story.test.mjs`. `docs/story/es.md` is a **placeholder**
  draft marked `PLACEHOLDER, NOT FOR RELEASE` until the native writer's version (05's
  brief); the About shows "This text is waiting for its final version." under it.
  `lib/story.js` renders the interface language's file, else English.
  `check-old-name.mjs` allows `docs/story/` and `extension/story/`.
- **Copy.** 90 new keys in `en` and `es` (the §13 table, the AI step, the states, the
  dashboard's About and Learning). The `{hello}` and examples come from the base's
  `welcome.json`. **Every `es` string is pending native review** (each says so in its
  description); to review: "Omitir por ahora", "Fija Kotiko", "Apaga Kotiko un momento desde
  su ventana", "aló (al teléfono)" in the fixtures. `welcome_ai_other` became
  `welcome_ai_another` (a `_other` suffix reads as a plural set to the i18n tests).

**Steps** (§11's counting; measured by the DOM tests where marked):

| Path | Steps to the celebrated first word | Then to a swap on a real page |
|---|---|---|
| "ありがとう = thanks", no key | 3 (tested) | +1 |
| "hola = hello", no key | 4 (tested) | +1 |
| "es: hola = hello", no key | 3 | +1 |
| Spanish reader: "hello = hola", no key | 4 | +1 |
| Paste an OpenRouter key, then ask | 5 (Paste an OpenRouter key, paste, type, Enter, Make it), plus getting the key | +1 |
| Another service at an address (local model: 3) | 4 to connect (link, pick, type the address, Enter), then 3 | +1 |
| Try “hello”, then ask (connected) | 4 | +1 |
| Bases detected wrong | +1 per chip changed | |
| Several results | +1 when choosing one other than the first | |
| Connect OpenRouter (one click) | waits for 44's callback page | |

**Waiting for other slices.** The one-click OpenRouter connect (44); 24's `preview: true`
add job and `needs_choice` (the page uses the stateless preview above); 13's `parse.js`
and bulk add; 14's segmenter matcher, without which a Japanese or Chinese base has no
working preview (the legacy matcher needs word boundaries); about 1,000 sentences per Full
base, `common.txt` and its CI coverage check, and `welcome.json`/`sentences.json` for more
bases, as native speakers contribute them (50 §5); 08's `wikipedia` field and the most-learned-per-script list as data;
50's dashboard base-language settings and upgrade rule; 32's page milestones; the Firefox
run (step 0 with a revoked permission, `welcome.open` without `getContexts` opens a new
tab); axe-core in Playwright (27); the native Spanish review, the Spanish story, the
five-person usability test and the manual screen-reader passes.

**Tests.** `test/unit/welcome-model.test.mjs` (detection with 50's examples, chips, the
script rule, prefixes, the meaning's base excluded, language search, candidate groups, the
preview per base with inflected and multi-word forms, fallback and no file, Edit, the
Wikipedia URLs, `welcome.json`/`sentences.json` against their schemas),
`test/unit/confetti.test.mjs`, `test/unit/celebrations.test.mjs`,
`test/unit/story.test.mjs` (the single-source check), `test/bg/welcome.test.mjs` (install
opens once with the browser's bases, a reinstall keeps confirmed bases, update and
`chrome_update` never open it and mark an old list's milestones, open-or-focus, content
scripts refused, a claim fired once under a race, the first word from the popup finishing
the first run), `test/dom/welcome.test.mjs` (21 tests against the real background: every
state in English and Spanish, the Puerto Rico page with a DOM scan for English strings,
3 and 4 steps with no request, nothing saved before the tap, two bases from one model call,
the refused key, confetti once, reduced motion, celebrations off, Skip, reopen, Edit, and
the key field only on full pages), dashboard tests for About and Learning, popup tests for
the new card, and `test/e2e/welcome.spec.mjs` (Chromium: the install opens the tab, a
fake provider is connected on the page, a word is asked, confirmed with confetti and
previewed, the popover opens on it, and Try it on a page swaps it on a stand-in for the
Wikipedia search; the typed path with no request at all; an update through the worker's
own `onInstalled` listener opens nothing, since an unpacked extension can't be updated in
this harness). Screenshots of every step in light and dark, English and Spanish:
`node test/visual/welcome-screenshots.mjs <dir>` (for review; not in CI).

## Open questions

1. **Which page does "Try it on a page" open?** Recommendation: a Wikipedia search in the
   primary base's language for the word's form in that base (Simple English for English
   readers; no tracking, and the snippets contain the word). The alternative, a fixed
   article, can't contain every learner's word.
2. **Show the detected languages, or ask?** Recommendation: show them as a line in the
   conversation that needs no action when right (most learners), rather than a question;
   asking would add a step to every first run to fix the few wrong guesses.
3. **Offer a hosted lookup option?** Recommendation: no, per [DECISIONS](../DECISIONS.md)
   (no shared hosted instance; learners bring their own key); OpenRouter's free key is the
   easy path.

## Future work

- A 20-second optional tour of the popup after the first word.
- Let the learner pick which sample sentence to keep as "their" sentence in the popover.
