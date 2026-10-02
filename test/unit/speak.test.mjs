// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 34: choosing a voice (lib/speak.js pickVoice) against voice lists recorded from
// Windows, macOS, ChromeOS and Linux speech-dispatcher, what is spoken, and the speaker with
// a stubbed engine.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { requireExt } from "../helpers/load-script.mjs";
import { voiceLists } from "../helpers/speech-stub.mjs";

const { pickVoice, textFor, parseTag, createSpeaker } = requireExt("lib/speak.js");
const V = voiceLists();
const name = (v) => v?.name ?? null;
const local = { allowOnline: false };
const online = { allowOnline: true };

describe("parseTag", () => {
  test("normalizes separators, case and aliases", () => {
    assert.deepEqual(parseTag("zh_hant_tw"), { tag: "zh-Hant-TW", language: "zh", script: "Hant", region: "TW" });
    assert.equal(parseTag("cmn").language, "zh");
    assert.equal(parseTag("zh-yue").language, "yue");
    assert.equal(parseTag("SR-latn").tag, "sr-Latn");
    assert.equal(parseTag("ar-001").region, "001");
  });
});

describe("pickVoice: tiers (34 'Choosing a voice')", () => {
  test("an exact tag wins, then the same script, then the script's region", () => {
    const voices = [
      { name: "zh-TW voice", lang: "zh-TW", localService: true },
      { name: "zh-Hant voice", lang: "zh-Hant", localService: true },
      { name: "zh-Hant-TW voice", lang: "zh-Hant-TW", localService: true },
    ];
    assert.equal(name(pickVoice(voices, "zh-Hant-TW", local)), "zh-Hant-TW voice");
    assert.equal(name(pickVoice(voices.slice(0, 2), "zh-Hant", local)), "zh-Hant voice");
    assert.equal(name(pickVoice(voices.slice(0, 1), "zh-Hant", local)), "zh-TW voice");
  });

  test("zh-Hant maps to Taiwan, not Hong Kong (zh-HK voices are Cantonese)", () => {
    assert.equal(name(pickVoice(V.macos, "zh-Hant", local)), "Meijia");
    assert.equal(name(pickVoice(V["windows-chrome"], "zh-Hant", local)), "Microsoft Hanhan - Chinese (Traditional, Taiwan)");
    // Only a Hong Kong voice: none for Mandarin.
    assert.equal(pickVoice([{ name: "Sinji", lang: "zh-HK", localService: true }], "zh-Hant", local), null);
  });

  test("Mandarin zh gets a mainland voice; never a Cantonese one", () => {
    assert.equal(name(pickVoice(V.macos, "zh", local)), "Tingting");
    assert.equal(name(pickVoice(V["windows-chrome"], "zh", local)), "Microsoft Huihui - Chinese (Simplified, PRC)");
    assert.equal(name(pickVoice(V["linux-speech-dispatcher"], "zh", local)), "Chinese (Mandarin)+speech-dispatcher");
  });

  test("Cantonese yue gets a yue or zh-HK voice, never a Mandarin one", () => {
    assert.equal(name(pickVoice(V.macos, "yue", local)), "Sinji");
    assert.equal(name(pickVoice(V["windows-chrome"], "yue", local)), "Microsoft Tracy - Chinese (Traditional, Hong Kong S.A.R.)");
    assert.equal(name(pickVoice(V["linux-speech-dispatcher"], "yue", local)), "Chinese (Cantonese)+speech-dispatcher");
    assert.equal(pickVoice(V.chromeos, "yue", online), null, "ChromeOS has only Mandarin");
  });

  test("sr-Latn is read only by a Latin-script Serbian voice", () => {
    assert.equal(pickVoice(V["linux-speech-dispatcher"], "sr-Latn", local), null, "the plain sr voice is Cyrillic");
    const voices = [...V["linux-speech-dispatcher"], { name: "Serbian (Latin)", lang: "sr-Latn-RS", localService: true }];
    assert.equal(name(pickVoice(voices, "sr-Latn", local)), "Serbian (Latin)");
    assert.equal(name(pickVoice(voices, "sr", local)), "Serbian+speech-dispatcher", "and Cyrillic sr never gets the Latin voice");
  });

  test("the preferred variant comes before other regions (pt-BR before pt-PT)", () => {
    assert.equal(name(pickVoice(V.macos, "pt", { ...local, variants: { pt: "pt-BR" } })), "Luciana");
    assert.equal(name(pickVoice(V.macos, "pt", { ...local, variants: { pt: "pt-PT" } })), "Joana");
  });

  test("within a tier: local first, then the default voice, then by name", () => {
    const voices = [
      { name: "B", lang: "en-US", localService: true },
      { name: "A online", lang: "en-US", localService: false, default: true },
      { name: "C", lang: "en-US", localService: true, default: true },
    ];
    assert.equal(name(pickVoice(voices, "en", online)), "C");
    assert.equal(name(pickVoice(voices.slice(0, 1).concat({ name: "A", lang: "en-GB", localService: true }), "en", local)), "A");
  });

  test("Thai on Linux: no voice, so no speaker; macOS has one", () => {
    assert.equal(pickVoice(V["linux-speech-dispatcher"], "th", online), null);
    assert.equal(name(pickVoice(V.macos, "th", local)), "Kanya");
  });

  test("with online voices off, a voice with localService false is never used", () => {
    for (const list of Object.values(V).filter(Array.isArray)) {
      for (const lang of ["en", "es", "ru", "zh", "zh-Hant", "yue", "ja", "ar", "fr", "th", "de"]) {
        const v = pickVoice(list, lang, local);
        assert.ok(!v || v.localService !== false, `${lang}: ${name(v)}`);
      }
    }
    assert.equal(pickVoice(V["windows-chrome"], "th", local), null, "Windows' Thai voice is online only");
    assert.equal(name(pickVoice(V["windows-chrome"], "th", online)), "Google ภาษาไทย");
    assert.equal(name(pickVoice(V["windows-chrome"], "de", online)), null);
  });

  test("a voice the learner chose wins, unless it's online and online voices are off", () => {
    assert.equal(name(pickVoice(V["windows-chrome"], "es", { ...local, chosen: "Microsoft Sabina - Spanish (Mexico)" })), "Microsoft Sabina - Spanish (Mexico)");
    assert.equal(name(pickVoice(V["windows-chrome"], "es", { ...local, chosen: "Google español" })), "Microsoft Helena - Spanish (Spain)");
    assert.equal(name(pickVoice(V["windows-chrome"], "es", { ...online, chosen: "Google español" })), "Google español");
  });

  test("English is a target like any other: only Spanish voices means no speaker for 'dog'", () => {
    const spanishOnly = V.macos.filter((v) => v.lang.startsWith("es"));
    assert.equal(pickVoice(spanishOnly, "en", local), null);
    assert.equal(name(pickVoice(V.macos, "en", local)), "Alex");
  });
});

