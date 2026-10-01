# 34 · Pronunciation audio

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | S (a day or two) |
| **Depends on** | [19-word-popover](../19-word-popover/SPEC.md) |
| **Unblocks** | None |
| **Sources** | [05 S6, S27, wireframes 3.2 and 3.4](../../docs/research/05-learner-ux.md), [02 D4, D5, F1, F2](../../docs/research/02-linguistics.md), [03 E6](../../docs/research/03-browser-extension.md) |

## Problem

Mira has no audio. The only pronunciation help is a romanization in the `title` tooltip
(`extension/content.js:60-63`), and Latin-script languages get none at all, so French
"oiseau", Polish "chrząszcz" and Vietnamese tones are left to guesswork (02 F2). Romanization is
lossy anyway (02 F1). Learners need to hear a word (05 S27). Every major browser ships a speech
engine, so this costs no download and no server.

## Goals

- A speak button in the word popover (19), the dashboard (21) and the popup's add result (20),
  shown only when a suitable voice exists for the word's language.
- Local voices by default, so the word never leaves the device unless the user allows online
  voices.
- Japanese is spoken from its kana reading when one exists, so the engine doesn't guess a kanji
  reading.

## Non-goals

- Recorded human audio or a TTS service of Mira's own.
- Speaking whole sentences or the page.
- Reading-aid display (ruby, IPA): [37](../37-language-colors-and-reading-aids/SPEC.md) and [36](../36-grammar-and-senses/SPEC.md).

## User stories

- As a learner hovering "oiseau", I press the speaker and hear it in a French voice.
- As a learner on Linux with no Thai voice, I don't see a speaker that would mumble in English.
- As a privacy-minded learner, my words aren't sent to a voice service unless I opt in.

## Specification

Module: `extension/lib/speak.js`, used by content scripts and extension pages. It wraps the Web
Speech API (`speechSynthesis`), which works in content scripts and extension pages in Chrome and
Firefox. `chrome.tts` is not used: it is Chrome-only and needs another permission.

### API

```js
MiraSpeak.voiceFor(lang)        // -> SpeechSynthesisVoice | null (resolves after voices load)
MiraSpeak.canSpeak(lang)        // -> Promise<boolean>, for showing the button
MiraSpeak.say(word, { rate })   // speaks; cancels anything Mira was speaking
MiraSpeak.stop()
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

The stored word is spoken, never the page's surrounding text.

### Where the button appears

- **Popover (19):** a speaker icon button in the header row, labelled "Hear [native] in
  [Language]" for assistive technology. Hidden when `canSpeak` is false. Keyboard: the popover's
  focus order includes it; the key "S" while the popover is open speaks (19 owns key handling).
- **Dashboard (21):** a speaker per row, same rule.
- **Popup add result (20):** next to the added word ("Added gracias · Spanish [speaker] [undo]").
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
`s:display` group. The settings page lists, per language, the matched voice with a "Try" button
and a dropdown of alternatives, and says when none is installed: "No Thai voice on this device.
Your system's speech settings can add one." Online voices are labelled "(online)".

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
- [ ] The speak button is reachable and operable by keyboard and has an accessible name.

## Test plan

- **Unit (slice 02):** `voiceFor` against recorded voice lists; text selection rules.
- **Playwright:** popover speak button with a stubbed `speechSynthesis` that records utterances.
- **Manual:** Chrome and Firefox on Windows, macOS and Linux with French, Mandarin, Japanese,
  Arabic and Thai words.

## Rollout and migration

No data changes. Changelog: "Hear your words: press the speaker in the word card. Mira uses the
voices on your device."

## Open questions

1. **Online voices default.** Recommendation: off, for privacy; many Windows and macOS installs
   have good local voices.

## Future work

- A clear "no voice" hint with the exact system setting to install one, per operating system.
- Per-word recorded audio from open sources (for example Wikimedia Commons recordings) once
  licensing is settled.
