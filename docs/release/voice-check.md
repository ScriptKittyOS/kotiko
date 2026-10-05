# Voice check (release checklist)

The manual test from [slice 34](../../slices/34-pronunciation-audio/SPEC.md#test-plan),
ticked in the release pull request for the first public release and for any release that
changes the word card ([19](../../slices/19-word-popover/SPEC.md)), audio (34), the
respelling keys or the pronunciation prompt ([07](../../slices/07-word-model-v2/SPEC.md),
[09](../../slices/09-shared-word-spec-and-prompt/SPEC.md)). It belongs to slice 30's
release checklist ([`docs/stores.md`](../stores.md#release-checklist)), which links here.

Automated tests cover voice choice against recorded voice lists and a stubbed engine. This
check covers what they can't: real voices, and whether a voice's stress agrees with the
written respelling.

## Setup

1. Build the extension as released (or load `extension/` unpacked) in a fresh browser
   profile: Chrome and Firefox, each on Windows, macOS and Linux.
2. Add these words (popup, or the server's `/api/words`), with English as the base, plus
   one record with a Spanish base:

   | Word | Language | Base | What it checks |
   |---|---|---|---|
   | oiseau | French | en | A Latin-script word with no romanization |
   | 谢谢 | Mandarin | en | Tones; never a Cantonese voice |
   | 犬 (いぬ) | Japanese | en | Spoken from the kana reading, not the kanji (once the server stores `reading`, slice 36; until then the voice reads the kanji and may guess) |
   | شكرا | Arabic | en | Right-to-left word, Arabic voice |
   | пожалуйста | Russian | en | Stress mark stripped before speaking; reduced vowels |
   | the Russian cases in [09 §6](../../slices/09-shared-word-spec-and-prompt/SPEC.md) (пожалуйста, молоко, здравствуйте, and замок as "castle" and as "lock") | Russian | en | Stress against the respelling |
   | ขอบคุณ | Thai | en | No speaker when no Thai voice is installed |
   | dog | English | es | English is a target like any other, with a Spanish interface |

3. List the voices the browser sees: open any page, then the developer console, and run
   `speechSynthesis.getVoices().map((v) => [v.name, v.lang, v.localService])`.
   On Linux, Chrome and Firefox use speech-dispatcher; with no voices installed the list is
   empty and no speaker should appear anywhere.

## For each browser and system

- [ ] Hover each word: the speaker shows only when a voice for its language is listed
      (Thai on a system without a Thai voice: no speaker).
- [ ] Press the speaker, and press **S** with the card open: the word is spoken in a voice
      of its language. 犬 with a reading is read as "inu". Nothing is read in the wrong language's voice.
- [ ] Press again while it speaks: it restarts, it doesn't queue.
- [ ] With "Allow online voices" off (the default, popup settings), no online voice is used
      (in Chrome, voices named "Google …" are online). Turn it on: online voices may be
      used. Turn it off again.
- [ ] Interface in Spanish (browser language Spanish): the speaker's accessible name says
      "Escuchar … en …" (check with a screen reader or the accessibility inspector).
- [ ] Keyboard: select a swapped word, press Alt+Shift+R; focus lands on the speaker;
      Enter plays; Esc closes and the selection comes back.
- [ ] For each Russian case, note whether the voice stresses the same syllable as the
      respelling's capitals and the stress mark on the first line.

## Results

Paste into the release pull request. File each disagreement against the respelling (a
prompt or key bug) or the engine (a voice that ignores stress), before ticking the box.

| Platform | Browser | Voice | Word | Speaker shown | Agrees with respelling | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |

Open question from 34 to record here: whether speaking `native_vocalized` (with its U+0301
stress mark) helps a voice with stress homographs such as замок. Kotiko strips the mark
today because many engines mispronounce it.