describe("textFor (34 'What is spoken')", () => {
  test("Russian, Ukrainian and Belarusian lose their U+0301 stress marks", () => {
    assert.equal(textFor({ native: "пожа́луйста", lang: "ru" }), "пожалуйста");
    assert.equal(textFor({ native: "дя́кую", lang: "uk" }), "дякую");
    assert.equal(textFor({ native: "дзя́куй", lang: "be" }), "дзякуй");
    assert.equal(textFor({ native: "ещё", lang: "ru" }), "ещё", "ё keeps its dots");
  });

  test("Japanese is spoken from its kana reading when there is one", () => {
    assert.equal(textFor({ native: "犬", reading: "いぬ", lang: "ja" }), "いぬ");
    assert.equal(textFor({ native: "ねこ", lang: "ja" }), "ねこ");
    assert.equal(textFor({ native: "犬", reading: "いぬ", lang: "zh" }), "犬", "only Japanese uses the reading");
  });

  test("never the pronunciation or romanization", () => {
    const word = { native: "пожалуйста", lang: "ru", pronunciation: "pa-ZHAL-sta", romanization: "pozhaluysta" };
    assert.equal(textFor(word), "пожалуйста");
  });
});

// A stubbed engine like Chrome's: voices arrive with voiceschanged.
function engine(voices, { async = false } = {}) {
  const listeners = [];
  const spoken = [];
  let list = async ? [] : voices;
  const synth = {
    getVoices: () => list,
    speak: (u) => spoken.push(u),
    cancel: () => spoken.push("cancel"),
    addEventListener: (type, fn) => type === "voiceschanged" && listeners.push(fn),
  };
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  return {
    synth,
    Utterance,
    spoken,
    load() {
      list = voices;
      for (const fn of [...listeners]) fn();
    },
  };
}

