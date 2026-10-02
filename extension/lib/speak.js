// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Pronunciation audio (slice 34): speaks a saved word with a voice from the device's own
// speech engine (the Web Speech API), never a Kotiko service. Runs in content scripts and
// extension pages (globalThis.KotikoSpeak) and in Node tests (module.exports, with a
// stubbed engine passed to createSpeaker).
//
//   KotikoSpeak.configure({ allowOnline: false, rate: 0.9, voices: {} })
//   await KotikoSpeak.canSpeak("ru")          -> true when a matching voice exists
//   await KotikoSpeak.voiceFor("zh-Hant")     -> SpeechSynthesisVoice | null
//   KotikoSpeak.say({ native: "пожа́луйста", lang: "ru" })   speaks "пожалуйста"
//   KotikoSpeak.say({ native: gloss, lang: base_lang })     the meaning, in a base voice
//   KotikoSpeak.stop()
//
// Only the stored word is spoken: `reading` for Japanese when there is one, else
// `native`, with U+0301 stress marks removed for ru, uk and be (many engines mispronounce
// them). Never `pronunciation` or `romanization`: a respelling read aloud is gibberish.
// Online voices (localService false: the browser sends the text to its vendor) are left out
// unless the learner allows them.
(() => {
  const STRESS_MARK = /́/g;
  const STRESS_LANGS = new Set(["ru", "uk", "be"]);
  // Languages whose voices are listed under another code on some systems.
  const ALIASES = { cmn: "zh", "zh-yue": "yue", iw: "he", in: "id", ji: "yi", nb: "no", nn: "no" };
  // The script a language is written in when its tag doesn't say, where it matters for
  // choosing a voice (slice 34 tier 5: never read sr-Latn with a Cyrillic-only voice).
  const DEFAULT_SCRIPT = { zh: "Hans", sr: "Cyrl", yue: "Hant" };
  const REGION_SCRIPT = { "zh-TW": "Hant", "zh-HK": "Hant", "zh-MO": "Hant", "zh-CN": "Hans", "zh-SG": "Hans" };
  // The region most associated with a script (tier 4). zh-Hant goes to Taiwan, not Hong
  // Kong: zh-HK voices are Cantonese on most systems.
  const SCRIPT_REGION = { "zh-Hans": "CN", "zh-Hant": "TW" };
  const CANTONESE_NAME = /cantonese|粵|粤|廣東|广东/i;
  const LOAD_TIMEOUT_MS = 1000;

  // "zh_hant_tw" -> { tag: "zh-Hant-TW", language: "zh", script: "Hant", region: "TW" }
  function parseTag(raw) {
    const parts = String(raw ?? "").trim().replace(/_/g, "-").split("-").filter(Boolean);
    let language = (parts.shift() ?? "").toLowerCase();
    if (parts[0]?.toLowerCase() === "yue" && language === "zh") {
      language = "yue";
      parts.shift();
    }
    language = ALIASES[language] ?? language;
    let script = null;
    let region = null;
    for (const p of parts) {
      if (!script && /^[A-Za-z]{4}$/.test(p)) script = p[0].toUpperCase() + p.slice(1).toLowerCase();
      else if (!region && (/^[A-Za-z]{2}$/.test(p) || /^\d{3}$/.test(p))) region = p.toUpperCase();
    }
    const tag = [language, script, region].filter(Boolean).join("-");
    return { tag, language, script, region };
  }

  // Cantonese is its own language for voices: `yue`, or a zh-HK / zh-MO voice, or one
  // whose name says so.
  function isCantonese(t, name = "") {
    return t.language === "yue" || (t.language === "zh" && (t.region === "HK" || t.region === "MO")) || CANTONESE_NAME.test(name);
  }

  const scriptOf = (t) => t.script ?? REGION_SCRIPT[`${t.language}-${t.region}`] ?? DEFAULT_SCRIPT[t.language] ?? null;
  const primary = (lang) => parseTag(lang).language;

  // The best voice for `lang` from `voices`, or null (slice 34 "Choosing a voice").
  //   opts.allowOnline  false: voices with localService false are never returned
  //   opts.chosen       a voiceURI the learner picked for this language (settings.voices)
  //   opts.variants     preferred variants, e.g. { pt: "pt-BR" } (slice 36)
  function pickVoice(voices, lang, opts = {}) {
    const { allowOnline = false, chosen = null, variants = {} } = opts;
    const want = parseTag(lang);
    if (!want.language) return null;
    const pool = (voices ?? []).filter((v) => v && (allowOnline || v.localService !== false));
    if (chosen) {
      const v = pool.find((x) => x.voiceURI === chosen);
      if (v) return v;
    }
    const wantCantonese = want.language === "yue";
    const wantScript = scriptOf(want);
    const tiers = [[], [], [], [], []];
    const variant = variants[want.language] ? parseTag(variants[want.language]) : null;
    const scriptRegion = wantScript ? SCRIPT_REGION[`${want.language}-${wantScript}`] : null;

    for (const v of pool) {
      const t = parseTag(v.lang);
      const cantonese = isCantonese(t, v.name);
      // Cantonese and Mandarin never stand in for each other.
      if (wantCantonese ? !cantonese : want.language === "zh" && cantonese) continue;
      if (!wantCantonese && t.language !== want.language) continue;
      const vScript = scriptOf(t);
      // A voice for another script of the same language (sr-Latn vs Cyrillic sr).
      if (!wantCantonese && wantScript && vScript && vScript !== wantScript) continue;
      if (!wantCantonese && want.language === "sr" && wantScript !== vScript) continue;

      if (t.tag.toLowerCase() === want.tag.toLowerCase()) tiers[0].push(v);
      else if (want.script && vScript === wantScript && t.language === want.language) tiers[1].push(v);
      else if (variant && t.region && t.region === variant.region) tiers[2].push(v);
      else if (scriptRegion && t.region === scriptRegion) tiers[3].push(v);
      else tiers[4].push(v);
    }
    for (const tier of tiers) {
      if (!tier.length) continue;
      return tier.sort((a, b) =>
        (b.localService !== false) - (a.localService !== false) ||
        (b.default === true) - (a.default === true) ||
        String(a.name).localeCompare(String(b.name)),
      )[0];
    }
    return null;
  }

  // What is spoken for a word record: { native, lang, reading? }.
  function textFor(word) {
    if (!word) return "";
    const lang = primary(word.lang);
    let text = lang === "ja" && typeof word.reading === "string" && word.reading.trim() ? word.reading : word.native;
    text = String(text ?? "").normalize("NFD");
    if (STRESS_LANGS.has(lang)) text = text.replace(STRESS_MARK, "");
    return text.normalize("NFC").trim();
  }

  // A speaker bound to one engine. In the browser: speechSynthesis and
  // SpeechSynthesisUtterance from the window; in tests, stubs.
  function createSpeaker({ synth, Utterance, setTimeout: later = globalThis.setTimeout } = {}) {
    let settings = { allowOnline: false, rate: 0.9, voices: {}, variants: {} };
    let voices = null;
    let loading = null;
    const failed = new Set(); // languages whose voice errored this page session
    let current = null;

    function readVoices() {
      try {
        return synth?.getVoices?.() ?? [];
      } catch {
        return [];
      }
    }

    if (synth?.addEventListener) {
      try {
        synth.addEventListener("voiceschanged", () => {
          const list = readVoices();
          if (list.length) voices = list;
        });
      } catch {
        // an engine without events: the first getVoices() is all we get
      }
    }

    // Waits for the first non-empty voice list, or LOAD_TIMEOUT_MS (Chrome loads voices
    // asynchronously; Firefox has them at once).
    function loadVoices() {
      if (voices) return Promise.resolve(voices);
      const now = readVoices();
      if (now.length) return Promise.resolve((voices = now));
      if (!synth) return Promise.resolve([]);
      loading ??= new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          loading = null;
          const list = readVoices();
          if (list.length) voices = list;
          resolve(list);
        };
        try {
          synth.addEventListener?.("voiceschanged", finish, { once: true });
        } catch {
          // fall through to the timeout
        }
        later(finish, LOAD_TIMEOUT_MS);
      });
      return loading;
    }

    async function voiceFor(lang) {
      if (!synth || !Utterance || failed.has(primary(lang))) return null;
      const list = await loadVoices();
      return pickVoice(list, lang, {
        allowOnline: settings.allowOnline === true,
        chosen: settings.voices?.[primary(lang)] ?? null,
        variants: settings.variants ?? {},
      });
    }

    async function canSpeak(lang) {
      return !!(await voiceFor(lang));
    }

    // Speaks the word; resolves true once speaking started, false when there is no voice.
    // Pressing again while speaking restarts.
    async function say(word, opts = {}) {
      const text = textFor(word);
      if (!text) return false;
      const voice = await voiceFor(word.lang);
      if (!voice) return false;
      stop();
      const u = new Utterance(text);
      u.lang = voice.lang;
      u.voice = voice;
      const rate = Number(opts.rate ?? settings.rate);
      u.rate = Number.isFinite(rate) && rate >= 0.1 && rate <= 10 ? rate : 0.9;
      const lang = primary(word.lang);
      u.onerror = (e) => {
        // Our own cancel (a restart, stop()) reports "interrupted" or "canceled".
        if (e?.error === "interrupted" || e?.error === "canceled") return;
        failed.add(lang);
        opts.onError?.(lang);
      };
      u.onend = () => {
        if (current === u) current = null;
        opts.onEnd?.();
      };
      current = u;
      synth.speak(u);
      return true;
    }

    function stop() {
      current = null;
      try {
        synth?.cancel?.();
      } catch {
        // nothing to stop
      }
    }

    return {
      configure(next = {}) {
        settings = { ...settings, ...next };
        return settings;
      },
      settings: () => ({ ...settings }),
      voiceFor,
      canSpeak,
      say,
      stop,
      textFor,
      failed: (lang) => failed.has(primary(lang)),
      // For tests: forget cached voices.
      _reset() {
        voices = null;
        loading = null;
        failed.clear();
      },
    };
  }

  const DEFAULTS = { allowOnline: false, rate: 0.9, voices: {} };
  const speaker = createSpeaker({
    synth: typeof globalThis.speechSynthesis === "object" ? globalThis.speechSynthesis : null,
    Utterance: typeof globalThis.SpeechSynthesisUtterance === "function" ? globalThis.SpeechSynthesisUtterance : null,
  });
  const api = { ...speaker, DEFAULTS, parseTag, pickVoice, textFor, createSpeaker };
  globalThis.KotikoSpeak = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
