# 34 · Pronunciation audio

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | S (a day or two) |
| **Depends on** | [19-word-popover](../19-word-popover/SPEC.md) (built together and shipped in the same release: the button lives in the popover, and the popover relies on it); [07-word-model-v2](../07-word-model-v2/SPEC.md) for `native`, `reading` and the written pronunciation it complements; uses [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) for labels and the `base_lang` of a record |
| **Unblocks** | [19](../19-word-popover/SPEC.md) (its speak button), [35](../35-reveal-mode-and-review/SPEC.md) (hearing a word in review) |
| **Sources** | [DECISIONS 2026-10-02, pronunciation and audio at P0](../DECISIONS.md); [05 S6, S27, wireframes 3.2 and 3.4](../../docs/research/05-learner-ux.md), [02 D4, D5, F1, F2](../../docs/research/02-linguistics.md), [03 E6](../../docs/research/03-browser-extension.md) |

## Problem

Kotiko has no audio. The only pronunciation help is a romanization in the `title` tooltip
(`extension/content.js:60-63`), and Latin-script languages get none at all, so French
"oiseau", Polish "chrząszcz" and Vietnamese tones are left to guesswork (02 F2). Romanization is
lossy anyway (02 F1). Learners need to hear a word (05 S27). Every major browser ships a speech
engine, so this costs no download and no server.

The maintainer moved this slice from P1 to P0 ([DECISIONS 2026-10-02](../DECISIONS.md)) after a
learner was shown "pazhaluysta" for пожалуйста, which is said "pa-ZHAL-sta". Slice 07 now
splits a standard `romanization` from a learner `pronunciation` respelling, but that respelling
is still written by a model and can be wrong. A voice on the learner's own device is the most
reliable pronunciation aid Kotiko can offer, so it ships in the first release, next to the
respelling in the popover.

## Goals

- A speak button in the word popover (19), the dashboard (21) and the popup's add result (20),
  shown only when a suitable voice exists for the word's language.
- Local voices by default, so the word never leaves the device unless the user allows online
  voices.
- Japanese is spoken from its kana reading when one exists, so the engine doesn't guess a kanji
  reading.
- The same rules for every learner, whatever their base language: English is a target like
  any other, so a Spanish reader learning English hears "dog" in an English voice.
- Ships in the first public release with the popover (19), in English and Spanish, on Chrome
  and Firefox on Windows, macOS and Linux.
- Audio and the written pronunciation (07 section 7) work as one aid: the learner reads the
  stress and hears the sounds, side by side.

## Non-goals

- Recorded human audio or a TTS service of Kotiko's own.
- Speaking whole sentences or the page.
- Reading-aid display (ruby, IPA): [37](../37-language-colors-and-reading-aids/SPEC.md) and [36](../36-grammar-and-senses/SPEC.md).
- The written pronunciation (`pronunciation`, `romanization`): fields and rules in
  [07](../07-word-model-v2/SPEC.md) section 7, prompt in [09](../09-shared-word-spec-and-prompt/SPEC.md),
  display in [19](../19-word-popover/SPEC.md), dictionary checks in [49](../49-dictionary-verification/SPEC.md).

## User stories

