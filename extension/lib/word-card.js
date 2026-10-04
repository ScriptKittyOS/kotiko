// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// What the word popover shows for one swap (slice 19 §1, §1a), as plain data: which form
// of the native word, the pronunciation split into syllables with stress and tones, the
// romanization and its source label, the meaning and the other candidates. No DOM, so the
// same file runs as a content script (globalThis.KotikoWordCard) and in Node tests.
//
//   KotikoWordCard.cardFor(word, { all, others })
//     word    the record behind the swap (slice 07 fields; the legacy shape works too)
//     all     every candidate for the same base-language form (this word included)
//     others  the same target word's records for other base languages (50 §3)
(() => {
  const STRESS_LANGS = new Set(["ru", "uk", "be"]);
  const TONAL = new Set(["zh", "yue"]);
  const MAX_OTHER_BASES = 2;

  const primary = (tag) => String(tag ?? "").split(/[-_]/)[0].toLowerCase();
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const hasCase = (s) => s.toUpperCase() !== s.toLowerCase();

  // "pa-ZHAL-sta" -> [[{text:"pa"}, {text:"ZHAL", stressed:true}, {text:"sta"}]]
  // "shyeh4-shyeh" (Mandarin) -> [[{text:"shyeh", tone:4}, {text:"shyeh"}]]
  // Words are split on spaces, syllables on hyphens. A syllable written in capitals is
  // the stressed one (07 §7); a trailing digit on a tonal target is its tone.
  function parsePronunciation(s, lang) {
    const value = text(s);
    if (!value) return null;
    const tonal = TONAL.has(primary(lang));
    return value.split(/\s+/).map((word) =>
      word.split("-").filter(Boolean).map((syl) => {
        const out = { text: syl };
        const m = tonal ? syl.match(/^(.*?)([1-6])$/) : null;
        if (m && m[1]) {
          out.text = m[1];
          out.tone = Number(m[2]);
        }
        if (hasCase(out.text) && out.text === out.text.toUpperCase()) out.stressed = true;
        return out;
      }),
    );
  }

  // The accessible text of a pronunciation: lowercase (screen readers spell out capitals),
  // tones spoken as words, and the stressed syllables named.
  //   -> { plain: "pa-zhal-sta", stressed: ["zhal"] }
  function pronunciationA11y(words, toneWord = (n) => `tone ${n}`) {
    if (!words) return null;
    const stressed = [];
    const plain = words
      .map((syls) =>
        syls
          .map((s) => {
            const low = s.text.toLowerCase();
            if (s.stressed) stressed.push(low);
            return s.tone ? `${low} ${toneWord(s.tone)}` : low;
          })
          .join("-"),
      )
      .join(" ");
    return { plain, stressed };
  }

  // The source label of the respelling (19 §1a, 49 §4a), or null when none is shown.
  function sourceLabel(word) {
    if (!text(word?.pronunciation)) return null;
    if (word.pronunciation_source === "user") return null;
    // Written from Wiktionary's IPA (49 §4a): checked, by construction.
    if (word.pronunciation_source === "wiktionary") return { kind: "checked", source: "Wiktionary" };
    const check = word.verification?.pronunciation;
    const source = text(check?.source);
    if (source && (check.status === "verified" || check.status === "corrected")) return { kind: "checked", source };
    if (source && check.status === "differs") return { kind: "differs", source };
    return { kind: "ai" };
  }

  // The first line: the dictionary's stressed form when 49 found a different stress, else
  // `native_vocalized` for ru, uk and be when present, else `native`.
  function headword(word) {
    const lang = primary(word.lang);
    const check = word.verification?.pronunciation;
    if (check?.status === "differs" && text(check.stressed) && word.pronunciation_source !== "user") return check.stressed.trim();
    if (STRESS_LANGS.has(lang) && text(word.native_vocalized)) return word.native_vocalized.trim();
    return word.native;
  }

  // The tag for a romanization: the target with a Latin script subtag (19 §1).
  function romanizationLang(lang) {
    const p = primary(lang);
    if (p === "zh") return "zh-Latn-pinyin";
    if (p === "yue") return "yue-Latn-jyutping";
    return `${p}-Latn`;
  }

  const sameText = (a, b) => String(a ?? "").normalize("NFC").toLocaleLowerCase() === String(b ?? "").normalize("NFC").toLocaleLowerCase();

  // "Also": the other candidates for the same base-language form, merged by identical
  // native string ("da" for Serbian and Croatian is one item listing both languages).
  function alsoList(word, all = []) {
    const items = [];
    for (const c of all) {
      if (!c || c === word || (c.id !== undefined && c.id === word.id)) continue;
      const same = items.find((i) => i.native === c.native);
      if (same) {
        if (!same.langs.includes(c.lang)) same.langs.push(c.lang);
        continue;
      }
      const rom = text(c.romanization);
      items.push({ native: c.native, lang: c.lang, langs: [c.lang], romanization: rom && !sameText(rom, c.native) ? rom : null });
    }
    return items;
  }

  // The same target word's records in other base languages: "In Spanish: perro".
  function otherBases(word, others = []) {
    const base = word.base_lang ?? "en";
    const seen = new Set([base]);
    const out = [];
    for (const o of others) {
      const b = o?.base_lang ?? "en";
      const gloss = text(o?.gloss ?? o?.english);
      if (!gloss || seen.has(b)) continue;
      seen.add(b);
      out.push({ base: b, gloss });
      if (out.length >= MAX_OTHER_BASES) break;
    }
    return out;
  }

  // Same letters once syllable hyphens, spaces and case are ignored.
  function addsNothing(pronunciation, native) {
    const flat = (v) => String(v ?? "").toLowerCase().replace(/[\s\u2010-]/g, "");
    return flat(pronunciation) !== "" && flat(pronunciation) === flat(native);
  }

  function cardFor(word, { all = [], others = [] } = {}) {
    const lang = word.lang;
    const base = word.base_lang ?? "en";
    const parsed = parsePronunciation(word.pronunciation, lang);
    // A respelling that only repeats the word ("dog" for "dog") adds nothing; one that marks
    // stress ("ho-TEL" for "hotel") still teaches something, so it stays.
    const pron = parsed && !(addsNothing(word.pronunciation, word.native) && !parsed.some((w) => w.some((s) => s.stressed))) ? parsed : null;
    // The careful form only with an everyday one, and only when it differs (07 §7).
    const carefulRaw = pron && text(word.pronunciation_careful) && !sameText(word.pronunciation_careful, word.pronunciation) ? word.pronunciation_careful : null;
    const careful = parsePronunciation(carefulRaw, lang);
    const rom = text(word.romanization);
    const reading = primary(lang) === "ja" && text(word.reading) && !sameText(word.reading, word.native) ? word.reading.trim() : null;
    return {
      lang,
      base,
      native: word.native,
      headword: headword(word),
      reading,
      pronunciation: pron,
      careful,
      stressMarked: !TONAL.has(primary(lang)) && !!pron?.some((w) => w.some((s) => s.stressed)),
      romanization: rom && !sameText(rom, word.native) ? rom : null,
      romanizationLang: romanizationLang(lang),
      label: pron ? sourceLabel(word) : null,
      gloss: text(word.gloss ?? word.english),
      note: text(word.note),
      also: alsoList(word, all),
      otherBases: otherBases(word, others),
    };
  }

  const api = { cardFor, parsePronunciation, pronunciationA11y, sourceLabel, headword, romanizationLang, alsoList, otherBases, primary };
  globalThis.KotikoWordCard = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
