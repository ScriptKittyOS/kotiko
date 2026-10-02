// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Word records in slice 07's v1 shape for the dashboard's tests and screenshots: twelve
// scripts, a right-to-left word, a word with records for two base languages (犬: "dog"
// and "perro"), a paused word, pronunciations with their source labels, and dates spread
// over the last months. `daysAgo` sets created_at relative to `now`.
const DAY = 86_400_000;

let n = 0;
function w(fields, daysAgo = 0, now = Date.UTC(2026, 9, 2, 10, 0, 0)) {
  n += 1;
  const at = new Date(now - daysAgo * DAY - n * 60_000).toISOString();
  return {
    id: fields.id ?? `0190a000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    base_lang: "en",
    status: "active",
    origin: "add",
    created_at: at,
    updated_at: at,
    ...fields,
  };
}

export function dashboardWords(now) {
  n = 0;
  const at = (f, d) => w(f, d, now);
  return [
    at({ lang: "ru", native: "спасибо", native_vocalized: "спаси́бо", romanization: "spasibo", gloss: "thanks", forms: ["thanks", "thank you"], pronunciation: "spa-SEE-ba", pronunciation_source: "model", note: "Everyday; add большое for “thank you very much”." }, 0),
    at({ lang: "ar", native: "شكرا", romanization: "shukran", gloss: "thanks", forms: ["thanks"], pronunciation: "SHUK-ran", pronunciation_source: "model", source_text: "thanks in arabic" }, 0),
    at({ lang: "ja", native: "ありがとう", romanization: "arigatō", gloss: "thank you", forms: ["thank you", "thanks"], pronunciation: "a-ri-ga-toh", pronunciation_source: "user" }, 1),
    at({ lang: "zh", native: "谢谢", romanization: "xièxie", gloss: "thanks", forms: ["thanks"], pronunciation: "shyeh4-shyeh", pronunciation_source: "model" }, 2),
    at({ lang: "es", native: "café", gloss: "coffee", forms: ["coffee"], pronunciation: "ka-FEH", pronunciation_source: "model" }, 2),
    at({ lang: "ru", native: "пожалуйста", native_vocalized: "пожа́луйста", romanization: "pozhaluysta", gloss: "please", forms: ["please", "you're welcome"], pronunciation: "pa-ZHAL-sta", pronunciation_careful: "pa-ZHA-luy-sta", pronunciation_source: "model" }, 3),
    at({ id: "0190a000-0000-7000-8000-0000000000a1", lang: "ja", native: "犬", romanization: "inu", gloss: "dog", forms: ["dog", "dogs"], pronunciation: "ee-noo", pronunciation_source: "model" }, 4),
    at({ id: "0190a000-0000-7000-8000-0000000000a2", lang: "ja", native: "犬", romanization: "inu", base_lang: "es", gloss: "perro", forms: ["perro", "perros"], pronunciation: "i-NU", pronunciation_source: "model" }, 4),
    at({ lang: "he", native: "תודה", romanization: "toda", gloss: "thanks", forms: ["thanks"], pronunciation: "toh-DAH", pronunciation_source: "model" }, 5),
    at({ lang: "ko", native: "고마워", romanization: "gomawo", gloss: "thanks", forms: ["thanks"] }, 6),
    at({ lang: "ru", native: "собака", romanization: "sobaka", gloss: "dog", forms: ["dog"], pronunciation: "sa-BA-ka", pronunciation_source: "model", status: "paused" }, 9),
    at({ lang: "es", native: "niño", gloss: "child", forms: ["child", "kid"], pronunciation: "NEE-nyo", pronunciation_source: "model" }, 12),
    at({ lang: "ar", native: "كتاب", romanization: "kitāb", gloss: "book", forms: ["book"], pronunciation: "ki-TAAB", pronunciation_source: "model" }, 15),
    at({ lang: "el", native: "ευχαριστώ", romanization: "efcharistó", gloss: "thank you", forms: ["thank you"], pronunciation: "ef-ha-ree-STOH", pronunciation_source: "model" }, 18),
    at({ lang: "hi", native: "धन्यवाद", romanization: "dhanyavād", gloss: "thank you", forms: ["thank you"] }, 21),
    at({ lang: "zh", native: "你好", romanization: "nǐ hǎo", gloss: "hello", forms: ["hello", "hi"] }, 24),
    at({ lang: "de", native: "Hund", gloss: "dog", forms: ["dog"], pronunciation: "HOONT", pronunciation_source: "model" }, 30),
    at({ lang: "tr", native: "teşekkürler", gloss: "thanks", forms: ["thanks"] }, 34),
    at({ lang: "ru", native: "дом", romanization: "dom", gloss: "house", forms: ["house", "home"], pronunciation: "DOM", pronunciation_source: "model" }, 40),
    at({ lang: "ar", native: "بيت", romanization: "bayt", gloss: "house", forms: ["house"], note: "Masculine." }, 46),
    at({ lang: "ja", native: "猫", romanization: "neko", gloss: "cat", forms: ["cat", "cats"] }, 52),
    at({ lang: "fr", native: "merci", gloss: "thanks", forms: ["thanks"], pronunciation: "mer-see", pronunciation_source: "model" }, 60),
    at({ lang: "es", native: "agua", gloss: "water", forms: ["water"], pronunciation: "AH-gwa", pronunciation_source: "model" }, 75),
    at({ lang: "ru", native: "кошка", romanization: "koshka", gloss: "cat", forms: ["cat"], pronunciation: "KOSH-ka", pronunciation_source: "model" }, 90),
  ];
}

// `count` generated records over twelve languages, for performance tests.
export function manyWords(count, now = Date.UTC(2026, 9, 2, 10, 0, 0)) {
  const langs = ["ru", "ar", "ja", "zh", "es", "he", "ko", "el", "hi", "de", "tr", "fr"];
  const out = [];
  for (let i = 0; i < count; i++) {
    const at = new Date(now - i * 60_000).toISOString();
    out.push({
      id: `0190b000-0000-7000-8000-${i.toString(16).padStart(12, "0")}`,
      lang: langs[i % langs.length],
      native: `кот${i}`,
      romanization: `kot${i}`,
      base_lang: "en",
      gloss: `meaning ${i}`,
      forms: [{ text: `meaning ${i}`, enabled: true }],
      pronunciation: i % 3 ? null : `KOT-${i}`,
      status: i % 17 ? "active" : "paused",
      origin: "add",
      created_at: at,
      updated_at: at,
    });
  }
  return out;
}
