// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Word records for the word card (slice 19) and audio (slice 34) tests: the legacy
// `GET /api/words` shape plus slice 07's pronunciation fields, one per case the card has
// to handle. Used by the jsdom tests, the Playwright specs and the screenshot script.

const word = (id, fields) => ({
  id,
  language: null,
  romanization: null,
  note: null,
  base_lang: "en",
  native_vocalized: null,
  pronunciation: null,
  pronunciation_careful: null,
  pronunciation_source: null,
  ...fields,
  forms: fields.forms ?? [fields.english],
});

// Russian with a stress mark, a respelling and a careful form (19 acceptance 7).
export const PLEASE = word(11, {
  lang: "ru",
  language: "Russian",
  native: "пожалуйста",
  native_vocalized: "пожа́луйста",
  romanization: "pozhaluysta",
  pronunciation: "pa-ZHAL-sta",
  pronunciation_careful: "pa-ZHA-lu-sta",
  pronunciation_source: "model",
  english: "please",
});

// Mandarin with a tone digit and a note; "thanks" also has спасибо (the "Also" line).
export const THANKS_ZH = word(12, {
  lang: "zh",
  language: "Chinese",
  native: "谢谢",
  romanization: "xièxie",
  pronunciation: "shyeh4-shyeh",
  pronunciation_source: "model",
  english: "thanks",
  forms: ["thanks", "thank you"],
  note: "谢谢你 is \"thank you\" to one person; 多谢 is warmer.",
});

export const THANKS_RU = word(18, {
  lang: "ru",
  language: "Russian",
  native: "спасибо",
  native_vocalized: "спаси́бо",
  romanization: "spasibo",
  pronunciation: "spa-SEE-ba",
  pronunciation_source: "model",
  english: "thanks",
  forms: ["thanks", "thank you"],
});

// Japanese with its kana reading (spoken by 34 instead of the kanji).
export const DOG = word(13, {
  lang: "ja",
  language: "Japanese",
  native: "犬",
  reading: "いぬ",
  romanization: "inu",
  pronunciation: "ee-noo",
  pronunciation_source: "model",
  english: "dog",
  forms: ["dog", "dogs"],
});

// No pronunciation yet (07 §8's refresh hasn't reached it): romanization only, no label.
export const BOOK = word(14, {
  lang: "ar",
  language: "Arabic",
  native: "كتاب",
  romanization: "kitab",
  english: "book",
});

// Checked against a dictionary (49): "Checked in Wiktionary".
export const GOOD = word(15, {
  lang: "ru",
  language: "Russian",
  native: "хорошо",
  native_vocalized: "хорошо́",
  romanization: "khorosho",
  pronunciation: "kha-ra-SHO",
  pronunciation_source: "model",
  verification: { pronunciation: { status: "verified", source: "Wiktionary" } },
  english: "good",
});

// The learner's own respelling of a Latin-script word: no romanization, no label.
export const WATER = word(16, {
  lang: "es",
  language: "Spanish",
  native: "agua",
  pronunciation: "A-gwa",
  pronunciation_source: "user",
  english: "water",
});

// The model stressed "castle" like "lock" (za-MOK); the dictionary says за́мок (49
// "differs"), and the first line shows the dictionary's form.
export const CASTLE = word(17, {
  lang: "ru",
  language: "Russian",
  native: "замок",
  native_vocalized: "замо́к",
  romanization: "zamok",
  pronunciation: "za-MOK",
  pronunciation_source: "model",
  verification: { pronunciation: { status: "differs", source: "Wiktionary", stressed: "за́мок" } },
  english: "castle",
});

// English is a target like any other (34): "dog" for a Spanish reader, in place of "perro".
export const DOG_EN = word(19, {
  lang: "en",
  language: "English",
  native: "dog",
  base_lang: "es",
  pronunciation: "dog",
  pronunciation_source: "model",
  english: "perro",
});

export const POPOVER_WORDS = [PLEASE, THANKS_ZH, THANKS_RU, DOG, BOOK, GOOD, WATER, CASTLE, DOG_EN];
