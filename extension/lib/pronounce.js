// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Pronunciations from Wiktionary (DECISIONS 2026-10-04, slice 49 section 4a). The free
// models get Russian stress wrong on a quarter of everyday words, and write wrong
// respellings even when told the stress; Wiktionary's IPA had it right for all forty words
// we checked. So for a target language with lexical stress, Kotiko reads the IPA from the
// word's Wiktionary page and writes the respelling from it with the base's table
// (spec/lang/<base>/respelling.json `ipa`), adding the stress mark for ru, uk and be. A word
// Wiktionary lacks, or whose pronunciations disagree (homographs), keeps the model's. No
// DOM and no network here: the caller passes `fetchPage`. Mirrors server/lib/kotiko/
// pronounce.ex; spec/fixtures/pronounce/ keeps the two the same.
//
//   const P = KotikoPronounce.create(KOTIKO_SPEC);
//   P.blocksFromHtml(html, "Russian")          -> [["[ˈɛtə]"], …]  (IPA per pronunciation section)
//   P.respell("[ˈɛtə]", "en", "ru")             -> "EH-ta"
//   P.vocalize("это", "[ˈɛtə]", "ru")           -> "э́то"
//   await P.enrich(word, { fetchPage, cache })  -> { word, status: "wiktionary" | "no_data" | "unavailable" | "skipped" }
(() => {
  const ACUTE = String.fromCharCode(0x301);
  const VOWELS = new Set("aäɑɐæɒʌəɜeɛɘɪiɨɯɤoɔɵuʊʉyʏøœãẽĩõũ");
  const GLIDE_END = new Set(["j", "w"]);
  // Marks that change nothing a learner would write: length is handled apart; dentals,
  // aspiration, syllabicity, release and tone-free diacritics are dropped.
  const DROP = new Set(["ˑ", "ʰ", "ʷ", "ˠ", "ˤ", "ʼ", "‿", "ʱ", "ⁿ", "ˀ"]);
  const isCombining = (ch) => {
    const c = ch.codePointAt(0);
    return c >= 0x300 && c <= 0x36f && c !== 0x361;
  };
  const OBSTRUENT = new Set(["p", "b", "t", "d", "k", "ɡ", "g", "f", "v", "s", "z", "ʃ", "ʒ", "x", "θ", "ð", "c", "ɟ", "q", "β", "ɣ"]);
  const SECOND = new Set(["r", "ɾ", "ɹ", "ʁ", "l", "ɫ", "j", "w"]);
  const S_LIKE = new Set(["s", "ʃ"]);
  const STOP = new Set(["p", "t", "k"]);

  const primary = (tag) => String(tag ?? "").split("-")[0];
  const decode = (s) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .trim();

  function create(spec) {
    const W = spec.wiktionary ?? {};
    const targets = spec.pronunciation?.targets ?? {};
    const facts = (lang) => targets[lang] ?? targets[primary(lang)] ?? null;
    const keyCache = new WeakMap();

    // The section heading of a language on English Wiktionary.
    function heading(lang) {
      if (W.headings?.[lang]) return W.headings[lang];
      if (W.headings?.[primary(lang)]) return W.headings[primary(lang)];
      const L = spec.languages?.languages ?? {};
      return L[lang]?.names?.en ?? L[primary(lang)]?.names?.en ?? null;
    }

    // The IPA of each Pronunciation section in the language's part of a page, in order.
    function blocksFromHtml(html, name) {
      if (typeof html !== "string" || !name) return [];
      const h2 = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)];
      const at = h2.findIndex((m) => decode(m[1]) === name);
      if (at === -1) return [];
      const start = h2[at].index + h2[at][0].length;
      const end = at + 1 < h2.length ? h2[at + 1].index : html.length;
      const section = html.slice(start, end);
      const heads = [...section.matchAll(/<h([3-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)];
      const blocks = [];
      heads.forEach((m, i) => {
        if (!/^Pronunciation\b/.test(decode(m[2]))) return;
        const from = m.index + m[0].length;
        const to = i + 1 < heads.length ? heads[i + 1].index : section.length;
        const ipa = [...section.slice(from, to).matchAll(/<span\b[^>]*class="IPA[^"]*"[^>]*>([\s\S]*?)<\/span>/g)]
          .map((x) => decode(x[1]))
          .filter((x) => /^[[/]/.test(x));
        if (ipa.length) blocks.push(ipa);
      });
      return blocks;
    }

    // The words of the first transcription in `raw`, cleaned: "[ˈɛtə]" -> ["ˈɛtə"].
    function words(raw) {
      const m = /^[[/]([^\]/]*)[\]/]/.exec(String(raw ?? "").trim());
      if (!m) return null;
      const s = m[1].split(/\s*[~,]\s*/)[0].replace(/\([^)]*\)/g, "").trim();
      return s ? s.split(/\s+/) : null;
    }

    function keysOf(table) {
      let k = keyCache.get(table);
      if (!k) {
        k = Object.keys(table.map).sort((a, b) => b.length - a.length);
        keyCache.set(table, k);
      }
      return k;
    }

    // One IPA word as units: {t: "v"|"c"|"mark"|"pal"|"long", key, s}, or null when it has a
    // sound the table doesn't know.
    function units(word, table, lang) {
      const keys = keysOf(table);
      const over = table.targets?.[lang] ?? table.targets?.[primary(lang)] ?? {};
      const out = [];
      let i = 0;
      while (i < word.length) {
        const ch = word[i];
        if (ch === "ˈ" || ch === "ˌ" || ch === "." || ch === "-") {
          out.push({ t: "mark", key: ch });
          i++;
          continue;
        }
        if (ch === "ʲ") {
          out.push({ t: "pal" });
          i++;
          continue;
        }
        if (ch === "ː") {
          out.push({ t: "long" });
          i++;
          continue;
        }
        if (DROP.has(ch) || isCombining(ch)) {
          i++;
          continue;
        }
        let hit = null;
        for (const k of keys) {
          if (!word.startsWith(k, i)) continue;
          // A diphthong ending in a glide only before a consonant or the end: [ˈmaja] is ma-ya.
          if (k.length > 1 && VOWELS.has(k[0]) && GLIDE_END.has(k[k.length - 1]) && VOWELS.has(word[i + k.length] ?? "")) continue;
          hit = k;
          break;
        }
        if (hit === null) return null;
        out.push({ t: VOWELS.has(hit[0]) ? "v" : "c", key: hit, s: over[hit] ?? table.map[hit] });
        i += hit.length;
      }
      return out;
    }

    // Splits units into syllables. Marks (ˈ ˌ . -) are boundaries, and ˈ stresses the
    // syllable after it; between two vowels with no mark, one consonant, or an obstruent and
    // a liquid or glide (or s and a stop), starts the next syllable. A piece with no vowel
    // joins the syllable after it (or before it, at the end).
    function syllables(us) {
      const nuclei = us.map((u, i) => (u.t === "v" ? i : -1)).filter((i) => i >= 0);
      const cut = new Set();
      for (let n = 0; n + 1 < nuclei.length; n++) {
        const between = us.slice(nuclei[n] + 1, nuclei[n + 1]).map((u, k) => ({ u, at: nuclei[n] + 1 + k }));
        if (between.some((b) => b.u.t === "mark")) continue;
        const cons = between.filter((b) => b.u.t === "c");
        if (!cons.length) {
          cut.add(nuclei[n + 1]);
          continue;
        }
        let k = 1;
        if (cons.length >= 2) {
          const a = cons[cons.length - 2].u.key;
          const b = cons[cons.length - 1].u.key;
          if ((OBSTRUENT.has(a) && SECOND.has(b) && a !== b) || (S_LIKE.has(a) && STOP.has(b))) k = 2;
        }
        cut.add(cons[cons.length - k].at);
      }
      const raw = [{ units: [], stressed: false }];
      let pending = false;
      us.forEach((u, i) => {
        const cur = raw[raw.length - 1];
        if (u.t === "mark") {
          if (cur.units.length) raw.push({ units: [], stressed: false });
          if (u.key === "ˈ") pending = true;
          return;
        }
        if (cut.has(i) && cur.units.length) raw.push({ units: [], stressed: false });
        const now = raw[raw.length - 1];
        now.units.push(u);
        if (pending) {
          now.stressed = true;
          pending = false;
        }
      });
      const out = [];
      let carry = null;
      for (const s of raw) {
        if (!s.units.length) continue;
        if (carry) {
          s.units = carry.units.concat(s.units);
          s.stressed ||= carry.stressed;
          carry = null;
        }
        if (s.units.some((u) => u.t === "v")) out.push(s);
        else carry = s;
      }
      if (carry && out.length) {
        out[out.length - 1].units = out[out.length - 1].units.concat(carry.units);
        out[out.length - 1].stressed ||= carry.stressed;
      }
      return out;
    }

    function spell(syl, table, lang) {
      let s = "";
      syl.forEach((u, i) => {
        const next = syl.slice(i + 1).find((x) => x.t !== "long");
        if (u.t === "pal") {
          if (next?.t === "v" && !(table.palatal_before ?? []).some((p) => next.s.startsWith(p))) s += table.palatal ?? "";
          return;
        }
        if (u.t === "long") {
          const prev = syl[i - 1];
          if (prev?.t === "v" && (table.long_double ?? []).includes(primary(lang)) && prev.s.length === 1) s += prev.s;
          return;
        }
        if (u.t === "c" && u.key === "j" && next?.t !== "v") {
          s += table.coda_y ?? u.s;
          return;
        }
        if (u.t === "c" && u.s === "g" && table.front_g && next?.t === "v" && /^[ei]/.test(next.s)) {
          s += table.front_g;
          return;
        }
        // A vowel that ends its syllable: English readers' "eh" (здравствуйте ZDRAST-vuy-tyeh).
        if (u.t === "v" && !next && table.open_syllable?.[u.key]) {
          s += table.open_syllable[u.key];
          return;
        }
        s += u.s;
      });
      return s;
    }

    // One IPA word -> { text, count, stress } or null.
    function respellWord(word, table, lang) {
      const us = units(word, table, lang);
      if (!us || !us.some((u) => u.t === "v")) return null;
      const syl = syllables(us);
      const parts = syl.map((s) => spell(s.units, table, lang));
      const stressed = syl.map((s, i) => (s.stressed ? i : -1)).filter((i) => i >= 0);
      if (parts.some((p) => !p)) return null;
      if (parts.length > 1 && stressed.length !== 1) return null;
      const at = parts.length > 1 ? stressed[0] : 0;
      const text = parts.map((p, i) => (parts.length > 1 && i === at ? p.toUpperCase() : p)).join("-");
      return { text, count: parts.length, stress: at };
    }

    function tableFor(base) {
      return spec.lang?.[base]?.respelling?.ipa ?? spec.lang?.[primary(base)]?.respelling?.ipa ?? null;
    }

    function alphabetOk(text, base) {
      const alpha = spec.lang?.[base]?.respelling?.alphabet ?? spec.lang?.[primary(base)]?.respelling?.alphabet ?? "";
      return [...text.toLowerCase()].every((c) => c === "-" || c === " " || alpha.includes(c));
    }

    // "[ˈɛtə]" for an English reader of Russian -> "EH-ta"; null when it can't be written.
    function respell(raw, base, lang) {
      const table = tableFor(base);
      const ws = words(raw);
      if (!table || !ws) return null;
      const out = ws.map((w) => respellWord(w, table, lang));
      if (out.some((x) => !x)) return null;
      const text = out.map((x) => x.text).join(" ");
      return alphabetOk(text, base) ? text : null;
    }

    // The stressed syllable of each word, for comparing transcriptions: "0,2"; null when a
    // word can't be read. Read with the first base table there is: only syllables count.
    function stressOf(raw, lang) {
      const ws = words(raw);
      const table = tableFor("en") ?? Object.keys(spec.lang ?? {}).map(tableFor).find(Boolean);
      if (!ws || !table) return null;
      const out = ws.map((w) => respellWord(w, table, lang));
      return out.some((x) => !x) ? null : out.map((x) => (x.count > 1 ? x.stress : 0)).join(",");
    }

    // The respelling's stressed syllable per word: "pa-ZHAL-sta" -> "1".
    const stressOfRespelling = (text) =>
      String(text ?? "")
        .split(" ")
        .map((w) => {
          const s = w.split("-");
          return s.length > 1 ? s.findIndex((p) => /\p{Lu}/u.test(p) && p === p.toUpperCase()) : 0;
        })
        .join(",");

    // The transcription to use: in each section, the first whose stress can be read (passing
    // over regional variants the target's data names, unless nothing else is there); the
    // first section's when every section agrees on the stress; when they don't (homographs:
    // замок ZA-mak or za-MOK), the one the model's respelling agrees with, else none.
    function choose(blocks, lang, modelRespelling) {
      const avoid = W.variants?.[lang]?.avoid ?? W.variants?.[primary(lang)]?.avoid ?? [];
      const plain = (x) => !avoid.some((a) => x.includes(a));
      const pick = (block) => {
        const ordered = [...block.filter(plain), ...block.filter((x) => !plain(x))];
        return ordered.find((x) => stressOf(x, lang) !== null) ?? null;
      };
      const firsts = blocks.map(pick).filter(Boolean);
      if (!firsts.length) return null;
      const stresses = firsts.map((x) => stressOf(x, lang));
      if (stresses.every((s) => s === stresses[0])) return firsts[0];
      const model = modelRespelling ? stressOfRespelling(modelRespelling) : null;
      const at = stresses.indexOf(model);
      return at >= 0 ? firsts[at] : null;
    }

    // "это" with "[ˈɛtə]" -> "э́то" for targets that mark stress (ru, uk, be); null when the
    // syllables and vowel letters don't line up.
    function vocalize(native, raw, lang) {
      const f = facts(lang);
      const ws = words(raw);
      const ns = String(native).split(/\s+/);
      const table = tableFor("en") ?? Object.keys(spec.lang ?? {}).map(tableFor).find(Boolean);
      if (!f?.stress_marked || !ws || !table || ws.length !== ns.length) return null;
      const letters = new Set([...(f.vowel_letters ?? "")]);
      const out = [];
      for (let i = 0; i < ns.length; i++) {
        const r = respellWord(ws[i], table, lang);
        const vowels = [...ns[i]].filter((c) => letters.has(c)).length;
        if (!r || r.count !== vowels) return null;
        if (vowels < 2) {
          out.push(ns[i]);
          continue;
        }
        let n = -1;
        let w = "";
        for (const c of ns[i]) {
          w += c;
          if (letters.has(c) && ++n === r.stress && c !== "ё" && c !== "Ё") w += ACUTE;
        }
        out.push(w);
      }
      return out.join(" ");
    }

    // Applies Wiktionary's pronunciation to one checked word (09's shape). The learner's own
    // pronunciation is never replaced. `fetchPage(title)` resolves to the page's HTML, null
    // for no page, or throws; `cache` ({get, put}) keeps each page's sections.
    // Whether Wiktionary may write this word's pronunciation: not the learner's own, a target
    // with lexical stress, a base whose key has an IPA table, a language Wiktionary names.
    function eligible(word) {
      if (!word || word.pronunciation_source === "user") return false;
      const f = facts(word.lang);
      return !!f && (W.stress ?? []).includes(f.stress) && !!tableFor(word.base_lang) && !!heading(word.lang);
    }

    async function enrich(word, { fetchPage, cache = null } = {}) {
      if (!eligible(word)) return { word, status: "skipped" };
      const f = facts(word.lang);
      const name = heading(word.lang);
      const key = `wiktionary:${word.lang}:${word.native}`;
      let blocks = cache ? await cache.get(key) : undefined;
      if (blocks === undefined || blocks === null) {
        let html;
        try {
          html = await fetchPage(word.native);
        } catch {
          // Not reached (offline, refused): nothing remembered, so a later pass tries again.
          return { word, status: "unavailable" };
        }
        blocks = html ? blocksFromHtml(html, name) : [];
        if (cache) await cache.put(key, blocks);
      }
      const ipa = choose(blocks, word.lang, word.pronunciation);
      const text = ipa && respell(ipa, word.base_lang, word.lang);
      if (!text) return { word, status: "no_data" };
      const out = { ...word, pronunciation: text, pronunciation_careful: null, pronunciation_source: "wiktionary" };
      if (f.stress_marked) out.native_vocalized = vocalize(word.native, ipa, word.lang);
      return { word: out, status: "wiktionary", ipa };
    }

    return { heading, blocksFromHtml, words, respell, stressOf, choose, vocalize, eligible, enrich };
  }

  const api = { create };
  globalThis.KotikoPronounce = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