describe("the speaker", () => {
  test("waits for voices that load late (Chrome), then speaks with the matched voice", async () => {
    const e = engine(V.macos, { async: true });
    const s = createSpeaker({ synth: e.synth, Utterance: e.Utterance });
    const pending = s.canSpeak("ru");
    e.load();
    assert.equal(await pending, true);
    assert.equal(await s.say({ native: "пожа́луйста", lang: "ru", pronunciation: "pa-ZHAL-sta" }), true);
    const u = e.spoken.find((x) => x !== "cancel");
    assert.equal(u.text, "пожалуйста");
    assert.equal(u.voice.name, "Milena");
    assert.equal(u.lang, "ru-RU");
    assert.equal(u.rate, 0.9);
  });

  test("gives up waiting after a second with no voices", async () => {
    const e = engine([], { async: true });
    const timers = [];
    const s = createSpeaker({ synth: e.synth, Utterance: e.Utterance, setTimeout: (f) => timers.push(f) });
    const pending = s.canSpeak("ru");
    timers.forEach((f) => f());
    assert.equal(await pending, false);
  });

  test("no engine at all: nothing to speak", async () => {
    const s = createSpeaker({});
    assert.equal(await s.canSpeak("en"), false);
    assert.equal(await s.say({ native: "dog", lang: "en" }), false);
  });

  test("pressing again restarts: the previous utterance is cancelled first", async () => {
    const e = engine(V.macos);
    const s = createSpeaker({ synth: e.synth, Utterance: e.Utterance });
    await s.say({ native: "犬", reading: "いぬ", lang: "ja" });
    await s.say({ native: "犬", reading: "いぬ", lang: "ja" });
    assert.deepEqual(e.spoken.map((x) => (x === "cancel" ? x : x.text)), ["cancel", "いぬ", "cancel", "いぬ"]);
  });

  test("an engine error hides the speaker for that language for the page session", async () => {
    const e = engine(V.macos);
    const s = createSpeaker({ synth: e.synth, Utterance: e.Utterance });
    const errors = [];
    await s.say({ native: "شكرا", lang: "ar" }, { onError: (l) => errors.push(l) });
    const u = e.spoken.at(-1);
    u.onerror({ error: "interrupted" });
    assert.equal(await s.canSpeak("ar"), true, "our own cancel isn't a failure");
    u.onerror({ error: "synthesis-failed" });
    assert.deepEqual(errors, ["ar"]);
    assert.equal(await s.canSpeak("ar"), false);
    assert.equal(await s.canSpeak("ru"), true);
  });

  test("the meaning is spoken with a voice for the record's base language, never the target's", async () => {
    const e = engine(V.macos);
    const s = createSpeaker({ synth: e.synth, Utterance: e.Utterance });
    await s.say({ native: "perro", lang: "es" }); // 犬's gloss for a Spanish reader
    await s.say({ native: "dog", lang: "en" }); // and for an English reader
    const voices = e.spoken.filter((x) => x !== "cancel").map((u) => u.voice.name);
    assert.deepEqual(voices, ["Monica", "Alex"]);
  });

  test("online voices only when allowed; the setting applies at once", async () => {
    const e = engine(V.chromeos);
    const s = createSpeaker({ synth: e.synth, Utterance: e.Utterance });
    assert.equal(await s.canSpeak("ru"), false);
    s.configure({ allowOnline: true });
    assert.equal(await s.canSpeak("ru"), true);
  });

  test("rate comes from the settings; 'Slower' is 0.7", async () => {
    const e = engine(V.macos);
    const s = createSpeaker({ synth: e.synth, Utterance: e.Utterance });
    s.configure({ rate: 0.7 });
    await s.say({ native: "gracias", lang: "es" });
    assert.equal(e.spoken.at(-1).rate, 0.7);
  });
});