- As a learner hovering "oiseau", I press the speaker and hear it in a French voice.
- As a Spanish reader learning English, I hover "dog" on a Spanish page, press the speaker,
  and hear it in an English voice, with the button labelled in Spanish ("Escuchar dog en
  inglés").
- As a learner on Linux with no Thai voice, I don't see a speaker that would mumble the
  word in some other language's voice.
- As a privacy-minded learner, my words aren't sent to a voice service unless I opt in.
- As a learner who reads "pa-ZHAL-sta" in the popover, I press the speaker right next to it and
  hear the same word, so I can check the respelling against a real voice.

## Specification

Module: `extension/lib/speak.js`, used by content scripts and extension pages. It wraps the Web
Speech API (`speechSynthesis`), which works in content scripts and extension pages in Chrome and
Firefox. `chrome.tts` is not used: it is Chrome-only and needs another permission.

### API

```js
KotikoSpeak.voiceFor(lang)        // -> SpeechSynthesisVoice | null (resolves after voices load)
KotikoSpeak.canSpeak(lang)        // -> Promise<boolean>, for showing the button
KotikoSpeak.say(word, { rate })   // speaks; cancels anything Kotiko was speaking
KotikoSpeak.stop()
```

### Choosing a voice

Voices load asynchronously in Chrome (`voiceschanged`) and synchronously in Firefox. `speak.js`
waits for the first non-empty `getVoices()` or 1 s, then caches the list per document and
updates it on `voiceschanged`.

```
voiceFor(lang):
  if settings.speech.voices[primary(lang)] names an installed voice: return it
  pool = voices filtered by allowOnline ? all : localService == true
  normalize every voice.lang: "_" -> "-", case-insensitive
  try in order, first match wins:
    1. exact tag (zh-Hant-TW against zh-Hant-TW)
    2. same language and script (zh-Hant: zh-TW, zh-HK voices; sr-Latn: sr-Latn voices only)
    3. same language and the user's preferred variant (36: pt-BR before pt-PT)
    4. same language and the region most associated with the script (zh-Hans: zh-CN; zh-Hant: zh-TW)
    5. same primary language, any region, unless the script differs (never read sr-Latn with a
       Cyrillic-only voice, never Cantonese yue with a Mandarin zh voice)
  within a tier: prefer localService, then the voice marked default, then name order
  return null if nothing matched
```

Script awareness matters: Cantonese (`yue`) needs a `yue` or `zh-HK` Cantonese voice; `zh-HK`
voices are Cantonese on most systems, so tier 4 maps `zh-Hant` to `zh-TW` first, not `zh-HK`.

### What is spoken

```
text = word.reading if primary(lang) == "ja" and reading is present (36)
       else word.native
remove U+0301 combining stress marks for ru, uk, be (many engines mispronounce them)
utterance.lang = voice.lang; utterance.voice = voice; utterance.rate = settings.speech.rate
```

The stored word is spoken, never the page's surrounding text, and never the `pronunciation` or
`romanization` text: a respelling read by a voice for the target language is gibberish, and read
by a base-language voice it teaches a foreign accent. A bilingual reader's records
for one target word (one per base, [50 §3](../50-ui-localization-and-base-language/SPEC.md))
share `lang` and `native`, so they sound the same and share one per-language voice choice.

**The base side.** Kotiko speaks the target word only. It never speaks a gloss or the page's
own word on its own. If a surface does offer to speak the meaning (a future "hear the
meaning" in 35's review, or a screen-reader-like setting), it calls
`KotikoSpeak.say({native: word.gloss, lang: word.base_lang})`, so the gloss is spoken with a
voice for the record's base language ("perro" in a Spanish voice, "dog" in an English
voice), chosen by the same tiers; it is never read with the target language's voice or with
a default voice that happens to be English.

### Audio and the written pronunciation

The popover shows the word with its stress mark, then the respelling, then the romanization,
with the speak button on the word's line (19). Each does a different job:

- **Audio is the most reliable aid for the sounds**: vowel quality, the reduction of unstressed
  vowels, rhythm, and Mandarin tones as actually said (with tone sandhi, matching the
  respelling's digits rather than pinyin's dictionary tones). It comes from the device's own
  speech engine, not from the model, so there is nothing for the model to get wrong.
- **The respelling shows what audio can't**: which syllable is stressed, written down to
  remember; the careful form next to the everyday one; and something to read when no voice is
  installed, when the sound is off, or on a page read in silence.
- **Where they can disagree.** Engines guess stress on rare words and on Russian words that
  differ only in stress (замок "castle" ZA-mak and "lock" za-MOK), because `native` is spoken
  without its U+0301 mark (above). For those, the stress mark and the respelling, checked
  against a dictionary where one is installed (49), are the reference. The popover never
  hides one because of the other.
- **Without a voice**, the button is hidden as before and the respelling and stress mark carry
  the word alone; the dashboard's voice settings say how to add a voice.

### Where the button appears

- **Popover (19):** a speaker icon button in the header row, labelled from the
  `speak_label` message ("Hear $WORD$ in $LANG$" / "Escuchar $WORD$ en $LANG$", 50) for
  assistive technology, with the language name from `Intl.DisplayNames([uiLocale])` and the
  word wrapped in its own `lang`. Hidden when `canSpeak` is false. Keyboard: the popover's
  focus order includes it; the key "S" while the popover is open speaks (19 owns key handling).
- **Dashboard (21):** a speaker per row, same rule.
- **Popup add result (20):** next to the added word ("Added gracias · Spanish [speaker]
  [undo]" / "Agregada dog · inglés [altavoz] [deshacer]").
- An optional "Speak words when I open them" setting (off) speaks on popover open after a user
  gesture; browsers require user activation, which hover alone isn't, so it applies to click and
  tap only.

Pressing again while speaking restarts. `onerror` hides the button for that language for the
rest of the page session and logs nothing to the page.

### Settings

```ts
speech: {
  allowOnline: boolean;            // default false
  rate: number;                    // default 0.9; "Slower" sets 0.7
  voices: Record<Lang, string>;    // voiceURI per language; per device
}
```

`voices` is stored in `storage.local` (voices differ per device); the rest in slice 39's
`s:display` group. The settings page lists, per target language, the matched voice with a
"Try" button and a dropdown of alternatives, and says when none is installed: "No Thai voice on
this device. Your system's speech settings can add one." ("No hay voz en tailandés en este
dispositivo. La configuración de voz de tu sistema puede agregar una.") Online voices are
labelled "(online)" / "(en línea)". All of it comes from `_locales`.

### Privacy

Local voices run on the device. Online voices (for example Chrome's "Google" voices, whose
`localService` is false) send the word to the browser vendor's speech service. They are off by
default; the toggle reads "Allow online voices. The word you play is sent to your browser's
voice service." Slice 28 lists this in the privacy policy.

## Acceptance criteria

- [ ] The speaker appears only when `voiceFor(lang)` returns a voice; with a stubbed voice list
      lacking Thai, a Thai word shows no button.
- [ ] Voice choice follows the tier order, including sr-Latn and yue cases (unit tests with
      stubbed voice lists from Windows, macOS, ChromeOS and Linux speech-dispatcher).
- [ ] With `allowOnline` false, no voice with `localService == false` is ever used.
- [ ] Japanese words with a reading are spoken from the reading.
- [ ] With base `es`, the English word "dog" is spoken with an English voice; a stubbed voice
      list with only Spanish voices shows no speaker for it.
- [ ] `say({native: gloss, lang: base_lang})` picks a voice for the base language (Spanish
      for "perro", English for "dog"), never the target's voice.
- [ ] The speaker's accessible name and the settings copy are in Spanish when the interface
      is Spanish.
- [ ] The speak button is reachable and operable by keyboard and has an accessible name.
- [ ] The popover's speak button sits on the native word's line, and a recorded utterance for
      пожалуйста is "пожалуйста" (no U+0301), never its `pronunciation` or `romanization`.
- [ ] Mandarin, Japanese, Russian, Arabic and (base `es`) English words are spoken in the
      Playwright run with a stubbed voice list, from a fresh profile, in the release build.

## Test plan

- **Unit (slice 02):** `voiceFor` against recorded voice lists; text selection rules.
- **Playwright:** popover speak button with a stubbed `speechSynthesis` that records utterances.
- **Manual, before the first public release (a release checklist item in
  [30](../30-release-pipeline/SPEC.md)):** Chrome and Firefox on Windows, macOS and Linux with
  French, Mandarin, Japanese, Arabic, Russian, Thai and (for a Spanish base) English words;
  for each, note whether the voice's stress agrees with the popover's respelling for the
  Russian pronunciation cases in [09](../09-shared-word-spec-and-prompt/SPEC.md) section 6,
  and file disagreements against the respelling or the engine.

## Rollout and migration

No data changes. Ships in the first public release together with the popover (19), with no
flag: the popover's design assumes the button. The privacy policy (28) and the store listings
mention the optional online voices from that release on, and the voice settings are part of the
dashboard's settings (21) at launch. Changelog: "Hear your words: press the speaker in the word
card, next to how the word is written for you. Kotiko uses the voices on your device."

## Open questions

1. **Online voices default.** Recommendation: off, for privacy; many Windows and macOS installs
   have good local voices.
2. **Speak `native_vocalized` for stress homographs?** Passing the stress mark would settle
   замок, but many engines mispronounce U+0301. Recommendation: not at launch; record per engine
   in the manual matrix whether the mark helps, and enable it per voice later if it does.

## Future work

- A clear "no voice" hint with the exact system setting to install one, per operating system.
- Per-word recorded audio from open sources (for example Wikimedia Commons recordings) once
  licensing is settled.

## Implementation notes

*2026-10-02, first build, with [19](../19-word-popover/SPEC.md)'s word card. Requirements
above are unchanged; this records what exists now and what waits for other slices.*

**Built.**

- `extension/lib/speak.js`: `KotikoSpeak.voiceFor`, `canSpeak`, `say`, `stop`, plus
  `configure(settings)`, the pure `pickVoice(voices, lang, opts)` and `textFor(word)`,
  and `createSpeaker({ synth, Utterance })` for tests. Voices: the first non-empty
  `getVoices()` or 1 s, cached per document, refreshed on `voiceschanged`.
- Voice choice follows the tiers, with these readings of the spec: tags are normalized
  (`_` to `-`, case, `cmn` to `zh`, `zh-yue` to `yue`); a voice with no script gets one
  from its region (`zh-TW`, `zh-HK`, `zh-MO`: Hant; `zh-CN`, `zh-SG`: Hans) or its
  language's usual one (`sr`: Cyrillic, `zh`: Hans). Cantonese and Mandarin never stand in
  for each other: `yue`, `zh-HK` and `zh-MO` voices (and names saying Cantonese) are used
  for `yue` only, so `zh-Hant` takes a `zh-TW` voice and never a Hong Kong one; `sr-Latn`
  takes only a Latin Serbian voice and Cyrillic `sr` never does. Within a tier: local,
  then default, then name. The learner's chosen voice (`voices[lang]`) wins when it is in
  the allowed pool.
- What is spoken: `reading` for Japanese when present, else `native`; U+0301 removed for
  ru, uk and be (ё keeps its dots); never `pronunciation` or `romanization`. A gloss is
  spoken with `say({ native: gloss, lang: base_lang })`, which picks a base-language voice
  by the same tiers (tested; no surface offers it yet).
- The speak button in the word card: on the word's line, hidden until `canSpeak` says
  yes, named by `speak_label` with the word in its own `lang`; **S** speaks; pressing again
  restarts; an engine error (other than our own cancel) hides it for that language for the
  page session. Rate 0.9.
- Settings: one `speech` key in `storage.local` (`{ allowOnline: false, rate: 0.9,
  voices: {} }`), read by the content script and applied at once when it changes. 39's
  `s:display` group doesn't exist yet, so `allowOnline` and `rate` live there too. The
  popup's settings view has a "Voices" section with the switch "Allow online voices" and
  its privacy line (`settings_voices`, `settings_online_voices`,
  `settings_online_voices_help`; Spanish pending native review).
- Tests: `test/unit/speak.test.mjs` against voice lists recorded per system in
  `test/fixtures/speech/voices.json` (Windows with Chrome's online voices, macOS, ChromeOS,
  Linux speech-dispatcher): every tier, zh-Hant, yue, sr-Latn, Thai missing on Linux,
  online voices off, a chosen voice, English for a Spanish reader, late-loading voices,
  restart, errors, the base-language voice for a gloss. `test/dom/popover.test.mjs` and
  `test/e2e/popover.spec.mjs` speak Russian (no U+0301), Mandarin, Japanese (from いぬ),
  Arabic and English (base `es`) through a stubbed engine; in Chromium the stub is put
  into the content script's isolated world over the DevTools protocol
  (`test/helpers/speech-stub.mjs`), which page scripts can't reach either.
- The manual check for the release checklist: [`docs/release/voice-check.md`](../../docs/release/voice-check.md).

**Not built yet.**

- The speaker in the dashboard's rows ([21](../21-dashboard/SPEC.md)) and in the popup's
  add result ([20](../20-popup-redesign/SPEC.md)); the dashboard's per-language voice list
  with "Try", the alternatives dropdown and the "No Thai voice on this device" line; the
  "Slower" rate choice; the "Speak words when I open them" setting.
- `reading` from the server: the field arrives with [36](../36-grammar-and-senses/SPEC.md),
  so a Japanese word synced today is spoken from its kanji.
- The privacy policy and store listing lines about online voices ([28](../28-privacy-and-store-readiness/SPEC.md)).
- Firefox and the release build in the Playwright run (Chromium only today).
